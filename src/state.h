#pragma once
#include <Arduino.h>

// One immutable-ish snapshot produced by the network task and consumed by the
// render task. Keep it POD so it can be memcpy'd under a mutex.
struct DshSnapshot {
  bool wifiUp = false;
  bool serverUp = false;      // last poll succeeded
  int httpCode = 0;           // last HTTP status (0 = transport error)
  uint32_t seq = 0;           // server sequence, bumps on every state change
  uint32_t serverNowMs = 0;   // epoch milliseconds reported by DSH
  uint32_t recvAtMs = 0;      // millis() when the snapshot arrived
  uint32_t lastOkMs = 0;      // millis() of last successful poll
  int rssi = 0;

  char status[16] = "boot";   // boot|connecting|offline|auth|idle|thinking|responding|tool|approval|error
  char body[192] = "";
  char detail[64] = "";       // tool name / error code
  char model[40] = "";
  char effort[16] = "";
  char host[40] = "";
  uint16_t port = 0;

  bool wifiUpNow() const { return wifiUp; }
};
