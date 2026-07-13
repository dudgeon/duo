# Migration runbook — AIPM KB schema v1 → v2

> Operator: read `README.md` first (roles, safety protocol, stop conditions).
> Phases run in order; each ends at a **gate** (probes in `verification.md`) and a
> **commit**. Semantic changes ship as **proposal tables** the owner approves
> before you apply them. Examples throughout use the decision doc's fictional
> names (Consumer, fraud-team-kb, …) — map them to the real corpus.

## §0 — Decision record (fill from the owner's decision-doc payload, then mark LOCKED)

The pack was written against the recommended options. Each row is ASSUMED until
the owner's Copy-decisions payload (from `aipm-initiative-schema.html` rev 2)
confirms or amends it. **If an amendment matches a listed delta, apply the delta;
if it doesn't, stop — the pack needs the teacher again.**

| # | Decision | Assumed value | Status | If the owner chose differently |
|---|---|---|---|---|
| D1 | Overall shape | B — one `parent:` containment spine | ASSUMED | Any other option invalidates this pack. Stop. |
| D2 | Parent rule | Ownership wins the slot; `origin:` carries spawned-by | ASSUMED | "Lineage wins": skip Phase 7's untangling; org rollups then require stamps — Phase 8 becomes mandatory. |
| D3 | Class type | `pattern` (rename of use_case) + `sources:[]` / `patterns:[]` edges | ASSUMED | "Keep use_case name": Phase 6 skips the retype, applies edges/fields under the old name; templates/pattern.md renames accordingly. "Two types": stop — needs new design. |
| D4 | Maturity ladder | One shared `maturity:` on initiative + pattern | ASSUMED | Variant placements: adjust Phase 5/6 scope per the choice; the §0.2 mapping still applies wherever the ladder lands. |
| D5 | Playbook fields | `playbook: candidate\|drafting\|published` + `playbook_url:` | ASSUMED | Boolean: collapse in templates + Phase 6. Separate type: stop — needs new design. |
| D6 | Themes | Merge to one `theme` type; optional `parent:` theme→theme | ASSUMED | "Keep initiative_theme": skip Phase 3; templates keep both types. |
| D7 | Engagement | Keep explicit `own\|monitor` | ASSUMED | Drop it: remove from template; Phase 5's audit becomes a derivation check only. |
| D8 | Exec rollups | Per-LOB `^=` views now; `exec_org` stamp only when needed | ASSUMED | "Stamp in migration": Phase 8 runs (it is written conditional). "lob type": add a `lob` template + retype LOB roots in Phase 7. |
| D9 | Track naming | Drop the "Track: " display prefix | ASSUMED | Keep names: Phase 4 skips the rename step only. |
| D10 | Taxonomy ref | Optional `playbook_category:` stamped at promotion | ASSUMED | No field: remove from templates/pattern.md + Phase 6. KB-managed taxonomy: stop — needs new design. |
| E1 | (email finding) POC-facing fields | POCs only ever state: what/owner/accountable/status/maturity | LOCKED-BY-DESIGN | Informational — shapes templates' comments, no phase logic. |
| E2 | (email finding) class↔instance edges | Folded into D3 | — | — |

### §0.2 — Default value mappings (owner may override per-note in review)

| From | To |
|---|---|
| use_case `status: observed` | `maturity: experimental` |
| use_case `status: validated` | `maturity: proven` |
| use_case `status: canonical` | `maturity: recommended` |
| use_case `initiative:` (single link) | `sources: [<that link>]` |
| initiative with no maturity evidence | `maturity: experimental` (stated default — cheap to correct upward) |
| `initiative_theme` note | merged/retyped `theme` note (Phase 3 map) |
| track node `type: initiative`, name "Track: X" | `type: track`, name "X" |
| org tiers (existing team → tower → org → LOB chains) | `org_level: team\|tower\|org\|lob` respectively (`pod` available below team; the AIPM root may use `program`) |

Initiative `status:` values (forming/active/paused/complete/retired) are already
correct — untouched. `person`, `platform`, `task`, `decision`, `opportunity`,
`meeting`, `source`, `note` keep their current ladders.

---

## Phase 0 — Preflight (read-only)

**Intent.** Establish the baseline you'll verify against; prove the tools work;
change nothing.

**Steps.**
1. `git status` clean (stash/commit anything pending); create branch
   `schema-v2-migration`.
2. Confirm `duo --version` ≥ 0.13.6.
3. Capture baselines into `STATE.md` (or files beside it): total note count;
   `duo vault schema` output (types + props + entity counts); `duo vault relink
   --dry-run` report; `duo graph orphans` list; `grep -rn '\[\[' --include='*.md' .`
   hit count (stray wikilinks).
4. Record the vault's template-folder path and any local template conventions the
   pack's templates should adopt.

**Your latitude.** None — read-only.

