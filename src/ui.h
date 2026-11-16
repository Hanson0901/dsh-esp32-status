#pragma once
#include <Arduino.h>
#include <U8g2lib.h>
#include "state.h"

class Ui {
 public:
  explicit Ui(U8G2 &g) : g_(g) {}
  void begin();

  // Draws one frame. Cheap no-op when nothing changed and no animation runs.
  void render(const DshSnapshot &s);

 private:
  void drawIcon(const char *status, uint32_t t);
  void drawSpinner(uint32_t t);
  void drawWifi(uint32_t t, bool animated);
  void drawWifiOff();
  void drawMoon();
  void drawGear(uint32_t t);
  void drawApproval();
  void drawError();

  void drawText(const char *utf8, int x, int baseline);
  int textWidth(const char *utf8);
  void drawMarquee(const char *utf8, int baseline, uint32_t elapsed);
  void drawBar(const DshSnapshot &s, uint32_t t);

  U8G2 &g_;
  char lastStatus_[16] = "";
  uint32_t statusSince_ = 0;
  uint32_t lastDraw_ = 0;
  uint32_t lastSecond_ = 0xFFFFFFFF;
};
