# Releases — Duo

> Prose companion to [`CHANGELOG.md`](../CHANGELOG.md). The
> changelog is the one-line inventory; this file is the *why* — the
> design context, constraints, what almost-shipped, and the
> reasoning behind cut-or-don't-cut decisions. Aimed at future
> maintainers (including future Claude instances) who need the
> backstory to make sense of a version.
>
> **Most recent release at the top.** Each entry: title, date, a
> short prose section, then a "What this is and isn't" paragraph
> framing the version against what came before and what's queued
> next.
>
> **Pending — not yet cut** (the stash at the top) accumulates
> draft notes when a proposed cut is rejected on substance grounds
> (the litmus test). Notes here roll forward into the next cut
> proposal.

---

## Pending — not yet cut

_Empty. v0.3.1 below picked up the bug + small-enhancement pile
that surfaced during the v0.3.0 cut smoke walk._

---

## v0.3.1 — 2026-04-26

The cleanup sprint. Eight items in one cut: three regressions
fixed, three enhancements paired cleanly, two filed-but-stalled
bugs from prior cycles closed. No big architectural strokes —
this version is the housekeeping after v0.3.0's surface area
expansion.

### Why v0.3.1 lands here

The v0.3.0 cut surfaced six new bugs / enhancement requests during
its smoke walk (BUG-015/016/017, MISSING-001, ENH-001/002), plus
two pre-existing filed bugs from prior cycles (BUG-005, BUG-007)
that fit the same "small, surgical, well-scoped" shape. The owner
also flagged ENH-003 (default-pin "What Duo Does" alongside the
FAQ) and proposed pairing ENH-001 with a default-canvas-boilerplate
upgrade (ENH-004). Eight tractable items, all <~150 LOC each,
mostly one or two files per item. Cutting them as v0.3.1 keeps
the pile from rolling into v0.4.0's larger surface (Stage 14a
markdown comments, Stage 18b distro skill packs, Stage 21
sign + notarize).

MISSING-001 (markdown-editor comments) deferred — Stage 14a's
home, v0.4.0 territory.

### Key design decisions baked in

- **Default canvas boilerplate carries IDs + Atelier defaults** (ENH-001 + ENH-004 paired).  
  `shared/html-boilerplate.ts` v1 was 12 lines of bare HTML5; v0.3.1 makes it ~110 lines of "useful defaults out of the box": ULID stamps on body/h1/p (so the first-open ID-injection prompt is unnecessary), inline CSS variables for the Atelier palette + dark-mode media query, body width cap, viewport meta, and a small HTML comment explaining the file's provenance for an agent reading via `duo html get`. The styles are intentionally local + user-editable — they're a starting hint, not a contract. The "no Duo chrome leaks" property still holds: nothing in the boilerplate is runtime-only chrome (no `data-duo-canvas-runtime` attributes; just plain author CSS that lives in the saved file). Stage 17 PRD H17's "full" version (Tailwind via CDN behind script-opt-in, semantic header/main/footer pre-marked locked) is still 17b/17e scope; this is the smaller middle ground. To support write-time ULID minting from main, `ulid.ts` relocated from `renderer/components/HtmlCanvas/` to `shared/`; the renderer-side import path moved to `@shared/ulid`.

- **Paste-as-plain-text + paste-handler scrub, paired** (ENH-002 + BUG-016). `⌘⇧V` / `⌃⇧V` is the macOS standard for "Paste and Match Style"; both editors now wire it via local keydown handlers (not the global registry — these are editor-local shortcuts). For the canvas: a new `installCanvasPasteHandlers` listener intercepts the regular `paste` event too, scrubbing inline `style="color: …"` / `style="background: …"` and any `class` attributes from pasted HTML. That single change fixes BUG-016 (dark-mode pasted bold rendering as dark-brown-on-dark-brown because the source kept its inline color) AND lets users keep using regular ⌘V without losing structural styles (margins, font-size, etc. stay intact — only color and class are stripped). Markdown editor's TipTap branch uses `editor.commands.insertContent(text)` after `navigator.clipboard.readText()` for plain-text paste; the regular `paste` handler is left to TipTap's own HTML-to-markdown sanitizer. An Edit menu surface for "Paste and Match Style" is on the v0.4.0 backlog if discoverability becomes an issue; for v0.3.1 the keyboard chord is enough.

