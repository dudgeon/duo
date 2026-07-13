---
type: initiative
statuses: [forming, active, paused, complete, retired]
timeline: true
---

# initiative

A declared effort — **the one durable entity**: the same note carries the work
from first experiment to finished rollout; fields change, identity never does.
It is the *instance* side of the class/instance pair (see `pattern`).

**The parent rule (teach this, everything follows from it):** `parent:` answers
*"who owns this work?"* — an organization, an AIPM track, a goal, or a bigger
initiative it decomposes. One key, every type, so ownership chains are walkable
end-to-end; folders and rollups both derive from it. When this work was *spawned
by* an initiative someone else owns (a declaration fanning out to teams),
ownership wins the parent slot and the lineage moves to `origin:`.

Reference frontmatter:

```yaml
type: initiative
id: k3x9w2ab                 # minted once, never rewritten — links heal by it
summary: One line, plain language
parent: "[Consumer Fraud](../consumer-fraud.md)"   # who owns this work
origin: "[Team Knowledge Bases](../team-knowledge-bases.md)"   # optional — spawned-by (D2)
owner: "[Dana Wu](../../people/dana-wu.md)"        # accountable person
engagement: monitor          # own = AIPM delivers · monitor = tracked for signal
status: active               # execution state (ladder above)
maturity: experimental       # experimental | proven | recommended | required
themes: []                   # cross-tags — agent-suggested, human-confirmed
tracks: []                   # cross-tags to AIPM tracks — agent-suggested
patterns: []                 # optional — patterns this work APPLIES (adoption edge)
# exec_org: consumer-fraud   # ONLY if D8 stamps are adopted: machine-derived
#                            # nearest VP-level org; re-derived by distill, never hand-edited
```

Field classes: `parent/owner/engagement/status/maturity/origin` are stated by a
human (the POC's five facts map onto these); `themes/tracks/patterns` are
agent-suggested cross-tags; `exec_org` (if adopted) is a derived stamp. Timeline,
status narrative, and links to artifacts live in the body — never new frontmatter.
