# Active sprint state — Sprint 24 / v0.8.1 (v0.8.x polish wave)

**Status (2026-05-25):** **v0.8.0 cut + tagged + pushed + released.** [GitHub Release v0.8.0](https://github.com/dudgeon/duo/releases/tag/v0.8.0) live with signed-notarized DMG attached. Dev bumped to v0.8.1. Sprint 24 is a focused polish wave — clean up the v0.8.0 audit's deferred follow-ups (FOLLOWUP-031 through 040) before any new feature work, then triage 1-2 carry-forward items if time allows.

## Sprint anchor

**Goal:** close the v0.8.0 follow-up backlog. The ENH-182 capstone (project-as-filter-layer) is the marquee chapter that just shipped; Sprint 24 is its polish epilogue. Closing the follow-ups before starting new feature work keeps the codebase clean + lets the next coherent chapter cut as a clean MINOR.

**Definition of done:** all 10 v0.8.0-era FOLLOWUPs (031–040) closed OR explicitly deferred-with-reason. Tier 1 + 2 below are the must-close items; Tier 3 are owner-decision-gated and may stay open.

**Expected cut shape:** v0.8.1 PATCH if the sprint is purely polish (Tier 1+2 only). v0.9.0 MINOR if a coherent capability ships alongside (e.g. ENH-148 v2 multi-select, ENH-162 Clone modal collision UX, ENH-128 HEIC drag-drop walk-4).

---

## Sprint 24 scope (prioritized)

### Tier 1 — Small + bundled into one polish commit (~1 hour total)

These are 1-line / 5-line fixes; the smoke walk can cover them all as a single rev. Bundle into a `chore(v0.8.x-polish): tier-1 followup cleanup` commit.

| ID | Item | File | Effort |
|---|---|---|---|
| **FOLLOWUP-035** | `handleProjectFocus` dead-code probe — verify its use site (or absence) at App.tsx ~901; remove if confirmed dead | `renderer/App.tsx` | 5 min |
| **FOLLOWUP-036** | Focus-release chip aria-label polish. Currently reads "Focused: duo, button, Release focus (duo)" via screen reader — repetitive. Drop visible-text from aria-label or simplify to "Release focus." | `renderer/App.tsx` ~3545 | 5 min |
| **FOLLOWUP-038** | `useWorkspacePillMenuFlag` TS narrowing — `'key' in event` is always true on StorageEvent + any CustomEvent with a `key` field. Practically benign; add a code comment explaining the intent + acknowledging the narrowing edge case. | `renderer/hooks/useWorkspacePillMenuFlag.ts` ~41 | 5 min |
| **FOLLOWUP-040** | Smoke-walk item: with `duo workspace-pill-menu off`, exercise File → New Workspace to verify the menu handler still works post-ENH-184 defeaturing. Add to next smoke walk manifest. | smoke-walk manifest | 5 min |

### Tier 2 — Single-feature commits (~30–60 min each)

| ID | Item | Effort | User impact |
|---|---|---|---|
| **FOLLOWUP-031** | `MaxListenersExceededWarning` on `terminal:claude-presence-changed` (11/10 listeners). Pre-existing; not new with v0.8.0. Fix: hoist `useClaudePresence` subscription to App.tsx + push state via React context (matches `useFrontTerminalClaudeLive` pattern). Eliminates per-TerminalPane listener. | ~30 min | **High** — eliminates a class-1 leak warning that fires routinely in normal use |
| **FOLLOWUP-032** | Double `duo project close` race. Two parallel CLI calls send two `PROJECTS_CLOSE_REQUEST` events; `handleCloseProject` runs twice; second invocation reads stale `projectCounts.get(root)` and stacks two confirm dialogs if claude-kind. Fix: gate on `inFlightCloseRef.current.has(root)` in `handleCloseProject`. | ~20 min | Low — rare race, but a CLI scripter would hit it |
| **FOLLOWUP-033** | `duo project list` returns empty silently during 1–2s renderer-boot window. Add `ready: boolean` to `ProjectsStateSnapshot`; flip to true on first push. CLI emits "renderer not yet ready" warning when false (or blocks until ready, owner decision). | ~30 min | Medium — agents that restart Duo + immediately query confuse with "no projects open" |

### Tier 3 — Design-gated (open for owner direction)

These need a quick owner decision before implementation. **Ask before doing.**

| ID | Item | Decision needed |
|---|---|---|
| **FOLLOWUP-034** | Rail-color rotation past 6 projects. PRD R2 says "rotate shade variants past 6" but didn't specify the shape. 50% collision probability at 4 projects (birthday paradox; P(no collision, N=4, K=6) ≈ 0.278). | What's the shade variant rule? Lighter / darker / saturation shift / overlay marker? Hash to `colorIndex × variant_count`? |
| **FOLLOWUP-037** | `useProjects` probe-after-delete cache. If a pinned project's marker is deleted out-of-Duo mid-session, `markerResults` cache still shows `true` → ghost tile persists across the session. Documented limitation. | Invalidate via fs.watch on each cached dir? Invalidate on focus change? Drop the cache + re-probe periodically? Or leave as-is (current state)? |
| **FOLLOWUP-039** | Cross-window race on `duo workspace-pill-menu`. No multi-window today; future-proofing. | Defer until multi-window ships? Or pre-emptively use `BroadcastChannel`? |

### Sprint-close carry-forward (pick 1-2 if Tiers 1+2 land fast)

In descending priority:

| ID | Item | Status |
|---|---|---|
| **BUG-079** | Ctrl-Tab cycle latency. Sprint 22 walk-1 gave a known-good repro (focus on duo with 1 visible terminal). Sprint 17 instrumentation established total renderer-keydown → switchTab return ≈ 15ms. Hypotheses 4 (modifier release timing) + 5 (upstream consumer race) still open. Instrumentation needed. | Diagnose-only, no fix queued |
| **ENH-128 walk-4** | HEIC drag-drop verification. Owner-walked only (no code work). Closes the image-handling cluster end-to-end. | Awaiting owner walk |
| **ENH-162** | Clone modal destination-collision UX. When user picks an existing folder for clone target, current UX is unclear. | Design pending |
| **ENH-148 v2** | Multi-select v2 — ⇧-click range + ⌘-A select-all + `nav-state.selectedPaths` CLI parity. v1 shipped Sprint 18 (⌘-click). | Spec exists; implementation queued |

### Out of scope (don't pull into Sprint 24)

| ID | Why skip |
|---|---|
| **BUG-093** split crash | Not reproducing on CLI; needs real user gesture |
| **BUG-122** save-conflict hypothesis 2/3 | Needs next-repro `last-conflict.log` to advance |
| **ENH-084 v4** aux glow | Needs 60s owner click-around walk |
| **ENH-127** composer-window direction | Owner declined (per CLAUDE.md § Open questions) |
| **ENH-137** Beginner's Guide | Owner-draft pending |
| **ENH-141** enterprise smoke | Needs real cross-machine test event |
| **ENH-157** browser-pane comments | Design pending; medium-size architectural change |
| **FOLLOWUP-021** `duo install --clean` | Edge case; revisit when a real user hits it |
| **BUG-024** follow-up | Stale; needs re-triage before any work |
| **17a.5** template gallery | Big chunk; not adjacent to v0.8.x |
| **Backlinks/graph view** | Obsidian-cluster anchor; needs sprint of its own |
| **GH-CLUSTER-PROTO gate** | Owner-decision required; not adjacent to ENH-182 polish |

---

## Suggested commit shape for Sprint 24

```
1. chore(v0.8.x-polish): Tier-1 cleanup
   FOLLOWUP-035 + 036 + 038 + 040. ~50 LOC + smoke-walk manifest entry.

2. fix(FOLLOWUP-031): hoist claudePresence subscription to App.tsx + React context
   Eliminates the MaxListeners warning. Refactor: useClaudePresence becomes
   useContext-based; per-TerminalPane no longer registers a listener.

3. fix(FOLLOWUP-032): in-flight ref for duo project close
   Gates handleCloseProject on inFlightCloseRef.current.has(root). Prevents
   double-confirm + stale-count race.

4. feat(FOLLOWUP-033): ProjectsStateSnapshot.ready flag
   Renderer flips to true on first push. CLI `duo project list` includes
   it; agents can poll. Default of false during 1-2s boot window prevents
   the "is duo just slow or are there no projects?" confusion.

5. [Tier 3 + carry-forward TBD per owner direction]

6. smoke walk → cut decision (PATCH v0.8.1 if polish-only; MINOR v0.9.0
   if a capability lands alongside)
```

---

## Lessons captured this sprint (will appear here as they accrue)

*(none yet — Sprint 24 starts here)*

---

## Open questions for the next agent

1. **Tier 3 design decisions** — owner picks the shade-variant rule for FOLLOWUP-034, the cache-invalidation strategy for FOLLOWUP-037, the multi-window stance for FOLLOWUP-039. Default direction (if owner unavailable): defer FOLLOWUP-034 (no urgent need; <7 projects in active use today); defer FOLLOWUP-037 (documented limitation); defer FOLLOWUP-039 (no multi-window today).

2. **Carry-forward picks** — which 1-2 to pull in alongside Tier 1+2? Recommended (in order): BUG-079 instrumentation (helpful for next-walk diagnosis) → ENH-128 walk-4 (1-step owner verification, no agent code) → ENH-162 (UX polish, ~30 min).

3. **Cut shape** — PATCH (v0.8.1) or MINOR (v0.9.0)? Decision at cut time: PATCH if Tier 1+2 only land; MINOR if ENH-148 v2 multi-select OR ENH-162 Clone modal lands as a coherent capability.

---

## v0.8.0 — what shipped (Sprint 23 close, recap)

| Commit | Item |
|---|---|
| [26cfd03](https://github.com/dudgeon/duo/commit/26cfd03) | **ENH-182 Phase 3** — D11 auto-switch + D12 lifecycle/tile right-click menu + **ENH-185 polish** (50px + tooltip) |
| [608034e](https://github.com/dudgeon/duo/commit/608034e) | **ENH-182 Phase 4** — `duo project list/focus/pin/unpin/close` CLI parity |
| [f1adf96](https://github.com/dudgeon/duo/commit/f1adf96) | **ENH-182 Phase 2b** — `file://` browser-tab filter by path membership |
| [282b0bc](https://github.com/dudgeon/duo/commit/282b0bc) | **ENH-184** — workspace pill defeaturing + `duo workspace-pill-menu` CLI |
| [c5d6fea](https://github.com/dudgeon/duo/commit/c5d6fea) | Sprint 23 docs sync + what-duo-does entries + PACK.json bump |
| [4e66419](https://github.com/dudgeon/duo/commit/4e66419) | **FOLLOWUP-030** + **Phase 3c-browser** + **BUG-161/162/163/164** audit fold-in |
| [e30adf1](https://github.com/dudgeon/duo/commit/e30adf1) | **release: v0.8.0** |
| [e80c508](https://github.com/dudgeon/duo/commit/e80c508) | chore: bump to v0.8.1 |

**Smoke walk:** 5/5 PASS via computer-use pre-walk 2026-05-25.

---

## Lessons codified previously (carry into Sprint 24)

From Sprint 22 + 23 (now in CLAUDE.md `§ Working style`):

1. **iCloud Optimize Storage is a class-1 dev hazard** — guards live in `scripts/check-materialization.sh` + `predev` hook + CLAUDE.md § Build commands trap doc.
2. **Promise-cancel-on-cleanup destroys async cache hooks** — pattern in `renderer/hooks/useProjects.ts § comment`.
3. **Owner directive on `~/.claude` qualification** — pure helper `isExcludedFromQualification(dir, homeDir)`.
4. **Structural pares need same-commit grep-audit of all consumers.**
5. **Other-claude tree preservation pattern** — revert-edit-restore dance documented in [`docs/dev/RESUME.md § 8`](RESUME.md).
6. **DMG version drift trap** — `dist-signed.sh` reads `package.json § version` at packaging time.
7. **Phase 3c hook-point lesson** — design effects against the state that captures user intent, not the state that captures the side effect.
8. **Computer-use pre-walking is cheap insurance for smoke walks.**
9. **Other-claude tree preservation pattern validated over three feature commits.**

---

## Open product-decision questions for Geoff (carried from CLAUDE.md)

Standing decisions awaiting owner input — none gate the current sprint. Surface
when the relevant work next comes up.

| Question | When it matters |
|---|---|
| **BUG-123 v2 direction** — once v1 cell selection is visible, do you still want cross-boundary text spanning (drag-from-cell-into-outside-text)? Ship as ENH-148-style spike-then-fix, or close BUG-123. | After owner walks v1 |
| **ENH-127 direction** — declined entirely, or pivot to one of: Duo-side composer-window (separate text area outside the terminal), anti-accidental-submit heuristic, or upstream feature request to Claude Code for raw-newline mode? Lower priority since ENH-142 gave the per-pref toggle. | If accidental-submit pain re-surfaces |
| **ENH-128 walk-4** — owner verification of HEIC drag-drop from Photos.app with the macOS `sips` fallback (~2 min). Closes the image-handling cluster. | Quick walk whenever |
| Cross-machine cohort validation — does a real pack builder walk `distro-pack-builder/playground.md` end-to-end on a non-Geoff Mac? Closes FOLLOWUP-011. | When it happens |
| **ENH-101** expand/collapse chord semantic — rail-collapse (new, orthogonal to ⌘⌥0/9) vs. full-screen (redundant; kill the chord)? | Before scoping the chord |
| **Stage 17a.5** directions A/E (template gallery / registry). | Before any template code work |
| **BUG-024 follow-up** — combine Send→Duo + Comment pills (single split-pill or hover flyout)? | Before further selection-pill iteration |
| Backlinks panel / graph view (Obsidian cluster) — Sprint 18+ anchor, or defer? | When wikilink-autocomplete usage signals demand |
