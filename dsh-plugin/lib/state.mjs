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


/** Human duration: 59秒 -> 1分05秒 -> 1時05分. */
export function formatDuration(total) {
  const seconds = Math.max(0, Math.round(total))
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return `${minutes}分${String(rest).padStart(2, '0')}秒`
  const hours = Math.floor(minutes / 60)
  return `${hours}時${String(minutes % 60).padStart(2, '0')}分`
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
      this.agents.set(id, { status, since: Date.now(), workspace: this.workspaceOf(id) })
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
        const agent = this.agents.get(id) ?? { status: 'running', since: Date.now() }
        agent.workspace ||= this.workspaceOf(id)
        this.agents.set(id, agent)
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


  /**
   * Approval requests are logged to the requesting session as
   * `approval/asked` / `approval/decided`. Reading the session log is
   * reliable even when the agent-scoped waterfall never reaches a
   * root-level listener.
   */
  pendingApprovals() {
    if (this._approvalScan && Date.now() - this._approvalScanAt < 400) return this._approvalScan
    const pending = []
    const sessions = safe(() => this.store()?.list?.()) ?? []
    for (const session of sessions) {
      const events = safe(() => session.ownEvents?.()) ?? []
      const from = Math.max(0, events.length - 60)
      for (let i = from; i < events.length; i++) {
        const ev = events[i]
        if (!ev) continue
        if (ev.type === 'approval/asked') {
          pending.push({
            id: ev.data?.id ?? `${session.id}:${i}`,
            agentId: String(session.id ?? ''),
            toolName: ev.data?.toolName ?? 'tool',
            tool: ev.data?.toolName ?? 'tool',
            callId: ev.data?.callId,
            reason: ev.data?.reason ?? '',
            since: ev.time ?? Date.now(),
          })
        } else if (ev.type === 'approval/decided') {
          const idx = pending.findIndex((item) => item.id === ev.data?.id)
          if (idx >= 0) pending.splice(idx, 1)
        }
      }
    }
    this._approvalScan = pending
    this._approvalScanAt = Date.now()
    return pending
  }

  sessionActivity() {
    if (this._activity && Date.now() - this._activityAt < 300) return this._activity
    const sessions = safe(() => this.store()?.list?.()) ?? []
    let best = null
    for (const session of sessions) {
      const id = String(session.id ?? '')
      const seq = Number(safe(() => session.seq, 0))
      let cached = this._actCache?.get(id)
      if (!cached) {
        cached = new Map()
        if (!this._actCache) this._actCache = new Map()
        this._actCache.set(id, cached)
      }
      let item = cached.get(seq)
      if (!item) {
        const events = safe(() => session.ownEvents?.()) ?? []
        let turnStart = 0
        let last = null
        const from = Math.max(0, events.length - 30)
        for (let i = from; i < events.length; i++) {
          const ev = events[i]
          if (!ev || typeof ev.type !== 'string') continue
          if (ev.type === 'turn/start') turnStart = ev.time ?? 0
          if (ev.type.startsWith('session-log-') || ev.type.startsWith('job/') || ev.type.startsWith('subagent/')) continue
          last = ev
        }
        item = { last, turnStart }
        cached.set(seq, item)
        if (cached.size > 8) cached.delete(cached.keys().next().value)
      }
      if (item.last && (!best || (item.last.time ?? 0) > (best.last.time ?? 0))) best = item
    }
    let kind = 'idle'
    let tool = ''
    let error = null
    let active = false
    let since = 0
    if (best) {
      const ev = best.last
      const age = Date.now() - (ev.time ?? 0)
      if (ev.type === 'turn/end') {
        const reason = ev.data?.reason
        if (reason?.kind === 'error') error = describeError(reason.error)
      } else if (age < 10 * 60 * 1000) {
        active = true
        since = Math.max(0, Math.round((Date.now() - (best.turnStart || ev.time || Date.now())) / 1000))
        if (ev.type === 'tool/call') {
          kind = 'tool'
          tool = asciiText(ev.data?.name ?? ev.data?.toolName ?? '', 24)
        } else if (ev.type === 'assistant/message' || ev.type === 'tool/result') {
          kind = 'responding'
        } else {
          kind = 'thinking'
        }
      }
    }
    this._activity = { active, kind, tool, error, since, lastType: best?.last?.type, age: best ? Date.now() - (best.last.time ?? 0) : null }
    this._activityAt = Date.now()
    return this._activity
  }

  store() {
    if (this._storeCache && Date.now() - this._storeCacheAt < 1000) return this._storeCache
    const candidates = [
      safe(() => this.ctx.sessions),
      safe(() => this.ctx.get?.('sessions')),
      safe(() => this.ctx.root?.sessions),
    ].filter(Boolean)
    let best = candidates[0] ?? null
    let bestCount = -1
    for (const candidate of candidates) {
      const list = safe(() => candidate?.list?.())
      const count = Array.isArray(list) ? list.length : -1
      if (count > bestCount) {
        best = candidate
        bestCount = count
      }
    }
    this._storeCache = best
    this._storeCacheAt = Date.now()
    return best
  }

  /** Folder name of the session's working directory, for the OLED top-left. */
  workspaceOf(id) {
    if (!this._ws) this._ws = new Map()
    const key = String(id ?? '')
    if (!key) return ''
    if (this._ws.has(key)) return this._ws.get(key)
    const session = safe(() => this.store()?.get?.(key))
    const cwd = String(safe(() => session?.header?.cwd, '') ?? '')
    const name = cwd.split('/').filter(Boolean).pop() ?? ''
    const clean = asciiText(name, 18)
    this._ws.set(key, clean)
    return clean
  }

  activeAgents() {
    const list = []
    for (const [id, agent] of this.agents) {
      if (agent.status !== 'running') continue
      const stream = this.streams.get(id)
      list.push({
        id,
        workspace: agent.workspace || this.workspaceOf(id),
        kind: stream?.kind ?? 'thinking',
        since: stream?.since ?? agent.since ?? Date.now(),
      })
    }
    return list.sort((a, b) => a.since - b.since)
  }

  /** One agent to show; approvals always win and never rotate. */
  pick() {
    if (this._picked && Date.now() - this._pickedAt < 250) return this._picked
    const approvals = this.pendingApprovals().length ? this.pendingApprovals() : [...this.approvals.values()]
    let picked = null
    if (approvals.length) {
      const approval = approvals.at(-1)
      picked = {
        mode: 'approval',
        id: approval.agentId,
        workspace: this.workspaceOf(approval.agentId),
        kind: 'approval',
        approval,
      }
    } else {
      const active = this.activeAgents()
      if (active.length) {
        // Switch workspaces about every 10 seconds, not on every poll.
        if (!this._rotateAt || Date.now() - this._rotateAt >= 10000) {
          this._rotation = ((this._rotation ?? 0) + 1) % 100000
          this._rotateAt = Date.now()
        }
        picked = { mode: 'active', ...active[this._rotation % active.length] }
      }
    }
    this._picked = picked
    this._pickedAt = Date.now()
    return picked
  }

  status() {
    let status
    const picked = this.pick()
    if (picked?.mode === 'approval') status = 'approval'
    else if (this.errorActive && this.lastError) status = 'error'
    else if (this.sessionActivity().error) status = 'error'
    else if (picked) status = picked.kind
    else status = 'idle'

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
      const picked = this.pick()
      const tool = asciiText(picked?.approval?.toolName ?? '', 20)
      return tool ? `${tool} 等待確認` : '等待你的確認'
    }
    if (status === 'error') {
      const err = this.lastError ?? this.sessionActivity().error
      const message = asciiText(err?.message ?? '', 70)
      const code = err?.code ? ` [${asciiText(err.code, 12)}]` : ''
      return message ? `${message}${code}` : '請看 DSH 面板'
    }
    if (status === 'tool') {
      const tool = asciiText(this.lastTool || this.pick()?.tool || '', 24)
      return tool ? `執行 ${tool}` : '執行工具'
    }
    if (status === 'thinking') {
      const seconds = this.pick()?.since ? (Date.now() - this.pick().since) / 1000 : this.sinceSeconds()
      return `已推理 ${formatDuration(seconds)}`
    }
    if (status === 'responding') {
      const seconds = this.pick()?.since ? (Date.now() - this.pick().since) / 1000 : this.sinceSeconds()
      return `已產生 ${formatDuration(seconds)}`
    }
    return 'DSH 已就緒，等待指令'
  }

  detail() {
    const status = this.status()
    if (status === 'approval') return this.pick()?.workspace ?? ''
    if (status === 'tool') return this.lastTool
    if (status === 'error') return this.lastError?.code ?? ''
    return ''
  }

  workspace() {
    return this.pick()?.workspace ?? ''
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
    return safe(() => this.store()?.list?.().length, 0) ?? 0
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
      running: this.sessionActivity().active || this.anyRunning(),
      approvals: this.pendingApprovals().length ? this.pendingApprovals() : [...this.approvals.values()],
      error: this.lastError,
      errors: this.errors,
      model: this.model(),
      sessions: this.sessionCount(),
      uptimeMs: Date.now() - this.startedAt,
      activity: this.sessionActivity(),
      workspace: this.workspace(),
      agents: this.activeAgents(),
      rotation: this._rotation ?? 0,
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
