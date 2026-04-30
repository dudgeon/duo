# Build roadmap — Duo Chrome extension

**Status:** Roadmap, 2026-04-29. The unified plan composing the
research project's three reference docs into a single
do-this-then-this sequence: refactor, build, test, evolve.

> **Relationship to the main Duo roadmap** ([`/ROADMAP.md`](../../../ROADMAP.md) /
> [`docs/roadmap.html`](../../roadmap.html)) — read first, then the
> rest of this document.
>
> The main roadmap is the **Electron app shipping path** (Stages
> 1–21, ongoing). This file is the **Chrome-extension exploration
> roadmap** (Stages A–H). They do **not** gate each other.
>
> | Where it lives | What it is | Touches main app? | Merges back to `main`? |
> |---|---|---|---|
> | **Stage A — refactor** (`core/`, `electron/`, `shared/host-api.ts`, `tsconfig.node.json`, `scripts/postinstall.ts`) | Pure-Node service extraction + EventSink + host-api split. Identified as **no-regrets** in [`refactor-analysis.md`](./refactor-analysis.md). | Yes — same files the Electron app builds from. `npm run typecheck` + `npm run build` are clean; smoke-matrix walk pending. | **Yes** — these are merge candidates back to `main` once smoke-walked. They benefit the Electron app whether or not the extension ever ships. |
> | **Stage B/C work** (`phase0/` directory, helper script) | Extension prototype, Native Messaging helper, side panel scaffolding, real PTY, real filetree, etc. | No — `phase0/` isn't in the Electron build pipeline. | **No** — exploration-only, lives on the `duo-chrome-extension-exploration` branch. If the extension ships, a future migration moves these out of `phase0/` and into proper top-level `extension/` + `helper/` directories with build pipeline. |
> | **Research artifacts** (`docs/research/duo-as-chrome-extension/`) | This planning bundle. | No. | Yes — docs are safe to land on `main` whenever; they don't affect any build. |
>
> **Practical guidance:**
>
> - Working on a main-roadmap stage? You can ignore this file
>   entirely. Stage A's refactor *did* move services from `electron/`
>   to `core/` — if you need a service, look in `core/` first. (See
>   `refactor-analysis.md` for the move map.)
> - Picking up extension work? Read this file end-to-end, then the
>   referenced PRDs.
> - Wondering if extension work is blocking a main release? **No.**
>   The exploration branch is non-gating. Main releases proceed
>   independently.

This is **the** extension build plan. The other docs in this
directory are reference:

- [`README.md`](./README.md) — feasibility rationale and
  surface-by-surface architectural analysis.
- [`mvp-plan.md`](./mvp-plan.md) — phase-by-phase MVP build detail
  with D-numbered decisions and pass criteria.
- [`refactor-analysis.md`](./refactor-analysis.md) — full
  dual-target refactor analysis and the no-regrets filter that
  identifies moves 1–4.

This roadmap pulls those threads into one execution sequence and
extends past the MVP into stabilization, cross-platform, feature
parity, distribution, and the long-term strategic decision.

---

## The full sequence at a glance

```
   ┌──────────────────────────────── pre-extension ───────────────────────────────┐
   │                                                                              │
   │   Stage A          Stage B (gate)                                            │
   │   Refactor         Phase 0:                                                  │
   │   (moves 1–4)      keep-alive proof                                          │
   │   ~2.5 days        ~0.5 day                                                  │
   │                                                                              │
   └──────────────────────┬──────────────────┬────────────────────────────────────┘
                          │                  │
                       PASS               FAIL → close research with addendum;
                          │                       no-regrets refactor still landed
                          ↓
   ┌────────────────────────────── extension build & test ─────────────────────────┐
   │                                                                                │
   │   Stage C                  Stage D                Stage E                      │
   │   MVP build (Phases 1–8)   Stabilization          Cross-platform helper        │
   │   ~7–10 days               ~5–7 days              ~5–7 days                    │
   │                                                                                │
   └──────────────────────────────────────┬─────────────────────────────────────────┘
                                          │
                                       READY for early users
                                          ↓
   ┌──────────────────────── feature parity & distribution ────────────────────────┐
   │                                                                                │
   │   Stage F                  Stage G                                              │
   │   Feature parity           Distribution                                         │
   │   ~10–15 days              ~3–5 days                                            │
   │                                                                                │
   └──────────────────────────────────────┬─────────────────────────────────────────┘
                                          │
                                  shippable, comparable to Electron
                                          ↓
   ┌──────────────────────────────── long-term ───────────────────────────────────┐
   │                                                                              │
   │   Stage H — strategic decision (sibling forever / supersede / companion)    │
   │   ongoing                                                                     │
   │                                                                              │
   └──────────────────────────────────────────────────────────────────────────────┘
```

