# ENH-231 — Async Catch-Up: a sibling Home mode

> **Status:** Locked-scope PRD (decisions D1–D4 owner-approved 2026-06-23).
> **Ledger:** [tasks.md → ENH-231](../../tasks.md). **Decision playground:**
> [docs/research/async-catchup-home.html](../research/async-catchup-home.html)
> (PR #108). **Extends:** ENH-212 (Home), ENH-225 (attention hooks),
> `electron/claude-session-tracker.ts` (JSONL reader).

## 1 · Problem

Today's Home (ENH-212) aggregates by **project**: two hero panels + a spine of
project cards. That serves "pick up where I left off in repo X." It does **not**
serve the delegation persona the owner named:

> You spin up 8 jobs, walk away, forget what they were, and come back wanting to
> *review the work* — needing, per session, a reminder of the **goal**, your
> **most-recent instruction**, the **file it's touching**, and the **next
> steps**.

That is a **timeline of commingled sessions**, not an aggregation of projects.
A session — not a project — is the unit of attention.

## 2 · The hard constraint (shapes the whole design)

**Duo has no general-purpose inference API.** It cannot summarize a transcript,
write a "what happened" sentence, or cluster sessions by theme **at the moment
Home opens**. Every field the catch-up view shows must already exist as
structured data before you look at it.

The resolving insight: **the inference Home needs already happened — inside each
agent while it worked.** Duo's job is not to *generate* understanding at
open-time; it is to *capture the agent's structured exhaust* at rest-points and
replay it. See §5.

## 3 · Scope

**In (v1):** a second Home **mode** (toggle Projects ↔ Catch-up); the commingled
timeline; the briefing card with the D2 fields; triage filter chips; the "since
you were away" watermark; the Stop-hook digest pipeline; `duo session note/next`
+ `duo home mode`.

**Out (v1, tracked for follow-up):** activity sparklines (A3); batch-launch
grouping (A4); cross-session file-conflict flags (D3 in the playground);
suggested reading order (C3); snooze/pin gestures beyond a basic "mark reviewed"
(C4). All are additive on top of the digest and the timeline.

## 4 · Locked decisions

### D1 — Direction: a sibling mode, not a replacement
Home gains a mode toggle. **Projects** (today's ENH-212 view) and **Catch-up**
(this) coexist; the choice persists and resolves the same in the app and the
CLI (`duo home mode projects|catchup`). Lowest-risk path to validating the
inversion without losing the project mental model.

### D2 — v1 card fields
Each briefing card shows, in order:
1. **Goal** — the session's best available label (one line). **Ladder (owner,
   2026-06-23 live walk): custom-title (`/rename`) → ai-title (Claude Code's
   generated summary) → recap ("Primary Request and Intent" from a compacted
   session's `isCompactSummary`) → slash-command name (`/review`, `/design-sync`
   from a `<command-name>` opener) → first user prompt (cleaned).** The first
   prompt is used ONLY when Claude generated no title/summary — earlier the raw
   first prompt was always used, which surfaced command-expansions ("You are an
   expert code reviewer…") and skill preambles ("Base directory for this skill:…")
   as machinery instead of intent. (`extractGoal` in `electron/session-digest.ts`.)
2. **"You asked"** — the most-recent human turn. The label is literally
   *"You asked"*, never "Last said" — the owner flagged that "last said" is
   ambiguous about *who* spoke; this line is always the human, and the agent's
   own status renders under a different label ("Doing now" / "Result" /
   "Waiting" / "Stopped on").
3. **Next steps** — the agent's latest `TodoWrite` list, with per-item status.
4. **Files in flight** — the set of files the session edited (basename chips).
5. **Artifact chips** — detected outcomes: opened PR #N, tests green/red, files
   created.
Plus a **state badge** (needs-you / working / done / blocked) and a single
**primary action** keyed to that state.

### D3 — The narrative field: agent self-narration, never open-time inference
The one genuinely inference-bound field ("what happened in a sentence") is
authored by the **agent while it runs**, via a new verb the skill teaches it to
call at natural stopping points:
- `duo session note "<one-line status>"` — what just happened.
- `duo session next "<recommendation>"` — the single most useful next action.

These stamp the session's digest; Home replays them verbatim. **Fallback when
the agent didn't narrate:** show the deterministic last-assistant block (today's
Home snippet). Never fabricate — the worst case is exactly what Home shows now.

### D5 — Arrangement: the Command Board (owner 2026-06-23)
Of four explored directions (Triage Inbox · Briefing · Command Board · Review
Deck — `docs/research/async-catchup-home-directions.html`), the owner chose the
**Command Board** (kanban columns), pure (no hybrid). Catch-up renders sessions
as cards in state columns.

### D6 — One axis: attention (owner 2026-06-23, board decision card)
Owner feedback on the first board surfaced that "blocked" and "needs you" were
confusingly peer columns. We explored a second *lifecycle phase* axis (Planning →
Executing → Done, readable from Claude Code plan-mode signals), but the owner's
call was decisive: *"get rid of phase, stick to attention."* The board organizes
by **attention only** — three columns answering "what do I do about it?":
- **Needs you** (act) · **Working** (wait) · **Done** (review).
- **"Blocked" is a reason chip, not a column** — it folds into Needs you beside
  *question* and *plan to approve*. (Confirmed: merge.)
- **Phase is cut from the surface.** The one plan-mode signal kept is the
  *plan-to-approve* Needs-you reason (the crispest attention signal — an
  `ExitPlanMode` with no following approval); that is *attention*, not phase.
- **Default grouping: attention** (confirmed).

`SessionDigest` gains `attention: {reason: 'plan'|'question'|'blocked'} | null`,
extracted at the Stop hook. The state→column signals + confidence are documented
in `docs/research/async-catchup-board.html`. The raw phase signal may still be
captured in the digest for a future view, but is **not surfaced** in v1.

**Still open (one item):** the Done-column primary action default — recommended
model is *Open session →* by default, *Open <artifact> →* for md/html (canvas/
playground), PR/diff as secondary links (D7).

### D7 — Done-column action: re-entry leads, artifact follows (owner-refined; default pending)
Owner: a complete work product rarely means "view the artifact" — usually you want
to **jump back into the session** (iterate / follow-up / read the closing message).
So Done cards lead with **`Open session →`**; the work product is a quieter
secondary link. Exceptions/principle:
- **md / html products lead with the artifact** (`Open report →`) — opens/focuses
  in Duo's canvas (md) or playground (html). The one case the artifact *is* the
  thing to look at, and Duo's home turf.
- **PR / diff are secondary links, not the headline** — PR-review is the
  comparatively rare reach.
- In Duo these aren't rivals: re-entering can surface terminal + canvas together,
  so "Open session" vs "Open report" is only about which one *leads*.
**Work-product signal strength** (feeds both the artifact chips and the secondary
link, captured at the Stop hook — never inferred or looked up at open):
PR opened (`gh pr create` / `mcp__github__create_pull_request`, URL returned in the
result) = *very high, deep-links*; new output file (`Write` to .md/.html/…) = *high*;
edited files on a known `gitBranch`, no PR → diff = *high*; tests/build = *medium*,
a chip not a destination; answer-only (prose, no artifact) = the honest gap, primary
stays `Open session →`. Precedence for the *secondary* link: PR > new doc > diff.

### D8 — Two Duo-owned stores; narrative is NOT in the rebuildable cache (adversarial review, 2026-06-23)
Implementation-planning review found a contradiction in the naive D4 design: the
agent-supplied narrative (`duo session note/next`) is **not** derivable from the
transcript, so storing it in the "rebuildable cache" makes the §D9
delete-cache→byte-identical-rebuild invariant a lie. Resolution — **two files**:
- `~/.claude/duo/session-digests.json` — **transcript-derived only** (goal, youAsked,
  todos, files, artifacts, attention, state, gitBranch, fallbackSnippet). This is the
  cache the §D9 rebuild test gates.
- `~/.claude/duo/home-state.json` — **Duo-owned, NOT rebuildable** (per-uuid
  `{note?, next?, reviewedAt?}` + the "since you were away" watermark). §D9-exempt:
  these are Duo concepts Claude Code never tracks. Narrative is captured at Stop-hook
  time **keyed by uuid** so it survives after the session's tab closes (the Done-review
  case). The rendered card = digest ⊕ annotation, merged at assembly.

