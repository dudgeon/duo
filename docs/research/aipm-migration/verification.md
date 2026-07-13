# Verification suite — probes, gates, and final acceptance

> Frozen contract. Suggested commands assume the `duo` CLI (filesystem-direct; the
> app need not run) plus ordinary grep/python; equivalent probes are fine, the
> **conditions** are not negotiable. Where a probe says "plausible," the judge is
> the owner, not you.

## Baselines (Phase 0 — capture, don't judge)

- Total `.md` note count (excluding templates/, rollups/, output/, golden/ counted separately).
- `duo vault schema` snapshot: types, per-type counts, props, entities.
- `duo vault relink --dry-run` report (broken/ambiguous counts).
- `duo graph orphans` list.
- `grep -rn '\[\[' --include='*.md' . | wc -l` (stray wikilink count).

## Standing invariants (must hold at EVERY gate from G1 on)

| # | Invariant | Probe sketch |
|---|---|---|
| S1 | Note count never silently drops | compare to baseline ± approved removals |
| S2 | Every note keeps its `id:`; no id ever rewritten | git diff on `id:` lines is additions-only |
| S3 | No `[[wikilink]]` persists in notes | grep as in baseline → 0 |
| S4 | Unknown frontmatter keys preserved | spot-check diffs of edited notes: no key deletions beyond the approved mappings |
| S5 | `parent:` chains acyclic, terminating at parentless roots | walk all chains (small script) |
| S6 | Every link (frontmatter + body) resolves | `duo vault relink --dry-run` → 0 unambiguous-broken |
| S7 | `golden/` untouched by you | `git log --stat -- golden/` shows owner-only changes |

## Per-phase gates

**G1 — identity.** S2, S3, S6; every note has `id:` (grep for notes missing the key → 0).

**G2 — templates.** `duo vault schema` lists `track`, `pattern`, updated
`initiative/organization/person/goal/theme` with the fields named in
`templates/`; `duo base lint` passes on a minimal probe base
(`type == "initiative"`, one column).

**G3 — themes.** Zero `initiative_theme` in schema output; every `themes:[]`
entry resolves to a `type: theme` note; probe rollup
`duo rollup new --type initiative --group themes --columns file.name,maturity`
renders with empty `warnings[]`.

**G4 — tracks.** Owner-confirmed count of `type: track`; `grep -rn '"Track: '
--include='*.md'` → 0 (D9); every `tracks:[]` entry corpus-wide resolves to a
track note; probe `--filter '@=<a-track-slug>'` returns both parent-children and
tagged monitors.

**G5 — initiative axes.**
- `maturity:` present on 100% of initiatives, value ∈ {experimental, proven, recommended, required}.
- `status:` ∈ {forming, active, paused, complete, retired}.
- **Engagement audit**: for every initiative, walk `parent:` to its root. Root is
  the AIPM node ⇔ `engagement: own`; root is a business LOB ⇔ `engagement:
  monitor`. Zero mismatches (post-approved fixes).

**G6 — patterns.** Zero `type: use_case`; every `pattern` has `maturity:` and a
`parent:` resolving to an org or track; every `sources:[]` entry resolves to an
initiative; `playbook:` values ∈ {candidate, drafting, published} where present;
`playbook_url:` present ⇔ `playbook: published`.

**G7 — orgs + lineage.** Every org has `org_level:` ∈ {lob, tower, org, team,
pod} (AIPM root may be `program`); every `monitor` initiative's chain reaches an
`org_level: lob` root; every `origin:` target is an initiative; per-LOB probe
`--filter 'parent^=<lob-slug>'` non-empty for each LOB the owner expects active;
VP-org count ≈ owner's roster expectation.

**G8 — stamps (conditional).** Recompute nearest `org_level: org` ancestor
independently for every initiative; 100% match with stored `exec_org:`;
own-side initiatives have no stamp (or null).

**G9 — final.** All standing invariants; all per-phase gates re-run green; the
six canonical rollups below render and survive the owner's walk.

## Canonical rollups (Phase 9 — the acceptance artifacts)

Replace `<slugs>` from the live corpus. After each render: check the JSON/stderr
`warnings[]` — **a zero-row group with a warning is a broken filter, not an empty
bucket** — then `duo rollup render <note> --html --open` for the owner.

```bash
# Q1 — one operating view per track (repeat per track, or start with the busiest)
duo rollup new --type initiative --filter '@=<track-slug>' \
  --group engagement \
  --bucket 'own=Track-owned workstreams' --bucket 'monitor=Monitored in the business' \
  --columns file.name,status,maturity,owner --title "<Track> — operating view"

# Q2 — one org's deep-dive
duo rollup new --type initiative --filter 'parent^=<lob-slug>' \
  --group ancestor:parent:organization,themes \
  --columns file.name,engagement,status,maturity --title "<LOB> — AI initiative deep-dive"

# Q3 — everything by theme, ownership shown
duo rollup new --type initiative --group themes \
  --columns file.name,ancestor:parent:organization,engagement,maturity \
  --title "Initiatives by theme"

# Q4 — a theme under exec orgs (direct membership; note the ~= single-entity semantics)
duo rollup new --type initiative --filter 'themes~=<theme-slug>' \
  --filter 'engagement=monitor' --group exec_org \
  --columns file.name,maturity,status --title "<Theme> across the business"
#   (without Phase 8 stamps: use per-LOB views — one 'parent^=<lob>' filter each)

# Q5 — playbook pipeline
duo rollup new --type pattern --filter 'playbook?' --group playbook \
  --bucket 'candidate=Candidates' --bucket 'drafting=In write-up' --bucket 'published=Published' \
  --columns file.name,maturity,ancestor:parent:organization,owner --title "Playbook pipeline"

# Q6 — VP coverage (with Phase 8 stamps; declared buckets render even when empty)
duo rollup new --type initiative --group exec_org \
  --bucket '<vp-org-slug>=<VP display name>' \
  --columns file.name,themes,maturity --title "VP coverage map"
#   (one --bucket per VP org from the roster; a script may assemble the flag list)
```

## Owner's final walk (checklist to hand over with the renders)

- [ ] Q1: my busiest track's view shows both populations, split correctly.
- [ ] Q2: my home LOB's picture matches how I'd describe it in a meeting.
- [ ] Q3: no theme group is obviously polluted or missing.
- [ ] Q5: the playbook pipeline matches reality (nothing published that isn't).
- [ ] Q6 / coverage: the zero-orgs list is credible (that's the signal).
- [ ] Migration report note: proposals I rejected really weren't applied.
- [ ] Spot-open 5 random notes: frontmatter reads clean, body untouched, history intact.
