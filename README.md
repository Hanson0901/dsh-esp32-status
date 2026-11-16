# dsh-esp32-status

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 ESP32 狀態顯示器：
一顆 0.96" SSD1306 OLED 即時顯示 DSH 的狀態，左側面板可看連線、裝置與一鍵燒錄。

```
┌──────────────────────────────┐
│            ◠◡◠               │  待命中 / 思考中 / 需要授權 / 錯誤
│          思考中               │
│      已推理 12 秒             │
│ G8 00:24:11      flash/max    │  GMT+8 時鐘 + 模型/推理程度
└──────────────────────────────┘
```

## 快速開始

```bash
# 1. 安裝插件（需要 DSH >= 0.2.0-rc.1）
dsh plugin --profile desktop add dsh-esp32-status
# 重啟 DSH，側欄會出現 ESP32

# 2. 接線：OLED VCC=3V3 GND=GND SDA=GPIO21 SCL=GPIO22
# 3. 面板 →「有線 ESP32」→ 重新掃描 → 偵測 → 燒錄

# 4. 首次開機用 115200 序列埠設定 Wi-Fi 與面板位址
wifi <SSID> <PASSWORD>
server <LAN_IP> 8787 PAIR-ME
```

`PAIR-ME` 只用在第一次 `/api/hello`；配對成功後面板會回傳真正的 token，
板子寫入 NVS，之後自動使用。發佈的映像檔不含任何人的 Wi-Fi 憑證。

## 功能

- **OLED**：上半 24 px 圖示、下半 12 px 中文 + 跑馬燈、底列 GMT+8 時鐘與模型/推理程度。
- **狀態**：待命、思考中（reasoning）、回覆中、執行工具、需要授權、錯誤（可滾動）。
- **面板**：連線狀態、已連接裝置（IP/RSSI/韌體/上線時間）、token 管理、
  序列埠掃描、chip/MAC 偵測、燒錄進度與 log。
- **安全**：LAN 端點需 token；面板 API 只接受 loopback；Wi-Fi 憑證不進版控、不進映像檔。

## 專案結構

```
dsh-plugin/          DSH 插件本體（npm: dsh-esp32-status）
  lib/state.mjs      Host 事件 → OLED 狀態字串
  lib/server.mjs     LAN bridge（ESP32）+ 面板 API（loopback）
  lib/flash.mjs      序列埠掃描與 esptool 燒錄
  client.js          DSH 左側面板（sidebar.panellist + main）
  firmware/          合併好的 ESP32 映像檔與 manifest
src/                 ESP32 韌體（PlatformIO / Arduino）
tools/gen_font.py    12 px 中文點陣字型產生器
tools/merge_firmware.sh
```

## 自行編譯

```bash
python3 -m venv .venv && .venv/bin/pip install platformio
export PLATFORMIO_CORE_DIR=$PWD/.pio-core
.venv/bin/pio run -e esp32dev-release
```

`esp32dev-release` 會定義 `DSH_RELEASE_BUILD=1`，把 Wi-Fi/伺服器位址留白，
避免把私人憑證打包進公開發佈的 bin。詳細說明見 [dsh-plugin/README.md](dsh-plugin/README.md)。

## 授權

MIT © Hanson0901