**Gate G0** (`verification.md` §Baselines): baselines recorded; branch exists;
decision record LOCKED. **Commit** ("phase 0: baseline").

## Phase 1 — Identity + link hygiene (mechanical)

**Intent.** Every later phase moves or rewrites notes; moves heal by `id:`. Make
identity airtight *first*.

**Steps.**
1. Mint `id:` on every note missing one — short, opaque, URL-safe, vault-unique
   (Duo's 8-char base36 is the reference shape). Preserve every existing `id:`
   byte-for-byte.
2. Resolve stray `[[wikilinks]]` in notes to rel-md links (target by the live
   corpus; unresolvable ones go in a small proposal table rather than guesses).
3. `duo vault relink --dry-run`: rewrite the unambiguous breakages it reports
   (via `relink` proper), table the ambiguous ones.

**Your latitude.** How you mint (script vs per-note), batch order. Ambiguity is
never resolved by guess — table it.

**Gate G1**: zero `[[` outside templates/docs; relink dry-run reports 0
unambiguous-broken; every note has a unique `id:`. **Commit.**

## Phase 2 — Land the target templates (the schema arrives)

**Intent.** The corpus IS the schema and templates are where both brainkit and
Duo read types from. Landing them first makes every later phase a move *toward*
the declared schema, checkable by `duo vault schema`.

**Steps.**
1. From `templates/` in this pack: add `track.md`, `pattern.md`; replace/update
   `initiative.md`, `organization.md`, `person.md`, `goal.md`, `theme.md`. Do not
   touch `task/decision/opportunity/meeting/source/note/platform` templates.
2. Field names, enums, ladders: exactly as shipped. Local conventions (extra
   prose, house header style): adopt freely.
3. Templates are the owner's files (brainkit seed-once): show the owner the diff
   before committing this phase.

**Your latitude.** Presentation + placement per local convention; merging any
existing local guidance prose into the new templates.

**Gate G2**: `duo vault schema` lists the new types with the expected props; a
trivial probe base passes `duo base lint`. **Commit** (owner-acked).

## Phase 3 — Theme merge (semantic; propose-first)  *(skip if D6 amended)*

**Intent.** One `theme` type, one vocabulary; themes stay fluid but singular.

**Steps.**
1. Enumerate every `theme` + `initiative_theme` note. Draft the **merge map**:
   each source note → canonical target (may be itself), including proposed
   `parent:` links if a natural 2-level hierarchy is already visible, and which
   redundant files will be removed after link rewrite. Duplicates fold their
   names into the canonical note's `aliases:[]`.
2. Owner approves the map.
3. Apply: retype survivors to `type: theme`; rewrite every `themes:[]` entry and
   inbound link to the canonical targets (`duo vault mv` for renames/moves so
   inbound links rewrite); removals only per the approved map.

**Your latitude.** The map itself — clustering near-duplicates, naming canonicals,
proposing hierarchy — is exactly the judgment you're here for. Keep hierarchy
shallow (≤2 levels) unless the corpus argues otherwise.

**Gate G3**: `duo vault schema` shows zero `initiative_theme`; all `themes:[]`
entries resolve; a themes-grouped probe rollup renders with no ⚠ warnings.
**Commit.**

## Phase 4 — Tracks become `type: track`

**Intent.** Track-ness moves from a naming convention into the type system; the
colon-space display names (the YAML-hazard class) retire with it.

**Steps.**
1. Retype each track node `initiative → track`. Add `owner:` (the track lead
   person — stub the person note if missing) and `themes:[]` (the themes this
   track monitors — draft from the track's charter/body; owner confirms in the
   phase report).
2. *(D9)* Rename "Track: X" → "X" via `duo vault mv` — inbound links, including
   every initiative's `tracks:[]` entry, rewrite in the same operation.
3. **Invariant to preserve, structure yours to arrange:** every track's `parent:`
   chain must reach a `goal` and then the AIPM root node. Whether the current
   intermediate program-initiative layer stays or flattens is your call with the
   owner — the ancestor walk works either way; don't leave a track parentless.

**Your latitude.** Intermediate AIPM-structure shape; the monitored-themes drafts;
whether the AIPM root note needs creating (it must exist and be parentless).

**Gate G4**: N `type: track` notes (owner confirms N); zero "Track: " display
names (grep); every `tracks:[]` entry across the corpus resolves to a `track`
note; an `@=<track>` probe returns a plausible union. **Commit.**

## Phase 5 — Initiative axes + engagement audit

**Intent.** The maturity axis (the program's core narrative) lands on every
initiative; engagement is verified against the spine instead of trusted.

**Steps.**
1. Build the **maturity proposal table**: every initiative → proposed
   `maturity:` with one-line evidence (status, dates, body language). No evidence
   → `experimental` (§0.2). Owner approves; apply.
2. Engagement audit (`verification.md` §Engagement): every initiative's chain
   must reach the AIPM root iff `engagement: own`, a business-org root iff
   `monitor`. Mismatches → a small proposal table (usually a wrong parent, not a
   wrong engagement).
3. Add `patterns:[]` only where an adoption is already documented in the body —
   otherwise leave absent (it accrues organically later).

**Your latitude.** The evidence readings. Resist over-claiming maturity — the
owner corrects upward more happily than downward.

**Gate G5**: 100% initiatives carry `maturity:` ∈ ladder; engagement audit clean;
`status:` values ∈ ladder. **Commit.**

## Phase 6 — `use_case → pattern`  *(adjust per D3/D5/D10 amendments)*

**Intent.** The class type arrives: same notes, same identity, sharper semantics.

**Steps.**
1. Retype every `use_case → pattern` (filenames keep their slugs — no moves
   needed for the retype itself).
2. Apply §0.2 mappings: old status ladder → `maturity:`; `initiative:` link →
   `sources:[]`. Preserve `compelling:` and every other unrecognized key as-is.
3. `parent:` must point at the steward (conceiving org, or a track for
   invested/produced patterns). Patterns whose current parent is missing or is an
   initiative → **re-parenting proposal table** (the ownership rule decides;
   the old initiative parent usually belongs in `sources:[]` instead).
4. `playbook:` — propose values only where the body/owner history shows real
   pipeline state; otherwise absent. `playbook_url:` + `playbook_category:` only
   for already-published patterns (likely none or few).

**Your latitude.** Steward calls, sources seeding beyond the mechanical mapping
(the body often names the originating work), playbook-state readings.

**Gate G6**: zero `type: use_case`; every pattern has `maturity:` + a resolving
`parent:` (org or track); every `sources:[]` entry resolves to an initiative; the
Q5 probe rollup renders. **Commit.**

## Phase 7 — Org enrichment, declaration untangling, VP import

**Intent.** The org tree becomes rich enough for exec-level reporting; lineage
and ownership stop sharing one edge.

**Steps.**
1. **Org fields**: every org note gains `org_level:` (per §0.2 tier map),
   `leader:` + `leader_level:` and `champion:` where known, `aliases:[]` where
   natural. `golden/` LOB roots: prepare the exact edits, owner applies.
2. **VP roster import**: from the owner-provided source (format is yours to
   ingest). Idempotent stubs — never clobber an existing note; person stubs for
   each leader with `org:` + `level:`; org notes updated to point `leader:` at
   them.
3. **Declaration untangling** (D2): enumerate every initiative whose `parent:` is
   another initiative. Classify each with the test: *is the child owned/executed
   by the same org the parent's chain implies?* Same owner → decomposition, keep.
   Different owner → **ownership wins the slot**: re-parent to the child's org
   (`duo vault mv` — the file moves under the org, links heal) and add
   `origin: <the former parent>`. Ship as a proposal table with your
   classification + evidence; owner approves; apply.

**Your latitude.** The classification calls (this is the most judgment-heavy step
in the migration — the worked examples in `examples.md` §D are your anchors);
roster-format handling; whether some teams warrant `pod`-level notes.

**Gate G7**: every org has `org_level:`; every monitored initiative's chain
reaches a LOB root; engagement audit still clean; `origin:` targets are
initiatives; a per-LOB `parent^=<lob>` probe returns plausible sets; VP roster
count matches the owner's expectation (~60). **Commit.**

## Phase 8 — `exec_org` stamps  *(CONDITIONAL — only if D8 locked to stamp-now)*

**Intent.** VP-granularity grouping (Q4/Q6) without engine changes.

**Steps.** Stamp `exec_org:` = nearest ancestor org with `org_level: org` on
every initiative (slug form). Document in the initiative template's comment that
the field is machine-derived and re-derived by distill — nobody hand-edits it.

**Gate G8**: independent recompute (walk the chains yourself a second way)
matches 100% of stamps; own-side initiatives correctly stamp null/absent.
**Commit.**

## Phase 9 — Regenerate, prove, report

**Intent.** The migration is done when the *outputs* are right, not when the
edits are done.

**Steps.**
1. `duo vault relink --dry-run` → clean. `duo vault publish` (listings regenerate).
2. Author the six canonical rollup notes from `verification.md` §Canonical-rollups
   (builder commands provided). `duo base lint` each; render each; **check
   `warnings[]` before trusting any zero-row group** (a silently-dropped filter
   looks like an empty bucket).
3. Write the **migration report note** in the vault (dated): every phase's gate
   results, every proposal table's disposition, files touched (from `git log
   --stat` on the branch), leftovers/known-gaps.
4. Propose retiring `entity-model-reference.md` (superseded by the live
   templates) — owner decides.
5. Owner walks the six rendered rollups + the report → sign-off → merge the
   branch.

**Gate G9 (final acceptance)**: full invariant suite in `verification.md` passes;
the six rollups render owner-plausible; report note committed. **Merge.**
