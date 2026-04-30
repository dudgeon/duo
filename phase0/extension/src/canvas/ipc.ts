// Thin wrapper around chrome.runtime.connect({name:'canvas'}) so the
// React canvas can request files:read / files:write through the SW
// without each component knowing about ports and reqIds.

type Pending = {
  resolve: (msg: any) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let port: chrome.runtime.Port | null = null
const pending = new Map<string, Pending>()
const REQUEST_TIMEOUT_MS = 10_000

function ensureConnected(): chrome.runtime.Port {
  if (port) return port
  port = chrome.runtime.connect({ name: 'canvas' })
  port.onMessage.addListener((msg: any) => {
    if (!msg || !msg.reqId) return
    const entry = pending.get(msg.reqId)
    if (!entry) return
    clearTimeout(entry.timer)
    pending.delete(msg.reqId)
    if (msg.ok) entry.resolve(msg)
    else entry.reject(new Error(msg.error || 'request failed'))
  })
  port.onDisconnect.addListener(() => {
    console.warn('[canvas/ipc] sw port disconnected')
    port = null
    for (const [, entry] of pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error('sw port disconnected'))
    }
    pending.clear()
  })
  return port
}

function request<T = any>(type: string, body: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const p = ensureConnected()
    const reqId = type + '-' + Math.random().toString(36).slice(2, 10)
    const timer = setTimeout(() => {
      pending.delete(reqId)
      reject(new Error(`${type} timeout`))
    }, REQUEST_TIMEOUT_MS)
    pending.set(reqId, { resolve, reject, timer })
    p.postMessage({ type, reqId, ...body })
  })
}

export interface FileReadResult {
  content: string
  mtimeMs: number
}

export interface FileWriteResult {
  mtimeMs: number
}

export const files = {
  read: (path: string) => request<FileReadResult>('files:read', { path }),
  write: (path: string, content: string) =>
    request<FileWriteResult>('files:write', { path, content }),
}
