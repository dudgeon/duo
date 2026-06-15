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

> *(empty — v0.11.0 cut 2026-06-15)*

---

## v0.11.0 — 2026-06-15 — OKF vaults (GitHub-portable) + worktree-aware Duo

**Why this lands here.** Two coherent capabilities closed at once. **OKF vault mode (ENH-216)** makes a knowledge base **GitHub-portable**: wikilinks render as literal `[[text]]` on github.com, but standard markdown relative links (`[Display](./note.md)`) resolve everywhere — Duo, Obsidian, and GitHub. OKF is now the default format for a new vault, while existing Obsidian vaults stay **byte-identical** (the serializer is chosen per-vault, never imposed). **Worktree-aware Duo (ENH-210)** teaches the app about git worktrees — tab chips, working-pane badges, a navigator switcher, and open-in-new-window — so multi-worktree work stops looking like a pile of unrelated projects. Together they're a clear minor bump.

**Key decisions baked in.**
- **One graph model, two at-rest serializers.** The same `[[ ]]` authoring gesture works in both modes; only the on-disk spelling differs (Obsidian wikilinks vs OKF markdown rel-links). Frontmatter `[[ ]]` stays `[[ ]]` in both (a bare YAML rel-path is a graph orphan in Duo *and* Obsidian — FOLLOWUP-051 reversed the earlier D7).
- **OKF moves aren't link-transparent**, the way basename-resolved wikilinks are — a move changes every inbound rel-path. So OKF ships a move engine: `duo vault mv` (clean path — moves + rewrites inbound links + re-bases the note's own outbound links) and `duo vault relink` (out-of-band repair). Auto-relink heals on boot; a mid-session vault switch only *reports* (it must not silently rewrite a vault you merely pointed at from another terminal — F5).
- **Static, regenerable listings** (`duo vault publish` → `index.md`/`log.md`) instead of a live query engine at rest — plain markdown an editor, agent, or GitHub can read. Made idempotent so a no-op publish is truly no-op (F20).

**What this is and isn't.** This cut also folds in a thorough round-2 interaction-review pass on the OKF work (10 findings fixed — the headline being F1, where the `.base` dataview engine silently returned an empty link graph for every multi-word note after the link-key change). What it deliberately is *not*: a fix for the **split-view aux pane** still occluding the New Vault / Clone modals (BUG-209), or the 11 **pre-existing** issues the same review surfaced in already-merged features (FOLLOWUP-054). Both are tracked for next sprint, not papered over.

---

## v0.10.3 — 2026-06-14 — Home: the default re-entry screen

**Why this lands here.** ENH-212 is the one feature in this cut, and it's a foundational surface, so it ships on its own as a patch on top of v0.10.2's vault work. Duo users accumulate hundreds of Claude sessions across 6–12 projects; the active-project rail covers what you're in *now*, but there was no good way back into the *inactive* ones. Home fills that: the most-recent projects up top with their last few sessions and recently-edited files, a spine for the rest, and one-click re-entry that focuses a live session or resumes a closed one. It's v0.10.3 (a patch) rather than v0.11.0 by owner call — Home completes the re-entry story the multi-window/rail work opened, rather than starting a new chapter.

