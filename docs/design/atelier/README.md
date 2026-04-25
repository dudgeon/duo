# Atelier — visual redesign bundle

> Source-of-truth for Duo's planned visual aesthetic ("Atelier"). Imported from
> a Claude Design handoff bundle on 2026-04-26. Drives **Stage 12** (system-wide
> visual pass) and supplies the visual specs for the Stage 9 cozy-mode
> follow-up, **Stage 13** (just-added highlight), **Stage 14**
> (track-changes Suggesting / Accepted modes), and **Stage 15** (Send
> → Duo pill).
>
> See ROADMAP.md § Stage 12 for sequencing + scope.

---

## Bundle contents

```
docs/design/atelier/
├── README.md              ← this file (project-side index)
├── HANDOFF-README.md      ← original Claude Design handoff instructions
├── chats/
│   └── chat1.md           ← full transcript of the design conversation
└── project/
    ├── Duo Prototype.html       ← interactive prototype of the chosen direction (Atelier)
    ├── Duo Design Canvas.html   ← three directions side-by-side (Stationery / Atelier / Field Notebook)
    ├── tokens.jsx               ← color + type tokens for all three directions, light + dark
    ├── duo-components.jsx       ← mock UI components (file pane, terminal, working pane, editor)
    ├── prototype-app.jsx        ← prototype orchestration + 16s "Claude moment" demo loop
    ├── design-canvas.jsx        ← canvas page rendering all three directions side-by-side
    ├── macos-window.jsx         ← chrome wrapper
    ├── tweaks-panel.jsx         ← right-side panel exposing direction / theme / cozy / fonts
    └── uploads/                 ← Geoff's annotation drawing (file-pane width + collapse button)
```

To render: open either HTML file in a browser. Both are self-contained
(React from CDN, JSX compiled in-browser via Babel — slow first load,
fine for design review).

## What was decided

The chat transcript (`chats/chat1.md`) is the source of intent. Highlights:

- **Direction**: Atelier — confident redesign. Cream paper + ochre accent
  + serif chrome accents + serif editor body. Light is hero, dark is a
  warm follower. Stationery (safe) and Field Notebook (bold) are documented
  alternatives in `tokens.jsx`.
- **Must-keep**: three-column shape, follow-mode, reveal chip, unified
  working tab strip.
- **Must-lose**: bland; terminal vs working-pane too subtle; terminal tabs
  vs working-pane tabs too visually dissimilar.
- **Cozy mode** ([stage-9 PRD](../../prd/stage-9-cozy-mode.md)) — Geoff's
  confession in the chat: the toggle exists but does nothing visible.
  Atelier proposes paper canvas + serif-flavored mono + 92ch column.
- **Agent presence** — whisper-level. Selection glow when Claude reads;
  titlebar dot when active; just-added highlight (yellow flash, 6s fade)
  when Claude writes; reveal chip stays.
- **Editor** — just-added highlight (Stage 13), Suggesting / Accepted
  modes for track changes (Stage 14), Send → Duo floating
  pill (Stage 15).

## Where each piece lands in the roadmap

| Mock element | Stage | Notes |
|---|---|---|
| Token swap (cream + ochre + serif), light-as-hero, layout depth, tab-strip rhyme, files-pane width 208, collapse-to-rail button | **Stage 12** | System-wide visual pass; L0 foundation for L1+. |
| Cozy mode visual completion (paper canvas, serif mono, 92ch) | **Stage 9 follow-up** | Uses Atelier `termCozy*` tokens; folds into Stage 12. |
| Just-added highlight (`duo-just-added` keyframe, 6s fade) | **Stage 13** (was 11c) | PRD § 6 already names the behaviour ("transient just-changed highlight + margin chip"); mock supplies the visual — yellow `mark` token + 6s curve, **overriding the PRD's "blue fade" placeholder**. |
| Track changes / Suggesting mode (green insertions, red strikethrough, accept-all banner) | **Stage 14** (was 11d) | Realizes D18's track-changes toggle end-to-end — Live / Suggesting / Accepted modes all demonstrated in the prototype's Tweaks panel. |
| Send → Duo floating pill | **Stage 15** (was 15g.1) | Extends the [Stage 15 PRD](../../prd/stage-15-send-to-duo.md) with pill geometry, ⌘D chord, and click-to-fire animation. |

## How to use this when implementing a host stage

1. **Open the prototype in a browser.** The 16-second demo loop on the
   prototype shows every interaction in sequence. Tweaks panel exposes
   direction / theme / cozy / track-changes / scene.
2. **Pull from `tokens.jsx`** rather than re-deriving values. The token
   names (`paper`, `paperDeep`, `paperEdge`, `ink`, `inkSoft`, `accent`,
   `mark`, `termBg`, `termCozyBg`, …) are the contract.
3. **Read `duo-components.jsx`** for the component-level shape — it's a
   mock, not a copy target, so adapt to TipTap / xterm / WebContentsView
   as appropriate. Match the visual output, not the JSX structure.
4. **Cross-check the chat** for any "must keep" / "must lose" hints
   that are easy to miss in the static code.

## Status

- 2026-04-26 — bundle imported; Stage 12 (Atelier visual) created in
  ROADMAP.md (was briefly Stage 17 same morning); cross-references
  added to host stages.
- ⬜ Implementation: not started; **recommended as the L0 next ship**
  per the layered build-order rationalization same day. Stage 12 is
  a foundation, not polish — every L1+ stage (13/14/15/17/19c)
  inherits its tokens, so building those first means re-skinning
  later.
