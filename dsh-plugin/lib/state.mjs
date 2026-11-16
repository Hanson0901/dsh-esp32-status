import os from 'node:os'

export const STATUS_LABEL = {
  idle: '待命中',
  thinking: '思考中',
  responding: '回覆中',
  tool: '執行工具',
  approval: '需要授權',
  error: '錯誤',
}

const safe = (fn, fallback = undefined) => {
  try {
    return fn()
  } catch {
    return fallback
  }
}

/** Keep only printable ASCII so the 12 px OLED font can always render it. */
export function asciiText(value, max = 90) {
  const text = String(value ?? '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max - 3)}...` : text
}

function describeError(error) {
  if (!error) return { message: 'Unknown error', code: '' }
  if (typeof error === 'string') return { message: error, code: '' }
  const inner = error.error ?? error.cause ?? error
  const message =
    (typeof error.message === 'string' && error.message) ||
    (typeof inner?.message === 'string' && inner.message) ||
    safe(() => JSON.stringify(error)) ||
    String(error)
  const code = String(error.code ?? inner?.code ?? error.status ?? inner?.status ?? '')
  return { message, code: code === 'undefined' ? '' : code }
}

/**
 * Listens to the host's agent events and derives one compact status for the
 * OLED and the sidebar panel. Nothing here mutates DSH state.
 */
export class Tracker {
  constructor(ctx) {
    this.ctx = ctx
    this.agents = new Map()
    this.streams = new Map()
    this.approvals = new Map()
    this.errors = []
    this.lastError = null
    this.errorActive = false
    this.lastTool = ''
    this.seq = 0
    this.startedAt = Date.now()
    this._off = []
    this._status = 'idle'
    this._statusSince = Date.now()
  }

  start() {
    const listen = (event, fn) => {
      const off = safe(() => this.ctx.on(event, fn))
      if (typeof off === 'function') this._off.push(off)
    }

    listen('agent/status', (payload) => {
      const id = payload?.agent?.id
      if (!id) return
      const status = payload.status === 'running' ? 'running' : 'idle'
      this.agents.set(id, { status, since: Date.now() })
      if (status === 'running') {
        // A fresh turn supersedes the previous error banner.
        this.errorActive = false
      } else {
        this.streams.delete(id)
      }
      this.seq++
    })

    listen('agent/assistant-stream', (payload) => {
      const id = payload?.agent?.id
      const frame = payload?.frame
      if (!id || !frame) return
      if (frame.type === 'start') {
        this.streams.set(id, { kind: 'thinking', since: Date.now() })
      } else if (frame.type === 'chunk') {
        const current = this.streams.get(id) ?? { kind: 'thinking', since: Date.now() }
        const type = frame.chunk?.type
        if (type === 'reasoning-delta') current.kind = 'thinking'
        else if (type === 'text-delta') current.kind = 'responding'
        else if (type === 'tool-call-delta') {
          current.kind = 'tool'
          const name = frame.chunk?.name ?? frame.chunk?.toolName
          if (typeof name === 'string' && name) this.lastTool = name
        }
        this.streams.set(id, current)
      } else if (frame.type === 'end') {
        this.streams.delete(id)
      }
      this.seq++
    })

    listen('agent/error', (payload) => {
      const info = describeError(payload?.error)
      this.lastError = { ...info, at: Date.now(), agentId: payload?.agent?.id ?? '' }
      this.errors.unshift(this.lastError)
      this.errors.splice(8)
      this.errorActive = true
      this.seq++
    })

    listen('approval/request', async (req, next) => {
      const id = req?.callId || `${req?.agent?.id ?? 'agent'}:${Date.now()}:${Math.random()}`
      const reason =
        req?.displayReason?.['zh-Hant'] ??
        req?.displayReason?.zh ??
        req?.displayReason?.en ??
        req?.reason ??
        ''
      this.approvals.set(id, {
        id,
        agentId: req?.agent?.id ?? '',
        toolName: req?.toolName ?? 'tool',
        reason: String(reason),
        since: Date.now(),
      })
      this.seq++
      try {
        return await next()
      } finally {
        this.approvals.delete(id)
        this.seq++
      }
    })
  }

  stop() {
    for (const off of this._off.splice(0)) safe(off)
  }

  anyRunning() {
    for (const value of this.agents.values()) {
      if (value.status === 'running') return true
    }
    return false
  }

  status() {
    let status
    if (this.approvals.size > 0) status = 'approval'
    else if (this.errorActive && this.lastError) status = 'error'
    else if (this.anyRunning()) {
      const kinds = [...this.streams.values()].map((s) => s.kind)
      if (kinds.includes('tool')) status = 'tool'
      else if (kinds.includes('responding')) status = 'responding'
      else status = 'thinking'
    } else status = 'idle'

    if (status !== this._status) {
      this._status = status
      this._statusSince = Date.now()
    }
    return status
  }

  sinceSeconds() {
    return Math.max(0, Math.round((Date.now() - this._statusSince) / 1000))
  }

  /** Compact body line for the OLED (CJK labels + ASCII payloads only). */
  body() {
    const status = this.status()
    if (status === 'approval') {
      const approval = [...this.approvals.values()].at(-1)
      const tool = asciiText(approval?.toolName ?? '', 20)
      return tool ? `${tool} 等待確認` : '等待你的確認'
    }
    if (status === 'error') {
      const message = asciiText(this.lastError?.message ?? '', 70)
      const code = this.lastError?.code ? ` [${asciiText(this.lastError.code, 12)}]` : ''
      return message ? `${message}${code}` : '請看 DSH 面板'
    }
    if (status === 'tool') {
      const tool = asciiText(this.lastTool, 24)
      return tool ? `執行 ${tool}` : '執行工具'
    }
    if (status === 'thinking') return `已推理 ${this.sinceSeconds()} 秒`
    if (status === 'responding') return `已產生 ${this.sinceSeconds()} 秒`
    return 'DSH 已就緒，等待指令'
  }

  detail() {
    const status = this.status()
    if (status === 'tool') return this.lastTool
    if (status === 'approval') return [...this.approvals.values()].at(-1)?.toolName ?? ''
    if (status === 'error') return this.lastError?.code ?? ''
    return ''
  }

  model() {
    const selection = safe(() => this.ctx.get?.('agentDefaultModel')?.currentSelection?.()
      ?? this.ctx.agentDefaultModel?.currentSelection?.())
    let provider = selection?.provider ?? ''
    let model = selection?.model ?? ''
    let effort = selection?.reasoningEffort ?? ''

    for (const [id, agent] of this.agents) {
      if (agent.status !== 'running') continue
      const session = safe(() => (this.ctx.get?.('sessions') ?? this.ctx.sessions)?.get?.(id))
      const config = safe(() => session?.requestHeader?.()?.config)
      if (config) {
        provider = config.provider ?? provider
        model = config.model ?? model
        effort = config.reasoningEffort ?? effort
      }
    }
    return { provider, model, effort }
  }

  sessionCount() {
    return safe(() => (this.ctx.get?.('sessions') ?? this.ctx.sessions)?.list?.().length, 0) ?? 0
  }

  clearError() {
    this.errorActive = false
    this.lastError = null
  }

  snapshot() {
    return {
      status: this.status(),
      label: STATUS_LABEL[this.status()] ?? this.status(),
      body: this.body(),
      detail: this.detail(),
      seq: this.seq,
      running: this.anyRunning(),
      approvals: [...this.approvals.values()],
      error: this.lastError,
      errors: this.errors,
      model: this.model(),
      sessions: this.sessionCount(),
      uptimeMs: Date.now() - this.startedAt,
    }
  }
}

export function lanAddresses() {
  const out = []
  const ifaces = safe(() => os.networkInterfaces(), {}) ?? {}
  const preferred = ['en0', 'en1', 'eth0', 'wlan0']
  const names = Object.keys(ifaces).sort((a, b) => {
    const ai = preferred.indexOf(a)
    const bi = preferred.indexOf(b)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })
  for (const name of names) {
    for (const info of ifaces[name] ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue
      out.push({ iface: name, address: info.address })
    }
  }
  return out
}
