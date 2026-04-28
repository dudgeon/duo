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

_Empty._

---

## v0.4.5 — 2026-04-27

**The "Claude detection + plainer install copy" hotfix.** v0.4.4
shipped 30 minutes earlier and fixed the DMG actually launching, but
the install banner's success state still had two issues that the
owner caught immediately on first install: (1) Duo claimed it
couldn't detect Claude Code on PATH even though `claude` was clearly
installed at `~/.local/bin/claude`, and (2) the success message
included an "Add this dir to your PATH" hint for the `duo` CLI
helper that was confusing non-technical users for a CLI that's not
meant to run from external shells anyway.

### Why claude detection was broken

Two separate sites in main process check for `claude` and both
disagreed with the user's actual shell:

- `install-service.ts § resolveRealClaude` ran `zsh -l -c 'command -v claude'`. Login shells DO source `.zprofile` / `.zlogin` /
  `.zshenv` — but NOT `.zshrc`. The official Claude Code installer
  drops the binary at `~/.local/bin/claude` and tells users to add
  `export PATH="$HOME/.local/bin:$PATH"` to their shell rc; modern
  macOS users put that line in `.zshrc` (the default file Apple's
  Terminal sources for new tabs). Login-only invocations therefore
  miss it, and Duo's installer reported "Claude Code not detected"
  for the entire majority case.
- `main.ts § isClaudeOnPath` did `spawnSync('which', ['claude'])`
  against Electron's inherited `process.env.PATH`. Finder-launched
  Electron processes inherit only the system-default PATH
  (`/usr/bin:/bin:/usr/sbin:/sbin`) — never the user's interactive
  PATH. So every "claude" terminal tab opened from Duo printed the
  "Install Claude Code to enable agent tabs" banner instead of
  running claude.

Both bugs had been latent since v0.2.0 (Stage 19c). They only
surfaced now because v0.4.4 was the first DMG that actually launched
end-to-end — earlier DMGs were crashing on `node-pty` before reaching
either check.

### What changed

New shared helper `electron/resolve-claude.ts` walks
`(shell × {-l -i, -i, -l})` flag combinations until one finds
`claude`. The `-l -i` variant reads everything (login files AND
`.zshrc`); `-i` is the fallback for users with weird login files
that error under `-l`; `-l` is the last resort for users with PATH
in `.zprofile` and a noisy `.zshrc` that breaks under `-i`. Both
detection sites in main route through this helper now, so they can
no longer disagree.

Install banner copy collapsed from three permutations of
"installed-with-or-without-PATH-hint" to a single plain-English
"Installed. Claude inside Duo's terminals will arrive Duo-aware."
The `export PATH=...` hint for the `duo` CLI is gone — the CLI is
designed to run inside Duo's own terminals (whose PTYs already
inherit the right environment), not external shells, so the hint
was a footgun without being load-bearing. The "Claude Code not
detected" follow-up note also rewritten in plain English (no
"shim" or "PATH" jargon for non-technical readers).

### What this is and isn't

This is a copy + path-resolution patch. No new features. Same
shipping surface as v0.4.4. Auto-update from v0.4.4 to v0.4.5
works normally (v0.4.4 launches, fetches `latest-mac.yml`, sees
v0.4.5 available).

A broader plain-English rewrite of the welcome / update banner
copy (engineer-speak phrases like "skill + subagent + help files",
"priming shim", "SessionStart hook") is queued for a later cut as
ENH-011 — touched only the success-state copy here to keep the
hotfix scoped.

### What's queued next

