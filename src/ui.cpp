#include "ui.h"

#include <math.h>
#include <string.h>

#include "config.h"
#include "font_cn.h"

namespace {

constexpr int W = 128;
constexpr int H = 64;
constexpr int ICON_CX = 64;
constexpr int ICON_CY = 13;
constexpr int TITLE_BASE = 37;
constexpr int BODY_BASE = 50;
constexpr int BAR_LINE = 54;
constexpr int BAR_BASE = 63;

const CnGlyph *findGlyph(uint16_t cp) {
  int lo = 0, hi = CN_FONT_COUNT - 1;
  while (lo <= hi) {
    int mid = (lo + hi) >> 1;
    uint16_t v = CN_FONT_GLYPHS[mid].cp;
    if (v == cp) return &CN_FONT_GLYPHS[mid];
    if (v < cp) lo = mid + 1; else hi = mid - 1;
  }
  return nullptr;
}

uint16_t utf8Next(const char *&p) {
  uint8_t c = (uint8_t)*p++;
  if (c < 0x80) return c;
  if ((c & 0xE0) == 0xC0) {
    if (!*p) return '?';
    return (uint16_t)(((c & 0x1F) << 6) | ((uint8_t)*p++ & 0x3F));
  }
  if ((c & 0xF0) == 0xE0) {
    if (!p[0] || !p[1]) { p += strlen(p); return '?'; }
    uint16_t v = (uint16_t)(((c & 0x0F) << 12) | (((uint8_t)p[0] & 0x3F) << 6) | ((uint8_t)p[1] & 0x3F));
    p += 2;
    return v;
  }
  if ((c & 0xF8) == 0xF0) {
    // Outside the BMP: the UI never needs those.
    for (int i = 0; i < 3 && *p; i++) p++;
    return '?';
  }
  return '?';
}

void drawArc(U8G2 &g, int cx, int cy, int r, float a0, float a1, int seg = 8) {
  for (int i = 0; i < seg; i++) {
    float t0 = a0 + (a1 - a0) * i / seg;
    float t1 = a0 + (a1 - a0) * (i + 1) / seg;
    g.drawLine(cx + (int)lroundf(cosf(t0) * r), cy + (int)lroundf(sinf(t0) * r),
               cx + (int)lroundf(cosf(t1) * r), cy + (int)lroundf(sinf(t1) * r));
  }
}

const char *titleFor(const char *st) {
  if (!strcmp(st, "setup")) return "待設定";
  if (!strcmp(st, "connecting")) return "連線中";
  if (!strcmp(st, "offline")) return "未連線";
  if (!strcmp(st, "auth")) return "授權失敗";
  if (!strcmp(st, "thinking")) return "思考中";
  if (!strcmp(st, "responding")) return "回覆中";
  if (!strcmp(st, "tool")) return "執行工具";
  if (!strcmp(st, "approval")) return "需要授權";
  if (!strcmp(st, "error")) return "錯誤";
  return "待命中";
}

}  // namespace

void Ui::begin() {
  g_.begin();
  g_.setFontMode(1);
  g_.setBitmapMode(1);
  g_.setDrawColor(1);
  g_.setContrast(220);
  g_.clearBuffer();
  g_.sendBuffer();
}

int Ui::textWidth(const char *utf8) {
  int w = 0;
  const char *p = utf8;
  while (*p) {
    uint16_t cp = utf8Next(p);
    const CnGlyph *gl = findGlyph(cp);
    if (!gl) gl = findGlyph('?');
    if (gl) w += gl->adv;
  }
  return w;
}

void Ui::drawText(const char *utf8, int x, int baseline) {
  const char *p = utf8;
  int top = baseline - CN_FONT_ASCENT;
  while (*p) {
    uint16_t cp = utf8Next(p);
    const CnGlyph *gl = findGlyph(cp);
    if (!gl) gl = findGlyph('?');
    if (!gl) continue;
    if (x >= 0 && x < W) {
      g_.drawXBMP(x, top, gl->w, gl->h, CN_FONT_BITS + gl->off);
    }
    x += gl->adv;
    if (x >= W) break;
  }
}

