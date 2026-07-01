# Active sprint state — v0.13.2 shipped (init-on-choose vault + default-vault autocomplete + foreign-vault guard); next: triage

## Shipped in v0.13.2 (cut 2026-07-01)

> **BUG-212** (#115, merged 2026-06-29) — `[[` autocomplete now falls back to the
> **default vault** in files outside any vault (the suggester + `@` mention popover
> + `⌘O` switcher share one index that previously resolved the vault *solely* by
> walking up from the active file → empty popover everywhere outside a vault, which
> made the persisted default *look* "lost on restart"). New
> `findVaultRootWithDefault` (enclosing-vault-first / default-second, mirroring the
> CLI's `resolveVaultOrDefault`); cmd+click wikilink-open uses the same resolver.
> Live-validated via computer-use on a v0.13.2 local build. Will ship in the next
> cut (currently v0.13.2 in-progress).

> **D5 foreign-OKF guard** (#117, merged 2026-06-30, commit `83f1602`) — Duo's boot
> auto-relink (`maybeAutoRelinkVault`) rewrote a FOREIGN OKF bundle's links because
> it only checked `mode==='okf'`, not provenance. Now `isForeignVault` detects a
> foreign bundle by a root `loop.manifest.json` (a loopkit/brainkit-family marker
> Duo never writes) and skips the boot rewrite — respect the bundle as-is. Explicit
> `duo vault relink` unaffected. 248/248 vault tests + typecheck clean. (From the
> OKF/brainkit folder-hierarchy work — brainkit **v0.3.0** contract-v2 shipped to
> the separate **loop-library** repo `main` via PR #14; decision docs live at
> `docs/research/okf-brainkit-folder-hierarchy.html` + `docs/research/duo-changes-plain.html`.)

> **v0.13.2 CUT + PUSHED 2026-07-01.** ENH-242 (init-on-choose vault, PR #118),
> BUG-212 (`[[` default-vault autocomplete, #115), and the D5 foreign-OKF guard
> (#117) all shipped. **ENH-242 process this session:** Atelier prototype
> (owner-approved look+copy) → build (D4 core guard · D1/D2/D5 main dialog + prefill
> IPC + relabel · D6 CLI + 4-surface sync) → **live UI walk via computer-use**
> (native picker → prefilled modal → create, all PASS; the "can't drive
> secondary-monitor dev" memory was refuted — `switch_display` first) → **multi-agent
> adversarial self-review** (16 raised → 11 confirmed; 5 med + 3 low fixed pre-merge)
> → PR #118 merged → cut. Signed + notarized DMG + GitHub Release published;
> `package.json` bumped to **v0.13.3** for next sprint; 2096 tests green; branch
> deleted (merged). Next: triage.

## v0.13.0 cut 2026-06-27 — Shell-command cron jobs + the Send→agent focus fix

> **Shipped & cut (NOT yet pushed/tagged unless noted):** **ENH-237** (#112)
> shell-command cron jobs — `CronJob` is now a discriminated union on `kind`: a
> **claude** job (interactive session, the original ENH-223 behavior) or a
> **shell** job (`duo cron add --run "<cmd>"`) that runs a raw single-line
> command in a background terminal tab — no Claude session, no D4 headless gate.
> Legacy `kind`-less records load as `claude` (back-compat, no migration). Shell
> jobs are CLI-created + UI-edited (deliberate asymmetry, ENH-223 PRD § 12);
> merged with a post-review doc-reconciliation pass (4-surface CLI sync + PRD § 12
> + ledger). **ENH-236** (#113) Send → agent keeps focus + caret in the terminal —
> a browser-mode playground send left OS focus stranded in the page; the shared
> `onSendToDuo` handler now routes its focus leg through the canonical
> `focusPane('terminal')` reclaim (collapsing a drifted inline copy), correcting
> all three send surfaces at once. cron suites 66/66 · typecheck clean ·
> `check:skill-currency` PASS · ENH-236 owner-verified live (no smoke-walk this
> cut — owner chose cut-now). Signed + notarized DMG.
>
> **Deferred ENH-237 follow-ups (open):** a Home-list `kind` badge (a shell job
> looks like a claude job until you open Edit); `coerceJob` single-line-on-load;
> the `CronStore.updateJob` `as CronJob` cast.
>
> **Next move — triage the next sprint.** Standing queue: **ENH-232** (rich
> re-entry for removed-worktree catch-up sessions, P1), **ENH-233** (dismiss /
> mark-reviewed, P1), **ENH-235** (`duo base new` scaffolder, P2) + the standing
> Vault/Home backlog. Two doc-debt items: (1) `docs/dev/RESUME.md` is stale —
> still the 2026-06-21 ENH-224 worktree resume, long-since shipped (v0.11.2);
> needs a from-scratch refresh to v0.13.0 cold-start state. (2) ~10 older ✅
> entries still sit in `tasks.md` (archive-move deferred across cuts).

## v0.12.2 cut 2026-06-25 — Async Catch-Up + the Vault view + OKF rollup discoverability

> **Shipped & merged to `main`:** **ENH-231** (#108) Async Catch-Up — a second Home
> **mode** (Projects ↔ Catch-up) rendering a Command Board of recent sessions in
> Needs-you / In-progress / Done columns, each card a pre-hydrated digest (zero
> inference at open; Stop-hook materialized; `duo home mode|catchup`,
> `duo session digest|note|next`). **ENH-228** (#109) the Vault view — a pinned
> inbox + rollups tab beside Home + a header vault-switcher, backed by the
> `type: rollup` typed-note model (`duo rollup list`; HTML-first
> `duo rollup render`). **ENH-234** (#110) OKF rollup discoverability (docs +
> managed-skill proposal). Both feature PRs were review-hardened on-branch
> pre-merge (catch-up test-result scan + "You asked" cleanup; rollup canonical-only
> provenance stamp + `out:` vault-containment), each adversarially verified.
> Suite **2049 green**, typecheck clean, `check:skill-currency` PASS; signed +
> notarized DMG (`dist/Duo-0.12.2-arm64.dmg`). ENH-231 passed two owner smoke-walks;
> ENH-228's final walk paste-back was waived by the owner-directed merge.
>
> **Next move — triage the next sprint.** Live catch-up follow-ups: **ENH-232**
> (rich re-entry for removed-worktree sessions, P1), **ENH-233** (dismiss /
> mark-reviewed, P1). Also **ENH-235** (`duo base new` scaffolder) + the standing
> Vault/Home backlog, and an archive-debt cleanup (~10 older ✅ entries still
> ✅-in-place in `tasks.md`, not swept during this cut).

## Current state (2026-06-21)

> **Merged to `main`, awaiting the v0.11.2 cut:** ENH-221 durable file version
> history + ⌘Z fix + History modal (#104); ENH-222 worktree lifecycle UX, create +
> removal-recovery (#105); ENH-223 scheduled (cron) Claude sessions, Tier 1+2+3
> (#103); ENH-225 "waiting on you" attention badge (#103); #101 iCloud
> sync-conflict dup detection (dev tooling).
>
> **Cut is GATED on PR #102** — ENH-224 unified Open + Clone flow (branch
> `claude/duo-file-open-flow-g3rpdx`, DRAFT). Do not cut until it lands.
>
> **Carry-forward (do when #102 lands, held back to avoid plumbing collisions with
> it):** `tasks.md` status flips for ENH-221/222/223 → ✅ Shipped + add a
> first-class ENH-225 entry; CLI-doc touch-ups (CLI-COVERAGE.md "last updated" +
> `duo history` follow-up note; `agents/duo.md` attention-hook wording; SKILL.md add
> cron/history/worktree/attention to its verb map). Then `/smoke-walk` + cut v0.11.2.
>
> **Owner-flag (non-blocking):** DST spring-forward wall-times are silently skipped
> (cron) — accept-or-special-case TBD (PRD §11d).

## ENH-228 — Vault view (inbox + rollups) — 📋 PLANNED, decisions FINAL, build not started

> **Branch `claude/vault-inbox-rollups-view-sufwhj` · PR #109 (draft, planning-only).**
> A new top-level **Vault** view beside Home — an **inbox** column (lists `inbox/`,
> +Capture) and a **rollups** column (lists the vault's rollups, view-link + +New).
> Research confirmed rollup discovery is underspecified today (3 uncoordinated
> mechanisms, no registry). **Owner playground decisions are FINAL** (recommended
> option on every card): **D1 rollup = first-class `type: rollup` note** (discovery =
> `type == rollup` corpus query, §D9-clean — no scan/sidecar) · **HTML-first** rollups
> (owner note) · **D2 anchor = the default vault** + header switcher · D3 pinned tab
> when a vault is selected · D4 +New = prefilled Claude session · D5 inbox = all,
> stale flagged · D6 full slice incl. the typed-note lifecycle change. **PRD:**
> [`docs/prd/enh-228-vault-view.md`](../prd/enh-228-vault-view.md) (§ B = phased build
> order). **Extends ENH-229** (rollup family). **Next:** implement in a separate code
> PR — `type: rollup` template + `duo rollup render` read-spec/stamp-provenance +
> `duo rollup list` + IPC + `<VaultView>`.

## ENH-222 — worktree lifecycle UX (✅ MERGED (#105) — pending the v0.11.2 cut)

> **Owner directive:** "keep advancing the worktree controller UI" → two enhancements:
> (1) PM-friendly **Create a worktree** from the dropdown, (2) **graceful removal**
> when an agent merges+deletes the viewed worktree (no render crash; revert to main).
> This is the **ENH-210 D5 B→C escalation** (write/lifecycle verbs, unblocked by the
> non-technical-PM persona). High-fidelity flow study with 6 owner decisions filed at
> [`docs/research/worktree-lifecycle-ux.html`](../research/worktree-lifecycle-ux.html);
> D1-form-UI follow-up at [`docs/research/worktree-create-ui.html`](../research/worktree-create-ui.html).
> **Decisions locked (walks 1–2, 2026-06-18):** D1 form UI = **Variant A**
> (one-line, type-and-go) **+ slug validation** (allow-list `[a-z0-9-]`, auto-name
> fallback); D2–D6 per recs.
> **BUILT + pre-walked (2026-06-19), phased per owner option (a):** core slug +
> `createWorktree`/`removeWorktree` (+ live-git tests) → `duo worktree new/remove`
> CLI (4-surface synced) → FileTree inline-create form (always-on pill) → nav
> worktree-aware revert + banner + `ErrorBoundary` (+ `pathIsWithin` test) →
> `35f7c3a` two pre-walk fixes (lone-repo dropdown, focus backstop). Full suite green
> (1607), typecheck clean. **PRD:** [`docs/prd/enh-222-worktree-lifecycle.md`](../prd/enh-222-worktree-lifecycle.md).
> **Owner smoke-walk 1 (2026-06-20): 2 PASS / 1 SKIP** — LONE-MAIN ✅, REMOVAL ✅ (banner
> was illegible in light mode → fixed `4475df8`, verified), CREATE skipped then confirmed OK
> by owner. **Renumbered ENH-221 → ENH-222** because the other agent's ENH-221
> (`claude/enh-221-file-history`) landed first; **NOT cutting** — retargets a later minor
> than the file-history v0.11.2 (TBD). **Next:** update the PR/branch (no cut). **Open
> follow-ups (don't gate):** in-terminal removal notice (C-3), dropdown refetch-on-open
> (C-5), base-branch picker (C-4) — see PRD § C/E + `tasks.md` ENH-222.
> **NB (2026-06-18):** a broad worktree purge deleted this session's worktree mid-work
> (uncommitted mockups lost + recreated from context, then committed). Lesson: commit
> research artifacts immediately — and this incident is live evidence for enhancement (2).

## ENH-221 — durable file version history (✅ MERGED (#104) — full feature incl. History modal + ⌘Z fix; pending the v0.11.2 cut)

> **Owner report:** "it is impossible to undo changes; this compounds with the speed
> at which autosave occurs." Investigation: in-editor undo is mechanically intact (see
> ADR); the real gap is no durable version history + a volatile per-tab undo stack, so
> aggressive autosave leaves no rollback safety net. **Owner constraint:** don't slow
> autosave (widens the agent-overwrite collision window). **Decision:** option (a) — a
> content-addressed, append-only version-history store in `~/.claude/duo/file-history/`,
> captured fire-and-forget off the save path (zero added latency). Locked ADR in
> `docs/DECISIONS.md`. **Landed this session (code-only, no live verify — another agent
> holds Electron):** `core/file-history-service.ts` (+10 unit tests) · `FilesService.write`
> capture hook + `main.ts` wiring · `duo history <list|show|restore>` (socket + CLI +
> 4-surface docs) · build:cli + sync:claude · 1601/1601 green, typecheck clean.
> **Next (carry-forward):** History-panel UI + diff (surface shape = OPEN owner UX choice —
> ask, don't assume; needs live verify + smoke-walk) · capture external/raw-`Edit` writes
> via the watcher · on-open baseline · live CLI round-trip verify (blocked: sandbox +
> no Electron). Full writeup: `tasks.md` ENH-221.

## ENH-211 — navigator render-flicker (PRD filed, not yet built, 2026-06-11)

> **Owner report:** "a lot of flickering in the file navigator." Root-caused to
> 6 verified mechanisms (M1–M6): the `listings` cache `delete`s before refetch so
> every fs event flashes the `Loading…` placeholder (whole tree when the write is
> in cwd), no renderer-side debounce, the watcher tears down on every
> expand/collapse, and unmemoized rows re-render on every git-watch tick. **PRD
> filed** at `docs/prd/enh-211-navigator-stability-prd.md` (also the canonical
> navigator feature compendium). **Plan:** P0 = D1 stale-while-revalidate + D2
> coalesce (the standalone flash-killer); P1 = D3 incremental watch / D5 git-Map
> identity guard / D4 row memoization; regression tests owed. **Sequenced after
> ENH-210** (sibling `youthful-chebyshev-885712`) — rebase onto post-ENH-210
> `main`; code surfaces are disjoint, only `tasks.md` + this file are append-region
> conflicts. Full writeup: `tasks.md` ENH-211.

## ENH-216 — OKF vault mode (owner-initiated 2026-06-13; walk-1 done 3P/1F/4S; pre-cut batch in flight → v0.11.0)

> **Owner thesis:** the important future use case for vaults is GitHub-renderable /
> broadly-portable KBs → standard markdown links with relative paths (the proposed
> **Open Knowledge Format**), not Obsidian `[[wikilinks]]` (which render as literal
> text on github.com). **Proposal:** an **OKF vault mode** — a second serializer over
> the same `core/vault/` graph model — keeping the `[[ ]]` gesture but writing
> `[Text](./rel.md)` at rest; format chosen **per vault** via a new **File ▸ New Vault**
> picker (+ `duo vault init --format` CLI twin), and the active vault toggles the mode.
> **Status (2026-06-13):** all 11 decisions + 3 follow-ups LOCKED; **Stages 0–5
> implemented** via two ultracode workflows (foundation/dialect-aware core/CLI/IPC/menu,
> then the renderer seam + New Vault modal + auto-relink-on-open + guide/smoke-walk).
> Verified at the code level: typecheck clean, **1425/1425 tests**, `cli/duo` rebuilt,
> check:skill-currency 0 failures, `duo vault init --format=okf` produces the correct
> on-disk shape. Found + fixed a live `vault:detect` IPC-handler gap (a missing
> main-process handler that would have kept the editor out of OKF mode). **Rebased onto
> `main` (0.10.4, post-ENH-210/211/212)** — conflicts were additive (preload nav-bridge,
> this file) and re-verified green; full suite **1542 tests** post-rebase.
> **Walk-1 (v0.10.4, 2026-06-14): 3 PASS / 1 FAIL / 4 SKIP.** PASS: New Vault dialog ·
> `[[ ]]`→md-link expand-on-resolve · cmd+click nav. FAIL: frontmatter `[[ ]]` → re-fixed
> (FOLLOWUP-050 — live autocomplete + silent-stub create flow). SKIP: CLI-init (owner's
> PATH `duo` is the stale installed release w/o `--format`; code correct via `./cli/duo`),
> dialect-flip, Obsidian-compat. Walk-2 sheet trimmed to the 3 unresolved items
> (`docs/dev/smoke-walks/v0.10.4-rev2.html`).
> **Pre-cut batch → v0.11.0 — ALL THREE PENDING ITEMS LANDED** (owner green-lit "do all of
> those things", 2026-06-14). Committed: **FOLLOWUP-051** `e105b85` (frontmatter `[[ ]]`→
> `[[name]]` both modes; a bare rel-path isn't a graph edge in Duo/Obsidian), **BUG-207**
> `c32ee48` (sidecar S1+S4 — verified live, no `.md.duo.json` on note create), **ENH-214**
> `af9434a` (templates in ⌘⇧F + inline badge; data path verified CLI + live IPC). Earlier:
> BUG-208, worksheet copy fix, FOLLOWUP-050. Suite **1555 green**, `cli/duo` rebuilt.
> **Walk-3 pinned** (`docs/dev/smoke-walks/v0.10.4-rev3.html`, aux): 2 owner-eyes items
> (FOLLOWUP-051 keystroke + ENH-214 badge/section call) + 2 carry-forward SKIPs; BUG-207 +
> ENH-214 data path agent-verified. Fixture vault `/tmp/duo-walk-v0104-rev3/`. Then
> `cut-version` (v0.11.0 — OKF is a new vault format → minor bump). Tracked: `tasks.md`
> ENH-216 / FOLLOWUP-050 / FOLLOWUP-051 / BUG-207 / BUG-208 / ENH-214; PRD
> `docs/research/okf-vault-mode.html`.

## BUG-200 — terminal-collapse data-loss fix (in flight, this branch, 2026-06-10)

> **Owner-initiated, parallel to ENH-208.** Collapsing the terminal pane was
> terminating ALL shell / live-Claude sessions (it UNMOUNTED the pane, and
> `TerminalInstance`'s cleanup unconditionally `pty.kill`s). Root-caused via a
> multi-agent investigation (4 readers → synthesis → 3 adversarial verifiers).
> **Surgical fix implemented on `claude/practical-jones-a07605`:** collapse now
> hides the pane via a true `display:none` (kept mounted) instead of unmounting,
> plus a `TERMINAL_MIN_COLS` floor in `PtyManager.resize` as a reflow backstop;
> 3 new pty-manager tests, typecheck clean. **Owner decision (2026-06-10):** ship
> option (a) surgical now; the robust decouple-kill-from-unmount is deferred to
> **ENH-209**. Discovered the canvas pane shares the same unmount pattern →
> **FOLLOWUP-044**. **Owed:** owner smoke-walk (needs a dev build of THIS
> worktree — the currently-running dev is the `enh-208-vault` worktree) → then a
> cut. Full writeup: `tasks.md` BUG-200.

## ENH-208 Vault — Phase 1 SHIPPED, Phase 2 started (2026-06-09)

> **CURRENT (2026-06-09):** **ENH-208 "vault"** (networked work-notes on plain
> Obsidian conventions) — **Phase 1 is complete + on `main`** (PRs **#83 #84 #85
> #86**): the full `duo vault` / `graph` / `base` CLI cluster, the
> `skill/references/vault.md` agent how-to, and the 10-chapter Vault Guide
> (`docs/guide/vault-guide.html`). **Phase 2 (capture UX) started** — **#87**
> (`duo vault default` + default-vault pref) and **#88** (the `@today` smart-token
> model + `duo vault stub` / D19 filing model) merged. Each PR was built on the
> `enh-208-vault` worktree and **merged by a reviewer agent on main** (no self-
> merge); the reviewer caught two real bugs (the `base render --open` IPC key, and
> silent same-minute capture overwrite) before merge. 1189 tests green.
>
> **Phase 2 capture UX — BUILT (2026-06-10, branch
> `claude/thirsty-brahmagupta-125a0a`, awaiting owner smoke-walk → one PR →
> cut, likely v0.11.0).** All five renderer/keyboard features landed in 8
> commits: the **Settings → Default Vault picker** (menu radio submenu, same
> pref file as `duo vault default`, fs-watched so CLI writes reflect live),
> the **⇧⌘N** quick-capture chord (untyped inbox note → editor focused), the
> **⌘⇧F VaultSearchPalette** (debounced full-text over the default vault,
> grouped hits, Enter opens file-at-match via the new core `docMatchIndex`
> occurrence contract), **@today smart tokens** in the AtMention popover, and
> the **silent-stub type-picker** (`[[Name]]`⇥ → New: row → type popover →
> `duo vault stub` code path, incl. "+ new type…"). Two owner re-picks
> (2026-06-10 AUQ): capture took ⌘⇧N — **New Folder moved to ⌥⇧⌘N** (menu
> accelerator + matcher + WCV forward list moved together); vault search took
> ⌘⇧F — **global find-previous retired**, find-bar-local ⌘⇧F kept via a new
> `ctx.inFindBar` matcher yield. A 27-agent adversarial review confirmed 12
> root-cause findings (2 HIGH: the '+ new type' case-mismatch dead-end; the
> capture-phase ⌘⇧F find-bar hijack) — all fixed + regression-tested. Live
> dev verification: capture chord E2E, palette search + congruent goto-match
> (multi-occurrence line + frontmatter-hit cases), createType→stub canonical
> chain, find-bar yield. **1270 tests, typecheck + skill-currency clean.**
> Known limitation filed: FOLLOWUP-048 (the `[[` suggester closes on
> whitespace → popover stubs single-word; narration covers multi-word).
> Owner-walk items that need real keystrokes: @today popover render,
> type-picker feel, Settings menu visual, ⌥⇧⌘N New Folder. Default vault is
> currently pointed at the `/tmp/enh208-vault` walk fixture — re-point or
> `duo vault default --clear` after the walk.

## v0.10.0 SHIPPED (2026-06-08) — multi-window window-2 real, signed DMG + GitHub Release

> **CURRENT (2026-06-08):** **v0.10.0 is cut + shipped** (signed + notarized DMG +
> GitHub Release). Headline: **ENH-191 multi-window — window 2 is real.** File →
> New Window (⌥⌘N) **or** `duo window new` opens a **blank** second window (does
> not clone window 1 pins, NFR-6.2); each window owns its workspace/browser/
> navigator/terminals/geometry, all restored across relaunches (N-window restore,
> ascending-id). Gated by an **"Allow Multiple Windows"** setting (DEFAULT ON);
> OFF disables New Window, makes `duo window new` exit non-zero, and restores only
> window 1 (rest dormant, re-enabling brings them back). Cross-window CLI:
> `DUO_WINDOW` env per terminal, global `duo --window N <verb>`, `duo windows`
> (lists `{id, primary, focused, activeWorkspace}`), `duo doctor` reports
> "Windows: N"; stale/unknown id falls back to the PRIMARY (lowest-id) window.
> App-level resolution is by **identity** (lowest-id primary), never focus
> (`check:routing` grep-gate); app-menu resolves the focused window, renderer IPC
> by `event.sender`. Session file is now `{version:2, windows:[…]}` — forward-
> migration lossless + one-time `.v1.bak`; a downgrade boots an empty session
> gracefully; byte-identical at N=1. Also shipped: **ENH-204** (a new terminal
> opened outside the focused project reverts the rail filter to "All") and
> **ENH-207** (drag navigator file/folder(s) onto the terminal column → inserts
> absolute, POSIX-quoted path(s), one trailing space, no newline; foreign Finder
> drops inert). **1119 tests green; signed + notarized.** PRs #73 + #78 (multi-
> window P5a/P5b), #79 (ENH-204), #81 (ENH-207) — all merged.
>
> **NEXT:** work the carry-forward queue below (PR #80 P5 follow-ups, FOLLOWUP-043,
> BUG-198, two deferred hygiene items).

## ENH-191 P5a Tier 2-4 + S4 + P5b addressing — MERGED + SHIPPED in v0.10.0 (2026-06-07)

> **CURRENT (2026-06-07):** ENH-191 **multi-window window-2 is functional** and verified. P5a Tier 2-4 (interaction crashers, app-menu focus-pointer, workspace windowId-threading, N-window restore + id-reconciliation, NFR-6.2 blank-pin, Tier-4 polish) **plus** the P5b CLI addressing (`DUO_WINDOW` + global `--window N` + `duo windows` + `duo doctor` Windows:N) landed in **10 commits** (`ebf8d68`..`910293c`) on `claude/enh-191-multiwindow` (17 ahead of main v0.9.3). The S4 core: `registry.primary()` (lowest-id, non-throwing) retires `only()` for default resolution; `getFocusedWindow` stays 0 (focus tracked via the `browser-window-focus` event, honoring the cardinal rule). **1093 tests, typecheck clean, routing baseline 0, check:skill-currency 67 verbs.** Live-verified via `duo` probes (addressing → window N; N-window restore w/ distinct slices; no-2N-growth; no crash at N=2) + a **2-window `/smoke-walk` v0.9.3: 8/8 PASS** (owner-walked). **PR submitted** (branch → main).
>
> **SHIPPED in v0.10.0** (merged + cut 2026-06-08). **Process notes:** the `ultracode` adversarial-verify workflow hung mid-run — its residual-crasher census was done manually and found 4 real wrong-window fixes (`b529771` + `36c171f`); discovered the iCloud `.claude/rules/* 2.md` conflict-copy dups (spawn-task chip filed) + 2 pre-existing bugs (a `files:changed` MaxListeners warning at N=2, a PageTab `querySelectorAll`-on-null on a stale restored canvas tab).

## Live carry-forward queue (post-v0.10.0, 2026-06-08)

Now-DONE items cleared: the `claude/enh-191-p4-p5a-dark` merge (PR #78), the
multi-window PRs (#73/#76/#78), ENH-204 (#79), ENH-207 (#81) — **all merged +
shipped in v0.10.0.** Still open:

1. **PR #80 — P5 follow-ups.** The deferred multi-window cleanup batch: **P1**
   concurrency test + **4× P3** polish items. Land on `main` when picked up.
2. **FOLLOWUP-043 — ENH-207 collapsed-rail drop.** Dragging a navigator file/
   folder onto a **COLLAPSED** terminal rail spawns a tab instead of inserting the
   path. Known issue, tracked in `tasks.md`.
3. **BUG-198 — `duo screenshot` times out** (~10s socket cap fires before the
   base64 image round-trips; the CDP capture itself works with a longer timeout).
   Pre-existing (not an ENH-191/203/204/207 regression). Tracked in `tasks.md`.
4. **Deferred hygiene:** move the newly-✅ **ENH-204 + ENH-207** entries from
   `tasks.md` into `tasks-archive.md`; finish any remaining **what-duo-does.html**
   polish for the v0.10.0 capabilities.

> **✅ CURRENT (2026-06-06) — [ENH-195](../../tasks.md) complete + submitted as a PR.**
> The v0.9.0 pre-walk blocker (canvas false-positive) is root-caused + FIXED, and three more items
> landed + were verified live: **canvas fix** (disk-vs-disk `shouldBannerOnClean`), **ENH-197 View diff**
> (destructive-overwrite → Keep mine / Load new / View diff as accept/rejectable tracked changes),
> **BUG-195** (split-view-close ghost — `releaseAuxTab` now unconditional), plus the strip-JSX strips
> + frontmatter-preserve. **923 tests + both typecheckers clean.** v0.9.1-rev2 smoke walk (run in the
> split-view aux per the owner's workflow): **VIEW-DIFF + WARN-HOOK both PASS.** Branch
> `claude/sharp-hamilton-70eb87` submitted as a **PR** — owner decides the version label + merges with
> other branches + does the push/release on `main`. Tracked for later: ENH-196, ENH-198.

> _Below: the prior Sprint-24 v0.8.x polish-wave content (FOLLOWUP-031..040) — lower priority than
> finishing ENH-195; the "v0.8.6 polish wave" framing predates the v0.9.0 cut._

## Sprint anchor

**Goal: TBD — owner to confirm.** The in-flight work is the docs deep-clean; the
next *feature* sprint goal and cut target (PATCH v0.8.x vs MINOR v0.9.0) are the
owner's call. Open engineering work lives in [`tasks.md`](../../tasks.md) — 97
open entries after the ENH-191/D1 split (closed history in
[`tasks-archive.md`](../../tasks-archive.md)). Harvest candidates with the
`sprint-plan` skill (`gather.mjs` reads open entries from `tasks.md`).

> **This doc owns current-sprint scope.** [`RESUME.md`](RESUME.md) is the
> cold-start orientation (durable guardrails + state-at-a-glance) and links here
> for scope — to keep the two from drifting, don't duplicate the scope list in both.

---

## Open product-decision questions for Geoff (standing)

Standing decisions awaiting owner input — none gate the current docs work. Surface
when the relevant work next comes up.

| Question | When it matters |
|---|---|
| **BUG-123 v2 direction** — once v1 cell selection is visible, do you still want cross-boundary text spanning (drag-from-cell-into-outside-text)? Ship as ENH-148-style spike-then-fix, or close BUG-123. | After owner walks v1 |
| **ENH-127 direction** — declined entirely, or pivot to one of: Duo-side composer-window, anti-accidental-submit heuristic, or upstream feature request to Claude Code for raw-newline mode? Lower priority since ENH-142 gave the per-pref toggle. | If accidental-submit pain re-surfaces |
| **ENH-128 walk-4** — owner verification of HEIC drag-drop from Photos.app with the macOS `sips` fallback (~2 min). Closes the image-handling cluster. | Quick walk whenever |
| Cross-machine cohort validation — does a real pack builder walk `distro-pack-builder/playground.md` end-to-end on another Mac? Closes FOLLOWUP-011. | When it happens |
| **ENH-101** expand/collapse chord semantic — rail-collapse (new, orthogonal to ⌘⌥0/9) vs. full-screen (redundant; kill the chord)? | Before scoping the chord |
| **Stage 17a.5** directions A/E (template gallery / registry). | Before any template code work |
| **BUG-024 follow-up** — combine Send→Duo + Comment pills (single split-pill or hover flyout)? | Before further selection-pill iteration |
| Backlinks panel / graph view (Obsidian cluster) — Sprint 18+ anchor, or defer? | When wikilink-autocomplete usage signals demand |

---

## Most recent lesson

- **2026-05-26 — BUG-166 / one-ref-two-purposes pitfall.** When a state ref answers
  two questions with different correct answers, splitting into two refs is cheaper
  than widening a normalize step to cover the gap. The MarkdownEditor baseline ref
  had done double duty for the dirty check (serialized view correct) AND the conflict
  check (raw disk bytes correct); the byte-exact `lastSeenDiskBodyRef` resolves the
  mismatch. (Older sprint logs live in [`session-log.md`](session-log.md).)
