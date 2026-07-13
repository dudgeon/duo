# Worked before/after examples — the seven archetypes

> Reference anchors for the operator. All names fictional (the decision doc's
> family); map to the real corpus. "Before" shows the v1 shape from
> `entity-model-reference.md`; "after" the v2 target. Every unrecognized key you
> encounter (e.g. `compelling:`) rides along untouched.

## A — Track node (retype + rename, Phase 4)

```yaml
# BEFORE — goals/force-multiplier/identify-and-share/track-context-and-agent-resources.md
type: initiative
summary: "Track: Context and Agent Resources"
engagement: own
parent: "[Identify and Share Best Practices](../identify-and-share.md)"
owner: "[Raj Mehta](../../../people/raj-mehta.md)"
status: active

# AFTER — same file identity, renamed via `duo vault mv` (inbound links rewrite)
type: track
summary: Develops SME + shared assets for context management
parent: "[Identify and Share Best Practices](../identify-and-share.md)"  # chain still reaches the goal — keep or flatten with owner
owner: "[Raj Mehta](../../../people/raj-mehta.md)"
themes:
  - "[Context Management](../../../themes/context-management.md)"
  - "[Knowledge Bases](../../../themes/knowledge-bases.md)"
status: active
```
Note: `engagement:` disappears — tracks aren't initiatives; nothing groups tracks
by engagement. (Removing a key the NEW template doesn't define is allowed only
where this pack's phase says so — this is the one place a key is deliberately
dropped, and it's recorded in the phase report.)

## B — Owned initiative (Phase 5: maturity lands)

```yaml
# BEFORE
type: initiative
engagement: own
parent: "[Track: Context and Agent Resources](../track-context-and-agent-resources.md)"
owner: "[Raj Mehta](…)"
status: active
tracks: []
themes: []

# AFTER — parent LINK TEXT updated by the Phase-4 rename; maturity added
type: initiative
engagement: own
parent: "[Context and Agent Resources](../context-and-agent-resources.md)"
owner: "[Raj Mehta](…)"
status: active
maturity: experimental        # proposed from evidence; owner approved
themes: ["[Knowledge Bases](…)"]
tracks: []                    # own-side: the parent edge IS the track link; no self-tag
```

## C — Monitored initiative (unchanged spine, new axis)

```yaml
# BEFORE
type: initiative
engagement: monitor
parent: "[Consumer Fraud](../consumer-fraud.md)"     # deepest known org — already the v2 rule
tracks: ["[Track: Context and Agent Resources](…)"]
status: active

# AFTER
type: initiative
engagement: monitor
parent: "[Consumer Fraud](../consumer-fraud.md)"
tracks: ["[Context and Agent Resources](…)"]         # rewritten by the Phase-4 rename
maturity: proven
themes: ["[Knowledge Bases](…)"]
```

## D — Declaration untangling (Phase 7 — THE judgment call)

The test: *is the child owned/executed by the same org the parent's chain
implies?*

```yaml
# BEFORE — child parented to the DECLARATION (lineage in the ownership slot)
# organizations/consumer/team-knowledge-bases/fraud-team-kb.md
type: initiative
parent: "[Team Knowledge Bases](../team-knowledge-bases.md)"   # an initiative owned by the LOB
owner: "[Dana Wu](…)"        # …but Dana is Consumer Fraud — DIFFERENT owner → spawned, not decomposition

# AFTER — ownership wins the slot; lineage moves to origin:
# organizations/consumer/consumer-fraud/fraud-team-kb.md   (moved by duo vault mv)
type: initiative
parent: "[Consumer Fraud](../consumer-fraud.md)"
origin: "[Team Knowledge Bases](../team-knowledge-bases.md)"
owner: "[Dana Wu](…)"
```

Counter-case (KEEP): a program initiative decomposed into workstreams run by the
same track — same owner up the chain → real decomposition, `parent:` stays an
initiative, no `origin:`.

## E — use_case → pattern (Phase 6)

```yaml
# BEFORE
type: use_case
status: validated
owner: "[Dana Wu](…)"
initiative: "[Fraud PRD assistant](…)"
tracks: ["[Track: Context and Agent Resources](…)"]
compelling: "cut PRD drafting from 2 days to 2 hours"

# AFTER
type: pattern
maturity: proven                                   # observed→experimental · validated→proven · canonical→recommended
parent: "[Consumer Fraud](../consumer-fraud.md)"   # steward (was missing/implicit)
owner: "[Dana Wu](…)"
sources: ["[Fraud PRD assistant](…)"]              # the old initiative: link, now provenance
tracks: ["[Context and Agent Resources](…)"]
themes: ["[PRD & Spec Drafting](…)"]
compelling: "cut PRD drafting from 2 days to 2 hours"   # unknown key — PRESERVED
playbook: candidate                                # only where pipeline state is real
```

## F — Organization enrichment (Phase 7)

```yaml
# BEFORE
type: organization
parent: "[Consumer](../consumer.md)"
leader: "[Jordan Reyes](…)"
aliases: []

# AFTER
type: organization
parent: "[Consumer](../consumer.md)"
org_level: org                # this is the VP tier (team→tower→org→lob map)
leader: "[Jordan Reyes](…)"
leader_level: vp
champion: "[Sam Ortiz](…)"    # where known; else absent
aliases: [FraudDec]
```

## G — Theme merge (Phase 3)

```yaml
# BEFORE — two notes saying one thing
# themes/knowledge-bases.md          → type: theme
# themes/team-kbs.md                 → type: initiative_theme, summary: team knowledge bases

# AFTER — one canonical note; the duplicate's name becomes an alias; links rewritten
# themes/knowledge-bases.md
type: theme
summary: Team- and org-level knowledge bases and their curation
aliases: [team KBs, team knowledge bases]
parent: "[Context Management](./context-management.md)"   # optional hierarchy
# themes/team-kbs.md → removal PROPOSED to owner after links rewrite (never silent)
```