**Total to shippable-comparable-to-Electron:** ~8–10 weeks of focused
work. **Total to "decided on dual-target future":** ~3–4 months.

**The single most important property of this plan:** Stage A is
no-regrets. Even if Stage B's gate fails and we never ship the
extension, Stage A leaves the codebase materially cleaner. This is
the only stage you should do without conditional commitment.

---

## Gates and go/no-go points

Only proceed past each gate on a green light.

| Gate | When | What it tests | Failure mode |
|---|---|---|---|
| **G1** | End of Stage A | Smoke matrix passes; no Electron-app regressions | Roll back the refactor, investigate. |
| **G2** | End of Stage B Phase 0 | SW + helper survive 30 min idle | Close research; add closing addendum to README. |
| **G3** | End of Stage C MVP demo | Phase 8 demo runs end-to-end | Identify load-bearing failures; decide stay-here vs. continue. |
| **G4** | End of Stage D | Trailblazer pilot can run for a week without owner intervention | Polish loop; don't expand scope until stable. |
| **G5** | End of Stage F | Feature parity sufficient for the user audience we picked | Take a breath before public distribution. |

**G2 is the load-bearing gate.** If Phase 0 fails, ~80% of the plan
collapses. If G2 passes, the rest is execution risk only — the
architecture is proven.

---

## Stage A — No-regrets refactor (moves 1–4)

**Detail level:** Full. Drives the decision to start.

**Outcome:** `core/` exists as a top-level package; the
truly-Electron-coupled surface in `electron/` is reduced from 17
files to ~6; the renderer's host contract is a first-class
interface; `shared/types.ts` is split into protocol + domain.

**Effort:** ~2.5 days. Detail in
[`./refactor-analysis.md`](./refactor-analysis.md) under "The
seven moves a committed dual-target codebase needs."

### A1 — Extract pure services to `core/` (~1 day)

Move the 9 ✓-marked files to `core/`, update imports in
[`electron/main.ts`](../../../electron/main.ts) and any cross-imports
inside the moved files:

```
core/
├── browser-history/BrowserHistoryService.ts
├── claude/{ClaudePresence.ts, resolveClaude.ts}
├── constants.ts
├── nav-pins/NavPinsService.ts
├── pins/PinsService.ts
├── session-state/SessionStateService.ts
├── skills/SkillsScanner.ts
└── socket-server/{SocketServer.ts, commands.ts}
```

**Validation:** `npm run typecheck` clean; `npm run dev` launches
without behavioral change; smoke matrix passes.

### A2 — `EventSink` adapter for the surface-coupled trio (~0.5 day)

[`electron/pty-manager.ts`](../../../electron/pty-manager.ts),
[`electron/files-service.ts`](../../../electron/files-service.ts),
and `electron/update-checker.ts` use `WebContents.send()` to push
events. Replace with `EventSink`:

```ts
// core/transport/EventSink.ts
export interface EventSink {
  send(channel: string, payload: unknown): void;
}
```

Move the now-pure cores to `core/pty/PtyManager.ts`,
`core/files/FilesService.ts`, `core/update/UpdateChecker.ts`.
Keep a thin `electron/adapters/WebContentsEventSink.ts` (5 lines)
as the Electron-side adapter.

**Validation:** Same as A1.

### A3 — Split `shared/types.ts` (~0.5 day)

Today's [`shared/types.ts`](../../../shared/types.ts) (1338 lines)
splits into:

```
shared/
├── protocol/{ipc.ts, commands.ts, events.ts}
├── domain/{files.ts, canvas.ts, editor.ts, browser.ts}
└── (existing) html-boilerplate.ts, ulid.ts, fork-config.d.ts
```

Use `shared/types.ts` as a re-export shim during the migration so
no existing import path breaks. Migrate imports gradually as files
are touched.

**Validation:** Typecheck clean throughout.

### A4 — Formalize the renderer's `HostApi` interface (~0.5 day)