- **Theme `system` mode, fixed at the right layer** (BUG-017). Root cause: `nativeTheme.themeSource = 'light'` hardcoded at boot in `electron/main.ts`. Comment claimed it "only governed native chrome" — incorrect. Per Electron docs, `themeSource` ALSO drives the renderer's `prefers-color-scheme` media query result. So the renderer's `useTheme` hook saw `prefers-color-scheme: light` regardless of the OS setting, and 'system' mode never escaped light. The fix: the renderer's existing `IPC.THEME_STATE_PUSH` (which already syncs `themeState` for `duo theme`) now ALSO updates `nativeTheme.themeSource` to match. Boot still defaults to `'light'` so the splash + first paint match Atelier; the renderer's mode push runs immediately after mount. Brief one-frame flash on first launch in 'system' mode + dark OS — light first paint, then dark when the matchMedia change event fires post-push. Acceptable; pre-mount IPC is a future refinement.

- **Filesystem watcher subscription wired up** (BUG-007). The chokidar pipeline on the main side already emitted `unlink` / `unlinkDir` events correctly. The renderer just never subscribed. `useNavigator` now installs `electron.files.watch([cwd, ...expanded])` and refreshes the parent directory's cached listing on every event. Subscription is torn down + re-created when the expanded set changes — chokidar startup is sub-ms, so the cost is negligible and the alternative (`updateWatchPaths` with id-tracking) would have required API surface changes. Caller is responsible for refreshing the listing-cache parent path; the `setListings` reducer already handles incremental updates.

- **Default pins via install bootstrap** (ENH-003). `~/.claude/duo/pins.json` is bootstrapped with `{kind: 'browser', ref: <faq URL>, …}` and `<wdd URL>` on first install, only if absent (never clobbers a user's edited pin set). For pin URLs to MATCH the default-landing URL, `BrowserManager.defaultLandingUrl` now prefers the user-installed `~/.claude/duo/help/<file>` over the bundle path — so when the user opens FAQ, the strip renders it with the pin glyph. Until Stage 21c session-restore-from-pins lands, the auto-restore-on-launch behavior is not part of this change; pins surface only when the user actually opens the relevant tabs.

- **`duo key` Mac-native translation** (BUG-005). Pure CLI-side fix — agents using cross-platform keybind muscle memory (`Cmd+End` to jump to document end, etc.) no longer trigger Electron's application-menu chrome. The `duo key` parser detects darwin + `Cmd|Meta` modifiers and translates: `End` → `ArrowDown`, `Home` → `ArrowUp`, `PageDown`/`PageUp` drop the `Cmd` modifier entirely. Wire format unchanged — main sees what main always saw. 9/9 standalone test cases pass; non-darwin platforms unaffected.

- **Comment rail no-empty-state** (BUG-015). One-line conditional in `CanvasTab.tsx`: `railThreads.length > 0`. The empty-rail-occupies-space behavior had been there since 17d-A shipped because the "first comment lands" path was a higher priority than the cosmetic empty case.

### What v0.3.1 is and isn't

**Is:** the cleanup release. Every regression filed during v0.3.0
smoke is closed; the small-enhancement pile is folded in;
default new-canvas creation produces something the user can
read in dark mode without first deleting the prompt; pasted
text from the web doesn't break dark-mode contrast; theme
toggle "system" actually means "system" again.

**Isn't:** the markdown-comments release (Stage 14a — MISSING-001's
home — is v0.4.0 territory). Doesn't ship Stage 18b distro
skill packs, Stage 21 sign + notarize, Stage 19d mid-tab
launch-claude banner, Stage 25 post-redirect chrome banner.
Doesn't yet auto-restore browser tabs across launches (Stage
21c session restore — still queued).

### What's queued next (v0.4.0 candidate scope)

- **Stage 14a** — markdown CommentRail binding (closes MISSING-001).
- **Stage 18b** — distro skill packs (`extra-skills/` + `PACK.json` + per-conflict consent UI).
- **Stage 25** — post-redirect chrome banner.
- **Stage 19d** — mid-tab launch-claude banner.
- **Stage 21** — sign + notarize DMG.
- **Stage 21c** — session restore from pins.

---

## v0.3.0 — 2026-04-26

