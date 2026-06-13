# ENH-212 PRD — Home (default re-entry screen)

> **Status:** spec locked 2026-06-12. Ready to build.
> **Owner decisions:** locked via three UI studies + AUQ rounds (this doc § 3).
> **References:**
> - [docs/research/home-screen-study.html](../research/home-screen-study.html) — round 1 (12 layout visions; judged too safe)
> - [docs/research/home-screen-study-v2.html](../research/home-screen-study-v2.html) — round 2 (12 daring visions; #13 won)
> - [docs/research/home-screen-study-13.html](../research/home-screen-study-13.html) — round 3 (six Two-Up variations; levers locked)
> - Plan provenance: ultracode workflow `wf_27e8ee52-257` (6 surveys, 3 competing
>   architectures, judge, 3 adversarial verifiers). Verifier fixes are folded in
>   and marked **[V]** below.

---

## 1. What we're building

**Home** is a permanent, non-closable surface — slot 0 in every window — whose
job is *re-entry into inactive Claude projects*. The user has hundreds of
sessions across dozens of project roots; the active-project rail serves the
ACTIVE ones. Home answers "where was I?" for everything else:

- A serif **greeting line** (styled text, no box): "Welcome back, Geoff — 2
  sessions open; freshest is the terminal-collapse fix, 12 minutes ago."
- **Two equal hero panels** — the 2 most recently active projects. Each shows:
  project name + hue, last-active age, session count, an italic last-line
  transcript snippet, the 3 most-recent sessions (title · green `open` pill if
  a live terminal hosts it · age), recent-file chips, and an "all N sessions"
  expander (paged, lazy titles).
- A **spine stack** below — one compact row per remaining project (3px color
  spine, name, session count, latest-session label, age), folding after ~8
  rows behind an "N older projects" expander.
- **Click an open session** → focus its existing terminal tab, raising its
  window if needed. Never duplicates.
- **Click a closed session** → new terminal tab in the *current* window
  running `claude --resume <uuid>` in the project root.
- **Responsive**: heroes side-by-side when the pane is wide (≥ ~720px
  container width), stacked full-width when narrow — container queries, sized
  to the pane, not the window.

All data is read **live on every snapshot** — no cache, no sidecar (ENH-183
§ D9). Atelier styling throughout; hues from the existing `--project-*`
palette via `hashColorIndex`.

**Out of scope for v1:** frozen terminal frames in heroes (round-2 #18 idea —
revisit post-ship); sort controls; a `duo home close` verb (non-closable by
design); message counts on session rows **[V]** (tail-approximate for >4MB
files; expander may show approximate counts later).

---

## 2. Why now / problem

Average Duo user: 41 raw `~/.claude/projects/` dirs on the reference machine
(844MB of JSONL; single sessions up to 270MB), ~20+ distinct roots after
rollup, 6–12 of them "real." Sessions scatter; re-entering a cold project
means remembering a cwd and hunting a UUID. Duo already owns the data needed
to fix this (`claude-session-tracker`, presence probes, PTY cwds) — nothing
joins it into a re-entry surface.

---

## 3. Locked decisions

| # | Decision | Lock |
|---|---|---|
| D1 | Layout direction | Two-Up Spread (round-2 #13): two equal heroes + spine stack |
| D2 | Orientation | Responsive — side-by-side wide / stacked narrow (container queries) |
| D3 | Hero richness | Last-line snippet + recent-file chips. No terminal frame in v1 |
| D4 | Voice | Greeting as styled serif text (NOT a boxed banner) carrying briefing data: open count + freshest thread + age. Degrades: 0 open → "all quiet since <age>"; no name → "Welcome back —" |
| D5 | The rest | Spine stack; folds after ~8 with "N older projects" expander |
| D6 | Resume target | Closed session resumes in the **current** window (sender's window via `resolveBySender` — identity, never focus) |
| D7 | Placement | Permanent slot 0: synthesized PinnedNav row (above persisted pins, visible at zero pins) + `f:home` tab sorted leftmost, no close affordance |
| D8 | Project rollup | Worktrees fold into their main repo (`.git` file `gitdir:` pointer); nested cwds fold into shallowest real root (path-prefix via `shared/projects.ts` `ancestors`/`deepestEnclosingRoot`); sessions carry a `subPath` badge |
| D9 | Data freshness | Live recompute per snapshot; zero persistence of Home state anywhere (no envelope entry, no pins.json entry, no sidecar) |
| D10 | Naming | **"Home"** — new `vocabulary.md` entry; tab title "Home"; verb `duo home` |
| D11 | Activation | Auto-activate only when a window has no restored `activeWorking`; otherwise background |
| D12 | Greeting name | `os.userInfo()` first name, omitted gracefully when unavailable |
| D13 | Open-session evidence | Evidence-gated joins ONLY: live PTY cwd (lsof) + persisted `lastClaudeSession` pointer. **The newest-jsonl-mtime-≤2min heuristic is banned** — it is the exact speculative inference the ENH-183 D9 post-walk-1 amendment prohibits **[V]** |
| D14 | iCloud-evicted JSONLs | Per-file read timeout → session renders snippet-less; no visible "evicted" affordance in v1 |
| D15 | `duo session open` outside Duo | No `DUO_WINDOW` stamp → primary window (identity resolution), consistent with every other verb |

### Deliberate deviations (named per house rule "drift must be deliberate") **[V]**

Renderer-surfaces checklist (.claude/rules/renderer-surfaces.md), per step:

1. `WorkingTabType` gains `'home'` — discriminated-union audit recorded in the
   implementation PR (DuoSelection, WorkingAuxSnapshot.activeKind, etc.).
2. `classifyFile` **not extended** — Home is not file-backed and never enters
   FileTree / ⌘N / `duo edit` paths.
5. `onCommitNewFile` / ⌘N seeding — **N/A** (no authoring path creates a Home).
8. `skill/examples/home-authoring.md` — **N/A** (not an authorable surface).

ENH-191 NFR-6.2 (blank new windows): Home **is** synthesized in blank ⌥⌘N
windows — a deliberate exception; nothing is cloned, Home is identical
everywhere.

CLI parity asymmetries: no `duo home close` (non-closable); spine/expander
paging is UI-only (`duo session list --cwd` covers enumeration).

Editor/canvas parity (renderer-surfaces rule): **Skipped — surface-specific**;
Home is neither an editor nor a canvas document.

---

## 4. Architecture

### 4.1 Renderer surface — `kind: 'home'`

- `'home'` added to `WorkingTabType` (shared/types.ts:486). Sentinel
  `path: 'duo://home'`, **constant id `f:home`**. Plain in-document DOM (no
  iframe) — global shortcuts bubble naturally; container queries work
  directly (Chromium 128 ✅).
- Components: `renderer/components/Home/{HomeView,HeroPanel,SpineRow,SessionRow,GreetingLine}.tsx`
  + `homeModel.ts` (pure selectors/formatters, unit-testable) + `Home.css`.
- Never persisted: filtered from session persist (App.tsx:806); re-synthesized
  at App mount in every window; seeded BEFORE restore so a persisted
  `activeWorking` resolves — **keyed by path `'duo://home'`, not id** (persist
  writes `{kind:'file', path}`; restore mints fresh ids keyed off path) **[V]**.
- `closeFileTab` hard-refuses `f:home` (the single non-closable guard); ⌘W
  routes through it. WorkingTabStrip: TypeIcon glyph, no close glyph, sorts
  leftmost, and **menu gating must also exclude "Pin tab" and
  "Move to split" for `'home'`** — both would persist the sentinel into
  pins.json / the aux-split SessionState field and break restore **[V]**.
- BUG-046 hidden-mount tolerance: all fetch effects gate on `isActive`; fetch
  on mount, on isActive flip, 30s interval while active.
- Home mounts inside WorkingPane → canvas-collapse unmount (FOLLOWUP-044)
  loses only in-memory snapshot state. Acceptable.

### 4.2 Main-process data service — `electron/home-snapshot.ts`

Pure, stateless, recomputed per call. Reuses `shared/projects.ts`
(`hashColorIndex`, `ancestors`, `deepestEnclosingRoot`) — no reimplementation.

New primitives in `electron/claude-session-tracker.ts`:

- `listTopLevelSessions(projectDir)` — stat-only; excludes
  `<uuid>/subagents/**`.
- `readSessionTailMeta(file)` — tail read with **exponential growth
  64KB → 256KB → 1MB, cap 2MB** **[V]** (measured: single JSONL lines reach
  ~400KB; a fixed 64KB/256KB ladder can yield zero complete lines). Extracts
  snippet (last `type:'assistant' && !isSidechain` text block; `last-prompt`
  fallback), `gitBranch`, `sessionId`, ts.
- **`cwd` comes from a HEAD read** (first user entry carries `cwd`; head lines
  are small) — head-16KB read is also the title ladder, so rollup evidence
  rides the existing cheap read, never the fragile tail and never a lossy
  `encodeProjectDir` reversal **[V]**.
- Spine "latest-session label": head-16KB read for each spine project's newest
  session (≤40 × 16KB ≈ 640KB — negligible) so spines show real titles, not
  raw last-prompt text **[V]**.
- All reads p-limit ~8, seek-based (fd + position — **never `fs.readFile`**;
  a 270MB session must never be slurped), best-effort/never-throw, per-file
  timeout (D14).

Recent files: shallow mtime scan of project root, depth ≤2, skip
`.git`/`node_modules`/lockfiles, top 5.

### 4.3 Open-session detection + click contract

Per snapshot, main-side join (evidence-gated per D13):

- `probeAllTabs(rootPids[])` in `core/claude-presence.ts` — one async `ps -ax`
  parse, BFS per root PID (generalizes the front-tab-only probe).
- Per live PTY across all windows: join lsof cwd + persisted
  `lastClaudeSession.id` pointer → `open: {windowId, tabId}`. Tab ids resolved
  live, never persisted.
- **lsof must use the async `execFileAsync` variant (main.ts:3392), never the
  1s-timeout `execSync` at main.ts:3373**; skip tabs whose PTY ≠ live; one
  ps + lsof batch per snapshot, not per row **[V]**.
- **In-flight coalescing**: concurrent `HOME_SNAPSHOT` invokes (N windows ×
  30s pollers) share one computation. Transient promise, not a cache — D9
  clean **[V]**.
- **Live-but-idle guard**: when `probeAllTabs` sees an unattributed live
  claude whose cwd = project X, sessions of X without an open-pill get a
  confirm step before `--resume` (prevents forking a concurrently-running
  session that fails all join legs) **[V]**.

Click **focus**: main raises `registry.get(windowId).window.focus()` +
`ctx.safeSend(IPC.TERMINAL_ACTIVATE_TAB, {tabId})`; renderer handler reuses
the `terminal:focus` body. Openness re-checked before any spawn. Click
**resume**: existing `newTab({kind:'shell', cwd, cmd: 'claude --resume <uuid>'})`
machinery targeted at the sender's window; uuid regex-validated (cf.
main.ts:1537).

### 4.4 IPC contract (append-only)

- `HOME_SNAPSHOT` invoke `{limitPerProject?}` → `HomeSnapshot {generatedAt,
  greeting: {firstName?, openCount, freshest?: {title, ageMs}}, projects:
  HomeProject[]}`; `HomeProject {rootPath, displayName, colorIndex,
  lastActiveAt, sessionCount, snippet?, sessions: HomeSession[], recentFiles:
  {path, mtime}[]}`; `HomeSession {uuid, title, titleSource, modifiedAt,
  subPath?, open?: {windowId, tabId}}`.
- `HOME_LIST_SESSIONS` invoke `{root, offset, limit}` — paged expander.
- `HOME_SESSION_ACTION` invoke `{op:'focus', windowId, tabId} | {op:'resume',
  uuid, cwd}`.
- `HOME_SHOW` main→renderer push; `TERMINAL_ACTIVATE_TAB` main→renderer push
  (dedicated channel — not the BrowserManager playground path).
- Renderer exposes `window.__duoGetHomeState()` (duo-status pull pattern).
- **Append anchors** **[V]**: types const entries immediately before
  `} as const` (~line 2094); main.ts handler block at the END of `setupIPC`;
  preload/host-api entries at list ends — PR #91 inserts at the heads of the
  same blocks.

### 4.5 CLI surface (parity, rule 4)

| Verb | Behavior |
|---|---|
| `duo home` / `duo home show` | Focus/synthesize Home in the target window (`--window N` honored) |
| `duo home state [--json]` | Pull `__duoGetHomeState` — what the user sees |
| `duo home refresh` | Force a snapshot refetch |
| `duo session open <uuid> [--cwd <path>]` | Full click contract main-side: focus-if-open else spawn `claude --resume`; primary window when unstamped (D15) |
| `duo term tab <id>` | Ships `TERMINAL_ACTIVATE_TAB` generally — closes the documented CLI-COVERAGE P0 gap. **Takes the `<id>` from `duo term tabs` (ship the enumeration alongside), NOT a bare index — `duo tab <n>` owns the browser number space** **[V]** |

Sync surfaces per verb (5, not 4 — post-ENH-203) **[V]**: `cli/duo.ts`
(+ `npm run build:cli` + commit binary), **`skill/references/cli-reference.md`**
(the table `check:skill-currency` actually enforces), `skill/SKILL.md`,
`agents/duo.md`, `docs/CLI-COVERAGE.md` (+ `what-duo-does.html` entry).

### 4.6 Merged-future posture **[V]**

Base: `origin/main` @ `da2da9d` (local main is stale). Verified conflict-free:
`core/claude-presence.ts`, `electron/claude-session-tracker.ts`,
`core/session-state-service.ts` (untouched by every in-flight branch).

- **PR #91** (thirsty-brahmagupta): also rebuilds the committed `cli/duo`
  binary — binaries never textually merge. Resolution is mechanical and
  mandatory: after any merge/rebase involving it, re-run `npm run build:cli`
  on the MERGED `cli/duo.ts` and commit; never take ours/theirs. Prefer
  sequencing ENH-212's CLI step after #91 lands. Doc tables
  (cli-reference.md, CLI-COVERAGE.md, what-duo-does.html) will have
  adjacent-row conflicts — rebase before the doc step.
- **PR #75** (amazing-goodall): inserts ENH-113 `onCloseTab` at the top of
  `renderFileTab` — place the `'home'` branch AFTER the existing editor/page
  branches, and post-merge verify #75's strip Close button is inert for
  `f:home`. #75 also deletes `renderer/hooks/useTerminal.ts` — do not import
  it (already a plan rule).
- **PR #93** (ENH-210 you-are-here pill): sentinel path → `activeSurfaceProject`
  null while Home focused (acceptable; add a regression assertion so it stays
  deliberate, and exclude Home from `duo project list --counts` workingTabs).
- No new global keybinding in v1 (⇧⌘N / ⌘⇧F / ⌘⇧C claimed in-flight).

---

## 5. Implementation plan (commit-sized)

1. **Data primitives** — `claude-session-tracker.ts`: `listTopLevelSessions`,
   `readSessionTailMeta` (exponential tail), head-16KB cwd+title read; fixtures
   + unit tests (>4MB file, ~400KB single line, subagent exclusion, corrupt
   lines never throw, **bytes-read bounded on a multi-hundred-MB fixture** [V]).
2. **Snapshot service** — `electron/home-snapshot.ts`: enumeration,
   `rollupProjects` (head-cwd evidence, gitdir worktree fold, prefix fold),
   hues, subPath, recent-files scan, GreetingData, p-limit + timeouts; tests
   incl. worktree fixture + perf bound (<100ms on the 85-session corpus).
3. **Open-session join** — `probeAllTabs` (async ps), lsof-async + pointer
   join, coalescing; tests: pointer hit, stale pointer → closed, unattributed
   live claude → confirm-gated resume. No mtime heuristic (D13).
4. **Contract** — types/preload/host-api/main handlers at the pinned append
   anchors; `check:routing` green.
5. **Renderer surface** — `Home/` components + `homeModel.ts` + container-query
   CSS; WorkingPane branch (after editor/page branches); WorkingTabStrip icon +
   no-close + menu gating incl. Pin/Move-to-split exclusion + leftmost sort.
6. **App.tsx wiring** — synthesize-before-restore (path-keyed resolution),
   close refusal, persist filter, `TERMINAL_ACTIVATE_TAB` + `HOME_SHOW`
   subscriptions, `__duoGetHomeState`, D11 activation. Regression: round-trip
   yields exactly one Home tab.
7. **PinnedNav slot 0** — synthesized non-removable row above persisted pins;
   render-only.
8. **CLI** — `home` verb + `session open` + `term tabs`/`term tab <id>`;
   socket-server cases + NavBridge; rebuild + commit binary (sequenced after
   PR #91 if practical).
9. **Docs sync** — the 5 CLI surfaces + what-duo-does.html;
   `npm run sync:claude`; `check:skill-currency` green.
10. **PRD/vocab/tracker** — vocabulary.md "Home" entry; tasks.md flip;
    roadmap entry.
11. **Verify + ship** — restart dev, exercise focus/resume/cross-window via
    duo CLI + computer-use (spawn a live claude for the open-pill path),
    `/smoke-walk` with the § 6 manifest, then propose `cut-version`.

---

## 6. Test strategy + smoke manifest

**Unit (main, vitest):** tail-meta fixtures (snippet extraction, sidechain
skip, last-prompt fallback, exponential retry, giant-line, never-throw);
rollup table-driven (worktree fold, prefix fold, sibling separation, subPath,
hue stability); probeAllTabs canned ps; join legs (pointer beats absence,
stale → closed, unattributed-live → confirm). **Unit (renderer):** homeModel
greeting cases; hero/spine selection; spine fold-after-8. **Regression:**
persist/restore round-trip — one Home, path-keyed active resolution; Home
excluded from project counts (PR #93 interplay). **Integration:**
HOME_SNAPSHOT against a temp projects tree, perf + bytes-read bounds;
focus-action asserts explicit-window safeSend. **Static:** typecheck,
check:skill-currency, check:routing.

**Smoke-walk manifest:** (1) fresh boot → Home synthesized, greeting matches
reality; (2) blank ⌥⌘N window → Home present, no cloned pins; (3) PinnedNav
slot-0 at zero pins, click focuses; (4) ⌘W + strip close refused, no close
glyph, no Pin/Move-to-split menu entries; (5) green-pill session in window 2
clicked from window 1 → raise + correct tab, no duplicate (live claude
spawned for the test); (6) closed session → resume in current window at
project cwd; (7) narrow split stacks heroes / wide restores two-up;
(8) expander pages lazily; (9) worktree session under outer repo hero with
subPath badge; (10) `duo home` / `duo home state --json` / `duo session open`
/ `duo term tab` round-trips incl. `--window 2`; (11) restart with Home
active → restores active, exactly one Home; (12) ⌘K/⌃Tab work while Home
focused; (13) D9 audit — no new files under `~/.claude/duo`; (14) spine fold
at >8 roots expands correctly.

---

## 7. Open items (post-v1)

- Frozen-terminal hero frames (round-2 #18) — revisit after v1 feedback.
- Expander message counts (approximate for >4MB) — decide display later.
- Settings override for greeting name.
- `intro-to-duo` first-launch auto-open vs Home activation ordering — confirm
  during step 6 (first-launch flow wins on the very first boot).