**Key decisions baked in.**
- **Open-detection is process-primary.** A live `claude` process, walked up its parent chain to the owning Duo PTY, is ground truth — not the laggy `lastClaudeSession` pointer. So a running session earns a focusable pill within seconds, and the never-fork guarantee re-checks liveness at *click* time: a Duo-hosted session focuses, an external one refuses-or-forks, only a genuinely-closed one spawns.
- **No sidecar.** Every snapshot reads the JSONL transcripts live (ENH-183 D9); the only thing persisted is window layout. The project rollup folds worktrees/subdirs into their *deepest* enclosing git-root/marker, matching the project rail (the literal D8 "outermost" wording was degenerate in practice — it collapsed every home-dir session into one bucket).
- **Fork is a real fork.** Clicking a session running *outside* Duo runs `claude --resume <uuid> --fork-session` — a new branched session id — so you never get two processes writing one transcript. Plain resume (closed sessions) continues in place. Both routes share one `buildResumeCommand` helper so the UI and the `duo session open` CLI verb can't drift.
- **Titles reuse the resume-picker ladder.** customTitle (/rename) → aiTitle (Claude's auto-summary) → first prompt → uuid — identical to `duo session list` and Claude's own picker; there is no concise summary beyond ai-title, so first-prompt titles are simply un-auto-titled recent sessions.

**What this is and isn't.** It's the re-entry *surface*, not a session manager — no rename / delete / search from Home yet, and the refresh is automatic (30s poll + events) with a manual refresh button queued as ENH-217. The design trail (three UI studies → the "Two-Up Spread" winner) and the full PRD (`docs/prd/enh-212-home.md`) live in the repo. Two fixes from the owner walk shipped with it: forking now branches a new session (was a plain resume that clobbered the original), and opening/resuming a session expands the terminal pane if it was collapsed.

---

## v0.10.2 — 2026-06-12 — Vault capture UX lands (Phase 2) · inline-code suggesting fix · the review-hardened cut

**Why this lands here.** v0.10.1 shipped the vault's CLI/model layers and explicitly queued the capture UX; this cut delivers it — the five Phase 2 features (Settings → Default Vault picker, ⇧⌘N quick-capture, ⌘⇧F vault-search palette, @today tokens, the silent-stub type-picker) merged as PR #91 after an 8/8 owner walk. Two smaller PRs rode the same train: the suggesting-mode inline-`code` swallow fix (#92 — edits inside backticks were eaten, caret moving but nothing happening) and the All-mode "you-are-here" project-rail pill (#93). What makes this cut different is the path to merge: all three PRs went through a 38-agent adversarial review (every finding independently refuted-or-confirmed), and the 22 confirmed findings were fixed *on the branches before merging* — so the release carries the hardening, not a follow-up promise. It's v0.10.2 rather than v0.11.0 by owner call: the capture UX completes the v0.10.x vault chapter rather than opening a new one.

**Key decisions baked in.**
- **Chords are owner-picked, not PRD-inherited.** Both PRD-locked chords collided with shipped bindings; the owner re-picked: ⇧⌘N = capture (New Folder → ⌥⇧⌘N), ⌘⇧F = vault search with the *global* find-previous retired. The editor and canvas find bars keep input-local ⌘⇧F via a matcher yield; the browser pane's bar is deliberately ⇧Enter-only (FOLLOWUP-047 records the asymmetry rather than papering over it).
- **The default vault is machine-global, and the CLI can see everything the menu can.** The picker lists a self-healing `knownVaults` registry (every vault ever set or init'd, live-filtered, never pruned on disk so transiently-unmounted volumes come back), and `duo vault default` now echoes that list — closing the last undeclared UI/CLI asymmetry in the feature.
- **Inline code behaves like fenced code under track-changes — but no broader.** The fix declines suggesting interception only when the edit is genuinely inside code; mixed pastes keep tracking on their plain fragments (the narrow predicate was chosen over the safe-but-lossy all-or-nothing one).
- **Review findings are merge gates, not backlog.** 22 confirmed findings (2 medium doc-drift, 1 falsifiability gap, plus correctness/security/perf lows) were fixed in-branch; the 6 refuted ones are documented so they don't get re-litigated.

**What this is and isn't.** This completes ENH-208 Phases 1–2 (conventions + CLI + capture UX). Phases 3–4 (rollup rendering, processing loop) stay open, as do the walk-filed polish items (ENH-213/214/215) and the newly-grafted backlog (BUG-199/201/202/203 — including the CriticMarkup persistence story, BUG-203, which is the track-changes feature's next chapter).

---

## v0.10.1 — 2026-06-10 — Vault arrives (Phase 1) · the terminal-collapse data-loss fix

**Why this lands here.** Two unrelated things converged. First, a P0: collapsing the terminal pane was *terminating every terminal session* — it unmounted the pane, and each terminal's unmount cleanup unconditionally killed its PTY, so a single collapse wiped every running shell and live Claude session (expand handed you fresh shells). That's data loss on a one-click gesture, so it ships the moment it's verified. Second, the ENH-208 **vault** line (Phase 1 + the start of Phase 2) had already merged to `main` since v0.10.0, so this cut *releases* it rather than holding it dark: a `duo vault` CLI cluster for Obsidian-convention work-notes — init/capture, read verbs, a wikilink graph, and `.base` lint/render — plus a default-vault preference and the headless `@today` smart-token models the capture-UX UI (queued for v0.11.0) will sit on.

**The fix, precisely.** Root-caused via a multi-agent investigation + adversarial verification: collapse swapped the `<TabBar/> + <TerminalPane/>` subtree for the collapsed rail, unmounting every `TerminalInstance`, whose mount-effect cleanup calls `pty.kill`. The fix keeps the subtree mounted under a true `display:none` (the rail renders as a sibling), so PTYs and scrollback survive; a `TERMINAL_MIN_COLS` floor in `PtyManager.resize` backstops the BUG-156 reflow class an adversarial reviewer flagged would otherwise sneak back in. Live-verified — terminals stay mounted through a collapse, and the active shell's PID is identical across collapse/expand — with 3 regression tests. The whole `v0.10.0..main` diff was re-reviewed for release blockers before the cut (none found; one non-blocking `base render` edge case filed as FOLLOWUP-046).

**What this is and isn't.** This is the *bug-fix-plus-already-merged-features* cut, not the deliberate vault launch — the capture-UX UI (Settings picker, ⇧⌘N capture chord, ⌘⇧F vault search) is still in flight and lands in v0.11.0. The DMG build + GitHub release are **deferred** for this tag (a parallel agent holds the dev Electron); the tag is cut now so the P0 fix is recorded, and the distributable follows when the build host is free. Cut from a clean `release/v0.10.1` worktree off `origin/main`.

---

## v0.10.0 — 2026-06-08 — Multi-window: a real second window · navigator/terminal UX

**Why this lands here.** v0.9.2 landed the multi-window *foundation* inert (the registry-of-one spine, no second window). v0.10.0 is the payoff: `⌥⌘N` / `duo window new` opens a genuine second window with its own workspace, browser pane, navigator, terminals, and geometry — and the whole CLI surface becomes window-addressable (a `DUO_WINDOW` env stamp per terminal + `duo --window N` + `duo windows`). It rides on two earlier all-dark interims — P4 (the versioned session envelope, #78) and P5a/P5b (the window-2 machinery, #73) — each merged byte-identical-at-N=1 and adversarially reviewed (the P5 capstone was grep-verified to have zero residual fail-loud resolution points, with 1093 tests + an 8/8 smoke walk). Two standalone navigator/terminal UX features ride along: revert-to-All when a terminal opens outside the focused project (ENH-204, #79) and drag-a-path-into-the-terminal (ENH-207, #81).

**Key decisions baked in.** (1) Default window resolution is by *identity* (the lowest-id "primary" window), never focus — mechanically enforced by a grep-gate — so a windowless CLI command lands in one predictable window rather than racing the focused one. (2) The session file moves to a versioned `{version:2, windows:[…]}` envelope with a seed-before-save guard + a one-time `.v1.bak`; the accepted, documented cost is that a *downgrade* boots an empty session (graceful — no pref or saved-workspace loss). (3) The drag-to-terminal payload is control-char-stripped, shell-quoted, and newline-free by construction, so a dropped path can never auto-run a command or auto-submit a half-formed Claude prompt.

**What this is and isn't.** This IS multi-window — open as many windows as you like, each independently addressable from the CLI. Signed + notarized (first launch is a single double-click). Known edges: a drop onto a *collapsed* terminal rail spawns a tab instead of inserting (FOLLOWUP-043); the first terminal in a never-probed nested sub-project briefly keeps focus then self-corrects; a v0.10.0 session isn't restored by an *older* Duo (boots empty, gracefully); `duo screenshot` still times out (BUG-198). Queued next (filed): the per-request-window-target concurrency hardening + per-window git-watchers (P5 follow-ups), and the broader multi-window polish.

---

## v0.9.2 — 2026-06-07 — Multi-window foundations (registry-of-one) + bundled-skill overhaul

**Why this lands here.** v0.9.2 is the first "all-dark" interim cut of the multi-window initiative (ENH-191). P0–P3 replace the single-window `mainWindow` singleton and ~12 module-level state caches with a *registry-of-one* spine — landed behind exactly one window so it's provably byte-identical to the old single-window behavior at N=1 (a 36-agent adversarial review returned SHIP / 0 blockers before merge). No new user-facing feature ships here; the entire value is **de-risking the eventual second-window release by landing the scary architecture inert** — the same clean-interim pattern the project repeats for P4/P5. Bundled alongside: the ENH-203 skill overhaul — `SKILL.md` restructured 827→254 lines into a hub-and-spoke router with a `check-skill-currency` guard, after a live pre-walk confirmed a fresh Claude still discovers every verb (9/9 headless probes).

**Key decisions baked in.** (1) Land the singleton-replacement as a sequence of zero-user-visible-change interim cuts (P0→P5) rather than one big-bang merge — a registry-of-one returning its sole entry is byte-identical to the old `mainWindow`. (2) Three deliberate, owner-confirmed behavior deltas ride along: hash-derived-only project colors (manual override cut), socket-stays-up-after-last-window-close on macOS (dock-reopen now works — it was a crash before the app-lifetime-singleton fix), and a clean `{ok:false}` for browser verbs in the socket-before-window boot transient. (3) The skill's "CLI is the spec" rule is now mechanically enforced (the currency guard), not advisory prose.

**What this is and isn't.** NOT multi-window yet — there is no second window in this cut. It's the inert foundation plus the skill overhaul plus three small behavior deltas. Smoke walk: 5 PASS + 2 SKIP, both resolved to no-failures (the boot-transient returns a genuine `{ok:false}`; the regression SKIP was a bad test step, re-verified clean). Known issue: `duo screenshot` times out (pre-existing, BUG-198). Next: P4 (windowed session envelope) + P5 (open window 2), continuing on the dev branch — the all-dark `p4-p5a` interim is already queued to merge next.

---

## v0.9.1 — 2026-06-06 — Navigator resize affordances · View-diff conflict resolution · parallel-PR integration

**Why this lands here, and why it's a MINOR.** v0.9.1 is the convergence point for a batch of work that developed in parallel branches and merged together: the navigator resize affordances (ENH-190), the completion of ENH-195's conflict-resolution arc (the ENH-197 "View diff" banner, extended to the dirty-buffer case as ENH-202), the BUG-195 split-view ghost fix, and three supporting changesets that landed alongside — the ENH-191 docs deep-clean + CLI version-source fix (#65), the ENH-191 Phase H write-queue (#68), and a functional lint gate (#69). New user-visible capability (navigator gestures + richer conflict resolution) makes it a MINOR, not a patch.

**The key decisions baked in.**
1. **Three buttons everywhere on a conflict (ENH-202).** The owner walked the v0.9.0 conflict UX and preferred the destructive-overwrite banner's three options (Keep mine / Reload / View diff) over the dirty-buffer banner's binary choice. The 2-button design was the conservative call — a dirty buffer is a 3-way situation and a general merge UI is a non-goal — but "View diff" is a well-defined 2-way (your unsaved content vs disk), so unifying is a strict improvement. The HTML canvas stays 2-button: it has no tracked-changes rail.
2. **Integrate-and-verify over merge-and-hope.** The parallel PRs were trial-integrated in a throwaway worktree (clean merge + typecheck + full test suite) before landing on `main`, so the only conflicts resolved were documentation, never code.

**What this is and isn't.** This closes the ENH-195/197/202 conflict-resolution chapter and ships the navigator polish. Still queued: the ENH-189 agent-agnostic decisions (a research playground awaiting an owner walk), canvas change-highlight parity (ENH-196), and two navigator polish follow-ups surfaced on the walk (ENH-201 red-collapse-cue rework, BUG-197 peek-commit on a file/folder click).

---

## v0.9.0 — 2026-06-05 — CLI edits, disk-sync & the end of false-positive conflicts

**Why this lands here, and why it's a MINOR.** Three problems the owner had been living with turned out to share one root: Duo reconciled the editor buffer against disk by *guessing* whether a change was its own save echoing back or a real external edit — and that guess (a) false-fired the "changed on disk" conflict banner on the user's own edits, (b) silently *swallowed* real on-disk changes so the editor looked frozen, and (c) was only needed because agents wrote *behind* the editor instead of *through* it. v0.9.0 fixes the root, not the symptoms, and ships the agent-facing capability that removes the incentive to bypass the editor — a coherent chapter big enough to be a MINOR rather than a patch.

**The key design decisions.**
1. **One shared reconciliation hook, not two mirrored copies.** The markdown editor and the HTML canvas each carried a near-identical copy of the watch→echo→conflict state machine; two copies is exactly why BUG-166's byte-exact fix landed in markdown but silently skipped the canvas, and why the BUG-085→166 arc kept recurring. v0.9.0 extracts `useDiskReconciliation`, consumed by markdown + canvas + JSON, so parity is structural. This required amending the locked editor/canvas-convergence decision — but only by *scoping* it: the editing primitives stay separate (TipTap vs "the canvas IS the page" is a real difference), only the reconciliation layer is shared, and the shared hook touches zero editing contract.
2. **Byte-faithful on a clean buffer.** The old normalize gauntlet that suppressed self-echoes also swallowed real external edits that happened to normalize-equal. Now, on a clean buffer, *any* on-disk byte difference reloads; normalize is reserved for self-echo + the dirty-buffer conflict decision. This is what makes "the editor notices changes" true again — and the change-highlight (washed additions, deletion ticks, holding until your next keystroke) makes the reload legible instead of disorienting.
3. **Give agents the verbs they were missing.** `duo doc edit` (surgical markdown), `duo json set/merge`, and the `duo status` open-tabs probe close the capability gap that made `Edit`/`Write` the path of least resistance. Buffer-routed when the file is open, they're echo-clean by construction. A warn-only PreToolUse hook + priming guidance nudge toward them.

**Verified without a live walk — on purpose.** The owner chose to finalize on tests rather than a live smoke-walk this cut. The conflict logic is pinned by 9 reconciliation integration tests (the first-ever CI coverage for this ~11-bug class), all 914 tests pass, and both typecheckers are clean. The decisive step was a 15-agent adversarial review that found and fixed **9 confirmed bugs before the cut** — three of them high-severity data-loss/security regressions (a frontmatter clobber, a JSON source-mode edit-drop, and prototype pollution in the JSON helpers) that the passing tests had masked. A v0.9.0 smoke-walk page is generated for the owner to walk later.

**What this is and isn't.** It's the structural end of the false-positive conflict class and the agent-edits-through-Duo story for markdown, HTML, and JSON. It is **not** the canvas change-highlight (markdown ships it; canvas is deferred to ENH-196 because its diff substrate is DOM, not a ProseMirror tree), and the warn-hook + priming guidance activate in live sessions only on the next installer run (they ship with the app, not via `sync:claude`). A small install-service follow-up remains: uninstall/`primingStatus` don't yet account for the new PreToolUse entry.

---

## v0.8.5 — 2026-06-02 — Project rail correctness

**Why this lands here.** The project rail (ENH-182) shipped its lifecycle behavior across v0.8.x, and a day of dogfooding surfaced four correctness bugs clustered tightly around one root: *membership is derived from inputs that don't reflect reality, and churned hardest during close.* They're a coherent chapter — all rail, all membership — so they cut together rather than dribbling out as separate patches.

The two headline bugs are two faces of the same design fact. **BUG-191** (ghost tiles) is the steady-state face: a terminal's `cwd` was frozen at launch, so a shell that wandered off — or died — kept its tile forever. **BUG-192** (close-jitter) is the transition face: the close handler mutated five pieces of state (one `setState` nested inside another's updater) with no re-entrancy guard, which could spin a non-converging render loop severe enough to force-quit. Fixing 191 meant making membership track the *live* shell cwd; that surfaced **BUG-194** (a focused project whose last terminal left would hide the terminal), fixed by releasing focus to "All" when the project vanishes. **BUG-193** (phantom parent tile + focus theft) was a pre-existing latent bug the dogfooding flushed out: pinned reference docs under a git-repo parent resolved their membership up to that parent.

**Key design decisions.**

1. **Track the live shell cwd, don't freeze it.** A new `PTY_LIVE_CWDS` batched IPC resolves each terminal's real cwd + liveness asynchronously (`lsof` off the main thread, never blocking it); the renderer polls it on a visibility-gated 5s interval into a `liveCwdInfo` map that `deriveProjects` consumes via the pure `effectiveProjectTerminals`. A `PtyManager` liveness tri-state distinguishes an *exited* shell (drop its tile) from a *not-yet-spawned* tab (keep its launch cwd) so a fresh tab never flickers.
2. **Make the close handler atomic and idempotent.** `inFlightCloseRef` guards re-entry, the confirm moves before any snapshot, and the nested `setActiveTabId` is hoisted out of the `setTabs` updater. The pure `planProjectClose` computes members/survivors/active-shift so the React layer just applies a plan.
3. **Pinned tabs have no home project.** A cross-project reference shouldn't qualify whatever folder it happens to sit under — so pinned tabs get null membership, killing both the phantom parent tile and the D11 focus theft at the source.
4. **Poll without churn.** `mergeLiveCwdInfo` returns the same map reference when nothing changed, so a steady 5s poll doesn't re-derive the project set every tick.

**What this is and isn't.** v0.8.5 is a correctness patch on the project rail — no new capability surface, no roadmap stage flips. BUG-192/193/194 were owner-PASSed on the smoke walk; BUG-191 (the keystone) was owner-SKIP but agent-verified live three ways (unit tests, socket cd-out/cd-in tile clear+restore, and computer-use screenshots), which the owner accepted for the cut. The investigation that found these is itself a small artifact worth keeping — a 38-agent root-cause workflow whose decision playground lives at `docs/research/bug-191-192-ghost-tiles-jitter-rootcause.html`. One process note for the record: requesting computer-use mid-session to capture the BUG-194 proof triggered a macOS TCC permission reset that temporarily blocked file access to `~/Documents` (where the repo lives) for both the agent and the running app — recovered by restarting the session; worth weighing before reaching for computer-use on a repo under a protected folder.

---

## v0.8.4 — 2026-05-28 — Polish patch: quit-loop · source-line gutter · nav heal

**Why this lands here.** Three independent fixes landed in close succession after v0.8.2, each closing a distinct quality gap surfaced over a day of dogfooding: a real user-blocking crash (BUG-190 forced force-quit), a feature whose v1 contract didn't match the file's source lines (BUG-186), and a class of console spam + auto-spawn race tied to deleted-folder state in the project rail (ENH-182 + BUG-167). None was big enough to wait on; together they're worth a patch cut so the "open Duo, switch projects, quit cleanly" loop just works in daily use.

This also follows the master-agent reconciliation pattern: two PRs (#59 and #63) chased the same nav-ENOENT spam from different angles. Rather than landing the broader one and letting the narrower one rot, the focus-instrumentation gate + proactive mount-time prune from #63 were lifted into #59 (the canonical fix), and #63 was closed with the directive documented in its comment trail. Worth flagging because the pattern will repeat — multiple agents fixing overlapping bugs is the steady state once teams adopt Duo.

**Key design decisions.**

1. **Guard the destroyed-window send once, route every caller through it.** `electron/safe-send.ts` factors the `mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()` check into a pure module so vitest can drive the destroyed/null branches without mounting Electron. Every async sink (PtyManager + socket-server EventSinks, BrowserManager state/tabs, nav-pins, claude-presence, git-watch) now uses `makeSafeSend(() => mainWindow)` — closure-over-thunk so a window swap is reflected. The 7 cases include the load-bearing "accessing `webContents` on a torn-down window can ITSELF throw" defensive shape.
2. **Compute source-line numbers via the same serializer the save path uses.** The previous CSS-counter approach (1, 2, 3…) couldn't reflect blank lines or multi-line blocks. The new `LineNumbers` ProseMirror plugin drives a single `MarkdownSerializerState` across the doc's top-level children and reads byte offsets to derive each block's start line — guaranteed-identical to what lands on disk. Numbers are sparse (1, 3, 5, 9, 13, 18 in the smoke-walk fixture) because blank lines have no row. Sourced from `materializeCriticMarkupToJSON` so CM-bearing buffers track the disk-saved form.
3. **Two-tier nav heal — proactive mount-time prune + reactive on-failure heal.** Probe-driven (`dirExists` on each persisted-expanded entry), so a transient IPC failure leaves entries intact — empirically catches both the cold-boot ghost case (mount prune) AND the mid-session delete case (reactive heal). Shared util `renderer/hooks/pruneDeadPaths.ts` so the two paths can't drift; 8 unit tests pin the "probe-throw keeps the entry" invariant which is what protects against speculative drops.
4. **Auto-spawn race suppressed via terminal-cwd-under-root check.** `terminalMembership` is computed from async git/marker probes — so right after a focus click, `visibleTerminals` is transiently empty even when an in-scope terminal exists. The fix: don't auto-spawn while any open terminal's cwd is under the focused root; let membership resolve and the existing terminal get focused. Verified live in the walk: 16 → 16 terminals across 8 project clicks.

**What this is and isn't.** v0.8.4 is a polish patch — no new capability surface, no roadmap stage flips. The interesting capability work this enables sits in the agent-agnostic research (ENH-189) shipped under `docs/research/` — the playground walks the seven decisions that scope the implementation. Owner walks + paste-back pin the next sprint. The smoke-walk-surfaced `<pre>` gutter clip was caught and fixed in the same cut cycle (commit `2817cd5`) — a useful demonstration that walking via computer-use catches CSS regressions that JSON-DOM probes miss, because the data was right but the paint wasn't.

---

## v0.8.2 — 2026-05-27 — Terminal-tab context menu parity

**Why this lands here.** The terminal-tab right-click menu had a single verb (Reveal in navigator, ENH-115) while the canvas-tab menu was rich: reveal, rename, copy path, move left/right, pin, move-to-split, edit-in-canvas, open-in-browser, view-source, trash. The asymmetry was most visible when you wanted to *reorder* terminal tabs — you couldn't. Close + reopen was the only recourse, and that lost the PTY state. ENH-188 closes the gap with a thoughtful subset: every canvas verb that has a real terminal analog now ships; verbs without one (Pin, Move-to-Split, Edit-in-canvas, View-source, Trash, Rename) are documented as skipped rather than silently absent.

**Key design decisions.**

1. **Pure helper for the reorder transform.** `shared/reorderTabs.ts § reorderVisible(items, sourceId, targetId, isVisible)` is the load-bearing function — it implements the insert-before / insert-after rule AND the under-focus hidden-slot preservation (the bit that's more subtle than the canvas WorkingPane version, which has no focus filter). Lives in `shared/` so vitest can pin the invariants without mounting a React tree; the `App.tsx` callsite is a 3-line delegation.

2. **Reorder gesture: menu + drag-and-drop.** Both are wired. The drag dataTransfer mime is `application/x-duo-terminal-tab-id` — distinct from the canvas's `application/x-duo-tab-id` so cross-strip drags can never contaminate. Drag affordance is the same accent-ring (`ring-2 ring-accent ring-inset`) the canvas strip uses.

3. **CLI parity deferred, not skipped.** Canvas "move left/right" is itself UI-only — there's no `duo move-tab` verb on the canvas side either. So this faithfully *approaches* canvas parity rather than introducing a new gap. Tracked as FOLLOWUP-042; arguably pairs with a canvas-side equivalent so both surfaces gain CLI parity in one pass.

**What this is and isn't.** This is a small ergonomic shipment that completes Sprint 24's terminal-tab polish thread. It is NOT the v0.9.0 MINOR — the Sprint 24 backlog still has FOLLOWUP-031 (claudePresence listener leak), FOLLOWUP-032 (double project-close race), FOLLOWUP-033 (project list empty during boot), FOLLOWUP-041 (navigator parity with BUG-165), and the carry-forward items (BUG-079 Ctrl-Tab latency, ENH-128 walk-4, ENH-148 v2 multi-select, ENH-162 Clone modal collision) all queued. v0.9.0 lands when a coherent capability ships alongside the next polish wave.

[#60](https://github.com/dudgeon/duo/pull/60)

---

## v0.8.1 — 2026-05-26 — Sprint 24 polish wave

**Why this lands here.** Sprint 23 closed the ENH-182 capstone (project-as-filter-layer) and shipped v0.8.0. Sprint 24 was scoped as a focused polish wave — clean up the v0.8.0 audit's deferred follow-ups before any new feature work. What actually landed reads less like polish and more like quality-of-life: every terminal user benefits from BUG-165 (terminal recovers from deleted cwd) and ENH-187 (⌘T follows the live shell cwd), every markdown editor user benefits from BUG-166 (autosave conflict banner stops over-firing), and every user with `ai*`-named projects benefits from ENH-186 (rail tiles now distinguish projects).

**Key design decisions.**

1. **BUG-166's two-refs-not-wider-normalize.** Five months of growing `normalizeForEchoCompare` regex-by-regex to cancel TipTap round-trip artifacts (BUG-107 trailing whitespace, BUG-122 hypothesis 4 soft-break, hypothesis 6 HTML-entity escape, BUG-155 autolinks) hit a wall this sprint — `tasks.md` (1.2MB) surfaced two more gaps (`****X**` → `\*\***X**` bold-marker escape, relative-path `[X](X)` autolink stripping). Rather than add a sixth and seventh regex, we recognized that the baseline ref was answering two semantically-different questions (dirty check vs. conflict check) and split it. The normalize step stays as defense-in-depth for cloud-sync content-preserving touches, but is no longer load-bearing.

2. **BUG-165's nearest-ancestor strategy.** When the terminal's cwd disappears, choices are: fail (the pre-fix "[process exited]"), fall back to `$HOME` (loses context), or walk up to the nearest surviving ancestor (keeps the shell close to where the tab expected to be). Chose nearest-ancestor + a one-line amber notice explaining the jump. The substituted cwd persists to the session, so future respawns don't re-fail. ESC-sanitization on the interpolated paths prevents a POSIX-legal `\x1b` in a path from subverting the color reset.

3. **ENH-187's live-cwd-not-launch-cwd.** The same `lsof`-based live-cwd lookup the workspace-new flow already used got exposed to the renderer as `window.electron.pty.liveCwd(id)`. Both the chord path (`newTab`) and the CLI handler (`onNewTabRequest`) query the focused tab's live cwd before spawning. Three-tier fallback handles dead pids, no-active-terminal, and lsof permission errors gracefully.

4. **ENH-186's two-phase algorithm.** Phase A grows letter-initial candidates until collisions break (multi-word 2 → 3 initials, single-word 2 → 4 letters). Phase B numeric-suffixes the residue. Set operation, pure, deterministic — `useMemo` in `ProjectRail.tsx` recomputes only when the visible project set changes.

**What this is and isn't.** This is a quality-of-life cut that closes three bug classes that hit users daily. It is NOT the v0.9.0 MINOR — Sprint 24 backlog still has FOLLOWUP-031 (claudePresence listener leak), FOLLOWUP-032 (double `duo project close` race), FOLLOWUP-033 (`duo project list` empty during boot), FOLLOWUP-041 (navigator parity with BUG-165), and the carry-forward items (BUG-079 Ctrl-Tab latency, ENH-128 walk-4, ENH-148 v2 multi-select, ENH-162 Clone modal collision) all queued. v0.9.0 lands when a coherent capability ships alongside the next polish wave.

[#55](https://github.com/dudgeon/duo/pull/55) · [#56](https://github.com/dudgeon/duo/pull/56) · [#57](https://github.com/dudgeon/duo/pull/57)

---

## v0.8.0 — 2026-05-25 — ENH-182 capstone: project-as-filter-layer complete

The MINOR v0.8.0 reservation is earned. v0.7.10 shipped the foundation (Phases 0–2 — rail + focus filter); v0.8.0 closes the story end-to-end with the right-click tile menu (D12), auto-switch focus on file-open (D11), browser-tab filter (Phase 2b), and the `duo project` CLI verb family (Phase 4). Six commits since v0.7.10 — three feature commits, ENH-184 close-out, one doc sync, one audit fold-in.

The audit fold-in commit ([4e66419](https://github.com/dudgeon/duo/commit/4e66419)) deserves a callout. A background general-purpose agent reviewed the feature for race conditions, edge cases, and missing surfaces — and caught a chained-bug in the FOLLOWUP-030 design before it shipped. Without the agent's read, the browser-pane active-tab redirect would have preferred any visible tab (including pinned cross-project tabs), which then chained into Phase 3c-browser auto-switching focus to that pinned tab's actual project. Result: user clicks DU → ends up focused on CL. The strict TRUE-member preference fixes it. Plus 4 BUGs the agent identified (symlink shadow, ambiguity error, dedup, ⌘W focus trap) folded into the same cut.

ENH-184 (workspace pill defeaturing) also lands here. Other-claude's working tree was preserved untouched across the entire Sprint 22 → most of Sprint 23 via the revert-edit-restore dance documented in `docs/dev/RESUME.md § 8` — validating the pattern over three feature commits. The finishing onClick gate + `duo workspace-pill-menu` CLI parity verb committed in [282b0bc](https://github.com/dudgeon/duo/commit/282b0bc) close the 🟡 carry-forward that had been waiting since 2026-05-24.

**The full ENH-182 surface (Phases 0–4 + 2b + 3c-browser):**

- **Phase 1 + 2 (v0.7.10):** auto-derived projects + quiet-bloom tiles + focus filter (terminals + non-browser file tabs) + navigator re-root + Ctrl-Tab respects filter + auto-spawn on empty-terminal focus.
- **Phase 3a (v0.8.0):** persisted `~/.claude/duo/projects.json` (pins + color overrides) with `PROJECTS_CHANGED` broadcast pipeline; pinned-projects probe so pins to invalid roots silently drop.
- **Phase 3b (v0.8.0):** per-tile right-click menu — `Pin to rail` / `Unpin from rail` (renders a small color-matched dot in the top-right of pinned tiles) + `Close N terminals and M tabs` with live counts; `dialog.confirm` gate when any member terminal is `kind: 'claude'`; atomic membership flush via single `setTabs` / `setFileTabs` updaters; fresh shell appended when closing the entire focus would empty the strip (floor-of-1 preserved).
- **Phase 3c (v0.8.0):** D11 auto-switch focus when `activeWorking` moves to a file whose deepest project ≠ focused (catches both new-file opens AND reactivations of an existing tab — `duo edit` of an already-open file flips focus too). Phase 3c-browser parallel covers browser-tab activation.
- **Phase 4 (v0.8.0):** full `duo project` verb family — `list`, `focus <name|root>`, `focus --all`, `pin`, `unpin`, `close`. Renderer pushes `ProjectsStateSnapshot` via `PROJECTS_STATE_PUSH` on every change so reads return instantly. Name resolution is case-insensitive against unique names; exact root paths always match. Pin/unpin honor verb semantics (no-op when already in target state).
- **Phase 2b (v0.8.0):** browser-mode `file://` tabs gated by path membership. Non-file URLs (http/https/about) + pinned browser tabs cross focuses as reference material.
- **FOLLOWUP-030 (v0.8.0):** browser-pane active-tab redirect on focus change. Two-effect state machine with TRUE-member preference.
- **ENH-185 (v0.8.0):** rail 10% narrower + tooltip wording.

**What this is.** A feature-complete capstone for ENH-182. Every right-click action has a CLI counterpart (CLAUDE.md § 4 — every UI gesture should be agent-drivable). Every disorientation gap the smoke walk + audit could find is closed.

**What this isn't.** A breaking-change release. CLI verb signatures are additive; renderer state shape is backwards-compatible; persisted `projects.json` schema is unchanged from Phase 0. Pre-1.0 caveat applies (everything in 0.x may break), but nothing in v0.8.0 intentionally breaks anything in v0.7.x.

**Queued for v0.8.x:** 9 deferred follow-ups filed in `tasks.md` (FOLLOWUP-032 through 040) — double-close race, list-before-renderer-ready, rail-color rotation past 6, aria-label polish, etc. None user-blocking; all small. Plus FOLLOWUP-031 (`MaxListenersExceededWarning` on claudePresence — pre-existing, not new with v0.8.0).

**Smoke walk:** 5/5 PASS via computer-use pre-walk 2026-05-25. Manifest at `docs/dev/smoke-walks/v0.8.0.json`. Owner-judgment items: ENH-185-VISUAL · ENH-182-PHASE-3B-MENU · ENH-182-PHASE-3B-CLOSE · ENH-182-PHASE-3C-AUTOSWITCH · ENH-182-PHASE-2B-BROWSER. Agent-walked PASS (auto-skipped per intro): `npm test` 787/787 · `npm run typecheck` clean · `duo project list/focus/pin/unpin` round-trips · Phase 3c CLI verification · Phase 2b CLI verification · `duo workspace-pill-menu` CLI roundtrip · FOLLOWUP-030 fixed redirect via computer-use re-walk · Phase 3c-browser auto-switch verified · BUG-164 regression test.

---

## v0.7.10 — 2026-05-25 — Project rail + focus filter (ENH-182 Phases 0–2, partial) + iCloud data-loss guard

The first cut where Duo treats **projects as first-class organizing primitives** — not as a switcher, but as a filter / lens over your existing multi-project workspace. ENH-182 had carried through 3 sprints as a markdown PRD before the two playgrounds (`docs/research/project-centric-ux.html` + `docs/research/project-rail-style-study.html`) locked 12 design decisions + 3 rail-style sub-decisions in a single owner walk on the morning of this cut. The rail itself, Phase 0's pure derivation foundation, Phase 1's read-only render, and Phase 2's focus filter (the actual payoff) all shipped same-day.

**What ships.** A thin left-edge rail (~54px) renders one tile per auto-detected project plus an "All" tile. A folder qualifies as a project when it's a git repo root OR has `CLAUDE.md`/`.claude/` AND you're working in it (terminal cwd or non-pinned tab under it). Tiles render in the locked R1-B "quiet bloom" treatment — paper bg + colored initials + hue underline when unfocused, full-hue bloom with a white notch when focused. Six hash-stable hues mirrored from the Atelier kernel (`--duo-project-*` tokens) skip the burnt-orange band so no project reads as the app accent. Clicking a tile hides non-member terminal + working tabs (visibility-only — PTYs and editor state stay alive), re-roots the navigator to the project root (soft re-root, you can still navigate up/out), surfaces a `Focused: <project> ×` chip in the titlebar, and makes Ctrl-Tab cycle only the visible terminal tabs. Pinned cross-project tabs stay visible across every focus by design.

**One owner edge case caught + fixed mid-walk.** Focusing on a project that has working tabs but no member terminals leaves the terminal strip empty — confusing. Fix: auto-spawn a fresh terminal at the project root in that case, using your most-recent `lastTabKind` (shell or claude). Per-focus-session ref-guard prevents double-spawn. The walk caught it on the first try with `.claude` (which had a CLAUDE.md tab open but no terminals).

**One owner directive locked the qualification matrix.** The user's global `~/.claude/` config directory would naively make `$HOME` itself qualify as a project (since `~/.claude/` IS the `.claude/` marker D2 looks for). Owner's directive: bar `$HOME` itself + `/` from qualifying, **but not subdirs**. Editing a file directly under `~/.claude/` correctly surfaces it as a project tile (since `~/.claude/` has its own `CLAUDE.md` inside it). Locked in a pure helper `isExcludedFromQualification(dir, homeDir)` with three explicit `~/.claude editing scenario` integration tests so the rule survives future refactors.

**A session-start emergency became a permanent guard.** When this Sprint 22 session started, macOS's "Optimize Mac Storage" feature had aggressively evicted ~13,000 files in the repo — including `.git/refs/heads/main` (git rev-parse HEAD broken), both packfiles (`git cat-file -e` exited SIGBUS on the partial materialization), and 34 source files in `renderer/components/editor/extensions/`. Recovery walked 8 stages over ~45 minutes; the key tricks turned out to be: reconstruct `.git/refs/heads/main` from `.git/logs/HEAD`'s reflog (the log file usually materializes when the ref doesn't), and use `rm <stub> && git checkout HEAD --` for source files git couldn't overwrite directly (the cloud-stub blocks writes). New `scripts/check-materialization.sh` + `scripts/materialize.sh` + a `predev` npm hook make this trap impossible to hit blind in future sessions. Full symptoms + recovery commands now live in `CLAUDE.md § Build commands`.

**Plus one structural cleanup.** The v0.7.9 ENH-183 Option A pare missed three references to the dropped `SessionHeaderUiState.collapsed` field in `TabBar.tsx`. Pre-existing on `main`; was silently blocking `npm run typecheck` repo-wide. Fix is mechanical (drop 3 references + the now-unused render block + 4 dead imports). The lesson — structural pares need a same-commit grep-audit of all consumers — was codified by extending the existing `feedback_grep_all_implementations_before_rename` memory rule from "user-visible string renames" to "type-field removals."

**What this is and isn't.** This IS the project-as-filter-layer release — Duo now knows what your projects are, hides irrelevant work when you focus on one, and brings the relevant terminal up automatically when you switch. It IS NOT yet a project switcher (Cmd+P palette + title-bar breadcrumb deferred per D3); IS NOT yet feature-complete (Phase 3's auto-switch-on-cross-project-open + lifecycle/pin context menu + Phase 4's CLI parity all queued for Sprint 23); IS NOT yet filtering browser-mode canvas tabs (Phase 2b — file:// URL→project resolution is more complex than the file-tab path).

**Walk-1 results — 5/5 PASS** on the smoke walk (`docs/dev/smoke-walks/v0.8.0.json` — manifest was named under the working version before this cut was renumbered to PATCH; results stand). Two PASS-with-notes filed as Sprint 23 follow-ups: **ENH-185** (rail refinements: 10% narrower + tooltip wording) and a **BUG-079 update** (Ctrl-Tab latency partial repro in focused mode — same root cause as the existing carry-forward).

**Why v0.7.10 and not v0.8.0.** This release is a **PATCH** (0.7.9 → 0.7.10), not a MINOR. The project-as-filter-layer feature ENH-182 is real and visible, but Phase 2b (browser-mode canvas filter), Phase 3 (lifecycle + auto-switch + tile context menu), and Phase 4 (CLI parity) are all still pending. Calling this v0.8.0 would imply feature-completeness; v0.7.10 is the honest framing — "more polish + the foundation of a new feature you'll see fully shipped in v0.8.0 once Phases 2b/3/4 land." Same logic as the v0.6.x sprint cadence (a series of PATCH bumps, then a clean MINOR for a coherent capstone).

**Queued for Sprint 23.** ENH-182 Phase 2b + Phase 3 + Phase 4. ENH-185 rail refinements. BUG-079 latency investigation with the new known-good repro condition. ENH-184 workspace pill defeaturing — still uncommitted on `main` from a prior session, deliberately preserved across Sprint 22 for whichever Claude picks it up next.

---

## v0.7.9 — 2026-05-25 — Claude session resume affordances (pared scope)

The first cut where we **pared a feature mid-cycle** based on walk-driven empirics. ENH-183 began as a four-state polymorphic session header (S0/S1/S2/S3) with auto-hydration, inline rename, an educational tip, and four CLI verbs. After walking it across rev3-rev5, owner observed the S2 named banner duplicated info already in Claude Code's own `✳ <haiku-title>` tab title, and the auto-hydration path had produced BUG-156 (a Claude crash via `pty.resize(0,0)` triggered by a layout interaction in the in-flow flex-column wrapper). Empirics from the walks: `duo session hydrate` returned `{hydrated: false, reason: 'already-has-aiTitle'}` 100% of the time — proving Haiku always wins the race in practice. The ~20% coverage gain from force-rename wasn't worth the risk surface or the duplicated UI.

**What ships:** the two resume affordances that carry real user value — **S1 pills** (discoverability for "continue yesterday's chat from a fresh terminal") and **S3 restore** (workspace-switch one-click resume). Both backed by the **D5 read ladder** so banners display human-readable titles whether set by `/rename`, by Haiku, or derived from the first prompt. Plus two CLI verbs (`duo session list` + `duo session resume`) for agent parity.

**What got cut:** S2 named banner, C11 educational tip, T3 auto-hydration, S2 inline rename, force-rename CLI verbs. ~600 LOC across `SessionHeader.tsx`, the deleted `session-hydrator.ts`, the deleted `sessionTipPrefs.ts` store, IPC plumbing across `core/socket-server.ts` + `electron/preload.ts` + `shared/types.ts` + `shared/host-api.ts`, and the corresponding tests. FOLLOWUP-028 (T3 re-enable design) closed as won't-do.

**Three real bugs caught + fixed by the walk process working as designed:** **BUG-158** (symlink encoding — `/tmp/X` paths broke session detection because Duo's `encodeProjectDir` didn't follow Claude's symlink-resolving cwd handling); **BUG-160** (discriminator's `dismissedBanner` flag short-circuiting all states to S0, hiding the post-Resume banner); **FOLLOWUP-027** (about:blank ghost-tab when `local-only` mode filters a `duo open` URL). All three have regression tests.

**A fourth fix (BUG-159 — rename terminator `\n` → `\r`) turned out to be the wrong diagnosis.** Filed mid-walk based on owner's verbal "command sitting in input buffer" report, but post-walk JSONL inspection proved TWO `custom-title` entries had been written with the intended title — the rename WAS committing. The owner-visible artifact was Claude Code's TUI render timing, not a Duo bug. The defensive CR-terminator change shipped anyway, but became moot when all `/rename` injection code paths were removed in the pare. Lesson logged: check the artifact (JSONL on disk) before filing fixes based on verbal symptom reports.

**What this is and isn't.** This IS the Claude-session-resume release — restore your session after a workspace switch, jump back into a prior session from a fresh terminal. It is NOT a session-naming UI; type `/rename <title>` directly in Claude Code's TUI when you want to set a custom title. Duo no longer synthesizes that injection.

**Queued for Sprint 22.** ENH-184 (workspace pill defeaturing + `+ New Workspace` handler routing fix) is half-done in the working tree — new `useWorkspacePillMenuFlag` hook + complete `+` handler fix landed, but the flag isn't yet consumed in `App.tsx`. Intentionally uncommitted to keep v0.7.9 narrow. Sprint 22 wires up the flag + adds CLI parity for the toggle.

---

## v0.7.8 — 2026-05-23 — Browser blocklist three modes (`local-only` default)

A focused single-behavior release. **ENH-178** ships the three-mode URL filter that was built but pulled out of the v0.7.7 cut to keep that release focused. Cherry-picked back as the only behavior change in v0.7.8 — same code as the original [b03a8da](https://github.com/dudgeon/duo/commit/b03a8da), reverted at [5295849](https://github.com/dudgeon/duo/commit/5295849), re-applied as [d851296](https://github.com/dudgeon/duo/commit/d851296).

**Why a separate cut for one feature.** v0.7.7 shipped 12+ items and the right cadence was to land that wave, then ship the deferred behavior change cleanly. The `local-only`-by-default flip is also a posture change worth announcing on its own: by default, Duo's embedded browser only renders local URLs. Everything else pops the system browser. That's a sane new-install default for enterprise environments where some IT departments disallow agent-driven browsing on the open internet.

**Three modes.**

- **`local-only`** (new default) — `file://`, `localhost`, `127.0.0.1`, `[::1]` (any port) render in Duo. All other URLs pop the system browser via `shell.openExternal`.
- **`filtered`** — legacy behavior preserved. Hostnames listed in `~/.claude/duo/external-domains.json` pop the system browser; everything else renders in Duo.
- **`unfiltered`** — debug-only escape hatch. `duo browser-mode unfiltered` requires `--i-understand` to bypass the IT-policy warning prompt. Useful for debugging on packaged builds where DevTools alone isn't enough.

**Existing users.** v0.7.8 doesn't migrate anyone off `filtered` mode silently. The mode lives in renderer localStorage; existing installs that had `external-domains.json` configured keep their setup. The `local-only` default only fires for fresh installs that have never set the mode.

**Also in the cut (docs-only).** Two ENH-class items landed as planning artifacts:

- **ENH-180 closed same-day as filed.** PRD for auto-rename via `/rename` PTY injection. Owner observation: Claude Code already auto-writes Haiku summaries to `sessions-index.json`, so Duo doesn't need its own title generator. Folds into ENH-177's re-ship next sprint as a ~20-line detail (banner reads `customName` > `summary` > UUID fallback).
- **ENH-181 filed.** Banner inline rename via PTY `/rename` injection (gated on `claudePresence`), tap-tab-to-toggle collapse, Esc cancels mid-edit. Mockup at [`docs/prd/_archive/enh-177-banner-mockup.html`](../docs/prd/_archive/enh-177-banner-mockup.html) shows all 7 states. Folds into ENH-177's re-ship next sprint.

**One known quirk.** When `local-only` mode blocks a remote URL passed to `duo open`, Duo briefly creates an empty tab whose URL the filter strips (it ends up as `about:blank` in the embedded view; the system browser still pops correctly with the actual URL). Cosmetic, not data-loss. A FOLLOWUP after the v0.7.8 smoke walk will tighten this so the tab-creation short-circuits when the URL would be filtered.

**What this is and isn't.** This is a posture release — `local-only` becomes the default and the agent gets a CLI verb to switch modes. It is NOT yet a Settings UI (deferred until there's surface pressure beyond CLI). It is NOT yet wired to a fresh-install gating dialog ("which mode do you want?" on first launch — also deferred unless owner-asks).

---

## v0.7.7 — 2026-05-23 — Daily-driver upgrades + ⌘Z reopen + send-pill variants

Sprint 20's close-out. Theme: smaller daily-driver actions become first-class menu / chord / CLI surfaces — navigator file creation ([ENH-169](../tasks.md)), the first Settings menu ([ENH-170 v2](../tasks.md)), the workspace switcher decided in [ENH-168](../tasks.md) ([ENH-171](../tasks.md)), the navigator's show/hide-dotfiles toggle ([ENH-172](../tasks.md)), `⌘Z` reopen of recently-closed tabs ([ENH-179](../tasks.md)), and send-pill variants behind feature flags ([ENH-176](../tasks.md)).

**Why this lands here.** The four planned ENHs (169 / 170 / 171 / 172) shipped clean; six sprint-close fixes accumulated around them (149 / 150 / 151 / 152 / 154 / 155); two larger ENHs (177 claude session resume banner, 178 browser blocklist refactor) built but didn't get their owner walks in time, so they were reverted and queued for next sprint. The session-rename follow-up ([ENH-180](../tasks.md)) ships as a [PRD](prd/_archive/enh-180-session-rename.html) only — [Notion mirror](https://www.notion.so/36945f48854f810ca7f9dfa275c4389d) for phone review.

**Four design decisions baked in:**

1. **ENH-170 v2 over the modal.** First Settings landed as a top-level menu with one native checkbox, replacing the rejected modal. Future Settings items follow the same shape — owner-locked 2026-05-22.
2. **ENH-175 navigate-or-focus over reuse-active.** CLI `duo navigate <url>` no longer clobbers the user's active tab; the renderer address-bar keeps reuse-active semantics. Intentional asymmetry: address bar = explicit override, CLI = ambient agent.
3. **ENH-176 feature flags via localStorage only.** No UI surface for the send-pill variants until validated. Imperative setters exported for future CLI verbs. Default agent ON / terminal OFF preserves Sprint 16 behavior.
4. **ENH-179 ⌘Z over ⌘⇧T.** ⌘⇧T is taken by `newClaudeTab`. Owner picked ⌘Z with smart routing — text undo wins inside any text-input surface via a new `inAnyTextInput` gate in `FocusContext`.

**What this is and isn't.** This is a polish cut — incremental usability across navigation, tab creation, and selection. It is NOT the foundation for [ENH-180](prd/_archive/enh-180-session-rename.html) (auto-rename sessions via `/rename` PTY injection) — that depends on ENH-177 landing first, which is queued for next sprint. The PRD captures the 4 design decisions Sprint 21 needs to lock; the Notion mirror is so the owner can walk it on phone.

**Tests:** 687 green (35 test files). Typecheck clean. Pre-cut reverts of ENH-177 + ENH-178 left their git history intact for cherry-pick.

**For Sprint 21 / v0.7.8:** review the ENH-180 PRD on phone → paste decisions back → re-ship ENH-177 + ENH-178 with owner-walked verification → build ENH-180 (~3h after decisions lock).

---

## v0.7.6 — 2026-05-22 — Conflict-banner false-positive on HTML-entity round-trip + workspace switcher playground

**Why this version lands here.** Caught a fresh BUG-122 repro on the same `docs/about-duo.md` that drove v0.7.5. After v0.7.5 cut, owner opened the file in Duo's editor for further work, hit save, got the "file changed on disk" banner. Pulled `~/.claude/duo/logs/last-conflict.log`:

```
diskTail:     "Browser), CLI — coming soon. -->"
baselineTail: "Browser), CLI — coming soon. --&gt;"
firstDiffOffset: 433
```

**Root cause confirmed (hypothesis 6, new entry to the BUG-122 family).** tiptap-markdown's serializer escapes `<`, `>`, `&`, `"`, and `'` in raw text on round-trip. The HTML comment `<!-- ... -->` I added at v0.7.5 cut time became `&lt;!-- ... --&gt;` after the editor loaded and re-serialized. From then on, every save diff'd disk (literal) vs baseline (escaped) and fired the banner.

**Fix.** Extended `normalizeForEchoCompare` to decode the five named entities on both sides before the compare. Same pattern as the v0.7.2 fix for hypothesis 4 (soft-break ≡ space): make the compare tolerant of round-trip-stable cosmetic differences so the banner only fires on real divergence. Order matters — `&amp;` decodes last so doubly-encoded strings (`&amp;lt;`) survive one decode level. 5 new vitest tests; the regression class is now covered.

**Also shipped.** Workspace switcher design playground at [`docs/research/workspace-switcher.html`](research/workspace-switcher.html) — owner's response to "talk through options for the next sprint" included *"workspace sidebar switcher (Arc-style), very interested in this, please make me an html playground with some options (incl mockups)."* Five candidate positions (title-bar dropdown, horizontal tabs, left vertical rail, floating dock, ⌘K palette) with inline HTML+CSS mini-Duo mockups. Four owner-decision cards (Position / Switch gesture / Identification / Create gesture) + deferred section listing cross-machine path rewriting, multi-tag categories, save-to-GitHub gesture, auto-workspace-by-directory. Implementation gated on owner walk.

**What this is and isn't.**

- **Is**: a quality-fix release plus the v2 workspace design gate. Closes a recurring annoyance (BUG-122 has now had four hypotheses confirmed across multiple sprints — v0.6.15, v0.7.2, v0.7.6) and queues up the next big design conversation.
- **Isn't**: implementation of workspace v2. That's blocked on the playground decisions.

---

## v0.7.5 — 2026-05-22 — Block-image paste + About Duo

**Why this version lands here.** Surfaced in the same session that cut v0.7.4: authoring `docs/about-duo.md` in Duo's markdown editor produced GitHub-broken output. Pasted images jammed against the following paragraph (`![](foo.png)In my average workflow...`), and GitHub rendered them on the same visual row instead of as block illustrations. Owner ask: *"should the paste_image function have pasted with more whitespace, or should the user just add an extra line break?"*

**Two design decisions baked in.**

1. **Block-by-construction over per-call-site padding.** The bug had two natural fix options: (A) wrap the `setImage` call in `insertContent('<p></p>')` at every insertion site (paste, drag-drop, `duo image insert`), or (B) declare `DuoImage` as a block node so the right behavior happens automatically everywhere. Picked B — one fix point covers all current and future insertion paths. Trade-off accepted: inline-image-mid-sentence (`Click the ![icon](foo.png) button`) is no longer supported. Acceptable for Duo's docs-shaped editor where screenshots between paragraphs is the 95% case.

2. **About Duo is a real page now, not just a stub.** The narrative intro is the kind of asset that wants a permanent home on the GitHub README — not deep behind a docs/ link nobody finds. Linked from `README.md` near the top, right after the "Why a CLI?" callout where readers are oriented but ready for more context. Images compressed from 4.3 MB total to 1.6 MB so the first-paint experience is responsive even on slower connections.

**What this is and isn't.**

- **Is**: a quality-fix release — corrects a paste-image regression that produced broken GitHub-rendered markdown, plus the docs surface that triggered the report.
- **Isn't**: a new feature surface. No new menu items, no new CLI verbs. Strictly bug-fix + docs.

**Validation.** The DuoImage block fix verified live: `duo image insert /tmp/test-image.png --alt "Block test"` into a markdown doc with an existing paragraph at the cursor → image landed on its own line with a blank line above. about-duo.md visually re-walked on the published GitHub URL after the v0.7.4 push to confirm the manual paragraph-padding workaround rendered correctly; v0.7.5's fix means future paste sessions don't need the workaround.

---

## v0.7.4 — 2026-05-21 — Workspace-as-file (Save / Open / Open Recent + autosave mirror)

**Why this version lands here.** Duo's autosave (Stage 21c, v0.4.2) persists
every tab/terminal change to `~/.claude/duo/session-state.json` so a relaunch
picks up exactly where the user left off. Good for crash resilience, but the
user had no way to bookmark a configuration as "the X workspace" they could
return to later, switch between named workspaces without manual rebuilding,
or share/back up a setup as a portable artifact. Owner kickoff: *"I want to
be able to save a 'session' (file > save session, file > open session); the
session is basically the autosave data that duo uses to reload all open tabs
when you quit and restart — but we will expose this as a file type, allowing
a person to put down one session, and pick up another; we should also have
'open recent'."*

The build collapsed into a single day. Four sub-versions in one wave: v1
(the file-type surface), v1.1 (New Workspace reframed as a workspace reset),
v1.1.1 (in-place reset replaces `app.relaunch()` after the dev blank-window
bug), and v1.2 (title-bar badge + autosave mirror). Plus the late same-day
"session" → "workspace" rename when the owner caught the collision with
Claude session.

**Four design decisions baked in.**

1. **Workspace, not session.** v1 used "session" terminology (matched the
   underlying `SessionState` autosave shape). Owner caught the collision:
   *"I'm worried that 'session' is the wrong mental model/term and a user
   may think that 'new session' is like a new Claude session."* Renamed
   same-day to "workspace" — IDE convention (VS Code `.code-workspace`,
   JetBrains Workspace), no verbal overlap with Claude session, unambiguous
   in voice. Internal Stage 21c types (`SessionState`,
   `sessionStateService`, `session-state.json`) preserve original naming as
   they predate this work.

2. **In-place reset, not `app.relaunch()`.** v1 used
   `app.relaunch() + app.exit(0)` — works in packaged builds, blank-windows
   in dev (the Vite dev server dies along with Electron; relaunched
   Electron tries to load `localhost:5173`, gets `ERR_CONNECTION_REFUSED`).
   Replaced with an in-place reset: close browser WCVs cleanly, dispose
   PTYs, re-arm BUG-057's pin-restore on the next `did-finish-load`, reload
   the renderer. Faster (~200ms vs ~2s) and uniform across dev / packaged.

3. **New Workspace resets, doesn't just clear.** v1's New Workspace just
   "cleared the active-workspace pointer." Owner pushback after the smoke
   walk: *"new session should actually clear the current session…clear the
   terminal tabs (only one terminal tab remains w current CWD from front
   most terminal tab pre new session), all canvas tabs gone except
   pinned."* New Workspace now spawns one fresh shell at the **live CWD**
   (via `lsof -a -d cwd -p <pid> -Fn`, spawn-CWD fallback) of the
   previously-frontmost terminal, with every working-pane tab dropped
   EXCEPT pinned (both file and browser pins survive via existing
   boot-time hooks).

4. **The .duo-workspace IS the live state, not a snapshot.** Owner
   stretch ask: *"auto save should continue to function, updating the
   current session if saved or unsaved."* Extended `SessionStateService`
   with an optional `mirrorHook` that runs inside `flush()` — every
   autosave write to `session-state.json` also writes the active
   `.duo-workspace` (no-op when untitled). Same 250ms debounce; no extra
   mechanism. There's no "are we synced with the file?" question — the
   file is always up to date.

**What this is and isn't.**

- **Is**: a workspace bookmark you save to disk. Open it later to resume
  the same tabs + terminals + browser pane + splits. Use `Open Recent
  Workspace` to bounce between recent workspaces; the title-bar badge
  tells you which one you're in.
- **Isn't**: cross-machine sync. Workspaces persist absolute paths so
  opening one on a different machine silently drops paths that don't
  exist (existing BUG-039 logic handles file tabs; terminals fall back to
  `$HOME`). Path-rewriting on load is a future addition if cross-machine
  demand surfaces.
- **Isn't**: workspace-aware Claude session restore. Each `claude`
  terminal still starts fresh on workspace load — Claude Code does the
  conversation persistence on its own side, and Duo doesn't interfere.

**Validation.** All 14 smoke-walk items pre-walked via computer-use,
covering the native Save/Open dialogs, the Save / Don't Save / Cancel
modal, the file picker, the title-bar badge, the live-CWD detection
(verified with `cd /tmp` → New Workspace → new terminal lands at
`/private/tmp`, not the spawn `/stoop`), the autosave mirror (file
mtime advances on every tab open/close), and pin survival across
resets. Full ADR at [`docs/prd/enh-167-workspace-as-file.md`](prd/enh-167-workspace-as-file.md).

---

## v0.7.3 — 2026-05-19 — Unified annotation rail + agent comment-reply ergonomics

**Why this version lands here.** Two coherent surfaces shipped on the same
day, both driven by direct owner pushback rather than a planned sprint. The
markdown editor's two annotation rails (BUG-138 Phase 4e tracked-changes +
Sprint 6 Phase 4 comments) had been visually parallel since v0.7.1 and ate
~560px of horizontal width when both had items. Owner directive:
*"comments and tracked changes should coexist in a single rail, in the
order that they appear in the document."* A separate written bug report
the same day documented an agent burning 16 shell calls + 2 minutes to
reply to a single CriticMarkup comment, with five further issues stacked
underneath (active-editor identity confusion, opaque help, missing skill
docs, ambiguous "canvas" wording, and a recurring main-process EPIPE
crash). Both surfaces wanted closing in one wave.

**Three design decisions baked in.**

1. **Interleave by document position, not by kind.** v1 of the unified
   rail stacked tracked-changes on top of comments in one column —
   technically "one rail" but still two sections. Owner: *"this is close,
   but you have just stacked the rails — bad UX."* v2 reframed: each
   comment thread carries a live PM position (`buildMarkdownThreads`
   already had it), each tracked range carries `from`, so merge + sort
   by position. Reading the rail top-to-bottom now mirrors reading the
   document.
2. **Replies don't get their own CriticMarkup token.** Pre-v0.7.3 the
   only `--reply-to` shape that worked was passing the parent comment id
   as `--anchor` text, which created a nested `{==id==}{>>NEW<<}`
   inside the parent's body — visible as corruption on next remount. The
   fix appends `\n↪ @<author> <ts>: <body>` inside the parent's existing
   `{>>…<<}` body — the format `parseRepliesFromBody` already reads.
   One canonical thread shape, one parse path.
3. **Path-mismatch on editor IPC is a silent ignore, not an error reply.**
   With multiple `.md` files open, every non-matching editor's
   `onDocRead` / `onDocGoto` / `onDocFind` / `onDocWrite` listener used
   to error-reply — the bogus error from the first responder raced and
   won, masking the matching editor's success. Path-uniqueness is a
   strong invariant; only the matching editor should respond, and
   absence is the visible failure (a timeout), not a misleading error.

**What this is and isn't.** This is editor UX polish + agent ergonomics
on top of v0.7.1's markdown source-of-truth chapter. It is NOT a new
capability surface — comments and tracked changes were already in v0.7.1;
this cut is about reading them in less space and writing replies in
fewer keystrokes. The next chapter is queued via the v0.7.2 carry-forward
queue (BUG-079 tab-cycle latency, BUG-093 split crash, ENH-084 v4 aux
glow, ENH-148 v2 cross-boundary selection, ENH-157 browser-pane
comments) — Sprint 20 scope locks when the owner picks from that queue.

**One follow-up worth flagging on the cover.** FOLLOWUP-023 — the
chokidar reload path doesn't fully reconcile CriticMarkup marks on a
reply-write while the editor stays open. Close-reopen the file and it
parses correctly. Lower priority than the headline (reply visible) and
documented in the new `skill/references/comments.md` so agents know the
workaround without having to learn it the hard way.

**Bug-cluster inventory (BUG-142..148 + FOLLOWUP-023):**

| ID | What | Status |
|---|---|---|
| BUG-142 | `doc-edit` not propagated to live editor | ✅ closed via BUG-143 |
| BUG-143 | `--reply-to` no-anchor reply path | ✅ live-verified (6 tests) |
| BUG-144 | `layout` / `doc read` active-editor identity | ✅ live-verified |
| BUG-145 | `duo doc <sub> --help` focused help | ✅ live-verified |
| BUG-146 | skill canvas-vs-editor decision tree | ✅ |
| BUG-147 | `skill/references/comments.md` | ✅ new file |
| BUG-148 | Main-process EPIPE handler | ✅ live-verified |
| FOLLOWUP-023 | chokidar reload misclassification | 🆕 open (workaround documented) |

---

## v0.7.2 — 2026-05-18 — Editor UX polish + agent CLI parity + save-conflict reliability

**Why this version lands here.** v0.7.1 closed the markdown source-of-truth
chapter (Sprint 18 — comments + track-changes inline). v0.7.2 is the polish
wave that closes the adjacent items: the Properties panel design decisions
the owner walked but hadn't yet been coded, the threaded comment display
that surfaced as a silent regression on post-migration files, a real
save-conflict false-positive that was firing every time you spot-checked a
soft-break-wrapped fixture, and the CLI parity gap that left HighlightMark
agent-invisible. Plus a session-start rule that should prevent the
"three failed walks of the same bug" pattern from recurring.

**Three design decisions baked in.**

1. **Soft-break-vs-space equivalence is a normalize-on-compare problem,
   not a serializer problem.** tiptap-markdown collapses soft-breaks to
   spaces on round-trip; the file on disk keeps the original `\n`. The
   conflict detector used to fire on every byte-level diff. v0.7.2 extends
   `normalizeForEchoCompare` to collapse single intra-paragraph newlines
   to spaces on both sides before comparing — real external edits
   (paragraph breaks, content changes) still surface; cosmetic-only
   whitespace flips silently no-op. Cheaper and lower-risk than rewriting
   the serializer.

2. **Threaded display is rendering-side, not file-format-side.** Sprint 18
   Phase 2 migration body-joins multi-entry threads into one anchored
   comment via `↪ @author <ts>:` separators. The originally-planned Phase
   5 was a TipTap atom node for standalone replies — a file-format change.
   v0.7.2 takes the smaller path: `buildMarkdownThreads` reads inline
   marks (it was sidecar-only); `parseRepliesFromBody` splits the body
   back into separate `CommentEntry` records for the rail. File format
   stays reversible; the visual win lands without locking the format in.

3. **Agent-process rules belong in the project file, not in a memory
   doc.** v0.7.1 walk-3 ended with the owner saying "use computer use so
   you don't waste my time three times with the same bug." The memory
   rule `feedback_use_computer_use_for_keystroke_tests.md` captured the
   lesson; v0.7.2's CLAUDE.md § 7e elevates it to a session-start default
   — UI-touching session → `request_access(["Electron"])` BEFORE writing
   code. Memory rules deal with recurring frictions; project rules
   prevent them.

**What this is and isn't.** It IS a polish + reliability + agent-
ergonomics cut — 14 distinct deliverables, balanced across editor UX (5),
agent docs (3), reliability (1 big fix), feature closures (2), and
housekeeping (3). It ISN'T a new chapter — Sprint 18 was the chapter; this
cut closes its adjacent surfaces. Next chapter is still being scoped;
likely candidates include the Beginner's Guide (ENH-137), the Backlinks
panel (Obsidian cluster), or browser-pane comments (ENH-157), each of
which is a multi-session sprint anchor. v0.7.3 will be the next polish
wave; v0.8.0 the next chapter cut.

**Carry-forward to v0.7.3 or later.** BUG-079 (tab-cycle latency — needs
production repro), BUG-093 (split-view crash — needs clean repro),
BUG-122 hypothesis 2/3 (Notion-race, OneDrive xattr — next-repro log
gated), ENH-084 v4 (aux glow — owner 60s walk owed), ENH-127 composer-
window direction (defer further), ENH-137 Beginner's Guide (multi-day
pack content), ENH-141 enterprise smoke, ENH-148 v2 (cross-boundary
selection — wait for owner ping), ENH-157 browser-pane comments
(architectural, multi-day), FOLLOWUP-021 `duo install --clean`, BUG-024
follow-up (combined Send + Comment pill), 17a.5 template gallery,
Backlinks panel / graph view (Obsidian cluster).

---

## v0.7.1 — 2026-05-18 — Sprint 18: Markdown source-of-truth — comments + track-changes + frontmatter visible inline

**Why this version lands here.** Sprint 18 was the "markdown source-of-truth" chapter. Comments + track-changes used to live in sidecar JSON beside each `.md`; v0.7.1 moves them inline via CriticMarkup tokens (`{++…++}` for insertions, `{--…--}` for deletions, `{~~old~>new~~}` for substitutions, `{==…==}` for highlights, `{>>id|author|ts|body<<}` for comments with Duo's opinionated pipe-delimited metadata extension). The agent can now see + write tracked edits through the same `duo doc *` CLI shape it uses for everything else; existing sidecar comments silently auto-migrate on first load.

Frontmatter joined the same story. The editor used to hide YAML frontmatter entirely; v0.7.1 surfaces every key in a Properties panel above the prose (chevron-collapse persisted per-doc; "Edit raw" toggle for free-form YAML editing; "+ Add properties" for empty files). Closes "Duo HIDES frontmatter" as an architectural class.

PATCH bump (0.7.0 → 0.7.1) — the post-v0.7.0 cut chose 0.7.1 as the next dev version before the sprint scope was fully known. The actual work that landed is MINOR-class (genuinely new user-visible capabilities: tracked changes, Suggesting mode, 6 new agent verbs, frontmatter panel, browser-pane auto-reload). Cutting under v0.7.1 keeps the dev-build identity consistent with what was smoke-walked. Future cuts should err MINOR on the post-cut bump when the next sprint's scope is uncertain.

**Three key decisions baked in:**

- **Pipe-delimited comment metadata (Q1·A from the BUG-138 playground).** `{>>id:c-01|author:dudgeon|ts:2026-05-18T12:00:00Z|body<<}` — opinionated extension to standard CriticMarkup. Bodies that don't start with a known meta-key parse as legacy comments with empty metadata; round-trip is two-way at zero migration cost.
- **All five CM ops (Q2·A).** Insertion + deletion + substitution + highlight + comment. The substitution fold (`{~~old~>new~~}`) is a serializer-side artifact — it stays as adjacent DeletionMark + InsertionMark in the editor and re-collapses on save. Phase 1's parser splits it back into del+ins on parse.
- **Suggesting is a per-doc mode (Phase 4).** Toggled via a pencil toolbar icon (⌘⌥T). When ON: typing wraps as insertion, Backspace wraps as deletion. When OFF: normal editing. The mode persists in `sidecar.suggestingMode` so a reviewer can leave a doc in Suggesting=on for the next session.

**What this is and isn't.** v0.7.1 is the foundation: marks render, marks serialize, the agent can edit via CLI, the human can edit via Suggesting + Accept/Reject. v1.1 is the polish round — owner walk locked four decisions for the Properties panel (default-collapsed, click-to-expand long values, raw-YAML-only editing, uniform mono values). Comment-thread inline rendering (showing replies inside the editor body rather than only in the rail) is queued; today's migration collapses multi-entry threads into one anchored comment with `↪ @author <ts>:` prose separators in the body.

**The cut took four smoke walks.** Two same-day bugs ate three of them, and both reveal something about the architecture:

- **`Transaction.setSelection` threw a RangeError** because my Backspace handler built the Selection by resolving against `state.doc` (pre-`addMark`); the TR holds a different doc after addMark, and PM rejects Selections that point at the wrong doc version. The fix is mechanical (`tr.setSelection(Selection.near(tr.doc.resolve(...)))`), but the lesson is that PM's immutability boundary is real: never reach for `state.doc` to build positions for an already-mutated transaction.
- **`window.prompt` throws unconditionally in Electron renderers** (`prompt() is and will not be supported`). Built `LinkPromptModal` as the portal-based replacement. Same `Promise<string | null>` shape; same Enter-saves / Esc-cancels semantics; no API surface for callers to change. Filed as a memory rule for the future-class of "renderer-internal browser APIs that quietly aren't implemented."

The third walk-failure was less an architectural lesson and more a wake-up: I committed three fixes to BUG-138 Phase 4c without ever exercising the Backspace keystroke. Each typechecked; each looked right; each failed owner's walk. Once I requested computer-use and reproduced the keystroke, the root cause (the RangeError) was visible inside five minutes. Memory rule filed: when a smoke-walk item needs real keystrokes, request computer-use access and verify live BEFORE handoff. Three failed walks of the same bug is the symptom this rule prevents.

**The numbers:**
- 30 commits since v0.7.0
- 147 new unit tests across the BUG-138 chapter (CriticMarkup parser, migration, docEdit, frontmatter parser)
- 4 smoke-walk revs (1st: 6P 3F 2S; 2nd: 2P 2F 2S; 3rd: 2F 2S; 4th: 1P)
- 1 design-options playground (Q1 deferred, Q2-5 locked for v1.1)
- 2 architectural follow-ups already in flight: comment-thread inline rendering (defer to Phase 5) + frontmatter v1.1 (the 4 locked design decisions)

---

## v0.7.0 — 2026-05-18 — Sprint 17: GitHub-integration cluster + multi-pane Send → agent polish

**Why this version lands here.** Sprint 17 was the "GitHub-integration cluster" sprint — bringing first-class git status + clone + per-folder peer-repo affordances into the Navigator, plus the inspect / send-to-agent surface in the browser pane. v0.7.0 closes the chapter where Duo learned how to be a Git-and-GitHub-aware shell for the agent.

MINOR bump (0.6.15 → 0.7.0) rather than PATCH because the new chapter ships meaningfully new user-visible capabilities — clone-from-GitHub UI, inspect mode, peer-repo affordances, Send → agent rename. The bug fixes underneath are the close-out tail, not the headline.

**Key design decisions baked in.**

1. **HTML routing is now verb-driven (ENH-156).** `<meta duo-open-in>` is no longer consulted. `duo open` defaults to browser; `duo edit` defaults to canvas. Cleaner mental model than the meta-tag-or-verb hybrid that v0.6.x carried.
2. **The CDP-injected pill is the source of truth for browser-pane "Send → agent."** The React `SendToDuoPill` component still serves canvas + markdown editor surfaces, but browser-pane pages get the CDP-injected pill. v0.7.0's BUG-133/134 closes the gaps that made the CDP pill a second-class citizen — stale gate on non-active CDP-attached tabs and click no-op on aux pane.
3. **Peer-repo icon is the small-right-aligned glyph + hover-reveal popover (ENH-152a v2 modified-Option-B).** Owner walked a 5-option playground and picked modified-B (right-aligned git icon + chip popover on icon-hover, not row-hover). Five implementation rounds — inline chip → modified-B → portal escape from overflow → reposition below the row → swap to the Lucide `git-branch` SVG — locked the final shape.
4. **`files.openExternal` was a footgun (FOLLOWUP-026 + BUG-132).** The name suggested URL opening; it actually wrapped `shell.openPath` for local files. One renderer caller passed a URL to it and silently failed for who knows how long (the "Open on GitHub" right-click menu item). Renamed to `files.openPath`; added a distinct `files.openExternalUrl` for URLs.

**Walk arc — eight rev-walks closed this sprint.** Rev1 walked the initial v0.7.0 manifest (4 PASS / 9 FAIL / 5 SKIP). Rev2–rev5 worked through the four 🟡 decision gates (BUG-125 v2, FOLLOWUP-025 v2, ENH-159 v2, GH-cluster v2 + prototype + chip-occlusion fix). Rev6 pulled four cleanup items (BUG-129, BUG-131, FOLLOWUP-026, ENH-162) — rev6-rev2 caught two missed pill implementations + the wrong-surface BUG-131 fix. Rev7 caught the multi-pane gate + click bugs (BUG-133, BUG-134). Rev8 closed both with two PASSes. The walk arc reinforced a hard rule: when renaming a user-visible primitive, grep ALL implementations (React + CDP-injected IIFEs + native menus + test fixtures) — `feedback_grep_all_implementations_before_rename.md` filed.

**What this is and isn't.** This is the Navigator's GitHub-awareness chapter closing — clone, status overlays, right-click menus, peer-repo signals. It is NOT the "Duo as Chrome extension" exploration (still on its own branch, non-gating) and NOT the Backlinks / graph view Obsidian-cluster next-tier (queued for after wikilinks-autocomplete usage tells us whether demand is real). The Send → agent pill is now correctly named + multi-pane-correct; the next chapter for that surface is composer-window / anti-accidental-submit UX experimentation.

---

## v0.6.15 — 2026-05-11 — Sprint 16 close-out: stability + install/upgrade chapter end-cap + Return-key user toggle

Nine commits across four theme areas closing the install/upgrade
chapter Sprint 15 opened, fixing two real data-loss bug classes
(fsevents quit crash + save-conflict re-surface), bringing the HTML
canvas to parity with the markdown editor's external-write
reconciliation, and shipping a user toggle for the Claude-tab Enter
key behavior that ENH-127 v2 made too-clever-by-half.

**The Return-key pivot is the most user-visible change.** ENH-127 v2
(v0.6.13) shipped plain-Return-as-newline-in-Claude-tabs as the
default with ⌘Return as the explicit submit. The reasoning was
"protect against accidental submits during long multi-line prompts"
— and the byte-sequence discovery (`\x1b\r` = the bytes ⌥Return
sends natively, which Claude reads as "literal newline, don't
submit") was the real find. But the owner-reported surprise was
real: every other terminal in the world treats Return as submit;
muscle memory wins. v0.6.15 flips the default to `submit` while
preserving the override capability behind `duo claude-return
[submit|newline]` + a localStorage pref. The companion Shift+Return
→ newline default (ENH-133) is unchanged (matches Slack / Discord /
claude.ai-web convention). Owner framing: "feature toggle as
upcoming user preference — not abandoned feature."

**Stability + data-loss-class fixes.** BUG-119 traced the macOS
crash dialog on every Cmd-Q to chokidar's fsevents native module
trying to release its threadsafe function during Node env teardown
— a race window opened by disposing watchers in `window-all-closed`,
which doesn't fire on Cmd-Q on darwin (gated to non-darwin platforms
for `app.quit()` plumbing). Moving the disposes into `before-quit`
closes the race window deterministically; Electron exits cleanly,
no crash report. FOLLOWUP-019 brought BUG-085 + BUG-099's
three-layer external-write reconciliation (file watcher with clean/
dirty branching + pre-save reconciliation read-disk before write +
recently-written echo guard) from `MarkdownEditor.tsx` into
`PageTab.tsx`. Same data-loss class as the markdown variant — the
canvas just hadn't been fixed in the original Sprint 6 work
(disposition (c) Deferred at the time, upgraded to (a) Mirrored
here). The conflict banner UI also lands canvas-side: same amber
"Reload from disk" / "Keep mine" actions.

**BUG-122 — re-surface of the "file changed on disk" banner on
v0.6.14 production DMG.** Owner hit it editing a regular markdown
file on the work machine (no Notion mirror, no parallel agent, no
iCloud sync). The console-log diagnostic shipped previously
(`[BUG-107 save-pre-conflict]`) showed only lengths + first 60
chars — useless when the diff is mid-document or at the tail.
Defensive hardening this cut: TTL bumped 2s → 5s
(`recentlyWrittenBodiesRef` + `recentlyWrittenHtmlRef`), echo
normalization widened from trailing-only to also strip BOM,
normalize CRLF→LF, and strip per-line trailing whitespace (shared
helper `renderer/utils/conflictDiagnostic.ts`), and a production-
readable diagnostic log persists every conflict to
`~/.claude/duo/logs/last-conflict.log` with `firstDiffOffset` +
head/tail 80-char excerpts (post-normalize). The new `duo doc
conflict-log` verb dumps it in one keystroke — no DevTools required
on the production DMG. The deeper fix is gated on the diagnostic
data the next repro leaves behind. Hypotheses still alive: 3 (slow-
machine race, addressed defensively by the TTL bump) and 4
(tiptap-markdown serializer round-trip non-idempotency, hard to
confirm without a real diff snapshot).

**Install/upgrade close-out — the chapter Sprint 15 opened.** ENH-140
gives Duo its first real orphan-cleanup story on upgrade. Design
simplified from the original PRD: rather than introduce a new
`installed-files.json` manifest, reused `installed.json § files`
(the Stage 21e-iii SHA-per-file map already maintained). Diff
prior-install keys vs current-install keys; for each orphan, check
the on-disk SHA against the prior recorded SHA — if it matches, the
file is user-untouched and gets `fs.unlink`'d; if it differs, the
user customized it and we preserve in place + log. Empty parent
directories swept up after via non-recursive `fs.rmdir` (succeeds
only when truly empty — never strays).

**Pin URL auto-migration on upgrade.** Closes the v0.6.13 "two WDD
tabs on upgrade" known issue. `migrateStalePinUrls` walks `pins.json`
on every install; for each entry whose ref ends with a known v(N-1)
path (PIN_RENAMES map: `duo/help/what-duo-does.html` →
`duo/packs/duo-default/canvases/what-duo-does.html` from Sprint 15's
ENH-138; `duo/help/faq.html` → null from Sprint 15's ENH-135),
either rewrite to the new location or drop the entry. Idempotent;
conservative — only acts on known renames, never touches unknown
stale pins.

**Op #8 pivot to pack-defaults iteration — final touch.**
`install-service.ts § op #8` had been hardcoding the WDD URL +
title literal since v0.6.13 as a transitional shape.
`bootstrapPinsFromPackDefaults` now reads each `packs/<name>/
PACK.json` on fresh install and seeds `pins.json` from
`defaults[].kind === 'canvas' && defaults[].pin === true`. Pin
titles extracted from each canvas's `<title>` element via
`extractCanvasTitle()` — preserves the existing display string
("Duo — What Duo Does") without a hardcoded literal. Future
packs with `pin: true` defaults pick up the same seeding shape
automatically.

**What this is and isn't.** This is the close-out cut of the
install/upgrade story that Sprints 15 + 16 opened together —
v0.6.15+ users get the right install hygiene going forward.
v0.6.13/v0.6.14 legacy orphans (`help/faq.html`,
`packs/claude-code-basics/`) weren't tracked in `installed.json`
when Sprint 15 retired them, so they're invisible to the
diff-based cleanup and stay on disk inert. They can be removed by
hand; documented as a known limitation rather than aggressively
hard-deleted (the user-customization risk would require a known-
SHA list per legacy version, which is itself drift-prone).

The Return-key pivot is owner-driven, surfacing the toggle
infrastructure (CLI verbs + localStorage prefs + IPC bridge) that
v0.6.16+ user preferences can follow as a precedent. Existing
users will see plain Return start submitting again on upgrade
without warning — the previous v0.6.13 default lasted ~6 days
across versions, not long enough to expect users had built habit
around.

BUG-122's defensive hardening is *not* a confirmed fix. It's a
TTL widening + normalization broadening that addresses the most
likely hypotheses without committing to a specific root cause.
The new diagnostic log is the actual investigation tool; deeper
fix waits for the next repro's `last-conflict.log` contents to
name the hypothesis deterministically.

**What's queued for v0.6.16:** BUG-093 (Move to Split View
renderer crash — instrumentation in place since v0.6.7, awaiting
user-triggered repro), ENH-084 (aux pane focus glow v4 — needs a
live-click event-stream capture pass before any code change),
BUG-079 (⌃⇧\` tab-cycle latency — bumped to make room for BUG-122
this sprint), and BUG-122's deeper fix once the next production
repro leaves a log file behind.

---

## v0.6.14 — 2026-05-10 — Install-path hardening + browser-tab close fix (enterprise hotfix)

Two P0 fixes from the same enterprise-machine session, bundled into
a same-day hotfix.

**ENH-141** — the `duo` CLI was unreachable by name inside Claude
Code sandboxes because both install paths landed at directories that
aren't on PTY `$PATH`. The agent inside a sandboxed PTY could only
call `duo` by absolute path — the whole "Claude drives Duo" premise
breaks. The fix drops the CLI at `~/.claude/duo/bin/duo` (SHIM_DIR
— the dir `core/pty-manager.ts` already prepends to PATH for the
`claude` shim). Inside any Duo terminal `duo` now works immediately
with no `.zshrc` edit. The companion change folds the
previously-separate Add-to-PATH banner button into the [Install]
click, so external Terminal / iTerm sessions also get wired in one
action.

**BUG-121** — closing the last browser tab respawned a fresh
about:blank in a loop. Two guards (BUG-020 + BUG-096) in
`browser-manager.ts § closeTab` refused to drop below 1 main-strip
tab and spawned `about:blank` to fill the slot. Original BUG-020
motivation ("can't dismiss the boot-time FAQ tab") retired in
v0.6.13 (ENH-135) when the FAQ moved to `docs/legacy/`. The guards
kept firing anyway. Fixed by dropping both spawn-replacement paths
and making `tabs.length === 0` a supported empty state. Surfaced
during the ENH-141 session; an example of a deferred-motivation
guard that outlived its purpose by exactly one sprint.

**Why this lands as a hotfix and not a planned sprint.** Enterprise
users running Duo inside a managed Claude Code install were
structurally locked out by ENH-141 — even the workaround (manually
editing `.zshrc`) was blocked by the sandbox's dotfile write-deny.
BUG-121 was discovered while debugging ENH-141 (user closed an
about:blank that kept respawning). Holding either fix for normal
sprint cadence meant another week of broken sandboxed installs.

**What this is and isn't.**

This is a hotfix release — two narrowly-scoped P0 fixes, no new
capability, no schema changes. ENH-141 changed the `duo install`
tier-1 target from `~/.claude/bin/duo` to `~/.claude/duo/bin/duo`;
pre-ENH-141 stale symlinks are harmless (just unused files) and
will get cleaned by a future ENH-140 orphan-cleanup pass
(FOLLOWUP-013). BUG-121 is a behavior change for one specific edge
case (last browser tab close); a stuck about:blank from a prior
session-state can now be dismissed on upgrade without manual
intervention.

**Sprint 16 status.** ENH-141 + BUG-121 ship as commits 1 and 2.
Remaining candidates (BUG-119 fsevents quit-crash, ENH-140 install-
service orphan cleanup, ENH-137 Beginner's Guide content) carry
forward at the owner's pick.

---

## v0.6.13 — 2026-05-10 — Sprint 15: FTUX content → packs (install-pipeline reshape)

The owner adopted a clean partition between install-service plumbing
and FTUX-loadable content: install-service stays hand-rolled for the
load-bearing pieces (PATH shim, CLAUDE.md merge, SessionStart hook,
priming.md, provenance); FTUX content (What Duo Does today, future
Beginner's Guide) collapses into a new built-in lesson pack at
`packs/duo-default/`. The pack mechanism already handles every behavior
FTUX content needs (auto-open canvas, atomic-replace on upgrade, per-
pack-version re-fire, declarative pin intent). Sprint 15 establishes
the boundary; future content drops in trivially via canvas-add +
pack-version bump.

**Why this cut lands here.** Three months of FTUX-content additions
(FAQ, What Duo Does, default pins) had grown via a hardcoded JSON
literal in `install-service.ts:520-528`. ENH-134's planning playground
(2026-05-10) made the boundary visible. Owner picked NOW-SKELETON
migration: Sprint 15 creates the pack + migrates WDD now; ENH-137
Beginner's Guide drops in later via the same mechanism. ENH-135 (FAQ
removal) folds in — FAQ becomes the first "retired" piece of FTUX
content, banished to `docs/legacy/`. Plus two install-pipeline bug
fixes (BUG-118 cut-version stale-binary guard, BUG-116 dist-signed
DMG version pinning) that shipped from the v0.6.12 close-out tail.

**Four key design decisions baked in:**

1. **Partition along the FTUX-content boundary.** Plumbing in
   install-service; content in packs. Documented in
   `docs/research/dogfood-distro-packs-plan.html § 5` (Q1 ADOPT).
2. **`PackManifest.builtIn: true` flag.** Marks Duo's default pack as
   un-uninstallable without `--force`. Forward-compat — the existing
   `duo pack uninstall` operates on Stage 21d distro packs
   (`extra-packs/`), not Stage 28 lesson packs (`packs/`), so today's
   enforcement is declarative-only.
3. **Pack-canvas / pinned-tab idempotency contract.** Owner-raised
   during smoke walk: "stale Duos on upgrade won't see the new WDD."
   Two mechanisms (BUG-057 pin-restore + Stage 18b first-launch hook)
   cooperate via a `pins.json` membership check in the hook. Fresh
   installs see ONE WDD tab (pinned, no dupe); v0.6.12 upgraders see
   TWO (stale pinned + fresh new) and choose what to keep.
   Pack-version bumps re-fire for everyone. ADR at
   `docs/DECISIONS.md`.
4. **No file renaming per pack version.** Owner's first instinct was
   to encode versioning in filenames; the idempotency check +
   existing per-pack-version flag in `installed-packs.json` achieve
   the same semantic without it.

**What this is and isn't.** This is the boundary commit — the
mechanism for shipping FTUX content via packs. The Beginner's Guide
(ENH-137) is the first new content that lands via the mechanism;
that's a future-sprint deliverable awaiting owner-authored draft.
The PackManifest schema extension for markdown-editable +
markdown-locked kinds (ENH-139) is filed and deferred; gated on
ENH-137 picking markdown OR a future pack needing it.

**Known transient: upgrade users see two WDD tabs.** On first launch
after upgrade, the stale-content WDD pin (pointing at the v0.6.12
`~/.claude/duo/help/` copy that wasn't deleted) opens alongside the
fresh new WDD (via the first-launch hook). One-time friction; user
manually closes the stale one and optionally re-pins the new.
Cleaner upgrade migration (auto-rewrite stale pins.json URLs) filed
in `docs/dev/active-sprint.md § Sprint 15 carry-over` for a future
enhancement.

---

## v0.6.12 — 2026-05-10 — JSON/YAML viewer-editor · visibility CLI · view-source panel-fill · image-handling close-out

The JSON/YAML viewer-editor that was queued as v0.6.13 P0 pulled
forward — owner answered the §3a linting AUQ (tree + raw-text toggle
+ JSON.parse save guard) at walk-3 close-out and the build landed
same-day across walks 4 → 5 → 6 with iterative UX polish (Edit/Save
button labels, Revert affordance, banner contrast bump, inline
CodeMirror linter markers). Plus the visibility-tooling closure
(`duo dom`), the view-source surface fix (panel-fill, not modal),
and the long-overdue close-outs of two image-handling threads
(HEIC convert via macOS `sips`, PDF drops position-aware) and
the resurrected ENH-127 (`\x1b\r` is the byte Claude Code wants).

**Why this cut lands here.** The original Sprint 14 anchor was just
ENH-122 + FOLLOWUP-015 (ENH-117 v2). Owner kept pulling more in: the
Sprint 13 walk-3 backlog (ENH-127, ENH-128, ENH-129, ENH-119, ENH-130,
ENH-131, ENH-132) all consolidated into this sprint, then ENH-110 +
ENH-133 pulled forward same-day. By walk-3 the cut was blocked on
two items (ENH-128 HEIC genuine decode failure + a BUG-115 dialog
that turned out to be agent-behavior, not code). One session closed
both, plus the entire ENH-110 build, plus three iteration walks of
JsonView UX polish.

**Three load-bearing design decisions baked in.**

1. **`@uiw/react-json-view` Tier 3 chosen over Tier 2 (raw-text only)**
   per the ENH-110 decision-gate playground. Tier 3 (`@uiw/react-json-
   view/editor`) is interactive collapsible tree with click-to-edit
   values; Tier 2 would have been a CodeMirror-only experience. Tier 3
   is the right answer for the PM persona who opens API responses
   without wanting to read raw JSON. The raw-text toggle (Edit ↔ Save
   button) is the escape hatch for power-users.

2. **Single tab kind for JSON + YAML** with format implicit from path
   extension. Owner pick on the YAML cohabitation question — the
   alternative would have been a separate `kind: 'yaml'` tab. Single
   kind keeps the dispatch + classifier + state shape simpler; format
   discriminator is computed via `formatFromPath()` at the start of
   each render path. Round-trip for YAML is content-only (comments +
   anchors stripped on save) — documented limitation in skill/SKILL.md.

3. **`sips` shell-out as the HEIC fallback layer**, not `nativeImage.
   createFromPath`. The diagnostic ladder said try `createFromPath`
   first (cheap), but both `createFromBuffer` and `createFromPath`
   share NSImage's HEVC decoder under the hood — the bytes-vs-path
   distinction was unlikely to matter for HEIC. `sips` uses ImageIO
   directly and decoded the same iPhone HEIC source that NSImage
   rejected. Skipped the bytes-vs-path try-first per Occam's razor.

**JsonView walk-4 → 5 → 6 polish.** Walk-4 PASSed the core (open .json,
edit a value, autosave, reopen → persistence) but FAILed two:
need a revert affordance, error text needs guidance, "Source" button
should read "Edit." Walk-5 fixed the three; walk-6 added the
remaining "Tree" → "Save" rename (force-save on click) + bumped error
banner contrast (`text-red-100` over `bg-red-950/60`) + CodeMirror
inline error markers (red gutter dot + squiggly underline at the
parser-reported position + hover tooltip with the full message).
Owner walk-6: 3/3 PASS.

**`duo dom` saves blind-debugging time across the project.** Sprint
12's image-render diagnosis ate 90 minutes because we couldn't see
what was in the renderer DOM. Sprint 14 used `duo dom` to verify
ENH-117 v2's panel-fill mounted, ENH-119's image selection tint
applied, ENH-132's ARIA roles attached, and ENH-110's tree + source
toggle round-trip — each in seconds rather than 5–15 min of
hypothesis cycles. The verb is not user-facing, but the cluster
(`duo dom` + `duo layout` + `duo nav-state` + `duo devtools` from a
future cut) is a primary visibility primitive for agents working with
Duo over the socket.

**ENH-127 v2 is the working version.** v1 in v0.6.11 sent `\n` (Claude
submits on it). v2 sends `\x1b\r` — exactly what Option+Enter natively
sends — which Claude reads as "literal newline within composition."
Two intermediate fixes (one filtered to keydown only and got `\x1b\r`
+ a stale `\r` from xterm's keypress dispatch; the third returns
`false` on all event types and writes only on keydown). Now ships:
plain Enter = newline, `⌘Enter` = submit. Shell tabs unchanged.
ENH-133 builds on this — `Shift+Enter` joins plain Enter in the
newline branch.

**BUG-115 was agent-behavior, not code.** Walk-3 surfaced an
external-conflict dialog that LOOKED like a BUG-107 regression. The
3-byte content delta (vs. baseline) ruled out trailing-whitespace
normalize() drift. The fixture file's mtime confirmed it was
rewritten by smoke-walk prep WHILE the editor still held the prior
walk-rev's content. The dialog fired correctly — code is intact.
CLAUDE.md § 7d + memory rule landed: walk fixtures use unique paths
per rev, OR the prep step closes the editor's tab first. Removes
the entire class of false BUG-107 retests.

**What this is and isn't.** This is the close of two long-running
threads (image-handling polish from Sprint 12+13, ENH-127 from
Sprint 13's reverted-v1) AND the addition of a wholly new tab kind
(JSON/YAML viewer-editor). NOT in this cut: ENH-123 `duo devtools` +
ENH-124 `duo layout` (sister verbs to ENH-122 — coming Sprint 15),
the Obsidian backlinks panel cluster, ENH-082 Terminal Context Bar,
BUG-103 blockquote CSS leak (still 🟡 Open).

---

## v0.6.11 — 2026-05-09 — Paste-image v2 + auto-redistribute panes + view-source

The closing chapter of the image-handling arc that started in v0.6.10 — paste-image is now portable across machines (markdown source carries relative paths, not blob URLs). Plus three feature pulls owner directed mid-sprint: auto-redistribute on split-open (ENH-126), the on-demand 33/33/33 chord pairing (ENH-099), and a read-only view-source overlay (ENH-117 v1; v2 panel-fill queued as FOLLOWUP-015). Five race-class / state-tracking fixes that surfaced during the cut walks landed alongside.

**FOLLOWUP-014 paste-image v2.** v0.6.10 shipped paste-image as a workflow-unblock with a known trade-off: markdown source carried `blob:http://localhost:5173/<uuid>` URLs that died on doc reload. v0.6.11 closes the gap. Markdown source now carries `![](image-<stamp>.png)` (relative filename); the custom `DuoImage` NodeView at `renderer/components/editor/extensions/DuoImage.ts` resolves against the doc's parent dir via `files.read` at mount + hydrates a per-tab blob URL into the rendered `<img>`. The canvas surface mirrors via `imageHydrate.ts` (MutationObserver catches new `<img>` elements + walks the doc on mount) + a serializer hook in `serialize.ts` that swaps `src` ↔ `data-duo-original-src` at save time. Files survive reload, git commit, `cp` to another machine.

**Walk-2 surfaced two latent bugs**, both root-caused + fixed same-day:

- `lastSavedRef` re-baseline in PageTab was firing on every wire-effect re-fire (the wire effect's deps include `handleShortcut` → re-creates when `save` re-creates → re-creates when `dirty` flips). Inserting any content captured the post-insert DOM as the dirty-detection baseline → save saw `htmlChanged=false` → silent autosave no-op. Gated the re-baseline behind `baselinedRef` — fires once per path-mount only.
- `onImageInsert` IPC subscription raced across all mounted PageTab + MarkdownEditor instances; first reply won; image landed in the wrong file when session-restored tabs were present. Fixed by threading `isActive` through WorkingPane § renderFileTab and ref-gating both handlers. Same race shape repeated for `duo doc read` (BUG-112) — same fix.

**ENH-126 auto-redistribute on aux-open.** Owner-directed feature pulled in mid-sprint after escalation: opening a file in split view auto-redistributes columns. Terminal visible → 33/33/33. Terminal collapsed → main+split 50/50. Both code paths (file-aux `splitViewMoveTabByPath`, browser-aux `splitViewMoveBrowserTab`) trigger it.

**ENH-099 33/33/33 chord.** On-demand sibling of ENH-126. Same canonical layout helper; three triggers (`⌘⌥4` chord, View → Pane size menu entry, `duo split 3way` CLI verb). Walk-3 surfaced a gap (chord only touched file-aux's splitPct, not browser-aux's); walk-4 fix closed it. Now any aux kind (file or browser) gets the 50/50 inner reset.

**ENH-117 view-source v1 (modal).** ⌘⌥V opens a centered read-only modal showing the active surface's raw source (markdown body+frontmatter for editors; pretty-printed HTML for canvases). Active-surface gated. v1 ships as a modal because that composed cleanly with the existing surface architecture, but owner walk-3 surfaced that the intended UX is panel-fill (in-place toggle) + menu/tab-context entries instead of chord-only — that v2 is filed as **FOLLOWUP-015** for a future cut. Memory rule saved: *"ask about surface choice before display-shape decisions"* — don't default to architecturally-clean shapes when the owner's mental model is something else.

**ENH-125 canvas image insert.** Closes the v0.6.10 explicit `(c)-Deferred` parity disposition. PageTab subscribes to the same IPC; canvas tab now responds when active. CLI verb works against either surface.

**BUG-101 v2 — `duo edit` auto-focus** + **BUG-112 — `duo doc read` no-path race fix.** Two race-class fixes in the same family. v2 of BUG-101 corrected a Sprint 9 React semantics assumption (`setState` updaters run at commit, not synchronously). BUG-112 closed a quiet IPC routing race using the same `isActive` gate pattern from ENH-125.

**ENH-116 smoke-walk skill trim.** SKILL.md was 604 lines and getting truncated at runtime, dropping HARD RULES from Claude's working context. Trimmed to 241 lines (60% reduction); detail moved to four reference docs at `.claude/skills/smoke-walk/references/`.

**ENH-127 declined-v1.** Implemented per-Claude-tab `Return → \n` / `⌘Return → \r` intercept; live test confirmed Claude Code's input loop treats `\n` and `\r` identically at the line-discipline level. Renderer-side intercept can't deliver the desired UX. Reverted; tasks.md entry documents four future paths (Claude Code adds raw-newline mode, Duo-side composer window, anti-accidental-submit heuristic, etc.).

**What this is and isn't.** This is the closing chapter of the image-handling arc — paste-image is portable now. It also lands the long-asked-for split-pane auto-redistribute + the chord pairing. NOT in this cut: ENH-117 v2 panel-fill (queued as FOLLOWUP-015), ENH-127 working version (filed declined; future paths documented), ENH-118/119/120 image-handling polish cluster (queued), ENH-122/123/124 visibility-tooling CLI cluster (queued), ENH-110 JSON viewer (queued).

---

## v0.6.10 — 2026-05-09 — Image handling (paste / view / CLI) + Save clarity + Obsidian autocomplete

**Three sprints in one cut.** Save clarity (Sprint 10), Obsidian autocomplete (Sprint 11), image handling (Sprint 12) accumulated since v0.6.9. Sprint 12 was course-corrected mid-flight when the prior cloud agent shipped image VIEWER chrome (ENH-111) instead of paste-image (ENH-108, the actual ask) — local Claude shipped ENH-108 alongside before the cut fired. Both ship together.

**Why this cut lands here.** v0.6.9 closed wikilinks (rendering + cmd+click); v0.6.10 closes the workflow-defining gap of "paste an image into a doc and it just works." Pre-v0.6.10 path was save-to-Desktop → drag-to-Finder → markdown-link-by-hand. Post: ⌘V works in both markdown editor and canvas; `duo image insert` works from the agent. Plus Save clarity (SaveControl pill + autosave toggle) and the Obsidian-style `[[` / `@` / ⌘O autocomplete cluster.

**Three load-bearing design decisions baked in.**

1. **One TipTap Suggestion primitive backs all autocomplete** — `vaultIndex.ts` (fuzzy match) + `SuggestionPopover.tsx` (rendering) are shared by `[[`, `@`, and ⌘O. Three features, one architectural piece.

2. **`@` mention inserts canonical `[[wikilink]]`** — vault round-trip stays unified regardless of which trigger produced the link. Obsidian-compat first.

3. **Paste-image v1 trades source-portability for ship velocity** — blob URLs in markdown source (`![](blob:...)`) render immediately on paste but die on reload. v2 (custom NodeView with persistent abs paths, FOLLOWUP-014) is queued. The trade-off was deliberate after ~90 minutes of debugging revealed the cross-origin / CSP / blob-URL layering — getting the user-visible feature out beat shipping the architecturally-pure version this sprint.

**Sprint 12 retro fix shipped:** ENH-121 — renderer console forwarder. Every `console.*` from the renderer now prints to dev stdout. Single highest-leverage observability addition this year; Sprint 12 walk-rev3's 90 minutes of futile hypothesis-test cycles would have been ~5 minutes with this in place. Memory rule landed alongside: when debugging blindly past ~15 min, build the missing observability primitive *before* the next hypothesis cycle.

**Skill rule from Sprint 11 still applies:** CLAUDE.md § 7c + smoke-walk skill § 5b — agent must verify clean app state before every smoke-walk handoff. Sprint 12 walk-rev3 retro added "exercise the worksheet primitive itself first" as a § 5b sub-step (catches the BUG-110-class storage-key collision before the user's edits silently vanish).

**What this is and isn't.** This release is "image handling reaches v1" + "wikilinks reach completeness" + "save UX consolidates." It is NOT yet the image-handling polish (selection tint, clipboard-preserves-bytes, GIF/SVG discussion), the JSON viewer, or the backlinks panel — all queued for Sprint 13+. The CLI verb covers markdown-editor target only; canvas-CLI parity is ENH-125 carry-over. Two sprint-12 items shipped without a final smoke walk (canvas paste-image + drop, `duo image insert` CLI verb) — Geoff cut on faith after the markdown-side variants passed walk-rev4. Items preserved in `docs/dev/v0.6.10-walk-carryover.md` for next sprint's smoke walk.

**Stats:** 4 commits since v0.6.9 + ~6 mid-cut commits this sprint. Typecheck clean. CLI verb self-tested end-to-end. Walk-rev4 PASSED for ENH-108 + ENH-111 in normal-pane layout. Mid-day diagnosis of the image-render bug was 90 minutes of layered hypothesis chasing (file:// → custom protocol → CORS → CORS headers → CSP → blob URL); actual root cause was a layout misread (split-view squish). Three layers of fixes landed regardless as insurance against the genuine issues each was hunting.

---

## v0.6.9 — 2026-05-07 — Sprint 9: wikilinks closure · pane-jump chord set · `duo edit` reliability · workshop substrate · automated regression coverage

## v0.6.9 — 2026-05-07 — Sprint 9: wikilinks closure · pane-jump chord set · `duo edit` reliability · workshop substrate · automated regression coverage

**The half-feature is closed.** v0.6.8's wikilink rendering was a Sprint 9 P0 by directive — Tier B1 shipped the visual decoration, but cmd+click was a no-op, and a styled-clickable-thing-that-doesn't-click is worse than nothing because users learn to mistrust the affordance. Three walks of fixes landed. Walk-0: the click handler bailed because `event.target` is a Text node when the click hits visible text inside the decoration span — `closest` is undefined on Text nodes; the optional chain returned null. Extracted `resolveWikilinkTargetAtClick` that walks up via `parentElement` + falls back to a pos-based decoration lookup using ProseMirror's `PLUGIN_KEY.getState(view.state).find(pos, pos)`. Walk-1: the FIX worked (owner's console log proved the click reached the resolver), but the resolver couldn't find the vault root — `findVaultRoot` was calling `files.exists` to detect `.obsidian/`, and `files.exists` strictly returns true only for regular files (BUG-039 semantic preserved for session-restore). Added a `files.dirExists` IPC sibling. Walk-2: PASS. cmd+click on a `[[Other Note]]` opens the linked file from the vault.

**A new chord vocabulary for keyboard-first navigation.** ⌘⇧L → terminal · ⌘⇧; → main working pane · ⌘⇧' → split-view aux. These JUMP focus directly to a named pane, distinct from `⌘\`` which CYCLES — useful when you want to land somewhere specific without arrowing through every intermediate state. Three walks worth of refinement: walk-0 specced the chord as ⌘⌥L/;/' (system-level window managers like Raycast intercept meta+alt before the renderer sees it; re-picked to ⌘⇧L/;/'), walk-1 added the matchers + dispatch + browser-pane allowlist + `duo focus-pane` CLI parity, walk-2 surfaced a deeper bug — focus changed React state but caret didn't follow because BUG-046 keeps every file-tab renderer mounted simultaneously (display-toggled). Selectors hit a hidden tab; `.focus()` on a `display:none` ancestor's contenteditable silently fails. Built `findVisibleWorkingPaneCE(scope)` that filters by `offsetParent !== null` AND scopes to inside-/outside-aux via a new `[data-duo-workingpane-aux]` marker on the aux container. Same helper now backs the chord set AND `openFile`'s post-rAF .focus() — closing the editor-routed half of BUG-101 in the same diff.

**`duo edit` is finally reliable.** Three layers of latent bug surfaced over walks 0–2. (1) React anti-pattern: `setActiveWorking` was nested inside `setFileTabs`'s updater, letting React 18+'s automatic batching land the inner setter in a different render than the tab addition. Lifted to a `pendingActivationRef` + post-updater flush. (2) DOM-level `.focus()` on the editor's contentEditable wasn't firing — added the same two-rAF chain `newBrowserTab` uses for the address bar. (3) The selector race from above. End-to-end: `duo edit /tmp/foo.md` reliably surfaces the new tab AND the caret lands in the editor; first keystroke writes into the file. Walk-3: PASS ("carat landed!"). The browser-routed half (`duo open https://...` not surfacing reliably) is the same shape on a different code path; carries to Sprint 10.

**The recurring regression goes from manual walk to CI test.** BUG-056 — the in-page Send → Duo pill must NEVER render without an active Claude session — has recurred across multiple walks because the gating (`if (!window.__duoClaudeLive)` inside the CDP-injected IIFE) was tested only by manually walking the negative case on every cut. Walk-2 owner: *"WHY AM I SEEING THIS IF YOU TEST IT AND IT PASSES DON'T SHOW ME THIS."* Made `SELECTION_OBSERVER_IIFE` exportable and added `electron/cdp-bridge.test.ts` with three asserts on the source string: the literal guard text exists, it sits before `ensurePill()` (so the pill never mounts before the gate fires), and there's exactly one active code-site read (excluding doc comments). Three tests, green. Removed from the smoke-walk skill's "Mandatory regression items" section + added a hard rule against re-listing items with automated coverage. Future refactor breaks fail CI; the manual walk doesn't have to.

**Plus a quiet pile of paper-cut fixes.** ⌘T new browser tab — owner's diagnostic showed DOM focus on the address bar but caret grey/inactive (OS focus on the WCV). Calling `keyboard.reclaimFocus()` before the rAF chain pulls OS focus from the WCV to the renderer; URL bar caret renders active. ⌘⇧⌫ now deletes the active file with confirm (mirrors the right-click → Move to Trash flow; soft-success on ENOENT). And the **Distro Pack Builder Workshop** scaffolds: a repo-only `distro-pack-builder/` folder with scoped CLAUDE.md, README, 11-step playground.md, and a project-scoped assistant skill that activates when Claude Code is open with cwd inside the workshop. Defers to the canonical global `/pack-builder` skill for mechanical work; adds the layered tutorial pacing first-time builders need.

**Owner-blessed deferral: ENH-091 caret seed for fresh canvases.** Two prior fix attempts (v0.6.8 and Sprint 9 walk-1) didn't move the live behavior. Walk-2 traces showed the seed APPLIES correctly AND sticks across the next animation frame — but typing still lands in the H1 title. The override fires AFTER rAF, after Chromium's internal layout pass, which is unfixable without a different architectural approach (e.g. handling the first keystroke ourselves, or rebuilding the canvas DOM so there's no H1-first-focusable surface). Owner directive: *"low priority, do not revisit for a LONG time unless the console provides a smoking gun and obvious fix."* Diagnostic instrumentation stays in code for whoever picks this up later.

**What this is and isn't.** v0.6.9 closes Sprint 8's loose ends + ships the chord vocabulary that makes keyboard-first navigation feel coherent. It's not the cohort-distribution release — that still waits for a real non-Geoff machine to install Duo + a real distro pack + use it end-to-end. The workshop substrate is in place; ENH-112's verification owed when a real builder walks the playground. Sprint 10's queue: BUG-101 browser-routed half · BUG-100 Send→Duo pill in split-view aux · BUG-104/105/106 (walk-3 surfaced — file-changed dialog after chord, right-click Copy path no-op, `duo edit` non-existent path ENOENT) · ENH-114 cmd+click on missing wikilink → create file (Obsidian parity, owner-requested via walk-2 OTHER NOTES).

---

## v0.6.8 — 2026-05-06 — Sprint 8: Stage 21d cohort distribution + ⌘⇧A palette + Obsidian wikilinks + canvas modality lock

**Stage 21d ships.** v0.6.8 is the cut where Duo turns from a personal tool into a substrate that an early-adopter cohort, an enterprise team, or an open-source community can actually build on. Drop a folder into `~/.claude/duo/extra-packs/`, restart Duo, and your distro's skills + agents + canvases + CLAUDE.md guidance auto-install — atomic-replace, version-gated, uninstallable. The `pack-builder` skill walks authoring; the sample template scaffolds in five minutes; HOW-TO-FORK Layer 2.5 documents three distribution paths (`.pkg` installer for IT, drop-in zip, fork+compile for pre-DMG-approval shops). The architecture decision that took four AUQ rounds to lock: source format is canonical Claude Code plugin shape (`.claude-plugin/plugin.json` + `skills/<name>/SKILL.md` + `agents/<name>.md`) with a `duo-extras/` subtree for Duo-specific bits; install destinations are standalone-skill paths (`~/.claude/skills/<distro>-<name>/`) so the skill works in EVERY Claude Code session on the user's machine, not just sessions launched from Duo.

**Three feature surfaces ride alongside.** ⌘⇧A is now the quick-switcher across every open tab — file + browser, including aux. Wikilinks render as styled clickable spans in the markdown editor (Tier B1 of Obsidian-vault-friendly editing, with the sidecar convention documented in the FAQ). `duo edit --canvas` is the modality override for editing a playground's source — the meta-tag-vs-canvas tension that's been latent since Stage 27 finally has a clean affordance. Plus three Phase-0 polish items: ENH-091 caret seed (partial), BUG-097 placeholder fix, and the FOLLOWUP-008 Tailwind RGB-triplet migration that lets `bg-accent/N` opacity modifiers actually compose.

**The walks turned over four real bugs.** Walk-1 found two that never made it to ship: the autosave/watcher race (BUG-099) that was firing the conflict banner during normal typing, and an ⌘⇧A palette that worked from terminal focus but not browser-pane focus — both root-caused + fixed in walk-1 follow-up commits. Pre-walk-2 found the Stage 21d uninstall path was leaving CLAUDE.md blocks orphaned and the provenance manifest stale (both fixed in the same session). Then the user found two Duo instances running side-by-side — packaged `/Applications/Duo.app` v0.6.7 was competing with the dev session for the socket, ambiguating CLI routing — and that the `cli/duo` binary had regressed at some point to a pre-Sprint-8 build. Both untangled before the cut.

**Three known issues ship.** ENH-091 (caret on fresh canvas) had two fix attempts that didn't move the live behavior — the unit tests pass, the live iframe doesn't follow. Diagnostic plan recorded; next sprint. ENH-096 wikilinks render perfectly but cmd+click navigation is still routing wrong somewhere between the WikilinkDecorations handleClick and App.tsx's listener — owner blessed shipping the visual but flagged the half-feature as **Sprint 9 P0**: close the click handler OR strip the decoration entirely (false affordance worse than no affordance). Plus BUG-100/101/102 — known shape, non-blocking.

**What this is and isn't.** v0.6.8 is the substrate cut. It's not the cohort-distribution release: that comes when an actual non-Geoff machine installs `Duo.app` + a real distro pack + uses the agent loop end-to-end. The plumbing is in place. The next sprint's job is to (1) close ENH-096 wikilinks to a fully-working state, (2) chase ENH-091 caret in the live iframe, and (3) find a real distro use case (Acme starter pack? a community-built lesson pack?) and walk the cross-machine flow.

---

## v0.6.7 — 2026-05-05 — Sprint 6 + Sprint 7: comments on both surfaces, browser tabs in Split View, terminal paste behaves, arm64-only

This is the cut that v0.6.6 owed. The post-v0.6.6 conversation surfaced that comments on the canvas had regressed AND the markdown editor's comment surface (Stage 14a / MISSING-001) had never been built despite always being "next." Sprint 6 was the four-phase repair. Sprint 7 layered on the Split View fix that v0.6.6's worksheet-in-canvas workflow had quietly forced (BUG-092 — Phase 3c), the terminal paste fix that surfaced during the rev3 walk (BUG-094), and the arm64-only distribution policy. The cut held until rev6 walked clean — and in that walk, three rev6 FAILs (BUG-088 / BUG-090 / BUG-087) revealed a single deeper root cause: contentEditable's `<li>` cloning on Enter was inheriting the source bullet's `data-duo-id`, so multiple bullets shared one anchor. Same-session fix in `installAutoStampIds` re-stamps duplicates on insertion; everything downstream of "anchors are unique" passed verification end-to-end.

**Why this lands here, not earlier.** The v0.6.6 cut was the wrong shape for these changes — it would have shipped the canvas comment regression as "fixed in code" without the markdown side, and without the Split View flow that worksheets depend on. By the time Phase 3c (browser-in-aux) was scoped, the right thing was to hold the cut until both surfaces had comments AND worksheets stopped being silently broken in split view.

**Two key design decisions baked in.**

1. **Comments are an iframe-side concern, not a parent-doc concern.** Stage 17's canvas iframes are `srcdoc` documents — parent `globals.css` doesn't reach them. Pre-Sprint 6, the comment badges had been rendering as plain "1" text inside canvases because the badge styles only existed in the parent. The Sprint 6 fix injects `installCommentAnchorStyles` into the iframe at ready-time (mirroring the existing `installJustAddedStyles` pattern). Same applies to the new `[data-duo-has-comment]` decoration. This means iframe-side styles + parent-side styles must stay in sync manually — the trade is worth it because it keeps the canvas surface independent of parent-doc styling drift.

2. **Anchor uniqueness is the root invariant.** The bullet-decoration bug looked like a list-tag injection issue (BUG-088 hypothesized "extend `injectIds` to include `LI`" — but `<li>` was already in the walk). The real bug was that contentEditable clones an `<li>` on Enter and the new sibling inherits the `data-duo-id`. The MutationObserver would see "an existing id, skip" — preserving the duplicate. Once the auto-stamp detects duplicates and re-stamps later siblings, BUG-087 (rail-click activates "first and third bullets, not the middle") fell out as a consequence: with three li's sharing one id, the active-attribute selector matched all three; with unique ids, only the right one. The fix is general — it covers Enter-split, paste-of-stamped-fragments, and undo/redo flows.

3. **Browser tabs and file tabs are different surfaces.** Phase 3c's BUG-092 fix could have routed worksheets through the canvas with `<meta name="duo-editable" content="false">` (and the rev2 cut tried that — it's still wired as a defense-in-depth measure). But canvas iframes are `sandbox="allow-same-origin allow-popups allow-forms"` — no `allow-scripts`. Worksheets need scripts. The right architectural fix was to make the aux slot tab-kind-aware: a browser tab pinned to aux stays a real Chromium WebContentsView, just repositioned. Type-discriminated `auxState` + `auxBrowserTab` + a separate `<AuxBrowserSlot>` component keeps the two paths clearly delineated.

**arm64-only is a distribution simplification, not a deprecation.** Apple Silicon is ~3 years into broad availability; the Intel users running Sequoia + auto-update are essentially zero. Cut times drop ~50% per release (one notarization round-trip), local + remote storage frees up by ~4.5 GB, and the test matrix shrinks. If x64 is ever needed again, adding `- x64` back to `electron-builder.yml`'s `mac.target.arch` is one line; everything else (cut-version skill, scripts, validators, release upload glob) honors it without further changes.

**Observability deserves a callout.** This cut also lands the BUG-093 instrumentation — ErrorBoundary `inline` + `label` + Try-again, structured `[BUG-093]` traces in `splitViewMoveTabByPath`. The renderer-crash-on-right-click-to-split that surfaced in rev3 is now scoped (a render error in WorkingPane no longer drops the entire renderer to the app-level error page) AND will name itself when it next fires. The bug isn't fixed; it's diagnostic-armed.

**What this is and isn't.** This is the comment-system cut. Markdown editor and HTML canvas now have full comment-surface parity (kb / right-click / toolbar / persistence / re-anchor / visual association / bidirectional click-to-focus). It's also the Split-View-actually-works cut — worksheets, smoke walks, and dashboards live in real Chromium tabs on either side of the divider. **It is not a 1.0 candidate** — BUG-093 (right-click crash) still awaits root-cause; BUG-097 (markdown placeholder wraps narrow) is filed but unfixed; the comment-anchor reconciliation across markdown edits has the basic excerpt + context match but lacks `@testing-library/react` regression coverage (FOLLOWUP-009). Next sprint candidates queue here.

---

## v0.6.6 — 2026-05-04 — Sprint 5: ENH-094 closes the live-event gap; Stage 19e closes (managed CLAUDE.md + vocab + enterprise ref); ENH-092/093 retired as framework-overreach

The cut absorbed two arcs. The Sprint 5 core was a framework-overreach reframe followed by a single targeted plumbing ship; Stage 19e closure landed alongside as a coherent user-context-onboarding chapter.

### Sprint 5 — playground primitives reframe

v0.6.5 set up Sprint 5 for a 2–3 sprint "playground primitives initiative" (ENH-092 state → ENH-093 composition → ENH-094 CDP injection → ENH-043 refactor). v0.6.6 ships only **ENH-094** plus the smoke-walk decorator update, and closes ENH-092/093 as won't-do.

The reframe happened mid-sprint. After committing characterization tests, a v1 PRD with 7 design tradeoffs, and a v2 PRD with a "reframe around events" pivot, the owner pushed back: this was building a frontend dev framework. Future-Claude is a capable coder; the existing 376-line `make-playground.md` skill already documents the vocabulary; primitives that pre-chew Claude's meal just get bypassed when the ceiling proves too low. The actual missing piece was that the playground runtime didn't reach browser-pane pages.

ENH-094 fixes that single gap: a `PLAYGROUND_RUNTIME_IIFE` parallel to `SELECTION_OBSERVER_IIFE` and `PATH_LINK_FORWARDER_IIFE`, captures `data-duo-action` clicks page-side, ships them through the shared `parseActionFromAttrs` (extracted to `shared/`) → BrowserManager → IPC → `handlePlaygroundAction`. Trust posture: the page-side IIFE only attaches on `file://` URLs; the host-side path-rooted gate was dropped because it would have blocked smoke walks at `/tmp/duo-walks/` and the user explicitly framed the threat model as local-first. End-to-end validation passed in dev: `typeof window.duoPlaygroundAction === 'function'`; a 3-event sequence with change-of-mind via `duo eval` showed all three events landing in `duo events` in order with sequential cursors.

### Stage 19e — user-context onboarding hardening, closed

Three coordinated changes that close the gap between "the owner's Duo fluency" and "what end users actually get from the installer."

**ENH-088 — Managed Duo block in `~/.claude/CLAUDE.md`.** The installer now writes a hook-independent block (`<!-- duo:managed-vX.Y.Z -->`) into the user's global CLAUDE.md on first launch and version-aware-replaces it on upgrades. This is the load-bearing path for Duo awareness in non-`DUO_SESSION` Claude Code sessions (Terminal.app, iTerm, VS Code, agent worktrees) and in enterprise installs where hooks are policy-disabled. The block lands inside CLAUDE.md, which Claude Code's core context loader reads on every session start regardless of policy. Insert/replace/respect-removal logic mirrors `mergeSessionStartHook`; pure decision logic in `planClaudeMdMerge` + `composeManagedClaudeMdBlock` is exported from `install-service.ts` for unit testing (13 tests cover all four PRD scenarios). The sticky `claudeMdManaged` flag on `installed.json` distinguishes "user removed our block" from "first-time install" — once removed, never re-added.

**ENH-089 — Vocabulary lift.** User-facing page/playground/lesson vocabulary moved from project `CLAUDE.md § Glossary` (which only ships with the source repo) into `skill/references/vocabulary.md` (which ships with the skill installer). Both `make-page.md` and `make-playground.md` previously cited `CLAUDE.md § Glossary` as canonical — end users following the pointer landed at a doc they couldn't read. The new shipped reference closes that.

**ENH-090 — Enterprise-deployments reference.** New `skill/references/enterprise-deployments.md` documents the mechanism dependency map (which Duo features need hooks vs. don't), common enterprise restrictions (hooks disabled, restrictive Bash allowlist, locked `~/.claude/`, custom CLAUDE.md authority), what works hook-free, and a reporting checklist. ENH-088's managed block links to this doc so users hitting policy issues land here directly.

Plus two smaller items: **BUG-080** fixed bold text rendering as near-black in the markdown editor's dark mode (Tailwind typography default override). The `make-playground.md` skill gained a "Browser-pane playgrounds" section documenting the canvas-vs-browser-pane choice and the `window.duoPlaygroundAction` escape hatch.

### Why this lands here, vs. earlier or later

The Sprint 5 work alone could have cut. Folding in Stage 19e made the cut more coherent — both arcs are about "Claude reaching the user's actual environment cleanly." ENH-088 in particular benefits from being committed alongside the skill changes (ENH-089 + ENH-094 + the make-playground.md update) since they all interact with the same skill installer surface, and the managed CLAUDE.md block now references the new enterprise-deployments doc.

### Key design decisions baked in

1. **The managed CLAUDE.md block is hook-independent BY DESIGN.** SessionStart hook (Stage 19b) is the redundant in-Duo safety net; the managed block is the load-bearing primary path for everything else. Documented in the Stage 19e PRD as a load-bearing design property so future contributors don't accidentally regress it.

2. **`planClaudeMdMerge` is pure and exported for testing.** No Electron coupling in the four-scenario decision logic — the I/O wrapper `mergeUserClaudeMd` is the only Electron-tied part. 13 unit tests against the pure helpers in `electron/install-service.test.ts`.

3. **The `window.duoPlaygroundAction` escape hatch is part of ENH-094's contract.** Intentionally callable from inline JS, not only from the IIFE delegated click. Closing it would force every interaction through `<button data-duo-action>` ceremony — wrong shape for `change` / `input` / `blur` events, and the kind of restrictiveness that drives Claude to bypass the abstraction entirely.

4. **No host-side trust gate for the new browser-pane runtime.** Stage-23-era `~/.claude/duo/`-only check would have blocked the primary use case (smoke walks at `/tmp/duo-walks/`). The IIFE's `location.protocol === 'file:'` guard is sufficient; matches the existing path-link forwarder posture. Canvas-iframe gate stays as-is — separate decision for a separate threat model.

5. **The smoke walk's existing inline JS stays.** State save/restore + tally + composition are appropriate page-specific code, not primitive material. The decorator added in this cut is ~10 lines on top of that.

### What this is and isn't

This **is** the close of two coherent chapters: the Sprint 5 playground reach + Stage 19e user-context onboarding.

This **is not** ENH-043 closure — the worksheet retains inline JS for state/tally/composition; the decorator only adds live-event capability for the in-Duo case. The full declarative-HTML refactor that ENH-043 originally framed may not be a future cut at all.

This **is not** the canvas-iframe trust-gate decision. The existing `~/.claude/duo/`-only gate stays as-is on canvas; ENH-094's posture is a separate decision for the new browser-pane path.

### Stage flips

- **Stage 19e** — ✅ Closed. All three phases (ENH-088 + ENH-089 + ENH-090) shipped.
- **Stage 23 (Canvas actions)** — extends to browser pane via ENH-094.

---

## v0.6.5 — 2026-05-04 — Sprint 4 close-out: canvas → page rename · navigator + Split View polish · markdown trigger family · FAQ-on-launch fix · ROADMAP.md retired · playground architecture initiative filed

The ship of three accumulated chapters. The v0.6.3 chapter never cut (Stage 17 / canvas-authoring polish). The v0.6.4 chapter never cut (Sprint 3 — Split View v1 + idle-thoughts sweep + Vitest framework, blocked at walk-1 on BUG-074 light-mode contrast + BUG-075 chord regression). Sprint 4 absorbed both, fixed the cut blockers, and added its own arc: a deep mechanical rename of the canvas → page/playground/lesson hierarchy (177 edits, zero behavior change), a navigator close-out (Finder-style selection took three v1/v2/v3 attempts before it stuck), a Split View Phase 3 close-out (chord re-pick from `⌘\` to `⌘/` after 1Password's autofill grab made `⌘\` unreachable), a tab-cycling fix, and the markdown trigger family — including a BUG-072 root-cause discovery that surfaced TWO pre-existing canvas issues (`MAIN` missing from `BLOCK_TAGS`, `defaultParagraphSeparator` not set to `'p'`) that had been silently breaking trigger detection whenever content sat outside the boilerplate's lone `<p>`. Plus BUG-078 — the FAQ tab opening on every launch despite being closed — fixed by gating both the constructor's boot-default AND BUG-057's default-pin auto-restore on `!hasPersistedSession`.

This cut also retires `ROADMAP.md` (the synced markdown view drifted from canonical `docs/roadmap.html` in practice; maintenance tax exceeded value). Three unique sections — Number history (the 2026-04-26 renumber map), Layout commitment (three-column ADR), Open issue → stage mapping — extracted to `docs/dev/roadmap-history.md`. CLAUDE.md and 25 file references rewritten to point at the canonical HTML.

### The architectural pivot — playground primitives initiative filed for v0.6.6

The most consequential change in this cut isn't a feature; it's a decomposition. ENH-043 (originally framed as "the smoke-walk skill should be re-buildable via canvas/template primitives") was about to close as scope-evolved. Owner pushback during the post-Phase-5 walk reframed it: **the smoke-walk skill MUST be expressible via playground primitives — and if it can't be today, the playground vocabulary itself is broken.**

The walk diagnosed three concrete gaps. (1) Today's playground vocabulary is one-shot host actions (`claude:spawn` / `terminal:send` / etc.) — no state, no DOM reactivity, no composition, no clipboard. Smoke walks need all four. (2) The playground action runtime lives in the canvas iframe's `contentDocument`; it doesn't reach browser-pane pages. Smoke walks must run in browser tabs (they need `<script>` execution privileges canvas tabs don't grant). (3) These aren't sandbox-imposed dead ends — they're vocabulary + runtime gaps to fix.

Filed as ENH-092 (state + DOM-reactivity primitives) → ENH-093 (composition + clipboard) → ENH-094 (CDP injection of the playground runtime into browser-pane pages, parallel to existing Send → Duo + path-link injections) → ENH-043 reframed as the meta-tracker that closes when the refactor of `worksheet/generate.mjs` to pure declarative HTML lands. Likely 2–3 sprints; may warrant a dedicated Sprint 5 = playground primitives. The same primitive set will eventually power lesson canvases, agent-generated dashboards, smoke walks, sprint-plan worksheets, retros, triage forms — one runtime contract across surfaces.

### Why this lands here, vs. earlier or later

v0.6.3 should have cut after the Stage 17 / canvas-authoring polish landed. Owner direction was "no cut yet, accumulate." Sprint 3 absorbed the chapter into v0.6.4. v0.6.4 should have cut after Split View v1 + the idle-thoughts sweep + Vitest. Walk-1 (2026-05-04 morning) found 4 cut blockers (BUG-074 light-mode contrast, BUG-075 chord regression, plus two minor) and the cut was deferred. Sprint 4 fixed all four plus the deeper canvas issues that surfaced during Phase 5's smoke walks. v0.6.5 cuts now because (a) every cut blocker is closed, (b) 134/134 vitest tests pass, (c) the architectural reframe of ENH-043 is filed in detail so the next sprint has a real plan, and (d) the changeset has accumulated long enough that further deferral risks losing the narrative thread between commits.

### Key design decisions baked in

1. **Hand-rolled blockquote trigger.** BUG-072 went through three iterations. v1 used `execCommand('formatBlock', '<blockquote>')` + a separate exit handler; the formatBlock execCommand replaces the current block's tag rather than wrapping (Chromium quirk), so text landed directly inside the blockquote with no `<p>` child. v2 hand-rolled `<blockquote><p></p></blockquote>` but Chromium's caret-snap quirk bumped the caret out of the empty `<p>` to the parent. v3 added a `<br>` filler — the standard contentEditable trick — to anchor the caret. Decision recorded inline in `markdownShortcuts.ts § convertEmptyBlockToBlockquote`.

2. **`MAIN`/`ARTICLE`/`SECTION` belong in `BLOCK_TAGS`.** Pre-fix, when the user's caret leaked into a `<span>` directly inside `<main>` (which happens any time content sits outside the boilerplate's lone `<p>`), `findBlockAncestor` walked all the way up to `<body>` because none of `[P, H1-6, BLOCKQUOTE, PRE, LI, DIV]` matched. The matcher then tested `body.textContent` (entire document) against `^>\s$` — never matched, trigger silently dropped. This was the root cause that masqueraded as a Phase 5 regression but had been latent since canvas inception.

3. **`defaultParagraphSeparator='p'` on canvas init.** Chromium's contentEditable defaults to `<div>` for new paragraphs. When the caret was inside a `<span>` directly under `<main>` (no `<p>` wrapper), pressing Enter created a sibling `<div>` — but Chromium routed it to the `<main>` level instead of the span level, producing a NEW `<main>` sibling. Each subsequent Enter stacked another `<main>`, and each new `<main>` inherited the boilerplate's `padding: 48px 24px 96px` — that's where the "huge paragraph spacing started halfway through the test" report came from. Setting the separator to `<p>` short-circuits this entirely.

4. **FAQ-on-launch: session is authoritative; default-pin restore is fresh-app-only.** The original BUG-057 design ("pinned tabs always come back") predates working session restore. With Stage 21c Phase 2's session restore in place, the persisted session is the authoritative source of "what tabs were open." Auto-restoring default-pinned tabs (FAQ + What Duo Does) on top of the restored session resurrected tabs the user explicitly closed. New rule (owner-stated): "boot load only on fresh app; skip if prev tabs persisted."

### What this is and isn't

This **is** a major cut — three sprint-chapters' worth of work, plus a fundamental terminology rename (canvas → page/playground/lesson) that touches 32 files, plus the retirement of a load-bearing doc (ROADMAP.md). It also reframes a long-pending ENH (043) into a real architectural initiative.

This **is not** the playground primitives implementation. ENH-092/093/094 ship in v0.6.6+ (likely a dedicated sprint). v0.6.5 lays the architectural plan but doesn't write the code. Today's smoke walks still run on the same custom-JS worksheet generator they did in v0.6.4 — only the plan to fix that has been formalized.

### Stage flips

- **Stage 17 (HTML canvas)** — adds the v0.6.5 ENH-052 page rename + BUG-072 root-cause fixes to the status-line.
- **Stage 19** — 19e PRD landed (ENH-088/089/090 — sprint candidate for v0.6.6+).
- **Stages 11 / 12 / 15 / 17a-polish** — class corrections (`inprog`/`pending` → `done`), already accurate per their own status-line text but the wrapping article class was stale.

---

## v0.6.4 — 2026-05-04 — *(absorbed into v0.6.5; never cut as a separate release)*

The Sprint 3 chapter — Split View + idle-thoughts sweep + first regression tests. Headline content preserved here for historical context; cut narrative folds into v0.6.5 above.

### v0.6.4 (in-progress) — Split View + idle-thoughts sweep + first regression tests

The v0.6.3 chapter never cut — owner direction was "no cut yet, accumulate until the chapter feels closed." Sprint 3 expanded that chapter with the **Split View** capability (the canvas can hold two files side-by-side), an idle-thoughts sweep that closed eight smaller items at once, and the first **Vitest** regression-test suite to lock in the BUG-061 markdown-trigger class. The combined release is v0.6.4. The detailed v0.6.3 work below stays (it all ships under v0.6.4); Sprint 3 highlights summarized first.

**Sprint 3 — Split View + sweep + tests (added 2026-05-03):**

1. **Split View v1** (ENH-041 — Phase 3a + 3b + 3c-i). The canvas (right pane) can host two files side-by-side: a "main" pane on the left with the existing tab strip, plus an "aux" pane on the right with a single file (multi-tab aux is queued for v2). Open via `duo split-view open <path>`, the right-click "Move to Split View" / "Open in Split View" entries on tabs/FileTree/PinnedNav, the `⌘\` chord (move active main tab → aux), or the per-page `<meta name="duo-path-target" content="split">` opt-in for path links in browser-pane pages. Close with `⌘⇧\` or the aux header's ✕. Promote aux → main with the ⇤ button. Drag the divider to resize (clamped 20-80%); double-click to reset to 50/50. State persists across launch (paths + activeIndex + splitPct survive a restart). Locked behaviors per the AUQ pass: agents always open in main unless trigger words ("in split / alongside / side by side / as a companion / in the side panel") are used; ⌃Tab is focused-pane only; never two tabs for the same path across panes (move semantics on tab right-click; open semantics on file/link right-click). Phase 3c-iii (dirty-replace dialog) and Phase 3c-iv (browser-in-aux) deferred to v0.6.5.

2. **Idle-thoughts sweep** — eight items closed in a single batch:
   - **ENH-076** — `⌘[` / `⌘]` indent / outdent in HTML canvas (parity with the markdown editor's ListIndentShortcuts).
   - **ENH-078** — Navigator selection prominence (heavier accent fill + font-medium, reads like Finder) plus three deselect paths (re-click selected row, click whitespace below rows, Escape).
   - **ENH-079** — Collapsed Navigator shows a vertical "Navigator: {project_name}" label, mirroring the terminal/canvas collapse rails.
   - **ENH-081** — Duo registers as a macOS Open With candidate for `.md` and `.html` files (post-DMG verify owed).
   - **ENH-070** — Dev-mode FAQ files become symlinks to the source repo (no drift between `~/Documents/GitHub/duo/help/faq.html` and `~/.claude/duo/help/faq.html`). Production unchanged.
   - **BUG-071** — `⌃Tab` is responsive immediately after a smoke-walk path-link click (one-line `mainWindow.webContents.focus()` after `sendEdit` in main.ts; inverse of BUG-042's wireKeyForwarding pattern).
   - **ENH-036** — `duo open <url>` makes the new browser tab visible immediately (BROWSER_FOCUS_GAINED handler now also flips activeWorking, mirroring Stage 23 canvas-action `browser:open`).
   - Plus Stage 4 dead-code removal (orphaned SkillsPanel + useSkillsContext + scanSkills, ~146 lines) and the orphaned `@deprecated EditorSelectionTagged` alias.

3. **Vitest regression-test framework** (commit `c822139`). 41 tests covering the BUG-061 markdown-trigger regex (heading/ul/ol/blockquote with both U+0020 and U+00A0 trailing whitespace — Chromium auto-converts trailing literal spaces to nbsp), the BUG-067/ENH-039 tilde expansion helper, and edge cases (start-match, not strict-equality). Closes the "recurring regressions need durable test coverage" memory feedback. `markdownShortcuts.ts` was refactored to extract the trigger-matching as a pure `matchBlockTrigger()` function for testability; `expandTilde()` was extracted to `core/path-utils.ts` (replaced two inlined copies in main.ts). Run via `npm run test:run` (one-shot) or `npm run test` (watch).

4. **Filed-only (queued for v0.6.5):** ENH-080 (`⌘⇧A` open-tab search palette), MISSING-001 (markdown editor CommentRail binding — Stage 14a), ENH-052 (mechanical `'html-canvas'` → `'page'` rename, deferred until other v0.6.x work settles), Phase 3c-iii (dirty-replace dialog — needs aux dirty-by-path registry refactor), Phase 3c-iv (browser-in-aux — needs BrowserManager bounds tracking for two WebContentsViews).

5. **Architectural** — Phase 2 ADR locked **editor / canvas convergence Path A** (mirror, not unify). PRD-H1 ("the canvas IS the page") is load-bearing; unifying would break it. CLAUDE.md plumbing checklist now requires explicit (a) Mirrored / (b) Skipped surface-specific / (c) Deferred annotation on every editor PR. See `docs/DECISIONS.md § Editor / canvas convergence`.

**Locked decisions this arc** (full list in `docs/dev/active-sprint.md`): `⌘\`` cycle is 2-way (terminal ↔ working pane); `⌃Tab` is focused-pane only; capability deltas main↔aux are NONE in v1; agent default is ALWAYS main unless trigger words; user-facing label is "Split View"; no pinning in v1; styling option A locked (current/shipped slim symmetric chrome).

---

**Carried-over v0.6.3 chapter (still ships under v0.6.4 — never cut as 0.6.3):**

The v0.6.3 work below shipped + verified before Sprint 3 expanded the chapter. It's all part of v0.6.4 now. Walks: walk-1 surfaced 4 fixes that landed mid-sprint (BUG-064 trash modal occlusion, BUG-065 ⌘⇧G blank screen, BUG-066 clawd glyph clipped, BUG-068 sticky new-tab cluster); walk-2 returned 13/13 PASS with a polish punch list that landed inline (ENH-071/072/073/074).

**The headline (architectural):** ENH-050 — native NSMenu (`Menu.popup`) replaces the in-renderer ContextMenu, and system sheets (`dialog.showMessageBox`) replace the in-renderer PinnedCloseConfirm + trash-confirm modals. The migration retires the entire WCV-mute pattern for menus and modals: the macOS native subview compositor renders these at the window-server level, so they composite correctly above the WebContentsView with no flicker, no race, no occlusion. Closes BUG-058 (originally fixed via WCV-mute, now properly retired) and BUG-064 (sibling modal occlusion). The `setOverlayMuted` API stays — BUG-006's in-page Send→Duo pill still uses it; different problem class, native composition isn't applicable to in-page CDP-injected DOM.

The locked decision lives in `docs/DECISIONS.md § WCV-occlusion remediation: native NSMenu + system sheets, not WCV-mute`. Trade-offs accepted: lose Atelier styling on menus + destructive sheets specifically (translucent system gray, system blue hover, system font); light/dark follows OS theme not Duo's; custom decorations on menu items not possible. Owner reviewed mockups + signed off 2026-05-02.

**The features (what users can DO new):**

1. **Collapse panes** (ENH-040 + ENH-066). Two titlebar buttons next to the theme toggle hide the terminal column or the canvas (right pane). The collapsed slot becomes a clickable 36px vertical rail with glyph + serif-italic label; click restores to the previous drag-set split percentage. Owner ENH-066 specifically asked for the rail (the buttons-only first cut wasn't discoverable enough). Pairs cleanly with `prevSplitPct` memory — collapse → expand returns to where you were, not to a default 50/50.

2. **Tab reorder** (ENH-042). Drag any working-pane tab horizontally onto another to reposition; right-click → "Move tab left" / "Move tab right" for keyboard-friendly access. Pinned-leftmost preserved (cross-zone drags silently rejected); zone-edge gating hides the irrelevant menu item. Reorder is session-local — file-tab IDs are uuids, so cross-launch persistence has no anchor to map to.

3. **Toggleable line numbers in markdown editor** (ENH-069 + ENH-071). Sticky `#` button in the bottom-left of the editor scroll-host; click toggles a CSS-counter gutter that numbers each top-level block child of the ProseMirror tree (paragraphs, headings, list items, blockquotes). Wrapped paragraphs count as one (true visual-line numbering would need a PM plugin with reflow detection — queued as v2 only if v1 isn't enough). Persists globally via localStorage.

4. **Smart `duo open`** (BUG-067). `.md` files open in the editor; HTML files with `<meta duo-open-in="browser">` open in the browser pane; HTML without that meta opens in the editor; http(s) URLs unchanged. The CLI response carries an accurate `routedTo` label after the follow-up that fixed the misleading default.

5. **Smoke-walk page persists in-flight state** (ENH-038). Walk pages now write Pass/Fail toggles + per-item notes textareas to localStorage on every input (debounced 250ms); restore on every load. "Clear saved walk" button wipes after the user has copied results back. Per-version storage key so different walks (v0.5.7-walk-3 vs v0.6.3-walk-1) don't restore each other's state.

6. **Collapsible Project Claude Context** (ENH-045a). The navigator's project pane gets a collapsible header that defaults to collapsed; auto-titled with the project's `package.json` `name` or the folder name. Toggle persists per-user.

**Polish that punched up:**

- Globe glyph replaces the `>` chevron on the new-browser-tab button (ENH-068)
- `duo/` lives in "Your Claude settings" alongside CLAUDE.md / skills / agents (ENH-067)
- "Copy path" item in tab right-click menu mirrors the FileTree menu (ENH-074)
- Visible paper-rule separator between tab strip and the sticky new-tab cluster (ENH-073)
- Larger collapse-rail label text + `#` toggle text (ENH-071/072)
- Copy-button auto-injection on canvas `<pre>` blocks documented in `make-page.md` (ENH-046)

**Plus 9 bug fixes**: BUG-058 retired via ENH-050; BUG-059 rev1 (renderer dedup) + rev2 (CLI dedup); BUG-060 (fenced code blocks materialize on Enter); BUG-064 retired via ENH-050; BUG-065 (Rules-of-Hooks blank screen — latent since v0.5.4) + ErrorBoundary defensive guard; BUG-066 (clawd glyph clip + currentColor); BUG-067 (CLI smart routing) + accuracy follow-up; BUG-068 (sticky new-tab cluster).

**Why this didn't cut as v0.6.3:** owner direction was "no cut yet, accumulate until the chapter feels closed." Sprint 3 absorbed the chapter into v0.6.4 above. The v0.6.3 work below is part of the v0.6.4 cut.

**Items that were filed-for-v0.6.4 at v0.6.3 close and have now shipped in Sprint 3:** ENH-039 ✅, ENH-070 ✅, ENH-076 ✅, BUG-070 ✅, BUG-061 v3 (bullet/ordered/blockquote triggers — final fix) ✅. Still queued for v0.6.5: ENH-052 (mechanical rename), ENH-075 (canvas glyph design), ENH-077 (system dialog icon — DMG-verify owed); claude-code-basics curriculum-template refactor.

---

## v0.6.2 — 2026-05-02 — The lesson template ecosystem completes

The closing chapter of the canvas-authoring → lesson-template arc that began in v0.6.0. The linear lesson template shipped in v0.6.1; v0.6.2 lands its sibling (the curriculum template, for multi-canvas packs) AND the fly-through harness (the validation tool that closes the loop on "did the lesson actually work?"). Plus a small punch list of post-walk-3 cleanups and one cosmetic addition.

**The fly-through harness (ENH-055) is the most load-bearing change.** Without it, every lesson modification needed a manual walkthrough — the user clicks each step, watches the agent paint, decides if anything broke. With it, the agent walks itself through any lesson built on the canonical template and reports pass/fail. The harness is a skill (auto-loaded on "fly through this lesson," "test my new lesson," etc.) that combines two primitives: `duo events --follow --since` (cursor-resumable event subscription, already shipped) plus the new `duo html click` verb. The harness is generic — it doesn't know about specific lessons; it walks step events and clicks the next-step button as each `step:N-done` event fires.

**The curriculum template (ENH-056) is filed-and-shipped on the same day.** v0.6.1 left it filed because the multi-canvas case wasn't blocking. While verifying the lesson-template story, it became clear that the existing `claude-code-basics` pack (which IS multi-canvas) had no canonical structure to compare against; building the template removed the "we'll figure that out later" caveat from the lesson story. The template ships as a sibling of the linear lesson-template at `~/.claude/skills/duo/examples/curriculum-template/` — orientation launcher with module cards, a copy-once-per-module skeleton, an orchestrator skill skeleton, README. Canonical events follow the `lesson:module-<id>-launch` / `-done` / `-abandon` shape that the runtime helper skill already documents.

**Why three things in one cut:** the harness needed the click verb, the click verb needed the action-vocabulary plumbing, and the curriculum template completes the lesson story. Cutting any one in isolation would have been smaller, less complete. The walk-3 punch list (BUG-062 banner copy + BUG-063 inline literals) and the clawd glyph fold in cleanly — none of these are large enough to deserve a cut on their own.

**Two design decisions baked in:**

1. **Clicks are primitives, not events.** `duo html click` synthesizes a click on an iframe element. The element fires its own click handler — which may emit a `data-duo-action` event, may invoke an in-page handler, or may do nothing. The harness doesn't need to know what the button does, just that pressing it advances the lesson. This generalizes to any future "agent walks an interactive page" workflow. The verb is intentionally narrow: it doesn't simulate hover, key press, or focus — those would each need their own primitive when the use case arises.
2. **Skill-description recognition replaces ad-hoc CLI verbs.** The fly-through harness is a skill, not a `duo lesson fly-through` verb. Same logic that v0.6.1 applied to "build a lesson" → make-playground skill rather than `duo lesson new`. Pattern lock: structured workflows that benefit from reading natural language live as skills (auto-loaded by description); CLI verbs are reserved for atomic primitives the agent composes. This keeps the CLI surface small (and easier to teach) while keeping the agent-discovery surface broad.

**Two small UX corrections that punched up:**

- **Update banner version copy** (BUG-062). Walk-3 surfaced that "(currently from v0.6.0)" was reading as "Duo itself is at v0.6.0." Rewritten to spell out both versions in the same sentence: "Agent files in `~/.claude/` are from Duo v{installedVersion}. You're running v{appVersion}. Refresh to update." The receipt-vs-running-version data was always correct; only the rendering needed the fix.
- **Smoke-walk inline backtick literals** (BUG-063). Mid-sentence `<meta>` references in walk manifests were getting pulled out into separate Copy blocks, leaving prose gaps. New `isTrailingCmd()` helper in `generate.mjs` only pulls cmds out when they're at the end of a sentence; mid-sentence literals stay inline as `<code>`. Pure documentation-rendering polish but visible enough to deserve mention.

**The clawd glyph (ENH-044)** replaces the generic `+` plus glyph in TabBar.tsx's new-Claude split-button half. The icon is owner-authored (Inkscape) — a small orange-on-paper monster ("clawd") that's intentionally unmistakable as the "Claude" semantic. Color stays fixed at `#c15f3c` (Atelier accent family) in both themes; the SVG lives at `renderer/assets/icons/clawd.svg` for provenance and is inlined in TabBar.tsx as `ClawdGlyph` to match the existing `ClaudeIcon` / `TerminalIcon` pattern.

**What this is and isn't:**

- **IT IS** the lesson-template ecosystem closing — both shapes (linear + curriculum) have canonical templates, and the validation primitive (fly-through) makes them confidently authorable.
- **IT IS** the validation primitive that lets agents author lessons without manual user testing on every iteration.
- **IT IS** a small UX polish — clawd glyph + clearer banner copy + inline literal rendering.
- **IT IS NOT** a refactor of `claude-code-basics` to use the new curriculum template (queued; the pack works as a one-off).
- **IT IS NOT** the textarea-persistence / file-tab dedup / md-canvas parity work — those are filed but not yet in scope.
- **IT IS NOT** ENH-052 (the mechanical internal rename of `'html-canvas'` → `'page'`) — that touches 50+ files and gets one focused PR when prioritized.

---

## v0.6.1 — 2026-05-02 — Canvas authoring vocabulary, sharper

The unglamorous-sounding follow-up to v0.6.0 that turns "canvas authoring exists" into "canvas authoring is reachable by users who don't yet know what canvas means." Five threads pulled together at once: the `claude:spawn` semantic that made v0.6.0's lesson buttons silently fail is fixed; a fork-config knob lets enterprise distros pick which packs to ship; the canvas/page/playground/lesson hierarchy is locked into the glossary; a canonical lesson template + runtime helper skill ships so future lessons stop being snowflakes; and the authoring skill split (make-page / make-playground / playground-interaction / lesson-runtime) is tuned so Claude reaches for the right skill on natural-language prompts.

### Why this version is the more important one

v0.6.0 shipped the canvas-authoring TOOLBOX. v0.6.1 ships the KIT — the things a non-expert user actually needs for the meta-goal to work ("user says 'I want to make a training/guide' and Duo/Claude takes it from there").

Concretely:

- The skill descriptions are now broad enough that natural-language prompts auto-load the right authoring skill. The owner direction was explicit: "Playground front matter should be pretty open and include any time the user wants interactivity in their page." `make-playground.md`'s frontmatter description fires on "build a training" / "make a guide" / "create a lesson" / "tutorial for X" / "interactive demo" / "dashboard with action buttons" / "page that does things" — any hint of "user clicks, Duo reacts."
- Once the skill loads, it walks the agent through copying `~/.claude/skills/duo/examples/lesson-template/` and customizing TODO markers. The template's three stable paint regions (`step-counter` / `step-body` / `step-controls`) and canonical event names (`lesson:step-N-done`, `lesson:done`, `lesson:restart`) become the convention every new lesson follows.
- The runtime helper skill (`lesson-runtime.md`) explains the canonical event-loop, sidecar state schema (`~/.claude/duo/lesson-state/<pack-name>.json` with cursor for resume), foreground-vs-subagent watch patterns. This is the doc Claude reads when it's mid-implementing a lesson and needs the runtime contract.

The result: a future Claude session sees a "build me a training" prompt, loads `make-playground` automatically, finds the "Lessons specifically" section, copies the template, customizes per-step content, references the runtime contract for event handling. End-to-end clear path. The toolbox-to-kit gap from the post-v0.6.0 zoom-out (gaps 1, 2, 3 of the five) is closed.

### Three design decisions baked in

**(1) `claude:spawn` `data-cmd` is a Claude prompt, not a shell command.** The runtime now sends `claude\n${cmd}\n` to the new PTY: shell launches Claude, Claude reads cmd as its first user message via the queued PTY input. This is the fix for ENH-049 (Stage 28 Pack A's "Start lesson" was silently failing in v0.6.0 because the cmd was being typed into zsh). Same fix benefits `duo new-tab --claude --cmd` from the CLI. The semantic is documented in `make-playground.md § Anti-patterns` as a load-bearing convention: prose into `data-cmd`; if you need a shell command in the new tab, follow up with a `terminal:send` button.

**(2) The vocabulary hierarchy is content-level, not kind-level.** Pages and playgrounds share the same `WorkingTab` kind (`'html-canvas'` until ENH-052 mechanically renames). What makes a page a playground is whether it has interactivity baked in. This matters because: (a) a page can graduate to a playground without changing tabs or routing; (b) the trust gate, sandbox, and paint primitives apply uniformly; (c) authoring agents don't have to pick the kind upfront — they pick the content level (basic/interactive) and the skill split (`make-page` / `make-playground`) routes accordingly. The hierarchy: canvas (slot) → page (basic HTML) → playground (page + interactivity) → lesson (playground + guide skill) → start tab (playground that auto-opens on first launch).

**(3) Skill recognition replaces a CLI verb for "build a lesson."** Owner pushback on the proposed `duo lesson new` CLI: "A cli verb for lesson seems like overkill" — and the FTUX user (the meta-goal target) doesn't yet know `duo` is a CLI. The right primitive is skill description tuning. `make-playground.md`'s frontmatter is deliberately broad. No CLI verb; the natural-language prompt is the trigger.

### What this is and isn't

This IS the cut that closes meta-goal gaps 1 (entry point), 2 (lesson-skill canonical pattern), and 3 (runtime helper). A user with no canvas literacy can now ask Claude for a training and get one — the agent has the skills + template + conventions to do it.

This is NOT the cut that closes gap 4 (smoke-walk page rebuilt on canvas primitives — ENH-043) or gap 5 (lesson preview / fly-through harness — ENH-055). Those are the dogfooding pieces that prove the kit works under load. ENH-055 in particular wants the canonical packs to assert against — the v0.6.1 pack refactor (intro-to-duo + claude-code-basics adopting `lesson:` event names) gives it a stable contract.

### Walk arc

No formal smoke walk this cut — the changes are skill-content + docs + a small runtime fix (ENH-049's `claude:spawn` semantic). Typecheck clean; signed DMG launch-validated; `make-playground.md` skill description sanity-checked manually for trigger phrase coverage. Walk-3-equivalent for v0.6.1 deferred until ENH-055's harness exists to drive it.

### Queued next

- **v0.6.2 candidates:** ENH-055 (fly-through harness), ENH-056 (multi-canvas curriculum template), ENH-038 (smoke-walk textarea persistence), ENH-039 (clickable smoke-walk paths), ENH-043 (smoke-walk on canvas primitives — closes gap 4 from the v0.6.0 zoom-out), refactor of `claude-code-basics` to ENH-056's curriculum template once it exists.
- **Indefinite:** ENH-052 (mechanical internal rename `'html-canvas'` → `'page'`); UX-neutral; do as one focused PR when other v0.6.x work settles. ENH-040 / ENH-041 / ENH-042 (collapse / split-canvas / tab-reorder) — UX polish, queued. ENH-044 (clawd icon).
- **v0.7+:** Stage 13 (just-added highlight + warn-before-overwrite), Stage 14 (track changes + comment rail), ENH-045 navigator improvements.

---

## v0.6.0 — 2026-05-02 — Canvas authoring vocabulary + lesson packs (the FTUX-tutorial trio lands)

The cut that v0.5.6 deferred. Walk-2 of "v0.6.0 attempt #1" surfaced 7 release-blockers in the Stage 27 / 18b / 28 surface and adjacent regressions (BUG-052..058); rather than ship through them, we descoped to v0.5.6 and held the FTUX-tutorial trio out of the formal cut. This version closes the loop: all 7 blockers fixed, walk-3 passed (with one v2 fix on BUG-053 surfacing the project-vs-user-claude navigator distinction), and Stages 27 + 18b + 28 graduate from "internal preview" to officially shipped.

### Why this version is meaningful

Stage 27 ships the *primitives* for interactive canvas content: six new action verbs (`editor:open`, `nav:reveal`, `selection:set`, `theme:set`, `terminal:focus`, `duo:event`), a streaming agent event bus (`duo events --follow`), form-input bindings (`data-payload-from`), per-tab edit-mode routing (`<meta name="duo-default-editable">`), and five reference templates. Stage 28 then *uses* those primitives to ship two FTUX skill packs (`intro-to-duo` and `claude-code-basics`) that auto-open on first launch. Stage 18b is the distro mechanism that makes pack-shipping work. The three together are the "interactive lessons live in Duo" story — the agent can drive a lesson, the user can click around, the lesson tracks progress via events. That story has been in flight since the v0.5.5 walk first surfaced it (2026-05-01); v0.6.0 is when it actually lands.

### Three design decisions baked in

**(1) Canvas-action verbs are *renderer-side dispatch*, not main-process IPC.** Every verb is a delegated capture-phase listener on the iframe document — no `allow-scripts` on the iframe, no main-process round-trip. The trust gate (path-restricted to `~/.claude/duo/`) is enforced by `isCanvasPathTrusted` in `canvasActions.ts` before dispatching. This keeps the surface area tight: a malicious canvas at `/tmp/whatever.html` can't fire `claude:spawn` because the gate refuses to dispatch, regardless of what the page-side code attempts.

**(2) `duo events --follow` shares the cursor format with `--since`.** Cursor is `<unix-ms>-<seq>` — re-resumable across reconnects, sortable lexicographically, and human-readable enough to copy off a smoke-walk page (which V14 of walk-2 actually had the user do). The 200-event ring buffer is in-memory only; consumers that need durability should `--follow` with a cursor and persist the latest one themselves. This ships issue [#19](https://github.com/dudgeon/duo/issues/19) from the v0.3 backlog.

**(3) `nav:reveal` routes to the navigator pane that owns the path.** Walk-2 caught this as BUG-053; walk-3 caught the v1 fix's residual problem (it set `selected` on the project nav for paths inside `~/.claude/`, where the user-claude pane is the visible one). v2 prefix-matches against `~/.claude/` and dispatches to `userClaudeNav.actions.revealAndSelect` for those paths. The general lesson: when a renderer has multiple navigator instances with different roots, route by-path-prefix rather than by-default-pane.

### Walk arc (walk-2 → v0.5.6 → walk-3 → v0.6.0)

Walk-2 (2026-05-02 morning): 13 PASS, 4 FAIL, 4 SKIP, plus 4 separately-reported BUG/REGRESSIONs in adjacent surfaces. Decision: descope to v0.5.6 (carry-overs + BUG-051 + ENH-037 + ENH-046 only); hold 27/18b/28 as internal-preview. Cut + ship.

Walk-3 (2026-05-02 evening): 6 PASS, 1 FAIL, 1 SKIP. The single FAIL was BUG-053 v1 — the navigator-pane routing issue. v2 fix shipped, three follow-ups filed (ENH-050 smoother WCV mute, BUG-062 update banner version mismatch, BUG-063 mid-sentence Copy-block extraction). Decision: skip walk-4 (the v2 fix is a one-line route condition; the rest of walk-3 settled cleanly), proceed to cut.

### What this is and isn't

This IS the FTUX-tutorial cut: Stages 27 + 18b + 28 officially shipped, lesson packs are recommended FTUX defaults, the canvas-authoring skill is a load-bearing surface for any Claude session that needs to author tutorial / dashboard / agent-driven canvases. It IS a meaningful version-bump from v0.5.6 — three new stages closing, six new agent-surfacable verbs, two distro packs, a new event-streaming CLI verb.

This is NOT the "canvas authoring is feature-complete" cut. The smoke-walk skill ENH-046 / ENH-048 surfaced that the canvas-templates set itself wants extension (ENH-043 — smoke-walk page rebuilt on canvas primitives), and the lesson packs' "Start lesson" gating (ENH-049) is an obvious follow-up. Those queue for v0.6.x.

### Queued next

- v0.6.x: ENH-038 (textarea persistence — closes the smoke-walk-mid-restart vulnerability), ENH-039 (clickable smoke-walk paths), ENH-040 / ENH-041 / ENH-042 (collapse / split-canvas / tab-reorder), ENH-043 (smoke-walk via canvas primitives), ENH-044 (clawd icon), ENH-045 (Project Claude Context navigator), ENH-049 (28-Pack-A "Start lesson" gating), ENH-050 (smoother WCV mute via capturePage overlay), BUG-059 (de-dupe local-file tabs), BUG-060/061 (markdown editor + canvas parsing parity), BUG-062 (update banner version), BUG-063 (smoke-walk mid-sentence Copy-block).
- v0.7+: Stage 13 (just-added highlight + warn-before-overwrite), Stage 14 (track changes + comment rail).

---

## v0.5.6 — 2026-05-02 — Stability cut: carry-overs + read-only fix + ⌘W safety

A descoped follow-up to v0.5.4 instead of the originally-planned v0.6.0 cut. The v0.5.5 carry-over stash had been sitting in the "Pending — not yet cut" section since 2026-05-01 with the plan to fold it into v0.6.0 alongside Stages 27 + 18b + 28. Walk-2 of v0.6.0 (2026-05-02) surfaced 7 release-blockers in 27/28's verbs and adjacent surfaces (BUG-052..058); rather than spend 2-3 more sessions chasing those down before the cut, we descope: ship the carry-overs + the new BUG-051 fix + the ⌘W safety + the smoke-walk usability improvements as v0.5.6, hold 27/18b/28 out of the formal cut until they pass walk-3.

### Why this lands here, not as v0.6.0

The v0.6.0 mental model was "Stages 27 + 18b + 28 land together." Walk-2 invalidated that — three Stage 27 verbs (V2 / V3 / V7) failed, and four other regressions surfaced (BUG-055..058). Holding the cut hostage to those fixes would push the next ship 2-3 sessions out, with more regressions likely as the fixes interact. Cutting v0.5.6 now gets the FIXED-and-VERIFIED work to users immediately, lets the 27/28 work bake separately under a v0.6.0 retry plan, and re-establishes the discipline of "a cut means it's verified."

The Stage 27 / 18b / 28 code IS in this release's binary — it's already on `main` and would have been wherever the next cut landed. What we're NOT doing is documenting it as shipped, flipping its roadmap status to ✅, or recommending it for use. It's "internal preview" — present, possibly working, definitely not validated. (The pre-cut bump from `0.6.0 → 0.5.6` reflects this: v0.6.0 was a speculative version label that never published, so it's not a downgrade — just a re-target.)

### Three design decisions baked in

**(1) BUG-051's fix targets the right layer.** The read-only toggle's failure mode wasn't a state-management bug at the React level — `readOnly` flipped correctly. The bug was in `RenderedCanvas`'s wiring effect: it ADDED edit-mode body attributes inside the `if (!readOnly)` branch but never removed them when re-running under `readOnly: true`. The fix adds an explicit `else` branch that reverts those attributes, blurs the active element, and leaves the `data-duo-canvas-runtime` `<style>` in place (the goto-flash keyframes are needed in both modes). One-screen edit, no architectural shift.

**(2) The smoke-walk "never restart Duo mid-walk" guard is convention-level, not code-level.** The user lost 20 minutes of typed walk notes when ⌘W closed the parent window mid-walk. Two fixes: (a) ENH-037 prevents ⌘W from EVER closing the window again; (b) the smoke-walk SKILL.md gains a Step-4 "never restart" guard with a 3-option escape hatch for the cases where a restart genuinely is required mid-walk. The second is convention because the primary defense is "don't let the user lose work" — the textarea persistence (ENH-038) is queued but not blocking this cut.

**(3) `shared/feature-flags.ts` is a kill-switch module, not a runtime-flag system.** The first flag (`FEATURE_AUTO_INJECT_IDS = false`) is a compile-time constant with no runtime flipping. Adding a flag means: declare the const, gate the feature, document the deciding bug/ENH ID. Removing means: delete the const, delete the gate. No persistence, no UI, no `duo flag` CLI. We need this discipline early — every "let's add a runtime flag" is a maintenance commitment that compounds.

### What this is and isn't

This is a stability cut that gets fixes shipped without releasing the unfinished Stage 27 / 28 surface as a "feature." It's not the originally-planned v0.6.0 — that target moves out, and v0.6.0 is now a placeholder for the cut that lands when 27 + 28 pass walk-3. It's not a major release — there's no architectural shift, no new user-facing capability beyond the smoke-walk Copy buttons (which is dev-experience, not user-experience). It IS a clean cut: every item in the "Fixed" / "Added" / "Changed" sections has been tested through at least one walk and has a known fix path.

Queued next:
- v0.6.0: BUG-052..058 fix sprint + walk-3 (Stage 27 + 18b + 28 graduate from internal-preview to shipped)
- v0.6.x or later: ENH-038 (textarea persistence), ENH-039 (clickable paths), ENH-040 / ENH-041 / ENH-042 (collapse / split-canvas / tab-reorder), ENH-043 (smoke-walk via canvas primitives), ENH-044 (clawd icon), ENH-045 (Project Claude Context navigator features)
- v0.7+: Stage 13 (just-added highlight), Stage 14 (track changes + comment rail)

---

## v0.5.4 — 2026-05-01 — Right-click everywhere + ⌘\` finally clean

This release lands a small cluster of UX paper-cuts that had
accumulated since v0.5.3, plus the foundational fix for a recurring
focus-toggle race that's been chased through three rounds.

### Why this lands here

v0.5.3 cleared the FTUX big surfaces and the v0.5.4 cycle was meant
to be tight — pull the carry-over Known Issues from the v0.5.3 cut,
ship them, and move on. Seven items in the original sprint, six
landed, one (ENH-022 doc-goto wrong-heading) deferred indefinitely
per owner call after rev3 walk still showed the same wrong target.
The remaining six are coherent: every right-click in Duo now does
what users expect, ⌘\` stops behaving differently after `duo open`,
the browser pane finally gets ⌘F, the breadcrumb shows the active
folder by default instead of `~/Documents/...`, and tab switching
between markdown docs is instant.

### Three design decisions baked in

1. **`electron-context-menu` over a custom React menu.** Path A
   from the ENH-031 spec — fastest path to "right-click does the
   right thing" without inventing a renderer-side menu primitive.
   Default actions (Cut / Copy / Paste / Spell-check / Look Up /
   Inspect-in-dev) cover the obvious gap; "Copy as Plain Text"
   prepends as a custom item when there's a selection. The library
   only auto-attaches to BrowserWindow webContents, so we wired it
   per-webContents via `app.on('web-contents-created')` to catch
   every browser-tab WCV too.

2. **BUG-048's third try: stop racing the xterm focus event.**
   Rounds 1+2 chased the wrong thing — they tried to make
   `focusedColumn` flip to 'working' more reliably after `duo open`.
   That was happening fine. The actual bug was the menu accelerator's
   focus reclaim firing the xterm helper-textarea's `focus` event
   *before* `togglePaneFocus` ran — the listener flipped state to
   'terminal' as a side effect, poisoning the toggle's prev read.
   Fix: main no longer reclaims on ⌘\`; renderer reads its own state
   first, decides direction, then asks main to reclaim. Plus a
   `focusedColumnRef` mirror that's bypassed by the xterm focus
   listener, so reclaim-induced focus events can't poison the next
   toggle either. Belt + braces.

3. **Build-version badge — debt repaid before it bites again.** During
   the v0.5.4 walk the user asked "is the dev build I'm walking
   actually the build with the fix?" — fair question, no good answer.
   Added a glanceable badge in the titlebar that reads from
   `app.getVersion()` and tags `·dev` when not packaged. While we
   were there, we also (a) added a precondition step to the smoke-walk
   skill that verifies `package.json` matches the manifest version
   before generating the walk page, (b) added a runtime guard in
   `generate.mjs` that refuses to write the HTML on mismatch, and
   (c) codified "bump `package.json` to next MINOR immediately after
   cut" as Step 7 of the cut-version skill. Three layers so the
   confusion can't recur silently.

### What this is and isn't

It's polish + one foundational fix. It isn't a new stage — Stage 14
(cohort distribution), Stage 16 (external-write reconciliation),
Stage 17 sub-phases (template gallery, comments) are still on deck.
ENH-022 is parked indefinitely; the instrumentation stays in the
codebase but no further work is scheduled until owner re-prioritizes.

### Queued next

- Cohort distribution / Beacon (Stage 21d) — socket auth,
  agent-driven-nav notifications, README.
- The remaining v0.5.4-walk-filed paper-cuts: ENH-032 (terminal
  locale documentation in install path).
- BUG-047 — WCV occlusion class still has open subitems (BUG-006
  Send-to-Duo pill).
- A future debugging pass at ENH-022 once the owner has appetite
  for it again.

---

## v0.5.3 — 2026-05-01

Two stages closed in one cut. **Stage 12** (Atelier visual redesign)
flips ✅ with whisper-level agent presence — a soft accent dot that
breathes in the chrome strip when Claude is live, and a brief halo
on the working pane when Claude reads a selection. **Stage 15**
(Send → Duo) flips ✅ with the polish trio that's been deferred
since 15.1+15.2 shipped — ⌘D as the global chord, a 5000-char
length cap with a self-describing truncation marker, and canvas
image flattening for embedded `<img>` tags.

Around those two closures, a broad polish sweep landed across the
navigator / editor / tab strips: editable breadcrumb (⌘⇧G), CWD
highlight + section dividers, open/active file distinction, tab
strip pan-to-active when overflowing, right-click context menus
on FileTree whitespace + WorkingPane tabs (including `file://`
browser tabs, with a WebContentsView overlay-mute trick to dodge
the macOS native subview occlusion), find-in-document for the
markdown editor with smooth scroll-to-match, ⌘[ / ⌘] list indent,
and bullet-marker round-trip preservation.

Two new agent-driven CLI verbs: `duo doc goto` (heading / line /
anchor) and `duo doc find` (read-only buffer search). Plus
`duo reload` for the agent's iteration loop (closes 1 of 6
remaining Stage 20 items). The **smoke-walk skill** itself is new
this cut: it generates an interactive HTML walk page from a JSON
manifest, opens it in Duo's browser pane, and the user clicks
through pass/fail toggles + notes; Copy results dumps a
structured block for paste-back into the chat. Used end-to-end
for this release's verification — three rev passes, ten distinct
walked items, all green except one carried-over known issue.

### Why this version lands here

v0.5.2 was a bug-smashing sprint; v0.5.3 moves the needle on three
open stages (12, 15, 20-partial) and substantially tightens the
editor + navigator polish. The labels in the engineering log
called the prep work "v0.5.3 sprint" and the close-out "v0.5.4
sub-sprint," but the actual semver next from v0.5.2 is v0.5.3 —
the v0.5.4 internal label was speculative.

### One known issue, intentionally shipped

`duo doc goto --heading "BUG-038"` against the engineering tasks
file still scrolls to the wrong entry (rev2: BUG-032; rev3:
BUG-034). v2 fixed the scroll plumbing; v3 tightened match
precedence but a wrong heading still wins. Likely buffer staleness
(Stage 16 external-write reconciliation isn't shipped yet) or a
regex permissivity issue inside TipTap's heading walk. Released
as-is per owner call; the response shape already exposes a
`matched_heading` field so v4 debugging is self-diagnosing.

### What this is and isn't

This is the first cut where the **smoke-walk skill** drove the
verification loop — three walks, real fail-then-fix iterations,
structured carry-overs filed as typed BUG/ENH IDs. Worth noting
because the next cuts will inherit that workflow, and the eventual
`tasks ↔ roadmap` reconciliation (filed as a proposal at
`docs/dev/tasks-roadmap-reconciliation.md`) will likely deepen
that loop.

**Not in this cut:** Stage 17 sub-phases (17d-B / 17d-C / 17e),
Stage 14 (track changes), Stage 16 (external-write reconciliation),
Stage 21d (Beacon cohort distribution). ENH-027
(canvas-default routing for local HTML via
`<meta name="duo-open-in">`) is held until Stage 17e,
cross-referenced in both roadmap files.

---

## v0.5.2 — 2026-04-29

**Bug-smashing sprint.** Six PRs in one day closing longstanding papercuts on the Stage 17 canvas + Stage 18 install surfaces. No new headline capability beyond preset pane sizes — pure quality-of-life on the surfaces real users were hitting in normal flow.

The six items chained: BUG-031 (divider stuck over canvas) blocked ENH-014 (preset sizes) — divider had to actually move both ways before the menu shortcut would matter. BUG-034 (overlay occluding canvases) was a single-line fix per the user's verbatim ask ("remove it and add a TODO to revisit"). BUG-035 (false-positive Claude-not-found banner) surfaced mid-sprint and was the highest-priority insertion: the banner accused users of not having Claude Code installed when the only problem was `zsh -l -i -c` taking >5s to load on populated dev machines (NVM/conda/asdf/oh-my-zsh stacks). Fast-path resolution dropped that from 5236ms hit-timeout to 0.8ms hit-cache. BUG-032 (canvas focus theft) and BUG-033 v1 (autosave race) closed two of the most-felt mid-typing surprises. ENH-017 (Add to PATH button) restored the affordance that v0.4.5 had passively hidden — users were hitting `duo: command not found` from external shells and the prior "add this line" hint was too easy to dismiss.

**Key design decisions baked in:**

1. **Drag-overlay z-index covers iframes, not WebContentsViews.** BUG-031's recommended fix (option 1 from the bug filing) is the DOM-overlay approach. It works for canvas iframes but doesn't help for the browser pane WebContentsView — Electron paints native views above the renderer DOM regardless of z-index. The fix is scoped accordingly; if drag-over-browser repros, that's a follow-up needing IPC-driven `setBounds` suppression during drag.
2. **Fast-path resolver, not shell-only.** v0.4.5 added a three-flag-set shell fallback to fix detection drift; v0.5.2 inverts the priority — well-known absolute paths first, shell as fallback only. This catches the vast majority of installs without paying a 5–15s shell-init cost. Bumping the shell timeout to 15s makes the fallback genuinely usable when it does fire.
3. **`⌘⌥` instead of `⌘` for split presets.** The bug filing proposed ⌘1/⌘2/⌘3 — but ⌘1–⌘9 already drive `jumpTerminalTab`. Escalating modifier keeps the slot orthogonal; bare ⌘ stays with terminal-tab muscle memory.
4. **Autosave-pause via ref, not effect re-key.** Both editors use a `blockAutosaveRef` synced via `useEffect`. Reading the ref inside the change handler avoids closure-staleness; the ref-not-state read keeps the host effect from tearing down + re-mounting on every focus toggle (same pattern BUG-032's `shouldStealFocusRef` uses).

**What this is and isn't.** This is a polish + friction sprint. Not a new headline capability surface. The two remaining v0.5.2 backlog items (ENH-015 collapse-button discoverability, ENH-016 FileTree new-file/folder context menu) didn't make this cut — they're queued for v0.5.3. BUG-033 v2 (OT-style merge for replace-selection on dirty buffer) lives at Stage 16 (external-write reconciliation), not v0.5.x.

---

## v0.5.1 — 2026-04-28

**Polish + the gating you asked for.** A rapid-fire follow-up to
v0.5.0 that closes everything left on its known-issues list, ships
the editor-polish punch list that was deferred from v0.4.3, and lands
the strict claude-presence gate that prevents the Send → Duo pill
from routing to dead or non-Claude PTYs.

### Why v0.5.1 lands here

Three forcing functions, in order. First: **the v0.5.0 known-issues
list was a real foot-gun.** BUG-028 (Escape doesn't cancel rename),
BUG-029 (context menu clips at viewport bottom), BUG-030 (CLI pin
state doesn't push to renderer) were all "the navigator surface you
just shipped doesn't quite work" — the kind of friction that
silently degrades day-1 trust. Closing them in a follow-up patch
beats letting them age into a workflow stale-fix.

Second: **ENH-005/006/007 had been on the deferred list since
v0.4.3.** Two cuts in a row punted them; a third would have meant
they were de-facto cancelled. The actual implementations turned out
to be tractable — ENH-005's markdown editor side took two cuts at
ProseMirror's contentEditable reconciliation to land cleanly (widget
decoration + node decoration, not DOM mutation), but it's done now
and the user-facing affordance is a small but constant ergonomic
win.

Third: **ENH-013 was load-bearing for correctness.** The Send → Duo
pill routing into a non-Claude terminal silently produced output
the user then had to clean up — not just confusing, actively
destructive. Strict gating (only show the pill when the front
terminal has a live `claude` descendant) was the right line; the
process-tree probe is cheap and the implementation falls naturally
out of the existing PtyManager surface.

### Three key design decisions baked in

1. **ProseMirror decorations, not DOM mutations, for editor chrome.**
   ENH-005's markdown-editor copy buttons went through three
   abandoned approaches (direct appendChild → reverted; pre-class via
   classList → reverted; widget at pos+1 inside `<code>` → button
   text leaked into the copy payload) before landing on the working
   pattern: `Decoration.node` adds the host class (PM manages it;
   survives transactions), `Decoration.widget(pos+1)` inserts the
   button DOM, click handler clones the `<code>` and strips the
   button before reading textContent. The lesson is broader than
   ENH-005 — any future "add chrome to the editor without touching
   the doc" pattern (Stage 14's CommentRail markers, Stage 16's
   external-write banner) should reach for decorations first.

2. **Process-tree probing for claude-presence, not tab-kind heuristics.**
   The naive way to gate the Send → Duo pill is to check
   `tab.kind === 'claude'`. That's wrong: kind records *intent at
   spawn*, not current state. A user typing `/exit` to back out of
   Claude into a shell prompt would still see the pill light up. The
   probe walks the active PTY's child-process tree via one `ps -ax`
   call every 500ms (~1ms per probe on macOS); state machine adds a
   1.5s grace for `kind:'claude'` tabs that haven't yet exec'd
   `claude`. Same plumbing will eventually back agent guards
   (FOLLOWUP-002) and other "is the agent live" surfaces.

3. **Native `<datalist>` for URL autocomplete, not a custom dropdown.**
   Issue #27's history-suggest UI is one HTML5 element + a debounced
   IPC call. No custom keyboard nav, no custom styling, no
   focus-management bug surface. The trade is suggestions look
   platform-stock instead of Atelier-themed — fine, this is a power-
   user surface where speed beats aesthetic. If the look ever needs
   to change, the swap is well-contained (the rendering boundary is
   one component).

### What this is and isn't

**This is** the patch release that earns v0.5.0 the "stable enough
to put in front of someone" label. The navigator papercuts are
gone, the editor surfaces have the polish that makes the agent
loop feel intentional rather than improvised, and the Send → Duo
pill stops misfiring.

**This isn't** the cut that closes Stage 21 (21d Beacon
cohort distribution remains; 21b DMG background remains a small
visual asset deferred from this cut), and it isn't the one that
flips Stage 14 / Stage 16 (the markdown editor's CommentRail
binding + external-write reconciliation). Those are the v0.5.2 /
v0.6.0 conversations.

### Queued next

- **Stage 21d** (Beacon cohort) — socket auth token + agent-
  driven-nav notifications + README. Last item before the cohort
  can receive the build.
- **Stage 26 PR 3** (navigator ambient signals + Go-to path) —
  items 2/3/4/8 from the original Stage 26 framing. The remaining
  Stage 26 surface.
- **Stage 14** (markdown editor's CommentRail binding) — the
  primitive shipped in v0.2.0; the markdown binding completes the
  editor side of the comment loop.
- **CLI `duo terminal claude-state`** — agent-side introspection of
  the presence-prober state (ENH-013 follow-up).

### Known issues at v0.5.1

_None tracked. v0.5.0's known-issues list closed in this cut._

---

## v0.5.0 — 2026-04-27

**The first MINOR since v0.4.0.** Three coherent surfaces ship
together: **navigator polish** (Stage 26 — single/double-click,
chevron split, right-click delete/rename + CLI, hover-Claude,
Pinned section, default-collapsed user-claude pane), **fork-friendly
architecture** (Stage 21e — one config file controls fork identity;
provenance-aware install preserves user customizations), and the
build/install/banner foundation from v0.4.4 (DMG launch fix +
launch-smoke validator) and v0.4.5 (Claude-detection fix + plain-
English banner copy).

### Why v0.5.0 lands here

Three reasons converged. First: Stage 21e was implementation-complete
on its branch since v0.4.2 — sitting on a cut would have meant either
a stale fork-config doc, or shipping the implementation without
matching docs. Cutting now lets the HOW-TO-FORK doc reference live
code paths.

Second: Stage 26 reached a natural ship moment. PR 1 (row-interaction)
landed the foundation; PR 2 (Pinned section + default-collapsed
user-claude pane) added enough additional value that bundling them
into one minor cut feels right. PR 3 (ambient signals + Go-to-path
input — items 2/3/4/5/8) is left for v0.5.1+ as its own focused
follow-up.

Third: the build/install foundation work in v0.4.4 + v0.4.5 deserves
a non-patch release after it. Hotfixing twice in 30 minutes was
appropriate; piling more onto patches isn't. v0.5.0 is the natural
home for "the foundation + the new surfaces it enables."

### Three key design decisions baked in

- **Single-click selects, double-click opens** is the new navigator
  contract (Stage 26 PR 1, item 1). Existing behavior was "click
  opens, no way to select without opening" — which blocked any
  context-menu-driven action. Finder/VS Code parity is the right
  model; the inline-rename UX presumes it. Tradeoff: muscle memory
  for users who learned Duo's navigator pre-v0.5.0 — a few extra
  clicks for the first session, then the new model takes over.
- **Pinned section is its own bottom-of-pane surface, not a tab strip**
  (Stage 26 PR 2). Considered: showing pins as filterable tabs in
  the WorkingPane (overlaps with Stage 24 tab pins). Rejected:
  navigator pins serve a different purpose — they're a "frequent
  target" shortcut, not a "this tab persists across reloads"
  marker. Storage at `~/.claude/duo/nav-pins.json` is deliberately
  separate from `pins.json` (Stage 24's tab pins) so the two
  systems can evolve independently.
- **Fork identity lives in one config file, not env vars** (Stage
  21e). Considered: forkers set `DUO_APP_ID` etc. in `~/Documents/duo-private/.env` alongside cert env vars. Rejected: tying
  fork identity to a per-user env file means a fresh checkout on a
  new machine has no identity until the user remembers to set up
  the env. The config file is repo-relative + gitignored: clone,
  copy `fork.config.default.json` → `fork.config.json`, edit, build
  works.

### What this is and isn't

This is a **minor cut**, not a major one. Pre-1.0 means everything
is still subject to change; v0.5.0 doesn't promise stability of the
fork-config schema, the Pinned section's CLI verbs, or the navigator
gesture model. v1.0 is the line where these promises start.

This is also **not the cohort distribution release**. Stage 21d
(socket auth + Beacon README + agent-driven-nav notifications)
is still ⬜. v0.5.x or v0.6.0 will cover that work.

### Auto-update

v0.4.4 and v0.4.5 users get v0.5.0 via auto-update normally. The
v0.4.4 launch-smoke validator gates the cut: the signed DMG was
verified to launch and stay alive past 8s before this version was
tagged.

### What's queued next ("v0.5.0 fast-follows")

- **BUG-028** — Escape inside the inline rename input doesn't dismiss
  (Workarounds present; low priority polish).
- **BUG-029** — right-click context menu on Pinned-section row
  clips at viewport bottom. Real UX gap; cross-cutting fix at
  `<ContextMenu>` flip-up logic.
- **BUG-030** — CLI pin/unpin doesn't refresh the renderer in real
  time. Push channel needed; Stage 24 tab pins have the same shape
  — one fix lifts both.
- **Issue #27** — browser history persistence + address-bar
  autocomplete. Originally in v0.5.0 scope; deferred to v0.5.1 to
  keep this cut focused on the three surfaces above.
- **ENH-005 / ENH-006 / ENH-007** — copy button on code blocks,
  right-pane new-browser-tab button, collapsed-but-findable comment
  rail. v0.4.3 punch-list deferrals; still queued.
- **ENH-011** — broader plain-English rewrite of welcome / update
  banner copy (the success state was already rewritten in v0.4.5;
  the welcome and update phases still read like Stack Overflow).

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
is Beacon-distro work that doesn't gate daily-driver
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
session — the default Seatbelt policy in Acme (and other
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

**Why this lands here, vs. later.** Every Acme Claude Code
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
comes from the owner's own Acme Claude Code sessions
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
  (e.g., Stage 18b's "Provided by Acme" group) is mechanical. The
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
self-announce on GitHub. The version where Acme
don't have to manually configure off-host routing for their
internal sites. The version where "Sent X to your default browser"
gives a visible receipt.

**Isn't:** signed (Stage 21 still — script prep is in, the actual
signed cut runs the next time the keychain prompt can be answered
in real-time). Doesn't ship Stage 14a (markdown comments —
MISSING-001 still queued). Doesn't ship Stage 18b distro skill
packs (the "Provided by Acme" badge in the navigator is queued for
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
Beacon could install in one click, v0.3.0 is the first release
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
v0.2.0 is the first release where a Beacon could actually pick
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
Beacon to a working state in one click. Welcome banner
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
- **Stage 18b** — distro skill packs (`extra-skills/` + `PACK.json` + per-conflict consent UI). Acme starter pack is the worked example.
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
the first real Beacon-facing surface — version discipline
becomes load-bearing: a Beacon who installs Duo and reports a
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
- **`duo external` routes off-host URLs through the OS default browser** (Stage 5 v2). Beacon members are PMs at Acme — they have corporate-managed browsers with internal sites, SSO, and bookmarks. Duo's embedded Chromium can't replicate that surface, so the explicit decision was: Duo is for in-loop work (browse → quote → ask Claude); off-host links go to the user's real browser via `shell.openExternal`.

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