The Duo-aware-Claude release. Where v0.2.0 was the first release a
Trailblazer could install in one click, v0.3.0 is the first release
where every Claude session inside Duo arrives already aware of the
workspace it's running inside — and where the chronic keyboard-
shortcut regression family that's plagued every prior cut becomes
structurally impossible.

### Why v0.3.0 lands here

Three coherent strands closed together. Stage 19b — passive priming —
was owner-flagged as the v0.3.0 priority. Stage 23 — canvas actions
— closed the FTUX trio (Stages 18 + 24 + 23) the previous release
left dangling. The kb-shortcut preventative architecture wasn't
planned for this version, but a smoke walk surfaced BUG-012/013/014
(canvas iframe + TipTap swallowing global shortcuts) — a third
generation of the regression family that produced BUG-001 (xterm
⌃Tab) and BUG-008 (xterm ⌘T). The owner's diagnosis — *"your fixes
are detective controls, not preventative"* — drove the design:
invert the default so global shortcuts work in every surface
**unless** the surface explicitly opts out, instead of broken
unless explicitly wired. That structural fix can't ship in a patch
release and is the headline.

### Key design decisions baked in

- **Two priming mechanisms, shim load-bearing** (Stage 19b D6/D12-D14).
  PRD spec called for `SessionStart` hook (primary) + PATH-shim
  (secondary) wrapping `claude` with `--append-system-prompt`. Owner
  reframed as *"we cannot rely on hooks"* — Claude Code session
  hooks aren't always reliable (users disable them, settings.json
  gets reset, certain CLI flags skip them), so the shim is the
  load-bearing path and the hook is redundancy. Both reference the
  same source-of-truth `priming.md` at `~/.claude/duo/priming.md`.
  Real-claude path resolved via login-shell at install time and
  inlined into the shim. PRD spec assumed a `--append-system-prompt-file`
  flag that doesn't exist; the shim uses `"$(cat priming.md)"`
  command-substitution instead, which passes the file as a single
  argv (no shell re-parse, safe for embedded quotes / dollar signs).
- **Canvas actions: 3-verb vocabulary, path-restricted trust** (Stage 23).
  `data-duo-action="claude:spawn|terminal:send|browser:open"` with
  per-verb `data-*` siblings carrying args. v1 trust roots:
  `~/.claude/duo/` only. User-marked-trusted folders deferred. The
  iframe sandbox is `allow-same-origin allow-popups allow-forms` —
  no `allow-scripts` (PRD H4) — so dispatch is renderer-side: the
  parent React tree intercepts the click via a delegated capture-
  phase listener on the iframe doc. As a bonus the trust gate has
  a natural choke point. Action elements can be any tag; modifier-
  clicks pass through unchanged. `duo send --enter` flag pairs with
  `data-enter="true"` for the bidirectional Claude↔HTML loop pattern.
- **Preventative kb-shortcut architecture** (in response to BUG-012/013/014).
  Single typed registry (`renderer/keyboard/globalShortcuts.ts`)
  defines the entire shortcut vocabulary. Three escape patterns
  per surface kind: capture-phase document listener (in-doc surfaces
  inherit the matcher for free), `installGlobalShortcutForwarder`
  utility (iframe doc → resyntehsizes on parent), and "consult the
  matcher in the surface's existing native escape hook" (xterm's
  `attachCustomKeyEventHandler`, WebContentsView's
  `before-input-event`). Adding a row to the registry gives every
  surface that follows one of the three patterns automatic coverage.
  Adding a new surface that follows one of the patterns inherits
  every shortcut. Quadratic coverage at linear effort. The smoke-
  checklist matrix (now with a Canvas column) and CLAUDE.md
  plumbing-checklist update are the second line of defense; the
  architecture is the first.
- **BUG-010 fix: prompt-tail regex replaces "first PTY data"** —
  `waitForPtyReady` now strips ANSI/CSI/OSC escapes from the
  iframe's accumulated output and matches a tail regex
  (`/[$%#❯>›→]\s*$/`) against the visible last 160 chars. 14/14
  standalone test cases pass (bash, zsh, conda+zsh, root, starship,
  fish, ANSI-colored prompts, OSC 0 title-bar prompts; correctly
  ignores OSC 133 marks, alt-screen toggles, cursor-position
  queries, mid-startup rc output). The cosmetic claude echo from
  v0.2.0 is gone.
