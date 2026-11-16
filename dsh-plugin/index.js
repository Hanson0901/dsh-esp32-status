import { Tracker } from './lib/state.mjs'
import { Flasher } from './lib/flash.mjs'
import { Bridge } from './lib/server.mjs'

export const name = 'dsh-esp32-status'

/**
 * Two sides of the same bridge:
 *  - the ESP32 polls the LAN server for one compact status line;
 *  - the DSH sidebar panel reads the same state plus the board/flash list.
 */
export function apply(ctx, config = {}) {
  const log = (...args) => console.log('[dsh-esp32-status]', ...args)
  const tracker = new Tracker(ctx)
  const flasher = new Flasher(config)
  const bridge = new Bridge({ tracker, flasher, config, log })

  tracker.start()
  bridge.start().catch((error) => log('LAN bridge failed:', error?.message ?? error))

  const webServer = ctx.get?.('webServer')
  if (webServer) {
    // Same-origin panel route (no CSP/CORS surprises), loopback-only anyway.
    ctx.effect(
      () =>
        webServer.register({
          kind: 'prefix',
          path: '/api/esp32-status',
          handler: (req, res) => bridge.webHandle(req, res),
        }),
      'dsh-esp32-status: panel routes',
    )
  } else {
    log('webServer unavailable; the panel will talk to the LAN bridge directly')
  }

  ctx.effect(
    () => () => {
      bridge.stop()
      flasher.stop()
      tracker.stop()
    },
    'dsh-esp32-status: LAN bridge and agent listeners',
  )

  log(`panel bridge on http://127.0.0.1:${bridge.port}`)
}
