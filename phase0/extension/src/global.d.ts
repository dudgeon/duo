// Minimal ambient types for the chrome extension APIs the canvas
// uses. Using @types/chrome would be ~500KB of declarations we don't
// need; this is what we actually touch.

declare namespace chrome {
  namespace runtime {
    interface Port {
      postMessage(msg: unknown): void
      onMessage: {
        addListener(cb: (msg: any) => void): void
      }
      onDisconnect: {
        addListener(cb: () => void): void
      }
    }
    function connect(connectInfo: { name: string }): Port
  }
}