void Ui::drawMarquee(const char *utf8, int baseline, uint32_t elapsed) {
  int w = textWidth(utf8);
  if (w <= W - 6) {
    drawText(utf8, (W - w) / 2, baseline);
    return;
  }
  uint32_t travel = (uint32_t)(w + 20);
  uint32_t period = 1200 + travel * 33;  // ~30 px/s, 1.2 s hold at the start
  uint32_t tt = elapsed % period;
  int off = 0;
  if (tt > 1200) off = (int)((tt - 1200) / 33);
  drawText(utf8, 3 - off, baseline);
}

void Ui::drawSpinner(uint32_t t) {
  float phase = (t % 1000) * (2.0f * (float)M_PI) / 1000.0f;
  for (int i = 0; i < 10; i++) {
    if (i > 5 && (i % 2)) continue;
    float a = phase - i * 0.42f;
    int r = (i == 0) ? 2 : 1;
    g_.drawDisc(ICON_CX + (int)lroundf(cosf(a) * 9), ICON_CY + (int)lroundf(sinf(a) * 9), r);
  }
}

void Ui::drawWifi(uint32_t t, bool animated) {
  const int cx = ICON_CX, cy = 24;
  drawArc(g_, cx, cy, 5, -2.53f, -0.61f, 5);
  drawArc(g_, cx, cy, 9, -2.53f, -0.61f, 7);
  drawArc(g_, cx, cy, 13, -2.53f, -0.61f, 9);
  g_.drawDisc(cx, cy - 1, 1);
  if (animated) {
    float a = -2.53f + 1.92f * (0.5f - 0.5f * cosf((t % 1200) * 2 * (float)M_PI / 1200.0f));
    g_.drawDisc(cx + (int)lroundf(cosf(a) * 13), cy + (int)lroundf(sinf(a) * 13), 2);
  }
}

void Ui::drawWifiOff() {
  drawWifi(0, false);
  g_.drawLine(73, 3, 81, 11);
  g_.drawLine(74, 3, 82, 11);
  g_.drawLine(81, 3, 73, 11);
  g_.drawLine(82, 3, 74, 11);
}

void Ui::drawMoon() {
  g_.drawDisc(ICON_CX, ICON_CY, 9);
  g_.setDrawColor(0);
  g_.drawDisc(ICON_CX + 4, ICON_CY - 4, 8);
  g_.setDrawColor(1);
  g_.drawDisc(ICON_CX + 8, ICON_CY, 1);
}

void Ui::drawGear(uint32_t t) {
  float base = (t % 4000) * (2.0f * (float)M_PI) / 4000.0f;
  for (int i = 0; i < 8; i++) {
    float a = base + i * (float)M_PI / 4.0f;
    g_.drawLine(ICON_CX + (int)lroundf(cosf(a) * 6), ICON_CY + (int)lroundf(sinf(a) * 6),
                ICON_CX + (int)lroundf(cosf(a) * 10), ICON_CY + (int)lroundf(sinf(a) * 10));
    g_.drawLine(ICON_CX + 1 + (int)lroundf(cosf(a) * 6), ICON_CY + (int)lroundf(sinf(a) * 6),
                ICON_CX + 1 + (int)lroundf(cosf(a) * 10), ICON_CY + (int)lroundf(sinf(a) * 10));
  }
  g_.drawCircle(ICON_CX, ICON_CY, 6);
  g_.setDrawColor(0);
  g_.drawDisc(ICON_CX, ICON_CY, 2);
  g_.setDrawColor(1);
}

void Ui::drawApproval() {
  g_.drawTriangle(ICON_CX, 2, ICON_CX + 14, 24, ICON_CX - 14, 24);
  g_.drawLine(ICON_CX, 8, ICON_CX, 16);
  g_.drawLine(ICON_CX + 1, 8, ICON_CX + 1, 16);
  g_.drawDisc(ICON_CX, 20, 1);
}

void Ui::drawError() {
  g_.drawCircle(ICON_CX, ICON_CY, 10);
  g_.drawCircle(ICON_CX, ICON_CY, 9);
  for (int d = 0; d < 2; d++) {
    g_.drawLine(ICON_CX - 5 + d, ICON_CY - 5, ICON_CX + 5 + d, ICON_CY + 5);
    g_.drawLine(ICON_CX + 5 + d, ICON_CY - 5, ICON_CX - 5 + d, ICON_CY + 5);
  }
}

