---
name: lesson-flythrough
description: Fly through a Duo lesson end-to-end without manual clicking — read the playground HTML, enumerate `data-duo-action` buttons in canonical order, click each via `duo html click`, observe `duo events --follow`, assert each expected event fires + each expected paint region updates, report pass/fail per step. Use when the user says "fly through this lesson", "test my new lesson", "preview the lesson", "validate the lesson runs", "run the lesson without me", "smoke-test this playground", "step through the lesson automatically", "make sure the lesson works end-to-end", or similar. The harness assumes a CANONICAL lesson structure (paint regions `step-counter` / `step-body` / `step-controls`; events `lesson:step-N-done` / `lesson:done` / `lesson:restart`) — for non-canonical lessons (e.g. multi-canvas curricula like the lesson-pack-template example), adapt the loop or fall back to manual clicking.
---

# Lesson fly-through harness

> **Stage 27 — `skill/lesson-flythrough.md`.** Walk through a
> canonical lesson end-to-end without a human clicking. Reads the
> playground, enumerates buttons, simulates clicks, observes
> events, reports pass/fail per step. Closes meta-goal gap 5 from
> the v0.6.0 zoom-out.
>
> **Vocabulary lock** (see CLAUDE.md § Glossary): canvas (slot),
> page (basic HTML), playground (page + interactivity), lesson
> (playground + guide skill).
>
> **When to reach for this skill:** the user wants to TEST a lesson
> they (or you) just authored, before shipping it to real users.
> Or the user wants to smoke-walk an existing lesson to verify it
> still works after a Duo upgrade. The harness IS the test —
> there's no separate test runner.

---

## What the harness assumes

The lesson follows the **canonical pattern** documented in
`~/.claude/skills/duo/lesson-runtime.md`:

- **Paint regions:** `[data-duo-pane="step-counter"]`,
  `[data-duo-pane="step-body"]`, `[data-duo-pane="step-controls"]`
- **Events:** `lesson:step-1-done`, `lesson:step-2-done`, ...,
  `lesson:done` (final step), with optional `lesson:restart`,
  `lesson:back`, `lesson:skip`
- **Step controls:** each step's `step-controls` pane contains
  ONE primary CTA button with `data-duo-action="duo:event"`
  and `data-event="lesson:step-N-done"` for the current step

**For non-canonical lessons** (multi-canvas curricula, lessons that
predate the canonical template, lessons with branching), adapt the
loop or fall back to manual fly-through. The pre-template
`intro-to-duo` pack adopted canonical event names in v0.6.1 but its
structure isn't fully canonical; expect surprises when flying
through it.

---

## The fly-through loop

### Step 1 — open the playground

```bash
# Adjust path to the lesson you're testing.
duo edit ~/.claude/duo/packs/<pack-name>/canvases/playground.html
```

Wait a beat for the canvas to mount. Verify the playground's
expected paint regions are present:

```bash
duo html query --selector '[data-duo-pane="step-counter"]'
duo html query --selector '[data-duo-pane="step-body"]'
duo html query --selector '[data-duo-pane="step-controls"]'
```

Each query should return at least one match. If any are missing,
the lesson isn't canonical — STOP, report the gap to the user, and
either (a) help them fix the playground or (b) suggest a manual
fly-through.

### Step 2 — start the event subscription

In a **separate terminal tab** (so the foreground stays free):

```bash
duo new-tab --shell --cmd "duo events --follow"
```

The `duo events --follow` tab now streams every event the
playground emits. The harness reads from this stream as it advances.

### Step 3 — read the lesson's expected step count

```bash
# The step-counter currently shows "Step 1 of N" — extract N.
duo html get --selector '[data-duo-pane="step-counter"]'
# → { tag: "div", text: "Step 1 of 6", ... }
```

Capture the total step count. The harness expects to fire
`lesson:step-1-done` through `lesson:step-N-done` (or `lesson:done`
on the last step — both are valid canonical patterns).

### Step 4 — fly through the steps

For each step `N` from 1 to the total:

1. **Find the step's CTA button.** It SHOULD be inside the
   `step-controls` region with `data-event="lesson:step-N-done"`:

   ```bash
   duo html query --selector '[data-duo-pane="step-controls"] [data-event="lesson:step-1-done"]'
   ```

2. **Click it via the new ENH-055 primitive:**

   ```bash
   duo html click --selector '[data-duo-pane="step-controls"] [data-event="lesson:step-1-done"]'
   # → { id: "next-cta", tag: "button" }
   ```

