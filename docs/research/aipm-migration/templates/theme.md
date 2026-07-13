---
type: theme
statuses: [drafting, stable, locked]
timeline: false
---

# theme

A topic in the **fluid working taxonomy** — deliberately cheap to create, merge,
and rename (the playbook's *structured* catalog is a separate, playbook-side
artifact derived from these; see `pattern.playbook_category`). Themes tag both
initiatives and patterns via their `themes:[]` lists; tracks declare the themes
they monitor.

The single theme type replaces the old `theme` / `initiative_theme` split.

Reference frontmatter:

```yaml
type: theme
id: q5w8n2vt
summary: Team- and org-level knowledge bases and their curation
parent: "[Context Management](./context-management.md)"   # optional — theme → theme
#                            # hierarchy is free later: ancestor walks + ^= filters
#                            # work the day a parent appears; keep it ≤ 2 levels
aliases: [KBs, knowledge bases]
status: stable               # optional ladder, carried over from the old type
```

Definition and scope notes live in the body. When two themes turn out to be one,
merge: keep the canonical note, fold the other's name into `aliases:[]`, rewrite
inbound links, and propose the file removal to the owner.
