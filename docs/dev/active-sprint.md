# Active sprint state — v0.10.0 SHIPPED (multi-window + ENH-204 + ENH-207) → carry-forward below

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
