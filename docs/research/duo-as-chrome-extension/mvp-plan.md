# Duo-as-Chrome-extension — MVP build plan

**Status:** Plan, 2026-04-29. Not started. Reads on top of
[`./README.md`](./README.md) — that document is the feasibility
analysis; this one is the actual build sequence.

> **Note (2026-04-29 update):** [`./build-roadmap.md`](./build-roadmap.md)
> now composes this MVP plan with the [`./refactor-analysis.md`](./refactor-analysis.md)
> moves and post-MVP stages into a single end-to-end sequence. Phases
> 0–8 in this document are Stage C of that roadmap. Read
> `build-roadmap.md` first for the full picture; come here for
> phase-level detail.

**Outcome we're building toward:** A Trailblazer can install the
extension + helper in under five minutes, run a Claude Code agent in
the side-panel terminal, edit a markdown file the agent opens in a
new browser tab, and watch the agent take a screenshot of their
already-authenticated Gmail tab. End-to-end, < 5 min idle pause
mid-session, no helper-died reconnect dance.

**Estimated effort:** ~10 working days, **gated at Phase 0** (half a
day). If Phase 0 fails, the plan stops here and the README's "Why
this is *not* a successor to duo-in-browser" gets a closing
addendum.

---

## What's in MVP, what's deferred

Tightly scoped — the goal is to learn whether the shape works, not
to ship parity with the Electron build.

### In MVP

- **One side panel** with one terminal + a default-collapsed
  navigator drawer (D3 below).
- **One PTY at a time** in that terminal, running the user's shell.
- **Markdown canvas-as-tab** — `duo edit foo.md` opens a new Chrome
  tab hosting `renderer/components/editor/MarkdownEditor.tsx`.
- **File I/O through the helper** — read, write, watch.
- **Tab-driving via lighter APIs first** — `duo nav`, `duo click`,
  `duo type`, `duo screenshot`, `duo url`, `duo title` go through
  `chrome.tabs` + `chrome.scripting` (no yellow banner).
- **`chrome.debugger` attach for CDP-only ops** — `duo ax`,
  `duo console`, `duo errors`. Yellow banner appears during attach.
- **macOS only.** Linux / Windows deferred.
- **Two-step install** — Web Store extension + signed helper PKG.

### Deferred (do not build for MVP)