- **GitHub Releases DMG distribution** — v0.2.0 backfilled to
  `https://github.com/dudgeon/duo/releases/v0.2.0`; the cut-version
  skill grew Step 6.5 to attach DMG(s) to a release on every cut.
  README points at `releases/latest/download/Duo-<v>-arm64.dmg`
  (Apple Silicon) and `Duo-<v>.dmg` (Intel) so end users no longer
  need to clone + build. Unsigned until Stage 21 lands; release
  notes call out the Gatekeeper right-click → Open dance.

### What v0.3.0 is and isn't

**Is:** the first release where a fresh Claude Code session inside
Duo arrives already aware of `duo` verbs without the user typing
anything; where canvas pages can drive the workspace (open Claude
tabs, type into the active terminal, navigate the embedded browser);
where downloading a DMG from GitHub Releases is the recommended
install path; and where the keyboard-shortcut regression family
that produced BUG-001 / BUG-008 / BUG-012/013/014 is structurally
prevented at every existing surface and (by adoption pattern) every
future one.

**Isn't:** signed (Stage 21 still). Doesn't address the smaller bug
+ enhancement pile that surfaced during the v0.3.0 smoke walk —
BUG-015 (canvas comment rail rendering with no comments), BUG-016
(dark-mode pasted-bold contrast), BUG-017 (theme "system" mode not
following macOS), MISSING-001 (markdown editor lacks comments —
Stage 14a's home), ENH-001 (default stable IDs for new HTML
canvases — agent-generated content shouldn't trigger the prompt),
ENH-002 (paste as plain text + ⌘⇧V across editors). All filed in
`tasks.md` and queued for v0.3.1.

### What's queued next (v0.3.1 / v0.4.0 candidate scope)

**Bug + small-enhancement pass (probably v0.3.1):**

- BUG-015 — gate `<CommentRail>` render on `threads.length > 0`.
  Trivial.
- BUG-016 — paste handler scrubs inline `style="color: …"` from
  pasted nodes; pairs with ENH-002.
- BUG-017 — theme service should subscribe to
  `matchMedia('(prefers-color-scheme: dark)').addEventListener`.
- ENH-001 — `duo html new` writes a sidecar with `idChoice: 'always'`
  so Duo-authored canvases don't trigger the first-open prompt.
- ENH-002 — Edit menu "Paste and Match Style" + ⌘⇧V; both editors
  read `text/plain` from clipboard.

**Stage cluster (probably v0.4.0):**

- Stage 14a — markdown CommentRail binding (closes MISSING-001).
- Stage 18b — distro skill packs (`extra-skills/` + `PACK.json` +
  per-conflict consent UI).
- Stage 25 — post-redirect chrome banner.
- Stage 19d — mid-tab launch-claude banner.
- Stage 21 — sign + notarize DMG.

---

## v0.2.0 — 2026-04-26

The FTUX foundation. v0.1.0 was the inaugural inventory snapshot;
v0.2.0 is the first release where a Trailblazer could actually pick
up Duo and use it without a developer hand-holding them through
manual filesystem setup.

### Why v0.2.0 lands here

The proposal-and-defer cycle on this version is itself instructive.
A v0.2.0 cut was first proposed after three coherent post-v0.1.0
commits (faq.html landing, BUG-009 fix, duo-editable honoring) and
the owner deferred with "this is not a release yet — keep building."
That recalibrated the cut-version skill's bar (the project's not
ready to cut every three commits — needs "a chapter has ended").
Stage 24 (pin tabs) + the BUG-008 squash + Stage 18 Phase 2 (CLI
binary on PATH) closed that chapter — the FTUX foundation is now a
single coherent surface a new user can land on.

### Key design decisions baked in

