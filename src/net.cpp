#include "net.h"
#include <esp_wifi.h>

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>

#include "config.h"
#include "defaults.h"

namespace {
Preferences prefs;
constexpr const char *kNs = "dsh";

String prefString(const char *key, const char *fallback) {
  String v = prefs.getString(key, "");
  if (v.isEmpty()) v = fallback;
  return v;
}
}  // namespace

void Net::begin() {
  mutex_ = xSemaphoreCreateMutex();
  loadConfig();
  if (ssid_.isEmpty() || ssid_ == "YOUR_WIFI") {
    // Published images ship without credentials: wait for the serial setup.
    needSetup_ = true;
    setLocal("setup", "請用序列埠設定 WiFi");
    started_ = true;
    return;
  }
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  if (!eventHooked_) {
    eventHooked_ = true;
    WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info) {
      if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
        Serial.printf("[net] wifi disconnected reason=%u\n", info.wifi_sta_disconnected.reason);
      } else if (event == ARDUINO_EVENT_WIFI_STA_GOT_IP) {
        Serial.printf("[net] got ip=%s gw=%s ch=%d\n", WiFi.localIP().toString().c_str(),
                      WiFi.gatewayIP().toString().c_str(), WiFi.channel());
      }
    });
  }
  setLocal("connecting", "正在連線 WiFi 與伺服器");
  started_ = true;
}

void Net::loadConfig() {
  prefs.begin(kNs, false);
  ssid_ = prefString("ssid", WIFI_SSID);
  pass_ = prefString("pass", WIFI_PASS);
  host_ = prefString("host", DSH_HOST);
  port_ = (uint16_t)prefs.getUShort("port", DSH_PORT);
  token_ = prefString("token", DSH_TOKEN);
  snprintf(snap_.host, sizeof snap_.host, "%s", host_.c_str());
  snap_.port = port_;
}

void Net::saveWifi() {
  prefs.putString("ssid", ssid_);
  prefs.putString("pass", pass_);
}

void Net::saveServer() {
  prefs.putString("host", host_);
  prefs.putUShort("port", port_);
  prefs.putString("token", token_);
}

