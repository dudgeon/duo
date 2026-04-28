/**
 * Renderer bridge — the daemon's handle on the connected WebSocket
 * client. Every "main → renderer" surface in the Electron build (push
 * events + reqId round-trips) routes through this object.
 *
 * v1 assumes a single connected renderer at a time (D3 in the design
 * doc). When `setRenderer(null)` is called we mark every pending request
 * as failed so callers don't dangle.
 */

import { randomUUID } from 'crypto'
import type { WireMessage } from '../../shared/protocol'

export interface RendererSend {
  send: (msg: WireMessage) => void
  isOpen: () => boolean
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

export class RendererBridge {
  private renderer: RendererSend | null = null
  private pending = new Map<string, Pending>()

  setRenderer(r: RendererSend | null): void {
    this.renderer = r
    if (!r) {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer)
        p.reject(new Error('renderer disconnected'))
      }
      this.pending.clear()
    }
  }

  hasRenderer(): boolean {
    return !!this.renderer && this.renderer.isOpen()
  }

  /**
   * Fire-and-forget event push (analog of `webContents.send`).
   */
  emit(channel: string, payload: unknown): void {
    if (!this.renderer || !this.renderer.isOpen()) return
    this.renderer.send({ kind: 'event', channel, payload })
  }

  /**
   * Round-trip request to the renderer with a generated `reqId`. The
   * renderer is expected to reply via a paired event (e.g.
   * `editor:doc-write` → `editor:doc-write-result`). This helper
   * wraps that pattern.
   *
   *   - `requestChannel`: emit on this channel with `{ reqId, ...args }`
   *   - `resultChannel`: a renderer-pushed event we listen for
   *   - `timeoutMs`: reject if no reply lands in time
   *
   * The caller hands us the *registry* of result-channel listeners
   * via `bindResultChannel`, so all this needs is a way to mint a
   * pending entry and resolve it from the registry's matcher.
   */
  request<T>(
    requestChannel: string,
    args: Record<string, unknown>,
    timeoutMs: number
  ): Promise<T> {
    const reqId = randomUUID()
    return new Promise<T>((resolve, reject) => {
      if (!this.renderer || !this.renderer.isOpen()) {
        reject(new Error('renderer not connected'))
        return
      }
      const timer = setTimeout(() => {
        this.pending.delete(reqId)
        reject(new Error(`renderer request timed out: ${requestChannel}`))
      }, timeoutMs)
      this.pending.set(reqId, {
        resolve: (v) => resolve(v as T),
        reject,
        timer
      })
      this.emit(requestChannel, { reqId, ...args })
    })
  }

  /**
   * Called by the WS-message router when the renderer sends an event
   * on a result channel that carries `{ reqId, ... }`. Resolves the
   * matching pending entry. Returns true if a pending request was
   * matched.
   */
  resolveResult(reqId: string, payload: unknown): boolean {
    const p = this.pending.get(reqId)
    if (!p) return false
    clearTimeout(p.timer)
    this.pending.delete(reqId)
    p.resolve(payload)
    return true
  }
}
