// BUG-190 — guarded webContents.send factory, extracted from
// electron/main.ts so it's exercisable from a vitest node env without
// mounting Electron. The production wiring closes over the main-process
// `mainWindow` variable via the `getWindow` thunk; tests inject a fake
// WindowLike to drive the destroyed/null branches.
//
// Why this lives apart from main.ts: a regression here re-opens the
// quit-loop crash (PTY data after teardown → unguarded send → uncaught
// "Object has been destroyed" → looping dialog). The owner's review on
// PR #61 explicitly asked for the test, hence the small extraction.

export interface WindowLike {
  isDestroyed(): boolean
  webContents: {
    isDestroyed(): boolean
    send(channel: string, payload?: unknown): void
  }
}

export function makeSafeSend(
  getWindow: () => WindowLike | null
): (channel: string, payload?: unknown) => void {
  return (channel, payload) => {
    const w = getWindow()
    // Order matters — short-circuit before touching `webContents` on a
    // destroyed window, since accessing it then can itself throw.
    if (!w || w.isDestroyed() || w.webContents.isDestroyed()) return
    w.webContents.send(channel, payload)
  }
}
