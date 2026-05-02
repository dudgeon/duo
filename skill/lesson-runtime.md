---
name: lesson-runtime
description: The canonical event-loop and state-persistence pattern that every Duo lesson uses. Read this BEFORE writing a lesson skill — it explains what playgrounds emit, how the lesson skill reacts, where persistent state lives, and the resumption pattern that survives a Duo restart mid-lesson. Companion to make-playground.md (which covers the playground side) and to the canonical lesson template at skill/examples/lesson-template/.
---

# Duo lesson runtime — the canonical event-loop pattern

> **Stage 27 — `skill/lesson-runtime.md`.** The convention every
> Duo lesson follows: how the playground talks to the lesson skill,
> what events the playground emits, how the lesson skill listens
> and persists state, what happens on Duo restart mid-lesson.
>
> Keep this skill SHORT. It's a contract reference, not a tutorial.
> The tutorial-shaped read is the canonical template at
> `skill/examples/lesson-template/`.
>
> **Vocabulary lock** (see CLAUDE.md § Glossary):
> - **page** — basic HTML tab in the canvas (no actions/events)
> - **playground** — page with interactivity (data-duo-action, events)
> - **lesson** — playground + paired guide skill
> - **start tab** — playground that auto-opens on first launch

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
│ duo html update repaints │ ◀─ html-op ── │ → wait for next click   │
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
# Repaint the body for a new step:
duo html update \
  --selector '[data-duo-pane="step-body"]' \
  --html '<h2>Step 2 — Heading</h2><p>...</p>'

# Update the step counter:
duo html update \
  --selector '[data-duo-pane="step-counter"]' \
  --html 'Step 2 of 6'

# Swap the controls (e.g. when the next step has different buttons):
duo html update \
  --selector '[data-duo-pane="step-controls"]' \
  --html '<button class="cta" data-duo-action="duo:event"
                  data-event="lesson:step-2-done"
                  data-duo-id="next-cta">Next step</button>'
```

**Path resolution:** the lesson skill knows its pack name. The
playground path is always
`~/.claude/duo/packs/<pack-name>/canvases/playground.html`. The
`duo html *` verbs need the active canvas; if the playground is
the active tab, the selector-based update routes there. If multiple
canvases are open, prefer `duo html update --path <abs-path>`
(when supported) or click the playground tab first.

---

## Detecting abandonment

The user closes the tab mid-lesson. Three options:

1. **Don't detect.** If the user comes back, resume from the
   sidecar's `currentStep`. If they never come back, the sidecar
   sits forever marked `completed: false`. Acceptable for short
   lessons.
2. **Heartbeat.** The lesson skill's loop reads
   `duo nav-state` periodically; if the playground tab isn't in
   the open-tabs list, mark abandoned + exit.
3. **Tab-close event** (not yet implemented in Stage 27). Filed
   as a future ENH against the canvas-action verb set.

v1: option 1. The sidecar's `completed: false` + a stale
`lastAdvancedAt` lets a future user (or audit query) tell which
lessons were started + dropped.

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
  `duo html update --selector <sel> --html <html>`,
  `duo html query --selector <sel>`
- **Stage 28 lessons in the wild:** `~/.claude/duo/packs/intro-to-duo/`,
  `~/.claude/duo/packs/claude-code-basics/` (note: these were
  authored before this template existed — they each invented their
  own structure. The next refactor pass will bring them onto this
  canonical pattern.)
