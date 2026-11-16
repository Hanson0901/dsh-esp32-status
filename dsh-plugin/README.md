# dsh-esp32-status

把 DeepSeek Harness（DSH）目前的狀態即時顯示在一顆 **0.96 吋 SSD1306 OLED** 上，
同時在 DSH 左側面板提供「連線狀態、已連接裝置、token 配對、序列埠掃描、一鍵燒錄」。

- 上半部：24 px 圖示（待命月亮 / 思考轉圈 / 授權驚嘆號 / 錯誤叉號 / 離線 Wi-Fi）
- 下半部：12 px 中文標題 + 內容跑馬燈（錯誤訊息過長會自動滾動）
- 底列：左邊固定 **GMT+8 時鐘**，右邊固定 **目前模型 / 推理程度**
- 左側面板：連線狀態、裝置清單（IP、RSSI、韌體、上線時間）、token、燒錄進度與 log

```
┌──────────────────────────────┐
│            ◠◡◠               │  ← 24px icon
│          思考中               │  ← 12px title
│      已推理 12 秒             │  ← 12px body / marquee
│ G8 00:24:11      flash/max    │  ← 5x7 bottom bar
└──────────────────────────────┘
```

## 安裝

```bash
dsh plugin --profile desktop add dsh-esp32-status
```

安裝後**重啟一次 DSH**（首次載入 bundle），側欄會多一個 `ESP32` 圖示。

開發時可直接連本地資料夾：

```bash
dsh plugin --profile desktop add link:/path/to/dsh-plugin
```

## 硬體接線

| OLED | ESP32 |
| --- | --- |
| VCC | 3V3 |
| GND | GND |
| SDA | GPIO21（擴充板 D21） |
| SCL | GPIO22（擴充板 D22） |

I2C 位址預設 `0x3C`（少數模組是 `0x3D`，請改 `src/config.h` 的 `OLED_ADDR`）。
Serial 115200；本專案在 ESP32-D0WD-V3 + CP2102 + 0.96" SSD1306 上驗證。

## 燒錄

1. 用 USB 接上 ESP32。
2. 打開 DSH 側欄 `ESP32` 面板 →「有線 ESP32」。
3. 按「重新掃描」→ 對序列埠按「偵測」確認 chip/MAC → 按「燒錄」。
4. 面板會顯示進度與 esptool log；完成後板子自動重啟。

內建映像檔是合併好的單一 bin（bootloader `0x1000`、partitions `0x8000`、
boot_app0 `0xe000`、app `0x10000`），燒到 `0x0` 即可。手動燒錄：

```bash
esptool.py --chip esp32 --port /dev/cu.usbserial-0001 --baud 115200 \
  write_flash -z --flash_mode dio --flash_freq 40m --flash_size 4MB \
  0x0 node_modules/dsh-esp32-status/firmware/dsh-esp32-status-esp32dev.bin
```

找不到 esptool 時，面板會提示；也可以：

```bash
pip install esptool
# 或指定自帶 binary
ln -s /path/to/esptool ~/.dsh/esp32-status/esptool
```

## 首次設定 Wi-Fi

發佈的映像檔**不包含任何人的 Wi-Fi 密碼**（以 `-DDSH_RELEASE_BUILD=1` 建置，
SSID 留白）。第一次開機會顯示「待設定 / 請用序列埠設定 WiFi」，用 115200 序列埠輸入：

```
wifi <SSID> <PASSWORD>
server 192.168.31.75 8787 PAIR-ME
status
```

- `server` 的 IP 是面板「橋接與 token」卡片上顯示的 LAN URL。
- `PAIR-ME` 是首次配對用的暫時 token：板子第一次 `/api/hello` 成功後，
  面板會回傳真正的 token，板子寫進 NVS，之後自動使用。
- 也可以在自行編譯時把 `include/secrets.h`（git-ignored）填好。
- 其他序列指令：`help`、`status`、`clear`（清除 NVS 設定）、`reboot`。

## 左側面板

