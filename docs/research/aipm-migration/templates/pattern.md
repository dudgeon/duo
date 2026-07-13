---
type: pattern
statuses: [experimental, proven, recommended, required]
timeline: false
---

# pattern

A reusable approach — **the class** the playbook publishes, generalized from or
produced by initiatives (the instances). Supersedes `use_case`. Some patterns
emerge at the individual/working level (steward = the conceiving org), some from
concerted investment (steward = the track that built them) — the same `parent:`
rule covers both.

The note's `statuses:` ladder above IS the shared `maturity:` ladder — a pattern
"matures"; its execution has no separate status.

Reference frontmatter:

```yaml
type: pattern
id: m4c8v2rk
summary: Draft PRDs from ticket clusters
parent: "[Consumer Fraud](../consumer-fraud.md)"   # steward: conceiving org, or the investing track
owner: "[Dana Wu](../../people/dana-wu.md)"
maturity: proven             # experimental | proven | recommended | required
playbook: candidate          # absent | candidate | drafting | published (D5)
playbook_url:                # set when published — the KB note is the playbook's primary key
playbook_category:           # optional (D10) — pointer into the PLAYBOOK-side taxonomy,
#                            # stamped at promotion, refreshed by the promotion pass; never hand-managed here
sources: []                  # the initiative(s) this was generalized from / produced by (provenance)
themes: []                   # cross-tags — agent-suggested
tracks: []                   # cross-tags — agent-suggested
source: "[2026-06-12 fraud sync](../../notes/2026/06/fraud-sync.md)"   # capture lineage
```

Adoption is recorded on the *initiative* side (`patterns:[]`) — each edge has one
owner, and `@=<this-pattern>` unions provenance + adoption for the "who's running
this" view. The write-up that becomes the playbook entry lives in the body.
Legacy keys from the use_case era (e.g. `compelling:`) are preserved wherever
found — never dropped.
