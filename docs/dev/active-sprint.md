# Active sprint state — a+b sprint SET UP (PRDs + backlog hygiene done); implementation queued

> **✅ CURRENT (2026-06-06)** — branch `claude/amazing-goodall-39846b`. Two things landed this session:
> 1. **ENH-113 shipped** — the "file removed on disk" strip mirrored onto the canvas + JSON surfaces,
>    plus a **Close tab** button on all three editing surfaces (commits `8ba05b8` · `dbc586e` · `1dc16e6`).
>    938 tests + both typecheckers clean; main-tab close live-verified on the dev build.
> 2. **The a+b sprint is SET UP (planning only — implementation NOT started):** a feature PRD authored
>    for each of the 8 sprint items; the backlog swept (**35** already-shipped/obsolete entries closed,
>    **80 → 45 open**); **ENH-157** flagged 🟡 needs-owner-guidance; the **ENH-191** docs-deep-clean nag
>    muted (D1–D9 shipped; the about-duo screenshots split to **ENH-204**, which needs a fixture project).

## Sprint anchor

**Goal: the a+b sprint — burn down confirmed-open bugs + low-hanging fruit.** Eight
items, each with a feature PRD under [`docs/prd/`](../prd/):

| Item | What | PRD |
|---|---|---|
| BUG-197 | Navigator rail-peek doesn't commit on a file/folder row click | `enh-190-navigator-resize-peek.md` § 12 |
| BUG-157 | Defensive WCV `setBounds` clamp + delete dead `useTerminal.ts` | `bug-157-browser-bounds-resilience.md` |
| FOLLOWUP-031 | Hoist `claudePresence` IPC listener → kill MaxListeners warning | `followup-031-claude-presence.md` |
| FOLLOWUP-033 | `duo project list` empty during the 1–2s renderer-boot window | `enh-182-project-centric-ux.md` § 10 |
| FOLLOWUP-036 | Focus-release chip aria-label triple-announces the project | `enh-182-project-centric-ux.md` § 10 |
| ENH-198 | Agent CriticMarkup discoverability + a `duo doc suggest` verb | `enh-198-agent-criticmarkup-suggest.md` |
| BUG-093 | Right-click → Move to Split View renderer crash (repro-first) | `bug-093-split-view-move-crash.md` |
| BUG-100 | Send → Duo pill missing on aux-pane (split-view) selections | `stage-15-send-to-duo.md` § 9 |

**Sequencing.** The S-effort renderer/CLI items (BUG-197, FOLLOWUP-031/033/036, ENH-198,
BUG-157) form a single-smoke-walk cluster. **BUG-093 must LEAD with a computer-use repro**
(synthetic events made FOLLOWUP-013 a false-negative) and pairs with BUG-100's aux work.
Open backlog after the sweep: **45 entries** in [`tasks.md`](../../tasks.md) (harvest with
the `sprint-plan` skill). Cut target is the owner's call — likely a v0.9.x PATCH once the
S-cluster lands.

**Implementation status (2026-06-07, branch `claude/amazing-goodall-39846b`):** 6 of 8 built.
- ✅ **Verified live:** BUG-197 (DOM proof) · FOLLOWUP-031 (regression test) · FOLLOWUP-033 (boot-window catch) · FOLLOWUP-036 (a11y) · BUG-157 (browser smoke).
- 🟡 **Built, owner smoke-walk owed:** BUG-100 (aux Send→Duo pill — typecheck-clean; needs a live-Claude + aux text-selection to confirm the pill, which I can't drive without computer-use on the dev Electron).
- ↗ **Handed off:** ENH-198 → PR #74 via comment (the "ENH-203 skill overhaul" owns skill/SKILL.md, agents/duo.md, cli/duo.ts, CLAUDE.md, CLI-COVERAGE — editing them here would conflict).
- ⛔ **Not started:** BUG-093 (Move-to-Split-View crash) — its PRD requires a computer-use crash repro before the `flushSync` fix; can't be driven on the dev Electron, so left for a session where the repro is available. Also filed this session: **ENH-205** (the real per-tab MaxListeners leak — 10 channels, found while verifying FOLLOWUP-031). My ENH-203 (clean-buffer save) renumbered → **ENH-206** to yield 203 to PR #74.

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
