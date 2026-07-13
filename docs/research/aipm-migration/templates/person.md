---
type: person
timeline: true
---

# person

Someone in the graph — created **on reference** (owner, leader, champion, source
attendee), never bulk-imported below the VP roster. Carries reporting-structure
edges and aliases; the machine-owned `## Timeline` is regenerated from the graph.

Reference frontmatter:

```yaml
type: person
id: z6b3s8qm
summary: VP Product, Consumer — sponsor of the KB directive
org: "[Consumer](../organizations/consumer.md)"      # home org (the business tree)
manager: "[Pat Ellis](./pat-ellis.md)"               # reporting chain, person → person
level: vp                    # optional: evp | svp | vp | director | ic
aliases: [Alice, AP]
---
```

Body sections:

```markdown
## AI reporting roles
<!-- crosslinks, no role entity — the org note carries the mirror side -->
- AI enablement champion for: —
- Reporting POC for: —

## Timeline
<!-- BEGIN generated:timeline -->
<!-- (regenerated from the graph; do not edit inside these markers) -->
<!-- END generated:timeline -->
```

Track leads keep their business-org home here (`org:`) — the track appointment
is visible from the track note's `owner:` backlink, not duplicated as a field.
