// Move A2 — host-agnostic event channel.
//
// Services in core/ that need to push events back to a UI surface
// (renderer, extension side panel, etc.) take an `EventSink` instead
// of a host-specific handle. This lets the same service code run in
// the Electron main process and in a Native Messaging helper without
// branching on host.
//
// The Electron adapter wraps `webContents.send` (one line — see
// electron/main.ts). A future extension helper would wrap the Native
// Messaging port write instead.

export interface EventSink {
  /** Push an event on `channel` to the UI surface. */
  send(channel: string, payload: unknown): void
}
