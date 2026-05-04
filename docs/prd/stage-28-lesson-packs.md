# Stage 28 PRD — First-launch lesson packs

> **Status:** spec drafted 2026-05-01. Sprint C of the FTUX-tutorial
> initiative. Filed in `roadmap.html` and `docs/roadmap.html#s28`.
> Depends on Stage 27 (primitives — Sprint A) shipping first;
> Stage 18b (distro pack machinery — Sprint B) optional but
> preferred.
>
> **Why this stage exists.** Stage 27 ships the canvas-authoring
> primitives. Stage 28 is the first real test: build two skill packs
> entirely on those primitives, validate the patterns work for real
> content, and ship the result as the FTUX experience.
>
> **Owner intent (verbatim from the planning AUQ on 2026-05-01):**
> "Test the pattern by building a 'intro to duo' lesson pack,
> including rendered html and accompanying skill; the lesson
> introduces the user (a CLI-noob, with little to no understanding
> of claude code) to the primitives of duo and explains how they
> work together; they start by clicking start lesson, which tells
> claude that the lesson has begun (should it spawn a brand new
> claude in the correct CWD with the lesson skill invoked? ideally);
> the lesson skill is aware of the lesson structure, follows along,
> and is ready to answer questions, knowing where the user is in
> the lesson." Plus: "test the pattern as above, but focused on
> this content `/Users/geoffreydudgeon/Documents/GitHub/duo/untitled-folder/claude-code-basics-temp.md`."

---

## 1. What we're building

Two skill packs that ship as part of the v0.6.0 install bundle:

- **Pack A — `intro-to-duo`** (single-canvas FTUX). Target: CLI-noob
  users new to Claude Code. Walks them through Duo's primitives
  (terminal / browser / canvas / file navigator / agent loop) in a
  click-through interactive.
- **Pack B — `claude-code-basics`** (multi-canvas, derived from
  `untitled-folder/claude-code-basics-temp.md`). Target: PMs (the
  Capital One AIP audience). Validates the multi-canvas pack-with-
  shared-skill case.

Both packs are FTUX defaults (`PACK.json § defaults`) — auto-open as
tabs on first launch; user dismisses → tab closes via existing close
machinery → does NOT reopen on subsequent launches (existing
session-restore semantics; no new "tutorial state" infrastructure).

**Validation goal:** by building these packs, we confirm Stage 27's
primitives are sufficient. Anywhere we have to escape the convention
to make a pack work is a Stage 27 primitive gap that loops back as
a fix or a deferred follow-up.

---

## 2. Decisions (locked via AUQ on 2026-05-01)

| D# | Decision | Rationale |
|---|---|---|
| **D28.1** | Tutorial v1 = click-through interactive with paint regions + form-input pushback. | Owner verbatim: "Click through interactives, with panes that duo can paint within/populate, and with ui elements the user can populate and push to duo for the next steps; sometimes duo will reveal prebuilt content progressively in the canvas, other times it will need to respond and generate content interactively." |
| **D28.2** | Lessons distribute as Stage 18b skill packs. | Owner picked the skill-pack-shaped option in the AUQ. Reuses the install/upgrade machinery. Future enterprise distros (Cap One AIP, Trailblazers) ship their own packs the same way. |
| **D28.3** | FTUX surfacing = preinstalled default tabs that auto-open on first launch only. User dismisses by closing the tab. Closed tabs do NOT reopen on next launch. | Owner verbatim: "duo coming installed with N default content tabs, eg a ftux/duo at a glance canvas; user acknowledges via button and duo closes; it does not reload on next app launch if not reopened." Leans on existing pin/close/session-restore primitives — no new tutorial-state infra. |
| **D28.4** | Skill packs loadable from arbitrary URLs (e.g. enterprise GitHub). | Owner verbatim: "I could also imagine wanting to send a user a link to a skill pack in the enterprises GitHub instance and it being super easy for the user to load it up in duo." Stage 18b's `duo pack install <url>` is the primary surface. |
| **D28.5** | Lean on enduring primitives, not use-case-specific config. | Owner verbatim: "we should build and use enduring primitives like pinning and closing, and not rely on too much use case specific config and logic if it can be avoided." Translation: a tutorial is "just a canvas + skill, marked as default-on-first-launch." No tutorial-progress engine, no tutorial-specific state machine in main, no tutorial-typed tab kind. |

---

## 3. Pack A — `intro-to-duo`

### Audience

CLI-noob users new to Claude Code. Probably the GA/Trailblazers
audience: PMs, designers, non-engineers exposed to Claude Code for
the first time.

### Pack layout

```
~/.claude/duo/packs/intro-to-duo/
├── PACK.json
├── canvases/
│   └── welcome.html              # the tutorial canvas
└── skills/
    └── intro-to-duo-lesson/
        └── SKILL.md              # the lesson skill
```

