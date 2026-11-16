#include <Arduino.h>
#include <BluetoothSerial.h>
#include <U8G2lib.h>
#include <Wire.h>

#include "config.h"
#include "defaults.h"
#include "net.h"
#include <WiFi.h>
#include "state.h"
#include "ui.h"

U8G2_SSD1306_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE, OLED_SCL, OLED_SDA);
Net net;
Ui ui(u8g2);
BluetoothSerial SerialBT;

namespace {

bool btOn = false;  // off by default: classic BT and Wi-Fi share the radio

void netTask(void *) {
  for (;;) {
    net.pollOnce();
    vTaskDelay(pdMS_TO_TICKS(250));
  }
}

void printHelp(Stream &out) {
  out.println();
  out.println("dsh-esp32-status console (USB / Bluetooth)");
  out.println("  status                     show link + DSH state");
  out.println("  scan                       list visible Wi-Fi networks (auth codes)");
  out.println("  wifi <ssid> <password>     save and apply Wi-Fi");
  out.println("  server <host> <port> <token>  point at the DSH bridge");
  out.println("  bt on | bt off             Bluetooth provisioning");
  out.println("  clear                      wipe stored Wi-Fi/server settings");
  out.println("  reboot                     restart the board");
  out.println();
}

void command(char *line, Stream &out) {
  while (*line == ' ') line++;
  if (!*line) return;

  if (!strncmp(line, "help", 4)) { printHelp(out); return; }
  if (!strncmp(line, "scan", 4)) {
    out.println("scanning…");
    int n = WiFi.scanNetworks();
    for (int i = 0; i < n; i++) {
      out.printf("%s ch=%d rssi=%d auth=%d\n", WiFi.SSID(i).c_str(), WiFi.channel(i),
                 WiFi.RSSI(i), (int)WiFi.encryptionType(i));
    }
    out.printf("%d networks\n", n);
    WiFi.scanDelete();
    return;
  }
  if (!strncmp(line, "status", 6)) {
    net.printStatus(out);
    out.printf("bt=%s\n", btOn ? "on" : "off");
    return;
  }
  if (!strncmp(line, "reboot", 6)) { out.println("rebooting…"); delay(100); ESP.restart(); }

  if (!strncmp(line, "wifi ", 5)) {
    char *ssid = line + 5;
    char *sp = strchr(ssid, ' ');
    if (!sp) { out.println("usage: wifi <ssid> <password>"); return; }
    *sp = 0;
    char *pass = sp + 1;
    while (*pass == ' ') pass++;
    net.setWifi(ssid, pass);
    out.printf("wifi saved: ssid=%s\n", ssid);
    return;
  }

  if (!strncmp(line, "server ", 7)) {
    char *host = line + 7;
    char *sp1 = strchr(host, ' ');
    if (!sp1) { out.println("usage: server <host> <port> <token>"); return; }
    *sp1 = 0;
    char *port = sp1 + 1;
    char *sp2 = strchr(port, ' ');
    if (!sp2) { out.println("usage: server <host> <port> <token>"); return; }
    *sp2 = 0;
    char *token = sp2 + 1;
    while (*token == ' ') token++;
    net.setServer(host, (uint16_t)atoi(port), token);
    out.printf("server saved: %s:%s\n", host, port);
    return;
  }

  if (!strncmp(line, "bt on", 5) || (!strncmp(line, "bt", 2) && line[2] == 0)) {
    if (!btOn) {
      btOn = SerialBT.begin("dsh-esp32-status");
      out.printf("bt %s\n", btOn ? "on: pair as dsh-esp32-status" : "failed to start");
    } else {
      out.println("bt already on");
    }
    return;
  }

  if (!strncmp(line, "bt off", 6)) {
    if (btOn) { SerialBT.end(); btOn = false; }
    out.println("bt off");
    return;
  }

  if (!strncmp(line, "clear", 5)) {
    out.println("clearing stored settings…");
    net.setWifi(WIFI_SSID, WIFI_PASS);
    net.setServer(DSH_HOST, DSH_PORT, DSH_TOKEN);
    out.println("defaults restored");
    return;
  }

  out.printf("unknown command: %s\n", line);
}

void drain(Stream &in, Stream &out, char *line, size_t &len) {
  while (in.available()) {
    int c = in.read();
    if (c == '\r') continue;
    if (c == '\n') {
      line[len] = 0;
      command(line, out);
      len = 0;
    } else if (len < 191) {
      line[len++] = (char)c;
    }
  }
}

void pollSerial() {
  static char line[192];
  static size_t len = 0;
  drain(Serial, Serial, line, len);
}

void pollBt() {
  static char line[192];
  static size_t len = 0;
  if (btOn) drain(SerialBT, SerialBT, line, len);
}

}  // namespace

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(150);
  Serial.printf("\n%s %s\n", FW_NAME, FW_VERSION);

  Wire.begin(OLED_SDA, OLED_SCL);
  Wire.setClock(400000);
  ui.begin();


  net.begin();
  xTaskCreatePinnedToCore(netTask, "dsh-net", 10240, nullptr, 1, nullptr, 0);

  printHelp(Serial);
}

void loop() {
  static uint32_t lastLog = 0;
  static DshSnapshot snap;

  net.copySnapshot(snap);
  ui.render(snap);
  pollSerial();
  pollBt();

  uint32_t now = millis();
  if (now - lastLog > 15000) {
    lastLog = now;
    net.printStatus(Serial);
  }
  delay(40);
}