String Net::deviceId() {
  if (deviceId_.isEmpty()) {
    uint8_t mac[6];
    WiFi.macAddress(mac);
    char buf[24];
    snprintf(buf, sizeof buf, "esp32-%02x%02x%02x%02x%02x%02x", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    deviceId_ = buf;
  }
  return deviceId_;
}

void Net::setLocal(const char *status, const char *body) {
  if (!mutex_) return;
  if (xSemaphoreTake(mutex_, pdMS_TO_TICKS(100)) != pdTRUE) return;
  snprintf(snap_.status, sizeof snap_.status, "%s", status);
  snprintf(snap_.body, sizeof snap_.body, "%s", body);
  xSemaphoreGive(mutex_);
}

void Net::setWifi(const String &ssid, const String &pass) {
  ssid_ = ssid;
  pass_ = pass;
  saveWifi();
  helloDone_ = false;
  needSetup_ = ssid_.isEmpty();
  if (needSetup_) {
    setLocal("setup", "請用序列埠設定 WiFi");
    return;
  }
  setLocal("connecting", "正在套用新的 WiFi 設定");
  WiFi.disconnect(true, false);
  delay(50);
  WiFi.begin(ssid_.c_str(), pass_.c_str());
  lastWifiTry_ = millis();
}

void Net::setServer(const String &host, uint16_t port, const String &token) {
  host_ = host;
  port_ = port;
  token_ = token;
  saveServer();
  helloDone_ = false;
  if (mutex_ && xSemaphoreTake(mutex_, pdMS_TO_TICKS(100)) == pdTRUE) {
    snprintf(snap_.host, sizeof snap_.host, "%s", host_.c_str());
    snap_.port = port_;
    xSemaphoreGive(mutex_);
  }
}

void Net::copySnapshot(DshSnapshot &out) {
  if (!mutex_) { out = snap_; return; }
  if (xSemaphoreTake(mutex_, pdMS_TO_TICKS(50)) == pdTRUE) {
    out = snap_;
    xSemaphoreGive(mutex_);
  }
}

bool Net::httpHello() {
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClient client;
  HTTPClient http;
  http.setTimeout(4000);
  String url = "http://" + host_ + ":" + String(port_) + "/api/hello";
  if (!http.begin(client, url)) return false;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-dsh-token", token_);

  JsonDocument doc;
  doc["deviceId"] = deviceId();
  doc["name"] = "dsh-oled";
  doc["fw"] = FW_VERSION;
  doc["transport"] = "wifi";
  doc["ip"] = WiFi.localIP().toString();
  doc["rssi"] = WiFi.RSSI();
  String payload;
  serializeJson(doc, payload);

  int code = http.POST(payload);
  String response = http.getString();
  http.end();
  if (code == 200) {
    applyState(response, code);
    helloDone_ = true;
    return true;
  }
  if (code == 401) {
    setLocal("auth", "Token 不正確，請看面板");
  }
  Serial.printf("[net] hello failed http=%d %s\n", code, response.c_str());
  return false;
}

bool Net::httpState() {
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClient client;
  HTTPClient http;
  http.setTimeout(3000);
  String url = "http://" + host_ + ":" + String(port_) + "/api/state?deviceId=" + deviceId() +
               "&rssi=" + String(WiFi.RSSI()) + "&fw=" FW_VERSION;
  if (wifiAck_.length()) url += "&wifiAck=" + wifiAck_;
  if (!http.begin(client, url)) return false;
  http.addHeader("x-dsh-token", token_);
  int code = http.GET();
  String response = code > 0 ? http.getString() : String();
  http.end();
  applyState(response, code);
  if (code == 200 && wifiAck_.length()) wifiAck_ = "";
  return code == 200;
}

void Net::applyState(const String &payload, int code) {
  if (!mutex_) return;
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload);
  if (code == 200 && !err) {
    const char *paired = doc["token"] | "";
    if (xSemaphoreTake(mutex_, pdMS_TO_TICKS(100)) != pdTRUE) return;
    snap_.httpCode = code;
    snap_.serverUp = true;
    snap_.lastOkMs = millis();
    snap_.recvAtMs = millis();
    snap_.serverNowMs = doc["now"] | 0;
    snap_.seq = doc["seq"] | 0;
    snap_.rssi = WiFi.RSSI();
    snap_.wifiUp = true;
    const char *st = doc["status"] | "idle";
    snprintf(snap_.status, sizeof snap_.status, "%s", st);
    snprintf(snap_.body, sizeof snap_.body, "%s", (const char *)(doc["body"] | ""));
    snprintf(snap_.detail, sizeof snap_.detail, "%s", (const char *)(doc["detail"] | ""));
    snprintf(snap_.model, sizeof snap_.model, "%s", (const char *)(doc["model"] | ""));
    snprintf(snap_.effort, sizeof snap_.effort, "%s", (const char *)(doc["effort"] | ""));
    xSemaphoreGive(mutex_);
    if (paired[0] && token_ != paired) {
      // First contact with the panel: adopt the real LAN token in NVS.
      token_ = paired;
      prefs.putString("token", token_);
      Serial.println("[net] paired with DSH panel, token stored");
    }

    // Wi-Fi provisioning over the existing LAN link.
    JsonObject wifi = doc["wifi"].as<JsonObject>();
    if (!wifi.isNull()) {
      const char *id = wifi["id"] | "";
      const char *ssid = wifi["ssid"] | "";
      const char *pass = wifi["pass"] | "";
      if (ssid[0]) {
        Serial.printf("[net] applying Wi-Fi from panel: ssid=%s\n", ssid);
        setWifi(ssid, pass);
        wifiAck_ = id;
      }
    }
    return;
  }

  if (xSemaphoreTake(mutex_, pdMS_TO_TICKS(100)) != pdTRUE) return;
  snap_.httpCode = code;
  snap_.serverUp = false;
  snap_.rssi = WiFi.RSSI();
  snap_.wifiUp = (WiFi.status() == WL_CONNECTED);
  if (code == 401) {
    snprintf(snap_.status, sizeof snap_.status, "auth");
    snprintf(snap_.body, sizeof snap_.body, "Token 不正確，請看 DSH 面板");
  } else if (snap_.wifiUp) {
    snprintf(snap_.status, sizeof snap_.status, "offline");
    snprintf(snap_.body, sizeof snap_.body, "無法連線到 %s:%u", snap_.host, snap_.port);
  }
  xSemaphoreGive(mutex_);
}

void Net::pollOnce() {
  if (!started_) return;
  uint32_t now = millis();
  if (needSetup_) return;

  bool wifiUp = (WiFi.status() == WL_CONNECTED);
  {
    if (mutex_ && xSemaphoreTake(mutex_, pdMS_TO_TICKS(50)) == pdTRUE) {
      snap_.wifiUp = wifiUp;
      snap_.rssi = WiFi.RSSI();
      xSemaphoreGive(mutex_);
    }
  }

  if (!wifiUp) {
    if (now - lastWifiTry_ > 15000) {
      lastWifiTry_ = now;
      Serial.printf("[net] connecting wifi ssid=%s status=%d\n", ssid_.c_str(), (int)WiFi.status());
      WiFi.begin(ssid_.c_str(), pass_.c_str());
    }
    return;
  }

  if (!helloDone_) {
    httpHello();
    if (!helloDone_) return;
  }

  if (now - lastPoll_ < POLL_INTERVAL_MS) return;
  lastPoll_ = now;
  if (!httpState()) {
    helloDone_ = false;  // re-handshake once the bridge is back
  }
}

void Net::printStatus(Stream &out) {
  DshSnapshot s;
  copySnapshot(s);
  out.printf("fw=%s id=%s\n", FW_VERSION, deviceId().c_str());
  out.printf("wifi=%s ssid=%s ip=%s gw=%s rssi=%d st=%d\n", s.wifiUp ? "up" : "down", ssid_.c_str(),
             WiFi.localIP().toString().c_str(), WiFi.gatewayIP().toString().c_str(), WiFi.RSSI(),
             (int)WiFi.status());
  out.printf("server=%s:%u token=%s…\n", host_.c_str(), port_,
             token_.length() > 4 ? token_.substring(0, 4).c_str() : "????");
  out.printf("state=%s http=%d up=%d body=%s\n", s.status, s.httpCode, (int)s.serverUp, s.body);
}
