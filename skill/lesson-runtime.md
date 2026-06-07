---
name: lesson-runtime
description: The canonical event-loop and state-persistence pattern that every Duo lesson uses. Read this BEFORE writing a lesson skill — it explains what playgrounds emit, how the lesson skill reacts, where persistent state lives, and the resumption pattern that survives a Duo restart mid-lesson. Companion to make-playground.md (which covers the playground side) and to the canonical lesson template at skill/examples/lesson-template/.
---

# Duo lesson runtime — the canonical event-loop pattern

> The convention every Duo lesson follows: how the playground talks
> to the lesson skill, what events the playground emits, how the
> lesson skill listens and persists state, what happens on Duo
> restart mid-lesson.
>
> Keep this skill SHORT. It's a contract reference, not a tutorial.
> The tutorial-shaped read is the canonical template at
> `~/.claude/skills/duo/examples/lesson-template/`.
>
> **Vocabulary lock** (see CLAUDE.md § Glossary):
> - **page** — basic HTML tab in the canvas (no actions/events)
> - **playground** — page with interactivity (data-duo-action, events)
> - **lesson** — playground + paired guide skill
> - **start tab** — playground that auto-opens on first launch

## Contents

- [The runtime contract](#the-runtime-contract)
- [Canonical event names](#canonical-event-names)
- [Sidecar state](#sidecar-state)
- [The event-loop pattern](#the-event-loop-pattern)
- [Repaint patterns](#repaint-patterns)
- [Detecting abandonment](#detecting-abandonment)
- [Curriculum case (multi-canvas)](#curriculum-case-multi-canvas)
- [Anti-patterns](#anti-patterns)
- [Cross-references](#cross-references)

---

## The runtime contract

A lesson is two halves talking to each other through Duo's event bus:

```
┌──────────────────────────┐               ┌─────────────────────────┐
│ playground.html          │               │ lesson-skill/SKILL.md   │
│ (in the canvas slot)     │               │ (Claude reads this)     │
│                          │               │                         │
│ user clicks button       │               │ duo events --follow     │
│ → duo:event              │ ──── event ──▶│ → match event.name      │
│   lesson:step-N-done     │   bus  cursor │ → paint next step       │
│                          │               │ → persist cursor        │
│ duo html set repaints    │ ◀─ html-op ── │ → wait for next click   │
│ step-body, counter,      │               │                         │
│ controls                 │               │                         │
└──────────────────────────┘               └─────────────────────────┘
```

The playground knows nothing about lesson state. It just emits
events and accepts repaints. The lesson skill is the state machine.

This separation matters because:
- The playground is sandboxed (no `allow-scripts`); state lives
  outside it.
- A Duo restart mid-lesson destroys the playground's DOM but the
  lesson skill's sidecar JSON survives — resumption is "open the
  playground + replay the cursor."
- Lessons can fork (skill A drives playground X; skill B drives
  the same X for a different audience) without modifying the
  playground.

---

## Canonical event names

The playground emits these via `data-duo-action="duo:event"
data-event="<name>"`. Lesson skills listen on `event.name`.

| Event name | When | Payload |
|---|---|---|
| `lesson:step-N-done` | User clicked the Next/Advance button on step N | None (or `data-payload-from` if the step had user input — e.g. a text field whose value should advance with the click) |
| `lesson:restart` | User clicked Restart | None |
| `lesson:back` | User clicked Back (optional — only present if the lesson supports going back) | None |
| `lesson:done` | Final step's advance button — same shape as `step-N-done` but signals lesson complete | None |
| `lesson:abandon` | (Optional, lesson-emitted by the skill side when the user closes the tab — see "Detecting abandonment" below.) | None |

**Naming rule:** `lesson:` prefix is mandatory. Multiple lessons may
run concurrently in different tabs; the prefix + lesson skill's own
filtering (only acting on its own playground's events) keeps them
independent. **Do not use bare event names** like `step-done` —
they'll collide.

**Step numbering rule:** N is 1-indexed. `lesson:step-1-done` fires
when the user finishes step 1; the skill paints step 2. Final step
N fires `lesson:step-N-done` AND the skill should treat that as
"lesson complete" — OR the playground can fire `lesson:done`
explicitly on the last step's button (cleaner; recommended).

---

## Sidecar state

Each lesson writes its progress to a sidecar JSON at:

```
~/.claude/duo/lesson-state/<pack-name>.json
```

The directory is shared across packs; one file per pack. The lesson
skill creates the directory + file on first run.

**Schema (v1):**

```json
{
  "schemaVersion": 1,
  "packName": "intro-to-duo",
  "currentStep": 3,
  "stepsTotal": 6,
  "startedAt": "2026-05-02T19:30:00Z",
  "lastAdvancedAt": "2026-05-02T19:42:11Z",
  "lastEventCursor": "1777725725181-7",
  "completed": false
}
```

**When to read:**

- On first invocation: read the sidecar; if it exists and
  `completed: false`, resume from `currentStep`. If it exists and
  `completed: true`, the user is replaying — start fresh (or ask).
  If it doesn't exist, create it (step 1, no cursor).

**When to write:**

- After every successful step advance.
- Atomic: write to `<file>.tmp` then rename. Mirrors how
  `pins.json` and `installed-packs.json` persist.

**Why the cursor matters:**

`duo events --follow --since <cursor>` resumes the event stream
from after that cursor. Without persisting the cursor, a mid-lesson
Duo restart causes the stream to replay every event since the
lesson started — your skill paints step 1, then 2, then 3 in rapid
succession before catching up to "now." Persisting the cursor on
every advance means resumption skips ahead correctly.

---

## The event-loop pattern

The canonical loop the lesson skill runs:

```bash
# In a backgrounded shell that the lesson skill watches:
CURSOR=$(jq -r '.lastEventCursor // ""' ~/.claude/duo/lesson-state/<pack-name>.json 2>/dev/null)
SINCE_FLAG=${CURSOR:+--since "$CURSOR"}

duo events --follow $SINCE_FLAG | while IFS= read -r line; do
  # Parse the JSON line
  EVENT=$(echo "$line" | jq -r '.name')
  CURSOR=$(echo "$line" | jq -r '.cursor')

  # Filter: only react to events that belong to THIS lesson
  case "$EVENT" in
    lesson:step-*-done|lesson:done|lesson:restart|lesson:back) ;;
    *) continue ;;
  esac

  # Dispatch — call back into the lesson skill's step-handler.
  # The skill chooses what to paint based on $EVENT.
  handle_event "$EVENT" "$CURSOR"
done
```

In practice you don't write this loop yourself — Claude (running
the lesson skill) handles it inline as part of the lesson's logic,
reading events from `duo events --follow` and dispatching. The
shell sketch above is the LOGICAL shape; how the skill implements
it depends on whether Claude is foreground-polling or has handed
off to a subagent.

**Foreground polling (simplest, fine for short lessons):**

```
While in conversation with the user:
1. Run `duo events --since <cursor> --limit 1` periodically (or
   when expecting an event).
2. If a matching lesson event came back, dispatch.
3. Otherwise keep talking.
```

**Subagent watch loop (cleaner for long lessons):**

```
1. Launch a subagent: "watch ~/.claude/duo/lesson-state/<pack>.json
   for changes; report when currentStep advances."
2. Subagent uses `duo events --follow --since <cursor>` and writes
   each step advance to the sidecar.
3. Main agent (the lesson skill) reads the sidecar when re-invoked,
   resumes from the new currentStep.
```

For a 5-minute single-canvas lesson, foreground polling is fine.
For a multi-canvas multi-hour curriculum, subagent watch is cleaner.

---

## Repaint patterns

Three stable paint regions per the canonical template:

```bash
# Repaint the body for a new step (set = replace innerHTML):
duo html set \
  --selector '[data-duo-pane="step-body"]' \
  --content '<h2>Step 2 — Heading</h2><p>...</p>'

# Update the step counter:
duo html set \
  --selector '[data-duo-pane="step-counter"]' \
  --content 'Step 2 of 6'

# Swap the controls (e.g. when the next step has different buttons):
duo html set \
  --selector '[data-duo-pane="step-controls"]' \
  --content '<button class="cta" data-duo-action="duo:event"
                  data-event="lesson:step-2-done"
                  data-duo-id="next-cta">Next step</button>'
```

**Path resolution:** the lesson skill knows its pack name. The
playground path is always
`~/.claude/duo/packs/<pack-name>/canvases/playground.html`. The
`duo html *` verbs target the active canvas; if the playground is
the active tab, the selector-based write routes there. If multiple
canvases are open, click the playground tab first (`duo edit
<abs-path>`) so it's active before painting.

---

## Detecting abandonment

The user closes the tab mid-lesson. Three options:

1. **Don't detect.** If the user comes back, resume from the
   sidecar's `currentStep`. If they never come back, the sidecar
   sits forever marked `completed: false`. Acceptable for short
   lessons.
2. **Heartbeat.** The lesson skill's loop reads
   `duo status` periodically; if the playground tab isn't in the
   open-tabs list, mark abandoned + exit.
3. **Tab-close event** — not yet emitted by the canvas-action verb
   set; a dedicated close event is a future addition.

v1: option 1. The sidecar's `completed: false` + a stale
`lastAdvancedAt` lets a future user (or audit query) tell which
lessons were started + dropped.

---

## Curriculum case (multi-canvas)

The runtime contract above assumes a SINGLE-CANVAS LINEAR LESSON —
one playground.html with N steps. For curricula that span multiple
canvases (orientation launcher + module canvases), the same
primitives apply with three extensions:

### Extended event names

| Event | When | Emitted from |
|---|---|---|
| `lesson:module-<id>-launch` | User clicks "Start module X" on the orientation | `orientation.html` |
| `lesson:module-<id>-done` | User clicks final "Done with module" CTA | `module-<id>.html` |
| `lesson:module-<id>-abandon` | User clicks "Back to overview" mid-module | `module-<id>.html` |
| `lesson:curriculum-complete` | All modules complete | Orchestrator skill (synthetic) |

In-module step transitions still use `lesson:step-N-done` — the
orchestrator scopes them to the current module by tracking which
module canvas is active.

### Extended sidecar state schema

```json
{
  "schemaVersion": 1,
  "kind": "curriculum",                 // distinguishes from "lesson"
  "packName": "your-curriculum-pack",
  "currentModule": "B",                 // null when between modules
  "modules": {
    "A": { "completed": true, "completedAt": "2026-..." },
    "B": { "completed": false, "currentStep": 3, "stepsTotal": 5 },
    "C": { "completed": false }
  },
  "completed": false,
  "startedAt": "2026-...",
  "lastEventCursor": "...-..."
}
```

`currentModule` is the active module id (null when the user is on
orientation or has abandoned). Per-module `currentStep` lets
mid-module restarts resume at the right step.

### Extended orchestrator flow

The skill that drives a curriculum is structurally similar to a
linear lesson skill, with:

1. **Tab switching.** On `lesson:module-X-launch`, dispatch
   `editor:open` to switch the working tab to `module-X.html`. On
   `lesson:module-X-done` (or `-abandon`), switch back to
   orientation.
2. **Prerequisite checks.** Before dispatching `editor:open` for a
   module, verify its prereqs are met (see the curriculum-template
   SKILL.md). Locked modules paint "Complete X first" messaging
   into the orientation card without switching tabs.
3. **Cross-canvas paint coordination.** The orchestrator paints
   into the ACTIVE canvas (module N's step regions while the user
   is in module N), and into the BACKGROUND canvas (orientation's
   progress region) only on module-done / -abandon transitions
   when the user is about to see orientation again.

See `~/.claude/skills/duo/examples/curriculum-template/lesson-skill/SKILL.md`
for the worked-example orchestrator skeleton.

### When to use which template

- **Linear lesson** (`lesson-template/`) — single playground, N steps,
  ~5-15 min. Author copies one HTML + one SKILL.md. The most common case.
- **Curriculum** (`curriculum-template/`) — orientation + multiple
  modules, ~20-60+ min, user picks order or follows prerequisites.
  Author copies orientation.html + N module-X.html files + an
  orchestrator SKILL.md.

If the modules are small enough to fit in one playground's N-step
shape, prefer the linear template — fewer files, simpler
orchestration. If they're large enough to deserve their own
canvases (think: 7 distinct topics, each with internal steps),
the curriculum template is right.

---

## Anti-patterns

- **Don't omit the cursor.** The whole resumption pattern relies
  on it; without it, restarts replay the whole history.
- **Don't react to events your lesson didn't emit.** Other
  playgrounds open at the same time may emit events. Filter on the
  exact `event.name` strings your lesson's playground uses.
- **Don't paint the same pane twice in one step transition.**
  Race-y double-paints flash the user.
- **Don't forget to persist after each advance.** Write the sidecar
  AFTER you paint, not before. If the paint fails, the cursor
  shouldn't advance.
- **Don't share lesson-state across packs.** One JSON file per
  pack. A pack named `foo` writes to `lesson-state/foo.json`. Two
  lessons running concurrently from two packs each have their own
  file.
- **Don't lecture in the playground.** The playground is a thin
  surface; substance lives in the lesson skill's per-step content
  generation. The playground just paints what the skill sends.

---

## Cross-references

- **Canonical template:** `~/.claude/skills/duo/examples/lesson-template/`
  (playground.html + lesson-skill/SKILL.md skeleton — copy + customize)
- **Authoring playgrounds:** `~/.claude/skills/duo/make-playground.md`
- **Driving an existing playground:** `~/.claude/skills/duo/playground-interaction.md`
- **CLI verbs:** `duo events --follow`, `duo events --since <cursor>`,
  `duo html set --selector <sel> --content <html>`,
  `duo html query --selector <sel>`
- **A lesson in the wild:** `~/.claude/duo/packs/intro-to-duo/`
  (note: pre-canonical structure — authored before this template
  existed. The `claude-code-basics` multi-canvas pack was retired
  and now lives at
  `~/.claude/skills/duo/examples/lesson-pack-template/` as a
  reference shape.)