| 區塊 | 內容 |
| --- | --- |
| 狀態 | 待命 / 思考中 / 回覆中 / 執行工具 / 需要授權 / 錯誤，含 OLED 同款文字 |
| 已連接的裝置 | 名稱、deviceId、IP、韌體、RSSI、最後回報、是否已配對 |
| 橋接與 token | LAN URL、token 顯示 / 複製 / 重設、可直接照抄的 `server` 指令 |
| 有線 ESP32 | 序列埠掃描、chip/MAC 偵測、燒錄（含進度與 log、可中止） |
| 最近的錯誤 | 最近 8 筆 `agent/error`，可清除錯誤標記 |

狀態來源是 Host 事件，不需要輪詢 DSH：

- `agent/status` → 執行中 / 待命
- `agent/assistant-stream` → reasoning-delta（思考中）、text-delta（回覆中）、tool-call-delta（執行工具）
- `approval/request` waterfall → 需要授權（並在 finally 清除）
- `agent/error` → 錯誤（訊息 + code）
- `agentDefaultModel.currentSelection()` + 執行中 session 的 `requestHeader().config`
  → 右下角的模型與推理程度

## 網路與安全

- 插件會監聽 `0.0.0.0:8787`（可用 `port` 設定；被佔用時自動往後找）。
- ESP32 只會打到兩個端點：`POST /api/hello`、`GET /api/state`，都需要
  `x-dsh-token`。
- 面板 API（`/api/esp32-status/*`）只接受 loopback；在 DSH GUI 內是免 token
  的同源路由，外部 LAN 無法讀取狀態或觸發燒錄。
- Token 隨機 32 hex，存於 `~/.dsh/esp32-status/token.json`（0600）。
- `PAIR-ME` 只在 hello 時接受，而且可用 `allowPairing: false` 關閉；
  面板亦可「重設 token」讓所有裝置重新配對。

## 設定

`cordis.patch.yml` 內可調：

```yaml
- insert:
    - id: esp32-status
      name: dsh-esp32-status
      config:
        enabled: true
        port: 8787
        allowPairing: true
        # esptool: /usr/local/bin/esptool
        # platformioCore: /path/to/.pio-core
```

## 自行編譯韌體

```bash
python3 -m venv .venv && .venv/bin/pip install platformio
export PLATFORMIO_CORE_DIR=$PWD/.pio-core
.venv/bin/pio run -e esp32dev-release
```

`-e esp32dev-release` 會加上 `-DDSH_RELEASE_BUILD=1`，確保映像檔不含私人憑證。
合併映像檔（`esptool v5`）：

```bash
esptool --chip esp32 merge-bin -o dsh-plugin/firmware/dsh-esp32-status-esp32dev.bin \
  --flash-mode dio --flash-freq 40m --flash-size 4MB \
  0x1000 .pio/build/esp32dev-release/bootloader.bin \
  0x8000 .pio/build/esp32dev-release/partitions.bin \
  0xe000 .pio-core/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin \
  0x10000 .pio/build/esp32dev-release/firmware.bin
```

字型是自製點陣（`tools/gen_font.py`，Pillow + STHeiti 12 px），
輸出 `src/font_cn.h`；要新增中文字請改 `CHARS` 後重跑。

## 疑難排解

- **OLED 全黑**：先確認 3V3/GND，再用裸 I2C `0xE3`（NOP）看 `endTransmission()`
  是否為 0。這顆面板電荷泵啟動時若供電不足會整片掉電，`sendBuffer()` 不會回報錯誤。
- **面板顯示 auth**：token 不一致。用序列埠 `server <ip> 8787 PAIR-ME`，或在面板按「重設」再配對。
- **面板看不到裝置**：確認 Mac 與 ESP32 在同一個網段、防火牆允許 node 監聽 8787；
  序列埠 `status` 會顯示目前 host/port/IP。
- **面板說找不到橋接**：DSH 首次安裝需重啟；也看 log 是否有 `LAN bridge failed`。
- **燒錄失敗**：確認沒有其他 monitor 佔用序列埠，baud 使用 115200（460800 在 CP2102 上會失敗）。

## 授權

MIT © Hanson0901