Stage 26 PR 1 (navigator row-interaction) at
[duo#28](https://github.com/dudgeon/duo/pull/28) awaiting review;
v0.5.0 with Stage 21e fork-friendly architecture + the deferred
ENH-005/006/007.

---

## v0.4.4 — 2026-04-27

**The "DMG launch fix" hotfix.** Every DMG cut from v0.4.0 through v0.4.3
shipped with this bug latent in `electron-builder.yml § files`: a
`"!node_modules/**/*"` exclusion meant zero production node_modules
made it into the bundle, so externalized main-process modules
(`node-pty`, `chokidar`, `electron-updater`) couldn't be `require()`d
at runtime. The DMGs would crash on launch with an Uncaught Exception
before reaching the renderer. The asar built fine, codesign succeeded,
notarization succeeded; the only signal was the end-user double-clicking
the app and seeing the crash dialog.

The fix is one line: replace the negative exclusion with a positive
`node_modules/**/*` include. electron-builder's smart filter restricts
that to `package.json § dependencies`, so dev deps still stay out and
the bundle stays lean. Verified by rebuilding unsigned and confirming
`app.asar.unpacked/node_modules/node-pty/build/Release/pty.node` ships
in the resulting Duo.app, then smoke-launching the .app and confirming
it stays alive past 8s.

### Why the bug went undetected for so long

The config has been like this since the original Stages 1–3 scaffold
commit (`d1e4d84`). v0.4.0 / v0.4.1 / v0.4.2 / v0.4.3 all shipped with
the same broken bundle. The bug only surfaced when a fresh DMG install
hit the require() — prior "successful" runs were almost certainly
`npm run dev` (which loads node-pty from the repo's local node_modules)
or installs that inherited node-pty on disk from a previous,
differently-built bundle.

### What changed in the toolchain to prevent recurrence

The cut-version skill grew a **mandatory launch-smoke validation** step:
`scripts/validate-dmg-launch.sh`. Two layers of check:

1. **Static.** Mounts the DMG, confirms every module in
   `REQUIRED_RUNTIME_MODULES` (currently `node-pty`, `chokidar`,
   `electron-updater`) is reachable from inside `app.asar` OR
   `app.asar.unpacked/`. Additionally enforces that native modules
   (currently just `node-pty`) live specifically in `app.asar.unpacked/`
   because Node can't `dlopen()` from inside an asar archive.
2. **Dynamic.** `open` the .app, sleep 8s, `pgrep` for the main process.
   Catches anything else that crashes on startup — config typos,
   import failures, missing entitlements, Sequoia bundle-validation
   regressions.

`scripts/dist-signed.sh` now invokes this validator after the existing
signature/notarization validator. The `cut-version` skill flags it as
non-negotiable in Step 4.5. The whole class of "DMG builds successfully
but crashes on launch" gets caught at cut time, not release time.

### Auto-update note

v0.4.3 users won't get v0.4.4 via auto-update — v0.4.3 crashes before
electron-updater fetches `latest-mac.yml`. Manual install of v0.4.4
from the GitHub Release is required. v0.4.4 onwards resumes
auto-update normally (and v0.4.4's launch validation guarantees the
DMG actually launches before it reaches the GitHub Release).

### What's queued next

Stage 26 PR 1 (navigator row-interaction — single/double-click
semantics, chevron-only hit target, right-click delete/rename,
hover-Claude button) is open at [duo#28](https://github.com/dudgeon/duo/pull/28)
awaiting review; it lands in v0.5.0 alongside Stage 21e fork-friendly
architecture and the deferred ENH-005/006/007.

---

## v0.4.3 — 2026-04-27

The "v0.4.2 punch list" patch. Owner installed v0.4.2 (signed +
notarized DMG via prebuilt download), walked the surfaces, came back
with 7 bugs + 4 enhancements. This cut closes 7 bugs + 2
enhancements; the other 3 enhancements defer to v0.5.0 alongside
Stage 21e and Stage 21c Phase 3.

### Why v0.4.3 lands here

Bugs that surface on a real owner-side install want to ship FAST so
the owner (and any cohort users who follow) gets the polish without
waiting for the v0.5.0 cut window. Two of the seven are particularly
high-leverage:

- **BUG-021 — ⌃Tab cycle skips restored tabs.** Regression introduced
  by Stage 21c Phase 2 (session restore on relaunch in v0.4.2). The
  fix is small (use refs in `useKeyboardShortcuts` instead of relying
  on closure freshness) but the bug undermines confidence in session
  restore — "the tabs are there but I can't reach them with the
  keyboard." Worth a patch.
- **BUG-023 — HTML canvas click area too narrow.** Significant
  authoring friction; fixed by restructuring the boilerplate (body
  fills the viewport, content goes in `<main>` with the 720px width
  cap). Clicks anywhere in the iframe now place a cursor.

The rest are smaller papercuts that still benefit from shipping
quickly together — bundling them into a single cut is cheaper than
a per-fix patch sprint.

### Three key design decisions

- **Stack the Comment button BELOW the selection rather than combine
  with Send→Duo.** Owner asked "combine buttons?" — the simpler v1 is
  to keep them separate but vertically stacked so neither occludes
  the other. Combining (a single split-pill or hover flyout) is
  worth doing as polish but introduces new interaction modes that
  warrant deliberate design. (`renderer/components/HtmlCanvas/CanvasTab.tsx § CommentButton`)
- **`about:blank` as the new-tab default, not a custom "new tab" page.**
  Browsers (Safari/Chrome) ship custom new-tab pages with
  recently-visited / suggested URLs. Duo's not at the scale where
  building one makes sense yet; `about:blank` + the address-bar
  auto-focus is the right v1 footprint. Custom new-tab page is
  filed as a future polish.
- **Existing users don't get the ENH-009 expanded defaults
  automatically.** The bootstrap is "only-if-absent" by design.
  Migrating means trade-offs: an additive merge would re-add
  user-deleted entries; a replace would clobber user customizations;
  a "dismissed-defaults" tracker is over-engineered for v1. The
  release notes document the manual workarounds; Stage 21e-iii
  (v0.5.0) ships the proper additive-merge upgrade path.

### What this is and isn't

This is the "polish + expanded sane defaults" patch on top of v0.4.2.
It is NOT the Stage 21e cut (fork-friendly architecture) — that
lands as v0.5.0 once the implementation on `stage-21e-fork-friendly`
finishes. v0.4.3 also doesn't touch Stage 21c Phase 3 (browser
history persistence — issue #27); that's still ⬜.

The auto-update path from v0.4.2 → v0.4.3 is the FIRST real-world
test of the auto-update flow shipped in v0.4.2. If a v0.4.2 user has
the auto-updater wired (which is everyone on signed v0.4.2+), they
should get an in-app prompt within ~15-30 seconds of their next
launch.

### What ships next

- **v0.5.0 — Stage 21e fork-friendly architecture.** Build-time fork
  config + runtime config injection + provenance-aware install +
  HOW-TO-FORK doc update. Implementation complete on
  `stage-21e-fork-friendly` branch.
- **Stage 21c Phase 3** — browser history persistence (issue #27).
  Per-partition history capped at N entries surfacing in address-bar
  autocomplete. Folds into v0.5.0 if there's room.
- **The deferred ENH cluster** — copy button on code blocks (ENH-005),
  right-pane new-browser-tab button (ENH-006), collapsed comment
  rail with findable resolved (ENH-007). All v0.5.0 candidates.

---

## v0.4.2 — 2026-04-27

The "auto-update + session restore" release. Two long-standing
papercuts close:

1. **Auto-update.** Today's flow is "see GH-Releases banner → click
   link → manually re-download the DMG → drag to /Applications →
   relaunch." With v0.4.2, signed Duo installs poll GitHub Releases
   in the background, download new builds silently when published,
   and prompt the user with a native macOS dialog ("Restart Duo to
   install update?"). Defer-on-quit means even if the user never
   sees the prompt, the next clean cmd-Q applies it. Stage 21c
   Phase 1.

2. **Session restore.** Issue #24, filed weeks ago: when Duo
   reloads, it should resume to the same terminals, files, and
   browser tabs the user had open. v0.4.2 ships it. State lives at
   `~/.claude/duo/session-state.json` (atomic-write-rename, debounced,
   flush-on-quit). Stage 21c Phase 2.

Plus a new doc — `docs/HOW-TO-FORK.md` — laying out the five layered
fork modes (use-as-is, per-user customization, drop-in org pack,
build-time partial fork, build-time full fork) and what's possible
today vs. coming-soon via Stage 21e.

### Why v0.4.2 lands here

Two reasons. First: **closing #24 has been overdue.** With Stage 21a
(signed cut) behind us, the foundation for polished distribution
ergonomics matters more than ever; auto-update is the exact mile of
that road, and session restore is the daily-driver ergonomic that
makes it feel finished.

Second: **the alternative was waiting for the full Stage 21
distribution-polish cluster.** Auto-update + session restore are 21c
Phase 1+2; Phase 3 (browser history) is independent and can ship
later; 21b (custom app icon) is design-blocked; 21d (socket auth)
is Trailblazers-distro work that doesn't gate daily-driver
ergonomics; 21e (fork-friendly architecture) is in flight on its own
branch. Cutting v0.4.2 now means the auto-update foundation exists
for v0.5.0+ to flow into automatically.

### Three key design decisions baked in

- **electron-updater's native dialogs are the v1 UI.** No custom
  "Update available — Download? Install?" banner-integrated
  experience. Reasoning: macOS users recognize the native dialog
  pattern (Sparkle, Apple's own software updater); replacing it with
  custom chrome adds work without obvious UX gain. Phase 1.5
  (banner-integrated update events) is filed as a follow-on if the
  native dialogs feel jarring in practice.
- **Session-restore IDs are durable, not ephemeral.** Tab UUIDs are
  session-local and regenerated on each launch; persistence keys off
  durable references (path for files, url for browsers, cwd for
  terminals). On restore, fresh IDs are minted.
- **Navigator path stays on its own localStorage layer.** Stage 10's
  `useNavigator` already persists CWD via `localStorage` keys
  (`duo.nav.cwd`). The session-state schema includes `navigatorPath`
  for forward-compat but it's not currently wired — migrating
  navigator's path persistence into session-state.json would be
  churn for no functional change.

### What this is and isn't

This is the "ergonomics polish + auto-update foundation" release. It
is **not** the Stage 21e fork-friendly architecture cut — that lands
in v0.5.0 with build-time fork config (`fork.config.json`), runtime
upstream-update endpoint injection via Vite, and provenance-aware
install with conflict detection so user customizations survive
upstream binary updates. v0.4.2's `docs/HOW-TO-FORK.md` previews
those layers with "coming soon" markers; implementation already in
flight on the `stage-21e-fork-friendly` branch.

### What ships next

- **Stage 21c Phase 3** — browser history persistence (issue #27).
  Per-partition history capped at N entries surfacing in address-bar
  autocomplete. Ships into a v0.4.3 patch or folds into v0.5.0.
- **Stage 21e** — fork-friendly architecture. v0.5.0 target.
- **Stage 18b** — distro skill packs. Pairs with Stage 21e.
- **Stage 14 + 16** — markdown editor track-changes binding +
  external-write reconciliation. Editor-maturity headline; v0.5.0
  candidate.
- **First real-world auto-update verification.** v0.4.2 → v0.5.0 (or
  whatever the next signed cut is) is the first end-to-end test of
  the auto-update path against a real installed v0.4.2.

---

## v0.4.1 — 2026-04-27

The "sandbox-resilience" release. Closes the silent-failure mode
where every `duo` command died inside a sandboxed Claude Code
session — the default Seatbelt policy in Capital One (and other
enterprise) Claude Code installs blocks Unix-domain sockets, and
Duo's entire agent-side bridge ran on one. Three pieces moved:

1. **Dual-transport bridge.** `electron/socket-server.ts` now
   listens on both the Unix socket (chmod 0700, primary, fast) and
   an ephemeral 127.0.0.1 TCP port with a per-launch random auth
   token published to `~/Library/Application Support/duo/duo.port`
   (mode 0600). The CLI tries the Unix socket first; on `EPERM` /
   `ECONNREFUSED` / `ENOENT` / connect-timeout it reads the port
   file and reconnects over TCP, sending the token as the first
   NDJSON line of the handshake. Non-sandboxed sessions never
   notice; sandboxed sessions now Just Work.

2. **Named diagnostic.** New `duo doctor` verb. Today, an
   unrecognized `duo` failure inside a sandbox prompted Claude to
   retry blindly and burn tokens. `doctor` probes both transports
   via a cheap `ping` cmd, reports app/CLI version match,
   `$DUO_SESSION` presence, install-path discovery, and
   `~/.claude/skills/duo/` + `~/.claude/agents/duo.md` presence.
   When the Unix socket is blocked but TCP works, it prints
   "Claude Code sandbox detected (Unix socket blocked) — using TCP
   fallback" so the failure mode is named, not inferred.

3. **Sandbox-writable install path.** `duo install` now prefers
   `~/.claude/bin/duo` over `/usr/local/bin/duo` because the
   `~/.claude/` tree is writable from inside a sandboxed PTY.
   `--system` opts back into the legacy path with sudo. The
   command also prints a one-line `export PATH=...` hint when the
   chosen target isn't already on the user's PATH.

Plus a small race fix: `duo wait --timeout 30000` no longer hits
the 10s socket cap and fails with "Timeout waiting for response"
while the renderer is still polling. CLI socket cap is now
`max(explicit + 5s buffer, default)`.

**Why this lands here, vs. later.** Every Capital One Claude Code
session has been failing silently — sandbox resilience helps users
today. Stage 21 (signing + notarization + auto-update) is in
flight on a parallel branch with an Electron 24→26 upgrade in
scope; that work is the larger and more invasive change.
Decoupling the sandbox fix from the platform upgrade ships value
sooner and lets the signing branch rebase onto a clean base when
ready. The asymmetric rebase cost (small file-isolated change vs.
node_modules-deep platform upgrade) makes this ordering the
cheaper one.

**What this is and isn't.** This is the transport unblocker, not
the polish. The full Stage 18 first-launch self-install is still
pending. The rest of the Stage 20 cluster (tab numbers in the
unified strip, terminal selection refinements, `duo reload`,
pane-aware zoom shortcuts per issues #22 / #23, PTY-side sandbox
audit per issue #12) still ⬜. Real-sandbox confirmation of the
TCP fallback (vs. the `DUO_TCP_ONLY=1` simulation used here)
comes from the owner's own Capital One Claude Code sessions
post-install. The DMG ships unsigned; Stage 21 lands the signed
+ notarized build.

---

## v0.4.0 — 2026-04-26

The context-pedagogy release. Stage 22 lands first as the headline:
the file navigator splits into two panes ("Your Claude settings"
above, "This project" below) so non-technical PMs can SEE that the
agent reads from both buckets without learning dotfile conventions.
Four supporting features round out the cut: a GitHub Releases
update-availability checker (real upstream-availability, not the
local-install reminder), Stage 25's post-redirect chrome banner
(with `*.capitalone.com` baked into the default external-domains
list), the Edit menu surface for `⌘⇧V` paste-as-plain-text, and
Stage 21 prep work (signing scripts, no actual signing tonight).

### Why v0.4.0 lands here

The owner asked, mid-build, whether Stage 22 was specified well
enough to attempt — yes, the intent doc had the visual + interaction
model nailed down, with explicit out-of-scope markers (file ops menu,
breadcrumb editor, ⌘P quick-open, per-folder pinning all defer to
the Navigator polish bundle). The build was bounded enough to fit
alongside the smaller items in the v0.4.0 sprint without owner
intervention overnight.

The owner also asked, separately, whether the existing "Duo update
available" banner was real GitHub-querying or a mock. Honest answer:
it was neither — it's the local-install drift detector
(installed.json version vs `app.getVersion()`), which fires after a
fresh DMG is installed and asks the user to re-run the install
banner so `~/.claude/` artifacts catch up. Real upstream-availability
checking didn't exist. v0.4.0 ships it as a sibling banner with
distinct behavior.

### Key design decisions baked in

- **Stage 22 dual-pane navigator: separate state machines, shared
  rendering primitive.** The top pane uses a new
  `useUserClaudeNavigator` hook (rooted at `~/.claude/`, no `cwd`,
  no follow-mode, no pin — the user's settings tree never moves).
  The bottom pane keeps the existing `useNavigator` unchanged
  (project CWD, follow-mode, pin still toggleable). Both feed a
  shared `<TreeNodes>` primitive in `FileTree.tsx` (now exported)
  for recursive rendering, so adding a third pane in the future
  (e.g., Stage 18b's "Provided by AIP" group) is mechanical. The
  user-claude pane's curated root is *synthesized* (a hand-picked
  list of `CLAUDE.md` + `skills/` + `agents/` constructed from the
  live root listing) rather than fetched separately, so the pane
  stays in sync with chokidar updates automatically. The "Show all"
  toggle just swaps between the curated root and `state.listings.get(state.cwd)`
  — same code path, different entries.

- **Project Claude context group: render-conditional, no empty
  state.** `<ProjectClaudeContext>` checks the existing `state.listings`
  for `./CLAUDE.md`, `./.claude/`, `./tasks.md`, `./AGENTS.md` and
  renders only the ones that exist; if none exist (a fresh repo,
  the user's `~/Downloads`, etc.) the entire group is hidden so
  the navigator doesn't pollute with an empty section header. The
  `.claude` directory is treated as expandable inline so users can
  see what's inside (project skills, settings.json) without losing
  their place in the parent tree.

- **GitHub update checker: main owns network, renderer reads cache.**
  The fetch happens once per Duo launch (refreshed every 6h max),
  cached on disk at `~/.claude/duo/update-check.json` keyed by the
  running version (so a fresh upgrade invalidates stale cached
  results). All renderer-visible state flows through `IPC.UPDATE_CHECK`
  + `electron.update.check()` — the renderer never hits GitHub
  directly. This avoids burning the anonymous-API rate limit (60
  req/hr/IP) on HMR re-mounts and gives us a single place to add
  smarter polling later. Per-upstream-version dismissal: dismissing
  v0.4.0's banner is keyed by `latest`, so the banner returns when
  v0.4.1 ships.

- **Stage 25 banner: most-recent-wins, 6s auto-dismiss.** Two
  redirects firing within 6s replace each other rather than
  stacking; the user always sees the most recent. The schema
  extension for `external-domains.json` is purely additive — entries
  can be `string` ("host.com") or `{host, reason?}`. Old files keep
  working; new files can opt into per-domain reason text that
  surfaces in the banner ("— internal SSO required", etc.).

- **`*.capitalone.com` default: bootstrap-only, not migrate.** The
  install service writes the seeded list only when
  `external-domains.json` doesn't exist. Existing files are never
  modified — re-running install on a system that already has a
  customized list keeps it intact. PMs upgrading from v0.3.x will
  not see the default applied automatically; they can add
  `*.capitalone.com` themselves or delete the file to trigger the
  bootstrap.

- **Edit menu Paste-and-Match-Style: dual entry points.** Both
  editors (markdown + canvas) handle ⌘⇧V via their own keydown
  handlers AND subscribe to the menu-driven IPC. Whichever editor
  has keyboard focus reacts; the others no-op. The menu makes the
  feature discoverable without requiring users to know the chord.

- **Stage 21 prep: env-driven signing path, no yml flip.** The
  signing flow was already env-var-driven (electron-builder reads
  `CSC_NAME` etc. from process.env without yml changes); the gap
  was just an ergonomic helper. `scripts/dist-signed.sh` sources
  `~/Documents/duo-private/.env` and runs `npm run dist` (without
  the `CSC_IDENTITY_AUTO_DISCOVERY=false` override that today's
  unsigned cut uses); `scripts/validate-signed-dmg.sh` mounts the
  DMG, runs `codesign --verify --deep`, `spctl -a -t open --context
  context:primary-signature`, and `xcrun stapler validate`. The
  yml stays env-agnostic so the unsigned flow today AND the signed
  flow tomorrow both work without flag flips. Why no yml uncomment:
  `${env.CSC_NAME}` substitution resolves empty when the env var is
  unset, which causes electron-builder to error — that would break
  every CI / unsigned-dev path.

### What v0.4.0 is and isn't

**Is:** the version where a non-technical PM looking at the file
navigator can SEE the user-level + project-level context buckets at
a glance, without scrolling, without learning that `~/.claude` is
where Claude reads context from. The version where DMG releases
self-announce on GitHub. The version where Cap One Trailblazers
don't have to manually configure off-host routing for their
internal sites. The version where "Sent X to your default browser"
gives a visible receipt.

**Isn't:** signed (Stage 21 still — script prep is in, the actual
signed cut runs the next time the keychain prompt can be answered
in real-time). Doesn't ship Stage 14a (markdown comments —
MISSING-001 still queued). Doesn't ship Stage 18b distro skill
packs (the "Provided by AIP" badge in the navigator is queued for
that stage). Doesn't ship Stage 19d mid-tab launch-claude banner
(deferred from this sprint per scope).

### What's queued next (v0.5.0+ candidate scope)

- **Stage 21 signed cut** — run `bash scripts/dist-signed.sh` while
  awake; validate; cut as v0.5.0 (or v0.4.1 if just signing nothing
  else changes).
- **Stage 14a** — markdown CommentRail binding (closes MISSING-001).
- **Stage 18b** — distro skill packs (`extra-skills/` + `PACK.json`
  + per-conflict consent UI). Stage 22's "Provided by …" badge
  becomes a Stage 18b feature.
- **Stage 19d** — mid-tab launch-claude banner.
- **Stage 21c** — session restore from pins.
- **BUG-006** — browser-pane Send→Duo pill behind WebContentsView
  (still pending design decision among three options).
- **Navigator polish bundle** — right-click context menu shared
  across both panes (rename / delete / reveal-in-Finder), breadcrumb
  "Go to" path input, ⌘P quick-open. Builds on top of Stage 22's
  visual reorg.

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
