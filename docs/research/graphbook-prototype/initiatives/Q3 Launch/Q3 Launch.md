---
type: initiative
owner: "[[Alice Park]]"
status: active
due: 2026-07-15
themes:
  - "[[Pricing]]"
---

## Current state

Launch is gated on [[Legal review]]; everything else tracking. Pricing page
copy has a cross-initiative dependency on [[Pricing Revamp]].

## Milestones

The block below is the **one-template rollup pattern**: `initiative == this`
means this exact base block can live verbatim in the initiative *template* —
every new initiative gets a live milestone rollup with zero per-initiative
configuration.

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
