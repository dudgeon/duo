---
type: organization
timeline: true
---

# organization

A node in the business org tree: LOB → tower → VP org → team (→ pod). `parent:`
points up one level; LOB roots are parentless (and live under `golden/` — locked,
owner-edited only). The tier is a **stated fact** (`org_level:`), not a computed
depth and not inherited from the leader's rank — a reorg can leave tier and
leader-title briefly out of sync, and that's fine.

Reference frontmatter:

```yaml
type: organization
id: h9d5k3wn
summary: Consumer line of business
parent:                      # up one level; absent on LOB roots
org_level: lob               # lob | tower | org (VP-level) | team | pod
leader: "[Alice Park](../people/alice-park.md)"
leader_level: evp            # evp | svp | vp | director — denormalized, changes rarely,
#                            # kept because rollups can't join through the person note
champion: "[Dana Wu](../people/dana-wu.md)"   # AI-enablement champion crosslink (optional)
aliases: [CONS]              # shorthand the resolution pass matches on
---
```

The org's AI posture, context notes, and the reporting-POC section live in the
body. Champion/POC roles are crosslinks (org ↔ person), not a role entity — the
person note carries the mirror-side under its "AI reporting roles" section.
