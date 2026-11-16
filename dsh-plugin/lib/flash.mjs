import { spawn, execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FW_FILE = path.join(HERE, '..', 'firmware', 'dsh-esp32-status-esp32dev.bin')
const FW_MANIFEST = path.join(HERE, '..', 'firmware', 'manifest.json')

function parseSpec(spec) {
  if (!spec) return null
  const parts = String(spec).trim().split(/\s+/)
  if (!parts.length) return null
  return { cmd: parts[0], args: parts.slice(1) }
}

function labelFor(name) {
  if (/wchusbserial|ch34/i.test(name)) return 'CH340'
  if (/SLAB_USBtoUART|usbserial/i.test(name)) return 'CP210x'
  if (/usbmodem/i.test(name)) return 'USB CDC'
  return '序列埠'
}

/** Serial ports that look like an ESP32 dev board. */
export function listSerialPorts() {
  const dir = process.platform === 'win32' ? null : '/dev'
  if (!dir) return []
  let names = []
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const prefixes =
    process.platform === 'darwin'
      ? /^cu\.(usbserial|usbmodem|wchusbserial|SLAB_USBtoUART|serial)/
      : /^(ttyUSB|ttyACM)/
  const skip = /Bluetooth|debug-console|wlan-debug|Incoming-Port/i
  return names
    .filter((name) => prefixes.test(name) && !skip.test(name))
    .sort()
    .map((name) => ({
      path: path.join(dir, name),
      name,
      label: labelFor(name),
    }))
}

export class Flasher {
  constructor(config = {}) {
    this.config = config
    this.tool = null
    this.toolError = ''
    this.toolCheckedAt = 0
    this.ports = []
    this.probes = new Map()
    this.firmware = this.readFirmware()
    this.child = null
    this.state = {
      running: false,
      action: '',
      port: '',
      progress: 0,
      startedAt: 0,
      finishedAt: 0,
      exitCode: null,
      error: '',
      log: [],
    }
    this.scan()
  }

  readFirmware() {
    try {
      const manifest = JSON.parse(readFileSync(FW_MANIFEST, 'utf8'))
      if (!existsSync(FW_FILE)) return null
      return { ...manifest, path: FW_FILE }
    } catch {
      return existsSync(FW_FILE) ? { path: FW_FILE, version: 'unknown', bytes: 0 } : null
    }
  }

  scan() {
    this.ports = listSerialPorts().map((port) => ({
      ...port,
      probe: this.probes.get(port.path) ?? null,
    }))
    return this.ports
  }

  candidates() {
    const list = []
    for (const extra of [this.config.esptool, process.env.ESPTOOL]) {
      const spec = parseSpec(extra)
      if (spec) list.push(spec)
    }
    list.push({ cmd: 'esptool', args: [] })
    list.push({ cmd: 'esptool.py', args: [] })
    list.push({ cmd: 'python3', args: ['-m', 'esptool'] })
    const home = os.homedir()
    for (const python of [
      path.join(HERE, '..', '.venv', 'bin', 'python'),
      path.join(home, '.platformio', 'penv', 'bin', 'python'),
      '/opt/homebrew/bin/python3',
      '/usr/local/bin/python3',
    ]) {
      if (existsSync(python)) list.push({ cmd: python, args: ['-m', 'esptool'] })
    }
    // PlatformIO ships a self-contained esptool binary; prefer it over Python.
    const cores = [
      this.config.platformioCore,
      process.env.PLATFORMIO_CORE_DIR,
      path.join(process.cwd(), '.pio-core'),
      path.join(process.cwd(), '..', '.pio-core'),
      path.join(home, '.platformio'),
    ].filter(Boolean)
    for (const core of cores) {
      const binary = path.join(core, 'packages', 'tool-esptool', 'esptool')
      if (existsSync(binary)) list.push({ cmd: binary, args: [] })
    }
    // Convenience shim documented in the README.
    const shim = path.join(home, '.dsh', 'esp32-status', 'esptool')
    if (existsSync(shim)) list.unshift({ cmd: shim, args: [] })
    return list
  }

  ensureTool() {
    if (this.tool) return this.tool
    if (this.toolCheckedAt && Date.now() - this.toolCheckedAt < 30000) return null
    this.toolCheckedAt = Date.now()
    const failures = []
    for (const candidate of this.candidates()) {
      try {
        const out = execFileSync(candidate.cmd, [...candidate.args, 'version'], {
          timeout: 6000,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        if (/esptool/i.test(out)) {
          this.tool = candidate
          this.toolError = ''
          return candidate
        }
      } catch (error) {
        failures.push(`${candidate.cmd}: ${String(error.message).split('\n')[0]}`)
      }
    }
    this.toolError = `找不到可用的 esptool（pip install esptool）\n${failures.join('\n')}`
    return null
  }

  log(line) {
    const text = String(line).replace(/\r/g, '').trimEnd()
    if (!text) return
    this.state.log.push(text)
    if (this.state.log.length > 80) this.state.log.splice(0, this.state.log.length - 80)
  }

  run(args, timeoutMs = 240000) {
    return new Promise((resolve, reject) => {
      const child = spawn(args[0], args.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] })
      this.child = child
      let buffer = ''
      const consume = (chunk) => {
        buffer += chunk.toString()
        const lines = buffer.split(/\r?\n|\r/)
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          this.log(line)
          const match = /\(\s*(\d+)\s*%\)/.exec(line)
          if (match) this.state.progress = Math.min(100, Number(match[1]))
        }
      }
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`timeout after ${Math.round(timeoutMs / 1000)}s`))
      }, timeoutMs)
      child.stdout.on('data', consume)
      child.stderr.on('data', consume)
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        this.child = null
        if (buffer.trim()) this.log(buffer)
        resolve(code ?? -1)
      })
    })
  }

  async probe(port) {
    if (this.state.running) throw new Error('另一個燒錄或偵測正在進行')
    const tool = this.ensureTool()
    if (!tool) throw new Error(this.toolError)
    this.state = {
      running: true,
      action: 'probe',
      port,
      progress: 0,
      startedAt: Date.now(),
      finishedAt: 0,
      exitCode: null,
      error: '',
      log: [],
    }
    try {
      const code = await this.run(
        [...tool.args, '--chip', 'esp32', '--port', port, '--baud', '115200', 'chip_id'],
        30000,
      )
      const log = this.state.log.join('\n')
      const chip = /Chip is ([^\n(]+)/i.exec(log)?.[1]?.trim() ?? ''
      const mac = /MAC:\s*([0-9a-f:]{17})/i.exec(log)?.[1] ?? ''
      const probe = { ok: code === 0, chip, mac, at: Date.now(), code }
      this.probes.set(port, probe)
      this.state.exitCode = code
      this.state.error = code === 0 ? '' : '偵測失敗，請確認板子與序列埠'
      this.scan()
      return probe
    } catch (error) {
      this.state.error = String(error.message ?? error)
      throw error
    } finally {
      this.state.running = false
      this.state.finishedAt = Date.now()
    }
  }

  async flash(port, { erase = false } = {}) {
    if (this.state.running) throw new Error('另一個燒錄或偵測正在進行')
    const tool = this.ensureTool()
    if (!tool) throw new Error(this.toolError)
    if (!this.firmware) throw new Error('插件內沒有韌體檔（firmware/*.bin）')

    this.state = {
      running: true,
      action: 'flash',
      port,
      progress: 0,
      startedAt: Date.now(),
      finishedAt: 0,
      exitCode: null,
      error: '',
      log: [],
    }
    this.log(`firmware ${this.firmware.version ?? 'unknown'} · ${port}`)
    try {
      if (erase) {
        this.log('erase_flash…')
        const code = await this.run(
          [...tool.args, '--chip', 'esp32', '--port', port, '--baud', '115200', 'erase_flash'],
          120000,
        )
        if (code !== 0) throw new Error(`erase_flash 失敗（${code}）`)
      }
      this.state.progress = 0
      this.log('write_flash 0x0 (merged image)…')
      const code = await this.run([
        ...tool.args,
        '--chip',
        'esp32',
        '--port',
        port,
        '--baud',
        '115200',
        '--before',
        'default_reset',
        '--after',
        'hard_reset',
        'write_flash',
        '-z',
        '--flash_mode',
        'dio',
        '--flash_freq',
        '40m',
        '--flash_size',
        '4MB',
        '0x0',
        this.firmware.path,
      ])
      this.state.exitCode = code
      if (code !== 0) throw new Error(`write_flash 失敗（${code}）`)
      this.state.progress = 100
      this.log('燒錄完成，板子重啟中')
      return { ok: true }
    } catch (error) {
      this.state.error = String(error.message ?? error)
      this.state.exitCode = this.state.exitCode ?? -1
      throw error
    } finally {
      this.state.running = false
      this.state.finishedAt = Date.now()
      // Give the port a moment to re-enumerate before the panel rescans.
      setTimeout(() => this.scan(), 1200)
    }
  }

  stop() {
    if (this.child) {
      try {
        this.child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
    }
  }

  snapshot() {
    if (!this.tool) this.ensureTool()
    return {
      running: this.state.running,
      action: this.state.action,
      port: this.state.port,
      progress: this.state.progress,
      startedAt: this.state.startedAt,
      finishedAt: this.state.finishedAt,
      exitCode: this.state.exitCode,
      error: this.state.error,
      log: this.state.log.slice(-24),
      tool: this.tool ? `${this.tool.cmd} ${this.tool.args.join(' ')}`.trim() : '',
      toolError: this.toolError,
      firmware: this.firmware
        ? { version: this.firmware.version, bytes: this.firmware.bytes, sha256: this.firmware.sha256 }
        : null,
      ports: this.ports,
    }
  }
}