### `PACK.json` (Sprint A vs. B sequencing note)

```jsonc
{
  "name": "intro-to-duo",
  "version": "1.0.0",
  "description": "FTUX tutorial introducing Duo's primitives",
  "canvases": ["canvases/welcome.html"],
  "skills": ["skills/intro-to-duo-lesson/"],
  "defaults": ["canvases/welcome.html"]   // auto-open on first launch
}
```

If Stage 18b hasn't shipped yet, this pack ships via a transitional
hand-install: `npm run sync:claude` extended to copy `skill/packs/`
to `~/.claude/duo/packs/` (or similar), and `installed.json`
extended with a `pendingDefaults` array that the renderer consults
on first launch.

### `welcome.html` — the tutorial canvas

Skeleton:
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="duo-open-in" content="canvas">
  <meta name="duo-default-editable" content="false">
  <title>Welcome to Duo</title>
  <style>/* Atelier palette + lesson-scaffold styling */</style>
</head>
<body>
  <header data-duo-pane="welcome-header">
    <h1>Welcome to Duo</h1>
    <p>A 5-minute walkthrough of Duo's primitives.</p>
  </header>

  <section data-duo-pane="lesson-body">
    <!-- Initial content: the "Start lesson" pitch.
         Replaced by the agent as the user progresses. -->
    <p>Click "Start lesson" to begin. Duo will spawn a Claude Code
       session that walks you through the primitives.</p>
    <button data-action="claude:spawn"
            data-cwd="~/"
            data-cmd="Begin the intro-to-duo lesson — I'm at step 1.">
      Start lesson
    </button>
  </section>

  <footer data-duo-pane="lesson-footer">
    <button data-action="duo:event"
            data-event="lesson-dismiss"
            data-payload='{"pack": "intro-to-duo"}'>
      Dismiss this lesson
    </button>
  </footer>
</body>
</html>
```

After "Start lesson", the canvas waits for the agent to paint
content into `data-duo-pane="lesson-body"`. The agent does this via
`duo html update --selector "[data-duo-pane=lesson-body]" --html "…"`.

### Lesson skill (`skills/intro-to-duo-lesson/SKILL.md`)

The skill teaches Claude how to BE the lesson. Structure:

- **Prelude:** Skill description metadata so Claude auto-loads when
  the user types "Begin the intro-to-duo lesson…".
- **Architecture:** lesson is event-driven. Skill instructs Claude to:
  1. Run `duo events --follow > /tmp/intro-to-duo.log &` (or use a
     subagent for the watch loop).
  2. Paint content into `data-duo-pane=lesson-body` via
     `duo html update --selector "[data-duo-pane=lesson-body]" --html "…"`.
  3. Each lesson step's HTML includes a `data-action="duo:event"`
     button with `data-event="lesson-step-N-done"`. When clicked, the
     event reaches `duo events --follow` → Claude reads the event →
     paints the next step.
- **Lesson plan:** Numbered list of steps the skill walks through. Each
  step describes (a) what HTML to paint, (b) what event to wait for,
  (c) what content to paint next.

Step-by-step content (illustrative; actual content drafted during work):
1. **What is Duo?** Pane explains Duo is a desktop app pairing terminals
   with a browser + canvas, with a CLI bridge so Claude can drive both.
   Button: "Got it, what's next?" → `lesson-step-1-done`.
2. **The terminal.** Pane explains the terminal is where Claude lives;
   you can have many; ⌘T opens a new browser tab; ⌘N opens a new file.
   Button: "Open a new terminal tab" → `terminal:focus` action +
   `lesson-step-2-done`.
3. **The file navigator.** Pane explains the dual-pane navigator
   (Your Claude settings + this project). Button: "Show me my Claude
   settings" → `nav:reveal --path ~/.claude/CLAUDE.md` +
   `lesson-step-3-done`.
4. **The browser pane.** Pane explains the embedded browser, that
   Claude can drive it via `duo` CLI. Button: "Open a webpage" →
   `browser:open --url "https://anthropic.com"` + `lesson-step-4-done`.
5. **The canvas.** Pane explains canvases are HTML files with rich
   editing, comments, and agent ops. Button: "Try editing this canvas"
   → flips `<meta name="duo-default-editable">` runtime override +
   `lesson-step-5-done`.
6. **You're done.** Pane summary, link to `claude-code-basics` for
   more depth. Button: "Dismiss" → close tab via `duo close` (NEW —
   verb to add OR fall back to `duo:event` and let the agent prompt
   the user to ⌘W).

### Open question — should the skill spawn ALL `duo events --follow` listeners or ONE?

Recommend ONE per lesson session, kept alive via a backgrounded
subagent. The lesson skill instructs Claude to invoke a subagent
that watches events and reports back; main Claude paints. This
keeps the main Claude's context window clean.

### CWD on `claude:spawn` — `~/` vs. `~/.claude/duo/lessons/intro-to-duo/`?

D28.6 (deferred to work-time): Lean toward `~/` — the source curriculum
recommends "general invocation point" for the home directory, and the
lesson is meant to introduce general Duo primitives, not a project.
Tutorial-skill ships at `~/.claude/skills/intro-to-duo-lesson/` via
the pack — accessible from any CWD.

---

## 4. Pack B — `claude-code-basics`

### Audience

PMs (the Capital One AIP cohort and Trailblazers). The canonical
content source is `untitled-folder/claude-code-basics-temp.md` — a
research-backed Claude Code 101 curriculum designed for a 30-minute
self-paced experience with seven concept families and five
"birdhouse" projects.

### Pack layout

```
~/.claude/duo/packs/claude-code-basics/
├── PACK.json
├── canvases/
│   ├── 00-orientation.html          # the index / launcher
│   ├── 01-mental-model.html         # Family A
│   ├── 02-context.html              # Family B
│   ├── 03-place.html                # Family C
│   ├── 04-memory.html               # Family D
│   ├── 05-capability.html           # Family E
│   ├── 06-trust.html                # Family F
│   ├── 07-authoring.html            # Family G
│   └── source.md                    # canonical reference (the temp file moved here)
└── skills/
    └── claude-code-basics-lesson/
        └── SKILL.md
