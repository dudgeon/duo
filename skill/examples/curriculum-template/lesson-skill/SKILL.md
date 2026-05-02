---
name: TODO-curriculum-name
description: TODO — one sentence describing what this curriculum teaches and what the user walks away with after completing all modules. Concrete ("A 30-minute curriculum on Claude Code mental models, place, memory, and trust — for PMs new to agentic coding") beats abstract ("Onboarding curriculum").
---

# TODO-curriculum-name

> **You're reading this because the user is working through the
> TODO-curriculum-name curriculum.** Either Duo just spawned a
> fresh Claude tab via the orientation page's "Start module" button,
> or the user invoked you to drive the curriculum manually. Your
> job: orchestrate the multi-canvas walk — switch the working tab
> between orientation + module canvases, mark per-module
> completion in the sidecar, and paint progress back into
> orientation.
>
> Read `~/.claude/skills/duo/lesson-runtime.md § Curriculum case`
> first if you haven't — that's the runtime contract this skill
> assumes (event names, sidecar state schema, paint patterns).

---

## TODO sections — fill these in before shipping

- [ ] Replace `TODO-curriculum-name` everywhere (frontmatter,
      title, directory paths)
- [ ] Replace the `description` frontmatter field
- [ ] Set `MODULE_IDS` below to your actual module ids
- [ ] Set `STEPS_PER_MODULE` per module (or note "single-step")
- [ ] Define module prerequisites (which modules must be complete
      before another unlocks)
- [ ] Write each module's per-step outline (same shape as
      lesson-template's outline)

---

## Curriculum structure

**MODULE_IDS = [A, B, C, ...]**  (TODO: replace with your actual ids)

**Prerequisites:**
- A: none (always available — the user starts here)
- B: A must be complete (TODO — adjust per your curriculum)
- C: A + B
- D: A + B + C
- ...

(Linear pre-reqs are simplest. If you want users to pick freely,
set all prerequisites to none. If you want a specific path, lock
later modules behind earlier ones.)

The user moves between two canvases:
- **`canvases/orientation.html`** — the launcher. Lists all modules
  with status (locked / available / completed). Clicking "Start
  module X" emits `lesson:module-X-launch`.
- **`canvases/module-<id>.html`** — one per module. The user works
  through it; clicking the final "Done with module" CTA emits
  `lesson:module-<id>-done`.

This skill is the orchestrator: subscribe to events, update sidecar,
repaint orientation, switch tabs.

---

## Orchestrator flow

### Subscribe

```bash
CURSOR=$(jq -r '.lastEventCursor // ""' ~/.claude/duo/lesson-state/TODO-pack-name.json 2>/dev/null)
SINCE_FLAG=${CURSOR:+--since "$CURSOR"}
duo events --follow $SINCE_FLAG
```

Filter to events whose `name` matches `lesson:module-*-launch`,
`lesson:module-*-done`, `lesson:module-*-abandon`, or
`lesson:step-*-done` (for in-module step transitions).

### On `lesson:module-<id>-launch`

1. Read sidecar state (`~/.claude/duo/lesson-state/TODO-pack-name.json`).
2. Verify the module's prerequisites are met:
   - Module A: always allowed.
   - Module B: requires A.completed === true.
   - (etc., per the prereq table above.)
3. If prereqs unmet: paint a brief "Complete X first" message into
   `[data-duo-pane="module-<id>"]` on orientation; do NOT switch
   tabs.
4. If prereqs met:
   - `editor:open ~/.claude/duo/packs/TODO-pack-name/canvases/module-<id>.html`
     to switch the working tab to the module's canvas.
   - Update `[data-duo-pane="module-<id>"]` on orientation to show
     "in progress" (will be repainted when the module completes).
   - (Optional) Update sidecar's `currentModule` field.
5. Persist cursor.

### On `lesson:step-<N>-done` (in-module step transition)

Standard linear-lesson handling, scoped to the current module:

1. Identify which module the step belongs to (the orchestrator
   knows because it's tracking which module canvas is active —
   typically the last `lesson:module-<id>-launch` it dispatched).
