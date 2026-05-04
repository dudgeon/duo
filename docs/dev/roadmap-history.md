# Roadmap history — preserved fragments from the retired `ROADMAP.md`

> **Why this file exists.** The canonical roadmap is
> [`docs/roadmap.html`](../roadmap.html). The previous synced markdown
> view at `ROADMAP.md` was retired 2026-05-04 because the two files
> drifted in practice; the HTML wins on visual richness (per-stage
> cards, sidebar, comments) and the duplication added a maintenance
> tax. Three sections from the retired markdown were extracted here
> because they were *unique* to it and worth preserving as historical
> reference: the 2026-04-26 stage renumber map, the 2026-04-23
> three-column layout commitment, and the 2026-04-26 GitHub-issue →
> stage-disposition table. Older commits and PRDs reference these by
> their old `ROADMAP.md` anchors; this file is where they now resolve.

---

## Number history (2026-04-26 renumber)

The renumber on 2026-04-26 made stage numbers reflect actual build
order. Old numbers stay valid in commit messages and historical
documentation; this map lets a reader translate.

| Old | New | Stage |
|---|---|---|
| 6 | split → 18 + 21 | Original "Polish & Distribution" — split 2026-04-26 into installer (now 18) + cert-gated polish (now 21) |
| 11b | 16 | External-write reconciliation (chokidar + 3-pane diff) |
| 11c | 13 | Just-added highlight + warn-before-overwrite |
| 11d | 14 | CriticMarkup track-changes + comments |
| 11e | Backlog | Outline + find + polish |
| 11a tail | Backlog | Frontmatter panel, drag-drop, slash menu |
| 12 | Backlog | Skill + connector surface |
| 13 | 20 | Interaction polish + `duo doctor` + TCP fallback |
| 14a | 18 | First-launch self-install (no cert) |
| 14b | 21 | Distribution polish (cert-gated) |
| 15g (or 15g.1) | 15 | Send → Duo (promoted from sub-item to top-level) |
| 15a–f | Backlog | Smaller 15-family primitives (notify, events, etc.) |
| 16 | Backlog | Multi-window |
| 17 | 12 | Atelier visual redesign (moved to front — it's a foundation) |
| 18 (and 18a/b/c) | 19 (and 19a/b/c) | Duo detection & default-claude tabs (Phase 19a env signals shipped 2026-04-26) |
| 19 | 17 | HTML canvas (briefly held Stage 19 between 2026-04-26 morning rename and afternoon renumber — see PRD) |

**PRD file renames done in the same commit:**
- `docs/prd/stage-15g-send-to-duo.md` → `docs/prd/stage-15-send-to-duo.md`
- `docs/prd/stage-18-duo-detection.md` → `docs/prd/stage-19-duo-detection.md`
- `docs/prd/stage-19-html-canvas.md` → `docs/prd/stage-17-html-canvas.md`

Stages 4 (skills panel — CWD-scan narrow scope) and 7 (file navigator
viewer — thin read-only version) and 6 (polish — split into 18 + 21)
are **superseded** by this sequence. Their work items are absorbed
into Stages 10, 11, 12, 18, 21.

---

## Layout commitment (owner, 2026-04-23)

The app layout is locked to a three-column shape:

```
┌────┐┌─────────────────┐┌─────────────────┐
│    ││                 ││ Viewer/Editor   │
│Files││    Terminal    ││ (polymorphic)   │
│    ││                 ││                 │
│    │└─────────────────┘│                 │
│    │┌─────────────────┐│                 │
│    ││  Agent tools    ││                 │
│    ││  (collapsible)  ││                 │
└────┘└─────────────────┘└─────────────────┘
```

See [docs/DECISIONS.md § Layout model + working-pane model](../DECISIONS.md)
for the full ADR. Mapping to stages:

- **Files column** → Stage 10 (✅ substantively shipped via Stage 22 + 26 + idle-thoughts sweeps).
- **Terminal** → middle-top, relocated from left during the Stage 10 reshape.
- **Agent tools** → middle-bottom, collapsible, **Backlog** (was old Stage 12, now in Backlog).
- **Viewer/Editor** → right. Tabbed polymorphic surface with **one
  unified tab strip across all modalities**. A tab can be a browser
  page, a markdown editor, an HTML/code source editor (now: page /
  playground / lesson per the v0.6.1 vocabulary lock), or a file
  preview (image/PDF/CSV). The same file can live in multiple tabs
  under different types (edit the source in tab 3, render it in
  browser tab 4). `duo tabs` returns the mixed list; tab IDs are
  continuous regardless of type. Browser tabs ✅ shipped; editor
  ✅ shipped; HTML page (canvas) tab type ✅ shipped (Stage 17a).

The pre-Stage-10 layout (terminal-left, browser-right, no Files
column) was a waypoint; the reshape landed with Stage 10.

---

## Open issue → stage mapping (as of 2026-04-26)

> Pulled `gh issue list --state open` 2026-04-26. Most issues mapped
> to existing roadmap items at the time; some had already shipped and
> just needed closing. **Re-scrutinize before kicking off any host
> stage** — the issues are mostly one-line titles and the spec lives
> in the stage PRD, not the issue body.
>
> When a stage ships, close the mapped issues with a one-line
> reference to the commit / PR. The "Status" column reflects the
> issue's *roadmap disposition*, not the issue's GitHub status.

| Issue | Title (paraphrased) | Roadmap disposition (new numbers) |
|---|---|---|
| #5 | Highlight + scroll-to-top when Claude pushes md updates | **Stage 13** ✅ shipped — visual covered by Atelier mock; scroll-to-top is a small additional behaviour to spec at kickoff. |
| #6 | Track-changes mode for md editor | **Stage 14** — fully covered (PRD + Atelier Suggesting / Accepted modes). Pending. |
| #7 | Save-state deep dive: warnings on unsaved / overwrite | **Stage 16** (external-write reconciliation, pending) + **Stage 13** ✅ (warn-before-overwrite for dirty buffers, shipped). |
| #9 | Move file path to terminal composer (right-click / drag) | **Backlog** (file → composer; was 15f). |
| #10 | Agent should see selected text + surrounding context | ✅ **Shipped 2026-04-26.** `duo selection` (Stage 11 D29a) extended to browser pane same day. **Closed.** |
| #11 | Zap element from browser to terminal composer | **Backlog** (`duo zap`; was 15e). |
| #12 | Sandbox terminal-operation exploration | **Stage 20** ✅ partially shipped — sandbox-resilience cluster (TCP fallback, `duo doctor`, sandbox-writable install) shipped v0.4.1. |
| #13 | Claude sends temp script to fresh terminal tab for user invocation | **Backlog** (was 15d `duo tab --cmd`); also overlaps with **Stage 19 D27** (`duo new-tab --cmd`) — lock semantics when either kicks off. |
| #15 | Terminal-tab attention notifications (system-level + session name in body) | **Backlog** (`duo notify` + `duo tab name`; was 15b + 15c). |
| #16 | Multi-window support | **Backlog** (was Stage 16). |
| #17 | Click-and-drag target too small | ✅ **Already fixed.** **Closed.** |
| #18 | Goal/task flag in tab header (human ↔ agent reminder) | **Backlog** (folded into `duo tab name`; was 15c). |
| #19 | Mechanism for Claude to "watch" browser / editor (temporary event stream) | ✅ **Shipped v0.6.0.** `duo events --follow` shipped as part of Stage 27 (canvas authoring vocabulary). **Closed.** |
| #20 | `⌃Tab` should cycle tabs in active pane | ✅ **Shipped 2026-04-26** (commit `3976039`, BUG-001 fix). **Closed.** |
| #21 | `⌘N` opens new file in right pane with focus on filename setter | ✅ **Shipped** in Stage 11a (D33a). **Closed.** |
| #22 | `⌘[` in file-explorer focus moves up one level | **Stage 20** — pane-aware shortcut polish, sibling to BUG-001 territory. Pending; ⌘[ now bound to editor list-outdent in v0.5.3, would need a re-spec. |
| #23 | `⌘+` / `⌘-` should change browser content size when right pane has focus | **Stage 20** — pane-aware shortcut polish. Pending. |
| #24 | Persist app state on reload (browser tabs, files, terminal CWDs, file-browser location) | ✅ **Shipped v0.4.2** (Stage 21c Phase 2). **Closed.** |
| #26 | On `⌘T`, focus browser address bar so user can type URL | ✅ **Shipped** in Stage 11 (D33e). **Closed.** |
| #27 | Persist browser history for URL autocomplete | ✅ **Shipped v0.5.1** (Stage 21c Phase 3). **Closed.** |

**Issues to close on next sweep:** #19, #24, #27 (in addition to #10,
#17, #20, #21, #26 which were already on the original close list) —
all subsequently shipped and verified.
