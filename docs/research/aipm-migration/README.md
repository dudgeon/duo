# AIPM KB migration pack — schema v1 → v2 ("Option B rev 2, patterns")

**What this is.** A self-contained handoff pack for the agent that operates the AIPM
work knowledge base (brainkit contract-v2 vault, Duo-readable), instructing it to
migrate from the current schema (the `entity-model-reference.md` shape) to the
target schema locked in `docs/research/aipm-initiative-schema.html` (rev 2).
Written by a planning session with full design context but **no access to the live
corpus**; executed by an operator agent with full corpus access. That asymmetry
shapes everything below.

**Contents**

| File | What it is | Authority |
|---|---|---|
| `README.md` | this file — roles, transport, kickoff | — |
| `runbook.md` | decision record + phases 0–9, each with intent · steps · latitude · gate · commit | the spine |
| `verification.md` | the invariant suite, per-phase probes, and the six canonical rollups as final acceptance | frozen |
| `templates/*.md` | the target schema as ready-to-adapt template files — **these ARE the schema** | frozen fields; local conventions adaptable |
| `examples.md` | before/after frontmatter for the seven archetypes | reference |

---

## How this pack divides authority (read this first)

Three roles:

- **The teacher** (the planning session that wrote this pack): knows the target
  model, the engine's capabilities, and the failure modes — but has never seen the
  real corpus. The teacher is **prescriptive** about anything where drift breaks
  interop or safety, and deliberately **silent** about anything requiring corpus
  context.
- **The operator** (you, the work-KB agent — Opus-class, full corpus access): you
  execute the runbook. You have **explicit latitude** wherever a judgment needs
  on-the-ground context — each phase's "Your latitude" block names it. Latitude
  never includes silent action on semantic changes: your judgment is exercised by
  **building proposal tables the owner approves**, then applying them mechanically.
- **The owner** (Geoff): locks the decision record, approves every proposal table,
  is the only authority for `golden/` changes and deletions, and signs off on the
  final acceptance walk.

**Frozen (do not reinterpret, do not improve):**
1. Field names, type names, enum values, and edge semantics — exactly as in
   `templates/`. A "better name" you invent breaks every rollup spec downstream.
2. The invariants and gates in `verification.md`.
3. Phase ORDER (dependencies are real: ids before moves; templates before retypes;
   retypes before re-parenting; regeneration last).
4. The safety protocol (below).
5. The default value-mappings (runbook §0.2) — the owner can override per-note in
   review; you don't override wholesale.

**Yours (judgment expected, propose-first):**
1. The theme merge map, maturity proposals, declaration-vs-decomposition
   classifications, pattern `sources:` seeding, orphan re-parenting — anything
   per-note and semantic.
2. Tooling within the safety rails (prefer `duo vault mv` / `relink` / `schema` /
   `publish` and `duo rollup` where available — they id-heal links; raw `mv`
   never). Batch sizing and in-phase ordering.
3. Adapting template *presentation* to local conventions (header prose, extra
   local guidance) — never the field contract.
4. Surprises: unknown types, malformed notes, contradictions between this pack
   and the corpus → **log to STATE.md, report, and ask**; don't improvise.

**Safety protocol (non-negotiable):**
- Work on a git branch (`schema-v2-migration`); one commit per phase minimum;
  every commit message names the phase and gate result.
- **Never drop a frontmatter key you didn't write** (brainkit contract §3 — e.g.
  `compelling:` on old use_cases survives even though no new template names it).
- **Never delete a note without owner approval.** Merges leave the canonical note
  + rewritten links; the redundant file's removal goes in a proposal table.
- **Never edit `golden/` directly** — propose, owner applies or approves.
- `duo vault relink --dry-run` before and after any phase that moves files.
- After any batch edit, sanity-check `git diff --numstat` is proportionate to the
  batch (the whole-file-churn failure mode).
- Stop conditions (halt, report, wait): a gate fails twice after a fix attempt ·
  >20% of notes violate an assumption this pack makes · a load-bearing type exists
  that this pack doesn't mention · the decision record conflicts with the corpus.

---

## Transport & setup

1. Copy this folder to the work machine, e.g. `<vault-root>/../aipm-migration/`
   (outside the vault so its files never enter the corpus; anywhere readable works).
2. Requirements: `git` (vault is a repo — if not, `git init` + initial commit is
   Phase 0), `duo` CLI **v0.13.6+** (`duo --version`; the vault verbs are
   filesystem-direct — the Duo app need not be running). If `duo` is absent the
   runbook's fallbacks apply, but the mv/relink id-healing is strongly preferred.
3. The operator maintains `STATE.md` **in this folder**: current phase, last
   commit sha, open proposal tables, surprises log. On any session restart:
   re-read `runbook.md` + `STATE.md` before touching anything.

## Kickoff prompt (paste to the operator agent, from the vault root)

> Read `../aipm-migration/README.md`, then `runbook.md` fully, then
> `verification.md`. Confirm the decision record in runbook §0 is marked LOCKED —
> if any row is still ASSUMED, stop and ask me to resolve it. Then execute Phase 0
> (read-only preflight) and report its gate results. From then on: one phase at a
> time; after each gate, commit, update `STATE.md`, and give me (a) the gate
> results, (b) any proposal tables awaiting my approval, (c) anything that
> surprised you. Never proceed past a phase whose proposals I haven't approved.
> Your latitude and its limits are defined in the pack — when in doubt, propose,
> don't act.

## What the operator produces (besides the migrated corpus)

1. **Proposal tables** (phases 3, 5, 6, 7) — markdown tables in STATE.md or a
   scratch note, owner-approved before apply.
2. **A dated migration report note in the vault** (Phase 9) — every touched file,
   every proposal's disposition, leftovers — per the vault's own regenerated-view
   discipline.
3. **The six rendered canonical rollups** (Phase 9) — the acceptance artifact the
   owner actually walks.
