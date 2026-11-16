#pragma once
#include <Arduino.h>

#include "state.h"

class Net {
 public:
  void begin();
  void pollOnce();
  void copySnapshot(DshSnapshot &out);

  void setWifi(const String &ssid, const String &pass);
  void setServer(const String &host, uint16_t port, const String &token);
  void printStatus(Stream &out);
  String deviceId();

 private:
  void loadConfig();
  void saveWifi();
  void saveServer();
  void setLocal(const char *status, const char *body);
  bool httpHello();
  bool httpState();
  void applyState(const String &payload, int code);

  SemaphoreHandle_t mutex_ = nullptr;
  DshSnapshot snap_;
  String ssid_, pass_, host_, token_;
  uint16_t port_ = 0;
  String deviceId_;

  uint32_t lastPoll_ = 0;
  uint32_t lastWifiTry_ = 0;
  bool helloDone_ = false;
  bool started_ = false;
  bool needSetup_ = false;
  bool eventHooked_ = false;
  String wifiAck_;
};
