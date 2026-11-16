import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { lanAddresses } from './state.mjs'

const PAIRING_TOKENS = new Set(['PAIR-ME', 'REPLACE_WITH_PANEL_TOKEN'])
const DEVICE_STALE_MS = 15000
const DEVICE_FORGET_MS = 10 * 60 * 1000
const MAX_BODY = 8192

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const PANEL_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/

const strip = (address = '') => address.replace(/^::ffff:/, '')

function json(res, code, body) {
  const text = JSON.stringify(body)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

function applyCors(req, res) {
  const origin = req.headers.origin
  if (typeof origin === 'string' && PANEL_ORIGIN.test(origin)) {
    res.setHeader('access-control-allow-origin', origin)
    res.setHeader('vary', 'Origin')
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    res.setHeader('access-control-allow-headers', 'content-type')
    res.setHeader('access-control-max-age', '600')
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function equalToken(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '0.0.0.0')
  })
}

/**
 * LAN bridge: the ESP32 posts here, and the DSH sidebar panel talks to the
 * same server from loopback. Panel routes are loopback-only; device routes
 * require the pairing token.
 */
export class Bridge {
  constructor({ tracker, flasher, config = {}, log = () => {} }) {
    this.tracker = tracker
    this.flasher = flasher
    this.config = config
    this.log = log
    this.devices = new Map()
    this.server = null
    this.port = Number(config.port) || 8787
    this.pairingEnabled = config.allowPairing !== false
    this.version = this.readVersion()

    const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
    this.tokenFile = path.join(home, 'esp32-status', 'token.json')
    this.token = this.loadToken()
  }

  readVersion() {
    try {
      const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
      return pkg.version ?? '0.0.0'
    } catch {
      return '0.0.0'
    }
  }

  loadToken() {
    try {
      const saved = JSON.parse(readFileSync(this.tokenFile, 'utf8'))
      if (typeof saved.token === 'string' && saved.token.length >= 8) return saved.token
    } catch {
      /* first run */
    }
    const token = randomBytes(16).toString('hex')
    this.saveToken(token)
    return token
  }

  saveToken(token = this.token) {
    try {
      mkdirSync(path.dirname(this.tokenFile), { recursive: true })
      writeFileSync(this.tokenFile, `${JSON.stringify({ token }, null, 2)}\n`, { mode: 0o600 })
    } catch (error) {
      this.log(`cannot persist token: ${error.message}`)
    }
  }

