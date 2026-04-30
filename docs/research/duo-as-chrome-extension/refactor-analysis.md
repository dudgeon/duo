# Refactor analysis — dual-target codebase

**Status:** Analysis, 2026-04-29. Reads on top of
[`./README.md`](./README.md) and
[`./mvp-plan.md`](./mvp-plan.md). The MVP plan walks the extension
shape *as a sibling to* the Electron app; this document asks the
deeper question: **what would the codebase look like if we
committed to supporting both targets long-term, and which of those
changes are wins regardless of whether the extension ever ships?**

> **Note (2026-04-29 update):** [`./build-roadmap.md`](./build-roadmap.md)
> composes this analysis's no-regrets moves 1–4 (now Stage A) and
> the MVP plan's phases (now Stage C) with post-MVP stages into a
> single end-to-end sequence. Read `build-roadmap.md` first for the
> full picture; come here for the no-regrets framing.

---

## TL;DR

**Most of `electron/` isn't actually Electron-specific.** Empirically,
[`grep "from 'electron'" electron/*.ts`](../../../electron/) shows
**9 of 17 files** import nothing from Electron at all — they sit in
`electron/` only because the main process imports them from there.
Of the 8 that do import, **3 of those use Electron only at the
surface** (a `WebContents.send` call to push events to the renderer)
with a Node-pure core underneath. So the truly-Electron-coupled
surface is **5 files out of 17** (`main`, `preload`,
`browser-manager`, `cdp-bridge`, `auto-updater`, `install-service`,
+ the one Electron API call inside `pty-manager`/`files-service`).

