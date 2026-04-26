# Duo — CLAUDE.md

> Context for Claude instances working on this project.
> Keep this file updated as stages complete.

---

## What this project is

A macOS desktop app ("Duo") that pairs multiple Claude Code terminal sessions
with an embedded Chrome browser, connected by a local CLI bridge (`duo`) so
Claude Code can read and drive the browser as naturally as it runs shell commands.

Owner: Geoff (Capital One, AI in Product program)  
Brief: `duo-brief.md` (read this first — it's comprehensive and locked)

---

## Current state (as of 2026-04-26)

**Foundation shipped. Flagship half #1 (cozy-mode terminal) shipped
2026-04-22, graduated 2026-04-25 (`(preview)` label dropped).
Flagship half #2 — sub-stage 11a of the markdown editor — shipped
2026-04-24; 11a tail (3 items) and 11b–e next.**

**Latest session (2026-04-26 late-evening) — Stages 5 v2 + 13 + 15.1
shipped & committed; Stage 15.2 (browser pill via CDP) shipped
code-side, live data-plane verified.** Stage 5 v2: new global
`agents/duo.md` (Haiku 4.5) subsuming `duo-browser`; new `duo
external <url>` CLI verb; bootstrap of
`~/.claude/duo/external-domains.json`. F1/F2/F4/F5/F8/F9 + C5/C6/C7
all PASS live; Class B perf inverted PRD hypothesis (FOLLOWUP-003).
Stage 15.1: `duo selection-format [a|b|c]` (G19) + `duo send` (G17)
CLI verbs + editor pill UI (`<SendToDuoPill>` primitive,
`formatSendPayload` helper, `useSelectionFormat` hook, full wiring
in MarkdownEditor → WorkingPane → App.tsx → `pty.write`). Stage
15.2: page-side selection observer IIFE injected via CDP
`Runtime.evaluate` on every attach + frame-nav, posts via
`Runtime.addBinding('duoSelectionPush')`; main caches latest
push and forwards to renderer over `IPC.BROWSER_SELECTION`;
`useBrowserSelection` hook drives the pill in `BrowserRenderer` with
page→screen rect translation. **Verified live:** binding installed,
observer injected (`__duoSelectionObserver: true`), `selectionchange`
on example.com fires payload through to the cache (`count=1`,
serialized payload includes both snapshot and page-relative rect).
Visual pill rendering still gated on FOLLOWUP-004 (computer-use
deferred). All three commits landed: `f250b65`, `a870d37`,
`1076298`.

**Previous session (2026-04-26 evening) — Stage 13 ship + Stage 5 v2
PRD locked + canonical flip:** see "Pick up here" breadcrumb below
for the full write-up. Major items: **Stage 13 shipped end-to-end**
(Phase 0 editor-agnostic refactor + Phase 13a just-added highlight
+ Phase 13b warn-before-overwrite banner; verified in live app);
**Stage 5 v2 (Duo subagent) PRD locked** at
[docs/prd/stage-5-v2-duo-subagent.md](docs/prd/stage-5-v2-duo-subagent.md)
and line-jumped before Stage 15 — full PRD with 26 decisions
covering identity, contract, session guard, web routing, install,
validation; **canonical flip** of the roadmap (`docs/roadmap.html`
is now canonical, `ROADMAP.md` is the synced markdown view); editor-
agnostic primitive contract locked in
[DECISIONS.md](docs/DECISIONS.md); BUG-003 v1→v2 history captured
(inset-shadow ring → chrome-strip tint).

**Earlier session (2026-04-26 late-day) — Stage 12 Phase 3 + bug
sweep:** Five items shipped: PROCESS-001 Phase 1 (keyboard matrix
in smoke-checklist § 5), BUG-002 (⌘T address-bar focus), BUG-003
v2 (pane focus indicator on chrome strip), BUG-004 (⌘` OS-focus
move), and Stage 12 Phase 3 (tab-strip rhyme + cozy-mode visual).

**Earlier session (2026-04-26) — P0 CLI gaps shipped:**
- `duo doc read [path]` — live editor buffer (frontmatter + body,
  including unsaved edits). Body to stdout, `# <path> (unsaved
  changes)` header to stderr so it pipes cleanly.
- `duo selection [--pane auto|editor|browser]` — extended to a unified
  `DuoSelection` shape. `auto` (default) prefers a non-empty browser
  highlight, falls back to the editor cache. Browser shape carries
  `{kind, url, text, surrounding, selector_path}`.
- `duo errors [--since] [--limit]` — separate ring (200 entries) fed
  by `Runtime.exceptionThrown`. Catches the uncaught exceptions that
  `duo console` silently misses.
- `duo network [--since] [--filter <regex>] [--limit]` — request
  lifecycle stitched from `Network.requestWillBeSent` →
  `responseReceived` → `loadingFinished`/`loadingFailed`. Ring size
  300; in-flight entries surfaced too. CDP `Network.enable` added to
  the attach sequence; `networkInFlight` is cleared on tab switch so
  prior-tab requests don't sit forever as pending.

**Same-day follow-ups (2026-04-26) — all stage refs use NEW numbers per the same-day renumber, see ROADMAP § Number history for old↔new map:**
- Old Stage 14 split into **Stage 18** (first-launch self-install
  — no cert needed) + **Stage 21** (cert-gated distribution polish)
  so the user-facing first-launch UX isn't blocked on cert
  procurement.
- Atelier visual-redesign bundle imported to
  [docs/design/atelier/](docs/design/atelier/); **Stage 12**
  (Atelier) created and pulled to the front as the L0 visual
  foundation that every L1+ stage inherits. Per-feature visuals
  fold into hosts: **Stage 9 follow-up** (cozy completion),
  **Stage 13** (just-added highlight — yellow + 6s fade overrides
  "blue fade" placeholder), **Stage 14** (Suggesting / Accepted
  track changes), **Stage 15** (Send → Duo pill).
- BUG-001 fixed (commit `3976039`) — pane-aware ⌃Tab cycling.
  Three-part fix: pane-aware routing in the keyboard hook, xterm
  `attachCustomKeyEventHandler` so the keystroke isn't eaten as
  PTY input, and a `paneOverride` for the browser-forwarded-key
  path because WebContentsView clicks don't bubble to the
  working-column wrapper. See `tasks.md` for the full trace.
- **Layered build-order renumber** — stage numbers now reflect
  actual build order, not chronology of planning. See
  [ROADMAP.md § Number history](ROADMAP.md). Commit messages from
  before the renumber use old numbers; the map translates them.
- **Stage 12 Phase 1 shipped** (commit `585d4ee`) — Atelier token
  swap, light-as-default, serif voice. Atelier rendering live
  (cream paper + ochre cursor verified in screenshot).
- **Stage 12 Phase 2 shipped** (commit `5cbaa36`) — files-pane
  width 240→208, explicit chevron-collapse button, layout depth
  (terminal column on paper-deep, working pane on paper).
- **⌘T tried pane-aware then reverted** (commits `c239375` →
  `2b68d40`) — owner preferred Chrome-parity (⌘T = browser).
- **⌘N configurability decision recorded** — Stage 17 H6.1 + Stage
  11 D33a cross-ref. Future setting `duo.newFileShortcut: 'md' |
  'html'` so PMs whose primary artifact is HTML reports don't have
  to learn ⌘⇧N.

## ⚠️ Pick up here next session (2026-04-26 late-evening breadcrumb)

**Where we are: Stage 5 v2 ✓ + Stage 13 ✓ + Stage 15.1 ✓ + Stage
15.2 ✓.** Layer 0 (Stage 12) functionally complete except whisper-
level agent presence (deferred). Stage 5 v2 lands the global `duo`
subagent (Haiku 4.5). Stage 15.1 lands the editor half of Send →
Duo. Stage 15.2 lands the browser half: a page-side observer IIFE
posts live selection state via a CDP binding; main caches and
forwards over IPC; the pill mounts over the WebContentsView with
the page rect translated to screen coords. **One primitive, two of
three modalities are now wired** (canvas comes via Stage 17c).
**Recommended next: Stage 17a** (HTML canvas render + edit
primitive). Stage 15.3 (length cap, image flatten, ⌘D, polish) and
Stage 14 (track changes) are both fine to defer; 17a is the bigger
unlock and its dependencies (Stage 13 primitives, Stage 15
selection-union, Stage 12 visual tokens) are all in place.

### Stage 5 v2 (just shipped — code-side)

PRD: [docs/prd/stage-5-v2-duo-subagent.md](docs/prd/stage-5-v2-duo-subagent.md).

What landed:
- New `duo external <url>` CLI verb (A24). Wraps `shell.openExternal`;
  validates `http`/`https`/`mailto` schemes only — refuses `file://`
  and other dangerous schemes. Wired through `shared/types.ts`,
  `electron/socket-server.ts`, `electron/main.ts` (`openExternalUrl`),
  `cli/duo.ts`. Binary rebuilt.
- New global agent `agents/duo.md` (Haiku 4.5, ~254 LOC). **A20
  session guard is literally the first instruction** — agent runs
  `[ -n "$DUO_SESSION" ]` and refuses cleanly if unset. Full verb
  cheat-sheet, 5 patterns (read-rewrite-write, browser extract,
  multi-tab, file-tree, Send → Duo), failure protocol, A23–A25 web
  routing rules.
- `agents/duo-browser.md` deleted. `npm run sync:claude` actively
  removes the old `~/.claude/agents/duo-browser.md` so dev installs
  flip cleanly.
- `~/.claude/duo/external-domains.json` bootstrapped to
  `{"domains":[]}` by `sync:claude` (never overwrites populated).
- `skill/SKILL.md` rewrote the "Prefer delegating" section (now
  points at `duo`, with the `$DUO_SESSION` orchestrator-side check
  per A21) and added a "Web routing" section documenting the
  external-domains.json file.
- `docs/dev/smoke-checklist.md` § 7a (new) — Pre-flight + functional
  walks (F1, F2, F5, F8, F9) + recovery walks (C5/C6/C7 the
  load-bearing guards) + post-walk cleanup.
- README, FIRST-RUN, BUILD-PROCEDURES, CLAUDE.md plumbing checklist
  all updated to point at `agents/duo.md` (the "*pending*" qualifier
  on item 7 of the plumbing checklist is gone — agent file is now
  load-bearing).

**Live walks done in this session — Class A + Class C all PASS:**

CLI smoke (orchestrator-driven, direct calls):
- ✅ `duo external` end-to-end: success path opens macOS default
  browser; scheme guard rejects `file://` / `javascript:` / malformed
  URLs.
- ✅ **F1 read-rewrite-write** (`/tmp/agent-fixture.md`): editor
  mounted, `doc read` returned live buffer, `doc write --replace-all`
  landed on disk inside the autosave window.
- ✅ **F8 web routing (Duo path)**: empty `external-domains.json` →
  `duo open https://example.com` opened tab in Duo's browser pane
  (verified via `duo url` + `duo title` + `duo text --selector h1`).
- ✅ **F9 web routing (listed external)**: seeded
  `external-domains.json` with `example.com` → `duo external` opened
  in Safari; `duo tabs` showed Duo's tab list unchanged.

Agent walks (fresh `claude -p --agent duo` subprocesses, Haiku 4.5,
total cost ~$0.40):
- ✅ **C5 outside-Duo guard.** `env -u DUO_SESSION -u DUO_SOCKET claude
  -p --agent duo "..."` → agent ran `[ -n "$DUO_SESSION" ] && echo
  in_duo || echo not_in_duo`, saw `not_in_duo`, refused with the
  EXACT one-line message from the prompt. **2 turns, zero `duo` verb
  invocations, $0.006.** Permission-denial caveat noted below.
- ✅ **C6 malformed list.** Truncated JSON (`{"domains":[`) in the
  list file. Agent navigated via `duo open` (correct fallback); no
  crash. 4 turns, $0.027.
- ✅ **C7 listed-domain bypass.** Seeded list with `example.com`,
  asked agent to navigate. Stream-json call log:
  `duo external https://example.com/test-page` — NO `duo open`/`duo
  navigate` for the listed host. Duo's tab list unchanged
  before/after.
- ✅ **F2 browser extract.** Agent navigated example.com, returned
  H1 + correctly noted no list items present.
- ✅ **F4 file-tree.** Agent scanned `/tmp/test-dir/{a,b,c}.md`,
  correctly identified a + c as containing "risk" and b as not.
- ✅ **F5 send→duo round-trip.** Agent inserted text at the editor's
  caret position via `duo doc write --replace-selection`; file on
  disk reflected the change.

**C5 caveat — narrow Bash allowlist can mask the guard.** When the
agent was given `--allowedTools "Bash(duo *) Bash(echo *)"` (narrow
patterns that don't match the compound `[ … ] && echo … || echo …`
guard command), the guard check was permission-denied, the agent
proceeded to call `duo doc read`, and the refusal didn't fire. With
permissive `--allowedTools "Bash"` the guard works correctly. This
is a corner case for users who hand-write tight Bash allowlists; the
agent's prompt could be hardened to refuse-on-check-denied. Filed in
`tasks.md` as FOLLOWUP-002.

**Class B perf — finding inverts the PRD hypothesis.** Synthetic F1
on a fresh `claude -p --model sonnet`, comparing inline (Sonnet calls
`duo` directly) vs subagent (Sonnet delegates via Task to the duo
subagent):

|  | inline (A) | subagent (B) |
|---|---|---|
| Total cost | $0.08 | $0.17 |
| Wall-clock | 36s | 65s |
| Sonnet tokens | 6 in / 398 out | 6 in / 348 out |
| Haiku tokens | 1593 out | 2285 out |

Both paths show tiny Sonnet usage because **Claude Code already
routes mechanical tool work to Haiku regardless of `--model`**. The
subagent path stacks a SECOND Haiku context (the agent's own) on top
of Claude Code's fast-tier Haiku, doubling the Haiku-side cost.

The PRD's "~85% orchestrator-token reduction" was framed against a
mental model where the top-level Sonnet processes CLI dumps directly.
That isn't how Claude Code actually distributes tokens across model
tiers, so the synthetic measurement doesn't show the predicted win.

**The agent's value is real but different from the PRD framing:**
1. **Bounded context per task** — the subagent's window is
   independent, so a long session with many duo tasks doesn't bloat
   the main conversation's prefix cache.
2. **Specialized prompt** — the agent knows the verbs, the routing
   rule, the failure modes. The orchestrator doesn't need to be
   primed with `~/.claude/skills/duo/SKILL.md` content for every
   task.
3. **Clear contract** — orchestrator drafts content, agent applies.
   Failure modes are predictable.

These are ergonomic / scale-with-session-length wins, not per-task
dollar wins on a cold-cache synthetic. **A proper measurement would
track cumulative orchestrator-context tokens across a multi-task
session**, not single-task fresh-cache costs. Filed as FOLLOWUP-003.

The smoke checklist (`docs/dev/smoke-checklist.md § 7a`) carries the
agent walks for ongoing regression coverage.

**Critical contracts** (see PRD A20–A26 for detail):
- **Session guard (A20):** agent is global-installed, so every Claude
  Code session on the user's machine sees it — including non-Duo
  terminals. Without the `$DUO_SESSION` check, an outside-Duo
  orchestrator would route Duo-flavored work to the agent and waste
  turns hitting `Cannot connect: Duo app is not running`. Guard IS
  the first action in the prompt. Stage 19a Phase 19a exports
  `DUO_SESSION=1` per Duo PTY (`electron/pty-manager.ts:33`).
- **Web routing (A23–A26):** every URL goes through Duo by default;
  hostnames in `~/.claude/duo/external-domains.json` route to system
  default browser via `duo external <url>`. List ships empty;
  user-curated for sites that don't render well in `WebContentsView`
  (claude.ai, chatgpt.com, banking sites, etc.).
- **Content authority (A8):** orchestrator drafts content; agent
  applies. Keeps Haiku in its lane; makes failures predictable.
- **Failure mode (A10):** hard-fail-and-surface. Agent never
  improvises on unexpected output shapes; orchestrator decides
  recovery.

### Stage 15.2 (just shipped — code-side, data-plane verified live)

PRD: [docs/prd/stage-15-send-to-duo.md § 6.2](docs/prd/stage-15-send-to-duo.md).

What landed:
- **CDP page-side selection observer.** `SELECTION_OBSERVER_IIFE` in
  `electron/cdp-bridge.ts` — ~80 LOC, debounced, listens for
  `selectionchange`/`scroll`/`resize`, serializes to
  `BrowserSelectionSnapshot` + page-relative rect, posts via
  `window.duoSelectionPush(json)`. Re-injection guarded by
  `__duoSelectionObserver`. Re-injected on `Page.frameNavigated`
  for top-frame navigation.
- **`Runtime.addBinding('duoSelectionPush')`** registered in CDP
  attach. `Runtime.bindingCalled` events parsed in `handleCdpEvent`
  → cached as `latestBrowserSelection` → emitted to a single
  `browserSelectionListener` callback.
- **Cache reset on tab switch.** `attach()` emits a `null` push so
  the renderer's pill goes away while the new tab's observer
  reports.
- **`BrowserManager.constructor` wires the listener** to forward
  pushes via `mainWindow.webContents.send(IPC.BROWSER_SELECTION,
  push)`. New IPC channel `BROWSER_SELECTION` (main → renderer).
  New types: `BrowserSelectionRect`, `BrowserSelectionPush`.
- **`renderer/hooks/useBrowserSelection.ts`** — small hook
  subscribing to the IPC.
- **`BrowserRenderer` pill mount.** Reads `useBrowserSelection`,
  reads page title from `BrowserState`, reads format from
  `useSelectionFormat`, translates page rect → screen rect using
  `contentRef.getBoundingClientRect()`. Click handler calls
  `formatBrowserSendPayload` (new variant in `sendFormat.ts`).
- **`<SendToDuoPill>` rect type loosened** from `DOMRect` to a
  minimal `PillAnchorRect = { top, bottom, right }` so the browser
  surface can synthesize a translated rect rather than fabricating
  a DOMRect (DOMRect isn't constructable in renderer code).
- **`onSendToDuo` threaded** through `WorkingPane` to
  `BrowserRenderer` so the same `pty.write(activeTabId, payload)`
  callback serves both surfaces.

**Live verification (data plane):**
- `duo eval "({ hasBinding: typeof window.duoSelectionPush === 'function', hasObserverGuard: !!window.__duoSelectionObserver })"`
  → `{hasBinding: true, hasObserverGuard: true}` on a fresh
  example.com tab.
- Programmatically selecting the H1 fires the observer; the wrapped
  binding sees the call and the captured payload contains both
  `snapshot` and `rect: {x, y, width, height}`.
- On-demand `duo selection --pane browser` keeps working
  (independent path through `getBrowserSelection()` — the CLI does
  not depend on the binding cache).

**Visual pill rendering** (the actual purple chip floating over the
selected H1) is the only piece not yet eyes-on-verified — gated on
FOLLOWUP-004's computer-use access. The data plane proves the
pipeline is correct; rendering is a CSS / portal-positioning
question that the editor variant already validates.

### Recommended next: Stage 17a (HTML canvas — render + edit primitive)

PRD: [docs/prd/stage-17-html-canvas.md § 7 — 17a](docs/prd/stage-17-html-canvas.md).

Why now: Stage 17's stated dependencies are Stage 13 (✓), Stage 15
(now 2/3 — editor + browser shipped; canvas = 17c), and Stage 12
(✓). Stage 14 (track changes) is **explicitly NOT a prerequisite**
per the Stage 17 PRD H39 (HTML diff defers to a Stage 17 v2). 17a
is shippable on its own (~3–4 PRDs):

- New `html-canvas` tab type registered in `WorkingPane`.
- `duo html new` + `duo edit <path.html>` (alias under existing
  `duo edit` when extension is `.html`).
- Iframe-srcdoc host with `contentEditable` on body; render-on-write.
- Top toolbar (H28 inline marks + link picker).
- Save: autosave + `⌘S` + dirty dot (H33).
- Skill stub (H16) — README only, no snippets yet.
- **Exit:** PM opens an `.html`, edits prose, saves; the file is
  clean HTML another tool can read.

Risk: `contentEditable` quirks (PRD calls this out as risk #1).
Mitigation: write a thin normalization layer on day one; build a
regression set against the H18 snippets when 17d ships them.

**Stage 15.3 + Stage 14 are fine to defer.** 15.3 is polish (length
cap, image flatten, `⌘D`); 14 is track changes for the editor and
its visual layer ships canvas-ready by construction. Pull either
in when their bottleneck is felt.

### Stage 15.1 (just shipped)

PRD: [docs/prd/stage-15-send-to-duo.md § 6.1](docs/prd/stage-15-send-to-duo.md).

CLI half (smoke-tested live):
- `duo selection-format [a|b|c]` (G19) — agent-tunable runtime knob,
  persisted in renderer localStorage. Default `a` (quote + provenance);
  `b` = literal; `c` = opaque token. Mirrors `duo theme` plumbing
  (renderer source of truth, main caches for CLI reads). New IPC:
  `SELECTION_FORMAT_STATE_PUSH` / `SELECTION_FORMAT_SET`.
- `duo send [--text "…"]` (G17) — writes payload into active terminal's
  PTY. No Enter (G11). Renderer pushes active tab id via
  `TERMINAL_ACTIVE_PUSH` so main knows where to write. Returns
  `{ok, written, terminalId}`.

UI half (HMR-applied, typecheck clean, visual walk deferred):
- `renderer/components/editor/sendFormat.ts` — pure formatter for
  modes a/b/c. Per-line `> ` prefix on multi-line selections; `~/`
  shortening on paths inside `$HOME`.
- `renderer/components/editor/primitives/SendToDuoPill.tsx` — visual
  primitive (no editor imports per the Stage 13 contract). Portals to
  `document.body`, anchors 6px above selection (falls back below when
  no room), right-aligns and clamps to viewport. `onMouseDown` (not
  click) so the editor doesn't blur first.
- `renderer/hooks/useSelectionFormat.ts` — localStorage round-trip
  + main pushState + CLI-driven `onSet` listener.
- `MarkdownEditor.tsx`: tracks `pillRect` in the same effect that
  pushes `EDITOR_SELECTION_PUSH`; hides on blur or collapsed
  selection; repositions on scroll/resize. Click handler reads
  `lastSelectionRef`, formats via `useSelectionFormat`, calls
  `onSendToDuo` prop.
- `WorkingPane.tsx` + `App.tsx`: `onSendToDuo` callback in App.tsx
  calls `pty.write(activeTabId, payload)` then sets `focusedColumn =
  'terminal'`. `null` propagates when no terminal exists, hiding the
  pill entirely.
- `globals.css` — `.duo-send-pill` style: small purple chip on
  `--duo-accent`, 11px text, layered drop-shadow, hover lift, 120ms
  fade-in keyframe.

### Stage 13 (just shipped)

Phase 0 + 13a + 13b end-to-end. The two visual primitives
(`duo-just-added` keyframe, `<WriteWarningBanner>`) live under
`renderer/components/editor/primitives/` with zero TipTap imports —
contract enforced via the `primitives/README.md`. MD bindings live
in `extensions/`. Stage 14 (track changes) and Stage 17 (HTML canvas)
will reuse the same primitives directory; Stage 17 v2 just writes a
canvas-side binding.

Notable runtime fix: `--duo-mark` token bumped `#F8E59C` → `#F0CB6A`
because the prototype's value was visually imperceptible against
cream paper. DOM inspection confirmed the wash was painting; it was
contrast, not wiring. Doc-write timeouts also bumped 5s → 5min on
both renderer (`dispatchDocWrite`) and CLI (`PER_CMD_TIMEOUT_MS`)
sides for the human-in-the-loop banner-decision window.

### Owner pre-work (cert procurement)

Can run in parallel — see ROADMAP § Owner pre-work. 1–2 business
days enrollment lead time, longer for cert provisioning. Kick off now
to shave weeks off Stage 21.

### Open process work

- **PROCESS-001 Phase 2** (Playwright + Electron automation) deferred
  until Stage 18 lands. Phase 1 — the keyboard matrix in
  `docs/dev/smoke-checklist.md § 5` — is now load-bearing; walk it on
  every keyboard-touching change.
- **FOLLOWUP-001** (in `tasks.md`): when Stage 5 v2 ships, drop the
  "*pending*" qualifier on item 7 of the plumbing checklist in
  CLAUDE.md so `agents/duo.md` becomes a required touch-point for
  every new CLI verb.

**Previous session (2026-04-25):**
- Stage 9 cozy mode graduated — daily-driver validation passed; menu
  label, PRD, ROADMAP all updated.
- Stage 15 PRD ([docs/prd/stage-15-send-to-duo.md](docs/prd/stage-15-send-to-duo.md))
  refined — G10 payload format locked to **A** (quote + provenance);
  G19 added making the format runtime-configurable via the new P1
  CLI verb `duo selection-format [a|b|c]` so agents can opt into
  format C (opaque tokens) for compact multi-step sessions.
- Open ADR "Skill scoping" resolved — locked to global
  `~/.claude/skills/duo/`. Per-session alternatives kept on the
  books in DECISIONS.md for future reference.
- Two thematic commits pushed (`feat(editor+theme)` + `docs`),
  rebased over upstream skill-sandbox-troubleshooting commit.

**Foundation (shipped + verified):**
- Electron main process, preload, PTY manager
- Three-column layout (Files / Terminal / WorkingPane) with one unified
  tab strip across browser + editor + preview tab types
- Terminal tabs (xterm.js + node-pty) with cozy mode typography
- Browser pane (`WebContentsView`, SSO via `persist:duo-browser`, tab
  strip, shortcut forwarding for the allowlisted `⌘<letter>` set)
- File navigator (Stage 10) — shared tree, breadcrumb, pending-CWD for
  new terminal tabs, follow-mode
- Theme toggle — System / Light / Dark; follows macOS appearance in
  System mode; xterm terminal theme swapped in lock-step (so the
  terminal isn't white-on-black in light mode)
- `duo` CLI over a Unix socket at
  `~/Library/Application Support/duo/duo.sock` (mode 0700). Full
  inventory + gap roadmap in [docs/CLI-COVERAGE.md](docs/CLI-COVERAGE.md).
- Markdown editor (Stage 11a): TipTap/ProseMirror, tiptap-markdown
  round-trip with frontmatter preservation, table contextual toolbar,
  syntax-highlighted code, `⌘N` new-file flow with filename
  interstitial + focus-to-prose on commit, persistent selection
  overlay across focus changes, `⌘S` + autosave, dirty dot
- Bundled `duo` Claude Code skill + `duo` subagent (Haiku 4.5; Stage 5 v2)

**CLI verbs shipped (see [docs/CLI-COVERAGE.md](docs/CLI-COVERAGE.md) for
the authoritative inventory):** navigate · open · url · title · dom ·
text · ax · click · fill · focus · type · key · eval · screenshot ·
console · errors · network · tabs · tab · close · wait · view ·
reveal · ls · nav-state · edit · selection · doc read · doc write ·
theme · external · selection-format · send · install

**What's next (see `ROADMAP.md` + `docs/CLI-COVERAGE.md`):**

**Build order is layered.** See [ROADMAP.md § Layered build order](ROADMAP.md)
for the full graph. The actual next thing depends on which layer is
the binding constraint:

1. **Stage 12 — Visual redesign (Atelier).** ⭐ *Layer 0 foundation —
   recommended next.* System-wide token swap + light-as-hero + layout
   depth + tab-strip rhyme + files-pane width 208. Every L1+ stage
   (13, 14, 15, 17, 19c) inherits its tokens; building those first
   means re-skinning later. Design locked at
   [docs/design/atelier/](docs/design/atelier/); Stage 9 cozy-visual
   completion folds in.
2. **Stage 15 — Send → Duo (cross-modality selection primitive).** L1
   priority unlock. PRD locked at
   [docs/prd/stage-15-send-to-duo.md](docs/prd/stage-15-send-to-duo.md);
   G10 payload format locked. Visual chrome from Stage 12 — start
   either way, but the pill ships its final color when 12 lands.
3. **Stage 13 — Editor: just-added highlight + warn-before-overwrite.**
   L1, smaller. Atelier mock supplies the visual (yellow `mark` + 6s
   fade — overrides PRD's old "blue fade" placeholder).
4. **Stage 18 — First-launch self-install.** L3 (parallel track —
   independent of L0–L2). No cert needed. `npm run dist` validated
   2026-04-26 (commit `20b4701`); next is the consent sheet + the
   actual `fs.copyFile` install action. Bring this forward whenever
   the "Trailblazer can't double-click" friction outranks the next
   feature.
5. **Stage 19 Phase 19b — Passive priming.** L3, follows from 19a
   (env signals, shipped 2026-04-26 in commit `640ec0e`). SessionStart
   hook + PATH shim + `priming.md`. Folds into Stage 18's consent
   sheet when both land.

**Owner pre-work runs in parallel:** ROADMAP.md § Owner pre-work has
the cert-procurement checklist. Apple Developer ID enrollment lead
time is 1–2 business days minimum — kicking it off shaves real weeks
off Stage 21.

**P0 CLI gaps shipped 2026-04-26 — done.**
Remaining `Browser observability` items in [docs/CLI-COVERAGE.md](docs/CLI-COVERAGE.md)
(`duo network --bodies`, `duo storage`, `duo styles`) are P1/P2 — pull
in if a concrete agent task wants them.

**Backlog** (no fixed order): 11a tail items (frontmatter panel,
drag-drop images, slash menu), Stage 11e (outline + find), skill +
connector surface (was old Stage 12), multi-window (was old Stage
16), 15-family primitives that didn't get promoted (events, notify,
tab-name, tab-cmd, zap, file→composer). Pull in when convenient.

**Notes on the 2026-04-26 renumber:**
- The renumber moved every unshipped stage to a number that reflects
  build order. Old commit messages still use old numbers — see
  [ROADMAP.md § Number history](ROADMAP.md) for the translation map.
- **Stage 12 (Atelier) reframed:** previously held "until after the
  flagship pair" as if it were polish. It's not — it's a Layer 0
  *foundation* every Layer 1+ stage inherits. Building features
  first means re-skinning later. Reframed as the recommended L0
  next ship; per-feature visuals (just-added highlight → 13, track
  changes → 14, Send → Duo pill → 15, cozy completion → 9
  follow-up) fold into their host stages but the system-wide
  token swap belongs to Stage 12.
- **Old Stage 14 split → new Stages 18 + 21.** Stage 18 (first-
  launch self-install, no cert) is independently shippable;
  Stage 21 (cert-gated distribution polish) waits on cert
  procurement (see § Owner pre-work in ROADMAP.md).
- **Old Stage 11 split → top-level stages.** 11b → 16
  (reconciliation), 11c → 13 (just-added highlight), 11d → 14
  (track changes), 11e → Backlog (outline + find), 11a tail →
  Backlog. Stage 11 itself remains as 11a (core editor — shipped).
- **Stages 18a/b/c (Duo detection) → 19a/b/c.** Phase 19a env
  signals shipped 2026-04-26 in commit `640ec0e` (commit message
  uses old "18a" label). 19b folds into Stage 18 consent sheet;
  19c needs Stage 12 split-button visual.
- **Issue triage swept** — see [ROADMAP § Open issue → stage
  mapping](ROADMAP.md). 5 already shipped and closed (#10, #17,
  #20, #21, #26); 11 mapped to existing stages; #22/#23/#27
  promoted to roadmap bullets in Stage 20 + 21.

**Known issues live in [`tasks.md`](tasks.md).** As of 2026-04-26
late-day: **0 open bugs · 1 deferred process item.**
- **BUG-001** (closed 2026-04-26 in commit `3976039`) — `⌃Tab`
  pane-aware cycling. Three-part fix; full write-up in `tasks.md`
  so the next reader doesn't re-discover the xterm-key-eating and
  WebContentsView-mousedown gotchas.
- **BUG-002** (closed 2026-04-26) — `⌘T` from browser focus didn't
  focus the address bar. Root cause: when WebContentsView has OS
  focus, renderer-side `el.focus()` is a no-op. Fix:
  `wireKeyForwarding` reclaims OS focus to the main renderer
  before forwarding ⌘T/⌘N/⌘L.
- **BUG-003** (closed 2026-04-26, revised same-day) — Pane focus
  indicator too subtle. v1 (inset-shadow ring) was occluded by
  xterm canvas / WebContentsView on Terminal + Working — only the
  seam line was visible, which abuts the neighbour's seam line and
  is therefore ambiguous about ownership. v2 moves the indicator
  into the column's chrome strip (tab bar / breadcrumb header):
  background tints to `accent-soft` when the column has focus.
  Strip is renderer DOM and never occluded.
- **BUG-004** (closed 2026-04-26) — `⌘`` pane-toggle didn't move
  OS-level focus. Two-part fix: ⌘` menu accelerator now calls
  `mainWindow.webContents.focus()` before sending the IPC; renderer
  `togglePaneFocus` focuses the contenteditable for editor file
  tabs (not the wrapper).
- **PROCESS-001 Phase 1** (closed 2026-04-26) — keyboard matrix
  in `docs/dev/smoke-checklist.md § 5` expanded into shortcut ×
  focus-surface matrix + theme + pane-toggle contract. Walk it on
  every keyboard-touching change.
- **PROCESS-001 Phase 2** (deferred) — Playwright + Electron
  automation. Pick up after Stage 18 lands.

---

## Key files

| File | Purpose |
|---|---|
| `README.md` | Elevator pitch, quick start, CLI reference, architecture diagram |
| `docs/VISION.md` | Product north star — persona, principles, flagship bet. Read before making product/UX decisions. |
| `docs/CLI-COVERAGE.md` | Authoritative CLI verb inventory + priority-tagged gap roadmap. Touched on every new feature. |
| `docs/prd/` | Per-stage PRDs (9, 10, 11) with D-numbered decisions + rationale |
| `docs/design/atelier/` | Visual-redesign source bundle (Atelier direction). Tokens, mock components, and the interactive prototype that drives Stage 17 + per-feature visuals (cozy mode, just-added highlight, track changes, Send → Duo pill). Read [its README](docs/design/atelier/README.md) before any UI-touching work. |
| `docs/dev/smoke-checklist.md` | Test matrix walked before calling any UI change done |
| `duo-brief.md` | Original engineering brief (Stages 1–5). Architecture + Google Docs path are authoritative; product framing is superseded by `docs/VISION.md`. |
| `docs/roadmap.html` | **Canonical roadmap.** Atelier-styled single-page surface with the full layered build order, per-stage cards (status, sub-items, PRDs, cross-refs), per-stage comment boxes (localStorage-backed for Geoff's inline notes), and a sidebar with status counts + nav. Served at `http://localhost:8765/roadmap.html` via `.claude/launch.json`. **This is the file Geoff actually reads;** edit it as your primary surface for any roadmap change (snapshot date in `<header>`, Recent shipments list, sidebar counts, stage-card status / sub-items / cross-refs, Layer-band headings). Same `<details class="stage done">` collapsing pattern for fully-done stages (no pending sub-items); leave in-progress / pending stages always-expanded. |
| `ROADMAP.md` | Synced markdown view of `docs/roadmap.html`. Useful for full-text grep, `git blame` history, and read access from agents that don't have HTML rendering (subagents reading the file via `cat`). **Not authoritative** — when the two diverge, the HTML wins. Keep in step with every `roadmap.html` update; the markdown's structure mostly mirrors the HTML's content but adds the layered-build-order ASCII diagram, the full table of stages, and the Number-history table for old↔new translations. Periodically reconcile by reading both side-by-side. |
| `docs/DECISIONS.md` | Locked architectural decisions with rationale (+ open ADR on sandbox-tolerant transport) |
| `docs/FIRST-RUN.md` | Thorough setup procedure |
| `docs/RESEARCH.md` | Technical research notes that informed decisions |
| `shared/types.ts` | Shared types + IPC channel names + `DuoCommandName` |
| `electron/constants.ts` | Node-only paths (socket, session partition, skill install dir) |
| `electron/main.ts` | Electron main process entry; theme, nav, editor-doc-write bridges |
| `electron/cdp-bridge.ts` | CDP command executor (ax tree renderer, console ring buffer, key/focus/type) |
| `electron/browser-manager.ts` | WebContentsView tabs + SSO partition + **shortcut forwarding allowlist** |
| `electron/files-service.ts` | Disk I/O: list, read, write (atomic tmp+rename), chokidar watch |
| `electron/pty-manager.ts` | node-pty session pool |
| `electron/socket-server.ts` | Unix socket → CLI verb dispatch (single switch; touch for every new verb) |
| `cli/duo.ts` | CLI source — rebuilt with `npm run build:cli`; tracked binary at `cli/duo` |
| `renderer/App.tsx` | Root React component, three-column layout, theme + focus routing |
| `renderer/components/editor/MarkdownEditor.tsx` | Stage 11 rich editor (TipTap + tiptap-markdown + custom extensions) |
| `renderer/components/editor/EditorToolbar.tsx` | Top toolbar + contextual table controls (PRD D5, D12a) |
| `renderer/components/editor/extensions/` | `TableShortcuts`, `PersistentSelection` |
| `renderer/hooks/useTheme.ts` | Theme mode state + push to main + CLI-override listener |
| `skill/SKILL.md` | Claude Code skill (auto-discovered via YAML frontmatter) |
| `agents/duo.md` | Subagent (Haiku 4.5) — the canonical Duo-CLI driver; orchestrators delegate multi-step `duo` sequences here |

---

## Working style — Claude instances must follow these

1. **Ask before deciding.** Use the `AskUserQuestion` tool whenever there is a meaningful choice to make — layout, UX behaviour, approach, prioritisation, open questions. Do not silently pick one option and implement it. Batch related questions (up to 4 per call) so Geoff can answer them in one shot and you can proceed without interruption.

2. **Do not re-debate the stack.** Electron, xterm.js, WebContentsView, Unix socket CLI — all locked. See `docs/DECISIONS.md`.

3. **The CLI is the spec.** Every time a new CLI command is added, update `cli/duo.ts`, `skill/SKILL.md`, and **[docs/CLI-COVERAGE.md](docs/CLI-COVERAGE.md)** (the authoritative inventory + gap roadmap). `duo-brief.md §9` holds the original Stage-1–3 draft for historical context but is no longer updated with new verbs.

4. **CLI parity with UI — every user-facing feature ships a `duo` counterpart.** If the human can do it with a click, a menu, a keystroke, or a UI toggle, the agent must be able to do the same thing from the CLI. This is load-bearing for the whole product: Duo's premise is human↔agent pair work on shared surfaces, and a UI-only feature silently breaks that premise. Concrete patterns:
    - UI toggle → `duo <thing>` reads state, `duo <thing> <value>` sets it (example: `duo theme`, `duo theme system|light|dark`).
    - Menu action → `duo <verb>` runs the same action.
    - In-app shortcut that changes state → `duo <verb>` does the same without the keystroke.
    - **Agent-tunable runtime settings** (no UI surface, agent-only): same `duo <thing> [value]` shape, persisted in localStorage. The agent calls it at the start of a session to pick the mode that suits its workflow (example: `duo selection-format [a|b|c]` for Stage 15's Send → Duo payload format). When you build one of these, check if there's a *user* parallel; if there isn't yet, document the asymmetry in the PRD so a later UI surface can be added without breaking the CLI shape.
    - Deliberately UI-only features (e.g. drag-to-reorder) must be called out in the PRD as explicit asymmetries.

    Plumbing checklist for a new CLI verb — every one of these must be touched:
    1. `shared/types.ts` — add the command name to `DuoCommandName`, plus any new IPC channel / state-snapshot shape
    2. `electron/preload.ts` — expose a minimal renderer API (push / subscribe)
    3. `electron/main.ts` — ipcMain handler for state push; dispatch helper for main→renderer pushes; bridge-exposed getter/setter
    4. `electron/socket-server.ts` — new case in the command switch; extend `NavBridge` if it needs renderer state or a renderer dispatch
    5. `cli/duo.ts` — the verb itself + `printHelp()` update
    6. `skill/SKILL.md` — so the agent discovers it (plus `npm run sync:claude`)
    7. **`agents/duo.md`** — every new verb must update the agent's verb
       cheat-sheet (under `## Verb cheat-sheet`). The agent runs on
       Haiku 4.5 and is the canonical Duo-CLI driver; verbs absent from
       the cheat-sheet are effectively invisible to it. PRD:
       `docs/prd/stage-5-v2-duo-subagent.md`.

5. **The skill is a first-class deliverable.** Ship both the app and `skill/SKILL.md`, or neither. The skill is how Claude Code discovers the tool.

6. **If blocked on an open question in `duo-brief.md §7`, state the assumption and proceed.** Do not stall waiting for clarification on layout, aesthetics, or naming.

7. **Stage order matters.** Do not try to implement Stage 3 before Stage 2 is working. The socket server is useless without a real browser.

8. **NEVER claim UI work is done without previewing it yourself.** Build
   passing and types clean are not sufficient evidence that a UI change
   works. Before saying "shipped" / "done" on anything that touches the
   renderer, main process, preload, CSS, or menus:

   - Confirm `npm run dev` is running. The dev-server log is tailable at
     `/private/tmp/claude-501/…/tasks/<hash>.output` (look for the
     process spawning `electron-vite dev`).
   - **If `preload.ts` or `electron/main.ts` changed, relaunch Electron**
     — HMR only covers the renderer. Either kill and restart the dev
     server, or ask the user to Cmd+Q and restart.
   - Use computer-use (`request_access` for Electron, then `screenshot`)
     to **actually see the window**. Then walk
     [`docs/dev/smoke-checklist.md`](docs/dev/smoke-checklist.md) — it
     covers the boot path, terminal, files pane breadcrumb nav, working
     pane, keyboard shortcuts from *both* terminal and browser focus,
     cozy mode, and the agent CLI bridge.
   - Include in the end-of-task summary the "saw in the live app" block
     from the checklist's reporting template. If I can't fill it in, the
     task isn't done.
   - If the change set is wide enough that spot-checks won't cover it,
     propose a dedicated regression spike to the user **before** calling
     the stage complete.

   The user lost time on Stage 9 because I shipped code that typechecked
   but crashed the renderer at mount time. That is exactly what a
   two-minute preview pass would have caught.

9. **After editing `skill/` or `agents/`, sync to `~/.claude/`.** The repo
   tracks the canonical source, but Claude Code running on this machine
   reads from `~/.claude/skills/duo/` and `~/.claude/agents/duo.md`.
   These are plain-file **copies**, not symlinks — edits in the repo do
   not propagate automatically. After any change to `skill/SKILL.md`,
   `skill/examples/*.md`, or `agents/duo.md`, run:

   ```bash
   npm run sync:claude
   ```

   This copies the repo versions into `~/.claude/` so live Claude Code
   sessions — including whatever session is driving this repo — pick up
   the change on their next skill / subagent lookup. If you don't sync,
   your edits are invisible until the user either restarts their Claude
   Code session or manually re-copies. The rule applies equally to edits
   the user makes by hand: remind them to `npm run sync:claude` after any
   manual edit.

   End users don't run this script — they get the skill + agent from the
   **Stage 18** first-launch installer (which does its own `fs.copyFile`
   from the app bundle into `~/.claude/`). `sync:claude` is a dev-only
   convenience.

---

## Claude Code sandbox — must read before touching transport, install, or CLI file I/O

Claude Code runs each Bash tool call inside a macOS Seatbelt sandbox that
(a) blocks writes outside the working directory, (b) gates
Unix-domain-socket outbound connections behind an explicit
`allowUnixSockets: true`, and (c) permits localhost TCP. Duo's entire
agent-side bridge today is a single Unix socket at
`~/Library/Application Support/duo/duo.sock` — which means **every `duo`
command silently fails inside a sandboxed Claude Code session**.
The user sees a hung or `ECONNREFUSED` Bash call with no hint that the
sandbox is the cause.

Before changing any code in `cli/duo.ts`, `electron/socket-server.ts`,
the install path, or the skill's troubleshooting guidance, read
`docs/DECISIONS.md` → Open ADRs → **Sandbox-tolerant transport and
install paths for the `duo` CLI**. That ADR inventories what breaks,
explains the `dudgeon/chrome-cdp-skill` precedent (localhost TCP +
auth-token file), and names the planned direction: TCP fallback
alongside the Unix socket, `duo doctor` diagnostic,
`~/.claude/bin/duo` as the preferred install target, skill-docs
troubleshooting section, and a bundled settings fragment. Roadmap
items cross-reference the ADR from Stages 5, 13, and 14.

The work is planful and roadmap-aligned — not a patch. If you find a
new sandbox failure mode not listed in the ADR, add it there rather
than routing around it ad hoc.

---

## Pre-built CLI binary (`cli/duo`)

`cli/duo` is a compiled esbuild bundle intentionally tracked in git so Geoff
can install the CLI without running a build step (`node cli/duo install`).

**If you change `cli/duo.ts`**, you must regenerate and commit the binary:
```bash
npm run build:cli   # rebuilds cli/duo from cli/duo.ts
git add cli/duo && git commit -m "build: regenerate cli/duo binary"
```

---

## Build commands

```bash
npm install          # installs deps + rebuilds node-pty for Electron
npm run dev          # launch app in dev mode (HMR)
npm run build        # production build → out/
npm run typecheck    # TypeScript type checking (no emit)
npm run dist         # build + package as macOS DMG → dist/
```

---

## Architecture in one paragraph

One Electron main process owns everything: the `BrowserWindow`, the `PtyManager`
(node-pty pool), the `BrowserManager` (WebContentsView, Stage 2), the `CdpBridge`
(Chrome DevTools Protocol commands, Stage 3), and the `SocketServer` (Unix socket
listener, Stage 3). The renderer process hosts React — it shows xterm.js terminals
and a placeholder browser pane, communicating with the main process via contextBridge
IPC. The `duo` CLI (a standalone Node.js script) connects over the Unix socket to
send CDP commands from inside any terminal tab, making the browser programmable from
Claude Code.

---

## Locked decisions (from owner)

| Decision | Choice |
|---|---|
| App name | Duo — CLI is `duo`, skill at `~/.claude/skills/duo/` |
| CLI packaging | esbuild compiled binary — no Node.js on user's PATH needed |
| Browser tabs | Visible tab strip inside BrowserPane; also drivable via `duo tab <n>` from the CLI |
| Brainstem / MCP | **Not included** — Skills panel is CWD-scan only |
| Stage 2 + 3 | Implemented together in one pass |
| Skills panel layout | Collapsible sidebar — third column right of browser pane (scanner implemented; UI not yet wired) |
| Skills CWD source | PTY launch CWD (not moving shell CWD); two scopes: project + home |
| First-launch install | Electron permission dialog before installing CLI + skill + agent (deferred; currently manual) |
| Distribution / cert | No cert yet — personal use only; get cert before Stage 21 (Stage 18 does not need one) |

## Open questions needing Geoff's input

| Question | Priority |
|---|---|
| Apple Developer ID cert | Before Stage 21 |
| Distribution timeline (personal → Trailblazers) | Before Stage 21 |
| Socket auth approach for Trailblazers | Before Stage 21 |
