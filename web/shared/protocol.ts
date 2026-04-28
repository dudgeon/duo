/**
 * Duo Web — daemon ↔ renderer WebSocket protocol.
 *
 * NDJSON-ish framing inside WebSocket text messages. Each message is one
 * JSON value of type WireMessage. Two flavours:
 *
 *   1. Request/response — renderer asks daemon to do something
 *      (`pty:create`, `files:read`, etc) and waits for a reply by id.
 *      This is the analog of `ipcRenderer.invoke`.
 *
 *   2. Event — daemon pushes (`pty:data:<id>`, `nav:reveal`, ...) without
 *      a matching request. This is the analog of `webContents.send`.
 *
 * A few channels go the other direction (renderer → daemon push, no
 * reply expected): `nav:state-push`, `editor:selection-push`, etc. We
 * reuse the `event` flavour with a leading-underscore convention; the
 * daemon ignores ids on inbound events.
 *
 * The channel string IS the IPC channel name from `shared/types.ts`
 * (e.g. `IPC.PTY_CREATE === 'pty:create'`). Reusing those strings means
 * the shim layer can do a near-mechanical translation.
 *
 * Authentication: the very first message MUST be `{ kind: 'auth',
 * token: '...' }`. The daemon either accepts (sending
 * `{ kind: 'auth-ok', env: { HOME, SHELL } }`) or closes the socket.
 */

export type WireMessage =
  | { kind: 'auth'; token: string }
  | { kind: 'auth-ok'; env: { HOME: string; SHELL: string } }
  | { kind: 'request'; id: string; channel: string; payload: unknown }
  | { kind: 'response'; id: string; ok: true; result: unknown }
  | { kind: 'response'; id: string; ok: false; error: string }
  | { kind: 'event'; channel: string; payload: unknown }

export const isWireMessage = (v: unknown): v is WireMessage => {
  if (!v || typeof v !== 'object') return false
  const k = (v as { kind?: unknown }).kind
  return (
    k === 'auth' ||
    k === 'auth-ok' ||
    k === 'request' ||
    k === 'response' ||
    k === 'event'
  )
}