### v1 scope + remaining locked answers (owner, 2026-06-23)
- **v1 = FULL build in one PR** (board + digest pipeline + Stop-hook + `duo home mode`
  + `duo session note/next` + skill/agents teaching).
- **Default mode = remember last used** (persisted app-global in `settings.json`,
  fanned out to all windows).
- **Session universe (two-tier):** all active/open sessions **and any session needing
  you** render as **full cards**; the rest of the last-7-days (deduped) render as
  **compact rows** beneath, within each attention column.
- **Cron runs included, badged "scheduled."**
- **Done-card primary** = `Open session →` (md/html leads with the artifact; PR/diff
  secondary) — confirmed.

**The full build playbook (phased, with file:line anchors and the 16 review fixes
applied) lives in [enh-231-implementation-plan.md](enh-231-implementation-plan.md).**

### D4 — Hydration: materialize on the Stop hook
Compute a per-session `SessionDigest` **incrementally, at turn boundaries while
the session is live**, and cache it. Home reads cheap cached digests, never
parses hundreds of MB of transcript at open. Trigger reuses the **managed Stop /
Notification hook already installed for the attention badge (ENH-225)**, which
additionally pings `duo session digest <tab>`; `UserPromptSubmit` refreshes
"You asked". The §D9 treatment is §6.