void Ui::drawIcon(const char *status, uint32_t t) {
  if (!strcmp(status, "setup")) { drawWifiOff(); return; }
  if (!strcmp(status, "connecting")) { drawWifi(t, true); return; }
  if (!strcmp(status, "offline")) { drawWifiOff(); return; }
  if (!strcmp(status, "auth")) { drawWifiOff(); return; }
  if (!strcmp(status, "approval")) { drawApproval(); return; }
  if (!strcmp(status, "error")) { drawError(); return; }
  if (!strcmp(status, "tool")) { drawGear(t); return; }
  if (!strcmp(status, "thinking") || !strcmp(status, "responding")) { drawSpinner(t); return; }
  drawMoon();
}

void Ui::drawBar(const DshSnapshot &s, uint32_t t) {
  g_.setFont(u8g2_font_5x7_tf);
  char clk[16] = "G8 --:--:--";
  if (s.serverNowMs != 0) {
    uint32_t now = s.serverNowMs + (t - s.recvAtMs);
    uint32_t local = now / 1000 + TZ_OFFSET_MINUTES * 60;
    uint32_t sod = local % 86400;
    snprintf(clk, sizeof clk, "G8 %02u:%02u:%02u", (unsigned)(sod / 3600),
             (unsigned)((sod / 60) % 60), (unsigned)(sod % 60));
  }
  g_.drawStr(2, BAR_BASE, clk);
  int timeEnd = 2 + (int)g_.getStrWidth(clk);

  const char *m = s.model;
  if (!m[0]) m = "dsh";
  if (!strncmp(m, "deepseek-", 9)) m += 9;
  char mdl[28];
  if (s.effort[0]) snprintf(mdl, sizeof mdl, "%s/%s", m, s.effort);
  else snprintf(mdl, sizeof mdl, "%s", m);

  int avail = 126 - (timeEnd + 6);
  char out[28];
  snprintf(out, sizeof out, "%s", mdl);
  while (out[0] && (int)g_.getStrWidth(out) > avail) out[strlen(out) - 1] = 0;
  int w = (int)g_.getStrWidth(out);
  if (w > 0) g_.drawStr(126 - w, BAR_BASE, out);

  // Dotted separator keeps the two fixed corners visually separate.
  for (int x = 0; x < W; x += 3) g_.drawPixel(x, BAR_LINE);
}

void Ui::render(const DshSnapshot &s) {
  uint32_t t = millis();

  const char *st = s.status;
  if (!s.wifiUp || !strcmp(st, "boot")) {
    st = "connecting";
  } else if (!s.serverUp || t - s.lastOkMs > STALE_AFTER_MS) {
    st = (s.httpCode == 401) ? "auth" : "offline";
  }

  if (strcmp(st, lastStatus_)) {
    snprintf(lastStatus_, sizeof lastStatus_, "%s", st);
    statusSince_ = t;
  }

  bool animated = !strcmp(st, "connecting") || !strcmp(st, "thinking") ||
                  !strcmp(st, "responding") || !strcmp(st, "tool");
  uint32_t frame = animated ? 70 : 250;
  uint32_t second = t / 1000;
  if (t - lastDraw_ < frame && second == lastSecond_) return;
  lastDraw_ = t;
  lastSecond_ = second;

  g_.clearBuffer();
  drawIcon(st, t);

  const char *title = titleFor(st);
  int tw = textWidth(title);
  drawText(title, (W - tw) / 2, TITLE_BASE);

  const char *body = s.body;
  if (!body[0]) {
    if (!strcmp(st, "approval")) body = "請在面板允許或拒絕";
    else if (!strcmp(st, "error")) body = "詳見 DSH 面板";
    else if (!strcmp(st, "thinking")) body = "模型正在推理…";
    else if (!strcmp(st, "responding")) body = "正在產生回覆…";
    else if (!strcmp(st, "offline")) body = "無法連線到 DSH 伺服器";
    else if (!strcmp(st, "connecting")) body = "正在連線 WiFi 與伺服器";
    else if (!strcmp(st, "idle")) body = "DSH 已就緒，等待指令";
  }
  if (!body[0]) body = " ";
  drawMarquee(body, BODY_BASE, t - statusSince_);

  drawBar(s, t);

  if (s.wifiUp && s.serverUp) g_.drawDisc(W - 5, 3, 1);
  g_.sendBuffer();
}
