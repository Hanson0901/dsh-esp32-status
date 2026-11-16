#include <Arduino.h>
#include <U8G2lib.h>
#include <Wire.h>

#include "config.h"
#include "defaults.h"
#include "net.h"
#include "state.h"
#include "ui.h"

U8G2_SSD1306_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE, OLED_SCL, OLED_SDA);
Net net;
Ui ui(u8g2);

namespace {

void netTask(void *) {
  for (;;) {
    net.pollOnce();
    vTaskDelay(pdMS_TO_TICKS(250));
  }
}

void printHelp() {
  Serial.println();
  Serial.println("dsh-esp32-status console");
  Serial.println("  status                     show link + DSH state");
  Serial.println("  wifi <ssid> <password>     save and apply Wi-Fi");
  Serial.println("  server <host> <port> <token>  point at the DSH bridge");
  Serial.println("  clear                      wipe stored Wi-Fi/server settings");
  Serial.println("  reboot                     restart the board");
  Serial.println();
}

void command(char *line) {
  while (*line == ' ') line++;
  if (!*line) return;

  if (!strncmp(line, "help", 4)) { printHelp(); return; }
  if (!strncmp(line, "status", 6)) { net.printStatus(Serial); return; }
  if (!strncmp(line, "reboot", 6)) { Serial.println("rebooting…"); delay(100); ESP.restart(); }

  if (!strncmp(line, "wifi ", 5)) {
    char *ssid = line + 5;
    char *sp = strchr(ssid, ' ');
    if (!sp) { Serial.println("usage: wifi <ssid> <password>"); return; }
    *sp = 0;
    char *pass = sp + 1;
    while (*pass == ' ') pass++;
    net.setWifi(ssid, pass);
    Serial.printf("wifi saved: ssid=%s\n", ssid);
    return;
  }

  if (!strncmp(line, "server ", 7)) {
    char *host = line + 7;
    char *sp1 = strchr(host, ' ');
    if (!sp1) { Serial.println("usage: server <host> <port> <token>"); return; }
    *sp1 = 0;
    char *port = sp1 + 1;
    char *sp2 = strchr(port, ' ');
    if (!sp2) { Serial.println("usage: server <host> <port> <token>"); return; }
    *sp2 = 0;
    char *token = sp2 + 1;
    while (*token == ' ') token++;
    net.setServer(host, (uint16_t)atoi(port), token);
    Serial.printf("server saved: %s:%s\n", host, port);
    return;
  }

  if (!strncmp(line, "clear", 5)) {
    Serial.println("clearing stored settings…");
    net.setWifi(WIFI_SSID, WIFI_PASS);
    net.setServer(DSH_HOST, DSH_PORT, DSH_TOKEN);
    Serial.println("defaults restored");
    return;
  }

  Serial.printf("unknown command: %s\n", line);
}

void pollSerial() {
  static char line[192];
  static size_t len = 0;
  while (Serial.available()) {
    int c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      line[len] = 0;
      command(line);
      len = 0;
    } else if (len < sizeof(line) - 1) {
      line[len++] = (char)c;
    }
  }
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

  printHelp();
}

void loop() {
  static uint32_t lastLog = 0;
  static DshSnapshot snap;

  net.copySnapshot(snap);
  ui.render(snap);
  pollSerial();

  uint32_t now = millis();
  if (now - lastLog > 15000) {
    lastLog = now;
    net.printStatus(Serial);
  }
  delay(40);
}