2. Repaint the module canvas's step regions (same as lesson-runtime's
   step transition pattern):
   ```bash
   duo html update --selector '[data-duo-pane="step-counter"]' --html 'Step <N+1> of <total>'
   duo html update --selector '[data-duo-pane="step-body"]' --html '<...>'
   duo html update --selector '[data-duo-pane="step-controls"]' --html '<...>'
   ```
3. On the LAST step of the module, the CTA's `data-event` should be
   `lesson:module-<id>-done` (not `lesson:step-N-done`). The
   skill's per-step paint sets this up when transitioning to the
   final step.
4. Persist cursor.

### On `lesson:module-<id>-done`

1. Mark the module complete in sidecar:
   ```json
   {
     "modules": {
       "<id>": { "completed": true, "completedAt": "2026-..." }
     }
   }
   ```
2. Switch the working tab back to orientation:
   ```bash
   duo edit ~/.claude/duo/packs/TODO-pack-name/canvases/orientation.html
   ```
3. Repaint orientation:
   - `[data-duo-pane="module-<id>"]` → "Completed ✓" (green status)
   - `[data-duo-pane="curriculum-progress"]` → "<X> of <N> modules complete"
   - For modules whose prerequisites just became satisfied, paint
     them to "Available" status + enable their "Start module"
     button (drop the `disabled` attribute via
     `duo html attr --id module-<id>-launch-cta --remove disabled`).
4. If ALL modules complete, paint a "Curriculum complete" footer
   message + emit `lesson:curriculum-complete` (so any meta-
   listener knows).
5. Persist cursor.

### On `lesson:module-<id>-abandon`

User clicked "Back to overview" without completing the module.

1. Switch the working tab back to orientation.
2. Update sidecar's `currentModule` to null.
3. Don't mark the module complete.

---

## Module outlines

For each module, write the same kind of per-step outline as in
`lesson-template/lesson-skill/SKILL.md`:

### Module A — TODO

**Objective:** TODO

**STEPS_PER_MODULE = TODO**

#### Step 1
**Body:** TODO content
**Listen for:** `lesson:step-1-done`
**On receipt:** paint step 2

(...and so on until the module's final step, which fires
`lesson:module-A-done`.)

### Module B — TODO

(Same shape.)

### …

---

## Anti-patterns — don't do these

- **Don't fire module-launch for a locked module.** Check prereqs
  in the orchestrator BEFORE dispatching `editor:open`. If you
  switch tabs to a locked module the user shouldn't be in, you
  break the curriculum's pacing AND the user has to manually
  navigate back.
- **Don't mark a module complete just because the user finished
  its first step.** The complete signal is the LAST step's CTA
  firing `lesson:module-<id>-done`. Marking earlier breaks the
  resume pattern.
- **Don't paint orientation while the user is mid-module.** The
  orientation tab isn't visible; the paint is wasted, AND the user
  comes back to a "shifted" orientation that doesn't reflect what
  they remember. Paint orientation ONLY on module-done /
  module-abandon, after the tab switch.
- **Don't share lesson-state across packs** (same as linear
  lessons). One JSON file per pack.
- **Don't forget to enable downstream modules' Start buttons** when
  prereqs become satisfied. The disabled attribute on the orientation
  cards is what gates them; if you don't drop it, the user sees
  "Available" status but can't click.

---

## Cross-references

- **Orientation:** `~/.claude/duo/packs/TODO-pack-name/canvases/orientation.html`
- **Module canvases:** `~/.claude/duo/packs/TODO-pack-name/canvases/module-<id>.html`
- **Runtime contract:** `~/.claude/skills/duo/lesson-runtime.md § Curriculum case`
- **Authoring playgrounds:** `~/.claude/skills/duo/make-playground.md`
- **Sidecar state file:** `~/.claude/duo/lesson-state/TODO-pack-name.json`
- **Pack manifest:** `~/.claude/duo/packs/TODO-pack-name/PACK.json`
- **Lesson-template (single-canvas sibling):** `~/.claude/skills/duo/examples/lesson-template/`
