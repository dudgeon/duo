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

**Latest session (2026-04-26) — Stage 17 deep stack + Stage 19c
merge + Stage 21 cert pre-work all done. **17a + 17a polish (1-7) +
17a.5 D + 17b A-D** shipped + committed (7 thematic commits). **19c
merged in from worktree** (split-`+` button + `duo new-tab` + claude
default), 6 conflict files resolved by composing both stages.
**Stage 21 cert pre-work ✅ complete** — all five artifacts verified
on disk + in keychain (`security find-identity` returns one valid
identity; `.p8` at `~/Documents/duo-private/`; Team ID `R39EF29X3Y`,
Key ID `T8VVN9GF4M`). Earlier same day: Stages 5 v2 + 13 + 15.1 +
15.2 + owner-walk fixes + skill refactor.** New `html-canvas` tab type;
`renderer/components/HtmlCanvas/{CanvasTab,RenderedCanvas,CanvasToolbar,inlineMarks,htmlBoilerplate}.tsx`;
`shared/html-boilerplate.ts` shared between renderer + main; new
`duo html new <path.html>` CLI verb (writes H17 boilerplate
atomically + dispatches NAV_EDIT); `.html`/`.htm` route through
`fileClassifier`; `⌘N` extension-based dispatch dissolves PRD
H6.1; selection-aware mark applicator without `execCommand` (PRD
§8 non-negotiable). Skill stub at `skill/examples/html-canvas-authoring.md`.
Live walk pending — owner deferred to "after this batch." Detail
in the **Pick up here** section below.

**Earlier same-day session (2026-04-26 late-evening) — Stages 5 v2 + 13 +
15.1 + 15.2 shipped & committed; owner-walk follow-ups (focus on
Send → Duo, ⌘N D33f regression, editor click-target) committed in
`258ff6f`; SKILL.md slimmed by extracting verbose deep-dives into
`skill/references/` (`google-docs.md`, `sandbox-troubleshooting.md`)
so the top-level skill stays scannable while details stay one
fetch away.** Stage 5 v2: new global
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

## ⚠️ Pick up here next session (2026-04-26 — pre-compaction breadcrumb)

**Where we are.** Massive 2026-04-26 — Stage 17 deep stack landed +
Stage 19c merged in from a parallel worktree + Stage 21 cert
pre-work confirmed complete. Commit chain on `main`:

- **17a** (canvas primitive) — `631d2b7`
- **17a polish & parity 1-7** (shared `EditorActions` toolbar +
  markdown shortcuts on typing + canvas blockOps + tableOps +
  placeholder foundation) — same commit
- **17a.5 design exploration** (5 directions, F committed inline,
  D shipped) — `257f9a2` (docs), `e10e6af` (D code; visual smoke owed)
- **17b A-D** (ID injection + first-open prompt + sidecar + 7
  agent CLI verbs + pretty-printer with runtime-chrome strip) —
  `717ea99` (A), `e73d4bd` (B), `9d41eed` (C), `6f8ed0d` (D)
- **Doc consolidation** — `557d689` (V1-V15 verification list)
- **Stage 19c merge** — pulled in from worktree
  `worktree-stage-19c-default-claude-tabs` (branch commits
  `79a1753`/`a5054a0`/`efc6462`) → merge commit `cbadc5f`. 6
  conflict files resolved by composing both 17b's canvas additions
  and 19c's new-tab additions in `shared/types.ts`, `main.ts`,
  `socket-server.ts`, `cli/duo.ts`, `cli/duo`, `App.tsx`. UI walk
  on the merged build owed.
- **Cert tracker update** — `7413a54` flips Step 3 + Step 4 to ✅
  in `docs/dev/cert-procurement.md`.

Earlier same-day work (already committed): Stage 5 v2 + 13 + 15.1
+ 15.2 + owner-walk fixes + skill refactor.

