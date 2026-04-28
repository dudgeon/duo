/**
 * Duo Web — daemon entry point.
 *
 *   HTTP    /            → serves the built renderer SPA (or proxies to
 *                          Vite dev in dev mode via `DUO_WEB_DEV_PROXY`)
 *   HTTP    /api/bootstrap → returns { token, version, env } so the SPA
 *                            can upgrade /ws/renderer
 *   WS      /ws/renderer → renderer bridge (one connection at a time)
 *   TCP     127.0.0.1:N  → legacy CLI bridge (NDJSON + token)
 *
 * Run:
 *   node out/web/daemon/server.js
 *   tsx web/daemon/src/server.ts          (dev)
 *
 * Env:
 *   DUO_WEB_PORT           override HTTP port (default: ephemeral)
 *   DUO_WEB_DEV_PROXY=1    skip serving static assets; assume Vite dev
 *                          server is on http://127.0.0.1:5173
 *   DUO_WEB_OPEN=1         try to launch the user's default browser at
 *                          the daemon URL after startup
 */

import * as http from 'http'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as path from 'path'
import { randomBytes } from 'crypto'
import { WebSocketServer } from 'ws'
import { spawn } from 'child_process'

import {
  APP_VERSION,
  HTTP_BIND,
  HTTP_PORT_DEFAULT,
  PORT_FILE,
  STATE_DIR
} from './constants'
import { PtyDriver } from './pty-driver'
import { FilesService } from './files-service'
import { StateCache } from './state-cache'
import { RendererBridge } from './renderer-bridge'
import { CommandBus, makeJsonPinsStore } from './command-bus'
import { attachRendererSocket } from './ws-transport'
import { startCliTcp } from './cli-bridge'
import type { PinEntry, NavPinEntry } from '../../../shared/types'

const STATIC_ROOT = path.resolve(__dirname, '../../client-dist')
const DEV_PROXY = process.env.DUO_WEB_DEV_PROXY === '1'
const DEV_PROXY_URL = process.env.DUO_WEB_DEV_PROXY_URL ?? 'http://127.0.0.1:5173'

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json'
}

async function main(): Promise<void> {
  await fs.mkdir(STATE_DIR, { recursive: true })

  const token = randomBytes(32).toString('hex')

  const pty = new PtyDriver()
  const files = new FilesService()
  const state = new StateCache()
  const renderer = new RendererBridge()

  const pins = makeJsonPinsStore<PinEntry>(
    path.join(STATE_DIR, 'pins.json'),
    (e) => `${e.kind}:${e.ref}`
  )
  const navPins = makeJsonPinsStore<NavPinEntry>(
    path.join(STATE_DIR, 'nav-pins.json'),
    (e) => e.path
  )

  const bus = new CommandBus({ pty, files, state, renderer, pins, navPins })

  // ── HTTP ────────────────────────────────────────────────────────────
  const httpServer = http.createServer(async (req, res) => {
    const url = req.url ?? '/'

    // Strict same-origin. The renderer fetches /api/bootstrap from the
    // page itself, so its Origin matches the daemon's origin.
    const origin = req.headers.origin
    const expectedOrigin = `http://${HTTP_BIND}:${(httpServer.address() as { port: number }).port}`
    if (origin && origin !== expectedOrigin && !DEV_PROXY) {
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('forbidden: bad origin')
      return
    }

    if (url === '/api/bootstrap') {
      res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store'
      })
      res.end(
        JSON.stringify({
          token,
          version: APP_VERSION,
          runtime: 'web'
        })
      )
      return
    }

    if (DEV_PROXY) {
      proxyToDev(req, res)
      return
    }

    await serveStatic(req, res)
  })

  // ── WebSocket ───────────────────────────────────────────────────────
  const wss = new WebSocketServer({ noServer: true })
  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws/renderer') {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      attachRendererSocket({ socket: ws, bus, rendererBridge: renderer, pty, token })
    })
  })

  // ── Listen ──────────────────────────────────────────────────────────
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(HTTP_PORT_DEFAULT, HTTP_BIND, resolve)
  })

  const httpAddr = httpServer.address()
  if (typeof httpAddr !== 'object' || !httpAddr) {
    throw new Error('HTTP server failed to bind')
  }
  const httpPort = httpAddr.port

  const cli = await startCliTcp({ bus, token })

  // Publish the CLI port file so `cli/duo` (with DUO_PORT_FILE pointing
  // here) can reach us.
  fsSync.writeFileSync(
    PORT_FILE,
    JSON.stringify({ port: cli.port, token, runtime: 'web', httpPort }, null, 2),
    { mode: 0o600 }
  )

  const url = `http://${HTTP_BIND}:${httpPort}`
  console.log(`Duo Web v${APP_VERSION} listening:`)
  console.log(`  open in browser:  ${url}`)
  console.log(`  CLI bridge:       127.0.0.1:${cli.port}`)
  console.log(`  port file:        ${PORT_FILE}`)
  console.log(`  state dir:        ${STATE_DIR}`)
  console.log('')
  console.log('To use the CLI:')
  console.log(`  export DUO_PORT_FILE=${PORT_FILE}`)
  console.log('  duo ping')

  if (process.env.DUO_WEB_OPEN === '1') {
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
    spawn(opener, [url], { detached: true, stdio: 'ignore' }).unref()
  }

  // ── Shutdown ────────────────────────────────────────────────────────
  const shutdown = (sig: string) => {
    console.log(`\nreceived ${sig}, shutting down`)
    pty.dispose()
    files.dispose()
    cli.close()
    wss.close()
    httpServer.close()
    try {
      fsSync.unlinkSync(PORT_FILE)
    } catch {
      /* already gone */
    }
    process.exit(0)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

// ── Static asset serving (built mode only) ────────────────────────────
async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = (req.url ?? '/').split('?')[0]
  const safe = url === '/' ? '/index.html' : url
  const fp = path.normalize(path.join(STATIC_ROOT, safe))
  if (!fp.startsWith(STATIC_ROOT)) {
    res.writeHead(403)
    res.end('forbidden')
    return
  }
  try {
    const data = await fs.readFile(fp)
    const ext = path.extname(fp).toLowerCase()
    const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream'
    res.writeHead(200, { 'content-type': mime })
    res.end(data)
  } catch {
    // SPA fallback — let the renderer handle the route.
    try {
      const html = await fs.readFile(path.join(STATIC_ROOT, 'index.html'))
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
    } catch {
      res.writeHead(404)
      res.end('not found (run `npm run web:client:build` first)')
    }
  }
}

// ── Vite dev-server proxy (dev mode) ──────────────────────────────────
function proxyToDev(req: http.IncomingMessage, res: http.ServerResponse): void {
  const target = new URL(req.url ?? '/', DEV_PROXY_URL)
  const proxied = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: target.pathname + target.search,
      headers: req.headers
    },
    (upstream) => {
      res.writeHead(upstream.statusCode ?? 500, upstream.headers)
      upstream.pipe(res)
    }
  )
  req.pipe(proxied)
  proxied.on('error', (err) => {
    res.writeHead(502)
    res.end(`dev-proxy error: ${err.message}`)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
