# Active sprint state — v0.8.x (docs deep-clean + polish)

**Status (2026-05-31):** **v0.8.4 released** (last tag); `package.json` at
**v0.8.5** in-flight. The Sprint 23/24 chapters — ENH-182 (project rail) plus
the v0.8.0-era FOLLOWUP-031..040 polish wave — shipped across v0.8.0–v0.8.4.

**Current initiative:** the **docs deep-clean (ENH-191)** on branch
`fix/cli-version-and-docs-cleanup`: a CLI/app version-source fix (`duo --version`
+ doctor now derive from `package.json`) plus a full project-docs audit being
executed decision-by-decision — `tasks.md` split (open/archive), company-ref
scrub, the cut-version drift hard-gate, doc-accuracy fixes, and the `about-duo.md`
feature walkthrough.

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
