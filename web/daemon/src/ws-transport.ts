/**
 * WebSocket transport for the daemon ↔ renderer link.
 *
 * Wraps a single `ws.WebSocket` instance with the wire-protocol
 * encoding/decoding and feeds it into the CommandBus.
 */

import type { WebSocket } from 'ws'
import { isWireMessage, type WireMessage } from '../../shared/protocol'
import type { CommandBus } from './command-bus'
import type { RendererBridge, RendererSend } from './renderer-bridge'
import type { PtyDriver } from './pty-driver'
import { homedir } from 'os'

interface AttachContext {
  socket: WebSocket
  bus: CommandBus
  rendererBridge: RendererBridge
  pty: PtyDriver
  /** Single shared token; rotates on daemon launch. */
  token: string
}

/**
 * Hands a freshly-accepted WebSocket to the daemon. Performs auth,
 * then routes inbound messages to the command bus and outbound
 * (`renderer.emit`/`renderer.request`) through the renderer bridge.
 */
export function attachRendererSocket(ctx: AttachContext): void {
  const { socket, bus, rendererBridge, pty, token } = ctx
  let authed = false

  const send = (msg: WireMessage) => {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(msg))
    }
  }

  const isOpen = () => socket.readyState === socket.OPEN

  socket.on('message', async (raw) => {
    let msg: WireMessage
    try {
      const parsed = JSON.parse(raw.toString())
      if (!isWireMessage(parsed)) throw new Error('invalid wire message')
      msg = parsed
    } catch (err) {
      console.warn('[ws] bad message:', err)
      socket.close(1008, 'bad message')
      return
    }

    if (!authed) {
      if (msg.kind === 'auth' && msg.token === token) {
        authed = true
        // Promote this connection to "the renderer". Any prior renderer
        // gets evicted (D3).
        const sender: RendererSend = { send, isOpen }
        rendererBridge.setRenderer(sender)
        pty.setSink({
          emit: (channel, payload) => sender.send({ kind: 'event', channel, payload })
        })
        send({
          kind: 'auth-ok',
          env: { HOME: homedir(), SHELL: process.env.SHELL ?? '/bin/zsh' }
        })
      } else {
        socket.close(1008, 'auth failed')
      }
      return
    }

    // Authed flow.
    if (msg.kind === 'request') {
      try {
        const result = await bus.handleRendererRequest(msg.channel, msg.payload)
        send({ kind: 'response', id: msg.id, ok: true, result: serialize(result) })
      } catch (err) {
        send({
          kind: 'response',
          id: msg.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    } else if (msg.kind === 'event') {
      // Renderer-initiated state push (no response). Reuse the
      // request handler — it returns undefined for these channels.
      try {
        await bus.handleRendererRequest(msg.channel, msg.payload)
      } catch (err) {
        console.warn('[ws] event handler error:', msg.channel, err)
      }
    }
  })

  socket.on('close', () => {
    if (authed) {
      rendererBridge.setRenderer(null)
      pty.setSink(null)
    }
  })

  socket.on('error', (err) => {
    console.warn('[ws] socket error:', err.message)
  })
}

/** JSON.stringify can't serialize Uint8Array; we already base64-encoded
 *  the one place that matters (files:read) but as a belt-and-braces
 *  catch any stray Buffer / Uint8Array here. */
function serialize(v: unknown): unknown {
  if (v instanceof Uint8Array) {
    return { __bytesB64: Buffer.from(v).toString('base64') }
  }
  return v
}