- **`~/.local/bin/duo` for the CLI install path** (Stage 18 Phase 2). No sudo required, conventional XDG-style location, sandbox-friendly. Trade-off: macOS zsh doesn't have it on PATH by default, so the install banner surfaces a one-liner (`export PATH="$HOME/.local/bin:$PATH"`) when we detect the gap. Avoided `/usr/local/bin/duo` to keep the install surface non-privileged.
- **`⌘T` flipped from pane-aware to universal browser-tab** (BUG-008 resolution). Stage 19c had specced `⌘T` from terminal focus → claude tab, on the theory that a non-technical PM in a shell would discover Claude faster. The owner's call: universal mental-model wins, discovery affordance lives on the `+` button instead. `⌘⇧T` becomes the keyboard chord for Claude tabs.
- **Two declarative routing metas (`duo-open-in`, `duo-editable`)** instead of an in-app config / file-naming convention. A reference HTML carries its own routing intent, no central registry. The file-open dispatcher does a 4KB head-read pre-flight to honor `duo-open-in`; the canvas mounts read with `contentEditable` off when `duo-editable=false`. Both extensible to user-authored docs (e.g. an in-team SOP marked `duo-editable=false` so accidental edits don't happen).
- **`waitForPtyReady` helper** (BUG-009 fix) replaces `queueMicrotask`. Resolves on the new tab's first PTY data event (= shell emitted SOMETHING, plausibly PS1) plus a 30ms paint settle. The cosmetic residual (BUG-010, filed) is that the shell can emit something BEFORE PS1 — e.g. terminal-init escape codes — tripping the helper early. Functional fix is real; visual polish owed.
- **Pin storage at `~/.claude/duo/pins.json`** with file-tabs identified by absolute path and browser-tabs by URL. Atomic tmp+rename writes. Foundation for Stage 18b's `PACK.json § pins` distro pre-pins (next stage) and Stage 21c's session-restore highest-priority entries.

### What v0.2.0 is and isn't

**Is:** the first release where a fresh `Duo.app` install gets a
Trailblazer to a working state in one click. Welcome banner
installs the skill / subagent / help-files into `~/.claude/` and the
`duo` CLI binary into `~/.local/bin/`. Default browser landing is the
FAQ instead of about:blank. Pin support means a reference HTML can
stay leftmost across sessions.

**Isn't:** distribution-ready. The DMG is unsigned (Stage 21
deferred); there's no GitHub Releases publish step (manual hand-off
only); no auto-update channel; no distro-supplied skill packs (Stage
18b deferred). The V2–V27 canvas verification walk inherited from
v0.1.0 still owed in eyes-on form.

### What's queued next (v0.3.0 candidate scope)

**🔖 Owner-flagged priority:** **Stage 19b** at the top.

- **Stage 19b — passive priming (PRIORITY).** SessionStart hook + PATH shim + `priming.md` in `~/.claude/`. The remaining piece of the Stage 19 family: when a Claude Code session starts inside a Duo PTY, hand it Duo-specific priming (skill discovery hints, `duo` CLI on PATH already, ambient context) so the agent doesn't need to be told "you're in Duo." Originally specced to fold into the Stage 18 installer; keeping it 19b keeps the flag visible.
- **Stage 18b** — distro skill packs (`extra-skills/` + `PACK.json` + per-conflict consent UI). Cap One AIP starter pack is the worked example.
- **Stage 23** — canvas actions (`data-duo-action` Claude↔HTML loop). Pairs with 18b for the FTUX welcome page.
- **Stage 25** — post-redirect chrome banner (small, ~80 LOC).
- **Stage 19d** — mid-tab launch-claude banner (small, for shell-tab discovery).
- **BUG-010** — replace `waitForPtyReady`'s "first data" trigger with a prompt-shape regex.
- **V2–V27 verification walk** — still owed from v0.1.0; Stage 18 + 24 + BUG-008/009 walked PASS in v0.2.0 smoke.

---

## v0.1.0 — 2026-04-26

The inaugural release. The bar for "should this exist as a labelled
version?" was not "is it stable" or "does it have users" — neither
applies pre-distribution. The bar was: **does the code base have
enough internal coherence that a labelled snapshot would be useful
to refer back to?** It does. The foundation layer (Stages 1–3, 5,
8, 9), the editor surfaces (11a, 12 phases 1–3, 13, 17a + polish +
b + c + d-A), the agent CLI (Stage 3 + 17 verbs), the subagent
(Stage 5 v2), and the agent-detection signals (19a + 19c) all hang
together. v0.1.0 freezes that.

### Why v0.1.0 lands here

