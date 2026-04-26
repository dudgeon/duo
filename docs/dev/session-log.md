# Session log — Duo

> Historical "what shipped when" detail moved here 2026-04-26 to keep
> CLAUDE.md slim per Claude Code best practices ("Bloated CLAUDE.md
> files cause Claude to ignore your actual instructions"). The
> roadmap (`docs/roadmap.html` canonical, `ROADMAP.md` synced view)
> is the authoritative source for stage status; this file is the
> running session-by-session prose log of what landed, why, and
> what's owed.
>
> **For the current state, read the top of this file** (most recent
> session at the top). For stage status, read `docs/roadmap.html`.
> For the still-open process / intent threads, see
> `docs/dev/intent-pause.md` if it exists.
>
> Older sessions can be pruned freely once the lessons make it into
> ROADMAP / DECISIONS / smoke-checklist.

---

## Current state (as of 2026-04-26)

**Foundation shipped. Flagship half #1 (cozy-mode terminal) shipped
2026-04-22, graduated 2026-04-25 (`(preview)` label dropped).
Flagship half #2 — sub-stage 11a of the markdown editor — shipped
2026-04-24; 11a tail (3 items) and 11b–e next.**

**Latest session (2026-04-26) — Stage 17d-A shipped (shared
`<CommentRail>` primitive + canvas binding + new-comment flow + `duo
html comment` / `comments` CLI verbs). The same primitive will serve
the markdown editor's Stage 11d binding when CriticMarkup ships —
visual layer is editor-agnostic, only the data binding differs. 17a +
17a polish + 17a.5 D + 17b + 17c + 17d-A + 19c merge + Stage 21 cert
pre-work all done in this session.** New canvas-side primitives:
`renderer/components/HtmlCanvas/{justAddedCanvas,blurredSelection,canvasSelection}.ts`;
serializer scrubs `duo-just-added` from saved class lists; new IPC
channel `CANVAS_SELECTION_PUSH` + `getCanvasSelection` on NavBridge;
`socket-server.ts` selection switch extended (`--pane canvas` plus
auto fallthrough chain browser → canvas → editor); CLI accepts
`--pane canvas`; `formatCanvasSendPayload` for all three formats;
`SendToDuoPill` translates iframe-content rect → viewport via
`iframe.getBoundingClientRect()`. Earlier same day: 17a + 17a polish
1-7 + 17a.5 D + 17b A-D + 19c merge + Stage 21 cert pre-work.
**Stage 21 cert pre-work ✅ complete** — all five artifacts verified
on disk + in keychain (`security find-identity` returns one valid
identity; `.p8` at `~/Documents/duo-private/`; Team ID `R39EF29X3Y`,
Key ID `T8VVN9GF4M`). Earlier same day: Stages 5 v2 + 13 + 15.1 +
15.2 + owner-walk fixes + skill refactor. Originally added
`html-canvas` tab type;
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

> **🛑 OWNER PAUSED DEV TO TALK INTENT (2026-04-26 night).** Geoff
> shipped Stage 17d-A and immediately said: "I want to take a pause
> from dev for a bit and talk through a few more intent items." So
> the next post-compaction message will likely NOT be "build the next
> thing" — it'll be a conversation about what to work on, how, or
> why. Read the [Open intent items for the conversation](#open-intent-items-for-the-conversation)
> section near the bottom of this file before responding to the next
> turn so you can engage the conversation with full context. Don't
> jump back into the editor without confirmation.

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
- **17d-A** (comments rail + canvas binding — code-side complete;
  visual smoke V23–V27 owed) — `8c62e70` (code) + `f781586` (docs).
  Pushed to origin/main. Shared `<CommentRail>` primitive + canvas
  binding + new-comment flow + `duo html comment` / `comments`
  CLI verbs. The same primitive serves the markdown editor's Stage
  14 binding when CriticMarkup ships — visual layer is editor-
  agnostic, only the data binding differs.
- **17c** (agent overlay + selection — code-side complete; visual
  smoke owed) — see § 17c below for the full inventory. Touches:
  `renderer/components/HtmlCanvas/{justAddedCanvas,blurredSelection,canvasSelection}.ts`
  (new), `serialize.ts` (scrub `duo-just-added` from `class=""`),
  `CanvasTab.tsx` (banner gating + repaint at open + pill +
  selection observer + new helpers wired into handleReady),
  `RenderedCanvas.tsx` (expose `getIframeElement()` for rect
  translation), `WorkingPane.tsx` (thread `onSendToDuo`),
  `editor/sendFormat.ts` (canvas variant), `shared/types.ts`
  (`CANVAS_SELECTION_PUSH` IPC + `pushSelection` on
  `ElectronCanvasAPI`), `electron/main.ts` (canvas selection cache
  + `getCanvasSelection`), `electron/preload.ts`
  (`canvas.pushSelection`), `electron/socket-server.ts` (selection
  switch extended to `--pane canvas` + auto fallthrough chain
  browser → canvas → editor), `cli/duo.ts` (`--pane canvas`),
  `agents/duo.md` + `skill/SKILL.md` + `docs/CLI-COVERAGE.md`
  (cheat-sheet entries). Typecheck clean; CLI rebuilt; sync:claude
  applied.

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

**Recommended next.** Three strong candidates:

1. **Stage 14** (markdown editor's `<CommentRail>` binding via
   CriticMarkup). The 17d-A shipment landed the editor-agnostic
   `<CommentRail>` primitive specifically shaped to also serve the
   markdown editor — see `primitives/CommentRail.tsx` headers + the
   primitives README. Stage 14 work is the parsing layer
   (`{>>[author · ts] body<<}` round-trip), TipTap mark for the
   in-document anchor decoration, and a `useMemo` adapter from
   parsed comment marks → `CommentThread[]` records. The visual
   layer + the rail UX are already done. ~2–3 PRDs.

2. **Stage 17d-B** (lock convention) and/or **17d-C** (skill snippet
   bundle). Both small. 17d-B: `data-duo-lock="structure"` rendering
   (subtle dashed outline on hover; tooltip "Structural element —
   text editable; layout locked") + ⌥-click override (PRD H19).
   17d-C: ship the H17 boilerplate + H18 ten-snippet bundle in
   `skill/examples/html-canvas-authoring.md` so Claude recognizes
   Duo-shape components when authoring.

3. **Stage 21** (signed + notarized DMG). Cert pre-work is done;
   remaining work is mechanical: uncomment `mac.identity` +
   `mac.notarize` in `electron-builder.yml` (referencing the env
   vars from `~/Documents/duo-private/.env`); flip
   `dmg.sign: false` → `true`; run `npm run dist`; validate with
   `spctl -a -t open --context context:primary-signature` +
   `stapler validate`. Could be a quick win — half-day if nothing
   misbehaves on the notarytool round-trip.

**Alternatives if a different bottleneck is felt:**
- **Run the V1–V22 verification list** filed in
  `docs/roadmap.html#s17a-polish` § In-depth verification owed.
  V2 (MD toolbar regression after the EditorActions refactor),
  V14 (full agent CLI sweep), V20 (CSS Custom Highlight Registry),
  V22 (warn-before-overwrite banner) are the highest-risk;
  V11/V12 verify the smart-blank overlay visually; V16-V19/V21
  cover the Stage 17c canvas-side wash + selection observer +
  Send → Duo pill.
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

## Open intent items for the conversation

Owner paused dev after 17d-A landed to talk intent. These are the
threads I noticed while shipping recent stages — surfacing them
explicitly so the next conversation has them at hand, not so I
push agendas. Triage as the user wants. Anything starred (★) is
something the user explicitly flagged earlier that I haven't yet
closed out.

**Sequencing / what to ship next**
- **Stage 14 vs. Stage 17d-B/C vs. Stage 21 vs. defer-and-talk.** All
  three are reasonable next ships per the breadcrumb. Stage 14 has
  the most leverage now that the rail primitive is in place; 17d-B
  + 17d-C are small but their value lights up only when the snippet
  bundle (17d-C) lands first; Stage 21 is mechanical but ships
  distribution. The intent question: which of these maps to a
  Trailblazer milestone the user is aiming at? If 17d-A was "the
  collab loop closes for canvas," then Stage 14 is "same loop for
  markdown" — does that shape the user's calendar?
- **★ Stage 11 tail items.** Frontmatter properties panel, drag-drop
  images, slash menu, floating selection bubble — all defer cleanly,
  none have been pulled in. The original Stage 11 PRD assumed they'd
  ship with 11a; they didn't. Are any worth pulling forward, or is
  this a "ship 14 + 17 first, polish 11 once the editor sees real
  use" call?
- **★ Stage 17a.5 directions A and E** (curated starter templates +
  user-defined template registry). Owner committed direction F
  (markdown shortcuts on typing) and direction D (smart-blank
  overlay). A and E are still open design questions blocking code
  work on a template gallery / registry. The Backlog template-
  loader card is already filed at
  `docs/roadmap.html#backlog-templates` with v1 location +
  agent-CLI shape proposed.

**Ergonomic / process loose ends**
- **Visual verification owed on V1–V27.** That's a lot of unwalked
  smoke. Most of it requires the Duo app running, which it usually
  isn't during my sessions. Worth scheduling a dedicated
  "verification afternoon" against the V1–V27 list before the next
  major ship?
- **★ The 19c UI walk on the merged build.** Split-button, ⌘T from
  terminal focus → claude, install banner when claude missing,
  `duo new-tab` round-trip — never been eyes-on-verified post-merge.
  Folds into the verification afternoon.
- **★ FOLLOWUP-002** (`tasks.md`): the C5 outside-Duo guard for the
  duo subagent has a corner case where a narrow Bash allowlist
  permission-denies the guard check, which causes the agent to
  proceed instead of refusing. Hardening idea: refuse-on-check-denied
  in the agent prompt.
- **★ FOLLOWUP-003** (`tasks.md`): the Stage 5 v2 PRD's "~85% token
  reduction" hypothesis didn't survive synthetic measurement. The
  agent's value is real but different (bounded context per task,
  specialized prompt, clear contract) — worth re-framing in the PRD
  so future readers don't expect cold-cache cost wins.
- **★ FOLLOWUP-004**: visual pill rendering verification (Stage
  15.2 + 17c) is gated on computer-use access which has been
  deferred all session.

**Architecture / direction**
- **The "common componentry" insight from 17d-A.** Having the
  `<CommentRail>` primitive shipped with both the canvas binding
  AND a documented MD reuse story makes Stage 14 meaningfully
  shorter. Are there other places this pattern ("ship the visual
  primitive with one binding; future bindings cost much less")
  deserves an explicit pass? Stage 14's track-changes primitives
  (`<TrackedRangeMark>`, `<AcceptAllBanner>`) are the obvious next
  ones; the comment-anchor logic in markdown will be very similar
  to canvas's `commentAnchors.ts` — consider refactoring the
  doc-order anchor sort + reconciliation pattern into a tiny
  shared util when 14a lands.
- **Sidecar schema versioning.** 17d-A added the additive
  `resolvedThreads` field; the schema is `version: 1` and we're
  silently extending. The current `isValidSidecar` only checks
  `version === 1`, not field shape. Worth a v2 bump + migration
  pass when the next breaking change arrives — the open question
  is which change crosses that line. Track changes in the sidecar
  (Stage 17 v2)? Comment threading semantics? Per-comment resolved
  state vs. per-thread? Worth a brief design pass.
- **The `data-duo-component` recognition layer is unimplemented.**
  17b shipped the attribute injection but no UI / agent flow
  reads it back. PRD H18 + 17d-C rely on this to teach Claude its
  own snippets; until the recognition flow exists, snippets are
  one-way. Is this the right time to design the read path, or
  defer to when the agent-snippet pattern is in real use?

**Distribution shape**
- **Trailblazers cohort timing.** Owner pre-work for Stage 21 is
  done. The mechanical sign + notarize is a half-day. The
  consent-sheet + installer (Stage 18) is independent. Which lands
  first for the cohort?
- **Auth on the Unix socket.** Stage 21 has the launch-time-token
  bullet; the Trailblazer ergonomics shift in interesting ways
  once the socket is auth'd (the agent has to learn about the
  token; today's "just send to the path" simplicity goes away).
  Worth thinking about before 21d ships.

### Stage 17d-A (just shipped — code-side, visual smoke owed)

PRD: [docs/prd/stage-17-html-canvas.md § 7 — 17d](docs/prd/stage-17-html-canvas.md).
Verification list: V23–V27 in
[docs/roadmap.html#s17a-polish](docs/roadmap.html).

**What landed:**

- `renderer/components/editor/primitives/CommentRail.tsx` — pure
  visual primitive (no editor imports, no IPC, no surface
  assumptions). Props: `threads: CommentThread[] | null`,
  `activeThreadId`, `onJumpTo`, `onReply`, `onResolve`, `onReopen`.
  The same primitive will serve the markdown editor's Stage 14
  binding when CriticMarkup ships — only the data binding differs.
- `renderer/components/HtmlCanvas/commentAnchors.ts` — paints
  numbered `<span class="duo-comment-anchor">` badges into the
  iframe body next to anchored elements. Reconciles on every
  render (idempotent). Badges carry `data-duo-canvas-runtime`
  sentinel so serializer scrubs them; never persist to disk.
  `buildThreads(doc, sidecar)` groups comments by anchorId and
  sorts in document order. `scrollToAnchor(doc, threadId)` is the
  rail's onJumpTo target.
- `renderer/components/HtmlCanvas/sidecar.ts` — `SidecarV1`
  extended with additive `resolvedThreads?: Record<anchorId, {ts,
  by}>`. New mutators: `withComment`, `withResolvedThread`,
  `withReopenedThread` (pure; caller persists).
- `CanvasTab.tsx` — mounts `<CommentRail>` to the right of the
  iframe (~280px panel); "💬 Comment" button pairs with the Send
  → Duo pill on selections that have a live `data-duo-id` ancestor;
  `<NewCommentComposer>` popover for new threads (⌘+Enter submits,
  Escape cancels); active thread state syncs both ways (anchor
  badge ↔ rail card).
- CLI: `duo html comment --id|--selector|--text --body "…"`
  (anchor resolves to nearest `data-duo-id` ancestor; body via
  flag or stdin); `duo html comments [--filter all|open|resolved]`.
- Plumbing: new IPC channels `CANVAS_HTML_COMMENT[_RESULT]` +
  `CANVAS_HTML_COMMENTS_LIST[_RESULT]`; `HtmlCommentRequest /
  Result / HtmlCommentsListRequest / Result / HtmlCommentThread /
  HtmlCommentEntry` types in `shared/types.ts`; `onHtmlComment` /
  `onHtmlCommentsList` on `ElectronCanvasAPI`; `dispatchHtmlComment`
  + `dispatchHtmlCommentsList` in main.ts (30s timeout, mirrors
  dispatchHtmlOp); NavBridge entries; socket-server cases
  `'html-comment'` + `'html-comments'`.
- Atelier styling in `globals.css` — paper-deep panel, accent
  number chips, dashed-resolved variants for the rail; runtime-
  badge styling for the in-body anchor chips.
- Skill / agent / coverage docs all updated.

**Visual smoke owed.** V23–V27 cover new-comment flow, rail
interactions, agent CLI ops, comments listing, and (most
importantly) V27 — confirming comment chrome doesn't leak to
disk. V27 is load-bearing for the canvas's "saved file is just
HTML" guarantee.

### Stage 17c (just shipped — code-side, visual smoke owed)

PRD: [docs/prd/stage-17-html-canvas.md § 7 — 17c](docs/prd/stage-17-html-canvas.md).
Verification list: V16–V22 in
[docs/roadmap.html#s17a-polish](docs/roadmap.html).

**What landed:**
- `justAddedCanvas.ts` — canvas-side binding for the
  `duo-just-added` keyframe. `installJustAddedStyles(doc)` injects
  the keyframe + class into the iframe stylesheet (parent's
  `globals.css` doesn't reach iframe documents). `markJustAdded(el)`
  paints the class for `HIGHLIGHT_MS = 6000` then strips. Marked
  with `data-duo-canvas-runtime` sentinel so the existing
  serializer-strip pass keeps the runtime style out of saved HTML.
- `serialize.ts § scrubClassValue` — strips `duo-just-added` from
  every element's `class=""` during serialization. Defends against
  the wash class racing the autosave: even if the 6s fade hasn't
  completed by the time autosave fires, the serializer drops the
  runtime class so the on-disk file stays canonical.
- `blurredSelection.ts` — installs body-focus/blur listeners and
  mirrors selection state into a CSS Custom Highlight named
  `duo-blurred-selection`. Highlight Registry API (Chromium 105+)
  paints presentation-only — no DOM mutation, so the dirty path
  doesn't fire on focus toggles. Stylesheet for
  `::highlight(duo-blurred-selection)` injected with the runtime
  sentinel. Window-level focus/blur listeners catch the case where
  the iframe loses focus to the parent renderer (clicking the
  terminal) without firing a body blur.
- `canvasSelection.ts` — `installCanvasSelection({doc, path,
  onPush, onRect})`. Computes the H25 union shape:
  `{kind:'html-canvas', path, text, html, anchorId, anchorPath,
  range, surrounding}`. Anchor = nearest `data-duo-id` ancestor;
  anchorPath = trail of ancestor duo-ids outermost-first; range =
  `{startOffset, endOffset, textPath}` only for selections inside
  a single text node within an anchored element; surrounding =
  enclosing block's textContent up to 1000 chars; html =
  `cloneContents()` outerHTML for non-collapsed selections.
  `onRect` fires the bounding rect in iframe-content viewport
  coordinates only when body has DOM focus (mirrors editor's
  `editor.isFocused` gate); pill is hidden otherwise.
- `RenderedCanvas.tsx` — added `getIframeElement()` to the
  imperative handle so CanvasTab can translate iframe-content rect
  → parent-renderer viewport rect by adding the iframe's own
  `getBoundingClientRect()` top/left.
- `CanvasTab.tsx` — `handleReady` now also installs
  `installJustAddedStyles`, `installBlurredSelection`,
  `installCanvasSelection`, and runs `repaintRecentClaudeEdits`
  (reads sidecar's `recentEdits[]`, paints anchored elements
  authored by 'claude' within the freshness window, idempotent
  per anchorId per pass). New state: `pillRect`,
  `lastCanvasSelectionRef`, `selectionFormat` (via existing
  `useSelectionFormat`), `pendingHtmlOp` (for the warn-before-
  overwrite gate). The html-op handler now (a) for read ops:
  applies immediately; (b) for write ops + dirty buffer: queues
  the request + surfaces `<WriteWarningBanner>`; (c) for write
  ops + clean buffer: applies immediately. On successful write
  ops the affected element (`result.id`) gets `markJustAdded`
  (skipped for `remove` since the element is gone). Pending
  banner concurrency: second write while a banner is up returns
  `"Another write is awaiting the user's decision."`.
- `editor/sendFormat.ts` — `formatCanvasSendPayload(snap, format)`
  for all three formats. Format A's provenance line uses
  `~/path · <anchorPath joined ' > '>` instead of the markdown
  editor's heading trail (anchor IDs are the canonical addressing
  primitive on canvas). Reuses `formatC()` (opaque token) verbatim.
- `WorkingPane.tsx` — threads `onSendToDuo` to CanvasTab (was
  accepted-but-unused before).
- `shared/types.ts` — new `CANVAS_SELECTION_PUSH` IPC channel;
  `pushSelection` added to `ElectronCanvasAPI`.
- `electron/main.ts` — `canvasSelection` cache + ipcMain handler;
  `getCanvasSelection()` exported and passed to NavBridge.
- `electron/preload.ts` — `canvas.pushSelection(snapshot)` exposed.
- `electron/socket-server.ts` — `NavBridge.getCanvasSelection`
  added; selection switch accepts `--pane canvas` and the auto
  branch falls through browser → canvas → editor (canvas inserts
  between browser and editor).
- `cli/duo.ts` — `--pane canvas` validation + help text update.
  Binary rebuilt via `npm run build:cli` (29.4KB).
- `skill/SKILL.md`, `agents/duo.md`, `docs/CLI-COVERAGE.md` —
  cheat-sheet entries updated for the canvas branch + auto
  fallthrough order. `npm run sync:claude` applied so Claude Code
  picks up the new info on next skill / agent lookup.

**Visual smoke owed.** The Duo app wasn't running during this
session, so the V16–V22 walk is owed for a future session with the
app open. Per CLAUDE.md `npm run dev` rules, we couldn't actually
see the canvas paint or click the pill — the typecheck pass + CLI
rebuild + sync:claude prove the wiring compiles + the CLI surface
declares correctly, but the visual layer (just-added wash, pill
position, banner copy) needs eyes-on confirmation.

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