## 5 · Data provenance — 10 of 11 fields are deterministic

Duo already does seek-based JSONL head/tail extraction
(`electron/claude-session-tracker.ts`). The catch-up digest extends it.

| Field | Source in the transcript | Cost |
|---|---|---|
| Goal | title ladder: custom-title → ai-title → recap intent → `/command` → first `type:"user"` message (cleaned) — D2 | free (reuses the title rungs) |
| You asked | **last** `type:"user"` message (skip tool-results + machinery wrappers) | free (reverse of the first-msg scan) |
| Files in flight | scan `tool_use` blocks for `Edit`/`Write`/`NotebookEdit` → `file_path` set | free (param scan) |
| Next steps | latest `TodoWrite` `tool_use` → its `todos[]` (with statuses) | **free — the unlock** |
| Status / "doing now" | last assistant text block | free (today's snippet) |
| State badge | liveness (`HomeSessionOpen`) + attention flag (ENH-225) + last-block shape | derived |
| Artifacts (PR/tests) | scan Bash `tool_use` for `gh pr`, test runners, file creation | derived |
| Git branch / diff base | `gitBranch` field on entries | free (tail meta) |
| Activity timestamps | per-turn `timestamp` fields | free (collect, don't just take latest) |
| Review state (mark-reviewed) | Duo-owned, keyed on session uuid | Duo state |
| **"What happened" prose** | nothing deterministic produces this | **inference → D3** |

The `TodoWrite` finding is load-bearing: the agent already maintains a
structured plan with completed/in-progress/pending items. That *is* the
next-steps field, requiring no intelligence on Duo's part — only that we read
the latest `TodoWrite` entry from the transcript tail.

## 6 · The pipeline & the §D9 treatment

```
While live ──▶ 1 Trigger     Stop/Notification hook (ENH-225) also pings
                             `duo session digest <tab>`; UserPromptSubmit
                             refreshes "You asked". Fires every turn boundary.
            ──▶ 2 Extract     core/session-digest/ seek-reads the tail and pulls
                             the §5 table. No inference. Reuses the JSONL reader.
            ──▶ 3 Materialize Write the digest to a Duo-owned index keyed on
                             session uuid. A cache, always rebuildable.
At open    ──▶ 4 Assemble    Home reads cached digests, runs the live liveness
                             check it already does, sorts commingled by activity,
                             renders. Zero heavy parse, zero inference at open.
```

**Hydrate on *Stop*, not on *open*.** A turn boundary is when the digest is both
freshest and cheap; it is well before you ever look at Home.

**Is the digest cache a §D9 sidecar violation?** It sits on the line, so be
deliberate:
- **Acceptable because** it is a *materialized index*, not an authority. Every
  field is re-derivable from the transcript; it is refreshed on real evidence
  (the Stop hook fired = the session actually advanced); the transcript remains
  source-of-truth. Same posture as the ENH-212 snippet read — memoized instead
  of recomputed per open.
- **Invariant that keeps it clean:** Home MUST be able to rebuild any digest from
  the transcript on demand and MUST prefer the transcript on any mismatch. The
  cache is a deletable optimization — never the only copy of a fact. A test
  asserts: delete cache → render is byte-identical.
- **Legitimately Duo-owned** (not a mirror, §D9-clean outright): mark-reviewed
  state, the "last seen Home" watermark, and (when built) batch grouping —
  concepts Claude Code does not track.
- **No-store escape hatch** (if the owner later rejects the cache): extract
  lazily at open but **mtime-bounded** — only sessions whose JSONL changed since
  last open, tail-only, in parallel. Slower cold open; zero new persisted state.
  D4 chose the cache; this remains the documented alternative.

## 7 · Surfaces touched (build map)

- `shared/types.ts` — `SessionDigest`, `HomeMode`, extend the Home snapshot;
  `DuoCommandName` += `session`, `home mode`.
- `core/session-digest/` — the deterministic extractor (new; unit-tested off
  fixtures, no DOM/clock, mirrors `homeModel.ts` purity).
- `electron/home-snapshot.ts` — assemble the commingled timeline from digests.
- `electron/install-service.ts` — the Stop/Notification hook already writes via
  the `_duo` marker merge (ENH-225); add the `duo session digest` ping.
- `electron/socket-server.ts` + `electron/preload.ts` + `electron/main.ts` —
  `session` + `home mode` command plumbing.
- `renderer/components/Home/` — `HomeMode` toggle; a `CatchupView` sibling to
  the project view; the `SessionCard` (briefing anatomy); triage chips; the
  watermark. Reuse `ageShort`/`ageWords` and the click contract from ENH-212.
- `cli/duo.ts` — `duo session note|next|digest`, `duo home mode`; then
  `npm run build:cli` + `git add cli/duo`.
- `skill/SKILL.md` + `agents/duo.md` + `docs/CLI-COVERAGE.md` — the 4-surface
  sync for the new verbs; teach the skill *when* to call `session note/next`;
  then `npm run sync:claude`.
- Orientation: `docs/dev/RESUME.md` + `docs/dev/active-sprint.md` on merge.

## 8 · Acceptance

1. A Home toggle switches Projects ↔ Catch-up; the choice persists and has CLI
   parity (`duo home mode projects|catchup` reads/sets it).
2. Catch-up renders a commingled timeline sorted by last activity across all
   known sessions, with the five state badges and working triage filter chips.
3. Each card shows goal, "You asked", next-steps (todos), files, and artifact
   chips — **all from the pre-hydrated digest, zero inference at open**.
4. A digest is (re)materialized on the Stop hook; **delete-cache test → identical
   render** (the §6 invariant).
5. `duo session note/next` stamps the digest and renders verbatim; the snippet
   fallback shows when the agent didn't narrate.
6. typecheck + smoke-walk green; `check:skill-currency` PASS; RESUME.md +
   active-sprint.md refreshed in the shipping PR.

## 9 · Open questions (state-and-proceed)

- **Toggle placement** — segmented control in the Home header vs. a tab. Assume
  header segmented control; revisit in smoke-walk.
- **Session universe** — all `~/.claude/projects/**` sessions, or only those
  touched in the last N days? Assume a rolling window (default 7d) to bound the
  timeline; configurable later.
- **"Working" liveness cadence** — reuse ENH-212's 30s active-tab poll for the
  live pulse; no new cadence.
