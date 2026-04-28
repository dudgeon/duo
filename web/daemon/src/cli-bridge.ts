/**
 * Legacy CLI TCP bridge.
 *
 * The unmodified `cli/duo` binary connects either via Unix socket or
 * via loopback TCP with a token. The Electron build publishes both;
 * the web daemon only publishes TCP (no Unix socket — sandbox-tolerant
 * transport is the whole point of falling back to TCP, and the web
 * runtime has the same constraints). The CLI's existing `readPortFile`
 * picks up `~/.duo/web.port` when DUO_PORT_FILE is set.
 *
 * Protocol: NDJSON DuoRequest/Response. Handshake = first line MUST be
 * `{ token: '<value>' }`.
 */

import * as net from 'net'
import type { CommandBus } from './command-bus'
import type { DuoRequest, DuoResponse } from '../../../shared/types'

export function startCliTcp(opts: {
  bus: CommandBus
  token: string
  bind?: string
}): Promise<{ port: number; close: () => void }> {
  const bind = opts.bind ?? '127.0.0.1'
  const server = net.createServer((socket) => {
    let buf = ''
    let authed = false

    socket.on('data', (chunk) => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue

        if (!authed) {
          try {
            const handshake = JSON.parse(line) as { token?: unknown }
            if (typeof handshake.token === 'string' && handshake.token === opts.token) {
              authed = true
              continue
            }
          } catch {
            /* fall through */
          }
          if (!socket.destroyed) {
            socket.write(JSON.stringify({ id: '', ok: false, error: 'auth required' }) + '\n')
          }
          socket.destroy()
          return
        }

        let req: DuoRequest
        try {
          req = JSON.parse(line)
        } catch {
          continue
        }
        opts.bus
          .handleCliRequest(req)
          .then((res: DuoResponse) => {
            if (!socket.destroyed) socket.write(JSON.stringify(res) + '\n')
          })
          .catch((err) => {
            const res: DuoResponse = {
              id: req.id,
              ok: false,
              error: err instanceof Error ? err.message : String(err)
            }
            if (!socket.destroyed) socket.write(JSON.stringify(res) + '\n')
          })
      }
    })

    socket.on('error', () => {
      /* client disconnected — ignore */
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, bind, () => {
      const addr = server.address()
      if (typeof addr !== 'object' || !addr) {
        reject(new Error('TCP server returned no address'))
        return
      }
      resolve({
        port: addr.port,
        close: () => server.close()
      })
    })
  })
}
