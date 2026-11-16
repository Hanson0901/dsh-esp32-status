#pragma once

// Compile-time defaults. Runtime values live in NVS and can be changed over
// the serial console (see main.cpp) without rebuilding:
//   wifi <ssid> <password>
//   server <host> <port> <token>
#define FW_NAME "dsh-esp32-status"
#define FW_VERSION "0.1.0"

#define OLED_SDA 21
#define OLED_SCL 22
#define OLED_ADDR 0x3C

// How often the device polls the bridge for a fresh snapshot.
#define POLL_INTERVAL_MS 1000
// A snapshot older than this is treated as "server unreachable".
#define STALE_AFTER_MS 6000
// Time zone offset applied to the server-provided epoch clock.
#define TZ_OFFSET_MINUTES 480

#define SERIAL_BAUD 115200
