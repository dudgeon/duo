---
type: goal
statuses: [active, achieved, retired]
timeline: true
---

# goal

An AIPM program goal — the layer between the AIPM root and its tracks/program
initiatives. Business orgs never parent to goals; goals never parent to business
orgs — the two trees meet only through people and cross-tags.

Reference frontmatter:

```yaml
type: goal
id: g4f7p1sx
summary: Force multiplier — make every product team more capable with AI
parent: "[AIPM](../aipm.md)"           # → the AIPM root node (parentless)
owner: "[Program Lead](../people/program-lead.md)"
status: active
```

Narrative and key results live in the body as prose (no structured KR fields —
the frontmatter test: nothing rolls up on them yet).