3. **Wait for the expected event in the stream.** The
   `duo events --follow` tab in step 2 should immediately show
   the event:

   ```jsonc
   {"cursor":"...","name":"lesson:step-1-done","payload":{}}
   ```

4. **Wait for the expected paint.** The lesson skill (in another
   Claude tab, if the user has one running, OR not — if the user
   is just running the harness, no lesson skill is driving) is
   responsible for painting the next step. If you ARE the lesson
   skill in addition to the harness:

   ```bash
   duo html update --selector '[data-duo-pane="step-counter"]' \
                   --html "Step 2 of <total>"
   duo html update --selector '[data-duo-pane="step-body"]' --html '<...>'
   ```

5. **Verify the new step content rendered.** Read it back:

   ```bash
   duo html get --selector '[data-duo-pane="step-counter"]'
   # → { text: "Step 2 of 6", ... }
   ```

   If the step counter didn't advance, the lesson skill's paint
   logic is broken at this step — record the FAIL and continue.

6. **Increment N. Repeat.** Final step fires `lesson:step-N-done`
   AND/OR `lesson:done`; either matches a passing run.

### Step 5 — report

Generate a pass/fail report:

```
Lesson fly-through: <pack-name>
====================================
✓ Step 1 → 2  (lesson:step-1-done fired; counter advanced)
✓ Step 2 → 3  (lesson:step-2-done fired; counter advanced)
✗ Step 3 → 4  (lesson:step-3-done fired; counter STAYED at "Step 3 of 6"
              — paint logic gap in lesson skill)
✓ Step 4 → 5  (lesson:step-4-done fired; counter advanced)
✓ Step 5 → 6  (lesson:step-5-done fired; counter advanced)
✓ Step 6 → done  (lesson:done fired; lesson complete)

5 / 6 steps passed. 1 failure on step 3 paint.
```

Save the report to `~/.claude/duo/lesson-state/<pack-name>-flythrough.txt`
for reference (separate file from the lesson's own state JSON).

---

## Edge cases

**No primary CTA in step-controls.** The lesson author put the
advance button outside `step-controls`, OR the step uses
`data-payload-from` (form input gates the advance). For form-gated
steps, the harness must set the input value first via
`duo html attr --selector '#input-id' --set value=<...>` (note: this
uses `attr` to set the `value` attribute, NOT to fill a runtime
input; for runtime input setting you may need a manual fallback).

**Multiple buttons match.** A step has both Next and Skip buttons.
Click the one whose event matches `lesson:step-N-done` (the
canonical advance event). Other events
(`lesson:skip`, `lesson:back`) are out of band for the harness.

**Event arrives but paint never does.** The event-emit half worked;
the paint-half (lesson skill's response) didn't. Record FAIL with
the specific symptom ("event fired but step-counter didn't advance").
This is the most common bug class for new lesson authors.

**Browser pane is blocking the playground.** The lesson playground
should be the active working pane tab when the harness runs. If a
browser tab is active instead, `duo edit` switches to the file tab.
Verify with `duo nav-state` if uncertain.

**The lesson predates the canonical template.** `intro-to-duo`
uses `lesson:` event names but has non-canonical paint regions or
structures. Expect partial passes; treat the harness output as
"diff between this lesson and the canonical shape" rather than
pass/fail.

---

## Anti-patterns

- **Don't substitute manual clicking for the harness.** If you find
  yourself clicking via screenshot + computer-use because
  `duo html click` "isn't working," debug `duo html click` instead.
  The whole point of the harness is removing the manual loop.
- **Don't fly through with a lesson skill running concurrently.**
  The lesson skill repaints + the harness clicks; race conditions
  ensue. Run the harness against a STANDALONE playground (no skill
  driving in another tab) for clean assertions, OR pause the
  lesson skill for the duration of the fly-through.
- **Don't run multiple fly-throughs concurrently.** One lesson at
  a time per Duo instance; the event bus has 200 events of capacity
  but cross-talk between concurrent harnesses is hard to reason
  about.

---

## Cross-references

- **Primitive:** `duo html click --id <duo-id>` / `--selector <css>` (ENH-055)
- **Lesson runtime contract:** `~/.claude/skills/duo/lesson-runtime.md`
- **Lesson template:** `~/.claude/skills/duo/examples/lesson-template/`
- **Authoring playgrounds:** `~/.claude/skills/duo/make-playground.md`
- **Driving an existing playground:** `~/.claude/skills/duo/playground-interaction.md`
