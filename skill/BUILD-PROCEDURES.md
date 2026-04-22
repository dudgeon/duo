# Duo — build procedures skill

> For Claude Code agents working **on** the Duo codebase.
> This skill covers how to build, run, test, and package the app.
> For using the `duo` CLI from inside a running session, see `SKILL.md`.

---

## Environment requirements

Before any build command, verify:

```bash
node --version    # must be >= 20
npm --version     # must be >= 10
sw_vers           # must be macOS (node-pty requires macOS for full testing)
xcode-select -p   # must print a path (Xcode CLT required for node-pty rebuild)
```

---

## Install dependencies

```bash
npm install
```

- Runs `electron-rebuild` automatically via the `postinstall` hook
- Rebuilds `node-pty` native module for the installed Electron version
- Must be re-run after any `package.json` change or Electron version bump

**If `electron-rebuild` fails:**
```bash
xcode-select --install   # update Xcode CLT
npm run postinstall       # retry just the rebuild step
```

---

## Development mode

```bash
npm run dev
```

- Starts the Vite renderer dev server (hot module reload)
- Launches Electron with the live renderer
- Main process changes require a manual restart (`Ctrl-C`, then `npm run dev` again)
- Renderer changes hot-reload automatically

**Pass check:** Duo window opens, terminal cursor blinks, address bar visible.

---

## Type checking

```bash
npm run typecheck
```

- Checks both `tsconfig.node.json` (main + CLI) and `tsconfig.web.json` (renderer)
- No emit — type errors only
- Run this before every commit

**Expected output:** No errors. Deprecation warnings about `webContents.canGoBack()` are acceptable until Stage 6.

---

## Build the CLI binary

```bash
npm run build:cli
```

- Bundles `cli/duo.ts` → `cli/duo` via esbuild (platform: node, fully bundled)
- Output is ~7 kB, no external dependencies at runtime
- The binary in `cli/duo` is committed to the repo and should be kept up to date

**When to run:** Any time `cli/duo.ts` or `shared/types.ts` changes.

**Verify:**
```bash
node cli/duo --version    # → 0.1.0
node cli/duo --help
```

---

## Production build

```bash
npm run build
```

- Compiles main process (electron-vite → `out/main/`)
- Compiles preload (→ `out/preload/`)
- Bundles renderer (→ `out/renderer/`)

```bash
npm run build:all   # build + build:cli in one command
```

**Pass check:** `out/` directory populated, no TypeScript or Vite errors.

---

## Package as macOS app

```bash
npm run pack      # build:all + electron-builder --dir (no DMG, faster)
npm run dist      # build:all + electron-builder (produces DMG in dist/)
```

- `pack` produces `dist/mac-universal/Duo.app` — drag to Applications or double-click
- `dist` produces a distributable `dist/Duo-0.1.0.dmg`
- Requires macOS; code signing/notarization only needed for Stage 6

---

## Install the CLI for manual testing

After `npm run build:cli`:

```bash
node cli/duo install
# → Installed: /usr/local/bin/duo → /path/to/cli/duo
```

If `/usr/local/bin` is not writable:
```bash
sudo node cli/duo install
```

Verify from any directory:
```bash
which duo        # → /usr/local/bin/duo
duo --version    # → 0.1.0
```

---

## End-to-end test sequence

With `npm run dev` running and `duo` installed:

```bash
duo url                                    # → about:blank
duo navigate https://example.com           # navigates browser pane
duo url                                    # → https://www.example.com/
duo title                                  # → Example Domain
duo text --selector h1                     # → Example Domain
duo wait h1 --timeout 3000                 # → {"ok":true}
duo eval 'document.title'                  # → "Example Domain"
duo screenshot --out /tmp/test.png && open /tmp/test.png
duo tabs                                   # → [{id:1, url:..., isActive:true}]
```

---

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `Error: cannot find module 'node-pty'` | electron-rebuild didn't run | `npm run postinstall` |
| `WebContentsView is not a constructor` | Electron < 29 | `npm install electron@latest` |
| `duo: Cannot connect` | Duo app not running | `npm run dev` in another terminal |
| Browser pane stays blank | WebContentsView bounds = 0 | Drag the split divider; check `browser:bounds` IPC |
| Stale socket error on startup | Previous run left `duo.sock` | `rm ~/Library/Application\ Support/duo/duo.sock` |
| `npm run typecheck` fails after editing shared types | Type mismatch in renderer or preload | Check `ElectronAPI` in `shared/types.ts` matches `electron/preload.ts` |

---

## File map for common tasks

| Task | Edit these files |
|---|---|
| Add a new CLI command | `cli/duo.ts`, `electron/socket-server.ts`, `shared/types.ts` (DuoCommandName), `skill/SKILL.md` |
| Change browser nav behaviour | `electron/browser-manager.ts`, `renderer/components/BrowserPane.tsx` |
| Change how CDP commands work | `electron/cdp-bridge.ts` |
| Add a new IPC channel | `shared/types.ts` (IPC object), `electron/main.ts`, `electron/preload.ts`, `shared/types.ts` (ElectronAPI) |
| Change terminal behaviour | `electron/pty-manager.ts`, `renderer/components/TerminalPane.tsx` |

---

## Stage gate: what must pass before moving to next stage

| Before Stage 4 | All Step 1–9 checks in `docs/FIRST-RUN.md` must pass |
| Before Stage 5 | Skills panel shows correct skills for active tab CWD |
| Before Stage 6 | `npm run dist` produces a signed + notarized DMG |
