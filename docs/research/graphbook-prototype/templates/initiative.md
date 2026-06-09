---
type: initiative
owner:
status: active
due:
themes: []
---

## Current state

## Milestones

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
