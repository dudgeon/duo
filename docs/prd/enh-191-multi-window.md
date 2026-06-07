# ENH-191 — Multi-Window Support: Build Spec

> **▸ v2 (2026-06-05) — audit corrections folded in.** This revision re-verified every load-bearing anchor against **current `main` (Duo v0.8.6)** via a 15-agent adversarial audit (the v1 self-review in Appendix C was against v0.8.5 — now one release stale). Verdict held: **trustworthy-with-fixes** — the architecture and the registry-of-one de-risking sequence are sound; the corrections below are additive, not a teardown. **What changed in v2:**
> - **New Cut 0 — Phase H (write-serialization hardening), pulled forward** ahead of all multi-window work. Fixes a *latent-today* concurrent lost-update on the shared on-disk files (`pins`/`nav-pins`/`projects`/`session-state`). See Phase H + R6.
> - **P5 split into P5a (window-opening shell, flag-gated) + P5b (full CLI addressing).** The v1 single P5 understated the `--window` surface ~4–6× and was overloaded for one user-visible cut.
> - **Four "byte-identical at N=1, detonates at P5" gaps folded into their phases:** the `only()`-vs-`all()` send taxonomy (§3.1 + P2 item 10); the `ActiveWorkspaceService` per-window split that NFR-6.1 silently depends on (P3 item 10); the `SocketServer.eventSink` ambient-cue routing + the projects fan-out-to-all rule (P3 items 11–12); and the SessionStateService single-writer guarantee P4 was about to dismantle (P4 item 4, now "compose behind one writer").
> - **Magnitude corrections (re-grep traps):** "134 read-sites" is a `grep -c` *line* count, not a read count (~128 reads / ~185 refs); the guard-helper family is **46**, not ~30; the visibility cluster's third `executeJavaScript` is `revealMainPaneIfCollapsed`, **not** `openDevToolsForTarget` (which uses none); the grep-gate must also match the **optional-chain** form (`mainWindow?.webContents.send`, 8 sites incl. all 6 menu sends) — corrected baseline **37 send + 3 exec = 40**.
> - **Smaller folds:** `focusPane` is an inline NavBridge closure (not an export helper) and collides with P1's SocketServer lift (P1 item 1a / P2 item 4); the v0.8.6 BUG-191 `PTY_LIVE_CWDS` live-cwd surface is inventoried in P3 (per-caller-safe, no fix); `--window` is always parsed/resolved (only window-*opening* is flag-gated, §7.2); the `duo events` per-window decision is stated in P5b; the GAP-2 cue list is corrected (`browser:focus-gained` is already per-window-correct; the window-1-locked cue is the read-glow).

> **Read this top-to-bottom before writing any code.** This spec is fully self-contained: every file:line anchor, command, phase exit-gate, NFR, test, and guardrail a fresh agent needs is inlined here. You do **not** need any prior conversation, scratch notes, or `/tmp/*` files. All product and architecture decisions are **LOCKED** (§2) — your job is to *operationalize* them, never to re-decide. Anchors were verified against the live repo at spec-authoring time (Duo v0.8.5); where this document cites a line number, treat it as authoritative and re-grep if drift is suspected.

---

## Build status (live)

> **This PRD is the source of truth** for the multi-window feature — scope, phases, status, and lessons. The locked architecture is mirrored as an ADR in [`docs/DECISIONS.md`](../DECISIONS.md) ("Multi-window: registry-of-one spine + single socket"). Dev work lives on the worktree branch `claude/enh-191-multiwindow`; a **separate session integrates to `main`**.

| Cut | Phase | Status |
|---|---|---|
| Cut 0 | **Phase H** — write-serialization hardening (R6) | ✅ **Shipped** — PR #68 (merged) |
| (infra) | lint gate restored (`eslint` was undeclared / uninstalled) | ✅ Shipped — PR #69 (merged) |
| Cut 1 | **P0** — routing-assertion harness + color-override cut | ✅ **Seams complete** — `WindowRegistry` ✅ · `window-teardown` ✅ · color-override cut ✅ · smoke-checklist legs ✅ (the live single-window + Leg-B walk happens at the Cut 1 boundary) |
| Cut 1 | **P1** — lift app services + split `closed` handler | ✅ **Seams complete on dev** — P1a (external-domains + PTY sink) · P1b (SocketServer → app scope via getter-thunks; 29 sites) · P1c (split `closed`; app teardown at `before-quit` ONLY) · P1d (boot-race + dock-reopen harness). **949 tests** green, typecheck + lint clean. **Live smoke PASSED on the dev build (2026-06-07):** backgrounded-CLI ✓ · close→dock-reopen ✓ (socket stayed UP windowless, `app.activate`→createWindow reopened cleanly, CLI re-resolved) · quit-no-crash ✓ (⌘Q → exit 0, socket+port files unlinked). Cut 1 merge + run-on-`main` pending. |
| Cut 2 | **P2 + P3** — registry adoption (134 sites) + cache/event sweep | ⬜ Not started |
| Cut 3 | **P4** — `{windows: WindowState[]}` session envelope | ⬜ Not started |
| Cut 4a / 4b | **P5a / P5b** — open window 2 + terminal-origin + `--window` | ⬜ Not started |

**Last updated:** 2026-06-07 (P1 seams complete on dev + **live smoke PASSED**; Cut 1 merge + run-on-`main` pending). Update this table at each seam/cut boundary; lessons accrue in Appendix E.

---

## 1. Overview & Goal

Duo is a macOS desktop app pairing multiple Claude Code terminal sessions with an embedded Chrome browser, connected by a local `duo` CLI over a single Unix socket so Claude Code can read and drive the browser as naturally as it runs shell commands. Today Duo is **single-window to its foundations**: one `BrowserWindow`, one React renderer, one socket target.

**Goal:** convert Duo from single-window to **N independent windows**, each its own self-contained workspace (own focus, navigator cwd, `.duo-workspace`, pins, terminals, browser pane), with the `duo` CLI able to deterministically address any window from any terminal.

The difficulty is **not** Electron windowing (cheap). It is that three layers each assume exactly one window:
- **The addressing layer** — `DuoRequest = {id, cmd, args}` (`shared/types.ts:24`) carries no `windowId`; the CLI resolves one global socket path; every PTY is stamped with an identity-free `DUO_SOCKET` (`core/pty-manager.ts:48`).
- **The bridge layer** — a single `let mainWindow` (`electron/main.ts:249` → re-grep, ~`:252` in v0.8.6) is the send target for all main→renderer traffic, with `safeSend` (`:261`), `createWindow()` (`:509`), and the `closed` handler (`:956`) all hard-wired to it. **(v2 magnitude correction:** the frequently-cited "134 sites" is the raw `grep -c mainWindow` *line* count — it includes the declaration, 2 assignments, and 3 comments; true reads are ~128 lines / ~185 token-references, and the **dominant cluster is the 46** `if (!mainWindow || mainWindow.isDestroyed())` guard lines, which refactor as one unit. Scope P1/P2 by the 46-guard cluster + the send taxonomy, not by "134 edits.")
- **The cache layer** — **12** module-level snapshot singletons (navState, projectsState, activeTerminalId, …) that the renderer pushes identity-free and the CLI reads back last-writer-wins.

On top of that, "workspace" already means "the whole app": switching workspaces is `app.relaunch()` / full-renderer-reload against one flat `session-state.json`. So multi-window is not a flag flip — the window dimension must be threaded from scratch through the protocol, the dispatch bridge, every state cache, and the persisted session schema, while the CLI-is-the-spec rule (CLAUDE.md §3/§4) forbids any window the agent can't address.

**The shape of the build is one de-risking sequence, not a product ladder.** The scary core (replacing the `mainWindow` singleton with a window registry) lands *behind exactly one window* across a sequence of **zero-user-visible-change releases (P0→P4)**, culminating in a **single user-visible release (P5)**. The whole sequence is provably safe because a *registry-of-one* returning its sole entry is byte-identical to today's `mainWindow`.

**A note on test coverage (in scope, bounded).** The owner still finds bugs and regressions **by hand** because the only end-to-end net is a 487-line manual `docs/dev/smoke-checklist.md` and the entire ~44-file automated suite is pure-function / injected-IIFE-string (none exercise `main.ts` routing, the socket bridge, `PtyManager`, `SessionStateService`, or the caches). This spec's **in-scope** fix is a single **dependency-free node-env routing-assertion harness** (§5) — the first automated test to touch main-process routing. App-level checks keep using the net the project already has (the `duo` CLI + CDP + agent-run `/smoke-walk`). A broader e2e framework or a CI pipeline is **out of scope** here; if wanted, scope it as a separate testing/quality initiative so it never gates these cuts.

---

## 2. Locked Decisions & Invariants

These are **immutable**. If one appears wrong or under-specified mid-build, **stop and ask the owner** (do not silently substitute judgment — that is a named recurring failure mode). Use `AskUserQuestion` (batch ≤ 4 related; each option description ≤ ~15 words).

### 2.1 Product & architecture (locked)

