#pragma once

// Defaults baked into the image. include/secrets.h is git-ignored; the
// values here are only used when NVS has no override yet.
//
// Release images must never embed a real Wi-Fi password, so the published
// binary is built with -DDSH_RELEASE_BUILD=1 and placeholder credentials.
// Configure the board over USB serial after flashing:
//   wifi <ssid> <password>
//   server <lan-ip> 8787 PAIR-ME
#if defined(DSH_RELEASE_BUILD)
#define WIFI_SSID ""
#define WIFI_PASS ""
#define DSH_HOST "YOUR_LAN_IP"
#define DSH_PORT 8787
#define DSH_TOKEN "PAIR-ME"
#else
#include "secrets.h"
#endif

#ifndef WIFI_SSID
#define WIFI_SSID "YOUR_SSID"
#endif
#ifndef WIFI_PASS
#define WIFI_PASS "YOUR_PASSWORD"
#endif
#ifndef DSH_HOST
#define DSH_HOST "192.168.1.10"
#endif
#ifndef DSH_PORT
#define DSH_PORT 8787
#endif
#ifndef DSH_TOKEN
#define DSH_TOKEN "PAIR-ME"
#endif
