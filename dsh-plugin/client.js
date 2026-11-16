window.__ModuleLoader__.load({
  id: 'dsh-esp32-status',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef } = React

    const PANEL_ID = 'esp32-status'
    const PORTS = [8787, 8788, 8789, 8790, 8791, 8792, 8793, 8794, 8795, 8796]

    const STATUS_COLOR = {
      idle: '#4ade80',
      thinking: '#60a5fa',
      responding: '#60a5fa',
      tool: '#fbbf24',
      approval: '#f59e0b',
      error: '#ef4444',
      setup: '#94a3b8',
      connecting: '#60a5fa',
      offline: '#94a3b8',
      auth: '#ef4444',
    }

    const S = {
      root: {
        padding: '18px 16px 32px',
        boxSizing: 'border-box',
        width: '100%',
        minHeight: '100%',
        overflowY: 'auto',
        color: 'var(--dsh-text-primary, #e8ebf2)',
        fontSize: 13,
        lineHeight: 1.5,
        fontFamily:
          'ui-sans-serif, -apple-system, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif',
      },
      card: {
        background: 'var(--dsh-surface-2, rgba(255,255,255,0.045))',
        border: '1px solid var(--dsh-border, rgba(255,255,255,0.09))',
        borderRadius: 14,
        padding: '14px 14px 12px',
        marginBottom: 12,
      },
      cardHead: {
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: 10,
      },
      cardTitle: { fontSize: 13, fontWeight: 600, letterSpacing: 0.2 },
      hint: { fontSize: 11.5, color: 'var(--dsh-text-secondary, #9aa3b2)', marginTop: 2 },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5 },
      btn: {
        appearance: 'none',
        border: '1px solid var(--dsh-border, rgba(255,255,255,0.16))',
        background: 'var(--dsh-surface-3, rgba(255,255,255,0.07))',
        color: 'inherit',
        borderRadius: 8,
        padding: '5px 10px',
        fontSize: 12,
        cursor: 'pointer',
        font: 'inherit',
        whiteSpace: 'nowrap',
      },
      btnPrimary: { background: '#2563eb', borderColor: '#2563eb', color: '#fff' },
      btnDanger: { background: 'transparent', borderColor: 'rgba(239,68,68,0.55)', color: '#f87171' },
      btnDisabled: { opacity: 0.45, cursor: 'not-allowed' },
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
      deviceRow: {
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 10,
        padding: '9px 0',
        borderTop: '1px solid var(--dsh-border, rgba(255,255,255,0.07))',
      },
      code: {
        margin: '8px 0 0',
        padding: '8px 10px',
        borderRadius: 8,
        background: 'rgba(0,0,0,0.22)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        color: 'var(--dsh-text-secondary, #b9c2d0)',
      },
      progressTrack: {
        height: 6,
        borderRadius: 999,
        background: 'rgba(255,255,255,0.1)',
        overflow: 'hidden',
        margin: '10px 0 4px',
      },
      progressFill: { height: '100%', background: '#3b82f6', transition: 'width 200ms linear' },
      errorBox: {
        border: '1px solid rgba(239,68,68,0.45)',
        background: 'rgba(239,68,68,0.08)',
        borderRadius: 10,
        padding: '9px 11px',
        marginBottom: 12,
        fontSize: 12,
        color: '#fca5a5',
        wordBreak: 'break-word',
      },
      chips: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 },
      chip: {
        borderRadius: 999,
        padding: '2px 9px',
        fontSize: 11,
        background: 'rgba(255,255,255,0.07)',
        color: 'var(--dsh-text-secondary, #aab3c2)',
        border: '1px solid var(--dsh-border, rgba(255,255,255,0.08))',
        whiteSpace: 'nowrap',
      },
      tokenRow: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8 },
      log: {
        margin: '8px 0 0',
        padding: '8px 10px',
        maxHeight: 130,
        overflow: 'auto',
        borderRadius: 8,
        background: 'rgba(0,0,0,0.26)',
        fontSize: 10.5,
        lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        color: 'var(--dsh-text-secondary, #b9c2d0)',
      },
      errors: { maxHeight: 168, overflowY: 'auto', marginTop: 2 },
      footer: {
        display: 'flex',
        justifyContent: 'space-between',
        gap: 8,
        fontSize: 11,
        color: 'var(--dsh-text-secondary, #8f98a8)',
        padding: '4px 2px 0',
      },
    }

    function ensureStyle() {
      const id = 'dsh-esp32-status-style'
      if (typeof document === 'undefined' || document.getElementById(id)) return
      const el = document.createElement('style')
      el.id = id
      el.textContent = `
        @keyframes dsh-esp32-spin { to { transform: rotate(360deg) } }
        .dsh-esp32-spin { animation: dsh-esp32-spin 1.15s linear infinite; transform-origin: 50% 50%; transform-box: fill-box; }
        .dsh-esp32-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .dsh-esp32-scroll::-webkit-scrollbar-thumb { background: rgba(128,140,160,0.35); border-radius: 8px; }
      `
      document.head.appendChild(el)
    }

    const btn = (label, onClick, options = {}) =>
      h(
        'button',
        {
          type: 'button',
          onClick,
          disabled: options.disabled,
          title: options.title,
          style: {
            ...S.btn,
            ...(options.primary ? S.btnPrimary : null),
            ...(options.danger ? S.btnDanger : null),
            ...(options.disabled ? S.btnDisabled : null),
          },
        },
        label,
      )

    function Glyph({ status, size = 20 }) {
      const color = STATUS_COLOR[status] || '#94a3b8'
      const svg = {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: color,
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        style: { flex: '0 0 auto' },
      }
      if (status === 'error' || status === 'auth') {
        return h(
          'svg',
          svg,
          h('circle', { cx: 12, cy: 12, r: 9 }),
          h('path', { d: 'M9 9l6 6M15 9l-6 6' }),
        )
      }
      if (status === 'approval') {
        return h(
          'svg',
          svg,
          h('path', { d: 'M12 3.5l8.5 16.5H3.5z' }),
          h('path', { d: 'M12 9.5v4.5' }),
          h('circle', { cx: 12, cy: 17, r: 0.9, fill: color, stroke: 'none' }),
        )
      }
      if (status === 'thinking' || status === 'responding' || status === 'tool') {
        return h(
          'svg',
          svg,
          h(
            'g',
            { className: 'dsh-esp32-spin' },
            h('path', { d: 'M12 3a9 9 0 1 1-7.8 4.5', strokeLinecap: 'round' }),
            h('path', { d: 'M12 6.5v6l4 2' }),
          ),
        )
      }
      if (status === 'offline' || status === 'setup' || status === 'connecting') {
        return h(
          'svg',
          svg,
          h('path', { d: 'M3 9a14 14 0 0 1 18 0M6.5 12.5a9 9 0 0 1 11 0M10 16a4 4 0 0 1 4 0' }),
          h('circle', { cx: 12, cy: 19, r: 1, fill: color, stroke: 'none' }),
          status === 'offline' || status === 'setup'
            ? h('path', { d: 'M4 4l16 16' })
            : null,
        )
      }
      return h(
        'svg',
        svg,
        h('path', { d: 'M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a6.8 6.8 0 0 0 10.7 10.7z' }),
      )
    }

    async function fetchJson(apiBase, path, init) {
      const url = apiBase ? `${apiBase}${path}` : path
      const res = await fetch(url, init)
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) throw new Error(data?.error || `HTTP ${res.status}`)
      return data
    }

    function timedFetch(url, ms = 900) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), ms)
      return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer))
    }

    async function resolveApi() {
      // Same-origin route through the DSH web server first (no CORS/CSP issues).
      try {
        const res = await timedFetch('/api/esp32-status/snapshot')
        if (res.ok) {
          const data = await res.json()
          if (data?.ok) return ''
        }
      } catch {
        /* fall through to the LAN bridge */
      }
      for (const port of PORTS) {
        const base = `http://127.0.0.1:${port}`
        try {
          const res = await timedFetch(`${base}/health`)
          if (!res.ok) continue
          const data = await res.json()
          if (data?.name === 'dsh-esp32-status') return base
        } catch {
          /* try next port */
        }
      }
      return null
    }

    const fmtTime = (ts) => {
      try {
        return new Date(ts).toLocaleTimeString('zh-TW', { hour12: false })
      } catch {
        return '--:--:--'
      }
    }

    const ago = (ts, now) => {
      const seconds = Math.max(0, Math.round(((now || Date.now()) - ts) / 1000))
      if (seconds < 5) return '剛剛'
      if (seconds < 60) return `${seconds} 秒前`
      if (seconds < 3600) return `${Math.round(seconds / 60)} 分鐘前`
      return `${Math.round(seconds / 3600)} 小時前`
    }

    function Section({ title, hint, action, children }) {
      return h(
        'section',
        { style: S.card },
        h(
          'div',
          { style: S.cardHead },
          h('div', null, h('div', { style: S.cardTitle }, title), hint ? h('div', { style: S.hint }, hint) : null),
          action || null,
        ),
        children,
      )
    }

    function Pill({ status, label }) {
      const color = STATUS_COLOR[status] || '#94a3b8'
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 10px',
            borderRadius: 999,
            background: `${color}1f`,
            color,
            border: `1px solid ${color}55`,
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          },
        },
        h('span', { style: { width: 7, height: 7, borderRadius: 999, background: color } }),
        label || status,
      )
    }

    function SidebarIcon({ size = 20, active }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          style: { opacity: active ? 1 : 0.72 },
        },
        h('rect', { x: 3, y: 5, width: 18, height: 12, rx: 2 }),
        h('path', { d: 'M8 17v2.5h8V17' }),
        h('path', { d: 'M7 9h4M7 12h10M7 15h7' }),
      )
    }

    function Panel() {
      const [snap, setSnap] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState('')
      const [showToken, setShowToken] = useState(false)
      const [confirmPort, setConfirmPort] = useState('')
      const [preserve, setPreserve] = useState(true)
      const [confirmReset, setConfirmReset] = useState(false)
      const [copied, setCopied] = useState('')
      const [lastSync, setLastSync] = useState(0)
      const apiRef = useRef(undefined)
      const failuresRef = useRef(0)

      useEffect(() => {
        ensureStyle()
        let stopped = false
        let timer = null

        const tick = async () => {
          if (apiRef.current === undefined) {
            apiRef.current = await resolveApi()
          }
          if (stopped) return
          if (apiRef.current === null) {
            setError('找不到插件橋接：確認 dsh-esp32-status 已啟用，或稍候重試。')
            return
          }
          try {
            const data = await fetchJson(apiRef.current, '/api/esp32-status/snapshot')
            if (stopped) return
            setSnap(data)
            setError(data?.bridge && data.bridge.running === false ? 'LAN 橋接未啟動，ESP32 目前無法連線。' : '')
            setLastSync(Date.now())
            failuresRef.current = 0
          } catch (err) {
            if (stopped) return
            failuresRef.current += 1
            setError(`無法連線到插件橋接：${err?.message ?? err}`)
            if (failuresRef.current >= 3) {
              apiRef.current = undefined
              failuresRef.current = 0
            }
          }
        }

        tick()
        timer = setInterval(tick, 1000)
        return () => {
          stopped = true
          clearInterval(timer)
        }
      }, [])

      const act = async (action, extra = {}) => {
        const api = apiRef.current
        if (api === undefined || api === null) return
        setBusy(action)
        try {
          const data = await fetchJson(api, '/api/esp32-status/action', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action, ...extra }),
          })
          if (data?.snapshot) {
            setSnap(data.snapshot)
            setLastSync(Date.now())
          }
          setError('')
        } catch (err) {
          setError(`動作失敗：${err?.message ?? err}`)
        } finally {
          setBusy('')
        }
      }

      const copyText = async (text, key) => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(key)
          setTimeout(() => setCopied(''), 1400)
        } catch {
          setError('剪貼簿不可用，請手動選取複製。')
        }
      }

      const state = snap?.state
      const flash = snap?.flash
      const devices = snap?.devices ?? []
      const bridge = snap?.bridge
      const token = bridge?.token ?? ''
      const exampleIp = bridge?.urls?.[0]?.address ?? '<LAN-IP>'
      const now = snap?.now ?? Date.now()

      const header = h(
        'header',
        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 } },
        h(
          'div',
          null,
          h('div', { style: { fontSize: 15, fontWeight: 700, letterSpacing: 0.2 } }, 'ESP32 狀態面板'),
          h(
            'div',
            { style: S.hint },
            bridge
              ? `LAN 橋接 ${bridge.running ? '運行中' : '未啟動'} · 埠 ${bridge.port}`
              : '正在連線插件…',
          ),
        ),
        state ? h(Pill, { status: state.status, label: state.label }) : null,
      )

      const hero = state
        ? h(
            'section',
            {
              style: {
                ...S.card,
                display: 'flex',
                gap: 14,
                alignItems: 'center',
                background: `linear-gradient(135deg, ${STATUS_COLOR[state.status] || '#64748b'}14, transparent 65%)`,
              },
            },
            h('div', { style: { width: 54, height: 54, display: 'grid', placeItems: 'center', borderRadius: 14, background: 'rgba(0,0,0,0.18)' } }, h(Glyph, { status: state.status, size: 34 })),
            h(
              'div',
              { style: { minWidth: 0, flex: 1 } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                h('div', { style: { fontSize: 18, fontWeight: 700 } }, state.label),
                state.running ? h('span', { style: { ...S.chip, color: '#93c5fd' } }, 'DSH 執行中') : null,
              ),
              h('div', { style: { marginTop: 3, fontSize: 12.5, color: 'var(--dsh-text-secondary, #aeb7c6)', wordBreak: 'break-word' } }, state.body || '—'),
              h(
                'div',
                { style: S.chips },
                h('span', { style: S.chip }, `模型 ${state.model?.model || '—'}${state.model?.effort ? ` / ${state.model.effort}` : ''}`),
                h('span', { style: S.chip }, `工作階段 ${state.sessions ?? 0}`),
                h('span', { style: S.chip }, `序號 ${state.seq ?? 0}`),
                state.detail ? h('span', { style: S.chip }, state.detail) : null,
              ),
            ),
          )
        : null

      const devicesSection = h(
        Section,
        {
          title: '已連接的裝置',
          hint: devices.length ? `${devices.filter((d) => d.online).length}/${devices.length} 台上線` : '尚無 ESP32 回報',
        },
        devices.length === 0
          ? h(
              'div',
              { style: S.hint },
              '燒錄後把 OLED 接上 Wi-Fi，裝置會自動向此面板註冊。首次連線使用 PAIR-ME，面板會配發一組專屬 token。',
            )
          : h(
              'div',
              null,
              devices.map((device) =>
                h(
                  'div',
                  { key: device.id, style: S.deviceRow },
                  h(
                    'div',
                    { style: { minWidth: 0 } },
                    h(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' } },
                      h('span', {
                        style: {
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          background: device.online ? '#4ade80' : '#64748b',
                          boxShadow: device.online ? '0 0 8px #4ade80' : 'none',
                        },
                      }),
                      h('span', { style: { fontWeight: 600 } }, device.name || device.id),
                      h('span', { style: S.chip }, device.ip || '—'),
                    ),
                    h(
                      'div',
                      { style: { ...S.hint, ...S.mono, marginTop: 3 } },
                      `${device.id} · fw ${device.fw || '—'} · ${device.rssi || 0} dBm · ${ago(device.lastSeen, now)}`,
                    ),
                  ),
                  h(
                    'div',
                    { style: { textAlign: 'right', flex: '0 0 auto' } },
                    h('div', { style: { fontSize: 11.5, color: device.online ? '#4ade80' : '#94a3b8' } }, device.online ? '線上' : '離線'),
                    device.pairedAt ? h('div', { style: S.hint }, '已配對') : null,
                  ),
                ),
              ),
            ),
      )

      const bridgeSection = bridge
        ? h(
            Section,
            {
              title: '橋接與 token',
              hint: 'ESP32 的目標位址；token 只存本機',
              action: btn(copied === 'token' ? '已複製' : '複製 token', () => copyText(token, 'token')),
            },
            h(
              'div',
              { style: { fontSize: 12 } },
              bridge.urls?.length
                ? bridge.urls.map((item) =>
                    h(
                      'div',
                      { key: item.address, style: { ...S.mono, marginBottom: 2 } },
                      `${item.url}  ·  ${item.iface}`,
                    ),
                  )
                : h('div', { style: S.hint }, '沒有偵測到 LAN IP：Mac 可能沒連上 Wi-Fi。'),
            ),
            h(
              'div',
              { style: S.tokenRow },
              h(
                'code',
                { style: { ...S.code, margin: 0, flex: '1 1 200px', minWidth: 0 } },
                showToken ? token : `${token.slice(0, 6)}${'•'.repeat(12)}`,
              ),
              btn(showToken ? '隱藏' : '顯示', () => setShowToken((value) => !value)),
              confirmReset
                ? btn('確定重設', () => {
                    setConfirmReset(false)
                    act('reset-token')
                  }, { danger: true, disabled: busy !== '' })
                : btn('重設', () => setConfirmReset(true), { danger: true }),
              confirmReset ? btn('取消', () => setConfirmReset(false)) : null,
            ),
            h('div', { style: S.hint }, '序列埠設定（USB）：'),
            h('pre', { style: S.code }, `server ${exampleIp} ${bridge.port} ${showToken ? token : '<token>'}\nwifi <SSID> <PASSWORD>`),
            h(
              'div',
              { style: S.hint },
              bridge.pairingEnabled
                ? 'PAIR-ME 仍可用於首次配對；配對後板子會記住這組 token。'
                : '配對已關閉：新板子必須先寫入 token。',
            ),
          )
        : null

      const flashSection = flash
        ? h(
            Section,
            {
              title: '有線 ESP32 · 偵測與燒錄',
              hint: `韌體 ${flash.firmware?.version ?? '—'}${flash.firmware?.bytes ? ` · ${Math.round(flash.firmware.bytes / 1024)} KB` : ''}`,
              action: btn('重新掃描', () => act('scan'), { disabled: flash.running || busy !== '' }),
            },
            flash.toolError
              ? h('pre', { style: { ...S.code, color: '#fca5a5' } }, flash.toolError)
              : flash.tool
                ? h('div', { style: { ...S.hint, ...S.mono } }, `esptool: ${flash.tool}`)
                : h('div', { style: S.hint }, '尚未偵測 esptool。'),
            flash.ports?.length
              ? h(
                  'div',
                  null,
                  flash.ports.map((port) =>
                    h(
                      'div',
                      { key: port.path, style: S.deviceRow },
                      h(
                        'div',
                        { style: { minWidth: 0 } },
                        h('div', { style: { ...S.mono, fontWeight: 600 } }, port.path),
                        h(
                          'div',
                          { style: S.hint },
                          [
                            port.label,
                            port.probe?.chip,
                            port.probe?.mac,
                            port.probe ? (port.probe.ok ? '可燒錄' : '偵測失敗') : null,
                          ]
                            .filter(Boolean)
                            .join(' · '),
                        ),
                      ),
                      confirmPort === port.path
                        ? h(
                            'div',
                            { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' } },
                            h(
                              'label',
                              { style: { ...S.hint, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' } },
                              h('input', {
                                type: 'checkbox',
                                checked: preserve,
                                onChange: (e) => setPreserve(e.target.checked),
                              }),
                              preserve ? '只更新程式（保留 Wi-Fi 設定）' : '完整映像（會清除 Wi-Fi 設定）',
                            ),
                            btn('確認燒錄', () => {
                              setConfirmPort('')
                              act('flash', { port: port.path, appOnly: preserve })
                            }, { primary: true }),
                            btn('取消', () => setConfirmPort('')),
                          )
                        : h(
                            'div',
                            { style: { display: 'flex', gap: 6 } },
                            btn('偵測', () => act('probe', { port: port.path }), {
                              disabled: flash.running || busy !== '',
                            }),
                            btn('燒錄', () => setConfirmPort(port.path), {
                              primary: true,
                              disabled: flash.running || busy !== '',
                            }),
                          ),
                    ),
                  ),
                )
              : h('div', { style: S.hint }, '沒有找到序列埠。插上 USB 線後按「重新掃描」。'),
            flash.running
              ? h(
                  'div',
                  null,
                  h('div', { style: S.progressTrack }, h('div', { style: { ...S.progressFill, width: `${flash.progress || 0}%` } })),
                  h(
                    'div',
                    { style: S.row },
                    h('div', { style: S.hint }, `${flash.action === 'probe' ? '偵測中' : '燒錄中'} · ${flash.port} · ${flash.progress || 0}%`),
                    btn('中止', () => act('stop-flash'), { danger: true }),
                  ),
                )
              : null,
            flash.log?.length ? h('pre', { style: S.log, className: 'dsh-esp32-scroll' }, flash.log.join('\n')) : null,
          )
        : null

      const errorsSection =
        state && (state.errors?.length || state.error)
          ? h(
              Section,
              { title: '最近的錯誤', hint: `${state.errors?.length ?? 0} 筆` },
              h(
                'div',
                { style: S.errors, className: 'dsh-esp32-scroll' },
                state.error
                  ? h(
                      'div',
                      { style: { padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' } },
                      h('div', { style: { fontSize: 12.5, color: '#fca5a5', wordBreak: 'break-word' } }, state.error.message),
                      h('div', { style: S.hint }, `${state.error.code ? `${state.error.code} · ` : ''}${fmtTime(state.error.at)}`),
                    )
                  : null,
                (state.errors || []).map((item, index) =>
                  h(
                    'div',
                    { key: `${item.at}-${index}`, style: { padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' } },
                    h('div', { style: { fontSize: 12.5, color: '#e2e8f0', wordBreak: 'break-word' } }, item.message),
                    h('div', { style: S.hint }, `${item.code ? `${item.code} · ` : ''}${fmtTime(item.at)}`),
                  ),
                ),
              ),
              btn('清除錯誤標記', () => act('clear-error'), { disabled: busy !== '' }),
            )
          : null

      const footer = h(
        'footer',
        { style: S.footer },
        h('span', null, `dsh-esp32-status v${snap?.version ?? '—'}`),
        h('span', null, lastSync ? `更新 ${fmtTime(lastSync)}` : '等待資料'),
      )

      return h(
        'div',
        { style: S.root, className: 'dsh-esp32-scroll' },
        header,
        error ? h('div', { style: S.errorBox }, error) : null,
        !snap && !error ? h('div', { style: S.hint }, '正在載入狀態…') : null,
        hero,
        devicesSection,
        bridgeSection,
        flashSection,
        errorsSection,
        footer,
      )
    }

    function apply(ctx) {
      ensureStyle()
      const slots = ctx?.slots || ctx?.get?.('slots')
      if (!slots) return

      return ctx.slots.inject('main', () =>
        slots.inject('sidebar.panellist', () => {
          const stopMain = slots.register(
            { name: 'main', key: PANEL_ID, inject: () => ({}) },
            Panel,
          )
          const stopIcon = slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 40,
              label: () => 'ESP32',
            },
            SidebarIcon,
          )
          return () => {
            stopIcon()
            stopMain()
          }
        }),
      )
    }

    return { inject: ['slots'], apply }
  },
})
