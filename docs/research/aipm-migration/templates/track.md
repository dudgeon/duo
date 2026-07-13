---
type: track
statuses: [forming, active, paused, retired]
timeline: true
---

# track

An AIPM workstream developing SME + shared assets in one domain (context, tools,
training, orchestration, measurement, …). Track-ness is carried by this TYPE —
display names carry no "Track: " prefix (D9). Tracks live in AIPM's own tree:
`parent:` chains through a goal to the AIPM root, never into the business org
tree; the lead serves as a collateral duty and keeps their business-org home on
their person note.

Reference frontmatter:

```yaml
type: track
id: t7q2m9cd
summary: Develops SME + shared assets for context management
parent: "[Force Multiplier](../force-multiplier.md)"   # → goal → AIPM root
owner: "[Raj Mehta](../../people/raj-mehta.md)"        # the track lead (collateral duty)
themes:                       # the themes this track MONITORS — read by the
  - "[Context Management](../../themes/context-management.md)"   # agentic tagging pass
  - "[Knowledge Bases](../../themes/knowledge-bases.md)"
status: active
```

A track's operating view (the canonical Q1 rollup) unions its owned children
(their `parent:` points here) with business initiatives cross-tagged via
`tracks:[]` — one `@=` filter, no duplication. Charter, membership, and operating
notes live in the body.