```

### Granularity decision (D28.7)

**Lean toward Family granularity** — 7 canvases (one per concept
Family A–G). Each canvas is ~3-5 minutes; total ~30 min matches the
source curriculum's spine. Per-concept granularity (~25 canvases)
would be too fragmented; per-spine-module would lose the source's
elegant family structure.

`00-orientation.html` is the launcher: explains the curriculum
shape, has a "Start with module 1" button, plus a navigator panel
the user can use to jump between families.

### `PACK.json`

```jsonc
{
  "name": "claude-code-basics",
  "version": "1.0.0",
  "description": "Claude Code 101 — concepts before procedures",
  "canvases": [
    "canvases/00-orientation.html",
    "canvases/01-mental-model.html",
    // ...
  ],
  "skills": ["skills/claude-code-basics-lesson/"],
  "defaults": ["canvases/00-orientation.html"]   // only the orientation auto-opens
}
```

### Canvas structure (per family)

Each Family canvas:
1. Header pane — Family name + 1-line teaser (from source markdown)
2. Body pane — multi-step content. For each block:
   - "Why for a PM" (collapsed by default; click to expand)
   - "Minimum viable explanation" (always visible)
   - "Working analogy" (always visible)
   - "Misconception to preempt" (callout style)
3. "Mark this family done" button → `duo:event` with
   `data-event="family-A-done"`. Skill records progress per pack
   in a sidecar (e.g. `~/.claude/duo/packs/claude-code-basics/progress.json`).
4. "Next family" button → `editor:open` to next canvas (or
   `claude:spawn` with a new lesson focus).

### Lesson skill (`skills/claude-code-basics-lesson/SKILL.md`)

Same shape as Pack A but with broader scope. Skill instructions:
- Watch events for `family-N-done` markers.
- After each family-done event, ask the user reflection questions
  ("What sticks out about Family X?") in the spawning terminal.
- Maintain a per-pack progress file the user can re-enter and resume.

### Source content lifecycle (D28.8)

`untitled-folder/claude-code-basics-temp.md` MOVES into the pack
directory at `canvases/source.md` as the canonical reference.
Removed from `untitled-folder/`. Future pack updates edit `source.md`
and regenerate the canvases (or hand-edit the canvases — both fine).

---

## 5. FTUX surfacing — leaning on existing primitives only

### How it works

1. Stage 18b's installer (or transitional hand-install) places
   each pack at `~/.claude/duo/packs/<name>/`.
2. Installer reads each pack's `defaults[]` array and writes a
   `~/.claude/duo/installed.json § pendingDefaults` array of
   absolute paths.
3. On Duo launch, `installed.json § pendingDefaults` is read AFTER
   the existing session-restore step. Each path is opened as a
   tab via `openFileSmart`. The path is then REMOVED from
   `pendingDefaults` (one-shot).
4. Existing session-restore semantics apply from there: closed tabs
   stay closed; pinned tabs survive.

### What does NOT ship

- No new tab kind (canvases stay `kind: 'file'`).
- No new state in main process for "lesson progress."
- No new IPC channel for "default tabs" — just an extension to
  `installed.json` schema.
- No "Get started" panel / wizard / modal.
- No menu item for tutorials (Help menu can grow one later if felt;
  defer until the surface design needs it).

### What this gives us

- The user closes a default tab → it doesn't reopen.
- The user pins a default tab → existing pin machinery survives.
- A future "reset FTUX" CLI verb (`duo ftux reset`) could re-add
  defaults to `pendingDefaults`. Defer; not v1.
- Enterprise distros add their own packs with their own `defaults` —
  no Duo-side code change needed.

---

## 6. Commit-by-commit sequence

| # | Commit | Files touched | Verifies |
|---|---|---|---|
| 1 | Pack A scaffolding (folder layout, PACK.json, lesson skill skeleton) | NEW `skill/packs/intro-to-duo/PACK.json`, `skill/packs/intro-to-duo/skills/intro-to-duo-lesson/SKILL.md` (skeleton); update `npm run sync:claude` to copy `skill/packs/` if Stage 18b not yet shipped | Pack files arrive in `~/.claude/duo/packs/intro-to-duo/`; lesson skill discoverable |
| 2 | Pack A canvas (welcome.html with all 6 lesson steps wired) | NEW `skill/packs/intro-to-duo/canvases/welcome.html`; using all 5 templates from Stage 27 as references | Canvas opens; "Start lesson" spawns Claude; agent paints into pane |
| 3 | Pack A lesson skill content | Fill out `intro-to-duo-lesson/SKILL.md` with full step-by-step instructions | Real spawn → agent reads skill → walks through; smoke walk via Geoff playing the user |
| 4 | First-launch default tabs hook | `installed.json` schema extension; renderer-side hook to read `pendingDefaults` post-session-restore; `npm run sync:claude` extension OR Stage 18b installer | Fresh install → welcome.html auto-opens; close tab → relaunch → tab does NOT reappear |
| 5 | Pack B scaffolding + 00-orientation.html | NEW `skill/packs/claude-code-basics/...` folder; orientation canvas with module-launcher buttons | Orientation canvas renders; jump-to buttons open each family canvas |
| 6 | Pack B family canvases (01–07) | One per Family from `claude-code-basics-temp.md` source content | All 7 canvases render; can be authored using only Stage 27 primitives |
| 7 | Pack B lesson skill | Shared lesson skill that watches events from any canvas in the pack | Cross-canvas event handling works; reflection prompts fire |
| 8 | Move `untitled-folder/claude-code-basics-temp.md` → `skill/packs/claude-code-basics/canvases/source.md` | Move + clean up `untitled-folder/` | Source content has a permanent home; temp folder triaged |

End-of-Sprint-C smoke walk against both packs as a real user (Geoff).
Verify primitives gaps surface as Stage 27 follow-ups, not as
hand-coded escape hatches.

---

## 7. Out of scope for Stage 28

- "Tutorial completion" tracking surfaces (badges, progress UI).
- "Tutorial library" navigator pane.
- Lesson skill that crosses packs (each pack has its own).
- Birdhouse projects from `claude-code-basics-temp.md` § Objective 2 —
  those are next-session work, not in-Duo lessons. Future packs can
  scaffold them.
- Multi-language pack support.
- Pack content editing UI inside Duo. Authors edit files directly.
- Auto-update for installed packs. (Stage 18b might handle; if not,
  defer.)

---

## 8. Cross-refs

- `roadmap.html` line 185 — Stage 28 entry
- `docs/roadmap.html#s28` — Stage 28 card
- `docs/prd/stage-27-canvas-authoring.md` — the primitives
- `docs/prd/stage-18-first-launch-self-install.md` — TBD if Stage 18b's PRD lives there
- `untitled-folder/claude-code-basics-temp.md` — Pack B source content
- Stage 23 — `claude:spawn` is the "Start lesson" mechanism

---

## 9. Open questions to surface as work begins

- **D28.6** CWD on `claude:spawn` — `~/` (general) vs. lesson-local sandbox. Lean general.
- **D28.7** Pack B granularity — Family (7 canvases) vs. spine module (7 canvases) vs. concept (~25). Lean Family.
- **D28.8** Source content lifecycle — moves into the pack folder or stays as scratch. Lean: moves.
- **D28.9** Subagent vs. main-agent for `duo events --follow` watch loop — subagent recommended (keeps main context clean) but adds coordination cost. Decide during Pack A skill drafting.
- **D28.10** First-launch `pendingDefaults` schema — extend `installed.json` (one file) or new `pending-tabs.json` (separate)? Lean extend `installed.json` (less file sprawl).
- **D28.11** What happens if a `defaults[]` path already has a pinned/restored tab open (user re-installed pack)? Lean: skip — the existing tab wins. Document in Stage 18b.