| Decision | Choice |
|---|---|
| **Destination** | **N independent windows**, each its own workspace: own focus, navigator cwd, `.duo-workspace`, pins. |
| **Project membership/qualification** | **SHARED** (`projects.json`) — one identity model across all windows. |
| **Project colors** | **Hash-stable only.** Manual color-override is **CUT** in P0. |
| **Cozy mode** | **KEPT.** Owes a `duo cozy` verb + per-window `cozy.byTab` scoping. |
| **CLI targeting** | **Terminal-origin:** a `DUO_WINDOW` PTY env-stamp default + explicit `--window` + a new `duo windows` verb. |
| **Browser pane** | **Per-window** `BrowserManager` + `CdpBridge` (WebContentsView physics), but **SHARED** cookie/SSO partition + **SHARED** `browser-history.json` singleton. |
| **PTY pool** | One **shared** pool + `ownerWindowId` per `Session`; `disposeForWindow()`; `listIdsByCwd` filters by owner. |
| **Session restore** | Multi-window `{windows: WindowState[]}` envelope with back-compat migration. |
| **localStorage** | Per-key triage; per-window state moves **off** the shared storage-event bus. |
| **Lifecycle** | Window registry; per-window teardown (always) vs **app teardown at `before-quit` ONLY**. *(Owner-confirmed 2026-06-06, Option A — corrects the draft's "last-window/before-quit": app-scoped singletons are app-lifetime; on macOS a last-window-close is NOT a quit, so teardown-on-last-window kills the CLI bridge across a dock-reopen.)* **SINGLE Unix socket LOCKED.** |

### 2.2 The spine (non-negotiable, applies to every phase)

The `mainWindow`→registry + per-window `event.sender` refactor lands as a sequence of **ZERO-user-visible-change releases** (a *registry-of-one*), verified by a node-env routing harness + smoke-parity **BEFORE** any second window opens.

### 2.3 The cardinal rule — identity, not focus

**Every default-target send resolves by IDENTITY, NEVER by focus:**
- App-wide sends → `registry.only()?.window`.
- Push / reply / PTY handlers → `BrowserWindow.fromWebContents(event.sender)` (templated on the *already-correct* `FilesService.startWatch` handler at `electron/main.ts:1824`).

This is **verified safe**: there is exactly **ONE** `getFocusedWebContents()` call in the codebase today (`electron/main.ts:2182`, the user-initiated "Copy as Plain Text" menu item — **leave it**), and `safeSend` is wired pure-identity as `makeSafeSend(() => mainWindow)` (`electron/main.ts:261`). So `registry.only()` returning its sole entry is **byte-identical** to today. A focus-based "consistency-fix" toward `BrowserWindow.getFocusedWindow()` would silently drop the **backgrounded** socket/async/PTY sends that the 134 `mainWindow` read-sites deliver today — invisible to interactive testing because the single window is usually focused during a walk.

### 2.4 The no-vanity / no-focused-window-midpoint principle

**There is NO shippable focused-window-CLI midpoint.** A "multi-window where the agent can only drive the frontmost window" is an awkward half-built state, never a milestone. Decisive reason: once workspaces are independent, focused-window-wins is a silent foot-gun — a `duo` command issued in window 2's terminal would target whatever window is frontmost, silently mutating the **wrong** workspace (breaking CLI parity, CLAUDE.md §3/§4). And because the `DUO_WINDOW` stamp and per-window cache routing are the **same** `event.sender` seam, shipping focused-window-CLI then addressing later would touch that seam twice. **Window-opening and terminal-origin CLI addressing ship together** — **(v2)** specifically in **Cut 4a (P5a)**: the `DUO_WINDOW` stamp routes each window's own terminal to its OWN window, so 4a is NOT the forbidden "drive only the frontmost window" midpoint. Only the EXPLICIT cross-window `--window N` override + `duo windows` enumeration + the full verb-surface polish defer to **Cut 4b (P5b)**; the terminal-origin default — what stops the agent from ever silently mutating the wrong workspace — ships in 4a. **The v2 split therefore HONORS this lock, it does not violate it.** Every commit must de-risk a *verified* blocker or build the *only* automated net that runs in the Electron-absent environment (node-env); no "consistency fixes," speculative abstractions, or "while I'm here" cleanups.

---

## 3. Architecture

### 3.1 The registry-of-one spine

Replace `let mainWindow: BrowserWindow | null` (`electron/main.ts:249`) with a `WindowRegistry` wrapping a `Map<windowId, WindowContext>`. A `WindowContext` bundles **all per-window resources**: the `BrowserWindow`, its `BrowserManager`, its `CdpBridge`, its per-context `safeSend`, its per-window cache `Map` entries, its per-window `ClaudePresenceProbe`, its per-window active-workspace pointer, and its per-window `did-finish-load` boot/replay state.

The registry exposes O(1) resolution: `register(ctx)`, `unregister(id)`, `only()` (the sole context, or undefined/throw when count ≠ 1 per the agreed contract), `get(id)`, `all()`, `count()`. **At N=1, `registry.only() === ` the old `mainWindow` at every call** — making the ~128 read-sites provably byte-identical until a second window can exist (P5a).

**The send taxonomy is first-class (v2).** `registry.all()` is NOT decorative — it is the correct target for **shared-state broadcasts**, and the v1 spec used it zero times. Every default-target send must be classified into one of three classes at P2, because at N=1 all three are byte-identical (`only() === all()[0]`) and a mis-classification ships green through Cuts 1–3 then **detonates the instant window 2 opens**:
- **(i) app-wide-single** → `registry.only()` (becomes addressed at P5b).
- **(ii) shared-state-broadcast** → `registry.all()` fan-out: a change to a SHARED on-disk file (`projects.json` / `pins.json` / `nav-pins.json` / external-domains) must repaint **every** window's rail, not just the originator's. Concrete sites the v1 blanket-`only()` rule would have mis-routed: `PROJECTS_CHANGED` ~`main.ts:302`, `NAV_PINS_CHANGED` ~`:714/:1516`, `EXTERNAL_REDIRECTED` ~`:3656`. The code at ~`:1515` already anticipates this ("push … so any other subscriber (or other window someday) sees the change live").
- **(iii) per-window-addressed** → resolved by the invoking window (`event.sender`, or the `windowId` from P5b).

The old P2 "convert all reads to `only()`" instruction silently collapsed class (ii) into class (i). P2 item 10 (v2) makes the taxonomy an explicit deliverable with a harness fan-out assertion (a shared-state broadcast hits **every** registered context's fake send; negative control: an `only()`-converted broadcast FAILS the two-context fan-out test).

### 3.2 The three layers (what changes per layer)

| Layer | Today (single-window assumption) | After (window-dimensioned) |
|---|---|---|
| **Addressing** (protocol + CLI) | `DuoRequest = {id, cmd, args}`; one global socket path; identity-free `DUO_SOCKET` PTY stamp. | Optional `windowId?` on `DuoRequest`; `--window` override; `DUO_WINDOW` PTY env-stamp (terminal-origin default); `duo windows` enumeration verb; `SocketServer.handle` resolves `windowId`→context (errors cleanly on unknown). **Single socket stays locked.** |
| **Bridge** (main→renderer routing) | `let mainWindow`; `safeSend = makeSafeSend(() => mainWindow)`; `createWindow()` overwrites 4 process globals; `closed` handler tears down shared services on any close. | `WindowRegistry`; `safeSend = makeSafeSend(() => registry.only()?.window)`; reentrant `createWindow()` returns a `WindowContext`; `closed` handler split into per-window teardown (always) vs app teardown at `before-quit` only. Push/reply handlers resolve by `event.sender`. |
| **Cache** (read-model) | 12 last-writer-wins module singletons; 10 sender-blind reqId resolver Maps; one PTY pool with no owner. | Each cache → `Map<windowId, Snapshot>` keyed by `event.sender`; reqId replies validate `event.sender`; `Session` gains `ownerWindowId`; `listIdsByCwd` filters by owner; per-window presence + `activeTerminalId`; `{windows: WindowState[]}` session envelope. |

### 3.3 Per-window vs shared (the boundary)

| Per-window (its own `WindowContext` field / per-window state) | Shared (app-scoped singleton, injected — never re-constructed per window) |
|---|---|
| `BrowserManager` + `CdpBridge` (WebContentsView physics force this — a WCV attaches to exactly **one** window's `contentView`, `electron/browser-manager.ts:315`) | The `persist:duo-browser` cookie/SSO partition (one jar, `protocol.handle('duo-asset', …)` registered **once** at app scope, `electron/main.ts:~968/1019`) |
| Per-context `safeSend` (BUG-190 guard bound to that window) | `BrowserHistoryService` (single `browser-history.json` writer, `electron/main.ts:369`) |
| The 12 state caches → `Map<windowId, …>`; per-window active-workspace pointer (drives that window's title) | `SocketServer` (single Unix socket — **LOCKED**) |
| Per-window `ClaudePresenceProbe` + per-window `activeTerminalId` | `PtyManager` (one shared pool; `Session.ownerWindowId` routes PTY_DATA; `disposeForWindow(id)` scopes teardown) |
| Per-window `did-finish-load` boot/replay state (file-open stash + BUG-057 browser-pin restore) | `ExternalDomainsService`; `projects.json` / `pins.json` / `nav-pins.json` (shared identity; change broadcasts widen to all windows) |
| Per-tab UI prefs (`cozy.byTab`, `fontBump.byTab`); per-window `nav.cwd` / `nav.expanded` | Genuinely-global localStorage prefs (theme, author, autosave, send-pill flags, line-numbers, update-banner) stay on the storage-event sync bus; `nativeTheme.themeSource` is OS-global |

**Renderer is mostly free.** Each Electron window is its own renderer process with its own `window.electron` preload bridge and its own `window.__duoGetLayout` (registered per-renderer at `renderer/App.tsx:3622`), mounted via `createRoot` on its own document — so `App.tsx` "just works" per-window without a shared-singleton refactor. The effort is **overwhelmingly main-process**, with one renderer-side data-loss gate (the localStorage triage + per-tab prune, §4 P4).

---

## 4. Phased Implementation Plan (P0–P5)

> Use phase names and numbers **verbatim** — do not renumber. ALL decisions are LOCKED (§2); implement what is written.

### Verified magnitudes (anchored against live code at spec-authoring time)

> **⚠️ These are spec-authoring-time (v0.8.x) values.** P0 + P1 have since shipped on `claude/enh-191-multiwindow`; for the **current** spine anchors + the P2 grep-gate floor (now **41**), see **Appendix A → "Post-P1 re-baseline."** Re-grep against this branch's HEAD before depending on any line number below.

| Quantity | Value | Anchor |
|---|---|---|
| `let mainWindow` declaration | 1 | `electron/main.ts:249` |
| `mainWindow` references (**v2-corrected**) | **134 lines** = ~128 reads + 1 decl + 2 assigns + 3 comments (~185 token-refs) | "134 read-sites" conflates `grep -c` (lines) with reads — scope by the 46-guard cluster + send taxonomy |
| Guard-helper lines `if (!mainWindow \|\| mainWindow.isDestroyed())` (**v2 — was "~30"**) | **46** | grep `electron/main.ts` — the dominant read cluster, refactors as one unit |
| `safeSend` factory wiring | `makeSafeSend(() => mainWindow)` | `electron/main.ts:261` |
| `createWindow()` | 1 factory | `electron/main.ts:509` |
| `closed` handler | 1 | `electron/main.ts:956` |
| `getFocusedWebContents()` calls | **1** (the only one — leave it) | `electron/main.ts:2182` |
| `mainWindow.webContents.send` (bare) | 29 | grep `electron/main.ts` |
| `mainWindow?.webContents.send` (optional-chain — **v2, v1 MISSED these**) | **8** (incl. all 6 menu sends) | the grep-gate regex must match this form too, else the menu sends are invisible to the gate |
| `mainWindow.webContents.executeJavaScript` sites | **3** (visibility cluster) | grep `electron/main.ts` |
| Combined send (29 bare + 8 optional) + 3 `.executeJavaScript` — grep-gate baseline (**v2-corrected, was 32**) | **40** | regex `mainWindow\??\.webContents\.(send\|executeJavaScript)`; the count the gate keeps from rising |
| Module-level state caches | **12** | see P3 named list |
| reqId pending-resolver Maps | **10** | see P3 named list |
| `ipcMain.on`/`.handle` total (decorative — **do NOT scope P3 by this**, v2: the "35" was stale) | 100+ | use the explicit 13 PUSH + 10 reqId named lists, never a raw `ipcMain` count |
| PUSH/STATE handlers to key per-window | **13** | see P3 named list |
| FilesService correct-routing template | `event.sender` | `electron/main.ts:1824` (`FILES_WATCH_START`) — the unique `event.sender` consumer today |
| `PTY_LIVE_CWDS` live-cwd handler (**v0.8.6 BUG-191 — v2 inventory**) | request/response `.handle` ~`:1250` → `getLiveCwdsForIds` ~`:2716` | shared-pool read by tab-id; **per-caller-safe, NO fix** — inventory note in P3 only |
| `ActiveWorkspaceService` singleton (**v2 — needs per-window split**) | 1 shared `active-workspace.json` writer, `core/active-workspace-service.ts` | NFR-6.1's per-window title silently depends on splitting this; new P3 item 10 + P4 envelope home |
| Shared on-disk RMW writers w/ no serialization (**v2 — Phase H**) | `pins`/`nav-pins`/`projects` `await read()`→`await write()`, fixed `.duo.tmp` | `core/{pins,nav-pins,projects}-service.ts`; SocketServer dispatch is fire-and-forget (`socket-server.ts:413`) |
| `socket-server.ts` electron imports | `import type` only (erased) | → harness buildable day one |
| `SocketServer.handle()` dispatch switch | ~`:584` / `switch` ~`:589` | `core/socket-server.ts` |
| `ping`→`{version}` (entire `duo doctor` payload) | `:590-596` | `core/socket-server.ts` |
| PtyManager `Session` interface (no `windowId`) | `:7` | `core/pty-manager.ts` |
| PtyManager `dispose()` (kills ALL) | `:146` | `core/pty-manager.ts` |
| PtyManager PTY env stamp (`DUO_SESSION`/`DUO_SOCKET`, no `DUO_WINDOW`) | `:47-48` | `core/pty-manager.ts` |
| `listIdsByCwd(cwd)` | `:97` | `core/pty-manager.ts` |
| SessionStateService: `SESSION_PATH`/`SCHEMA_VERSION`/`pending`/`writeTimer` | `:44`/`:45`(=1)/`:54`/`:55` | `core/session-state-service.ts` |
| **Schema-version-mismatch-returns-empty guard** (downgrade safety net) | `:89-90` | `core/session-state-service.ts` |
| `SessionState` schema (no `windowId`) | `:697` | `shared/types.ts` |
| `DuoRequest` wire format (no `windowId`) | `:24` | `shared/types.ts` |
| cozy/fontBump `byTab` keys + prune-rebuild effect | keys `:49`/`:55`, prune `:2685-2710` | `renderer/App.tsx` |
| storage-event subscribers (cozy/fontBump are **NOT** among them) | autosave `:63`, sendPill `:61`, workspacePillMenu `:45` | `renderer/` |
| `__duoGetLayout` registration (per-renderer, already correct) | `:3622` | `renderer/App.tsx` |
| Visibility cluster `executeJavaScript` (**exactly 3**; v2-corrected identities) | queryRendererDom `:3076` / getLayoutSnapshot `:3159`+`:3174` / **`revealMainPaneIfCollapsed`** (the real 3rd) | `electron/main.ts` — re-grep |
| `openDevToolsForTarget` (**v2: does NOT use `executeJavaScript`** — v1 wrongly named it the 3rd visibility member) | ~`:3121` | still resolve by identity in P2, but it is NOT an `executeJavaScript` site |
| Dialog-parent cluster (C11) | `:1564` / `:2496` / `:2608` / `:2645` | `electron/main.ts` |
| App-scoped protocol (DO NOT TOUCH) | `registerSchemesAsPrivileged` `:36`; `protocol.handle` `:968/1019` | `electron/main.ts` |

**Cut structure (v2):** **Cut 0 = Phase H** (write-serialization hardening, pulled forward), **Cut 1 = P0+P1**, **Cut 2 = P2+P3**, **Cut 3 = P4**, **Cut 4a = P5a** (window-opening shell, flag-gated), **Cut 4b = P5b** (CLI addressing). Cut 0 and Cuts 1–3 are zero-user-visible internal-hardening releases; **Cut 4a is the first user-visible release** (a second window can open) and **Cut 4b makes every window agent-addressable** (CLI parity restored). Rollup estimate: **~13–17 eng-weeks across 6 cuts** — P3 and P5b are the heaviest; size the whole initiative from this, not from any single phase's number.

---

### Phase H — Write-serialization hardening (Cut 0, pulled forward)

*(internal-hardening, S–M — ~0.5–1 eng-week · deps: none · pulled AHEAD of P0 per owner decision 2026-06-05)*

**Goal.** Close a **latent-today** concurrent lost-update + temp-file-rename race on the shared on-disk JSON writers, BEFORE multi-window multiplies the write pressure. Independently shippable, pure-function/node-env testable, reverts cleanly, and not on the registry critical path — so it ships first, as its own zero-user-visible release, and gives P4 a hardened base.

**The verified hazard (R6).** `pins`/`nav-pins`/`projects` services each do an unserialized read-modify-write — `const cur = await this.list()` then `await this.write(next)` (`core/nav-pins-service.ts` `toggle()`, `core/pins-service.ts` `toggle()`, `core/projects-service.ts` `togglePin()`/`setColorOverride()`) — with **zero** mutex/queue/in-flight guard (grep-confirmed) and a **fixed shared** temp path (`<file> + '.duo.tmp'`). Two facts make this a real corruption window even at N=1: (a) the SocketServer dispatches **fire-and-forget** (`core/socket-server.ts:413` `this.handle(req).then(...)` — no await-chain; every request line spawns a Promise immediately), and (b) there are **two independent entry paths** — the socket (`socket-server.ts` `this.navPins.toggle(...)`) AND renderer-click IPC handlers (`main.ts` `pinsService.toggle` ~`:1505`, `navPinsService.toggle` ~`:1513`, `projectsService.togglePin` ~`:1612`). So a `duo` pin command + a navigator click interleave at the `await` boundaries: both read the old list, both compute `next`, the second `write` clobbers the first (lost update), and the two `rename`s can race the same `.duo.tmp` (one writer's `rename` fires while the other is mid-`writeFile` → a truncated tmp renamed into place). **Appendix C named this class and WRONGLY dismissed it** ("they funnel through main, so likely safe") — single-process does NOT serialize async RMW that interleaves at `await` points. §3.3 LOCKS these files SHARED with "broadcasts widen to all windows," which only **increases** the pressure they are about to face.

**Work items:**

1. **Add a per-service write-serialization queue** — a chained promise so each `toggle`/`add`/`togglePin` awaits the prior write before its own read-modify-write (the RMW becomes atomic per file). Smallest correct form: one `private chain: Promise<void>` per service that each mutation appends to.
2. **Give each atomic write a UNIQUE temp suffix** (e.g. `<file>.<pid>.<rand>.duo.tmp`) so concurrent `rename` targets can never collide, even across processes.
3. **Confirm + harden `SessionStateService`** as the foundation P4 builds on. Verify its existing `writing`-flag single-writer property (`core/session-state-service.ts` `flush()` `if (this.writing) return`) still holds and give its write a unique tmp suffix. P4 then **keeps** this single-writer guarantee (compose-behind-one-writer) rather than dismantling it.
4. **Pure-function lost-update tests (node-env, fits the harness):** fire two interleaved toggles against a fake fs and assert **both** updates survive; a **negative control** where the un-serialized RMW (current code) FAILS the both-survive assertion. One per service.

**Exit criteria.** Two-interleaved-writer test green (un-serialized negative control proven to fail); unique-tmp-suffix on all four writers; no behavior change to single-writer paths (smoke § project-rail / pins / nav-pins toggles unchanged); `typecheck` + `test:run` + `lint` green. Then **Cut 0 (Phase H):** zero-user-visible internal-hardening release — confirm the rail/pins/nav-pins still toggle single-window, then `/cut-version` (no `/smoke-walk` handoff required; no UI surface changed).

> **Why first, not folded into P3/P4 (owner decision 2026-06-05):** the bug exists *today* and is independent of the registry refactor, so isolating it as Cut 0 (a) ships a real fix sooner, (b) shrinks P3/P4, and (c) gives P4's compose-behind-one-writer a hardened base instead of a racing one.

---

### P0 — Routing-assertion harness + low-risk prep (color-override cut)

*(test-infra, M — ~1 eng-week · deps: none)*

**Goal.** Build the FIRST automated test layer that touches `main.ts` routing at all — a **node-env** harness (modeled on `electron/safe-send.test.ts`, no Electron) asserting window-resolution, cache-keying, reqId sender-validation, and teardown-once. In the same release, cut the now-orthogonal manual project color-override so project colors become hash-stable, before any per-window work touches the projects derivation.

**Work items:**

1. **Extract a `WindowRegistry` pure module** at `electron/window-registry.ts` (new), mirroring `electron/safe-send.ts`. Define `WindowContext` (`id`, `window: WindowLike`, and — populated later — `browserManager`, `cdpBridge`, `safeSend`). Implement `register/unregister/only/get/all/count`. Reuse the `WindowLike` interface from `electron/safe-send.ts`. **Do NOT wire into `main.ts` yet** — P0 ships the module + tests only; P2 adopts it.
2. **Extract a teardown orchestrator** `electron/window-teardown.ts` (new) — a pure function that, given a `WindowContext` and `isLastWindow: boolean`, invokes the ordered dispose steps: per-window (`browserManager.dispose`, `cdpBridge` detach) vs app-level (`socket.stop`, `external.dispose`). Inject disposables as duck-typed callbacks (the `safe-send` injection style). **Not wired into `main.ts` yet.**
3. **Write the harness** `electron/window-registry.test.ts` (node-env). With fake `WindowLike`/`webContents` spies, assert: (1) `registry.only()` returns the sole context; (2) an identity-resolved send routes to that context's fake `webContents.send`; (3) a one-sender push populates a `Map<windowId, Snapshot>` under the registry id and the getter reads it back; (4) a reply from the recorded target resolves a pending reqId while a **foreign** fake sender does NOT; (5) the teardown orchestrator fires `socket.stop` + `browser.dispose` + `external.dispose` **exactly once** for the last/only window. **Include NEGATIVE CONTROLS that MUST fail:** a deliberately focus-resolved send (catches `getFocusedWindow()`-style substitution) and a deliberately mis-keyed cache.
4. **Cut the manual project color-override** (the write-path is dead but the data is woven through derivation — verified: grep for `.setColorOverride` in `renderer/` returns **zero** live callers): remove the `PROJECTS_SET_COLOR_OVERRIDE` IPC handler (~`main.ts:1607`/`1617`), the preload bridge (~`electron/preload.ts:826`), `projectsService.setColorOverride`, the `host-api.ts` method (~`:1009`), the `colorOverrides` input to `deriveProjects`/`colorIndex` in `shared/projects.ts` (decl ~`:170`, derivation ~`:276`, parse ~`:456`), and the `colorOverrides` state in `renderer/App.tsx` (~`:899`). After the cut, `colorIndex` is purely hash-derived. Honor the locked no-color-drift invariant.
5. **Extend `shared/projects.test.ts`** to assert `colorIndex` is hash-derived with **no** override input (two runs with identical project sets → identical indices; no `colorOverrides` field consulted).
6. **Add the two leak-hunting smoke steps to `docs/dev/smoke-checklist.md`** in a new "Multi-window invisible-refactor parity" subsection — they run as the smoke-parity leg of EVERY invisible release P1–P4: **(A) BACKGROUNDED-CLI** — with Duo NOT frontmost, run `duo url` / `duo nav-state` / `duo send` / `duo open` **plus the visibility cluster** `duo dom` / `duo eval` / `duo layout` / `duo devtools` and confirm sends still land. **(B) QUIT-NO-CRASH** — Cmd+Q with one window → no looping crash dialog AND `duo doctor` shows socket DOWN; relaunch clean.

**Exit criteria.** Harness committed and green (node-env, no Electron — runs anywhere); provably FAILS when the focus-resolved-send or mis-keyed-cache negative control is injected. Color-override removed end-to-end (grep clean); `projects.test.ts` green; single-window smoke § project-rail unchanged; colors hash-stable. `npm run typecheck` + `npm run test:run` + `npm run lint` green.

---

### P1 — Lift app-level services out of `createWindow()` + split the `closed` handler

*(internal-refactor, L — ~1.5–2 eng-weeks · deps: P0)*

**Goal.** Make the app safely **re-enterable** WITHOUT yet opening a second window. Lift app-scoped services OUT of `createWindow()` to app-boot scope; split the `closed` handler into per-window teardown (always) vs app teardown at `before-quit` only. The app still opens exactly ONE window. Zero user-visible change. This isolates the **highest-residual-risk seam** (BUG-190 quit-loop / teardown-vs-PTY-flush timing) into its own release.

**Work items:**

1. **Lift `SocketServer` construction** (~`main.ts:635`) OUT of `createWindow()` to app-boot scope (inside `app.whenReady()`, after the protocol handler, constructed **once**). The single socket cannot be constructed inside a factory that may be called twice (double-bind / corrupt CLI). **Constraint:** SocketServer's constructor takes `cdpBridge`/`browserManager`, which become per-window in P2 — pass an indirection seam (a `() => registry.only()` getter shape, or a temporary module-global the P2 registry replaces) so the lift doesn't hard-bind the socket to one window's managers. **State the chosen seam in the PR.**
   - **1a. (v2) The NavBridge literal lifts WITH the socket.** `new SocketServer(...)` is passed a NavBridge object literal (~`main.ts:638`) containing **inline closures that capture `mainWindow`**: `focusPane` (~`:708`, sends `PANE_FOCUS_JUMP`), `sessionList` (~`:685`), `sessionResume` (~`:689`). When SocketServer lifts to app scope these closures lift too — route their window/pty access through the **same** indirection seam, **not** a captured module global (fine at N=1, wrong target at N>1). Note for P2: `focusPane` is therefore **NOT** an "export helper" (there is no `function focusPane`) — do not look for one to convert; convert the closure via the seam.
2. **Lift `ExternalDomainsService` construction** (~`main.ts:564`) to app-boot scope.
3. **Lift the `PtyManager.setEventSink` wiring** (~`main.ts:547`, the `safeSend`-backed sink) to app scope so re-entrancy doesn't register a second sink. (Per-Session owner-routing lands in P3; P1 only relocates.)
4. **Split the `closed` handler** (`main.ts:956-963`). Today: `socketServer?.stop(); browserManager?.dispose(); externalDomainsService?.dispose()` + nulls four globals on ANY close. Replace with: **per-window teardown** (dispose only THAT window's `browserManager`/`cdpBridge`/listeners) always; **app teardown** (`socketServer.stop()` + `externalDomainsService.dispose()`) **only on `before-quit`** (NOT on last-window-close). **⚠️ DO NOT re-add last-window-close app teardown** — on macOS `window-all-closed` no-ops, so a last-window-close is NOT a quit; stopping the socket there leaves the CLI bridge dead across a dock-reopen (`app.activate → createWindow` no longer re-creates the socket). Owner-confirmed Option A, 2026-06-06 (see §2.1 + Appendix E). Wire through the P0 `window-teardown.ts` orchestrator so ordering is the tested one. Must be idempotent (a `closed` followed by `before-quit` must not double-stop the socket). **(v2)** These three teardowns at ~`:960-962` are the **ONLY** `.stop()`/`.dispose()` call-sites for `socketServer`/`externalDomainsService` (and the window-close branch of `browserManager`) — there is no separate app-quit path that re-runs them. So the `before-quit` branch must be the **guaranteed single firing site**: the idempotency guard must prevent *double*-running, never *skip* a `closed`→`before-quit` sequence. Preserve the optional-chaining (`?.`) form on all three.
5. **Re-pin the BUG-190 destroyed-window guard** against the (still single) per-context target. `electron/safe-send.test.ts` must continue to pass unchanged (the "re-reads the window on each call" contract).
6. **DO NOT lift `protocol.handle` / `registerSchemesAsPrivileged` / the `persist:duo-browser` partition.** These are **ALREADY app-scoped** (`main.ts:36`, `:968/1019` inside `whenReady`). The "double-register hazard" does not exist today; P1 must not introduce motion here. (The inverse guard — a per-window BrowserManager must NOT re-register the partition — is a **P2** exit criterion.)
7. **Update the P0 teardown harness** to assert the orchestrator fires each of `socket.stop` / `browser.dispose` / `external.dispose` exactly once for the sole (= last) window — no double-dispose, no missed dispose (negative controls for both).

**Exit criteria.** App boots one window with `SocketServer`/`ExternalDomainsService` constructed at app scope; closing the only window tears down the socket exactly as today; Cmd+Q crash-free; `duo doctor` shows socket DOWN after quit; full single-window smoke-checklist passes **unchanged**; teardown-once harness green. Then **Cut 1 (P0+P1):** `/smoke-walk` via Skill tool (Leg B walked + full single-window checklist; wait for pasted results) → `/cut-version`.

---

### P2 — Reentrant `createWindow()` → `WindowContext` registry-of-one + identity-resolve the 134 send sites

*(internal-refactor, L — ~2–2.5 eng-weeks · deps: P1)*

**Goal.** Replace `let mainWindow` (134 read-sites) with the `Map<windowId, WindowContext>` registry, bundling each window's `BrowserManager` + `CdpBridge` + per-context `safeSend`. Rewire the safe-send thunk from `() => mainWindow` to `() => registry.only()?.window`, and convert export-helper direct reads + push/reply dispatch to resolve by **IDENTITY**. Still exactly ONE registered window — so `registry.only() === ` the old `mainWindow` at every call, making all 134 sites **provably byte-identical**.

**Work items:**

1. **Make `createWindow()` reentrant** (`main.ts:509`): build and **return a `WindowContext`**, attach all per-window listeners (`did-finish-load`, zoom, console-forward, `closed`) to THAT window's webContents, and **never touch process-global singletons**. Register the context. Keep the `app.activate` zero-window guard (~`:1186`) as correct macOS dock behavior.
2. **Move `BrowserManager` + `CdpBridge` from module globals into `WindowContext` fields.** Zero-change at N=1 (`createWindow` already constructs exactly one `CdpBridge` + one `BrowserManager` today — this is a relocation).
3. **Rewire `safeSend`** (`main.ts:261`) from `makeSafeSend(() => mainWindow)` to `makeSafeSend(() => registry.only()?.window ?? null)`. The BUG-190 guard contract is preserved (`safe-send.ts` unchanged).
4. **Convert the export-helper direct `mainWindow` reads** (the `sendReveal`/`sendView`/`sendEdit`/`setSplit`/`setProjectFocus`/`setSelectionFormat` family — each guarded `if (!mainWindow || mainWindow.isDestroyed())` then `.webContents.send/executeJavaScript`) to resolve **per the send taxonomy (item 10)** — most are class-(i) `registry.only()`, the shared-state broadcasts are class-(ii) `registry.all()`. **(v2 corrections:** the guard family is **46** lines, not "~30"; and `focusPane` is **NOT** in this family — it is an inline NavBridge closure handled via the P1 item 1a seam, not an export helper, so do not look for a `function focusPane` to convert.)
5. **Convert push/reply dispatch handlers to the `event.sender` identity template** — use `FilesService.startWatch` (`main.ts:1824`) as the canonical pattern. (Full cache-keying is P3; P2 establishes the mechanism.)
6. **Identity-resolve the visibility cluster** (queryRendererDom executeJavaScript `:3076`; getLayoutSnapshot `:3159`+`:3174`; `openDevToolsForTarget` ~`:3121`). These are live `executeJavaScript` round-trips — **structurally untestable by the harness** — so they MUST resolve by `registry.only()` (NOT focus) and be enumerated in the P2 smoke-parity leg. *(CLAUDE.md tells agents to reach for `duo dom`/`duo eval`/`duo layout`/`duo devtools` FIRST when debugging blind, so a wrong-window answer actively misleads — highest-consequence focus-substitution member.)*
7. **Move the `did-finish-load` boot/replay state into the `WindowContext`** (`main.ts:780`). Today it replays a module-global stashed file-open (`pendingOpenFilePath` ~`:272`, consumed ~`:913`) and runs the BUG-057 browser-pin-restore loop — both module-global. Make each window's replay self-scoped (stash + pin-restore arming become context fields). Zero-change at N=1; prevents window 2's `did-finish-load` firing the replay for the wrong window.
8. **Add the partition/SSO/history shared-singleton guard.** Each per-window `BrowserManager` **must NOT re-register the `persist:duo-browser` partition handler** (duplicate-handler crash) and **must share the ONE cookie/SSO jar** and the ONE `BrowserHistoryService` (`main.ts:369`, injected — not constructed per window).
9. **Add the `mainWindow` grep-gate** as a local script (`check:routing`): fail the build on any NEW `mainWindow` send outside the registry/safe-send seam. **(v2) The regex MUST match BOTH token forms** — `mainWindow\??\.webContents\.(send|executeJavaScript)` — because v1's bare-`mainWindow.` regex silently missed the **8 optional-chain `mainWindow?.webContents.send` sites (all 6 menu sends + 2 others)**, the very form the codebase uses for inline handlers. Also gate `dialog.*(mainWindow, …)` and any new `getFocusedWindow`/`getFocusedWebContents` (allowlist the one legitimate `getFocusedWebContents()` at `:2182`). Baseline: the combined count (**40** = 29 bare + 8 optional send + 3 exec) may only ever **drop**, never rise. Ship a negative-control fixture that adds a `mainWindow?.webContents.send` and proves the gate fails on it. (Details: §5.3.)

10. **(v2) Make the `only()`-vs-`all()` send taxonomy an explicit deliverable** (§3.1) — the #1 "byte-identical at N=1, detonates at P5a" gap. Classify all 40 `mainWindow` sends into (i) app-wide-single → `registry.only()`, (ii) shared-state-broadcast → `registry.all()` fan-out, (iii) per-window-addressed → invoking window. Convert the class-(ii) broadcasts to `registry.all()`: `broadcastProjectsChanged`/`PROJECTS_CHANGED` (~`:302`), `pushNavPinsChanged`/`NAV_PINS_CHANGED` (~`:714/:1516`), `EXTERNAL_REDIRECTED` (~`:3656`). Harness assertion: a class-(ii) broadcast reaches **every** registered context's fake send; **negative control:** an `only()`-converted broadcast FAILS the two-context fan-out test. (Same `all()` seam serves the P3 item 12 projectsState fan-out.)

**Exit criteria.** `registry.only()` proven identity-equal to old `mainWindow` in the harness; backgrounded-CLI smoke step passes (no dropped sends) **including the visibility cluster**; all browser/editor/nav/project CLI verbs byte-identical in the one window; `did-finish-load` replay state is per-context; per-window BrowserManager shares partition/SSO/history; grep-gate active (both token forms, baseline 40); the send taxonomy is classified and the class-(ii) broadcasts fan out via `registry.all()` (harness fan-out assertion + `only()`-negative-control green); full single-window smoke-checklist unchanged. `typecheck` + `test:run` + `lint` + `build` green.

---

### P3 — Per-window state caches + PTY `ownerWindowId` + reqId sender-validation (the `event.sender` sweep)

*(internal-refactor, XL — ~3–3.5 eng-weeks · deps: P2 · **v2: re-baselined +0.5wk** to absorb the `ActiveWorkspaceService` split + eventSink routing + projects fan-out folded in below)*

**Goal.** Generalize the `event.sender` template across the whole read-model: un-discard `_event` in the **13** PUSH/STATE handlers and key each of the **12** caches into a `Map<windowId, …>` with identity-resolved readers; add `ownerWindowId` to PtyManager `Session`; add `event.sender` validation to the **10** reqId reply families. Still ONE window — every change is zero-behavior at N=1 (one sender → constant key; one owner → same target as today's unconditional `safeSend`).

**The verified sweep surface (iterate this exact set — "35 push handlers" is the *total* `ipcMain.on` count and conflates PTY/dialog handlers, NOT the cache surface):**

- **12 caches → `Map<windowId, …>`** (decl anchors): `navState` (`:123`), `editorSelection` (`:136`), `canvasSelection` (`:141`), `themeState` (`:173`), `claudeKeyPrefsState` (`:180`), `authorState` (`:190`), `selectionFormatState` (`:197`), `workingAuxSnapshot` (`:204`), `activeTerminalId` (`:210`), `projectsState` (`:305`), `workspacePillMenuEnabledCache` (`:335`), `cozyActiveTab` (`:495`). *(Per-key triage note: `themeState`/`authorState`/`selectionFormatState` are candidates to stay app-global preferences — P4's localStorage triage finalizes which keys are genuinely global; in P3 they still get keyed for routing correctness, global ones reading a shared default. `nativeTheme.themeSource` is OS-global and stays a singleton.)*
- **13 PUSH/STATE handlers → un-discard `_event`, key by `BrowserWindow.fromWebContents(event.sender)`** (anchors): `PROJECTS_STATE_PUSH` (`:1841`), `WORKSPACE_PILL_MENU_PUSH` (`:1847`), `NAV_STATE_PUSH` (`:1851`), `EDITOR_SELECTION_PUSH` (`:1873`), `PAGE_SELECTION_PUSH` (`:1878`), `THEME_STATE_PUSH` (`:1973`), `CLAUDE_KEY_PREFS_STATE_PUSH` (`:1983`), `AUTHOR_STATE_PUSH` (`:1993`), `SELECTION_FORMAT_STATE_PUSH` (`:2000`), `WORKING_AUX_STATE_PUSH` (`:2009`), `TERMINAL_ACTIVE_PUSH` (`:2018`), `COZY_STATE_PUSH` (`:2045`), `SESSION_STATE_SNAPSHOT_RESULT` (`:1953`).
- **10 reqId families → capture + validate `event.sender` in the result handler** (decl anchors): `docWritePending` (`:144`), `docReadPending` (`:147`), `docGotoPending` (`:151`), `docFindPending` (`:152`), `htmlOpPending` (`:155`), `imageInsertPending` (`:159`), `htmlCommentPending` (`:163`), `htmlCommentsListPending` (`:164`), `sessionSnapshotPending` (`:169`), `newTabPending` (`:232`). Reply handlers (~`:1885/:1893/:1902/:1911/:1920/:1929/:1938/:1945/:1954/:2034`) match by reqId only today — add a sender check so only the targeted window can resolve its own reqId. (Maps stay global; reqIds are random so collisions are vanishingly unlikely — only the **request** must go to a chosen window and the **reply** be validated.)

**Work items:**

1. **Key each of the 12 caches into `Map<windowId, Snapshot>`** and convert their getters (CLI read-path) to resolve the target window (at N=1, the sole registered id). Reconcile menu-checkmark side-effects that read these caches (Show-Hidden-Files reconcile in `NAV_STATE_PUSH`, cozy checkmark) so they still fire for the correct window.
2. **Un-discard `_event` in the 13 PUSH/STATE handlers** and write to the per-window cache slot keyed by `BrowserWindow.fromWebContents(event.sender)`.
3. **Add `ownerWindowId` to PtyManager `Session`** (`core/pty-manager.ts:7`). Route `PTY_DATA`/`PTY_EXIT` to the **owning** window's webContents (the EventSink looks up owner before sending; **fall back to the sole window when an owner isn't yet resolvable** — guards the cold-start drop risk).
4. **Replace `dispose()` with `disposeForWindow(windowId)`** (`core/pty-manager.ts:146`) that filters sessions by owner. Only true app-quit (`before-quit`, ~`main.ts:1203`) calls a global dispose. **Verified hazard:** `dispose()` is currently called both on before-quit AND inside `applyNewSessionState` (~`main.ts:2717`) — the workspace-swap path must become per-window scoped (groundwork; full open-as-new-window is P5).
5. **Filter `listIdsByCwd` by owner** (`core/pty-manager.ts:97`). `ownerWindowId` is necessary but NOT sufficient — the C9 positional cwd→tabId match (~`main.ts:436`, `tabsThatHostedClaude`) breaks when the shared pool returns same-cwd terminals from multiple windows interleaved. `listIdsByCwd` must accept/filter by owner so presence-trigger paths don't mis-align.
6. **Add `event.sender` validation to the 10 reqId reply families.** Capture the target window at dispatch; in each result handler, drop a reply whose `event.sender` doesn't match. Behavior-preserving at N=1. **Sweep all 10 in one pass** to avoid a half-done migration.
7. **Add a dormant `DUO_WINDOW` PTY env-stamp** (`core/pty-manager.ts:47-48`, alongside `DUO_SESSION`/`DUO_SOCKET`) as a **no-op** — set it to the owner's window id but DO NOT consume it yet (CLI default-resolution ships in P5).
8. **Per-window `ClaudePresenceProbe` + per-window `activeTerminalId`** (~`main.ts:215`/`:210`). Scope the presence triple-fan-out (`safeSend(TERMINAL_CLAUDE_PRESENCE_CHANGED)` ~`:768` + `cdpBridge.setClaudeLive` ~`:770` + `browserManager.broadcastClaudeLive` ~`:776`) to the originating window. At N=1, same target as today. *(See NFR-1.3 for the idle-probe CPU mitigation that lands with this work.)*
9. **Extend the harness:** a one-sender push populates the per-window Map under the registry id and the getter returns it; a reqId reply from the recorded target resolves while a foreign fake sender is dropped; `disposeForWindow(only)` kills the same session set `dispose()` did; the owner-routing sink delivers `PTY_DATA` to the sole window's fake sink for every session **AND** falls back when owner is transiently unresolved. **Iterate the actual 13 PUSH + 10 reqId named families** (write as `describe.each` over the literal name lists) so completeness is mechanically checkable.

10. **(v2) Split the `ActiveWorkspaceService` singleton into a per-window pointer** — NFR-6.1 (per-window titles) silently depends on this and the v1 P3 never operationalized it (it was a phantom phase-assignment with no work item). Today `core/active-workspace-service.ts` is a single-cached singleton writing ONE shared `active-workspace.json`. Make the active-workspace pointer a `WindowContext` field (or `Map<windowId, ActiveWorkspace>` keyed by `event.sender`); the per-window title (`applyWindowTitle` ~`:2444`) **and** the `WORKSPACE_FILE_ACTIVE_CHANGED` push (~`:2454`, the in-app titlebar badge — equally window-global) both read THAT window's pointer. **Persistence home is the P4 envelope** (fold the pointer into each `WindowState`, not the standalone shared file two windows clobber — see P4 item 8). *Soft P2 dependency: `applyWindowTitle()` is called inside `createWindow` at ~`:545`, so a reentrant `createWindow` titles window 2 from window 1's workspace until this lands.*

11. **(v2) Resolve the target window for `SocketServer.setEventSink`** — a THIRD routing root the v1 P3 missed, distinct from the PtyManager EventSink (item 3) and the 12 caches. `socketServer.setEventSink` (wired ~`main.ts:740`) carries ambient cues through `safeSend`→`mainWindow`, so they always paint in window 1. The command emitting a cue already knows which window it addressed — thread that so the cue lands in the addressed window. **(v2 cue-list correction:** the genuinely window-1-locked cue is the **read-glow** (`claude:read-selection`, `socket-server.ts:978`); `browser:focus-gained`'s canonical emit (`browser-manager.ts:1446` via `this.window`) is **already per-window-correct** and self-fixes with the P2 per-window BrowserManager — only the `duo open` supplemental push at `socket-server.ts:738` uses the window-1 path.)

12. **(v2) Fan-out-to-all for shared-state pushes.** Because `projectsState` + the pin caches become per-window-keyed (item 1) while `projects.json`/`pins.json`/`nav-pins.json` stay SHARED, a pin/membership change must push `PROJECTS_STATE` / nav-pins state to **ALL** windows, not just the originator — the read-model counterpart of the P2 item 10 `all()` send taxonomy. Harness: a shared-file change repaints every registered context.

> **(v2) Inventory note — NO fix:** `PTY_LIVE_CWDS` (`main.ts:1250` → `getLiveCwdsForIds` ~`:2716`, added v0.8.6 BUG-191) is a renderer→main pull over the SHARED PTY pool keyed by tab id. It is **already per-caller-safe** (a request/response `.handle` — the reply returns to the invoking sender — and each window passes its own ids), so it needs **NO change**; list it as already-correct so the P3 completeness audit doesn't flag it as an unaccounted handler. (Contrast `listIdsByCwd`, item 5, which DOES need owner-filtering because it returns ids the caller did not enumerate.)

**Exit criteria.** Harness green on cache-population, reqId-sender-drop, dispose-by-owner, PTY owner-routing-with-fallback, and `listIdsByCwd` owner-filter; all read-verbs byte-identical at N=1; terminal output + `duo send` unchanged; menu-checkmark side-effects still fire; **(v2)** per-window titles read the per-window active-workspace pointer (not the singleton), `SocketServer.eventSink` cues resolve to the addressed window, and a shared-file change fans out to all registered contexts; full single-window smoke passes. No `DUO_WINDOW` consumer yet (dormant). Then **Cut 2 (P2+P3):** `/smoke-walk` via Skill tool (full single-window matrix + backgrounded-CLI incl. visibility cluster; wait for pasted results) → `/cut-version`.

---

### P4 — localStorage per-key triage (HARD GATE) + multi-window session-state envelope

*(internal-refactor, L — ~2 eng-weeks · deps: P3 for release-isolation, NOT a hard code dependency)*

**Goal.** Two persistence changes that MUST precede a second window, still landing at N=1: **(a)** localStorage triage (locked) — keep genuinely-global prefs on the storage-event sync bus, move per-window state OFF it; **(b)** reshape `session-state.json` from one flat document into a `{windows: WindowState[]}` envelope with a back-compat migration. This closes the verified **DATA-CORRUPTION hard gate**.

> **Ordering note (surface, don't infer a false dependency):** P4 is renderer-side localStorage + `SessionStateService` schema — both **pure-function testable** and neither reads the main-process registry. Its position AFTER P3 is a **release-isolation choice** ("no migration alongside routing"), **NOT** a code prerequisite. Because P4 fixes the only verified **data-loss** class (recoverable mis-routing is P2/P3's domain), a defensible alternative front-loads it right after P0/P1 to shrink the window during which a contributor prototyping window 2 could hit live data loss. The default here keeps the locked sequence; the alternative is noted for the executor/owner.

**The verified hard gate (C13):** `renderer/App.tsx` rebuilds the ENTIRE cozy/fontBump `byTab` map from **only this window's** live tab ids (the prune effect at `:2685-2710`, rebuilding from `liveIds`) and writes it to the shared-origin keys `COZY_BY_TAB_KEY='duo.cozy.v1.byTab'` (`:49`) / `FONT_BUMP_BY_TAB_KEY='duo.fontBump.v1.byTab'` (`:55`). **Verified:** cozy/fontBump are NOT in the storage-event subscriber set (only autosave `:63`, sendPill `:61`, workspacePillMenu `:45` subscribe) — so the moment window 2 mounts, its prune **silently deletes window 1's still-live per-tab entries** with no sync event to even notice. C8 (one flat session doc + single pending slot → two windows clobber on save/restore) is the second silent destroyer.

**Work items:**

1. **Per-key localStorage triage.** Keep on the storage-event bus: theme/author/autosave/send-pill flags/line-numbers/update-banner. Move OFF it into per-window/per-tab session state: `cozy.byTab` (`:49`), `fontBump.byTab` (`:55`), `duo.nav.cwd` + `duo.nav.expanded` (`renderer/hooks/useNavigator.ts`). **Any key that becomes per-window must NOT subscribe to the storage broadcast.** Per-window keys are introduced as **new names**; leave the old shared keys in place but unread (so a Cut-3 revert reads them untouched — see §7.5).
2. **Relocate cozy/fontBump byTab into the per-tab session model.** The prune (`:2685-2710`) must operate on per-window/per-tab state — so a prune scoped to window A's tabs **cannot** touch window B's entries.
3. **Reshape `session-state.json` into `{windows: WindowState[]}`** (`core/session-state-service.ts:44`, `shared/types.ts:697`). Each `WindowState` holds geometry/position (bounds + ideally display) + `terminals[]` + tabs + browser + aux (**incl. `auxTabId`** — v2: the split/aux slot; v1 named only `splitPct`) + `splitPct` + **the per-window active-workspace pointer** (v2, P3 item 10). Bump `SCHEMA_VERSION` (`:45`, currently `1`).
4. **(v2) Per-window debounce, but ONE serialized writer — compose, do NOT key the `writing` flag per window.** `SessionStateService` is single-writer-serialized today (`flush()` `if (this.writing) return`, atomic write via `SESSION_PATH + '.tmp'`). The v1 "key pending/writing/timer per window OR compose" offered a false choice: **keying the `writing` flag per window REMOVES the serialization** → N concurrent `flush()`es race the shared tmp and lost-update the composed doc — a *fresh* corruption path inside the very phase billed as "closes the data-corruption hard gate." **Mandate: keep the single `writing` flag + single timer; the debounce composes the latest snapshot of EVERY window before each flush.** Boot restore iterates the persisted list; before-quit (~`:1201`) and per-window `closed` handlers mark that window's slot dirty, but the flush stays the one serialized writer. **Re-type the hooks for the envelope:** `enrichBeforePersistHook`/`mirrorHook` are typed `(state: SessionState) => …` (~`:63/:70`) and the enrich hook scans `~/.claude/projects` (an `await` point) — run them per-`WindowState` INSIDE the single flush, never concurrently. (Phase H already gave this writer a unique tmp suffix.)
5. **Write a back-compat migration** from the old flat single-window shape → windowed envelope (old flat doc → `windows: [oneWindowState]`, with a sensible default `windowId` and default bounds). The boot peek (~`main.ts:578`) must read both shapes.
6. **cozy/fontBump byTab fold into the per-tab model here** (the migration carries existing byTab data into the per-tab session state).
7. **Pure-function tests (where the no-Electron suite shines):** (1) a **migration round-trip** test (old flat doc → envelope → read back identical for the single window, including defaulted geometry/`windowId`; a negative control where a migration that drops a persisted field (a window's `terminals[]` or `splitPct`) FAILS); (2) a **per-window prune-isolation** test modeling two tab sets, proving a prune scoped to window A's tab ids cannot delete window B's entries (the `:2685-2710` whole-map-rebuild logic verbatim must FAIL this). Both run anywhere (node-env). (3) A **downgrade test** (NFR-8.2): an old-schema reader against a new envelope confirms graceful fallback via the `:89-90` version-mismatch guard — no throw, no destructive overwrite.

8. **(v2) Persist the per-window active-workspace pointer in each `WindowState`** — the P3 item 10 split needs a per-window persistence home. The standalone shared `active-workspace.json` is a single slot two windows would clobber → only one restores. Fold the pointer into each `WindowState` so it round-trips per window; extend the migration round-trip test (item 7) to assert a window's active-workspace pointer survives flat→envelope. Likewise confirm `auxTabId` (item 3) round-trips per window.

**Exit criteria.** Migration round-trip + prune-isolation + downgrade tests green; single-window quit/relaunch restore **byte-identical** to today; per-window keys provably NOT subscribed to the storage broadcast; **(v2)** each window's active-workspace pointer + `auxTabId` round-trip per window, and a **concurrent-flush test** proves two windows' overlapping saves both survive the single composed writer (negative control: per-window `writing` flags FAIL it); full single-window smoke passes. Then **Cut 3 (P4):** `/smoke-walk` via Skill tool (quit/relaunch focus; wait for pasted results) → `/cut-version`.

---

### P5 — Open window 2 + terminal-origin CLI addressing + four-surface doc sync (split v2 → P5a + P5b)

*(shippable-milestone · deps: P4 · **v2: SPLIT into two cuts** per owner decision 2026-06-05 — the v1 single P5 understated the `--window` surface ~4–6× and bundled window-opening + full CLI addressing under one two-window smoke walk)*

**P5a — window-opening + terminal-origin default (Cut 4a, the FIRST user-visible release, flag-gated) — ~1.5–2 eng-weeks.** A "New Window" menu item + `duo window new` verb call the now-reentrant `createWindow()` to register a SECOND context (each its own workspace, browser pane, focus, navigator cwd, `.duo-workspace`, pins). **Crucially, terminal-origin addressing ships HERE, not in 4b** (honoring §2.4): the `DUO_WINDOW` PTY stamp resolves a bare `duo` command to ITS OWN window, so each window's agent drives its own window deterministically — no focused-window foot-gun. Also: macOS **Window** menu (NFR-5.1); N-window restore + per-window geometry (NFR-6.3); `duo doctor` window count (NFR-4.4). Gated behind `multiWindow.enabled`. **Work items: 1 (entry points), 2 (windowId on the wire + `cli/duo.ts` threading), 3 (`DUO_WINDOW`→owning-window default), 6 (`SocketServer.handle` resolves windowId→context: terminal-origin default + focused fallback), 8 (N-window restore), 10 (doctor count), + Window-menu / geometry.**

**P5b — explicit cross-window addressing + full verb surface (Cut 4b) — ~2–3 eng-weeks.** Make EVERY window explicitly targetable from ANY terminal (the terminal-origin DEFAULT already shipped in 4a). **Work items: 4 (RE-SCOPED `--window` across the full ~36-verb surface — see item 4), 5 (`duo windows` enumeration), 7 (`duo cozy`), 9 (`--reveal` re-scope), 11 (four-surface doc-sync + doc-parity gate), 12 (harness addressed-mode: unknown-window error + ignore-windowId control), 13 (smoke section)**, plus the v2 additions:
> - **Tab / aux / split addressing.** Per-window `BrowserManager` mints `nextId=1` per window, so `duo tab`/`close`/`tabs` must compose `windowId` + the per-window index, and `duo tabs` output must name its window. `duo split-view` (~`cli/duo.ts:811`) + `duo focus-pane` (~`:750`) join the `--window` surface — both hard-target `mainWindow` today, identically to verbs already on the list.
> - **The `duo events` decision.** `DuoEvent` carries no `windowId`, so `duo events --follow` cannot filter by window. STATE the decision in the doc-sync: either events stays **app-global** (a documented CLI-parity asymmetry per CLAUDE.md §4) or gains `--window` filtering. (Note: the SocketServer dispatch is intentionally **concurrent**, not serialized — good for multi-window throughput; `events --follow` is the one long-lived path and back-pressures only its own connection.)

> **Why split (owner decision):** P5a ships the *visible* capability (a real second window) behind the flag against the foundation already proven at N=1 in Cuts 0–3 — a small, revertable surface. P5b then restores full CLI parity without window-opening risk bundled in. A two-window `/smoke-walk` runs at **each** sub-cut.

> **Locked shared-vs-per-window boundary (§3.3) for P5a/P5b:** project membership/qualification stays **SHARED** (`projects.json`); project colors are **hash-stable only** (override cut in P0); browser cookie/SSO **partition is SHARED** and `BrowserHistoryService` is a **shared singleton**; the Unix socket is **SINGLE** (locked). Cozy mode is **KEPT** and owes `duo cozy` + per-window `cozy.byTab` (P4's per-tab model + the P5b verb).

**Work items:**

1. **Add the "New Window" entry points.** A macOS menu item + the reentrant `createWindow()` call that registers a second `WindowContext`. Each window gets its own workspace/focus/navigator-cwd/`.duo-workspace`/pins. **New-window default behavior (NFR-6.2, pinned):** a new window opens **blank** to a default cwd (NOT cloning window 1's tabs, NOT auto-prompting for a project); project selection is a deliberate next action. Optional `duo window new --cwd <path>` opens at that path. Behavior identical between menu and CLI.
2. **Add optional `windowId` to `DuoRequest`** (`shared/types.ts:24`) and thread it through `cli/duo.ts` send paths. Add window provenance to the response where a read verb needs to identify which window it described (`duo layout`, `duo project list`).
3. **Wire the `DUO_WINDOW` PTY env-stamp to its owner** (the dormant stamp from P3, `core/pty-manager.ts:47-48`) so a bare `duo` command from a terminal **defaults to ITS window**. Default-resolution order: explicit `--window` > `DUO_WINDOW` stamp (owning window) > focused window (fallback only when unstamped).
4. **Add the `--window` override across the FULL surface** (**v2: RE-SCOPED — the v1 "6 areas" understated this ~4–6×**). The real surface is **~26 browser/CDP verbs** — every `socket-server.ts` case touching `this.browser`/`this.cdp`: `url`, `click`, `dom`, `eval`, `screenshot`, `navigate`, `console`, `network`, `errors`, `ax`, `inspect`, `fill`, `type`, `key`, `wait`, `reload`, `focus`, `text`, `title`, `view`, `selection`, `tab`, `tabs`, `close`, `browser-mode` — each window-dependent the instant P2 makes `BrowserManager`+`CdpBridge` per-window — **plus ~10 editor/nav renderer verbs** (`reveal`, `edit`, `doc`, `selection`, `selection-format`, `hidden-files`, `new-tab`, `split`, `split-view`, `focus-pane`, `workspace`, `theme`, `title`). EVERY verb routing to a per-window `BrowserManager`/`CdpBridge`/renderer needs `--window`; the doc-parity gate (`check:docs`) verifies each documents its window behavior. Ambiguity messaging per BUG-163 (`socket-server.ts`).
5. **Add the `duo windows` enumeration verb** (`{id, title/workspace name, focused}`) — required before `--window N` is usable.
6. **Resolve `windowId` → context in `SocketServer.handle()`** (~`core/socket-server.ts:584`, switch ~`:589`): route to the right `WindowContext`/cache, **error cleanly on no-such-window** (never silent fall-through to window 1), and resolve a `windowId`-less request to the terminal-origin default (focused fallback) for back-compat. Validate `windowId` as untrusted input (NFR-2.2).
7. **Add the `duo cozy` verb** (CLI parity for kept cozy mode; per-window `cozy.byTab` already scoped via P4).
8. **Restore N windows from the P4 envelope** — boot iterates `windows: WindowState[]` and calls the reentrant `createWindow()` per entry; the per-window `did-finish-load` replay (moved to context in P2) restores each window's open file tabs + browser pins into the **correct** window. Per-window geometry restored (NFR-6.3; off-screen bounds clamped onto a connected display).
9. **Re-scope the `--reveal` race fix (ENH-130)** so reveal acts on the SAME window the open targets.
10. **Extend `duo doctor`** to report window count + per-window summary (`{id, title, focused}`, and under verbose per-window cache health + dropped-send counter) — see NFR-4.4. Today it returns only `{version}` (`core/socket-server.ts:590-596`).
11. **Four-surface doc sync** for every new/changed verb (`duo window new`, `duo windows`, `--window`, `duo cozy`, extended `duo doctor`, the terminal-origin default contract): `cli/duo.ts`, `skill/SKILL.md`, `agents/duo.md`, `docs/CLI-COVERAGE.md` — **in the same commit**. Then `npm run build:cli && git add cli/duo`, and `npm run sync:claude`. Document the default-target rule in `docs/CLI-COVERAGE.md`; update the `cli-plumbing.md` checklist to include the window dimension. Add a **local doc-parity gate** (`check:docs`, §5.3).
12. **Extend the harness to ADDRESSED mode** (the P0 resolver branch goes live): `windowId` resolution in `SocketServer.handle` routes to the correct fake context; an unknown `windowId` errors cleanly; the `DUO_WINDOW`-stamped default resolves to the owning window and falls back to focused only when unstamped (negative control: a variant that ignores `windowId` and always hits `only()` FAILS the two-context routing test).
13. **Add the multi-window section to `docs/dev/smoke-checklist.md`** (the new live two-window matrix — see §5.4 and Verification below).

**Exit criteria.** Two independent workspaces open and persist; CLI addressing resolves per-window with terminal-origin default + `--window` override + `duo windows` enumeration; a verb from window 2 never mutates window 1; close window 1 while window 2 stays open → `duo` still works in window 2 + socket stays UP; quit + relaunch restores BOTH windows; four-surface doc sync complete + doc-parity gate green; full **two-window** smoke walked and passed.

**Live verification (run for real, both windows):** `duo open`/`eval`/`screenshot`/`nav-state`/`project focus`/`send` from a terminal in EACH window act on THAT window (a verb from window 2 never mutates window 1); `duo windows` enumerates both; `duo --window N <verb>` targets explicitly; bare `duo` inside each window defaults to its own window; close window 1 while window 2 stays open → `duo url` still works in window 2 + socket stays UP; quit + relaunch restores BOTH windows; EVERY menu item + the §5.2 shortcut matrix re-walked in window 2; EVERY modal opened via **computer-use** in window 2 (no WCV-above-DOM occlusion — modals must parent to window 2, not slide onto window 1); the per-window boot-replay step (launch a session where window 2 owns open file tabs + browser pins → confirm they restore into window 2 and window 1's tabs are untouched).

Then **Cut 4a (P5a — first user-facing release):** `/smoke-walk` via Skill tool (open/restore/lifecycle/Window-menu/geometry from BOTH windows + every modal via computer-use; wait for pasted results) → `/cut-version`. Then **Cut 4b (P5b):** `/smoke-walk` (**full two-window verb matrix from BOTH windows** + `--window` + `duo windows` + tab/aux/split addressing + the read-glow/eventSink routing; wait for pasted results, **NEVER straight-to-cut**) → `/cut-version`.

### Optional follow-on (post-P5, non-gating — flag as ENH in `tasks.md`)

N-writer hardening of `browser-history.json` (low-frequency append corruption) and the C10/C11 menu-accelerator + native-dialog focused-window sweep (menu items at `main.ts:2107`/`:2168`/`:2242`/`:2286`/`:2342` still `mainWindow?.webContents.send`; dialogs at `:1564`/`:2496`/`:2608`/`:2645` parented to `mainWindow`) can trail as a cleanup cut. They need only the P2 registry seam and are independent of the critical path. The P2 grep-gate (widened to dialog-parent + executeJavaScript) prevents *new* regressions here in the interim; the *existing* menu/dialog sites should be swept to focused-window resolution (the `:2182` "Copy as Plain Text" pattern) before they become user-visible wrong-window bugs.

**`app.requestSingleInstanceLock()` (discovered during P1 — pre-existing).** Duo has no single-instance lock, so two processes (or a relaunch before the old one exits) both reach `SocketServer.startUnix()` (`unlinkSync` stale → `listen`), the second silently unlinking the first's `duo.sock` + `duo.port` and hijacking the `duo` bridge. P1 made the *within-process* single-construction safe (`SocketServer.start()` is now idempotent), but the **cross-process** race remains. Add `requestSingleInstanceLock` (focus the existing window on a second launch) to close it mechanically; until then the "no stray Electron + socket DOWN" pre-flight stays a HARD gate before every dev launch. (Also in Appendix E deferred follow-ups.)

---

## 5. Test Strategy

> **The real gap, stated plainly.** The ~44-file automated suite is *entirely* pure-function / injected-IIFE-string — not one file imports `main.ts` routing, the `core/socket-server.ts` dispatch, `core/pty-manager.ts`, `core/session-state-service.ts`, or any of the 12 caches (`vitest.config.ts` says so in a "what we DON'T test here" comment). **The whole suite would stay GREEN through a fully broken window-registry refactor**, so `npm run test:run` passing is, today, *meaningless* as evidence the routing change is safe. This section closes that gap with **one new, dependency-free test layer** — a node-env routing-assertion harness (§5.1) — plus the app-driving net the project **already has**: the `duo` CLI (~65 verbs over the socket) + Chrome DevTools Protocol + the agent-run `/smoke-walk`. **No new test framework, no e2e dependency, and no CI is introduced or assumed.** There is no CI in this repo today (no `.github/`, no hooks); every gate below is a **local script run by hand** at a cut boundary. Standing up a real e2e framework or CI is worthwhile but **separate** — explicitly out of scope here, so it can never gate the multi-window cuts.

### 5.1 The node-env routing-assertion harness (built P0, extended every phase)

**Principle:** extract the multi-window decision logic into **pure modules with zero Electron imports**, exactly as `safe-send.ts` was extracted, then unit-test them with fake `WindowLike` / fake `webContents` / fake `EventSink` objects. The harness is the **first automated test that touches main-process routing at all**, and the **only** automated net that runs in the Electron-absent environment (node-env, runs anywhere). Every assertion carries a **negative control** that must FAIL when the known foot-gun is injected — otherwise the test proves nothing.

#### 5.1.1 Modules to extract (each its own `*.ts` + `*.test.ts`, node-env)

| Module (new file) | Extract from | Pure surface | Lands |
|---|---|---|---|
| `electron/window-registry.ts` | `let mainWindow` root `main.ts:249` → `Map<windowId, WindowContext>` | `register/unregister/only/get/all/count` | **P0** (stub) → **P2** (real) |
| `electron/window-resolve.ts` | the default-send resolution replacing `() => mainWindow` `main.ts:261` | `resolveDefault(registry)` → `registry.only()?.window` by identity; `resolveBySender(registry, senderId)` (the `FilesService.startWatch` `event.sender` template `main.ts:1824`) | **P2** |
| `electron/window-teardown.ts` (orchestrator) | the `closed` handler `main.ts:956` | `teardownWindow(ctx)` vs `teardownApp(services)`; each effect exactly once; app teardown at `before-quit` only (no last-window branch) | **P0** module → **P1** wired |
| `electron/cache-key.ts` | the 12 identity-free caches (`navState` `:123`, `projectsState` `:305`, `activeTerminalId` `:210`, …) | a generic `WindowKeyedCache<T>`: `put(senderId, value)` keys a `Map<windowId, T>`; `get(windowId)`; `getDefault(registry)` via `only()` | **P3** |
| `electron/reqid-validate.ts` | the 10 sender-blind resolver Maps (`main.ts:144-232`; result handlers ~`:1892/:1919/:1928/:1953/:2033`) | `register(reqId, targetWindowId, resolve)`; `tryResolve(reqId, replyingSenderId, value)` → resolves only if `replyingSenderId === targetWindowId`, else **drops** | **P3** |
| `core/pty-owner.ts` (or fold into PtyManager) | `Session` (`pty-manager.ts:7`), `dispose()` `:146`, `listIdsByCwd` `:97`, EventSink wiring `main.ts:547` | `routeData(sessions, sessionId, registry, sink)` → owner's webContents, **falls back to `only()`** when owner unresolved; `disposeForWindow(sessions, windowId)`; `listIdsByCwd(cwd, ownerWindowId?)` owner-filtered | **P3** |
| `core/session-envelope.ts` | `SessionStateService` (`SCHEMA_VERSION = 1` `:45`, single `pending` `:54`, migration hook `:88-90`) | `migrate(oldFlatDoc)` → `{version, windows: WindowState[]}`; `read(envelope, windowId)`; `compose(perWindowSnapshots)` | **P4** |
| `renderer/state/perTabPrune.ts` | the C13 corruptor: cozy/fontBump `byTab` prune `App.tsx:2685-2710` | `prune(byTabMap, liveTabIdsForThisWindow)` → **scoped**: cannot delete ids owned by another window's tab set | **P4** (node-env — pure object transform) |

> **Modeled on safe-send, concretely:** `safe-send.test.ts` builds a fake `WindowLike` with a `vi.fn()` `send`, injects it through the `getWindow` thunk, and asserts (a) the happy path routes, (b) each guard branch no-ops, (c) it re-reads the window each call so a swap is reflected. Every harness module reuses that fake-collaborator shape. `WindowContext` in tests is `{ id, window: WindowLike, browser: {dispose: vi.fn()}, cdp: {detach: vi.fn()} }` — no real Electron object ever constructed.

#### 5.1.2 The assertions, with mandatory negative controls

| # | Positive assertion | **Negative control (MUST fail)** | Built in |
|---|---|---|---|
| H1 | `registry.only()` returns the sole context | registers **two** contexts → expects `only()` to throw/return-null (guards a silent "pick first") | P0 → P2 |
| H2 | an identity-resolved default send routes to `only().window`'s fake `send` | **inject a focus-resolved variant** (`() => fakeFocusedWindow`); harness FAILS when focused ≠ registered — *the only automated catch for the `getFocusedWindow()` foot-gun* | P2 |
| H3 | one-sender `put(senderId, snap)` populates `Map<windowId>` under that id; `get(id)` reads back | a **mis-keyed** variant (constant key regardless of sender) FAILS a two-sender read-back | P3 |
| H4 | a reqId reply from the **recorded target** resolves the pending promise | a reply from a **foreign** fake sender is **dropped** (promise stays pending) | P3 |
| H5 | `teardownApp` fires `socket.stop` + `external.dispose` **exactly once** (at `before-quit`); `teardownWindow` fires `browser.dispose` + `cdp.detach` once per window | a **double-dispose** variant trips "called once"; a **missed-dispose** variant trips "called at least once" | P1 |
| H6 | `disposeForWindow(only)` kills the **same** session set `dispose()` did | a variant disposing **all** sessions for a per-window call FAILS once two owners exist | P3 |
| H7 | the PTY sink delivers `PTY_DATA` to the owner's fake sink **and falls back to `only()`** when owner transiently unresolved | a **no-fallback** variant FAILS the cold-start case | P3 |
| H8 | `migrate(oldFlatDoc)` → `read(envelope, soleWindowId)` is **byte-identical** to the original single window | a migration that **drops** a persisted field (a window's `terminals[]` or `splitPct`) FAILS | P4 |
| H9 | `prune(byTab, window-A-tab-ids)` leaves window-B's entries intact | the **current** whole-map-rebuild (`App.tsx:2685-2710` verbatim) FAILS this — the C13 proof | P4 |
| H10 | (P5) `SocketServer.handle` resolves `windowId` → the right fake context; unknown errors cleanly; unstamped falls back to focused | a variant that ignores `windowId` and always hits `only()` FAILS the two-context routing test | P5 |

**Completeness is mechanically checkable.** Write H3/H4 as `describe.each([...])` over the verified literal name lists (the **13** PUSH/STATE families + the **10** reqId families from §4 P3) so adding a 14th cache without a test is a visible omission.

#### 5.1.3 What the harness **structurally cannot** cover — name it, don't pretend

The harness drives spies; it cannot see a live `executeJavaScript` round-trip or OS-level focus/timing. Two classes fall outside it and are carried by the leak-hunting smoke legs (§5.2):
1. **The visibility cluster** — `duo dom` / `duo eval` / `duo layout` / `duo devtools` are live `executeJavaScript` round-trips (`main.ts:3076`, `:3159`, `:3174`, devtools ~`:3121`), not cache reads. CLAUDE.md tells agents to reach for them **first** when debugging blind, so a wrong-window answer actively misleads. **→ Covered by the P2 backgrounded-CLI smoke leg (which includes the visibility cluster).**
2. **OS-level teardown-vs-PTY-flush timing** (BUG-190 quit-loop) and **focus-window substitution** (the single window is *usually* focused during walks, hiding the bug). **→ Covered by the two leak-hunting smoke steps (§5.2).**

### 5.2 App-level verification — the tools the project already has (no new dependency)

The `duo` CLI + Chrome DevTools Protocol + the agent-run `/smoke-walk` skill have driven Duo end-to-end for its entire life. **That is the e2e net** — `docs/dev/smoke-checklist.md` §7 already walks `duo url`/`open`/`edit`/`doc write`/`nav-state`/`reveal` against the live socket (the CLI-is-the-spec oracle). Multi-window needs **no new framework** to drive the app: the new `duo windows` / `duo --window N` verbs (P5) *are* the two-window test surface, exercised through that same CLI.

Two **leak-hunting smoke legs** run on **every invisible cut (P1–P4)**, via the existing CLI:
- **(A) Backgrounded-CLI** — with Duo NOT frontmost, run `duo url`/`nav-state`/`send`/`open` **and the visibility cluster** (`duo dom`/`eval`/`layout`/`devtools`); confirm each still lands on the (single) registered window. This is the **only** catch for an accidental `getFocusedWindow()` substitution — the harness cannot see OS focus, and the single window is usually focused during a walk, which hides the bug.
- **(B) Quit-no-crash** — Cmd+Q with windows open → no looping crash dialog (BUG-190 class) **and** `duo doctor` shows the socket DOWN; relaunch clean.

At **Cut 4a/4b (P5a/P5b)**: the full two-window `/smoke-walk` (every verb cluster + shortcut matrix, from BOTH windows) **plus** computer-use modal / WCV-occlusion checks — the one class **no** automated tool (a browser-e2e framework included) can see, because a `WebContentsView` paints above the DOM. Gated on pasted results; **never** straight-to-cut.

> **Why not a browser-e2e framework (e.g. Playwright):** it would re-implement app-driving the `duo` CLI + CDP already do, add a dependency + a macOS-only run lane, and still leave the highest-value check (modal/WCV occlusion) manual. The dependency-free harness (§5.1) covers the routing logic; the existing CLI + `/smoke-walk` cover the app. If a standing e2e framework is ever wanted, scope it as its own initiative — it must not gate these cuts.

### 5.3 Two local guard scripts (no new dependency, NOT wired into CI)

Both are plain scripts run locally / at a cut boundary (there is no CI to wire them into):
- **`scripts/check-window-routing.sh`** (the grep-gate, lands **P2**) — fails on any **new** `mainWindow` send / `dialog.show*(mainWindow` / `getFocusedWindow` / `getFocusedWebContents` outside the registry/safe-send seam, allowlisting the lone legitimate `getFocusedWebContents` at `main.ts:2182`. **(v2) The send regex MUST match both token forms** — `mainWindow\??\.webContents\.(send|executeJavaScript)` — because v1's bare-`.` regex silently missed the 8 optional-chain `mainWindow?.webContents.send` sites (all 6 menu sends + 2 others), the form the codebase uses for inline handlers. Pure text matching (no dependency). Verified baseline: **40** (29 bare `.send` + 8 optional `?.send` + 3 `.executeJavaScript`; **v1 mis-stated 32**); the gate ensures that only ever drops, and ships with a negative-control fixture that adds a `mainWindow?.webContents.send` and proves it fails. Exposed as `npm run check:routing` and optionally a local pre-commit hook. This is what makes the harness's routing guarantee **durable** against a future "consistency-fix."
- **`scripts/check-cli-parity.sh`** (the doc-parity gate, lands **P5**) — asserts every verb in `cli/duo.ts` is documented across `docs/CLI-COVERAGE.md` + `skill/SKILL.md` + `agents/duo.md` (the CLAUDE.md §3/§4 four-surface rule). P5 genuinely adds verbs (`duo window new`, `duo windows`, `--window`, `duo cozy`, extended `duo doctor`). Exposed as `npm run check:docs`; run as a Cut-4 gate. Both proven to fail via a negative-control fixture.

### 5.4 Test-to-phase map

| Phase | Routing harness (node-env, runs anywhere) | App-level (existing `duo` CLI + `/smoke-walk`) | Local gate |
|---|---|---|---|
| **P0** | Build skeleton: H1, H2 (+ focus-resolved negative control). Extend `shared/projects.test.ts` (hash-only color). | — | — |
| **P1** | **H5** teardown-once (double + missed-dispose controls); re-pin BUG-190 per-context. | Leak legs **(A)** backgrounded-CLI + **(B)** quit-no-crash. | — |
| **P2** | **H2** extended to the registry seam; NFR-3.1/3.3 per-context guards. | Backgrounded-CLI **incl. the visibility cluster**; browser-verb parity. | **grep-gate lands.** |
| **P3** | **H3** (`describe.each` over 13 caches), **H4** (10 reqId + foreign-sender-drop), **H6**, **H7** (PTY owner-routing + fallback); owner-filtered `listIdsByCwd`. | Read-verbs byte-identical at N=1; `duo send`/terminal + checkmark legs. | — |
| **P4** | **H8** migration round-trip (persisted-field-drop control), **H9** prune-isolation, downgrade test. | Single-window quit/relaunch restore byte-identical; per-window keys NOT on the storage bus. | — |
| **P5** | **H10** addressed-mode (windowId resolution + unknown-window error + stamped default + ignore-windowId control). | **Full two-window `/smoke-walk`** + computer-use modal checks; pasted results → `/cut-version`. | **doc-parity gate.** |

---

## 6. Non-Functional Requirements

> These are NOT in the locked decision set — surfaced proactively by this spec. Each carries an **owning phase (P0–P5)** whose definition-of-done must not be marked complete until its acceptance criteria pass.

### NFR-1 Performance

**NFR-1.1 — Hot send path stays O(1).** Resolving a default-target send through the registry must be O(1) and add no measurable latency versus today's `() => mainWindow` thunk. `registry.only()` and identity lookups (`BrowserWindow.fromWebContents(event.sender)` → context) must be constant-time. No send site may iterate `BrowserWindow.getAllWindows()` on the per-send path (PTY_DATA and CDP events fire at high frequency). *Acceptance:* at N=1 the resolved target is `===` the `mainWindow` the old thunk returned (harness H2; a `Map.get` is self-evidently O(1)); the **grep-gate** confirms no per-event `getAllWindows()` (broadcast helpers are the only permitted consumers, never on the PTY_DATA path); a two-window PTY-streaming spot-check (`yes | head -100000`) shows no stutter (**manual**, P5). *Owning phase:* **P2** (identity resolution + grep-gate); manual load spot-check at **P5**.

**NFR-1.2 — Per-window memory budget; no manager leak on close.** Each window's steady-state overhead (its `WindowContext`: `BrowserManager`, `CdpBridge`, console/network/error ring buffers, per-window cache entries, per-window probe) must be bounded and **fully reclaimed** on close — zero retained `WebContentsView`, zero orphaned `setInterval`, zero dangling CDP debugger attachment. *Acceptance:* the teardown orchestrator fires `socket.stop`/`browser.dispose`/`cdp.detach`/`probe.stop` **exactly once** for the closed context and does **not** fire shared-service teardown on any window close — app teardown is `before-quit`-only (extends H5 to N>1); a deliberately-skipped `cdp.detach` makes the teardown-once test FAIL; live (P5) open/close window 2 10× → `duo doctor` window count returns to 1 each cycle, main RSS returns to baseline each cycle with no accumulating `ps`/timer count (the RSS-drift figure is a **manual** Activity-Monitor spot-check, not a gated number). *Owning phase:* disposal seam split at **P1**; per-context fields at **P2**; live leak-cycle at **P5**.

**NFR-1.3 — Bound the claude-presence ps-scan CPU under N windows.** The per-window `ClaudePresenceProbe` (`core/claude-presence.ts`: `POLL_INTERVAL_MS = 500`, one `ps -ax -o pid,ppid,comm` per probe per cycle, `setInterval`) must not let process-scan CPU grow unbounded. Required mitigations, in priority order: (a) a probe **only polls while its window has a live Claude-hosting target** — an idle window (no `activeTerminalId` hosting `claude`) drops to no-poll or a long back-off, not a hot 500 ms `ps` loop; (b) when ≥ 2 windows are open, either share a **single** `ps` snapshot per 500 ms tick across all probes (one `ps`, fanned out by PID-tree filtering) OR cap concurrent `ps` spawns — never N simultaneous `ps` every 500 ms. *Acceptance:* with 3 windows open and **zero** hosting Claude, `ps` spawn rate stays ≈ 0/sec (not ≈ 6/sec), and with only 1 of 3 hosting Claude it stays low (a **manual** count, not a gated number); presence still flips correctly per window (verified live by spawning a real `claude` in two windows); a unit test asserts the "park when no target" transition (interval stops on `setTarget(null)`, restarts on a hosting target). *Owning phase:* **P3** (per-window probe + per-window `activeTerminalId` + the shared-snapshot/park-idle optimization); live multi-window CPU check at **P5a**.

> **(v2) NFR-1.3b — bound the SECOND per-window process-scan (the v0.8.6 live-cwd `lsof` poll).** BUG-191 added a second interval-driven scan the v1 NFR was blind to: the project rail polls live cwds (renderer → `pty.liveCwds(ids)` → main-process `getLiveCwdsForIds` → one `lsof` per live pid, `main.ts:2716`), which multiplies per window exactly like the `ps` probe. Each window already passes only its own tab ids (request-scoped), but under N windows the aggregate `lsof` spawn rate must be bounded — batch per tick / park when the rail is idle. *Acceptance:* with 3 windows open, aggregate `lsof` spawn rate stays bounded (manual count); rail membership still updates per window. *Owning phase:* **P3** alongside NFR-1.3; live check at **P5a**.

**NFR-1.4 — Startup time scales sub-linearly with restored windows.** Restoring N windows from the P4 envelope must not serialize construction N×; the boot peek of `session-state.json` must read the envelope **once**, not per window. *Acceptance:* boot reads the envelope exactly once (spy/`fs` call-count in the migration scaffolding); cold launch restoring 2 windows is not dramatically worse than one window (a **manual** stopwatch spot-check at P5, not a gated number); the per-window `did-finish-load` replay is **per-context** (NFR-3.4) so two windows' replays don't block or double-fire. *Owning phase:* envelope + migration at **P4**; per-context boot replay at **P2**; concurrent-restore at **P5**.

### NFR-2 Security & Privacy

**NFR-2.1 — Shared cookie/SSO partition is intentional; documented, with a future isolation opt-in.** The `persist:duo-browser` partition, cookie/SSO jar, and `browser-history.json` singleton are **shared across all windows** (locked) — **one window's login = all windows logged in**. Document this as deliberate in user docs + `docs/DECISIONS.md`, and record an **isolated/incognito window** as a future opt-in (flagged ENH, not built now). Each per-window `BrowserManager` injects the **one** shared partition/history — it must NOT construct its own or re-register the `duo-asset` protocol handler. *Acceptance:* `docs/DECISIONS.md` + user doc state the shared SSO/cookie jar is intentional; isolated-window mode is a flagged future ENH in `tasks.md`; live (P5) log into Google in window 1 → window 2 opened afterward is already authenticated, SSO persists across relaunch; constructing window 2's `BrowserManager` does not throw a duplicate-`protocol.handle` error and does not create a second partition. *Owning phase:* **P2** (per-context `BrowserManager` + the "do not re-register" guard); doc/decision capture in **P5** + `docs/DECISIONS.md`.

**NFR-2.2 — `--window` / `windowId` input validation.** Any `windowId` on a `DuoRequest` (from `--window`, the `DUO_WINDOW` stamp, or `duo windows`) must be validated in `SocketServer.handle` **before** use: it resolves to a live, non-destroyed registered context or the command fails with a clean structured error (`{ ok: false, error: "no such window: <id>" }`) — never a crash, never a silent fall-through to window 1, never an unchecked send to a destroyed `webContents`. The id is treated as untrusted input. *Acceptance:* harness (P5) — known id routes correctly; **unknown** id returns the structured error and performs **zero** sends; a registered-then-destroyed context errors the same way; a `windowId`-less request resolves via the DUO_WINDOW default and falls back to `registry.only()` at N=1; live `duo --window 99 url` prints a clean "no such window," not a hang or stack trace. *Owning phase:* **P5**.

**NFR-2.3 — Single-user socket permissions preserved.** The single socket retains its `0700`/single-user posture across the lifecycle refactor. Lifting `SocketServer` to app-boot scope (P1) must not change socket file mode/path/ownership, and must not leave a stale socket after `before-quit` (on darwin a last-window-close leaves the socket UP by design — see P1). *Acceptance:* socket file mode/path unchanged (assert in a node-env test of the bootstrap helper, or document the unchanged constant); smoke (P1 leak-hunt step B, every cut) — after Cmd+Q, `duo doctor` shows socket DOWN and the file is removed, relaunch is clean (no "address in use"); closing one of two windows does NOT stop the socket. *Owning phase:* **P1**.

### NFR-3 Reliability & Fault Isolation

**NFR-3.1 — A renderer crash in one window must not take down others or the registry.** Each `webContents` has a per-context `render-process-gone` (and `unresponsive`) handler that disposes **only** that window's `WindowContext` and de-registers it — leaving the registry, socket, PTY pool, and every other window operational. A crashed window must not wedge the socket dispatch loop or leave half-registered state. *Acceptance:* harness — simulating a "gone" event invokes per-window teardown exactly once and leaves `registry.only()`/other contexts intact and addressable; pending reqIds owned by the dead sender are rejected/cleared; live (P5) force window 2's renderer to crash → window 1 keeps working, socket stays UP, `duo windows` no longer lists the crashed window. *Owning phase:* **P2** authors the handler; cross-window crash-isolation verified live at **P5**.

**NFR-3.2 — Teardown-once invariant (no double-dispose, no missed dispose).** For any window, per-window teardown fires **exactly once**; shared-service teardown (`SocketServer`, `ExternalDomainsService`, global PTY dispose) fires **exactly once** and **only** on `before-quit` (NOT on last-window-close — darwin keeps the app alive across a window close). The split `closed` handler must be idempotent (a `closed` followed by `before-quit` must not double-stop the socket). *Acceptance:* harness H5 (exactly-once + double-`teardownApp` idempotency control); smoke (every cut) — Cmd+Q with windows open → no looping crash dialog, `duo doctor` socket DOWN, relaunch clean; close-one-of-two → survivor fully functional, socket UP. *Owning phase:* **P1** (split + harness); re-asserted at N>1 in **P5**.

**NFR-3.3 — Per-context destroyed-window guard (BUG-190, generalized).** The BUG-190 guard (`makeSafeSend` short-circuits on null/destroyed window/`webContents` **before** touching `webContents`, `electron/safe-send.ts:20-29`) must hold for **every** per-context `safeSend`. Each `WindowContext` gets its own guarded send bound to that window via the same `getWindow`-thunk seam (the `safe-send.test.ts` "re-reads the window on each call" contract must pass per context). An in-flight CDP/PTY event for a window closing mid-flight must no-op, not throw. *Acceptance:* `safe-send.test.ts` passes unchanged + a per-context harness variant (a send to a context whose fake window reports destroyed no-ops for all four BUG-190 branches, for an arbitrary registered context); grep-gate forbids any new bare `mainWindow.webContents.send` outside the seam. *Owning phase:* **P2**.

**NFR-3.4 — Per-window boot/replay state is self-scoped.** The `did-finish-load` boot replay (the module-global file-open stash + the BUG-057 browser-pin-restore loop, `main.ts:780`) must move into `WindowContext` so each window's replay fires for **that** window only and cannot double-fire or replay into the wrong window. *Acceptance:* at N=1 the move is zero-change (covered by P4 quit/relaunch + P2 smoke-parity); live (P5) launch from a session where **window 2** owns open file tabs + browser pins → they restore into window 2, window 1 untouched, nothing double-opens. *Owning phase:* **P2** (state moves into context); two-window restore-targeting verified at **P5**.

### NFR-4 Observability

**NFR-4.1 — Structured logging of which window each command resolved to (the direct wrong-window fix).** Every CLI-driven command that resolves a target window emits a structured log line: command name, **resolution source** (`explicit --window` / `DUO_WINDOW stamp` / `registry.only fallback` / `unknown→error`), resolved `windowId`, request `id`. Cheap (guarded behind a level; not on the per-PTY-byte path); never includes document content, page text, or PTY payloads. *Acceptance:* each addressed command in the P5 two-window smoke shows the correct resolved `windowId` + source (`duo --window 2 url` → `source=explicit window=2`; bare `duo url` from window 2 → `source=DUO_WINDOW window=2`; unknown id → `source=unknown→error`); privacy assertion (ids/sources/cmd only, spot-checked; ideally a redaction unit test on the formatter). *Owning phase:* **P5**.

**NFR-4.2 — Debug/verbose mode (OPTIONAL — not required to ship, not a gate).** A future `DUO_DEBUG_ROUTING=1` toggle *could* elevate the NFR-4.1 routing logs and dump registry state on demand. Multi-window does not need it: wrong-window bugs are already diagnosable from NFR-4.1's resolution log + `duo doctor` / `duo windows` + the visibility cluster. If ever built, off by default, zero hot-path overhead. *Owning phase:* optional, post-P5.

**NFR-4.3 — (Cut as a requirement.)** Per-window sends/dropped-send counters were scoped here as an observability subsystem that exceeds what shipping two windows requires — **cut**. If a lightweight dropped-send count is ever wanted as a teardown-regression signal, it rides NFR-4.2's optional debug mode.

**NFR-4.4 — Surface window state in `duo doctor` / `duo windows`.** `duo doctor` (today only `{version}`, `core/socket-server.ts:590-596`) additionally reports: number of open windows, each window's `id`, workspace/title, focused flag, and (optionally, under a verbose flag) a per-window summary. `duo windows` enumerates `{id, title, focused}` as its own verb. Both part of the four-surface doc sync. *Acceptance:* `duo windows` lists exactly the open windows with stable ids + correct focused flag (live, two windows); `duo doctor` output includes window count + per-window summary; doc-parity gate green. *Owning phase:* **P5**.

### NFR-5 Accessibility

**NFR-5.1 — macOS Window menu lists open windows.** The standard macOS **Window** menu lists all open Duo windows by title, supports "Cycle Through Windows" (⌘`) and Minimize/Zoom/Bring-All-to-Front, and lets the user focus a specific window. Titles match NFR-6.1. *Acceptance:* with 2+ windows the menu lists each by workspace/project title; selecting one focuses it; ⌘` cycles in a stable order; re-walked in the P5 menu matrix. *Owning phase:* **P5**.

**NFR-5.2 — Window focus order, keyboard cycling, and per-renderer a11y not regressed.** Focus order is deterministic and stable (registration order); ⌘` cycles forward and ⌘⇧` backward. Each window is its own renderer with its own accessibility tree — the refactor must **not regress** that per-renderer a11y tree. (No *new* VoiceOver-announcement behavior is in scope; that would be a separate a11y improvement.) The focus-reactive per-window menu **checkmark reconciliation** (the C10 cluster; template `getFocusedWebContents()` at `main.ts:2182`) is owned by the **post-P5 menu/dialog follow-on**, not a P5 blocker. *Acceptance:* ⌘`/⌘⇧` cycle all windows in a stable order; window 2's accessibility tree is intact (spot-check, no regression). *Owning phase:* **P5** (a11y-tree-no-regress throughout).

### NFR-6 Usability

**NFR-6.1 — Per-window titles show the workspace/project.** Each window's title reflects **its own** active workspace/focused project (driven by the per-window active-workspace pointer, not the single global `ActiveWorkspaceService` that today drives the one title ~`main.ts:2435`). Two windows on different projects show two different titles. *Acceptance:* window 1 on project A and window 2 on project B show titles naming A and B; opening/closing a workspace in one window updates only that window's title. *Owning phase:* **P3 item 10 (v2)** — split the `ActiveWorkspaceService` singleton into a per-window pointer; **P4 item 8** persists it per-`WindowState` (the standalone `active-workspace.json` is a single slot two windows would clobber); the `WORKSPACE_FILE_ACTIVE_CHANGED` push (~`:2454`, the in-app titlebar badge) is equally per-window; visible/verified at **P5a**. *(v2: v1 assigned this to P3 but provided no work item — now operationalized.)*

**NFR-6.2 — "New Window" default behavior is defined and predictable.** "New Window" and `duo window new` have a **single documented** default: a new window opens **blank** to a default cwd (NOT cloning window 1's tabs, NOT auto-prompting for a project); project selection is a deliberate next action. (A blank new window inherits shared project identity but its own empty view-state.) Any `--cwd <path>` deviation is documented in all four CLI surfaces. *Acceptance:* both menu and CLI produce a blank window at the default cwd; `--cwd` (if shipped) opens at that path; behavior identical between menu and CLI; documented across the four surfaces; doc-parity gate green. *Owning phase:* **P5**.

**NFR-6.3 — Restore window position and size.** Each window's geometry (position + size, ideally display/screen) is captured in its `WindowState` slot in the envelope and restored on relaunch. Off-screen geometry (a now-disconnected external display) is clamped onto a visible display, not restored off-screen. *Acceptance:* quit with two windows at distinct positions/sizes → relaunch restores each window's bounds; a window whose saved bounds are now off-screen is clamped onto a connected display; the migration round-trip test (P4) covers a window-state record with bounds (old flat doc → envelope → read back identical incl. bounds defaulting for migrated single-window saves). *Owning phase:* geometry field + migration at **P4**; live restore at **P5**.

### NFR-7 Maintainability

**NFR-7.1 — Grep-gate against singleton/focus reintroduction (widened).** See §5.3 — the **local** grep-gate (`check:routing`) fails on any new bare `mainWindow.webContents.send`, `mainWindow.webContents.executeJavaScript`, new focus-based default resolver, or bare-`mainWindow` `dialog.show*` parent, with the single legitimate `getFocusedWebContents()` (`main.ts:2182`) allowlisted. Runs as a local script / optional pre-commit hook (pure text matching, no CI); proven to fail via negative controls. *Owning phase:* **P2**, enforced thereafter.

**NFR-7.2 — WindowContext is the single seam.** All per-window resources are reached **only** through the `WindowContext` registry. No new module-global per-window state; the 13 PUSH/STATE caches and 10 reqId families are keyed by `windowId` (un-discard `_event`, resolve via `BrowserWindow.fromWebContents(event.sender)` — the `FilesService.startWatch` template `main.ts:1824`); `PtyManager.Session` gains `ownerWindowId`; `listIdsByCwd` filters by owner; `dispose()` becomes `disposeForWindow()`. *Acceptance:* harness iterates the named **13** cache families + **10** reqId families (one-sender push populates the per-window Map and reads back; a foreign sender's reqId reply is dropped); `disposeForWindow(only)` kills the same session set `dispose()` did; `listIdsByCwd` owner-filtered returns only the owning window's same-cwd terminals; no new module-global per-window variable added (reviewed; grep-gate assists). *Owning phase:* **P3** (full sweep); the seam created in **P2**.

**NFR-7.3 — Four-surface doc-sync gate.** See §5.3 — a **local** doc-parity script (`check:docs`) asserts every CLI verb in `cli/duo.ts` (incl. `duo windows`, `duo window new`, `--window`, `duo cozy`, extended `duo doctor`) is documented across `docs/CLI-COVERAGE.md`, `skill/SKILL.md`, `agents/duo.md`. After any `cli/duo.ts` change the binary is rebuilt + committed (`npm run build:cli`); after any `skill/`/`agents/` change `npm run sync:claude` is run. *Acceptance:* gate green for every shipped verb; proven to FAIL when a verb is added without the three doc surfaces; `cli-plumbing.md` checklist updated with the window dimension. *Owning phase:* **P5**.

### NFR-8 Compatibility & Migration

**NFR-8.1 — Forward migration is backward-compatible.** The `session-state.json` reshape into `{windows: WindowState[]}` (P4) must read an **old flat** single-window document and produce a correct one-window envelope, round-trip-identical for that window (terminals, tabs, browser, aux, splitPct, plus defaulted geometry/`windowId`). A `SCHEMA_VERSION` bump gates the new shape. *Acceptance:* pure-function migration round-trip test (node-env, runs anywhere); live (P4 cut) a user upgrading from a pre-multi-window build relaunches and gets their single window restored byte-identical. *Owning phase:* **P4**.

**NFR-8.2 — A new envelope must not corrupt or crash an OLD build (downgrade path).** If a user runs a new build (writing the envelope) then **downgrades**, the old build must not crash or silently wipe the file. The new format is **version-gated**: the verified guard at `core/session-state-service.ts:89-90` ("schema version mismatch … returning empty state") means a reverted build sees the unknown `SCHEMA_VERSION` and degrades to a blank restore, not corruption. The new build should preserve enough that a downgrade degrades to "start fresh," not "corrupt state." *Acceptance:* a node-env test simulating an old-schema reader against a new envelope confirms graceful fallback (defaults, no throw, no destructive overwrite); release notes / `docs/DECISIONS.md` state the downgrade contract ("downgrading past vX.Y resets the multi-window session to a single default window"); the `SCHEMA_VERSION` bump + gate asserted. *Owning phase:* **P4** (the version-gate is the same code path as the forward migration).

**NFR-8.3 — localStorage per-key triage is non-destructive to existing keys.** Moving per-window keys (`cozy.byTab`, `fontBump.byTab`, `duo.nav.cwd`, `duo.nav.expanded`) **off** the shared bus into per-window/per-tab state must not discard existing values on first run; genuinely-global keys (theme/author/autosave/send-pill flags) must **remain** on the bus. The verified C13 corruption — the prune effect rebuilding the whole `byTab` map from one window's tab ids and writing the shared key (`App.tsx:2685-2710`) — must be eliminated. *Acceptance:* pure-function prune-isolation test (a prune scoped to set A cannot remove set B's entries); per-window keys provably NOT subscribed to the storage broadcast; migrating an existing single-window user preserves their cozy/font-bump/nav state. *Owning phase:* **P4**.

### NFR-9 Test nets per phase (in-scope, dependency-free)

The in-scope test investment is the **dependency-free node-env routing harness** (§5.1) plus the **leak-hunting smoke legs** run via the existing `duo` CLI + `/smoke-walk` (§5.2). Binding: a phase is not "done" if its required harness assertions or smoke legs are missing. A broader e2e framework or a CI pipeline is **out of scope** (§5) and must never gate these cuts.

**NFR-9.1 — Routing-assertion harness is the durable per-phase net.** §5.1 — built at **P0**, extended through **P5**, with negative controls that must FAIL on a focus-resolved send or mis-keyed cache. *Acceptance:* harness committed and green (node-env, runs anywhere) at P0; each phase's extension lands and is green before that phase's cut; `npm run test:run` + `typecheck` (both projects) + `lint` green at every cut.

**NFR-9.2 — Leak-hunting smoke steps run at every cut.** §5.2 — (A) BACKGROUNDED-CLI (incl. the visibility cluster) and (B) QUIT-NO-CRASH are walked as the smoke-parity leg of **every** cut (Cut 1–4), via the existing `duo` CLI. Step (A) is the **only** catch for an accidental `getFocusedWindow()` default. *Acceptance:* `smoke-checklist.md` contains both steps with the visibility cluster enumerated in (A); both walked and pass before each cut; cuts gated on pasted smoke results.

**NFR-9.3 — Two local guard scripts.** §5.3 — `check:routing` (grep-gate, P2+) and `check:docs` (doc-parity, P5) run locally / at cut boundaries (no CI). Both proven to fail via negative-control fixtures.

---

## 7. Risks, Rollback & Feature Flags

> Governs *how to ship and un-ship* the build safely. The governing safety property: Cuts 1–3 are *zero-user-visible-change* releases (a registry-of-one is byte-identical to today's `mainWindow` singleton — verified at §2.3), so each can be cut, and reverted, as ordinary hardening with no "why did multi-window half-appear?" moment. The one genuinely-awkward midpoint (focused-window-only multi-window) never ships.

### 7.1 Per-cut rollback strategy

| Cut | What makes it **safe to ship** | What makes it **safe to revert** | Revert blast radius |
|---|---|---|---|
| **Cut 0** (Phase H) | No multi-window code at all — adds write-serialization + a unique tmp suffix to the existing shared writers, fixing a latent-today lost-update (R6). One window. | Pure additive hardening; a revert restores the prior (racy) writers. No on-disk format change. | **Lowest.** Wholly independent of the registry path; can ship and revert on its own. |
| **Cut 1** (P0+P1) | No runtime behavior changes. P0 = pure test-infra + dead-write removal (the `PROJECTS_SET_COLOR_OVERRIDE` write-path has no live renderer caller; `colorOverrides` removed from `shared/projects.ts` colorIndex derivation). P1 only **relocates construction** of `SocketServer`/`ExternalDomainsService`/PTY EventSink to app-boot scope and **splits the `closed` handler** — same services, different call sites. One window. | Pure code-structure revert. No on-disk format changed: `SCHEMA_VERSION = 1`, no localStorage keys moved, no `projects.json` shape change. | **Lowest.** Only real-behavior risk is teardown timing (R1). If a quit-loop regresses, revert the P1 commit alone; P0's harness stays (additive, green). |
| **Cut 2** (P2+P3) | `registry.only()` **proven identity-equal** to old `mainWindow` by the harness (negative controls fail on a focus-resolver or mis-keyed cache). At N=1: one sender → one constant cache key; one PTY owner → same target `safeSend` hit before. | No persisted-format change (the envelope migration is held to Cut 3). The `WindowContext` Map, per-window cache Maps, and `ownerWindowId` are **in-memory only**. The dormant `DUO_WINDOW` stamp + dormant `windowId?` on `DuoRequest` are no-ops a reverted CLI ignores. | **Medium-low.** Largest diff, zero data surface. A latent mis-route surfaces against a known-good single-window baseline, not tangled with a feature. |
| **Cut 3** (P4) | Migration + triage land at **N=1**, exercised before any second window. Guarded by the **migration round-trip test** + **prune-isolation test**. | The **only cut with a forward/back-compat contract** (§7.5). The new writer stamps a higher `SCHEMA_VERSION`; the old reader's existing guard (`core/session-state-service.ts:89`) means a reverted binary **does not crash** — it degrades to a blank restore. Per-window localStorage keys are **new names** (old `duo.cozy.v1.byTab`/`duo.fontBump.v1.byTab` left in place), so a revert reads the old keys untouched. | **Medium.** Risk is session-restore data loss on downgrade (R4). Mitigated by the version-mismatch-returns-empty guard + a one-time `.v1.bak` backup. Worst case is "extra window not restored," never a corrupt merge. |
| **Cut 4a** (P5a) | First behavior-changing cut: window-opening **+ terminal-origin default** (bare `duo` in each window hits its own window, honoring §2.4) behind the `multiWindow.enabled` flag, gated on a **two-window smoke-walk** (open / restore / lifecycle / terminal-origin / modals via computer-use, pasted results). Cut 0 + P0–P4 pre-paid the foundation; residual is small. | The user-facing entry points (**"New Window" + `duo window new`**) are **behind the flag** (§7.2): revert by *flag flip* (instant) **or** code revert. The flag gates only the *enabling*. | **Highest in principle, smallest in practice.** A flag flip returns the app to a verified registry-of-one without touching the baked registry/cache/session layers; full code revert drops to Cut 3. |
| **Cut 4b** (P5b) | Restores full CLI parity (`--window` across the real ~36-verb surface + `duo windows` + tab/aux/split + read-glow routing). Gated on a **full two-window verb-matrix smoke-walk**. Addressing is NOT flag-gated (resolves cleanly at N=1). | Code revert drops to Cut 4a (a shippable flagged release); the addressing plumbing is additive over a proven foundation, no data surface. | **Low–medium.** A latent mis-route surfaces against the Cut-4a baseline, not tangled with window-opening. |

**Rollback mechanics (all cuts).** Tag every cut (`v0.x.y`) so `git revert` targets a clean range. Because Cuts 1–3 are zero-user-visible, **a revert of any of them is itself a shippable patch release**. Never revert across a cut boundary in one step (e.g. don't revert Cut 3 while Cut 4's flag is enabled in the field — flip the flag first, then revert).

### 7.2 Feature-flagging

The registry-of-one phases (Cut 0 + Cuts 1–3 / Phase H + P0–P4) need **no flag** — they are invisible by construction; a flag would gate nothing. Only **Cut 4a** introduces a *new capability* (window-opening), and only its **enabling** needs a gate. **(v2: `--window` addressing in P5b/Cut 4b is NOT flag-gated** — it always parses/resolves and errors cleanly on an absent window; only window-*opening* is gated.)

**Flag: `multiWindow.enabled` (default `false` until Cut 4a ships green).**
- **Gates (the enabling, not the plumbing):** the **"New Window"** menu item (visible/enabled only when on); the **`duo window new`** verb (returns a clean *"multi-window is disabled"* error when off — never a silent no-op, per CLI-parity); boot restore of a **second-or-later** window from the P4 envelope (when off, restore only the first `WindowState`; the rest stay persisted but dormant — *not* discarded, so toggling on later recovers them). **(v2) A flag-off boot must NOT prune/overwrite the dormant `WindowState`s on its next debounced write** — the compose-flush (P4 item 4) must preserve unloaded slots, or the kill-switch silently discards window 2's saved layout.
- **Does NOT gate (merges dark, always live):** the `WindowContext` registry, per-window caches, PTY `ownerWindowId`, the envelope schema, `windowId?` on `DuoRequest`, the `DUO_WINDOW` stamp, and `SocketServer.handle`'s windowId-resolution branch. All **byte-identical at N=1** and already shipped (smoke-verified) in Cuts 2–3 — with the flag off, **no second window ever registers**, so every Map has one entry and every resolver returns the sole context. **(v2 clarification):** `--window` is ALWAYS parsed and resolved, even flag-off — it simply finds only the sole window and returns the clean `no such window: N` structured error (NFR-2.2) for any other id; only window-*opening* (New Window menu + `duo window new`) and second-window restore are flag-gated. This keeps the resolution branch truly byte-identical at N=1 regardless of flag position and makes the dark-merge testable.

This lets P5's hard plumbing **merge dark** (verified by the harness in *addressed mode* against fake contexts) while real users still get a one-window app. Flipping the flag then flips only the *entry point* against a foundation already proven at N=1 — and gives Cut 4a a **runtime kill-switch** (flip off to return to a verified registry-of-one without a code revert).

**Flag storage (avoid the sidecar anti-pattern, CLAUDE.md §12).** An `app.getPath('userData')`-scoped settings value (or a build-time constant for the dark-merge window). It must **not** ride a shared-origin localStorage key on the storage-event bus (that would make the flag itself a per-window-divergence hazard — the C13 class). Read it once at boot in the main process; the renderer learns it via a one-shot IPC, not the storage broadcast.

**Guardrail:** the flag gates *enabling*, never *correctness*. The registry/cache/PTY/session layers must be correct at N=1 with the flag in **either** position. No dark-merged plumbing may branch on the flag — a flag-conditional resolver would mean the "off" and "on" paths diverge, defeating the byte-identical guarantee.

### 7.3 Highest residual risks → phase → catching test

**R1 — BUG-190 teardown-timing crash reopens (the quit-loop class).** A PTY/CDP/async event in flight for a window being destroyed → unguarded `webContents.send` → uncaught "Object has been destroyed" → looping dialog. P1 splits the `closed` handler (`main.ts:956`) and lifts the socket/external-domains stop out of per-window close — the exact seam BUG-190 lived in. *Mitigation:* keep the `makeSafeSend(getWindow)` thunk shape (`safe-send.ts:20`); the guard short-circuits on `isDestroyed()` **before** touching `webContents`. *Caught by:* (1) harness teardown-once (H5) + re-pinned BUG-190 short-circuit per-context; (2) the **QUIT-NO-CRASH** smoke step (every cut); (3) Cut-4 close-one-of-two. *Phase:* **P1** (introduced), re-validated **P5**.

**R2 — Accidental `getFocusedWindow()` substitution silently drops backgrounded sends (the single highest-consequence silent leak).** If P2's refactor "consistency-fixes" the default resolver toward `getFocusedWindow()`, every **backgrounded** socket/async/PTY send silently drops — invisible to interactive walks (the single window is usually focused). *Mitigation:* identity-resolve, never focus; the grep-gate (§5.3). *Caught by:* (1) the harness focus-resolved **negative control** (must fail); (2) the **BACKGROUNDED-CLI** smoke step incl. the visibility cluster — the *only* runtime catch. *Phase:* **P2**.

**R3 — C13 `byTab` cross-window data-loss (the verified silent destroyer).** The cozy/fontBump prune (`App.tsx:2685-2710`) rebuilds the entire `byTab` map from only THIS window's live tab ids and writes a shared-origin key; cozy/fontBump are NOT storage-event subscribers, so window 2's mount silently clobbers window 1's live entries. *Mitigation:* move per-tab prefs into the per-tab `SessionState` model (P4); leave old shared keys in place but unread. *Caught by:* (1) the **prune-isolation** unit test (must be green before Cut 3); (2) Cut-4 cross-window toggle. *Phase:* **P4**.

**R4 — Session migration corrupts or loses state.** P4 reshapes the flat doc into the envelope with a `SCHEMA_VERSION` bump; a migration bug could merge/drop a window's state. *Mitigation:* pure-function migration; **write a one-time `.v1.bak` backup** before the first envelope write; compose all windows' snapshots before persisting; quit-flush iterates every window. *Caught by:* (1) **migration round-trip** test; (2) single-window restore parity; (3) Cut-4 two-window restore (with window 2 owning tabs+pins → they restore into window 2, covering the per-window `did-finish-load` path at `main.ts:780`). *Phase:* **P4** (its own cut, isolated).

**R5 — Per-window `BrowserManager` double-registers the `duo-asset` partition / fragments the SSO jar.** P2/P3 make `BrowserManager`+`CdpBridge` per-context (WCV physics). The `duo-asset` handler is registered **once, app-scoped** (`registerSchemesAsPrivileged` `main.ts:36`; `protocol.handle` `:1019`, inside `whenReady`, **not** in `createWindow`). A literal "one per context" reading could re-register → crash, or give each window its own partition → fragmented cookie/SSO jar + history. *Mitigation:* keep `protocol.*` exactly where they are (app-boot scope); inject the shared `BrowserHistoryService` + partition name into each per-window `BrowserManager`. *Caught by:* (1) P2 exit-criteria assertion (a re-register dry-run does not call `protocol.handle` twice and reuses the shared partition); (2) Cut-4 SSO/history smoke (navigate in both windows → no corruption, autocomplete works in both; Google login persists across windows AND relaunch). *Phase:* **P2**. *(v2 note: there are TWO app-scoped `protocol.handle('duo-asset')` registrations — the default session `:1020` AND the browser partition `:1022` — not "one"; the guard is "a per-window BrowserManager re-registers NEITHER.")*

**R6 — Concurrent lost-update / tmp-rename race on the shared on-disk writers (the latent-today corruptor).** `pins`/`nav-pins`/`projects` do unserialized `await read()`→`await write()` on a fixed shared `.duo.tmp` with no mutex; the SocketServer dispatches fire-and-forget (`socket-server.ts:413`); two entry paths (socket + renderer-click IPC) already interleave at N=1, and multi-window's shared-file broadcasts only increase the pressure. *Mitigation:* per-service write-serialization queue + unique tmp suffix (**Phase H**, pulled AHEAD of all multi-window work); P4 keeps the `SessionStateService` single-writer guarantee via compose-behind-one-writer (never per-window `writing` flags). *Caught by:* (1) the Phase H two-interleaved-writer test (un-serialized negative control must FAIL); (2) the P4 concurrent-flush test. **Appendix C named this class and wrongly dismissed it as "funnels through main, so safe" — single-process does NOT serialize async RMW that interleaves at `await` points.** *Phase:* **Phase H** (introduced/fixed), re-asserted **P4**.

### 7.4 Risk-to-phase-to-test map (one-glance)

| Risk | Class | Introduced | Caught by |
|---|---|---|---|
| **R1** BUG-190 teardown crash | Crash (recoverable) | P1 | Harness teardown-once + QUIT-NO-CRASH smoke + Cut-4 close-one-of-two |
| **R2** `getFocusedWindow()` substitution | **Silent send-drop** | P2 | Harness focus-resolver **negative control** + BACKGROUNDED-CLI smoke (incl. visibility cluster) + grep-gate |
| **R3** C13 `byTab` cross-window delete | **Silent data-loss** | P4 | Prune-isolation unit test + Cut-4 cross-window toggle |
| **R4** Session migration corruption | **Data-loss on save/downgrade** | P4 | Migration round-trip + single-window restore parity + Cut-4 two-window restore + `.v1.bak` backup |
| **R5** Partition double-register / SSO fragmentation | Crash + silent jar-split | P2 | P2 re-register dry-run assertion + Cut-4 SSO/history smoke |
| **R6** Shared-file lost-update / tmp race | **Data-loss (latent today)** | Phase H | Phase H interleaved-writer test + P4 concurrent-flush test (Appendix C wrongly dismissed this) |

**Cross-cutting durability gates (CI):** the **bare-`mainWindow` grep-gate** (§5.3, added P2 — makes R2 + C10/C11 dialog-parent regressions durable; the harness proves the registry routes correctly, but only the grep-gate stops a "consistency-fix" from bypassing it) and the **doc-parity gate** (§5.3, added P5 — enforces the four-surface discoverability rule mechanically).

### 7.5 Session-migration downgrade / forward-compat path

The only place a *downgrade* can lose data. The contract:
1. **Version stamp.** The envelope writer bumps `SCHEMA_VERSION` past `1`; the reader keys behavior off this version.
2. **Forward path (old → new).** On first read of a `version === 1` flat doc, the shim wraps it as `{ windows: [<flat-doc-as-WindowState>] }` and re-stamps. Validated by the migration round-trip test (R4).
3. **Backward path (new → old) — the safety net.** A reverted (Cut-1/2) binary reads a new-format file and hits the existing guard at `core/session-state-service.ts:89` ("schema version mismatch … returning empty state") → degrades to a blank restore, never a crash or corrupt merge. **Verify this guard still fires** (don't let the envelope refactor make the reader lenient about unknown versions).
4. **One-time backup.** Before the **first** envelope write, copy `session-state.json` to `session-state.json.v1.bak` (write-once; never overwrite). A downgraded user can recover their last single-window layout. A Duo-owned recovery artifact, not a sidecar mirror — does not violate CLAUDE.md §12.
5. **localStorage keys: additive, never mutated.** Per-window keys (P4) are **new names**; the old shared `duo.cozy.v1.byTab`/`duo.fontBump.v1.byTab` (`App.tsx:49/55`) are left in place and unread by new code. A downgrade reads the old keys exactly as before.

**Net downgrade guarantee:** the worst outcome of any revert past Cut 3 is *"the second window (and possibly the restored layout) is not recovered automatically"* — recoverable from `.v1.bak` — and **never** a corrupt-state crash or a silent cross-window clobber.

### 7.6 Runtime guardrails (must exist in shipped code, not just tests)

1. **Identity resolution is the only default.** Every default send → `registry.only()?.window`; push/reply → `BrowserWindow.fromWebContents(event.sender)`. **No** `getFocusedWindow()` for socket/async/PTY sends, ever (R2). Grep-gate enforces it.
2. **Guard before touch, always.** Keep the `makeSafeSend` short-circuit order (`!w || w.isDestroyed() || w.webContents.isDestroyed()`, `safe-send.ts:27`): test `isDestroyed()` **before** dereferencing `webContents` (the getter can throw on a torn-down window) (R1).
3. **reqId replies validate the sender.** The 10 reqId families must **drop a reply whose `event.sender` is not the recorded target** — so window B can never resolve a request dispatched to window A. Behavior-preserving at N=1; ships free as hardening in P3.
4. **PTY owner-routing falls back safely.** The EventSink routes `PTY_DATA`/`PTY_EXIT` to the owning window but **falls back to the sole window when an owner is transiently unresolved** (cold-start) — output is never dropped during the boot race. `disposeForWindow(windowId)` filters by owner; **only true app-quit calls the global `dispose()`** (`core/pty-manager.ts:146`). `listIdsByCwd` (`:97`) must **also filter by owner** (the claude-presence positional cwd→tabId match `main.ts:436` mis-aligns otherwise).
5. **Unknown `windowId` errors cleanly.** `SocketServer.handle` returns a clean "no such window" error (never a silent fall-through) when `--window N` names a nonexistent window. A windowId-**less** request still resolves (DUO_WINDOW stamp → owning window, focused fallback).
6. **Shared singletons stay shared.** The `persist:duo-browser` partition, the `duo-asset` protocol handler (`main.ts:1019`), `BrowserHistoryService`, `SocketServer`, `PtyManager`, `ExternalDomainsService` are app-scoped singletons **injected** into each per-window `BrowserManager` — a per-window manager constructs **none** of them (R5). The single socket is **locked**.
7. **The flag never gates correctness.** `multiWindow.enabled` gates only the entry point; the registry/cache/PTY/session layers must be correct at N=1 with the flag in either position.

---

## 8. Execution Conventions & Workflow Structure

> Rules of engagement for every agent that touches this build. Self-contained — every anchor, command, and guardrail is inlined here.

### 8.1 The one-paragraph orientation (post-compaction start here)

You are converting Duo from single-window to N-independent-windows. The whole effort is **one de-risking sequence of zero-user-visible-change releases (P0→P4) culminating in a single user-visible release (P5)** — **not** a product ladder. The scary core (replacing `let mainWindow` at `electron/main.ts:249`, read at 134 sites, with a window registry) lands *behind exactly one window* and is **provably byte-identical** because `registry.only()` returns the same sole window `mainWindow` is today. The proof obligation is the node-env routing-assertion harness (§5.1, modeled on `electron/safe-send.test.ts`) plus the unchanged single-window smoke-checklist with two added leak-hunting steps. **The single most important rule: resolve every default send target by IDENTITY (`registry.only()` for app-wide; `BrowserWindow.fromWebContents(event.sender)` for push/reply), NEVER by `getFocusedWindow()`** — a focus-based "fix" silently drops backgrounded sends and is invisible to interactive testing because the one window is usually focused.

### 8.2 Step granularity — one seam per commit

- **One seam = one commit**, independently `git revert`-able and independently verifiable. Examples: "extract `WindowRegistry` into a node-env module"; "convert the `safeSend` thunk from `() => mainWindow` to `() => registry.only()?.window`"; "key the `navState` cache into `Map<windowId>`"; "add `ownerWindowId` to `Session` (dormant)". Do **not** bundle "convert all 12 caches" into one commit — but do convert them in a tight series of same-shaped commits.
- **Never mix a refactor commit with a behavior-change commit.** P0–P4 commits must each be zero-user-visible-change. If a commit changes what a user or `duo` verb observes, it belongs in P5 (or it is a bug).
- **Keep the registry at exactly one entry until P5.** If you want a second window to test something earlier, extend the **harness** (which fakes N contexts in node-env), not the real app.
- **Commit messages name the seam + invariant:** `refactor(MW-Pn): <seam> — registry-of-one byte-identical (harness: <assertion>)`. End every commit message with the `Co-Authored-By` trailer.
- **Each commit must typecheck and pass the full suite (incl. the harness).** A red commit is never pushed, even mid-series.

### 8.3 The verify-after-each loop (run after EVERY seam)

```bash
# Gate 1 — types clean (BOTH tsc projects)
npm run typecheck          # tsc --noEmit -p tsconfig.node.json && -p tsconfig.web.json
# Gate 2 — full unit suite + the routing harness, headless, runs anywhere
npm run test:run           # vitest run — node env default; excludes .claude/worktrees/**
# Gate 3 — lint (incl. the grep-gate once P2 lands)
npm run lint
# Gate 4 — the relevant SMOKE LEG (§8.6). Gates 1-3 verify CODE correctness; Gate 4 verifies FEATURE correctness.
#          Build-passing + types-clean is NEVER sufficient to call a seam done (CLAUDE.md §7).
```

- **The harness is the load-bearing gate.** The existing suite stays **green through a fully broken registry refactor**. "`npm run test:run` passes" means nothing for this work until the harness exists. Build it FIRST (P0); treat its assertions — not the legacy suite — as the proof a seam is behavior-preserving.
- **Every harness addition ships with a NEGATIVE control** — assert it *fails* when the wrong thing is injected (a `getFocusedWindow()`-resolved send must make the identity test red; a mis-keyed cache must make the per-window-Map test red). A harness with no negative control is theater.
- **Main-process changes require a full Electron restart before any smoke leg.** `electron-vite dev` HMRs the **renderer only**. Edits to `electron/**`, `core/**`, or `shared/host-api.ts` are **not** live until you kill and relaunch. **Almost every seam here is main-process.** Restart procedure (per `.claude/rules/ui-verification.md` §7a — **you** do this, never tell the user to):
  1. Find it: `ps -ef | grep -E "MacOS/Electron \." | grep -v grep`
  2. Kill it: `kill <pid>` (`kill -9` if needed). **Kill ALL** electron / electron-vite PIDs and confirm the socket is DOWN (`duo doctor` fails) before relaunching — never leave multiple dev instances contending on the single socket.
  3. Relaunch: `npm run dev` with `run_in_background: true`.
  4. Poll until up: `until duo doctor 2>&1 | grep -q "Unix socket"; do sleep 2; done` (do not foreground-`sleep`; use the until-loop).
  5. Confirm `duo doctor` shows socket up + a CLI-version line matching the app.

### 8.4 Guardrails — what NOT to do (violations fail the phase gate)

**8.4.1 The locked decisions are immutable** (§2). Do not re-open the destination, shared `projects.json`, hash-stable colors (override **CUT** in P0), the single socket, per-window browser with shared partition/history, the shared PTY pool with `ownerWindowId`, terminal-origin addressing, or the `{windows: WindowState[]}` envelope. If a decision seems wrong, **stop and ask** (§8.5).

**8.4.2 Identity, not focus — the cardinal rule** (§2.3). The only legitimate `getFocusedWebContents()` is "Copy as Plain Text" at `main.ts:2182` — leave it. Any new focus-based default resolution is a regression even though every unit test and most interactive walks stay green. The catch is the backgrounded-CLI smoke step — load-bearing, not dressing.

**8.4.3 The no-vanity principle.** Every commit de-risks a *verified* blocker or builds the *only* automated net that runs in the Electron-absent environment (node-env). There is **no shippable focused-window-CLI midpoint** — do not build one, do not stop at one. Window-opening + terminal-origin addressing ship **together** in P5. No "consistency fixes," speculative abstractions, or "while I'm here" cleanups; if you spot one, flag it as an out-of-scope task and move on.

**8.4.4 The grep-gate** (introduce P2; enforce thereafter — §5.3). Catch the singleton-bypass families: new `mainWindow.webContents.send` **OR `mainWindow?.webContents.send`** (v2: both forms), new `mainWindow.webContents.executeJavaScript` (the visibility cluster `main.ts:3076/:3159/:3174`; **note** `openDevToolsForTarget` ~`:3121` is NOT an `executeJavaScript` site — v1 mis-named it), and new `mainWindow` in a `dialog.show*` parent position (`:1564/:2496/:2608/:2645`). Baseline `grep -cE "mainWindow\??\.webContents\.(send|executeJavaScript)" electron/main.ts` = **40** (v2-corrected; v1 said 32 and missed the 8 optional-chain sends) — the gate ensures this only ever *drops*.

**8.4.5 DO-NOT-TOUCH list** (already app-scoped or correct; touching risks new bugs):
- `protocol.registerSchemesAsPrivileged` (`main.ts:36`) and `protocol.handle` (`main.ts:968/1019`, inside `whenReady`) — **already app-scoped**. Do **not** "lift" them in P1; do **not** let a per-context `BrowserManager` re-register the partition in P2.
- The single shared cookie/SSO partition and `BrowserHistoryService` (`main.ts:369`): per-window managers are *injected with* the ONE shared history + partition — never construct their own. N-writer hardening is a **post-P5, non-gating** follow-on.
- The `getFocusedWebContents()` "Copy as Plain Text" item at `main.ts:2182` — leave it.
- The legacy `<meta name="duo-open-in">` path — already dead/harmless per CLAUDE.md; do not revive or "clean up."

**8.4.6 No sidecar / no new mirrored state** (CLAUDE.md §12). Do not add any Duo-owned file/cache that mirrors another system's state. Window/workspace state lives in the per-window session envelope + in-memory registry — read external state (git worktree, CDP, filesystem mtimes) live.

### 8.5 When to STOP and ask the owner

Use `AskUserQuestion` (batch ≤ 4; each option description ≤ ~15 words — the UI truncates; put long context in the chat reply *before* the call). Stop when:
- **A locked decision appears wrong or under-specified.** Never silently substitute judgment. For a deferral, get **explicit pre-implementation deferral approval** — do not just skip.
- **A phase boundary is reached.** Do not start P(n+1) until P(n) exit criteria are green. At each *cut* boundary, hand off to `/smoke-walk`, wait for pasted results, then `/cut-version` — never straight-to-cut for a UI-touching cut.
- **Genuine ambiguity the spec doesn't resolve** (e.g. a localStorage key's per-key triage classification, or a cache's broadcast-vs-targeted semantics). State your assumption and proceed only for *aesthetic/naming* trivia; for anything affecting data correctness or routing, ask.
- **~15 minutes of blind debugging.** Stop guessing — build the missing visibility (a `duo` verb, a log forwarder, a harness assertion, a DOM snapshot) first. Reach for the existing visibility cluster (`duo dom`/`duo devtools`/`duo layout`/`duo nav-state`) BEFORE bespoke instrumentation.
- **A discovered issue** (404, failed teardown, data loss, broken link, unexpected error you are not immediately fixing): log it to `tasks.md` (the specific instance *and* the class), surface it to the owner explicitly (not a parenthetical), and propose a systemic fix.

### 8.6 Per-phase smoke legs (Gate 4 specifics)

Two leak-hunting steps are added to the checklist in P0 and run as the smoke-parity leg of **every** invisible release P1–P4:
- **Leg A — BACKGROUNDED-CLI (catches focus-substitution).** With Duo **not** frontmost, run `duo url`, `duo nav-state`, `duo send`, `duo open`, **and the visibility cluster** `duo dom <sel>` / `duo eval <js>` / `duo layout` / `duo devtools`. Every one must resolve against the single registered context and return output **identical to foreground**.
- **Leg B — QUIT-NO-CRASH (catches BUG-190-class teardown timing).** `Cmd+Q` with one window → **no** looping crash dialog, `duo doctor` socket **DOWN** after quit; relaunch clean.

| Phase | Gate-4 floor (in addition to "full single-window checklist unchanged") |
|---|---|
| **P0** | None new (harness + color-override cut). Confirm § project-rail unchanged after the override removal. |
| **P1** | Leg B (teardown split changed — highest-residual-risk seam). |
| **P2** | Leg A (**incl. the visibility cluster** from a backgrounded window) + browser-verb parity (`open`/`navigate`/`eval`/`screenshot`/`click` byte-identical in the one pane). |
| **P3** | Read-verb parity (`nav-state`/`project list`/`layout`/`selection` identical) + `duo new-tab` renders output + `duo send` hits the active terminal + menu-checkmark side-effects still fire (Show-Hidden-Files reconcile in `NAV_STATE_PUSH`). |
| **P4** | Quit + relaunch with ONE window restores terminals/tabs/browser/aux/splitPct byte-identical; cozy/font-bump toggled on a tab persist; no localStorage key flips an unrelated surface. |
| **P5** | **FULL TWO-WINDOW smoke-walk** — every verb cluster + the §5.2 shortcut matrix + **every modal via computer-use**, **from BOTH windows** + the per-window boot-replay step (window 2 owns tabs+pins → restore into window 2, window 1 untouched). |

### 8.7 Commit & ship discipline (per CLAUDE.md — non-negotiable at every cut)

- **After editing `cli/duo.ts`:** `npm run build:cli` (esbuild → `cli/duo`) **and** `git add cli/duo`. Commit the tracked binary alongside the source. (Relevant in P5.)
- **After editing `skill/` or `agents/`:** `npm run sync:claude` (copies into `~/.claude/skills/duo/` + `~/.claude/agents/duo.md`, which are copies, not symlinks). Remind the owner too if they edit by hand.
- **Four-surface doc sync for EVERY new/changed CLI verb** (P5: `duo window new`, `duo windows`, `--window`, `duo cozy`, extended `duo doctor`): the verb lands in **all four** of `cli/duo.ts`, `skill/SKILL.md`, `agents/duo.md`, `docs/CLI-COVERAGE.md` **in the same commit**. A verb absent from the `## Verb cheat-sheet` in `agents/duo.md` is invisible to the Haiku-driven subagent. Enforce with the doc-parity gate (§5.3).
- **Grep ALL implementations before declaring any rename/string change done** — user-visible strings often have multiple copies (CDP-injected IIFEs, Electron menus, test fixtures, skills). Grep the whole repo.
- **Verify artifacts end-to-end before claiming done (CLAUDE.md §7f).** A successful tool response is NOT verification. `Read` a written file back; fetch a Release URL; skim a pushed commit's diff. Fix problems silently rather than reporting "done but with caveats."
- **NEVER claim UI work done without `/smoke-walk` (CLAUDE.md §7, §7b).** Invoke `/smoke-walk` **via the Skill tool** (it enforces renderer hard-reload + surface re-probe + feature-pref reset the raw generator skips). Generate the page, **wait for pasted results**, parse them, *then* propose the cut. For any smoke-walk/worksheet page, **exercise the Copy round-trip yourself** (toggle a radio + Copy via the writeText-stub pattern, since `duo eval` clipboard writes throw "Document is not focused") and **open every modal via computer-use + screenshot** before handoff. Always `duo open` playgrounds in Duo (never Claude desktop's preview panel — it lacks `navigator.clipboard`, so Copy silently fails).
- **Propose a version cut proactively at each cut boundary (CLAUDE.md §10).** Geoff won't ask.

### 8.8 How to structure the execution workflow (for the agent that BUILDS the pipeline)

Operationalize this spec as a **gated pipeline of eight stages (Phase H + P0–P4 + P5a + P5b) grouped into six cuts (Cut 0 + Cuts 1–4b).** Phase names/numbers **verbatim** (v2: Phase H prepended as Cut 0; P5 split into P5a/P5b).

**8.8.1 Phases are gated pipeline stages.** Do not start P(n+1) until P(n)'s exit criteria are all green. Dependencies: P1→P0, P2→P1, P3→P2, **P4→P3 is a release-ISOLATION choice, not a hard code dependency** (P4 is entirely renderer-side localStorage + `SessionStateService` schema, pure-function testable, reads no registry — ordered after P3 so the migration doesn't ride alongside the routing refactor or the visible feature; surface this as isolation, not a false dependency). **(v2)** Phase H has no deps (pulled first, Cut 0); P5a→P4; P5b→P5a (addressing builds on the opened window).

**8.8.2 The six cut boundaries and their gates:**

| Cut | Phases | User-visible? | Cut gate |
|---|---|---|---|
| **Cut 0** — Write-serialization hardening | Phase H | None | Two-interleaved-writer test green (un-serialized negative control fails) + single-window pins/rail toggles unchanged. Pulled forward; independent of the registry path. |
| **Cut 1** — Routing test harness + internal hardening | P0 + P1 | None | Leg B walked (teardown changed) + full single-window checklist. Internal/refactor doc-tag. |
| **Cut 2** — Window-registry refactor | P2 + P3 | None | Full single-window checklist + Leg A (backgrounded-CLI incl. visibility cluster). The de-risking payload — surfaces latent regressions against a known-good single-window baseline. |
| **Cut 3** — Persistence hardening | P4 | None | Migration round-trip + prune-isolation + downgrade tests green + quit/relaunch smoke. Its OWN cut so a migration bug stays isolated. |
| **Cut 4a** — Window-opening + terminal-origin | P5a (flag-gated) | **YES** | Two-window `/smoke-walk` (open / restore / lifecycle / Window-menu / geometry + **bare `duo` from each window hits its own window** + every modal via computer-use, BOTH windows) with **pasted results** before `/cut-version`. |
| **Cut 4b** — Full CLI addressing | P5b | **YES** | FULL two-window verb-matrix `/smoke-walk` (every cluster + shortcut matrix + `--window` + `duo windows` + tab/aux/split, BOTH windows) with **pasted results** — **never** straight-to-cut. Doc-parity gate green. |

**8.8.3 Per-phase verification (recommended, not mandated).** After each phase, independently confirm the phase's Definition-of-Done (§9) — re-run `typecheck`, `test:run` + the harness (incl. the phase's new negative controls), the grep-gate (P2+), and walk the phase's smoke leg — rather than trusting a self-report. This can be a checklist pass or a verification sub-agent; it is a recommended discipline, not a required gate.

**8.8.4 Git-worktree isolation for any parallel edits.** If work is parallelized (e.g. the harness extraction in P0 alongside the color-override cut, or fanning the P3 cache-keying across families), each parallel stream runs in its **own git worktree** so concurrent `main.ts` edits don't collide. The repo already lives under `.claude/worktrees/`, which `vitest.config.ts:43` **excludes** from `include` — so a worktree's in-flight tests never pollute another's run, but you must run `npm run test:run` *inside* each worktree to verify it. Merge worktrees back through the one-seam-per-commit discipline; never let two worktrees land overlapping `main.ts` edits without a rebase.

---

## 9. Definition of Done

### 9.1 Reusable per-phase Definition-of-Done template

Copy this block per phase; fill the brackets from the phase's exit criteria in §4.

```
### Phase P<n> — Definition of Done
- [ ] Every commit is one seam, behavior-preserving, individually revertable; messages name the seam + invariant + harness assertion.
- [ ] `npm run typecheck` green (both tsc projects).
- [ ] `npm run test:run` green INCLUDING the phase's new harness assertions.
- [ ] The phase's NEGATIVE controls present and proven to fail when the wrong thing is injected (focus-resolved send / mis-keyed cache / foreign reqId sender).
- [ ] `npm run lint` green.
- [ ] Grep-gate green (P2+): no new `mainWindow` send (**bare OR optional-chain**) / .executeJavaScript / dialog-parent outside the seam; the combined count (**40**, v2-corrected from 32) did not rise.
- [ ] Electron fully restarted (kill ALL, socket confirmed DOWN, relaunch, `duo doctor` clean) before any smoke leg.
- [ ] The phase's smoke leg (§8.6) walked and PASSED: [ Leg A / Leg B / read-verb parity / restore parity / two-window ].
- [ ] Registry still has exactly ONE entry (P0–P4) — app opens exactly one window.
- [ ] Locked decisions intact; no out-of-scope cleanups; DO-NOT-TOUCH list (§8.4.5) untouched.
- [ ] Four-surface doc sync done for any CLI verb touched (P5); `cli/duo` rebuilt + committed; `npm run sync:claude` run if skill/agents changed.
- [ ] Discovered issues logged to tasks.md + surfaced to owner; nothing left only in context.
- [ ] Phase exit criteria from §4 verbatim: [ paste P<n> exit criteria ].
- [ ] (At a cut boundary) `/smoke-walk` results pasted by owner, then `/cut-version` offered. Never straight-to-cut for a UI-touching cut.
```

### 9.2 Per-phase concrete checklists

**Phase H — DoD (Cut 0, v2).**
- [ ] `pins`/`nav-pins`/`projects` services each have a per-service write-serialization queue (chained promise); RMW is atomic per file.
- [ ] All four writers (those three + `SessionStateService`) use a UNIQUE tmp suffix (no fixed shared `.duo.tmp`).
- [ ] Two-interleaved-writer pure test green per service; the un-serialized negative control PROVEN to fail (revert once to confirm).
- [ ] `SessionStateService` single-writer (`writing`-flag) property confirmed intact — the base P4 builds on.
- [ ] Single-window smoke § project-rail / pins / nav-pins toggles unchanged.
- [ ] `typecheck` + `test:run` + `lint` green.
- [ ] **Cut 0 (Phase H):** zero-user-visible → `/cut-version` (no `/smoke-walk` handoff; no UI surface changed).

**P0 — DoD.**
- [ ] `electron/window-registry.ts` + `electron/window-teardown.ts` extracted as pure, injectable modules (not yet wired into `main.ts`).
- [ ] `electron/window-registry.test.ts` asserts all 5 positive contracts + 2 negative controls; green in node-env; provably fails when focus-resolution / mis-keying is injected (proven once, reverted).
- [ ] Color-override write-path + `colorOverrides` derivation removed end-to-end (`main.ts`, `preload.ts`, `host-api.ts`, `shared/projects.ts`, `App.tsx`); zero dangling references (grep clean).
- [ ] `shared/projects.test.ts` proves hash-only color derivation.
- [ ] Backgrounded-CLI + quit-no-crash smoke steps added to `docs/dev/smoke-checklist.md`.
- [ ] `typecheck` + `test:run` + `lint` green.

**P1 — DoD.**
- [ ] `SocketServer` + `ExternalDomainsService` constructed once at app-boot scope (not in `createWindow()`); socket-to-managers seam documented in the PR.
- [ ] `PtyManager.setEventSink` wired at app scope; re-entrancy does not double-register the sink.
- [ ] `closed` handler split: per-window teardown always; app teardown only on `before-quit` (never last-window-close on darwin); routed through the P0 orchestrator; idempotent.
- [ ] `protocol`/partition explicitly **NOT** touched (verified still app-scoped).
- [ ] `safe-send.test.ts` unchanged + green; teardown-once harness (H5) green incl. double + missed-dispose controls.
- [ ] **Restarted Duo yourself**; ran smoke § 1 + § 2 + QUIT-NO-CRASH leg; pasted results show socket DOWN after quit, no looping crash, terminal output intact.
- [ ] `terminal.spec` + `session-restore.spec` (single-window parity oracle) added and green.
- [ ] `typecheck` + `test:run` + `lint` + `build` green.
- [ ] **Cut 1 (P0+P1):** `/smoke-walk` via Skill tool (wait for pasted results) → `/cut-version`.

**P2 — DoD.**
- [ ] `createWindow()` returns a `WindowContext`, registers it, touches no process globals; `app.activate` zero-window guard intact.
- [ ] `BrowserManager` + `CdpBridge` are `WindowContext` fields.
- [ ] `safeSend` resolves via `registry.only()?.window`; `safe-send.test.ts` green unchanged.
- [ ] ~30 export-helper reads + push/reply dispatch resolve by identity (`registry.only()` / `event.sender`).
- [ ] Visibility cluster (`queryRendererDom`/`getLayoutSnapshot`/`openDevToolsForTarget`) resolves by identity and is exercised in the backgrounded-CLI smoke leg.
- [ ] `did-finish-load` replay state (`pendingOpenFilePath` + pin-restore) moved into `WindowContext`.
- [ ] Per-window BrowserManager shares the ONE partition/SSO jar + ONE `BrowserHistoryService`; does NOT re-register `protocol.handle` (re-register dry-run assertion green).
- [ ] Local grep-gate (`check:routing`) fails on new bare `mainWindow` in `.send` / `.executeJavaScript` / dialog-parent; proven via negative controls.
- [ ] Harness proves `registry.only()` identity-equality + tagged-send routing (H2 extended); NFR-1.1 holds (no per-event `getAllWindows()`, N=1 identity).
- [ ] Per-context `render-process-gone` handler (NFR-3.1) + per-context `safeSend` BUG-190 guard (NFR-3.3).
- [ ] App-level (via the `duo` CLI): single-window verb-cluster checks (browser/editor/nav/project) pass; backgrounded-CLI leg incl. the visibility cluster.
- [ ] **Restarted Duo yourself**; backgrounded-CLI (incl. visibility cluster) + browser-verb-parity legs pasted and passing; full single-window smoke unchanged.
- [ ] `typecheck` + `test:run` + `lint` + `build` green.

**P3 — DoD.**
- [ ] All 12 named caches are `Map<windowId, …>` with identity-resolved getters; checkmark reconcile side-effects preserved.
- [ ] All 13 named PUSH/STATE handlers un-discard `_event` and key by `event.sender`.
- [ ] `Session.ownerWindowId` added; EventSink routes `PTY_DATA`/`PTY_EXIT` to owner with sole-window fallback (H7).
- [ ] `disposeForWindow(id)` replaces unconditional `dispose()` for window-close; only `before-quit` calls global dispose; `applyNewSessionState` dispose scoped per-window (H6).
- [ ] `listIdsByCwd` filters by owner (C9 alignment).
- [ ] All 10 named reqId families validate `event.sender` (H4); swept in one pass.
- [ ] Dormant `DUO_WINDOW` PTY env-stamp present, unconsumed.
- [ ] Per-window `ClaudePresenceProbe` + `activeTerminalId`; presence fan-out scoped to originating window; idle-probe park + shared-ps-snapshot (NFR-1.3) with the park-transition unit test.
- [ ] Per-window titles (NFR-6.1) reflect each window's active workspace.
- [ ] Harness iterates the named 13+10 families (`describe.each`) + PTY owner-routing-with-fallback + `disposeForWindow` + reqId-foreign-sender-drop; all green.
- [ ] **Restarted Duo yourself**; read-verb parity + terminal + `duo send` + checkmark legs pasted and passing.
- [ ] `typecheck` + `test:run` + `lint` + `build` green.
- [ ] **Cut 2 (P2+P3):** `/smoke-walk` via Skill tool (full single-window matrix + backgrounded-CLI; wait for pasted results) → `/cut-version`.

**P4 — DoD.**
- [ ] Per-key triage done: global prefs stay on the storage bus; `cozy.byTab`/`fontBump.byTab`/`nav.cwd`/`nav.expanded` moved off it; per-window keys unsubscribed from the storage broadcast; old shared keys left in place but unread.
- [ ] cozy/fontBump byTab relocated into the per-tab session model; prune scoped per-window (H9).
- [ ] `session-state.json` is a `{windows: WindowState[]}` envelope (incl. per-window geometry/bounds, NFR-6.3); `SCHEMA_VERSION` bumped; per-window pending/debounce/flush.
- [ ] Back-compat migration (flat → envelope) round-trips (H8); boot peek reads both shapes; envelope read once (NFR-1.4).
- [ ] Downgrade path (NFR-8.2): version-mismatch guard at `session-state-service.ts:89` verified still fires; `.v1.bak` one-time backup written before first envelope write; downgrade contract documented in `docs/DECISIONS.md`/release notes.
- [ ] Migration round-trip + prune-isolation + downgrade pure tests green (node-env); quit/relaunch verified via the `duo` CLI.
- [ ] **Restarted Duo yourself**; single-window quit/relaunch restore byte-identical; cozy/font-bump persist; pasted results clean.
- [ ] `typecheck` + `test:run` + `lint` + `build` green.
- [ ] **Cut 3 (P4):** `/smoke-walk` via Skill tool (quit/relaunch focus; wait for pasted results) → `/cut-version`.

**P5a + P5b — DoD (v2: split into Cut 4a + Cut 4b).** Items below are tagged [4a] (window-opening shell, flag-gated) or [4b] (CLI addressing) per the §4 work-item mapping.
- [ ] [4a] "New Window" menu item + `duo window new` both register a second `WindowContext`; each window is an independent workspace; blank-default behavior (NFR-6.2); optional `--cwd`.
- [ ] `DuoRequest.windowId` threaded through `cli/duo.ts`; `SocketServer.handle()` resolves it, errors cleanly on unknown window (NFR-2.2), defaults windowId-less requests to terminal-origin (focused fallback).
- [ ] `DUO_WINDOW` PTY stamp wired to owner; default-resolution order `--window` > stamp > focused.
- [ ] `--window` override across project/nav-state/send/layout/eval/browser; `duo windows` enumeration verb; `duo cozy` verb; `duo doctor` extended (NFR-4.4).
- [ ] Structured routing logs (NFR-4.1). (Debug/verbose mode + counters are optional/cut per NFR-4.2/4.3 — not required for this cut.)
- [ ] macOS Window menu lists open windows (NFR-5.1); deterministic focus cycling + per-renderer a11y-tree not regressed (NFR-5.2). (Focus-reactive menu-checkmark reconciliation = post-P5 follow-on, not this cut.)
- [ ] N-window restore from the P4 envelope; per-window `did-finish-load` replay restores tabs/pins into the correct window (NFR-3.4); geometry restored + off-screen clamped (NFR-6.3); `--reveal` re-scoped to the targeted window.
- [ ] Shared cookie/SSO + isolated-window-future-opt-in documented (NFR-2.1) in `docs/DECISIONS.md`.
- [ ] Four-surface doc sync complete (all four files, same commit); `npm run build:cli && git add cli/duo`; `npm run sync:claude` run; doc-parity gate green (`npm run check:docs`, §5.3).
- [ ] Harness addressed-mode green (H10: windowId resolution + unknown-window error + stamped default + ignore-windowId negative control).
- [ ] Two-window scenarios verified via the `duo` CLI + `/smoke-walk` (open / address / isolation / lifecycle) — see §5.4.
- [ ] Multi-window section added to `docs/dev/smoke-checklist.md`.
- [ ] **Restarted Duo yourself**; FULL two-window live smoke walked (every verb cluster + shortcut matrix from BOTH windows + every modal via computer-use for WCV occlusion); close-one-of-two leaves the survivor fully functional + socket UP; relaunch restores both; per-window boot-replay verified — pasted results passing.
- [ ] `typecheck` + `test:run` + `lint` + `build` + `build:cli` green.
- [ ] [4b] **(v2)** `--window` re-scoped to the FULL surface (~26 browser/CDP + ~10 editor/nav verbs); tab/aux/split addressing composes `windowId` + per-window index; `duo tabs` names its window; `duo split-view`/`focus-pane` on the `--window` surface.
- [ ] [4b] **(v2)** the `duo events` per-window decision is STATED in the four-surface doc sync (app-global asymmetry OR `--window` filtering).
- [ ] [4b] **(v2)** the read-glow / `SocketServer.eventSink` cue lands in the addressed window (P3 item 11), verified live in window 2.
- [ ] **Cut 4a (P5a — first user-facing release):** `/smoke-walk` via Skill tool (open / restore / lifecycle / Window-menu / geometry from BOTH windows + every modal via computer-use; wait for pasted results) → `/cut-version`.
- [ ] **Cut 4b (P5b):** `/smoke-walk` via Skill tool — **full two-window verb matrix from BOTH windows + `--window` + `duo windows` + tab/aux/split; wait for pasted results, NEVER straight-to-cut** → `/cut-version`.

### 9.3 Overall Definition of Done (the whole ENH-191)

- [ ] **(v2)** Phase H + all phases P0–P4 + P5a + P5b complete with their §9.2 checklists green; **six cuts** shipped (Cut 0 + Cuts 1–4b, `/cut-version` per cut).
- [ ] Two independent agent-drivable workspaces: project A in window 1, project B in window 2, each with its own terminals/browser/`.duo-workspace`/pins/focus, each deterministically addressable via terminal-origin default + `--window` + `duo windows`.
- [ ] A verb from window 2 never mutates window 1 (verified across browser/editor/nav/project/terminal/visibility clusters). Close-one-of-two leaves the survivor fully functional + socket UP. Quit/relaunch restores both windows.
- [ ] **The cardinal rule holds everywhere:** no default send resolves by focus; the grep-gate is green and enforced; the single legitimate `getFocusedWebContents()` (`main.ts:2182`) is allowlisted.
- [ ] **Test net delivered (in-scope):** the node-env routing-assertion harness exists, is green (runs anywhere), touches `main.ts` routing / the socket bridge / `PtyManager` / `SessionStateService` / the caches for the first time, and carries negative controls (the only automated catch for the focus foot-gun); the leak-hunting smoke legs + the full two-window `/smoke-walk` run via the existing `duo` CLI + CDP + `/smoke-walk`; the local grep-gate (`check:routing`) and doc-parity gate (`check:docs`) pass. **No new test framework, no coverage tooling, and no CI is introduced** — a broader e2e/CI uplift remains a separate, out-of-scope initiative.
- [ ] All four CLI doc surfaces in sync (`cli/duo.ts` + `skill/SKILL.md` + `agents/duo.md` + `docs/CLI-COVERAGE.md`); `cli/duo` binary rebuilt + committed; `~/.claude` synced; `cli-plumbing.md` checklist carries the window dimension.
- [ ] No locked decision silently dismissed; any deferral carries explicit owner approval; all discovered issues logged to `tasks.md` and surfaced.

---

## Appendix A — Anchor drift log (corrections applied vs. the draft)

These are the exact-line corrections folded into this revision. The spec instructs re-grepping any anchor before depending on it; these are the known deltas at spec-authoring time (all within `~` tolerance, listed for precision):

- `protocol.handle` is at **`~main.ts:1017/1019`** (the `:968` in earlier drafts is a comment; the actual `handle` call is `:1017`).
- `ActiveWorkspaceService` `setTitle` is at **`~main.ts:2438`** (not `:2435`).
- C9 `listIdsByCwd` positional cwd→tabId consumer (`tabsThatHostedClaude`) is at **`~main.ts:438`** (not `:436`).
- The boot peek (`sessionStateService.load()`) is at **`~main.ts:578`** (confirmed).
- `createWindow()` call-sites: **`~main.ts:1137`** (boot, `void createWindow()`) and **`~main.ts:1187`** (`app.activate` zero-window guard) — confirmed.
- The `'35 ipcMain.on'` decorative row from the draft is **dropped** — the real combined `ipcMain.on/.handle` count is 100+; it is irrelevant to the sweep, which iterates the explicit **13 PUSH + 10 reqId** named lists. Do not use a raw `ipcMain` count to scope P3.
- Grep-gate baseline **32** (29 `mainWindow.webContents.send` + 3 `.executeJavaScript`) is `mainWindow`-specific and verified exactly; ignore any "~60 / 67 webContents.send" figure from upstream notes — that counts ALL `webContents.send` (a different, larger surface) and is not the gate baseline. **[v2 correction: the true baseline is 40 — the 8 optional-chain `mainWindow?.webContents.send` sites were uncounted; see §5.3 / §8.4.4 / Appendix D.]**

### Post-P1 re-baseline (2026-06-06 — dev branch `claude/enh-191-multiwindow` after P1a–P1d)

P1 shipped, so the spine anchors moved again **and the socket left `createWindow` entirely**. **P2 must re-grep against this branch's HEAD, not `main`** — these are the dev-branch values:

| Anchor | Draft / v2 | Now (post-P1) | Note |
|---|---|---|---|
| `let mainWindow` decl | :249 → :252 | **:265** | |
| `safeSend = makeSafeSend(() => mainWindow)` | :261 | **:277** | the identity-resolve seam (cardinal rule) |
| `async function createWindow` | :509 | **:556** | |
| `mainWindow.on('closed')` | :956 | **:896** | **per-window teardown only** now (P1c) |
| `void createWindow()` (boot) | :1137 | **:1237** | |
| `app.on('activate')` zero-window guard | :1187 | **:1286–:1287** | the dock-reopen path P1 made safe |
| `getFocusedWebContents()` (the ONE menu item — leave it) | :2182 | **:2313** | still exactly **1** |
| `getFocusedWindow()` for sends | 0 | **0** | cardinal rule holds |
| `new SocketServer(...)` | :635 (in `createWindow`) | **:1124 (in `whenReady`)** | **LIFTED** out of `createWindow` (P1b) — no longer per-window |
| `externalDomainsService = new …` | :564 (in `createWindow`) | **:1106 (in `whenReady`)** | lifted (P1a) |
| `ptyManager.setEventSink` | :547 (in `createWindow`) | **:1101 (in `whenReady`)** | lifted (P1a) |
| raw `grep -c mainWindow` (LINE count) | 134 | **143** | a LINE count, not read-sites — scope P2 by the guard cluster + send taxonomy, **not** this number |
| grep-gate baseline `mainWindow??.webContents.(send\|executeJavaScript)` | 40 (v2) | **41** | 29 `.send` + 8 `?.send` + 4 `.executeJavaScript`; one `.executeJavaScript` site drifted in since v2 — use **41** as the P2 grep-gate floor |

The `createWindow`-local anchors the draft cited for P1 work (`SocketServer` :635, `ExternalDomainsService` :564, `PtyManager.setEventSink` :547, the three `closed`-handler teardowns :960–962) are now **historical** — P1a/P1b lifted those constructions to `whenReady`; P1c split the handler. As-shipped shape lives in commits `bb52a30` (P1b+P1c), `b68f998` (P1d tests), `def6596` + `b9d315e` (docs + review follow-ups).

## Appendix B — New files this spec introduces (one-glance)

| File | Kind | Phase |
|---|---|---|
| `electron/window-registry.ts` + `.test.ts` | pure module + harness | P0 (stub) → P2 (real) |
| `electron/window-teardown.ts` + `.test.ts` | pure orchestrator + harness | P0 module → P1 wired |
| `electron/window-resolve.ts` + `.test.ts` | pure resolver (identity/sender/addressed) | P2 → P5 (addressed) |
| `electron/cache-key.ts` + `.test.ts` | `WindowKeyedCache<T>` + fan-out | P3 |
| `electron/reqid-validate.ts` + `.test.ts` | sender-validated reqId resolver | P3 |
| `electron/eventsink-route.ts` + `.test.ts` | addressed ambient-cue router | P3 |
| `core/pty-owner.ts` (or folded) + `.test.ts` | owner-routing / disposeForWindow / owner-filtered listIdsByCwd | P3 |
| `core/session-envelope.ts` + `.test.ts` | migrate / read / compose | P4 |
| `renderer/state/perTabPrune.ts` + `.test.ts` | scoped byTab prune | P4 |
| `scripts/check-window-routing.sh` + `"check:routing"` script | standalone grep-gate (NOT eslint) | P2 |
| `scripts/check-cli-parity.sh` + `"check:docs"` script | four-surface doc-parity gate | P5 |
| `session-state.json.v1.bak` (write-once, at runtime) | downgrade-recovery backup | P4 |
| write-serialization in `core/{pins,nav-pins,projects,session-state}-service.ts` + `*.test.ts` (**v2**) | per-service RMW queue + unique tmp suffix + interleave tests | **Phase H** |
| per-window active-workspace pointer in `WindowContext` + `WindowState` (**v2**) | replaces the `active-workspace.json` singleton for titles | P3 item 10 / P4 item 8 |

---

## Appendix C — Reviewer punch-list (strengthening items from the adversarial spec review)

> The spec PASSED adversarial review ("MEETS THE BAR"); these are strengthening additions the executing agent should treat as **extra acceptance criteria**, not blockers.

> **▸ v2 note (2026-06-05):** Appendix C below is the **v1 self-review against v0.8.5** — retained for provenance. The v2 audit (against v0.8.6) **confirmed its three headline gaps were real** and folded them in (eventSink → P3 item 11; tab/aux/split → P5b; the projects fan-out → P3 item 12), but also found gaps **this self-review missed** (the `only()`/`all()` taxonomy, the R6 lost-update it actively *dismissed*, the `ActiveWorkspaceService` split, the grep-gate optional-chain blind spot) and **corrected several counts it "verified exactly"** (the 32 baseline is 40; "134 read-sites" is a line count). Treat any specific number in this appendix as v0.8.5-era; **Appendix D supersedes.**

**Verdict.** MEETS THE BAR with required additions. This is an unusually strong, code-grounded execution spec. I independently verified the load-bearing anchors against the live repo (Duo v0.8.5) and they hold: 134 mainWindow read-sites (electron/main.ts), the single getFocusedWebContents at :2182, safeSend wired makeSafeSend(() => mainWindow) at :261, createWindow at :509, the closed handler at :956, exactly 29 mainWindow.webContents.send + 3 .executeJavaScript = 32 (the grep-gate baseline), all 12 cache decls at their cited lines, all 13 PUSH/STATE handlers using _event at their cited lines, all 10 reqId pending Maps at :144-:232, the C13 prune at App.tsx:2685-2710 writing shared keys with cozy/fontBump NOT among the 3 storage-event subscribers, DuoRequest={id,cmd,args} with no windowId, SessionState at :697, SCHEMA_VERSION=1 with the version-mismatch-returns-empty guard at :89-90, dispose() called both at before-quit (:1203) AND in applyNewSessionState (:2717), dialog-parents at 1564/2496/2608/2645, protocol app-scoped at :36/:1017-1019, browserHistory module-global at :369, ActiveWorkspaceService title at :2438, and socket-server importing electron deps as `import type` only (harness buildable day one). The phase plan, NFRs, test strategy, risk register, and DoD checklists are genuinely self-contained and executable by a fresh agent. The spec also correctly absorbed every gap the upstream progression-digest critique raised (visibility cluster → P2 item 6; did-finish-load per-context → P2 item 7; the 35→13+10 cache-sweep correction → P3; shared BrowserHistory/SSO singleton → P2 item 8; listIdsByCwd owner-filter → P3 item 5; P4-ordering-is-isolation-not-dependency). HOWEVER, three regression-matrix areas have no home in the addressing/routing work and MUST be added before this is execution-complete: (1) browser tab-id ambiguity (nextId=1 per BrowserManager makes duo tab/close/tabs ambiguous across windows; the aux-slot is a second per-window single-slot surface) — verified at browser-manager.ts:111/:120; (2) the SocketServer.eventSink ambient-cue path (read-glow + browser:focus-gained at socket-server.ts:977/:738 route through safeSend→mainWindow and will always paint in window 1) — a routing root distinct from both the 134 mainWindow sites and the PtyManager EventSink the spec already scopes; (3) the split-view/focus-pane/aux CLI surface (duo split-view, duo focus-pane at cli/duo.ts:811/:750) is omitted from P5's --window list and window×(main|aux) addressing is never specified. None sink the plan; all three are bounded additions to P3 (eventSink) and P5 (tab/aux/split addressing).

**Gaps to close.**
- BROWSER TAB-ID AMBIGUITY HAS NO HOME (verified browser-manager.ts:111 `nextId = 1`, :120 `auxTabId`). nextId is per-BrowserManager and globally unique ONLY because there is one manager today. P2 makes BrowserManager per-window but NO phase addresses how `duo tab <n>` / `duo close <n>` / `duo tabs` disambiguate once two windows each have a tab 2. The CLI verbs exist (cli/duo.ts:565/568/574). This is a CLI-parity blocker the same class as the DuoRequest windowId gap: P5 threads --window for project/nav/send/browser but the per-window tab strip indexing + the aux/split single-slot (window×(main|aux)) addressing is unspecified. Add to P5: tab/aux addressing must compose windowId with the per-window tab index, and `duo tabs` output must identify its window.
- SOCKETSERVER.EVENTSINK AMBIENT CUES NEVER RE-ROUTED (verified socket-server.ts:289 setEventSink, :738-740 'browser:focus-gained', :977-978 'claude:read-selection' read-glow). This eventSink is wired to safeSend→mainWindow (main.ts:737), a routing root SEPARATE from both the 134 mainWindow sites and the PtyManager EventSink that P3 item 3/8 scopes. As written, a `duo selection` read-glow fired for window 2's editor, or a browser focus-gained cue for window 2, ALWAYS paints in window 1. The spec's P3 scopes the presence triple-fan-out and PtyManager PTY_DATA routing but is silent on the SocketServer.eventSink. Add to P3: SocketServer.setEventSink must resolve the target window (the command already knows which window it addressed) so ambient cues land in the addressed window, not always window 1. Regression matrix flags this explicitly (events-follow + ambient cues, coverage:none).
- SPLIT-VIEW / FOCUS-PANE / AUX SURFACE OMITTED FROM ADDRESSING (verified cli/duo.ts:750 focus-pane, :811 split-view; browser-manager.ts:120 auxTabId, :283 restoreFromSession activeIndex). P5's --window enumeration lists 'project / nav-state / send / layout / eval / browser' but NOT split / split-view / focus-pane. The aux slot is per-window single-slot state (splitPct in SessionState too). The regression matrix lists Split-pane/split-view/focus-pane as coverage:none. Add split-view/focus-pane to the P5 --window surface and to the two-window smoke matrix; specify that splitPct + auxTabId are per-WindowState in the P4 envelope (P4 item 3 says 'splitPct' but never names the aux tab).
- EVENTS --FOLLOW PER-WINDOW SEMANTICS UNDEFINED (verified socket-server.ts:284 events:EventBus, :434-455 streaming handler; one app-level EventBus at main.ts:484). DuoEvent lines carry no windowId, so `duo events --follow` cannot filter by window. The spec never mentions duo events at all. This may be acceptable (canvas duo:event is arguably app-global) but the decision must be STATED — either 'events stays app-global (documented asymmetry per CLAUDE.md §4)' or '--window filtering added'. Currently a silent gap an executor will hit when the four-surface doc sync forces them to document every verb's window behavior.
- NEW-WINDOW PROJECT-FILTER INTERACTION WITH SHARED projects.json UNSPECIFIED. Locked: project membership is SHARED (projects.json), but each window has its own focus/filter (duo project focus is per-window in P5). The regression matrix (Project filter/focus rail, critical) notes a pin change must broadcast to BOTH windows' trees (projects.json is shared) while focus stays per-window. The spec's P2 item 8 / §3.3 say 'change broadcasts widen to all windows' for projects/pins/nav-pins but never reconciles this with the per-window projectsState cache (P3 keys projectsState into Map<windowId>). If projectsState is per-window-keyed AND a projects.json change must repaint all windows, the broadcast path (which window(s) get PROJECTS_STATE pushed back) needs an explicit fan-out-to-all rule. State it in P3.
- NO ROLLBACK for the multiWindow.enabled flag-storage location failure mode. §7.2 says the flag lives in userData settings and must NOT ride the storage-event bus, but there is no rollback/migration note for what happens if a user toggles the flag off WITH a second-or-later window's WindowState already persisted (P4 envelope). §7.2 says 'restore only the first WindowState; the rest stay persisted but dormant' — but does not say whether quit-with-flag-off then re-persists and DROPS the dormant windows (data loss on the next save). Specify that a flag-off boot must NOT overwrite/prune the persisted dormant WindowStates on its next debounced write, or the kill-switch silently discards window 2's restored layout.

**Agentic-executability fixes.**
- **[P0 work-item 4 (color-override cut) — the 'zero live callers' framing]** The spec says 'grep for .setColorOverride in renderer/ returns zero live callers' (TRUE — I verified grep exit 1, no renderer invocation of the bridge method). But it then lists removal of `colorOverrides` from shared/projects.ts derivation (:170/:276/:456), useProjects.ts, and App.tsx:899-929 — which ARE very much alive (I verified colorOverrides threads through deriveProjects input, the useProjects memo deps at :231, and the App.tsx state+memo). A fresh agent reading 'zero live callers' may under-scope and only delete the dead IPC handler, leaving the colorOverrides derivation field dangling (typecheck would then fail or the field would persist unused). → _fix:_ Reword to: 'the WRITE invocation is dead (no renderer caller of the bridge method), but the colorOverrides DATA still threads through derivation (shared/projects.ts:170/276/456, useProjects.ts:54/77/217/231, App.tsx:899/906/909/929) — remove BOTH the write-path AND the derivation field in one pass, and confirm typecheck is green afterward (the field flows into deriveProjects input so a partial removal breaks the type).'
- **[§4 anchor table + §3.1 — createWindow() return type]** The spec repeatedly says P2 makes createWindow() 'build and RETURN a WindowContext' and §3.1 describes a registry-of-one where registry.only() replaces mainWindow. But the live signature is `async function createWindow(): Promise<void>` (verified electron/main.ts:509). A fresh agent will refactor the return type from void to Promise<WindowContext>; the spec should explicitly flag that this is a signature change and that the single call-site at app.whenReady (and the app.activate zero-window path at ~:1186) must be updated to consume/register the returned context. Currently the executor must infer the call-site change. → _fix:_ Add to P2 item 1: 'createWindow() currently returns Promise<void> (electron/main.ts:509). Change it to Promise<WindowContext> and update the boot call-site (in app.whenReady) and the app.activate zero-window guard (~:1186) to register the returned context. Confirm both projects typecheck.'
- **[§5.3 grep-gate / §8.4.4 — eslint config form for the CI hook]** The spec proposes wiring scripts/check-window-routing.sh 'into lint' and references the eslint config implicitly. I could not locate an eslint config file by the usual names (.eslintrc*, eslint.config.*) at repo root — `npm run lint` is `eslint .` (verified package.json:26) but the config form/location is not where the spec assumes. A fresh agent told to 'wire into lint' may not find the config to hook. The grep-gate is better as a standalone npm script invoked as a local/pre-commit step, not folded into eslint. → _fix:_ Specify the grep-gate as its own package.json script (e.g. "check:routing": "bash scripts/check-window-routing.sh") run as a discrete local step alongside typecheck/test/lint, NOT folded into the eslint config (whose form/location is non-obvious). State that the executor must locate the actual lint config (eslint flat-config or legacy) before assuming it can host a custom rule.
- **[§4 P3 — 'reconcile menu-checkmark side-effects' (Show-Hidden-Files reconcile in NAV_STATE_PUSH)]** P3 item 1 says to reconcile the Show-Hidden-Files menu-checkmark side-effect 'in NAV_STATE_PUSH' so it fires for the correct window. But menu checkmarks are a SINGLE global app menu (one Menu instance), not per-window — reconciling 'for the correct window' is ambiguous: when window 2 is focused, the global menu's checkmark must reflect window 2's cache slot, and must re-reconcile on focus-change (the C10 cluster, deferred to the optional post-P5 follow-on per §4's closing paragraph). A fresh agent will be confused about whether P3 makes the checkmark per-window (impossible — one menu) or focus-reactive (which the spec defers). → _fix:_ Clarify P3: 'The 12 caches become per-window, but the global app menu's checkmarks read the FOCUSED window's slot. In P3 (still N=1) the checkmark reconcile is unchanged behavior. The focus-reactive re-reconciliation across windows (reading the focused window's cache on focus-change) is the C10 menu-checkmark sweep — owned by the optional post-P5 follow-on (§4 closing paragraph), NOT P3. P3 only ensures the cache SLOT is correctly keyed.'

**NFR holes.**
- NFR-1.4 (startup scales sub-linearly) cites 'the boot peek of session-state.json ~main.ts:578' — I verified the boot peek IS at :578 (sessionStateService.load() consumed for hasPersistedSession). But the acceptance criterion 'cold launch restoring 2 windows within ~1.5x single-window' has no measurement method specified (no timing harness exists, and Electron launch timing is not unit-testable in the Linux CI). Either specify it as a manual stopwatch step in the P5 smoke or drop the numeric target as unverifiable.
- NFR-1.2 / NFR-1.3 memory + CPU budgets ('within ~30 MB drift after 10 cycles', 'ps spawn rate ≈ 0/sec') have no automated measurement path — these are macOS-local-only manual observations, but the NFR table assigns them to phases as if gateable. The spec should explicitly tag these acceptance criteria as MANUAL (Activity Monitor / ps counting) since the Linux CI cannot run Electron and no perf harness is proposed. Risk: an executor treats a numeric budget as a blocking gate it cannot build.
- NFR for the SocketServer.eventSink ambient-cue routing is entirely ABSENT (verified socket-server.ts:738/977). This is a correctness/usability dimension (a read-glow in the wrong window is user-visible misdirection) with no NFR and no acceptance criterion. Add an NFR (or fold into NFR-6/NFR-7.2) requiring ambient cues to land in the addressed window.
- NFR for browser tab-id addressing determinism is ABSENT. With per-window BrowserManagers each starting nextId=1, `duo close 2` ambiguity is a data-safety issue (close the wrong tab in the wrong window). No NFR covers it. Add an acceptance criterion: tab ops resolve windowId+index deterministically; ambiguous bare `duo close 2` with two windows errors or defaults to the terminal-origin window.
- NFR-8.3 (localStorage triage non-destructive) names cozy.byTab/fontBump.byTab/nav.cwd/nav.expanded but the duo.nav.* keys live in renderer/hooks/useNavigator.ts which the spec references without a verified line anchor (every other anchor is file:line; this one is file-only). A fresh agent must grep to find the exact keys. Minor, but inconsistent with the spec's own anchoring discipline — add the line anchors for duo.nav.cwd / duo.nav.expanded.
- No NFR addresses CONCURRENCY on the shared on-disk singletons under genuine multi-window write pressure beyond browser-history (regression matrix 'Shared on-disk state concurrency' is high/partial and names projects.json, pins.json, nav-pins.json, .duo.json comment sidecars, external-domains.json). The spec defers only browser-history N-writer hardening to post-P5 but is silent on whether two windows simultaneously editing pins.json / nav-pins.json / a .duo.json comment sidecar can corrupt (these are real per-window-initiated writes to shared files). Add an NFR or at least a stated risk that these shared-file writers remain single-writer-per-app-via-the-main-process (they already funnel through main, so likely safe — but state it).

**Test-realism issues.** _(The Playwright / coverage-specific items were removed in the 2026-06-02 trim — that tooling was cut; app-level checks use the existing `duo` CLI + `/smoke-walk`. The H8 negative-control reframe to a persisted-field drop is applied inline in §5.1.2.)_

**Inconsistencies.**
- COUNT INCONSISTENCY (self-consistent but differs from source, worth flagging): the spec's grep-gate baseline is '32' (29 send + 3 executeJavaScript, mainWindow-specific) which I VERIFIED exactly. The upstream progression-digest cites '67 webContents.send sites' / '~60 call sites'. These measure different things (mainWindow-specific vs ALL webContents.send), so the spec is internally consistent — but the §4 anchor table row 'mainWindow.webContents.send sites = 29' coexists with prose elsewhere implying ~60. Not an error in the spec, but an executor cross-referencing the digest (if it still existed) would see a mismatch. Since the spec is self-contained and the digest is gone post-compaction, this is harmless — noting for completeness.
- ipcMain.on COUNT: the spec says '35 ipcMain.on total (NOT the cache surface)' in the §4 anchor table. I measured 108 ipcMain.on+ipcMain.handle combined (could not cleanly isolate .on alone, but it is clearly >35). The spec correctly tells the executor to use the explicit 13 PUSH + 10 reqId lists, NOT the raw ipcMain count, so the 35 figure is decorative and the guidance is safe — but the 35 itself appears inaccurate (likely stale). Recommend dropping the '35' row or correcting it, since a wrong anchor number erodes trust in the otherwise-verified table.
- ANCHOR DRIFT (minor, all <50 lines): §4 cites protocol.handle at ':968/1019' — I verified :1017/:1019 (the :968 is a comment, the actual handle is :1017). §4 cites ActiveWorkspaceService title at '~main.ts:2435' — actual setTitle is :2438. §4 cites C9 listIdsByCwd consumed '~main.ts:436' — actual is :438. NFR-1.4 cites boot peek '~main.ts:578' — actual :578 (correct). These are all within the spec's own '~' tolerance and the spec instructs 're-grep if drift is suspected', so they are acceptable — listing for precision.
- §4 P4 'Ordering note' and §8.8.1 both correctly state P4→P3 is release-isolation not a hard dependency. CONSISTENT and well-handled. No conflict — endorsing this rather than flagging.
- §6 NFR-1.3 says the per-window ClaudePresenceProbe 'POLL_INTERVAL_MS = 500, one ps -ax per probe per cycle' — I VERIFIED core/claude-presence.ts:28 (500), :60 (setInterval), :110 (ps -ax -o pid,ppid,comm). Fully consistent. Endorsing.
- §7.2 flag-gating says the windowId-resolution branch in SocketServer.handle 'merges dark / does NOT gate' and is 'byte-identical at N=1', while §7.6 guardrail 5 says unknown windowId 'errors cleanly'. With the flag OFF and only one window, a `duo --window 2` would hit the dark-merged resolver and error 'no such window' — but duo window new is gated to return 'multi-window is disabled'. There is a small inconsistency: with the flag off, can a user even pass --window? The spec should state that --window is parsed/resolved even when the flag is off (it just won't find a second window), OR that --window is also gated. Currently ambiguous whether the addressing CLI is flag-gated or only the window-OPENING is. **[v2: RESOLVED — §7.2 now states `--window` is always parsed/resolved; only window-opening is flag-gated.]**

---

## Appendix D — v2 corrections summary (2026-06-05 audit)

> Every change folded into v2, mapped to its audit finding. The verdict held at **trustworthy-with-fixes** (3 independent critics concurred); the architecture and the registry-of-one de-risking sequence are unchanged. **✱** = missed by BOTH the v1 body AND the v1 Appendix C self-review. The audit was a 15-agent adversarial pass against current `main` (v0.8.6); the v1 self-review was against v0.8.5.

**Structural (owner decisions 2026-06-05):**
- **Cut 0 = Phase H** (write-serialization hardening) pulled AHEAD of all multi-window work — fixes R6 (latent today).
- **P5 split → P5a (Cut 4a, window-opening shell, flag-gated) + P5b (Cut 4b, full CLI addressing).**

**HIGH — "byte-identical at N=1, detonates at P5":**
- ✱ **`only()`-vs-`all()` send taxonomy** — v1 never used `registry.all()`; shared-state broadcasts (`PROJECTS_CHANGED`/`NAV_PINS_CHANGED`/`EXTERNAL_REDIRECTED`) would repaint only one window. → §3.1, P2 item 10.
- ✱ **Concurrent lost-update (R6)** on `pins`/`nav-pins`/`projects` + the `SessionStateService` single-writer guarantee P4 was about to dismantle. Appendix C named the class and **wrongly dismissed it** ("funnels through main, so safe"). → Phase H, P4 item 4, R6.
- ✱ **`ActiveWorkspaceService` split** had no work item though NFR-6.1 depends on it; `active-workspace.json` had no per-window persistence home. → P3 item 10, P4 item 8.
- **`--window` surface understated ~4–6×** (~26 browser/CDP + ~10 editor/nav verbs, not 6) and P5 overloaded for one cut. → P5b + item 4 re-scope + the split.

**MEDIUM:**
- ✱ **grep-gate blind to the optional-chain form** (`mainWindow?.webContents.send` — 8 sites incl. all 6 menu sends); baseline 32→**40**, regex widened. → §5.3, §8.4.4, P2 item 9.
- ✱ **`SocketServer.eventSink`** ambient-cue routing (read-glow) unscoped — a 3rd routing root distinct from the 12 caches + the PtyManager sink. → P3 item 11.
- ✱ **`focusPane` mis-categorized** as an export helper; it is an inline NavBridge closure that collides with P1's SocketServer lift. → P1 item 1a, P2 item 4.
- **BUG-191 live-cwd model** (v0.8.6, post-v1-baseline): `PTY_LIVE_CWDS` inventory (per-caller-safe, no fix) + the `lsof` poll as a 2nd per-window process-scan. → P3 inventory note, NFR-1.3b.

**Magnitude / re-grep corrections:** "134 read-sites" is a `grep -c` line count (~128 reads / ~185 refs); guard family is **46** not ~30; the visibility cluster's 3rd `executeJavaScript` is `revealMainPaneIfCollapsed`, **not** `openDevToolsForTarget`; there are **two** app-scoped `protocol.handle('duo-asset')` (`:1020`+`:1022`), not one; the decorative "35 `ipcMain.on`" row dropped.

**Smaller folds:** `--window` always parsed (only window-*opening* flag-gated — resolves the §7.2/§7.6 ambiguity); a flag-off boot must not prune dormant `WindowState`s; `auxTabId` added to the P4 envelope (v1 named only `splitPct`); the `duo events` per-window decision deferred to the P5b doc-sync; GAP-2 cue list corrected (`browser:focus-gained` is already per-window-correct via `browser-manager.ts:1446`). **Rollup stated: ~13–17 eng-weeks across 6 cuts** (P3 + P5b heaviest).

> **What v2 did NOT change:** the locked decisions (§2), the registry-of-one spine, the identity-not-focus cardinal rule, the node-env harness strategy, the C13 prune fix, and the 12/13/10 cache-sweep counts (all re-confirmed EXACT against v0.8.6). The audit's net: the architecture was always sound — the corrections are additive hardening of the routing taxonomy, the persistence/concurrency layer, and the user-visible cut's scope.

---

## Appendix E — Lessons learned (live)

Captured as the build proceeds — technical findings and process lessons. Newest first.

**Process / workflow**
- **`lsof` the socket owner before quitting/removing it — don't assume "packaged Duo."** During P1 dev, a peer agent's `npm run dev` (electron-vite in the primary checkout) owned `duo.sock`; assuming the owner was the packaged Duo, quitting "Duo" + `rm`-ing `duo.sock`/`duo.port` broke the *peer's* `duo` bridge (Unix path + TCP port-file both gone — only a dev restart rebinds). The "never leave multiple Duo dev instances" hazard cuts both ways: verify the socket's actual owner (`lsof <sock>`) before touching it. Reinforces the case for `app.requestSingleInstanceLock` (§4 Optional follow-on).
- **Worktree isolation is non-negotiable.** Dual-window dev MUST live in a dedicated worktree on a dedicated branch (`claude/enh-191-multiwindow`); a separate session owns `main` + merges. When work briefly ran in the *primary* checkout, a concurrent session's commit (`BUG-196`) tangled onto a feature branch — exactly the contention worktrees prevent.
- **Commit planning artifacts immediately.** This PRD was nearly lost — it sat uncommitted in a worktree that, like a sibling, was later deleted. Rescued via PR #71, then consolidated onto the dev branch (this copy). Never leave a source-of-truth doc only in a disposable worktree.
- **Re-grep anchors per phase; don't trust magnitude counts.** The v1 spec's headline numbers were wrong (Appendix C/D): "134 read-sites" is a line count (~128 reads); guards are 46 not ~30. Anchors drift every release (0.8.5 → 0.8.6 → 0.9.1) — re-baseline per seam.

**Technical**
- **macOS last-window-close is NOT a quit — a pre-implementation design pass caught a real N=1 regression before it shipped.** A design+stress workflow proved the draft's P1 item-4 rule ("app teardown on last-window OR before-quit") is wrong on darwin: `window-all-closed` no-ops, so closing the only window leaves the app alive and a dock-click fires `app.activate → createWindow()`. Stopping the socket / disposing external-domains on that close — combined with P1a's already-committed null of `externalDomainsService` + createWindow's non-null invariant — made close→dock-reopen **throw / leave the CLI permanently dead** (verified empirically in-tree). **Fix (owner-confirmed Option A):** `socketServer` + `externalDomainsService` are app-lifetime — constructed once in `whenReady`, torn down ONLY at `before-quit`; the `closed` handler tears down per-window state only. This fixed the latent P1a bug *forward* (no revert). Pinned by `window-teardown.test.ts`'s dock-reopen case + the live close→reopen smoke leg.
- **Don't trust the synthesized plan either — verify against ground truth.** The design synth proposed a `createWindow` guard `if (socketServer) throw` to pin single-construction, but it is inverted: the socket is now constructed in `whenReady` BEFORE `void createWindow()`, so that guard would throw on the FIRST window. Replaced with the correct mechanism — an idempotency guard in `SocketServer.start()` (`if (this.unixServer) return`), which actually prevents a P2 reentrant double-bind. (The same skepticism the owner applied to the spec writer applied to the design workflow's output — both were wrong in spots the test suite + a read-through caught.)
- **Capture the BrowserWindow id while the window is alive.** The `closed` event fires AFTER native destruction, so reading `mainWindow.id` inside the handler can throw "Object has been destroyed". Capture `const winId = mainWindow.id` *before* registering the handler; the closure uses the captured value (P2 keys the registry on this id).
- **Tooling must match the repo's Node.** Node here is 18.17.0; ESLint 9 floors at 18.18 and **ESLint 10 hard-crashes** on `util.styleText` (a Node 20.12+ API). Pinned ESLint 8.57 + typescript-eslint 7 + flat config (PR #69).
- **The lint gate was a silent no-op** — `eslint` was never a declared dependency, so `npm run lint` did nothing. Restored in PR #69; the verify-loop's lint step is now real.
- **Pull latent concurrency bugs forward.** Phase H (the `pins`/`nav-pins`/`projects`/`session-state` lost-update, R6) was latent *today*, independent of multi-window — fixing it first (Cut 0) de-risked the foundation instead of surfacing mid-P4.
- **Harness discipline holds.** Every extracted module (`safe-send` → `window-registry` → `window-teardown`) ships node-env tests with negative controls **proven to fail when the guard is defeated** — the only automated catch for the focus-substitution / double-stop foot-guns.

**Deferred follow-ups (discovered during P1 — not gating P1)**
- **claudePresence per-window probe → P3 (dock-reopen listener leak FIXED in P1).** The listener leak (each `createWindow` re-subscribed `claudePresence.onChange` without unsubscribing → a leaked listener + duplicated fan-out per close-reopen cycle) is **fixed in P1c**: `createWindow` captures `const unsubPresence = …` and the `closed` handler calls `unsubPresence()`. `claudePresence.start()` was already idempotent (`if (this.timer) return`), so there was no interval leak. The post-close tick was already null-safe (`cdpBridge?.setClaudeLive`, `if (browserManager)`, `safeSend` no-op). The broader per-window `ClaudePresenceProbe` (one probe *instance* per window, vs today's one app-scoped probe) remains **P3 item 8** — not needed at N=1.
- **No `app.requestSingleInstanceLock()` (pre-existing).** Two Duo processes (or relaunch-before-old-exits) both reach `SocketServer.startUnix()` (`unlinkSync` stale → `listen`), the second silently hijacking the bridge. Out of P1 scope (single-construction within one process is satisfied + `start()` is now idempotent). File as a tracked ENH: add `requestSingleInstanceLock` to mechanically prevent the cross-process double-bind. Until then, the pre-flight "no stray Electron + socket DOWN" check stays a HARD gate before every dev launch.

**Open process item**
- **ENH number — RESOLVED (owner, 2026-06-06): multi-window keeps ENH-191.** Phase H / PR #68 already shipped under it. Follow-up (merge session / owner, on `main`): renumber the pre-existing *"Docs deep-clean"* entry in `tasks.md` to clear the collision.
