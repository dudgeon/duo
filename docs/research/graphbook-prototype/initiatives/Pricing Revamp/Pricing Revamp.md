---
type: initiative
owner: "[[Alice Park]]"
status: active
themes:
  - "[[Pricing]]"
---

## Current state

Fee model in draft; signoff blocked. Note this initiative deliberately has
**no due date** and one milestone missing `due` — processing-base fodder.

## Milestones

Same verbatim block as in [[Q3 Launch]] — proving the template pattern.

```base
filters:
  and:
    - type == "milestone"
    - initiative == this
formulas:
  when: 'if(due, due.format("MMM D") + " · " + due.relative(), "— no due date —")'
  flag: 'if(status != "done" && due && due < today(), icon("alarm-clock"), "")'
views:
  - type: table
    name: Milestones
    order:
      - file.name
      - status
      - owner
      - formula.when
      - formula.flag
    summaries:
      due: Earliest
      status: Filled
```