**Stage 21 cert pre-work complete.** All five required artifacts
verified on disk + in macOS login keychain:
- Apple Developer Program (individual, dudgeon@gmail.com)
- Bundle ID `com.geoffdudgeon.duo`
- Developer ID Application cert paired with private key —
  `security find-identity -p codesigning -v` returns one valid
  identity: `Developer ID Application: Geoffrey Dudgeon (R39EF29X3Y)`
- App Store Connect API key `~/Documents/duo-private/AuthKey_T8VVN9GF4M.p8`
  (perms 600)
- Team ID `R39EF29X3Y` (visible in cert CN)

Handoff packet (`CSC_NAME`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`,
`APPLE_API_ISSUER`, `APPLE_TEAM_ID`) is in
`~/Documents/duo-private/.env` (gitignored, perms 600). Three
optional follow-ups (.cer/.csr cleanup, .p12 1Password export,
.p8 1Password backup confirmation) still ☐ in tracker but none
blocking.

**Recommended next.** Two strong candidates:

1. **Stage 17c** (canvas just-added highlight + Send → Duo pill on
   canvas + warn-before-overwrite banner). All deps in place: 17a
   primitives, 17b ID injection (so the agent overlay can target by
   `data-duo-id`), Stage 13 yellow-fade primitive (reuse). 17c scope
   per PRD: just-added highlight on agent edits, recentEdits log +
   repaint-at-open within freshness window, `duo selection` for
   canvas (extends Stage 15 union with `kind: 'html-canvas'`),
   persistent blurred selection, Send → Duo pill on canvas surface,
   warn-before-overwrite banner. ~3-4 PRDs of work.

2. **Stage 21** (signed + notarized DMG). Cert pre-work is done;
   remaining work is mechanical: uncomment `mac.identity` +
   `mac.notarize` in `electron-builder.yml` (referencing the env
   vars from `~/Documents/duo-private/.env`); flip
   `dmg.sign: false` → `true`; run `npm run dist`; validate with
   `spctl -a -t open --context context:primary-signature` +
   `stapler validate`. Could be a quick win — half-day if nothing
   misbehaves on the notarytool round-trip.

**Alternatives if a different bottleneck is felt:**
- **Run the V1–V15 verification list** filed in
  `docs/roadmap.html#s17a-polish` § In-depth verification owed.
  V2 (MD toolbar regression after the EditorActions refactor) and
  V14 (full agent CLI sweep) are the highest-risk; V11/V12 verify
  the smart-blank overlay visually.
- **UI walk for 19c** on the merged build (split-button, ⌘T from
  terminal focus → claude, install banner when claude missing,
  `duo new-tab` round-trip).
- **Stage 19b** (passive priming — SessionStart hook + PATH shim;
  folds into Stage 18 installer).
- **Stage 18** (first-launch installer — independent of L0–L2).
- **Stage 14** (track changes — defers cleanly).
- **Stage 15.3** (Send → Duo polish — defers cleanly).
- **17a.5 directions A/E** (templates) — still open design
  questions; owner needs to pick before code work starts.

### Stage 17b (just shipped — code-side, smoke-verified)

PRD: [docs/prd/stage-17-html-canvas.md](docs/prd/stage-17-html-canvas.md).
Polish/parity card: [docs/roadmap.html#s17a-polish](docs/roadmap.html).

**Phase A — ULID + ID injection (PRD H12–H14):**
- `renderer/components/HtmlCanvas/ulid.ts` — 30-LOC Crockford
  base32 generator. 26 chars: 10-char timestamp + 16-char random.
- `idInjector.ts` — TreeWalker body walk; skips text nodes / `<br>`
  / `<hr>` / `data-duo-id="opt-out"`; existing duo-ids preserved;
  `id="…"` never touched. Per-directory choice persistence in
  localStorage (`duo.html.autoInjectIds.byDir`).
- `IdInjectionBanner.tsx` — first-open prompt with candidate count
  + "don't ask again for this folder" checkbox.

**Phase B — sidecar (PRD H22):**
- `sidecar.ts` — typed schema (`SidecarV1`, `SidecarComment`,
  `SidecarRecentEdit`); `version: 1`; `withRecentEdit` caps at 50.
  Read returns `null` on missing/malformed; write atomic via
  files-service.
- CanvasTab reads sidecar on mount; persists alongside `.html` on
  save when sidecar is dirty. Accept-injection appends an
  `inject-ids` recentEdit entry.

**Phase C — agent CLI ops (PRD H37, H38):**
- New `'html-op'` DuoCommandName. Single discriminated request shape
  (`HtmlOpRequest`) routes through one socket command; renderer's
  CanvasTab subscribes via `IPC.CANVAS_HTML_OP`, executes via
  `htmlOps.executeHtmlOp`, replies via `IPC.CANVAS_HTML_OP_RESULT`.
  30s timeout (DOM ops are sub-ms; timeout window only matters when
  no canvas is active).
- All seven verbs: `query / get / set / replace / append / remove /
  attr`. Targeting via `--id <duo-id>` or `--selector <css>`.
  Doc-rooted resolution (so `body` is addressable for append).
- Successful WRITE ops append a `recentEdits` entry with
  `author: 'claude'`, kind matching the op, and the affected
  element's `data-duo-id` when present.
- Smoke verified all seven verbs end-to-end against a fresh canvas.

**Phase D — pretty-printer (PRD H34):**
- `serialize.ts` — 2-space indent, stable attr order
  (id, class, data-duo-id, then alphabetical); inline-only block
  elements → single line; void elements self-close; raw-text
  elements (pre/code/style/textarea/script) preserved verbatim;
  HTML5 doctype emitted lowercase to match authoring convention.
- Runtime-chrome strip via `data-duo-canvas-runtime` sentinel.
  Tagged on body's runtime attrs (contenteditable, spellcheck),
  the body-outline runtime `<style>`, and the placeholder overlay.
  Saved files contain none of this — verified via `cat` after save.
- New `RenderedCanvas.onReady(doc)` callback fires after iframe
  srcdoc parsing completes. CanvasTab uses it to wire iframe-side
  hooks instead of an `[initialHtml]` effect — wiring against an
  empty pre-parse body would have the parser wipe injections.
  `wired` flag in RenderedCanvas makes wire() idempotent so the
  synchronous fallback + the load-event listener can both call it
  without double-firing onReady.
- CanvasTab re-baselines `lastSavedRef` against the pretty-printed
  live DOM after iframe load so canvases don't open dirty against
  the canonical serialized form.

### 17a polish & parity items 1-7 (shipped earlier same day)

Recap (full detail in card `docs/roadmap.html#s17a-polish`):
- **Item 2:** `+` tab-strip → file interstitial; ⌥-click → browser
  tab with address-bar focus.
- **Item 3:** literal `EditorToolbar` reuse via `EditorActions`
  interface (presentational toolbar + `tiptapEditorActions.ts` for
  MD + `canvasEditorActions.ts` for canvas). PRD H28's divergent
  slash-menu approach kept as additive (17e), not a replacement.
- **Item 4:** canvas `blockOps.ts` (execCommand-backed where it
  makes sense; task lists / blockquote / code blocks hand-rolled).
- **Item 5:** native execCommand undo/redo (no custom snapshot
  stack — PRD §8 was scoped to marks, not blocks).
- **Item 6:** canvas `tableOps.ts` (hand-rolled add/del row+col,
  toggle header, delete table, can-X queries).
- **Item 1:** `markdownShortcuts.ts` — typing-time `# / ## / - /
  1. / > / **bold** / _italic_ / --- / \`\`\`` conversions; skips
  inside `<code>/<pre>/<a>` literal contexts.
- **Item 7:** `placeholder.ts` smart-blank overlay foundation
  (upgraded by 17a.5 D below).
- `CanvasToolbar.tsx` deleted (no longer needed).

### 17a.5 Direction D (just shipped — visual smoke owed)

`placeholder.ts` upgraded to a four-door card overlay:
- **[type]** Markdown shortcuts work as you type (active door)
- **[soon]** Component blocks via `/` (slash menu ships in 17e)
- **[soon]** Start from a template (gallery ships in 17a.5
  follow-up; owner needs to commit to direction A/E first)
- **[soon]** Ask the agent to draft this (UI ships in 17f; today
  via `duo html new` + `duo html replace` from a Duo terminal)

Dismisses on first user keystroke OR programmatic real-content
mutation. Marked `data-duo-canvas-runtime` so it never leaks to
disk (verified via `cat` post-save). Visual probe at ship-time
was inconclusive (`duo html query '#duo-canvas-placeholder'`
returned 0 hits) but predates the wire-idempotency fix in
RenderedCanvas — V11/V12 in the verification list capture this.

### Important known limitations / follow-ups

- **V1–V15 verification owed.** A future session should walk
  `docs/roadmap.html#s17a-polish § In-depth verification owed`.
- **17a.5 directions A/E (templates) still open.** Owner needs to
  decide before any code work on a template gallery / registry.
- **BUG-006 (canvas Send → Duo pill occlusion)** doesn't apply on
  the canvas surface (canvas is renderer DOM, not WebContentsView)
  — Stage 17c will reuse the existing primitive cleanly.
- **Pretty-printer "preserve untouched markup" caveat (PRD H34).**
  We re-format the whole tree on every save. First-save diffs
  against a hand-authored .html include whitespace + attr-order
  changes; second save and onward produce stable diffs. Documented
  in `serialize.ts` header.
- **A separate agent is working Stage 19** per the user's note.
  Stage 19's consent sheet folds into Stage 18, so don't pull
  Stage 18 without checking with the other agent's status.

### Stage 17a (just shipped — code-side)

PRD: [docs/prd/stage-17-html-canvas.md § 7 — 17a](docs/prd/stage-17-html-canvas.md).

What landed:
- New `html-canvas` tab type registered in `WorkingPane.tsx`
  (dispatch case mounts `<CanvasTab>`). `shared/types.ts` adds
  `'html-canvas'` to `WorkingTabType` and `'html-new'` to
  `DuoCommandName`.
- New `renderer/components/HtmlCanvas/` package:
  - `RenderedCanvas.tsx` — iframe-srcdoc host. `contentEditable`
    on body + `MutationObserver` on the document. Sandbox attrs
    `allow-same-origin allow-popups allow-forms` only — never
    `allow-scripts` in 17a (PRD H4/H8). Exposes
    `getDocument()` + `serialize()` via `useImperativeHandle`.
    Re-injects on iframe `load` so HMR / re-mounts wire cleanly.
  - `CanvasToolbar.tsx` — Stage 11 visual (top-anchored,
    surface-1 strip, Save button on the right). Buttons:
    bold/italic/underline/strike/inline-code + link picker.
    `onMouseDown` (not click) on the buttons so the iframe
    selection isn't blurred before the action runs.
  - `CanvasTab.tsx` — owns load/save/dirty/autosave state.
    Mirrors `MarkdownEditor.tsx` shape: read on path change,
    diff against `lastSavedRef` for dirty, 800ms autosave
    debounce, ⌘S window listener with host-contains check,
    flush-on-unmount.
  - `inlineMarks.ts` — own selection-aware mark applicator
    (PRD §8 non-negotiable: no `document.execCommand`). Wraps
    via `range.surroundContents`; falls back to
    `extractContents → wrap → insertNode` when the range
    crosses elements; ancestor-toggle to unwrap when the full
    selection sits inside an existing tag.
  - `htmlBoilerplate.ts` — re-exports `shared/html-boilerplate.ts`
    so renderer call sites keep their existing import.
- `shared/html-boilerplate.ts` — H17 minimal v1: `<!doctype>` +
  `<html lang="en">` + `<head>` (charset, title) + `<body>` (h1
  + empty p). Used by both the ⌘N+`.html` commit path
  (renderer) and `duo html new` (main). Tailwind / semantic
  scaffold / locked regions deferred to 17b/d/e per PRD.
- `renderer/components/fileClassifier.ts` — `.html`/`.htm` →
  `{ type: 'html-canvas', mime: 'text/html' }`. Routes
  FileTree clicks + `duo edit/view <path.html>` automatically.
- **⌘N audible (PRD H6.1 dissolved):** `App.tsx §
  onCommitNewFile` now classifies the resolved path's
  extension and updates the tab's `type`/`mime` along with
  `path`/`title`/`isNew`. `.html` paths get a boilerplate
  seed via `htmlBoilerplate` + `encodeUtf8`. The
  `MarkdownEditor`'s `NewFileBar` shows a live suffix label
  (typed extension or `.md` default) so the user sees which
  surface their typed name will mount. `MarkdownEditor`'s
  `handleCommitName` keeps the existing "default `.md` if no
  ext typed" behavior — muscle memory unchanged.
- New CLI verb: `duo html new <path.html> [--title "…"]`. CLI
  side at `cli/duo.ts` validates the `.html`/`.htm` suffix and
  sends `'html-new'` over the socket. `electron/socket-server.ts`
  routes to `nav.htmlNew(path, title)`. `electron/main.ts §
  htmlNew` writes the boilerplate atomically via
  `filesService.write` and dispatches `IPC.NAV_EDIT` so the
  classifier + canvas mount land naturally. `--title` defaults
  to the basename without extension.
- Skill stub at `skill/examples/html-canvas-authoring.md` (H16:
  README only, no snippets yet — the snippet bundle is 17d
  scope). `skill/SKILL.md` verb table updated to mention the
  canvas + `duo html new`. `agents/duo.md` cheat-sheet entry
  added.
- ROADMAP / roadmap.html / Stage 17 PRD all updated. Roadmap
  HTML stage card flipped to `inprog` with 17a struck through;
  next-up tagline now points at 17b.

**17a deferrals — explicit in PRD § 7 + ROADMAP § 17a:**
- Pretty-printed save (H34) → 17b/e. Today: writes
  `<!doctype html>\n` + `documentElement.outerHTML\n` as-is.
  First-save diffs may show whitespace / attribute reordering
  vs the source file.
- Scripts (H8) → 17e. Inline `<script>` and event handlers
  preserved on disk but inert in the canvas.
- `data-duo-id` injection (H12–H15) → 17b. No agent write
  surface yet — `duo html query/get/set/replace/append/attr`
  ship in 17b.
- Send → Duo pill on the canvas (H27) → 17c. The primitive
  already supports the kind: 'html-canvas' branch via the
  `DuoSelection` union (Stage 13 Phase 0); 17c just adds the
  iframe-side selection observer.
- External-write reconciliation (H35) → 17e. No chokidar hook
  yet; external writes during an open buffer get overwritten
  by next save.

**Verification:** typecheck clean, CLI rebuilt, sync:claude
applied. Live walk pending — owner deferred to "after this
batch" (this turn's instruction). Smoke checklist § 7a (Duo
subagent) + Stage 13 + Stage 15 walks all owe a same-machine
end-to-end pass.

### Recommended next: Stage 17b (stable IDs + sidecar + agent write surface)

PRD: [docs/prd/stage-17-html-canvas.md § 7 — 17b](docs/prd/stage-17-html-canvas.md).

Why now: 17a unblocks 17b — the canvas exists, so an agent
can address elements once IDs are in place. 17b is the bigger
unlock per the Stage 17 thesis ("the bottleneck is the
human-edit story" — once Claude can edit specific elements by
ID, the whole agent/human collab loop on HTML lights up).
~2 PRs of work:

- ULID minting + auto-injection of `data-duo-id` on every
  editable body element on first open (H12, H13).
- First-open prompt for ID injection (H14).
- `<file>.duo.json` sidecar reader/writer; `version: 1`
  schema (H22).
- `duo html query / get / set / replace / append / remove /
  attr` end-to-end (H37). Each operates by `data-duo-id` (or
  CSS selector resolved server-side to the nearest
  `data-duo-id` ancestor).
- Pretty-printed serializer (H34) — pull this in here so
  `duo html set` doesn't blow up the diff every time.
- `data-duo-component` recognition (no UI yet — that's 17d).

Risk: `data-duo-id` collisions with existing `id` attributes on
legacy / generated HTML. PRD H12 calls `id` immutable +
additive-only; the H14 prompt is the v1 escape valve.

**Stage 17b is the right next ship**, but Stage 14 / 15.3 / 18
are all reasonable alternatives if something else is the
binding constraint when picking up.

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

### Stage 17a → 17b transition (full detail in the breadcrumb above)

Stage 17a shipped 2026-04-26 night. The "what landed" + "deferrals"
+ "recommended next" detail lives in the breadcrumb section at the
top of this file ("Pick up here next session"). Keeping it in one
place avoids drift.

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
| `skill/SKILL.md` | Claude Code skill (auto-discovered via YAML frontmatter). Top-level prose stays slim — overview + commands + patterns. |
| `skill/references/` | Topic-specific deep dives the skill links into when needed: `google-docs.md` (Docs read fast path + traps + Kix keyboard limitation), `sandbox-troubleshooting.md` (Claude Code sandbox failure shapes + `duo doctor` recipe). Synced to `~/.claude/skills/duo/references/` by `npm run sync:claude`. |
| `skill/examples/` | Worked examples the skill pulls when illustrative; same sync path under `~/.claude/skills/duo/examples/`. |
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

    Plumbing checklist for a new **canvas op** (Stage 17b adds `duo html *`):
    1. `shared/types.ts` — extend the `HtmlOpRequest` discriminated union with the new op shape; add to `HtmlOpResult` if it returns a new shape.
    2. `renderer/components/HtmlCanvas/htmlOps.ts` — add a case in `executeHtmlOp` + a `runX` function that mutates the iframe's contentDocument. Use `resolveTarget` / `resolveAppendTarget` for `--id` / `--selector` resolution.
    3. `cli/duo.ts` — add the subcommand parser inside `case 'html'` (after the existing seven). Reuse the `flagValue` helper.
    4. **No main-process changes needed for new ops** — the routing is generic via the `'html-op'` socket command. Only when adding a non-`html-op` verb (e.g. `duo html allow-scripts` for 17e — toggles a sidecar field, not a DOM op) do you add a new case in `electron/socket-server.ts`.
    5. `skill/SKILL.md` + `agents/duo.md` cheat-sheet entries (mandatory).
    6. CanvasTab automatically appends a `recentEdits` entry for any op that's not `query` / `get` (i.e. ops that mutate). If your new op should NOT generate an edit log entry, add it to the read-only list in CanvasTab's reply handler.

    Plumbing checklist for a new **WorkingPane tab type** (e.g. Stage 17a's `html-canvas`):
    1. `shared/types.ts` — add the value to `WorkingTabType`. Audit any
       discriminated unions that should branch on it (e.g. `DuoSelection`).
    2. `renderer/components/fileClassifier.ts` — map the relevant
       extensions to the new type + mime. This is what wires FileTree
       click + `duo edit` + `duo view` automatically.
    3. `renderer/components/<NewType>/` — host package (tab shell + any
       inner components). Keep it sibling to `editor/` and `HtmlCanvas/`.
    4. `renderer/components/WorkingPane.tsx` — add a dispatch branch
       inside the renderer-pick conditional. Mount with
       `key={tab.id}` so the tab fully re-mounts on path change.
    5. `renderer/App.tsx § onCommitNewFile` — if `⌘N` should be able to
       create files of this type, branch on `classifyFile(path).type`
       and seed appropriate boilerplate. Update `MarkdownEditor`'s
       `NewFileBar` if the suggestion / suffix UX needs adjustment.
    6. CLI surface — if there's an agent-side "create from scratch"
       verb (the analog of `duo html new`), follow the CLI plumbing
       checklist above. Otherwise relying on `duo edit/view` +
       classifyFile is enough.
    7. Skill stub at `skill/examples/<type>-authoring.md` describing
       what the agent can / can't do with the new surface.
    8. PRD update — confirm the deferrals (anything not in v1) have a
       sub-stage home so they don't drift into "TBD."

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
   `skill/examples/*.md`, `skill/references/*.md`, or `agents/duo.md`,
   run:

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