- HTML canvas (the iframe-sandboxed Stage 17 surface)
- Multi-PTY tab strip in the side panel
- Theme synchronization across tabs
- Network capture / interception (`Network.*` CDP)
- Auto-update for the helper binary (manual update for MVP)
- Multi-profile UX (each profile gets its own helper; that's fine)
- Drag-and-drop between filetree and canvas tabs
- Selection-sharing between canvas and terminal
  (`renderer/components/Selection*` machinery)
- Skills panel
- Browser history persistence
- Session restore across browser restart
- Anything currently sitting in `electron/browser-manager.ts` —
  that whole subsystem retires in this shape

If a deferred capability turns out to be load-bearing during the
build, raise it explicitly and reconsider scope; do not silently
bring it in.

---

## D-numbered decisions

Locked before code starts. If one of these flips during the build,
update the doc.

- **D1 — `window.electron` shim, not abstraction refactor.** Inherited
  from the duo-in-browser exploration's D1. The shim forwards every
  call from the renderer components to the SW via
  `chrome.runtime.connect`, and the SW forwards over Native Messaging
  to the helper. `renderer/components/*` host verbatim.
- **D2 — One Native Messaging connection, owned by the SW.** The SW
  is the only thing that calls `chrome.runtime.connectNative`. Side
  panel and canvas tabs cannot. They relay through the SW. (See
  README § "One coordinator per profile.")
- **D3 — Navigator as default-collapsed hover drawer.** The side
  panel's default state is full-width terminal. The navigator lives
  in a thin (32px) icon rail on the leading edge; clicking it slides
  a 280px navigator panel in over the terminal (`position: absolute`,
  `transform: translateX`, 200ms ease). Click outside, press Escape,
  or click a file → drawer collapses. This buys the terminal real
  estate back at default and accepts a one-click cost when the user
  wants to navigate. **A keystroke binding (probably ⌘+B) toggles the
  drawer** — single source of truth in
  [`renderer/keyboard/globalShortcuts.ts`](../../../renderer/keyboard/globalShortcuts.ts).
- **D4 — Markdown canvas only in MVP.** HTML canvas (Stage 17) is
  deferred. `fileClassifier` returns `unknown` for `.html` for now.
- **D5 — Lighter `chrome.tabs`/`chrome.scripting` APIs first;
  `chrome.debugger` only for CDP-only ops.** See README § "Hybrid:
  use the lighter APIs first" for the table. CLI verbs are tagged
  in their help output with `(attaches debugger)` when the yellow
  banner will appear.
- **D6 — 25-second `chrome.alarms` keep-alive for SW.** Phase 0
  proves the cadence; if it isn't enough, raise the alarm cadence
  before moving on. Document the actual interval that worked.
- **D7 — Single PTY in MVP.** No tab strip in the side panel. If
  the user wants a second terminal, they open a popup window
  (deferred to v0.1 if needed).
- **D8 — macOS only for MVP.** Helper PKG is signed + notarized for
  Darwin. Cross-platform helper builds (Linux deb / rpm, Windows
  MSI) are post-MVP work.
- **D9 — `BroadcastChannel` for cross-tab UI events.** Theme,
  focus, "another tab opened the same file" — peer-to-peer between
  same-origin extension pages. Stateful coordination still goes
  through the SW (D2). This is the structural answer to the
  cross-window keystroke routing concern in the README's soft
  blockers.

---

## Architecture

```
                                         Chrome (one user profile)
   ┌─────────────────────────────────────────────────────────────────────────────────┐
   │                                                                                  │
   │   ┌─ extension manifest_version 3 ──────────────────────────────────────────┐   │
   │   │                                                                          │   │
   │   │   ┌─ side panel ──────────────┐    ┌─ canvas tab(s) ──────────────────┐  │   │
   │   │   │ extension/sidepanel/      │    │ extension/canvas/                │  │   │
   │   │   │  ├─ SidePanel.tsx         │    │  └─ CanvasPage.tsx               │  │   │
   │   │   │  ├─ NavRail.tsx (32px)    │    │     hosts MarkdownEditor         │  │   │
   │   │   │  ├─ NavDrawer.tsx (280px) │    │     (renderer/components/editor) │  │   │
   │   │   │  └─ TerminalPane (reuse)  │    └──────────────────────────────────┘  │   │
   │   │   └─────────────┬─────────────┘                  │                       │   │
   │   │                 │                                │                       │   │
   │   │                 └────── chrome.runtime.connect ports ────┐               │   │
   │   │                                                          ↓               │   │
   │   │                                                ┌─────────────────────┐   │   │
   │   │                                                │  service worker     │   │   │
   │   │                                                │  extension/sw.ts    │   │   │
   │   │                                                │  ├ port router      │   │   │
   │   │                                                │  ├ debugger orch.   │   │   │
   │   │                                                │  ├ chrome.alarms    │   │   │
   │   │                                                │  │   keep-alive     │   │   │
   │   │                                                │  └ chrome.runtime   │   │   │
   │   │                                                │    .connectNative ──┼───┼───┼───→ helper
   │   │                                                └─────────────────────┘   │   │
   │   └──────────────────────────────────────────────────────────────────────────┘   │
   │                                                                                  │
   │   ┌─ chrome.debugger.attach({tabId}, '1.3') ─────────────────────────────────┐   │
   │   │  ── attached only for CDP-only verbs (D5) ───────────────────────────────┘   │
   │   │     yellow banner shows during attach                                        │
   │   └──────────────────────────────────────────────────────────────────────────────┘
   └──────────────────────────────────────────────────────────────────────────────────┘
                                                                                       │
                                                          Native Messaging stdio JSON  │
                                                                                       ↓
                                                                        ┌─────────────────────┐
                                                                        │  helper (Node)      │
                                                                        │  helper/main.ts     │
                                                                        │  ├ pty-bridge       │
                                                                        │  │    node-pty      │
                                                                        │  ├ files-bridge     │
                                                                        │  │    chokidar      │
                                                                        │  │    fs            │
                                                                        │  └ protocol.ts      │
                                                                        └─────────────────────┘
```

### File layout

```
extension/
  manifest.json                       — MV3 manifest
  sw.ts                               — service worker entry
  sidepanel/
    SidePanel.tsx                     — root layout (rail + terminal + drawer)
    NavRail.tsx                       — 32px icon rail (D3)
    NavDrawer.tsx                     — sliding 280px filetree drawer (D3)
    sidepanel.html
  canvas/
    CanvasPage.tsx                    — hosts MarkdownEditor in a tab
    canvas.html
  shim/
    window-electron.ts                — D1 compat layer; same shape as renderer expects
    port-bridge.ts                    — chrome.runtime.connect + reconnect logic
  shared/
    protocol.ts                       — message types (re-exports shared/types.ts)

helper/
  main.ts                             — Native Messaging host (stdin/stdout JSON)
  pty-bridge.ts                       — node-pty integration
  files-bridge.ts                     — chokidar + fs
  protocol.ts                         — shared with extension/shared/protocol.ts
  bin/
    duo-helper                        — packaged binary (esbuild same as cli/duo)

installer/
  com.duo.helper.json                 — Native Messaging manifest template
  build-pkg.sh                        — macOS PKG build (signs + notarizes)

reused (NO COPIES — direct imports / reuse):
  renderer/components/TerminalPane.tsx
  renderer/components/FileTree.tsx
  renderer/components/editor/MarkdownEditor.tsx
  renderer/components/fileClassifier.ts
  renderer/keyboard/globalShortcuts.ts
  shared/types.ts                     — extended, not forked
  cli/duo.ts                          — adapted to talk to helper (TBD whether
                                        this is an adaptation or a sibling
                                        cli/duo-ext.ts; decide in Phase 5)
```

### IPC contract

The shim's `window.electron` shape stays compatible with the
existing one in [`electron/preload.ts`](../../../electron/preload.ts).
The transport changes:

```
renderer component
   ↓ window.electron.foo.bar(args)
shim (extension/shim/window-electron.ts)
   ↓ port.postMessage({channel: 'foo:bar', requestId, args})
service worker (extension/sw.ts)
   ↓ nativePort.postMessage({channel, requestId, args})
helper (helper/main.ts)
   ↓ <native-pty-or-fs-call>
   ↑ {requestId, result | error}
service worker
   ↑ port.postMessage(...)
shim
   ↑ resolves the request promise
renderer component
```

Event subscriptions (file watch, PTY data) go the other way through
the same port pair. The SW maintains a `Map<requestId, port>` and a
`Map<subscriptionId, port>` to route responses and events back to
the right tab.

---

## Build phases

Each phase ends in something demoable. Don't start phase N+1 until
phase N's pass criteria are green.

### Phase 0 — Native Messaging keep-alive proof (½ day)

**Gate.** If this fails, stop.

Build:

- Skeletal extension manifest with `nativeMessaging` permission only.
- SW that connects to a hello-world helper over
  `chrome.runtime.connectNative` and pings every 25s via
  `chrome.alarms`.
- Helper is a 50-line Node script that echoes back
  `{ok: true, t: Date.now()}` for every message and logs a "still
  alive" line every 30s.

Pass criteria:

- After 30 minutes of zero user interaction, the SW responds to a
  `from-test-page` ping in <100ms on first call.
- Helper process count remains exactly 1 throughout the test
  (`pgrep -c duo-helper`).
- No "port closed" / "host disconnected" events in the SW console.

If it fails: try increasing the alarm cadence (15s, 10s). If that
fails too, the SW is being aggressively killed for memory reasons
even with active alarms — which is the failure mode at
[claude-code#16350](https://github.com/anthropics/claude-code/issues/16350).
Close out the research with this finding.

### Phase 1 — Side panel UI scaffolding (1 day)

**Validate the 360px ergonomics with the hover navigator pattern
before wiring real PTY.**

Build:

- `extension/sidepanel/SidePanel.tsx` — 360px-min layout with
  32px nav rail on the left edge.
- `extension/sidepanel/NavRail.tsx` — single folder icon button
  (more icons later for skills, settings, etc.).
- `extension/sidepanel/NavDrawer.tsx` — 280px slide-in panel with
  mock filetree (hardcoded entries). `position: absolute`, slide
  from `translateX(-100%)` to `translateX(0)`, 200ms ease,
  backdrop-blur on terminal area.
- `TerminalPane` placeholder — empty xterm with mock prompt.
- ⌘+B toggles the drawer.

Pass criteria:

- Terminal is comfortably wide at default (no nav drawer): 360px
  minus 32px rail = ~328px ≈ ~44 columns. Acceptable for the kind
  of work an agent does.
- Drawer slide-in feels responsive (<250ms perceived).
- Click outside / Esc / file click all dismiss.
- ⌘+B works.
- Multi-window test: open a second Chrome window, second side panel
  opens, both share keyboard bindings, drawer state is per-window.

### Phase 2 — Real PTY (1 day)

Wire the terminal pane to a real `node-pty` process through the
helper.

Build:

- `helper/pty-bridge.ts` — spawns `node-pty`, pipes stdin/stdout
  through Native Messaging frames.
- `extension/shim/window-electron.ts` — implement `pty.create`,
  `pty.write`, `pty.resize`, `pty.kill`, `pty.onData`, `pty.onExit`.
- `extension/sidepanel/SidePanel.tsx` — replace mock terminal with
  the real
  [`renderer/components/TerminalPane.tsx`](../../../renderer/components/TerminalPane.tsx)
  importing from a local copy or via path mapping.

Pass criteria:

- `vim`, `less`, `htop` render correctly.
- Backspace doesn't lag.
- Resize event propagates (drag the panel wider, terminal cols update).
- ⌘+C / ⌘+V work.
- Run `claude` in the terminal — agent prompt loads, agent can run
  shell commands.

### Phase 3 — Real filetree + open canvas-as-tab (1 day)

Build:

- `helper/files-bridge.ts` — `files.list`, `files.read`,
  `files.write`, `files.watch` (chokidar).
- `extension/sidepanel/NavDrawer.tsx` — replace mock with real
  [`renderer/components/FileTree.tsx`](../../../renderer/components/FileTree.tsx).
- File click handler: `chrome.tabs.create({url:
  chrome.runtime.getURL('canvas/canvas.html?path=' + encodeURIComponent(path))})`.
- Canvas page placeholder for now — just renders the path.

Pass criteria:

- Filetree expands / collapses correctly.
- Modifying a file from the terminal (`echo hi >> foo.md`) updates
  the tree's modified indicator within 500ms.
- Click a `.md` file → new tab opens with the path in the URL bar.

### Phase 4 — MarkdownEditor in canvas tab (1 day)

Build:

- `extension/canvas/CanvasPage.tsx` — reads `?path=` from the URL,
  loads file via shim, mounts
  [`renderer/components/editor/MarkdownEditor.tsx`](../../../renderer/components/editor/).
- File change events from the helper push through to the canvas
  tab via SW → port routing.
- Drawer's nav drawer also subscribes; "modified" badge updates in
  the side panel when a canvas tab saves.

Pass criteria:

- Open `foo.md` in canvas tab, edit, save (⌘+S). Reopen the same
  file in a second canvas tab — sees the edits.
- Modify the file from the terminal — both canvas tabs pick up the
  change. (Conflict resolution: last-writer-wins for MVP; flag if
  this gets ugly.)
- Close all canvas tabs, helper still has zero leaked file watches
  (`lsof` check).

### Phase 5 — Tab-driving via lighter APIs (1 day)

Build:

- CLI verb dispatcher (decide in this phase: adapt
  [`cli/duo.ts`](../../../cli/duo.ts) or write a sibling
  `cli/duo-ext.ts`). The CLI runs *inside* the helper-spawned PTY,
  talks to helper over a local socket / pipe, helper bounces the
  command up to the SW.
- `duo nav <url>` — `chrome.tabs.update({tabId, url})` or
  `chrome.tabs.create({url})` depending on flag.
- `duo click <selector>` — `chrome.scripting.executeScript`
  injecting a click handler.
- `duo type <text>` — same pattern.
- `duo screenshot` — `chrome.tabs.captureVisibleTab`.
- `duo url`, `duo title` — `chrome.tabs.get`.

Pass criteria:

- Run all six verbs against an already-open Gmail tab while the
  user is signed in. No yellow banner appears.
- `duo screenshot` returns an image of the user's actual inbox.
- The "tab picker" UX (which tab is `duo nav` operating on?) feels
  reasonable — propose: target the active tab in the focused
  window by default; `--tab <id>` for explicit targeting; `duo tabs`
  lists open tabs with IDs.

### Phase 6 — `chrome.debugger` for CDP-only ops (½ day)

Build:

- `duo ax` — attach debugger, send `Accessibility.getFullAXTree`,
  detach.
- `duo console` — attach + stream `Runtime.consoleAPICalled` for
  the next N seconds, then detach.
- `duo errors` — attach + filter console for errors.
- SW orchestrates attach/detach so the yellow banner appears only
  for the duration of the operation.

Pass criteria:

- `duo ax` returns ~140-node AX tree on Gmail (matches
  duo-in-browser Walk 4 finding).
- Yellow banner appears during attach, disappears on detach.
- User clicking "Cancel" on the banner gracefully fails the
  in-flight call and emits an `agent.banner_cancelled` event the
  CLI prints clearly.

### Phase 7 — Distribution dry-run (1 day)

Build:

- `installer/build-pkg.sh` — packages the helper binary, the Native
  Messaging manifest, and an uninstaller. Signs with the same
  Developer ID Application cert Stage 21a uses. Notarizes via
  `notarytool`.
- Web Store unlisted submission of the extension.
- README install steps:
  1. Install extension from Web Store (paste the unlisted URL).
  2. Download `duo-helper-<version>.pkg`.
  3. Run installer.

Pass criteria:

- A friend who isn't a developer completes the flow in <5 min.
- `chrome://extensions` shows the extension listed.
- `chrome://extensions/?id=<id>` "details" view shows the requested
  permissions; the friend understands what they're for.
- Side panel opens. Terminal works. `duo edit foo.md` works.

### Phase 8 — Demo + buffer (½ day)

A scripted end-to-end demo that exercises every MVP capability in
one ~3 minute video / live session:

1. Open Chrome, click extension icon, side panel opens.
2. Toggle drawer with ⌘+B, navigate to a project, dismiss drawer.
3. Run `claude` in the terminal.
4. Agent runs `duo edit README.md` — new tab opens with markdown.
5. User edits in the new tab, saves.
6. Agent runs `duo nav https://gmail.com` — Gmail loads in another
   tab.
7. Agent runs `duo screenshot` — gets the rendered inbox.
8. Agent runs `duo ax` — yellow banner appears, AX tree returns,
   banner disappears.

If any step is awkward, fix it in this buffer or surface it
explicitly as a follow-up.

---

## Risks

Carried forward from the README's hard/soft blockers, with the
phase that catches each one:

| Risk | Severity | Caught in |
|---|---|---|
| SW idle / native-host death | Hard | Phase 0 |
| 360px terminal too cramped even with hover navigator | Soft | Phase 1 |
| Native Messaging 1MB message ceiling on large file reads | Soft | Phase 4 |
| `chrome.debugger` yellow banner intolerable for ambient agent use | Soft | Phase 6 |
| Two-step install too friction-heavy for Trailblazers | Soft | Phase 7 |
| File-conflict UX (two tabs of same file) ugly | Soft | Phase 4 |
| Enterprise extension policy blocks the permission set | Hard | Out of MVP — pre-Trailblazer audit |

---

## Definition of done

The MVP is done when **all** of the following are true:

1. Phase 0 passed and the SW + helper survive 30+ min of real idle.
2. A Trailblazer-shaped friend installs both pieces in <5 minutes
   without hand-holding from the project owner.
3. The Phase 8 demo runs end-to-end without a single
   reconnect-the-helper papercut.
4. The README's hard blockers are either resolved or have been
   explicitly re-classified as soft (with rationale).
5. A short follow-up addendum to
   [`./README.md`](./README.md) closes the research with a
   "ship-it / shelve-it / pivot-to-X" call.

---

## Effort estimate

| Phase | Days |
|---|---|
| 0 — Native Messaging keep-alive | 0.5 |
| 1 — Side panel + drawer | 1.0 |
| 2 — Real PTY | 1.0 |
| 3 — Filetree + canvas-as-tab | 1.0 |
| 4 — MarkdownEditor in canvas | 1.0 |
| 5 — Tab-driving (lighter APIs) | 1.0 |
| 6 — `chrome.debugger` ops | 0.5 |
| 7 — Distribution dry-run | 1.0 |
| 8 — Demo + buffer | 0.5 |
| **Total** | **7.5** |

Add a 30% buffer for MV3 papercuts and unknown unknowns: **≈ 10
working days**.

For comparison: Stage 21 (DMG + cert + notarization +
auto-update) absorbed somewhere north of two weeks across 21a/c.
The MVP, if it works, retires that ongoing cost going forward.

---

## What this plan does NOT cover

- **Roadmap promotion.** This is research. If the MVP succeeds, the
  next conversation is "do we promote this to a Stage card on
  [`docs/roadmap.html`](../../roadmap.html), and how does it
  sequence against the existing Trailblazer / Stage 21 work?" Not a
  Phase 8 task.
- **Skill / agent docs.** The `skill/` and `agents/duo.md` work for
  the extension's CLI verbs is post-MVP. The current verbs in
  [`skill/SKILL.md`](../../../skill/SKILL.md) and
  [`agents/duo.md`](../../../agents/duo.md) assume the Electron
  app's transport. The CLI plumbing checklist in
  [`CLAUDE.md`](../../../CLAUDE.md) needs an extension-shape
  variant added before the verbs ship to agents.
- **Architectural ADR.** If the MVP succeeds and we promote it,
  [`docs/DECISIONS.md`](../../DECISIONS.md) needs an ADR:
  "Extension + helper as a peer distribution shape to the Electron
  app" — including whether they coexist (two distribution targets)
  or the extension supersedes Electron over time.
- **Cross-platform helper.** Linux / Windows ports are a
  post-MVP build, not a polish step.

---

## Walk methodology notes

- Match
  [`../duo-in-browser/README.md`](../duo-in-browser/README.md) on
  reuse pattern: shim approach, no abstraction refactor of
  `renderer/`. The duo-in-browser walk validated this; don't
  re-litigate.
- Phase 0 is a real gate — no peeking ahead. The cost of building
  Phases 1–8 on a sandy SW foundation is not worth shaving the
  half-day.
- Helper binary should match the [`cli/duo`](../../../cli/duo) build
  pattern: esbuild bundle, tracked in git, committed alongside the
  source. One toolchain, two binaries.
- Test the Phase 0 idle pattern with a real human idle, not
  `setTimeout`. The SW scheduler interacts with system idle hints
  and wall-clock time in ways `setTimeout` cannot capture.
- The extension's manifest will need `host_permissions: ["<all_urls>"]`
  for `chrome.scripting`/`chrome.tabs` against arbitrary tabs. This
  is an alarm-bell permission set; document it crisply in the Web
  Store listing and the install README so the user understands what
  they're granting.
