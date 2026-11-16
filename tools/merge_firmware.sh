#!/usr/bin/env bash
# Build the release firmware and merge it into the single image the plugin flashes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PLATFORMIO_CORE_DIR="${PLATFORMIO_CORE_DIR:-$ROOT/.pio-core}"
PIO="${PIO:-$ROOT/.venv/bin/pio}"
ESPTOOL="${ESPTOOL:-$ROOT/.venv/bin/python -m esptool}"
BUILD="$ROOT/.pio/build/esp32dev-release"
OUT="$ROOT/dsh-plugin/firmware"
VERSION="$(node -p "require('./dsh-plugin/package.json').version")"

if [ ! -x "$PIO" ]; then
  echo "PlatformIO not found at $PIO (see README: python3 -m venv .venv && .venv/bin/pip install platformio)" >&2
  exit 1
fi

"$PIO" run -e esp32dev-release

BOOT_APP0="$PLATFORMIO_CORE_DIR/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin"
[ -f "$BOOT_APP0" ] || { echo "boot_app0.bin not found at $BOOT_APP0" >&2; exit 1; }

mkdir -p "$OUT"
BIN="$OUT/dsh-esp32-status-esp32dev.bin"

# shellcheck disable=SC2086
$ESPTOOL --chip esp32 merge_bin -o "$BIN" \
  --flash_mode dio --flash_freq 40m --flash_size 4MB \
  0x1000 "$BUILD/bootloader.bin" \
  0x8000 "$BUILD/partitions.bin" \
  0xe000 "$BOOT_APP0" \
  0x10000 "$BUILD/firmware.bin"

BYTES="$(wc -c < "$BIN" | tr -d ' ')"
SHA="$(shasum -a 256 "$BIN" | awk '{print $1}')"
APP_BIN="$OUT/dsh-esp32-status-esp32dev-app.bin"
cp "$BUILD/firmware.bin" "$APP_BIN"
APP_BYTES="$(wc -c < "$APP_BIN" | tr -d ' ')"
APP_SHA="$(shasum -a 256 "$APP_BIN" | awk '{print $1}')"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > "$OUT/manifest.json" <<JSON
{
  "name": "dsh-esp32-status",
  "version": "$VERSION",
  "board": "esp32dev",
  "chip": "esp32",
  "file": "dsh-esp32-status-esp32dev.bin",
  "offset": 0,
  "bytes": $BYTES,
  "sha256": "$SHA",
  "app": {
    "file": "dsh-esp32-status-esp32dev-app.bin",
    "offset": 65536,
    "bytes": $APP_BYTES,
    "sha256": "$APP_SHA"
  },
  "builtAt": "$NOW",
  "flash": {
    "mode": "dio",
    "freq": "40m",
    "size": "4MB",
    "baud": 115200
  }
}
JSON

echo "wrote $BIN ($BYTES bytes, sha256 $SHA)"
echo "wrote $APP_BIN ($APP_BYTES bytes, sha256 $APP_SHA)"