Promote `window.electron`'s implicit shape to a first-class
interface in `shared/host/HostApi.ts`. Make
[`electron/preload.ts`](../../../electron/preload.ts) implement it
explicitly. Renderer's global declaration becomes
`declare global { interface Window { duoHost: HostApi } }` (or keep
`window.electron` for now — pure cosmetics).

**Validation:** Typecheck clean. The interface catches any
preload/renderer drift that exists today.

### Stage A exit criteria (Gate G1)

- Smoke matrix passes per
  [`docs/dev/smoke-checklist.md`](../../dev/smoke-checklist.md).
- Three CLI verbs spot-checked end-to-end (`duo edit`, `duo nav`,
  `duo theme`).
- Zero behavior regressions reported in a 24-hour use window.

**If G1 fails:** Investigate the regression. Do not proceed to Stage
B until the refactor is clean. The extension build is gated on a
working pre-state.

---

## Stage B — Phase 0 keep-alive proof (the load-bearing gate)

**Detail level:** Full. This gate decides everything downstream.

**Outcome:** Empirical answer to the
[claude-code#16350](https://github.com/anthropics/claude-code/issues/16350)
problem — does an extension service worker + Native Messaging
helper pair survive 30 minutes of real user idle?

**Effort:** ~0.5 day. Detail in
[`./mvp-plan.md`](./mvp-plan.md#phase-0--native-messaging-keep-alive-proof--½-day).

### Build

- Skeletal MV3 manifest, `nativeMessaging` permission only.
- SW connects to a 50-line hello-world helper via
  `chrome.runtime.connectNative`.
- 25-second `chrome.alarms` keep-alive.
- Test page sends a ping every interaction; helper logs an
  "alive" line every 30s.

### Pass criteria (Gate G2)

- 30 minutes of zero user interaction → SW responds to a ping in
  <100ms on first call.
- `pgrep -c duo-helper` → exactly 1 throughout the test.
- No port-closed events in SW console.
- *Repeated test* with 60-min idle.

### Failure handling

If keep-alive cannot keep the helper alive:

1. Try 15s, 10s alarm cadences before giving up.
2. Close out the research with a one-paragraph addendum to
   [`./README.md`](./README.md).
3. Stage A's refactor still landed — no regret.
4. Reconsider the embedded-browser path or duo-in-browser's intranet
   variant as alternative R&D directions.

---

## Stage C — Extension MVP build (Phases 1–8)

**Detail level:** Phase-level here; per-phase detail in
[`./mvp-plan.md`](./mvp-plan.md).

**Outcome:** A walkable extension MVP that satisfies the demo
script — terminal in side panel, navigator drawer, markdown canvas
in a Chrome tab, agent-driven Gmail screenshot, AX tree via
`chrome.debugger`.

**Effort:** ~7–10 days.

### Phase summary (full detail in `mvp-plan.md`)

| Phase | Deliverable | Days | Status |
|---|---|---|---|
| 1 | Side panel UI scaffolding + nav drawer (mock data) | 1.0 | ✅ |
| 2 | Real PTY through Native Messaging — leverages `core/pty/PtyManager` from Stage A | 1.0 | ✅ |
| 3 | Real filetree + open canvas-as-tab — leverages `core/files/FilesService` | 1.0 | ✅ |
| 4a | File r/w through helper (`files:read` / `files:write`); plain textarea editor in canvas tab — validates the r/w path before adding the React toolchain | 0.3 | ✅ |
| 4b | esbuild bundle + React + TipTap markdown editor in canvas tab — validates the React toolchain question without a Vite reorg | 0.5 | ✅ |
| 5 | Tab-driving via lighter `chrome.tabs`/`chrome.scripting` APIs | 0.3 | ✅ |
| 6 | `chrome.debugger` for CDP-only operations — `agent:cdp:eval` attach/eval/detach gate | 0.2 | ✅ |
| 6.5 | CLI bridge — helper-side Unix socket + TCP fallback (sandbox-tolerant); `duo-ext` binary | 0.5 | ✅ |
| 7 | Distribution refactor — Electron-app-as-NM-host + Web Store unlisted (see `distribution-strategy.md`) | 2.0 | ⬜ |
| 8 | Public Web Store promotion + background-mode menu bar (see `distribution-strategy.md`) | 1.0 | ⬜ |
| **Total** | | **7.0** | |

**Status legend:** ✅ shipped + verified · 🟡 shipped, awaiting Geoff
verification (test in real Chrome before flipping to ✅) · ⬜ not yet
started.

**Distribution strategy** for Phase 7/8 lives in
[`distribution-strategy.md`](./distribution-strategy.md). TL;DR:
both shapes ship indefinitely; the Electron app is the foundation
and serves as the Native Messaging host (`Duo.app --nm-shim`); no
separate helper PKG; explicit `chrome:` / `embedded:` verb prefixes
disambiguate the two browser surfaces.

**Phase 4 split rationale.** The original Phase-4 deliverable
("MarkdownEditor in canvas tab + file r/w through helper") bundles two
unknowns: (a) does file r/w work end-to-end through Native Messaging,
and (b) does Vite + React + TipTap build cleanly inside the extension
shape? Splitting into 4a (textarea + r/w) and 4b (build toolchain +
MarkdownEditor) lets each unknown land independently — each half is
small enough to validate in one session. Phase 4a also keeps `phase0/`
"no build step, vanilla JS" until 4b explicitly opts in.

Add 30% buffer for MV3 papercuts: **~9 working days.**

### Stage A's downstream effect on Stage C

Because Stage A landed, Phases 2 and 3 are materially cheaper:

- Phase 2's helper imports `PtyManager` from `core/pty/`. The
  helper is the second `EventSink` consumer (the Electron app is
  the first); the PTY logic itself doesn't need re-implementing.
- Phase 3 same shape with `FilesService`.
- The CLI's transport-agnostic refactor (Move 5) lands as part of
  Phase 5 instead of separately.

### Stage C exit criteria (Gate G3)

The Phase 8 demo runs end-to-end without papercuts:

1. Click extension icon → side panel opens.
2. ⌘+B toggles drawer, navigate, dismiss.
3. Run `claude` in terminal.
4. Agent runs `duo edit README.md` → new tab opens with markdown.
5. Agent runs `duo nav https://gmail.com` → Gmail loads.
6. Agent runs `duo screenshot` → returns rendered image.
7. Agent runs `duo ax` → yellow banner, AX tree returns, banner
   clears.

**If G3 fails:** Identify load-bearing failures. Decide stay-here
(fix in Stage C) vs. continue (defer to Stage D).

---

## Stage D — Stabilization

**Detail level:** Medium. Production-ready foundation before
expanding scope.

**Outcome:** A Trailblazer pilot can run for a week without the
owner needing to debug helper-died papercuts or restart the
extension.

**Effort:** ~5–7 days.

### Sub-stages

#### D1 — SW resilience (~1.5 days)

Keep-alive cadence proven; now harden the failure modes:

- **Reconnect logic** in the SW: if the Native Messaging port
  disconnects, retry with backoff. If the helper has died, surface
  a side-panel banner instead of failing silently.
- **State recovery on SW resume:** the SW's in-memory `Map<requestId,
  port>` evaporates on idle; track the in-flight request set in
  `chrome.storage.session` so resumed SW can complete or fail
  cleanly.
- **Sentinel pings** every 25s from the SW to the helper *and* every
  25s from each side panel / canvas tab to the SW — both directions
  matter.

#### D2 — Helper auto-update (~1.5 days)

The Web Store auto-updates the extension. The helper PKG doesn't.
Two options:

- (a) Helper checks GitHub releases on startup; surfaces an
  "update available" event the side panel renders. User clicks →
  re-downloads PKG, runs installer, restarts Chrome.
- (b) The extension's SW monitors a manifest version number;
  surfaces the prompt the same way.

Pick (b); it composes with the version-mismatch warning the CLI
already has logic for (see
[`cli/duo.ts`](../../../cli/duo.ts) version-check banner).

#### D3 — Protocol versioning (~1 day)

Add a `protocolVersion` field to every Native Messaging message and
every SW-port message. Reject mismatched versions with a clean error
("Helper v0.6.0 incompatible with extension v0.5.4 — please update
the helper").

This is the protocol shape that lets us evolve the extension and
helper independently going forward.

#### D4 — Smoke checklist for the extension target (~1 day)

[`docs/dev/smoke-checklist.md`](../../dev/smoke-checklist.md) is
shaped for the Electron app. Add an extension counterpart:
`docs/dev/smoke-checklist-extension.md`. Same kind of structure —
walk through every CLI verb, every UI gesture, every keystroke.

#### D5 — Regression test coverage for `core/` (~1.5 days)

Stage A made `core/` services unit-testable without spinning up
Electron. *Write* the unit tests now:

- `core/pty/PtyManager.test.ts` — spawn shell, write, read, kill.
- `core/files/FilesService.test.ts` — list, read, write, watch.
- `core/socket-server/SocketServer.test.ts` — protocol round-trip.
- `core/skills/SkillsScanner.test.ts` — fixture-based scan output.

Run on CI for both targets. This is how we catch regressions
faster than smoke-matrix walks.

### Stage D exit criteria (Gate G4)

- Pilot user (Trailblazer) runs the extension for 7 days without
  the project owner intervening.
- No "helper died, restart Chrome" reports.
- All `core/` unit tests pass on CI.

---

## Stage E — Cross-platform helper

**Detail level:** Medium.

**Outcome:** The extension+helper pair installs cleanly on macOS,
Linux, and Windows. The Native Messaging manifest paths differ per
platform but the helper itself is one source.

**Effort:** ~5–7 days.

### Sub-stages

#### E1 — Helper build matrix (~1 day)

Extend the helper's esbuild bundle target list. Same source, three
binaries (`duo-helper-darwin`, `duo-helper-linux`,
`duo-helper-win32.exe`).

#### E2 — Per-platform installers (~3 days)

| Platform | Installer | Manifest target |
|---|---|---|
| macOS | Signed + notarized PKG | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` |
| Linux | `.deb` and `.rpm` | `~/.config/google-chrome/NativeMessagingHosts/` (and Chromium variants) |
| Windows | MSI | Registry key `HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\<name>` |

Each installer drops the binary, writes the manifest, and (on macOS)
notarizes for Gatekeeper.

#### E3 — Per-browser variants (~1 day)

Edge, Brave, and other Chromium-based browsers have their own
Native Messaging manifest paths. The Linux installer should
populate all of them; macOS and Windows similarly.

Firefox uses a different extension API (WebExtensions) and doesn't
ship `chrome.sidePanel`. Out of scope for this stage.

#### E4 — Per-platform smoke tests (~1 day)

Run the extension's smoke checklist on each platform. Catch
path-resolution and shell-spawning quirks early.

### Stage E exit criteria

- Friend on Linux installs and runs the demo script.
- Friend on Windows installs and runs the demo script.
- Same friction profile as macOS (<5 min install).

---

## Stage F — Feature parity expansion

**Detail level:** Medium-light. Each sub-stage is its own
mini-project; the order is suggestive.

**Outcome:** The extension can do anything the Electron app can do
(modulo the genuinely-removed parts: embedded `WebContentsView`,
`webContents.debugger`-driven CDP).

**Effort:** ~10–15 days.

### Sub-stages, ordered by user-visible impact

#### F1 — HTML canvas (Stage 17 surface) (~3 days)

Today's [`renderer/components/HtmlCanvas/`](../../../renderer/components/HtmlCanvas/)
hosts an iframe-sandboxed HTML editor. Same component, mounted in
a canvas-as-tab page (variant of `canvas/CanvasPage.tsx` from MVP).
The `duo html *` verbs route through the helper to the renderer
(now in a Chrome tab).

#### F2 — Multi-PTY tab strip (~2 days)

The MVP shipped with one PTY per side panel. Restore the tab strip
from the Electron app:
[`renderer/components/WorkingTabStrip.tsx`](../../../renderer/components/WorkingTabStrip.tsx)
+ multi-PTY routing in the helper. Each PTY is its own subprocess;
the SW routes data by sessionId.

#### F3 — Skills panel (~1.5 days)

[`renderer/components/SkillsPanel.tsx`](../../../renderer/components/SkillsPanel.tsx)
+ `core/skills/SkillsScanner` (already extracted in Stage A). Mount
in the side panel under a second nav-rail icon.

#### F4 — Selection sharing across surfaces (~2 days)

The Electron app's selection-pill machinery
([`renderer/components/Selection*`](../../../renderer/components/))
shares the user's text selection between canvas and terminal. In
the extension, this becomes a `BroadcastChannel` (D9 in the MVP
plan) carrying selection events between same-origin extension pages.

#### F5 — Theme synchronization (~0.5 day)

Side panel + canvas tabs subscribe to a single source-of-truth theme
via `chrome.storage.local` + `BroadcastChannel`. `duo theme` writes,
all surfaces re-render.

#### F6 — Browser history + autocomplete (~1 day)

The Stage 21c address bar history feature
([`electron/browser-history-service.ts`](../../../electron/browser-history-service.ts),
already moved to `core/` in Stage A) becomes part of the
`duo nav`-targeted tab driver: agents can suggest URLs from the
user's recent history.

#### F7 — Session restore across browser restart (~2 days)

Equivalent of the Electron app's Stage 21c session-restore: when the
user reopens Chrome, their open canvas tabs restore from the helper's
persisted state. (Chrome's tab restore is per-extension.)

#### F8 — Network capture (`Network.*` CDP) (~1.5 days)

The remaining `chrome.debugger`-only territory.
`duo network` attaches the debugger, records all network events for
N seconds, returns a HAR-like dump. Yellow banner appears for the
duration.

#### F9 — Drag-and-drop (~1 day)

Drag-from-filetree-to-canvas-tab and drag-from-tab-to-filetree.
Cross-tab drag is structurally awkward in browsers; might require
a "drop target" in each canvas tab listening for path strings.

### Stage F exit criteria (Gate G5)

The extension does ~95% of what the Electron app does. Decide what
to deliberately leave in the Electron-only column (e.g., the
embedded `WebContentsView` is permanently gone in the extension
shape).

---

## Stage G — Distribution

**Detail level:** Light.

**Outcome:** The extension ships to public users.

**Effort:** ~3–5 days.

### Sub-stages

#### G1 — Web Store listing (~1 day)

- Public listing copy (positioning, screenshots, demo video).
- Privacy policy and permission justifications.
- Support contact and bug-report URL.

#### G2 — Trailblazer pilot announcement (~0.5 day)

Stage 21d in the existing roadmap is the Trailblazer cohort. The
extension shape rides on that pilot but with a separate install
flow. Add a second README to the Trailblazer onboarding doc.

#### G3 — Helper PKG public release infrastructure (~1 day)

Sparkle-style helper auto-update for macOS. GitHub Releases hosting.
SHA-256 verification before installing.

#### G4 — Onboarding flow (~1.5 days)

First-launch banner in the side panel:

- Detect if `claude` CLI is installed; offer link to install.
- Detect if user has any tabs open the extension would want to
  drive; explain the lighter-API vs `chrome.debugger` distinction.
- Offer the `cut-version` skill or equivalent guided-setup flow.

#### G5 — Documentation overhaul (~1 day)

- Update [`docs/VISION.md`](../../VISION.md) to acknowledge the
  dual-target shape.
- Add an extension-specific `docs/EXTENSION.md` covering the
  install / troubleshoot flow.
- Update `docs/CLI-COVERAGE.md` to mark which verbs are
  extension-supported.

### Stage G exit criteria

- Public Web Store listing live.
- A non-Trailblazer user finds, installs, and uses the extension
  without owner intervention.

---

## Stage H — Long-term: the strategic decision

**Detail level:** Light. This is months out and depends on data we
don't have yet.

**Outcome:** A locked-in long-term decision about the relationship
between the Electron app and the Chrome extension.

**Effort:** Ongoing — not a single phase.

### Three possible futures

#### H-a: Dual-target indefinitely

Both ship. Different audiences (engineers who want the focused
desktop app vs. browser-native users). Maintenance cost is the
moves 6–7 dual-target tax from
[`./refactor-analysis.md`](./refactor-analysis.md). Roadmap
stages have to be evaluated against both targets.

#### H-b: Extension supersedes Electron

If usage data shows extension users dominating, deprecate the
Electron app over a 6-month sunset. The `core/` extraction makes
this clean — `electron/` shrinks to nothing, `core/` + `extension/`
+ `helper/` is the codebase.

#### H-c: Electron remains primary, extension is companion

If Electron users dominate, keep the extension as a lightweight
companion for users who specifically want browser-native shape.
Maintain a smaller extension feature set (the "core 60%") rather
than full parity.

### Decision inputs

- Usage telemetry (which target are people running?).
- User feedback on each shape's friction profile.
- Maintenance burden (which target gets more bug reports?).
- Strategic context (what the broader Anthropic / Claude Code
  ecosystem looks like at that point).

### Decision artifacts

- ADR in [`docs/DECISIONS.md`](../../DECISIONS.md) — the chosen
  future, the inputs that drove it, the deprecation timeline if
  applicable.
- Roadmap stages adjusted accordingly.
- Communication to existing users (if any deprecation is in play).

---

## Cumulative effort

| Stage | Days | Cumulative |
|---|---|---|
| A — Refactor (moves 1–4) | 2.5 | 2.5 |
| B — Phase 0 gate | 0.5 | 3.0 |
| C — MVP build (Phases 1–8) | 9.0 | 12.0 |
| D — Stabilization | 6.0 | 18.0 |
| E — Cross-platform helper | 6.0 | 24.0 |
| F — Feature parity | 12.0 | 36.0 |
| G — Distribution | 4.0 | 40.0 |
| H — Long-term decision | ongoing | — |

**40 working days** to a publicly shippable extension at near-parity
with the Electron app. **~3 working days** to either a no-go
decision (G2 fails) or a working MVP demo (G3 passes).

The asymmetry is deliberate: most of the cost is in stages D–F. The
risk-bearing investment — does the architecture work at all? — is
~3 days. We'll know in a week whether to commit the further 7.

---

## Risks throughout

Carried forward from the README and refactor-analysis docs, mapped
to the stage that catches each:

| Risk | Caught in |
|---|---|
| Stage A regression breaks Electron app | A exit (G1) |
| SW idle / native-host death | B (G2) |
| 360px terminal too cramped even with hover navigator | C Phase 1 |
| Native Messaging 1MB ceiling on large file reads | C Phase 4 |
| `chrome.debugger` yellow banner intolerable | C Phase 6 |
| Two-step install too friction-heavy | C Phase 7 |
| Pilot user runs into helper-died papercuts | D (G4) |
| Cross-platform path/manifest issues | E |
| Selection-sharing UX awkward across tabs | F4 |
| Enterprise extension policy blocks the permission set | G or before |
| Long-term maintenance burden becomes load-bearing | H |

---

## Decision points along the way

Each decision is small, but they compound:

- **Before A1:** Schedule the refactor PR. (Outside the technical
  plan; just calendar-level.)
- **End of A:** Do we land moves 1–4 as one PR or split into four?
  (Recommend: one — the smoke matrix runs once.)
- **End of B (G2):** Continue to C, or close research?
- **Mid C, end of Phase 1:** Is 360px terminal usable? If not,
  consider abandoning the side-panel-only shape and going
  popup-window-first.
- **End of C (G3):** Promote to a roadmap stage card on
  [`docs/roadmap.html`](../../roadmap.html), or keep as research?
- **End of D (G4):** Open the Trailblazer pilot, or polish more?
- **End of F (G5):** What's deliberately staying Electron-only?
- **Stage H:** The long-term strategic call.

---

## What this plan does NOT cover

- **ADR text for [`docs/DECISIONS.md`](../../DECISIONS.md).** If/when
  Stage C succeeds, write the ADR documenting the dual-target choice.
- **Roadmap card text for
  [`docs/roadmap.html`](../../roadmap.html).** Each stage in this
  plan that gets promoted needs its own card with status, scope,
  and per-stage decisions.
- **Detailed UX for stages D+.** The MVP plan is detailed; later
  stages are less so by design — we'll know more about the right
  UX once Stage C ships and users are using it.
- **Pricing / packaging.** If the extension ships under a different
  distribution model (e.g., free, paid tier, Trailblazer-only), that
  decision is a separate strategic conversation.
- **Internationalization, accessibility audit, security review.**
  These cross-cut every stage; surface them as their own pre-
  Stage-G checklists when distribution looms.

---

## Walk methodology notes

- **Don't skip Stage A even if Phase 0 fails.** The refactor stands
  on its own merit. Land it.
- **Don't skip Stage B's gate.** Phases 1–8 building on a sandy SW
  foundation is the failure mode the duo-in-browser exploration's
  Walk 4 narrowly avoided. Pay the half-day.
- **Re-read [`./README.md`](./README.md) at the start of each stage**
  — the architectural premises will look different from inside the
  build than from the planning seat.
- **The mvp-plan's D-numbered decisions are locked through Stage C.**
  Each one flips at most once; document the flip in this roadmap and
  re-up the affected sub-stage's pass criteria.
- **Don't optimize for parity in Stages D–E.** Stabilization and
  cross-platform are foundation work. Feature parity comes in F.
  Mixing those cycles makes both worse.