The headline implication: **a service-extraction refactor is
already overdue and pays off whether or not we ship the extension.**
It's the largest single chunk of dual-target work and it's also the
biggest single hygiene win on the existing app. Doing it first makes
the [MVP plan's Phase 0](./mvp-plan.md#phase-0--native-messaging-keep-alive-proof--½-day)
much cleaner — the helper just imports from `core/` instead of
re-implementing five services.

What follows: today's structure, the seven moves a committed
dual-target codebase needs, then a filter pass on each move for
no-regrets / conditional / cosmetic.

---

## Today's structure

```
duo/
├── electron/                              17 .ts files, 5 truly Electron-coupled
│   ├── main.ts                            ★ Electron — app lifecycle
│   ├── preload.ts                         ★ Electron — contextBridge / ipcRenderer
│   ├── browser-manager.ts                 ★ Electron — WebContentsView
│   ├── cdp-bridge.ts                      ★ Electron — webContents.debugger
│   ├── auto-updater.ts                    ★ Electron — electron-updater
│   ├── install-service.ts                 ★ Electron — permission UI
│   ├── pty-manager.ts                     ◐ Electron at surface, Node-pure core
│   ├── files-service.ts                   ◐ Electron at surface, Node-pure core
│   ├── update-checker.ts                  ◐ Electron at surface, HTTP-pure core
│   ├── browser-history-service.ts         ✓ pure Node — only fs
│   ├── claude-presence.ts                 ✓ pure Node — child_process + ps
│   ├── constants.ts                       ✓ pure Node
│   ├── nav-pins-service.ts                ✓ pure Node — fs
│   ├── pins-service.ts                    ✓ pure Node — fs
│   ├── resolve-claude.ts                  ✓ pure Node — fs path resolution
│   ├── session-state-service.ts           ✓ pure Node — fs
│   ├── skills-scanner.ts                  ✓ pure Node — fs
│   └── socket-server.ts                   ✓ pure Node — net.createServer
├── renderer/                              React, xterm, TipTap, HtmlCanvas
├── shared/
│   ├── types.ts                           1338 lines — IPC shapes + UI types mixed
│   ├── html-boilerplate.ts                143 lines
│   ├── fork-config.d.ts                   39 lines
│   └── ulid.ts                            46 lines
└── cli/
    └── duo.ts                             single binary, talks Unix socket / TCP

Legend:
  ★  fundamentally tied to Electron — stays where it is
  ◐  surface-coupled — needs an interface adapter
  ✓  already pure Node — could move to core/ today with zero behavior change
```

The pure-Node services are the bulk of the file I/O, persistence,
process detection, and skill-scanning logic. They're sitting in
`electron/` because of where they happened to be born, not because
of any architectural reason.

---

## The seven moves a committed dual-target codebase needs

Sequenced from "purely a file-rename and import-update" to "a
genuine maintenance commitment."

### Move 1 — Extract pure services to `core/`

Promote the nine ✓-marked files to a top-level `core/` package:

```
core/
├── browser-history/BrowserHistoryService.ts
├── claude/ClaudePresence.ts
├── claude/resolveClaude.ts
├── constants.ts
├── nav-pins/NavPinsService.ts
├── pins/PinsService.ts
├── session-state/SessionStateService.ts
├── skills/SkillsScanner.ts
└── socket-server/
    ├── SocketServer.ts                    moved from electron/
    └── commands.ts                        the Stage-20 dispatcher
```

Mechanical move — no behavior change. Update imports in
[`electron/main.ts`](../../../electron/main.ts). Done.

**Cost:** ~1 day including import-update sweep and a typecheck pass.

### Move 2 — Split the surface-coupled trio

[`electron/pty-manager.ts`](../../../electron/pty-manager.ts)
imports `WebContents` from electron and calls `webContents.send()`
to push PTY data to the renderer. Same for
[`electron/files-service.ts`](../../../electron/files-service.ts).
[`electron/update-checker.ts`](../../../electron/update-checker.ts)
similar pattern.

Replace the `WebContents` dependency with an `EventSink` interface:

```ts
// core/transport/EventSink.ts
export interface EventSink {
  send(channel: string, payload: unknown): void;
}
```

Electron implementation: a five-line adapter wrapping `WebContents`.
Helper implementation (post-extension): wraps the SW port. The
service code itself sees only `EventSink`.

After this move, `core/pty/PtyManager.ts` and
`core/files/FilesService.ts` are pure Node + node-pty + chokidar.

**Cost:** ~half a day. The interface is small, the surface is local.

### Move 3 — Split `shared/types.ts`

Today's [`shared/types.ts`](../../../shared/types.ts) is 1338 lines
mixing IPC channel shapes, command types, UI prop types, and various
domain models. Split into:

```
shared/
├── protocol/                              IPC + CLI message shapes
│   ├── ipc.ts                             channels, request/response shapes
│   ├── commands.ts                        DuoCommandName + per-verb args
│   └── events.ts                          PTY data, file watch, nav events
├── domain/                                pure data types
│   ├── files.ts                           FileNode, classifications
│   ├── canvas.ts                          HtmlOpRequest, edit-log entries
│   ├── editor.ts                          DuoSelection, doc shapes
│   └── browser.ts                         tab state, history entries
└── (existing) html-boilerplate.ts, ulid.ts, fork-config.d.ts
```

Mechanical re-organization. Imports change shape; nothing breaks.

**Cost:** ~half a day plus careful re-export work to avoid churn in
every renderer file. Could be done as `shared/types.ts` re-exporting
from the new files, then files migrate to direct imports gradually.

### Move 4 — Formalize the renderer's host interface

Today the contract that
[`electron/preload.ts`](../../../electron/preload.ts) builds is
implicit — `window.electron` is whatever shape preload happens to
construct. The renderer declares the type via
`renderer/electron-window.d.ts` (or similar).

Promote the contract to a first-class interface:

```ts
// shared/host/HostApi.ts
export interface HostApi {
  pty: PtyHostApi;
  files: FilesHostApi;
  browser: BrowserHostApi;
  nav: NavHostApi;
  editor: EditorHostApi;
  canvas: CanvasHostApi;
  // ...
}
```

Two implementations:

- `electron/preload.ts` — today's flow, but now satisfies
  `HostApi` at the type level.
- `extension/shim/window-electron.ts` — the SW-port version (built
  if/when we walk the extension).

The renderer's global declaration becomes
`declare global { interface Window { duoHost: HostApi } }`. (Optional
rename: `window.electron` → `window.duoHost`. The lying name is
harmless if you skip the rename; it's a one-replace-all if you do
it.)

**Cost:** ~half a day. Declaring the interface, fixing two or three
shape mismatches that emerge from the audit.

### Move 5 — Transport-agnostic CLI

[`cli/duo.ts`](../../../cli/duo.ts) today has its transport logic
inline — Unix-socket-first, TCP fallback. Two refactors needed:

1. **Extract a `Transport` abstraction:**

```ts
// cli/transport/Transport.ts
export interface Transport {
  connect(): Promise<void>;
  send(req: DuoRequest): Promise<DuoResponse>;
  close(): void;
}
```

2. **Implement two transports today:**
   - `UnixSocketTransport` — current code
   - `TcpTokenTransport` — current Stage-20 fallback

   The extension transport (whatever it ends up being — most likely
   a helper-spawned local socket the helper-launched PTY can reach)
   slots in as a third implementation later.

3. **Discovery layer:** the CLI tries each transport in order based
   on what config files / env vars / port files are present.

**Cost:** ~half a day. Mostly a re-org of existing code.

### Move 6 — Build pipeline for two targets

This is where dual-target stops being free.

```
package.json scripts (today)
  dev          → electron + vite
  build        → electron prod
  dist         → DMG

package.json scripts (dual-target)
  dev:electron     → today's flow
  dev:ext          → vite for extension + helper watch + Chrome reload hook
  build:electron   → today's prod
  build:ext        → packs extension/ for Web Store
  build:helper     → packs helper binary
  dist:electron    → DMG
  dist:ext         → Web Store zip + helper PKG
```

Vite needs two configs (one per target's entry points). The renderer
component imports stay the same; only the entry scaffolding differs.

**Cost:** ~1 day of build-pipeline work, plus ongoing CI / release-
script maintenance whenever the build moves.

### Move 7 — Plumbing-checklist evolution

[`CLAUDE.md`](../../../CLAUDE.md) has the **CLI plumbing checklist**:
adding a new verb touches `shared/types.ts`, `electron/preload.ts`,
`electron/main.ts`, `electron/socket-server.ts`, `cli/duo.ts`,
`skill/SKILL.md`, `agents/duo.md`, `docs/CLI-COVERAGE.md`. That's
8 files today.

Dual-target:

- The first three (`shared/types.ts`, preload, main.ts) split into
  protocol + Electron-specific main vs. extension-specific SW.
- `socket-server.ts` is now in `core/` and serves both targets, so
  one file instead of two.
- `cli/duo.ts` still one file (the transport layer hides the
  difference).
- Skill, agent, coverage docs unchanged.

Net: ~10 files instead of 8. The cost isn't the additional touches
— it's that adding a verb now means *testing in both targets* every
time. That's a real maintenance commitment.

**Cost:** Small per-verb. Aggregated cost: real. Adding 50 verbs
over a year at +5 min each is 4 hours of additional testing labor
spread across a year. Tolerable, not trivial.

---

## No-regrets filter

For each move, ask: **does this pay off if we never ship the
extension?** Filter into three buckets.

| Move | Cost | Pays off if extension never ships? | Verdict |
|---|---|---|---|
| 1 — Extract pure services to `core/` | 1 day | **Yes — large.** Cleaner main.ts, services testable without Electron, kills 17-file `electron/` directory smell. | **No-regrets.** Do regardless. |
| 2 — Split surface-coupled trio (PTY, Files, UpdateChecker) via `EventSink` | 0.5 day | **Yes — moderate.** Same testability win. The `EventSink` adapter is a 5-line cost vs. ongoing benefit of testable services. | **No-regrets.** Do regardless. |
| 3 — Split `shared/types.ts` into `protocol/` + `domain/` | 0.5 day | **Yes — small but real.** 1338-line files are smell. Helps every future contributor read the codebase. | **No-regrets.** Do regardless. |
| 4 — Formalize renderer `HostApi` interface | 0.5 day | **Yes — small.** Catches preload/renderer drift at compile time. Today's drift would surface as runtime errors only. Modest unit-test enabling. | **Advantageous.** Do regardless. |
| 5 — Transport-agnostic CLI | 0.5 day | **Marginal.** Today's Unix/TCP fallback already does the job inline. The abstraction only pays off if a third transport appears (extension). | **Conditional.** Defer until the extension MVP walks. |
| 6 — Build pipeline for two targets | 1 day | **No.** Pure cost — second build, second test matrix, second release ritual. Actively wasteful if we don't ship the extension. | **Conditional.** Only do if extension MVP passes Phase 0. |
| 7 — Plumbing-checklist evolution | per-verb tax | **No.** Pure ongoing cost. Every new verb costs more to ship. | **Conditional.** Only do if dual-target ships. |

### The shape of this filter

Moves 1–4 are **architecture hygiene that pays off today** and
*also* happens to enable the extension cheaply. Roughly **2.5 days of
work** to land them, with no behavioral change to the existing app.
Risk surface: import statements and a small number of type-shape
adjustments.

Moves 5–7 are **dual-target tax** — only worth paying if we
actually commit to a second target.

The interesting consequence: **doing moves 1–4 first turns the
extension MVP from "build a parallel-stack from scratch" into
"compose existing services through a different transport."** The
helper goes from "re-implements PtyManager, FilesService,
SocketServer, the protocol surface, and the command dispatcher"
to "imports each of those from `core/` and wires up Native
Messaging." That's probably **half** the current MVP plan's effort,
and most of the de-risking comes for free.

Pre-MVP, moves 1–4 also retire a long-standing question that's been
lurking in the codebase: *"why does this Node service live in
`electron/`?"* The honest answer has always been "it doesn't, we
just put it there." Now we can stop carrying that.

---

## Sequencing recommendation

Two distinct paths, depending on what gets prioritized first.

### Path A — refactor first, walk second (recommended)

1. **Land moves 1–4 as a self-contained refactor.** ~2.5 days. Open
   a single PR, ship it as a dot release with an explicit "no
   functional change, internal restructure" call-out. Run the full
   smoke matrix per
   [`docs/dev/smoke-checklist.md`](../../dev/smoke-checklist.md).
2. **Then walk MVP Phase 0** (the half-day gate from
   [`./mvp-plan.md`](./mvp-plan.md)). The helper is now ~50 lines:
   `helper/main.ts` imports from `core/`, exposes Native Messaging
   stdio, done.
3. **Then walk Phases 1–8** if Phase 0 passes — significantly
   cheaper because services and protocol are already shared.
4. **Move 5 (transport-agnostic CLI)** lands as Phase 5 of the MVP,
   not as an isolated refactor.
5. **Moves 6–7** land if and only if the extension is committed to
   ship.

### Path B — walk first, refactor second

1. Walk MVP Phase 0 immediately (no refactor).
2. If Phase 0 passes, *then* do moves 1–4 to deduplicate code
   between the helper (which Phase 0 implemented) and the Electron
   app.
3. Continue with MVP Phases 1–8 against the cleaned-up tree.

Path B is what you'd do if you wanted the **fastest possible signal
on whether the extension shape works at all**. The cost is a small
amount of throw-away work in Phase 0's hello-world helper, and a
slightly messier mid-build refactor.

### Why we recommend Path A

The moves 1–4 work is so independently valuable, and so cheap, that
not doing it requires a positive justification. The only argument
for Path B is "we're not sure the extension is worth doing at all,
so don't pre-pay for it" — but moves 1–4 aren't pre-paying for
the extension. They're paying for cleaner Electron-app code. The
extension just rides on the side effect.

---

## Risk to existing behavior

Each move can be done with zero behavioral change if executed
carefully. Specifically:

- **Move 1** (file relocations + import updates): caught by typecheck.
  No runtime risk if typecheck passes. **Verifiable mechanically.**
- **Move 2** (`EventSink` adapter): the Electron adapter is a
  one-liner; renderer behavior identical. **Verifiable by smoke
  matrix.**
- **Move 3** (split `shared/types.ts`): re-exports preserve every
  existing import path during the migration window. **Verifiable by
  typecheck.**
- **Move 4** (formalize `HostApi` interface): pure type-system
  work; no runtime change. **Verifiable by typecheck.**

The smoke matrix is the source of truth for behavioral regression
post-refactor. Run
[`docs/dev/smoke-checklist.md`](../../dev/smoke-checklist.md) before
calling moves 1–4 done.

---

## Effort summary

| | Best case | Realistic | Worst case |
|---|---|---|---|
| Moves 1–4 (no-regrets refactor) | 2 days | 2.5 days | 4 days |
| MVP Phase 0 (post-refactor) | 0.5 day | 0.5 day | 1 day |
| MVP Phases 1–8 (post-refactor) | 5 days | 7 days | 10 days |
| Moves 5–7 (conditional, only if shipping extension) | 1.5 days | 2 days | 3 days |

If we walk the full path (refactor + extension MVP):
**~10–14 working days** end-to-end, **gated at Phase 0** half a day
in. If Phase 0 fails after the refactor, we're left with a
materially cleaner Electron codebase — no regret.

---

## Recommendation

**Do moves 1–4 now, regardless of any decision on the extension.**

The 2.5 days of refactor work pays off three times:

1. Today's `electron/` directory stops misleading anyone who reads
   it about what's actually Electron-specific.
2. Pure services become unit-testable without spinning up Electron.
   Several have outstanding QA gaps that this unblocks.
3. *If* the extension MVP gets walked, Phase 0 onwards is materially
   cheaper because the helper imports from `core/` instead of
   re-implementing.

The only argument against is "we have higher-priority work in the
queue" — which is a scheduling question, not a correctness question.

**Defer moves 5–7 until and unless the extension MVP passes Phase 0
and we're committed to shipping it.** Each of those is dual-target
tax, not codebase hygiene.

---

## What this analysis does NOT cover

- **Whether to walk the MVP at all.** That's the question
  [`./README.md`](./README.md) addresses; this doc takes "we might
  walk it" as given.
- **An ADR for the dual-target commitment.** If the extension ships,
  [`docs/DECISIONS.md`](../../DECISIONS.md) needs an ADR documenting
  the sibling-distribution choice and the maintenance commitment.
- **Roadmap stage card.** Promotion of moves 1–4 into a stage on
  [`docs/roadmap.html`](../../roadmap.html) is a separate
  conversation. They're small enough to land as a single dot
  release; large enough to warrant a card if we want them tracked.
- **Test coverage for the new `core/`.** Pulling services out of
  Electron makes them testable; *writing* the tests is a separate
  decision and a separate cost.
