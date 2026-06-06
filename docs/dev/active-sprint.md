# Active sprint state — ENH-195 + ENH-197 + BUG-195 COMPLETE → PR (owner integrates on main)

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
