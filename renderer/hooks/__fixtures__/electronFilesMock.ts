// ENH-195 A6 — controllable fake for window.electron.files, used by the
// reconciliation integration tests. Lets a test set the disk bytes a read()
// resolves with and push a synthetic chokidar 'changed'/'removed' event to
// the watcher the hook registered, then assert the hook's observable
// response (which injected callback ran). Mirrors the preload routing
// (a single registered cb invoked with { kind, path }).

const enc = new TextEncoder()
const dec = new TextDecoder()

export function createFilesMock() {
  const disk = new Map<string, string>()
  const watchers: { paths: string[]; cb: (e: { kind: string; path: string }) => void }[] = []
  const reads: string[] = []
  const writes: { path: string; text: string }[] = []

  const api = {
    read: async (p: string) => {
      reads.push(p)
      if (!disk.has(p)) throw new Error('ENOENT (mock)')
      const t = disk.get(p) ?? ''
      return { bytes: enc.encode(t), mtimeMs: 0, size: t.length, mime: 'text/plain' }
    },
    write: async (p: string, bytes: Uint8Array) => {
      const t = dec.decode(bytes)
      writes.push({ path: p, text: t })
      disk.set(p, t)
    },
    watch: async (
      paths: string[],
      cb: (e: { kind: string; path: string }) => void,
      _opts?: { ignored?: (string | RegExp)[]; watchParents?: boolean }
    ) => {
      const w = { paths, cb }
      watchers.push(w)
      return async () => {
        const i = watchers.indexOf(w)
        if (i >= 0) watchers.splice(i, 1)
      }
    },
  }

  return {
    api,
    reads,
    writes,
    watcherCount: () => watchers.length,
    setDiskBytes: (p: string, text: string) => disk.set(p, text),
    deleteDisk: (p: string) => disk.delete(p),
    pushChange: (p: string, kind: 'changed' | 'added' | 'removed' = 'changed') => {
      for (const w of watchers) if (w.paths.includes(p)) w.cb({ kind, path: p })
    },
  }
}

/** Install a fake window.electron carrying the files mock + the env fields the
 *  conflict diagnostic reads. Returns a restore() to call in afterEach. */
export function installWindowElectron(filesApi: ReturnType<typeof createFilesMock>['api']) {
  const g = globalThis as unknown as { window?: { electron?: unknown } }
  if (!g.window) (g as { window: unknown }).window = g
  const prev = g.window!.electron
  g.window!.electron = { files: filesApi, env: { HOME: '/tmp/home', appVersion: '0.0.0-test' } }
  return () => { g.window!.electron = prev }
}