  async start() {
    if (this.server) return this
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((error) => {
        try {
          json(res, 500, { ok: false, error: String(error?.message ?? error) })
        } catch {
          /* headers already sent */
        }
      })
    })
    this.server.on('clientError', (_error, socket) => socket.destroy())

    const base = this.port
    for (let offset = 0; offset < 12; offset++) {
      try {
        await listen(this.server, base + offset)
        this.port = base + offset
        this.log(`LAN bridge listening on 0.0.0.0:${this.port}`)
        if (this.port !== base) this.log(`port ${base} busy, using ${this.port}`)
        return this
      } catch (error) {
        if (error.code !== 'EADDRINUSE') throw error
      }
    }
    await listen(this.server, 0)
    this.port = this.server.address().port
    this.log(`LAN bridge listening on 0.0.0.0:${this.port} (ephemeral)`)
    return this
  }

  stop() {
    if (this.server) {
      this.server.close()
      this.server = null
    }
    this.devices.clear()
  }

  get panelBase() {
    return `http://127.0.0.1:${this.port}`
  }

  get urls() {
    return lanAddresses().map((item) => ({ ...item, url: `http://${item.address}:${this.port}` }))
  }

  async webHandle(req, res) {
    // Registered on the DSH web server (loopback-only), so it is trusted and
    // same-origin with the GUI. No CORS needed on this path.
    return this.dispatch(req, res, true)
  }

  async handle(req, res) {
    applyCors(req, res)
    return this.dispatch(req, res, LOOPBACK.has(req.socket.remoteAddress))
  }

  async dispatch(req, res, trusted) {
    const url = new URL(req.url || '/', this.panelBase)
    const pathname = url.pathname

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (pathname === '/health') {
      json(res, 200, { ok: true, name: 'dsh-esp32-status', version: this.version })
      return
    }
    if (pathname === '/api/hello' && req.method === 'POST') {
      await this.hello(req, res)
      return
    }
    if (pathname === '/api/state' && req.method === 'GET') {
      this.deviceState(req, res, url)
      return
    }
    if (pathname === '/api/esp32-status/snapshot' && req.method === 'GET') {
      if (!trusted) {
        json(res, 403, { ok: false, error: 'panel is loopback-only' })
        return
      }
      json(res, 200, this.snapshot())
      return
    }
    if (pathname === '/api/esp32-status/action' && req.method === 'POST') {
      if (!trusted) {
        json(res, 403, { ok: false, error: 'panel is loopback-only' })
        return
      }
      this.action(req, res).catch((error) => json(res, 400, { ok: false, error: String(error.message) }))
      return
    }
    json(res, 404, { ok: false, error: 'not found' })
  }

  auth(req) {
    const presented = req.headers['x-dsh-token']
    return typeof presented === 'string' && equalToken(presented, this.token)
  }

  touch(body, req) {
    const deviceId = String(body.deviceId || '')
    if (!deviceId) return null
    const now = Date.now()
    const prev = this.devices.get(deviceId)
    const entry = {
      id: deviceId,
      name: String(body.name ?? prev?.name ?? ''),
      fw: String(body.fw ?? prev?.fw ?? ''),
      transport: String(body.transport ?? prev?.transport ?? 'wifi'),
      ip: String(body.ip ?? prev?.ip ?? strip(req.socket.remoteAddress)),
      rssi: Number(body.rssi ?? prev?.rssi ?? 0),
      firstSeen: prev?.firstSeen ?? now,
      lastSeen: now,
      pairedAt: body.paired ? now : prev?.pairedAt ?? 0,
    }
    this.devices.set(deviceId, entry)
    return entry
  }

  async hello(req, res) {
    const body = await readJson(req)
    const deviceId = String(body.deviceId || '')
    if (!deviceId) {
      json(res, 400, { ok: false, error: 'deviceId required' })
      return
    }
    const presented = String(req.headers['x-dsh-token'] || '')
    const known = equalToken(presented, this.token)
    const pairing = this.pairingEnabled && PAIRING_TOKENS.has(presented)
    if (!known && !pairing) {
      this.log(`rejected device ${deviceId}: bad token`)
      json(res, 401, { ok: false, error: 'bad token' })
      return
    }
    if (!known) {
      this.log(`pairing device ${deviceId} from ${strip(req.socket.remoteAddress)}`)
    }
    this.touch({ ...body, paired: !known }, req)
    json(res, 200, { ...this.statePayload(), token: this.token })
  }

  deviceState(req, res, url) {
    if (!this.auth(req)) {
      json(res, 401, { ok: false, error: 'bad token' })
      return
    }
    const deviceId = url.searchParams.get('deviceId') || ''
    if (!deviceId) {
      json(res, 400, { ok: false, error: 'deviceId required' })
      return
    }
    this.touch(
      {
        deviceId,
        rssi: Number(url.searchParams.get('rssi') || 0),
        fw: url.searchParams.get('fw') || undefined,
      },
      req,
    )
    json(res, 200, this.statePayload())
  }

  statePayload() {
    const snap = this.tracker.snapshot()
    return {
      now: Date.now() % 86400000,
      seq: snap.seq,
      status: snap.status,
      body: snap.body,
      detail: snap.detail,
      model: snap.model.model || '',
      provider: snap.model.provider || '',
      effort: snap.model.effort || '',
      pollMs: 1000,
    }
  }

  devicesList() {
    const now = Date.now()
    for (const [id, device] of this.devices) {
      if (now - device.lastSeen > DEVICE_FORGET_MS) this.devices.delete(id)
    }
    return [...this.devices.values()]
      .map((device) => ({ ...device, online: now - device.lastSeen < DEVICE_STALE_MS }))
      .sort((a, b) => a.firstSeen - b.firstSeen)
  }

  snapshot() {
    return {
      ok: true,
      version: this.version,
      bridge: {
        port: this.port,
        running: Boolean(this.server),
        panelBase: this.panelBase,
        urls: this.urls,
        token: this.token,
        tokenFile: this.tokenFile,
        pairingEnabled: this.pairingEnabled,
      },
      state: this.tracker.snapshot(),
      devices: this.devicesList(),
      flash: this.flasher.snapshot(),
      now: Date.now(),
    }
  }

  async action(req, res) {
    const body = await readJson(req)
    const action = String(body.action || '')

    switch (action) {
      case 'clear-error':
        this.tracker.clearError()
        break
      case 'reset-token':
        this.token = randomBytes(16).toString('hex')
        this.saveToken()
        this.log('panel token rotated; devices must re-pair')
        break
      case 'scan':
        this.flasher.scan()
        break
      case 'probe': {
        const port = String(body.port || '')
        if (!port) throw new Error('port required')
        await this.flasher.probe(port)
        break
      }
      case 'flash': {
        const port = String(body.port || '')
        if (!port) throw new Error('port required')
        this.flasher
          .flash(port, { erase: Boolean(body.erase), appOnly: body.appOnly !== false })
          .catch((error) => this.log(`flash failed: ${error.message}`))
        break
      }
      case 'stop-flash':
        this.flasher.stop()
        break
      default:
        json(res, 400, { ok: false, error: `unknown action: ${action}` })
        return
    }
    json(res, 200, { ok: true, snapshot: this.snapshot() })
  }
}