Two months of build with no prior version-management discipline
left the project in a state where "what shipped when" lived only in
`docs/dev/session-log.md` and the roadmap's stage-status flips. As
the FTUX-coordinated trio (Stage 18 + 18b + 23 + 24) approaches —
the first real Trailblazer-facing surface — version discipline
becomes load-bearing: a Trailblazer who installs Duo and reports a
bug needs to be able to say "I'm on v0.x" and have that mean
something. Cutting v0.1.0 *before* Stage 18 ships means the process
is exercised on low-stakes ground (no users yet, mistakes
recoverable) and the first user-facing release will already have a
working version-cut machinery behind it.

### Key design decisions baked in

- **Three-pane layout** (Stage 10 ADR). Files left, terminal middle, working pane right. The working pane is polymorphic: a single tab strip handles browser pages, markdown editors, HTML canvases, image viewers, PDFs. This was a deliberate departure from "one tab strip per modality" — the bet is that humans don't think about file types, they think about "what am I looking at right now."
- **Duo subagent uses Haiku 4.5, not Sonnet** (Stage 5 v2). The PRD's "~85% token reduction" hypothesis didn't survive synthetic measurement (FOLLOWUP-003 — Claude Code already routes mechanical work to Haiku, so the subagent stacks a second Haiku layer rather than replacing Sonnet). Qualitative wins (bounded context per task, specialized prompt, clear contract) carried the architecture instead.
- **HTML canvas serializer scrubs runtime classes** (Stage 17c). The "saved file is just HTML" guarantee is load-bearing — the canvas is supposed to feel like a primitive, not a system. Comment chrome (`data-duo-comment-anchor`, `duo-comment-anchor` class) and just-added wash (`duo-just-added` class) NEVER leak to disk. V27 in the verification punch list watches this; if it ever fails, the canvas's "primitive" framing is lost.
- **CSS Custom Highlight Registry for blurred selection** (Stage 17c). When the user selects text in the canvas and clicks into the terminal, the selection still paints in the Atelier mark color. Implemented via the Highlight Registry API (Chromium 105+) — no DOM mutation, no false-dirty. The fallback (span overlay) would dirty the buffer; that's the V20 watch.
- **`duo external` routes off-host URLs through the OS default browser** (Stage 5 v2). Trailblazers are PMs at Cap One — they have corporate-managed browsers with internal sites, SSO, and bookmarks. Duo's embedded Chromium can't replicate that surface, so the explicit decision was: Duo is for in-loop work (browse → quote → ask Claude); off-host links go to the user's real browser via `shell.openExternal`.

### What v0.1.0 is and isn't

**Is:** an internal-development snapshot of the foundation. Runnable
via `npm run dev` or installable via the uncert DMG produced by
`npm run dist`. The CLI works (`duo` is a tracked binary in
`cli/duo`). The skill (`skill/SKILL.md`) and subagent
(`agents/duo.md`) sync into `~/.claude/` via `npm run sync:claude`.

**Isn't:** distributable to anyone other than the owner.
First-launch self-install (Stage 18) hasn't shipped — installing
this build on a fresh machine leaves the user without `duo` on
their PATH and without the skill / agent installed. The DMG isn't
signed or notarized (Stage 21) — Gatekeeper will warn. There's no
auto-update channel. There's no FAQ surface, no "what does this do"
landing page (those ship in v0.2.0 as part of the FTUX trio).

### What's queued next (v0.2.0 candidate scope)

- **Verification debt** — V2–V27 + 19c full UI walk (V1 done, BUG-009 filed during the v0.1.0 cut walk).
- **FTUX-coordinated trio** — Stage 18 (first-launch self-install), Stage 18b (distro skill packs), Stage 23 (canvas actions — `data-duo-action` Claude↔HTML loop), Stage 24 (pin WorkingPane tabs).
- **`faq.html` + `what-duo-does.html`** — the user-facing reference surfaces; replace about:blank as the default new-tab landing; both use the `<meta name="duo-open-in" content="browser">` routing convention and `<meta name="duo-editable" content="false">` read-only convention.
- **BUG-008 + BUG-009** — `⌘T`-from-terminal-focus xterm-eats-keystroke (resolve spec conflict with Stage 19c first), and `+ → claude` newline race.

---

> _Cuts before this point: none. Duo's prose history before v0.1.0
> lives in [`docs/dev/session-log.md`](dev/session-log.md), session
> by session. Items shipped pre-v0.1.0 are not assigned a version
> retroactively._
