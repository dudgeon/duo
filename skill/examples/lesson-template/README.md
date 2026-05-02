# Lesson template

The canonical Duo lesson skeleton. Copy this directory into
`~/.claude/duo/packs/<your-pack-name>/` and customize.

## What's here

```
lesson-template/
├── canvases/
│   └── playground.html        ← the lesson's interactive surface
├── lesson-skill/
│   └── SKILL.md               ← Claude reads this to drive the lesson
└── README.md                  ← this file
```

You'll also want a `PACK.json` at the pack root — see
`~/.claude/duo/packs/intro-to-duo/PACK.json` for a worked example.

## How to use it

1. `cp -r ~/.claude/skills/duo/examples/lesson-template/ ~/.claude/duo/packs/<pack-name>/`
2. In `canvases/playground.html`:
   - Replace the title.
   - Replace the initial step-body content (this is what the user
     sees when the lesson opens).
   - Adjust the `data-event` on the Next button if your lesson uses
     a different naming scheme. (Default: `lesson:step-1-done` —
     keep this unless you have a reason.)
3. In `lesson-skill/SKILL.md`:
   - Replace `TODO-lesson-name` everywhere.
   - Set `STEPS_TOTAL` to your actual step count.
   - Write each step's content in the outline section.
4. Add a `PACK.json` at the pack root with:
   ```json
   {
     "schemaVersion": 1,
     "name": "<pack-name>",
     "version": "0.1.0",
     "title": "<Lesson display title>",
     "description": "<one sentence>",
     "defaults": [
       {
         "kind": "page",
         "path": "canvases/playground.html",
         "openOnFirstLaunch": true
       }
     ]
   }
   ```
5. Restart Duo (or run `duo packs` to verify the pack loaded).

## Required reading before customizing

- `~/.claude/skills/duo/lesson-runtime.md` — the canonical event-
  loop pattern. The lesson skill's logic depends on this.
- `~/.claude/skills/duo/playground-authoring.md` — the action verb
  vocabulary, paint regions, anti-patterns. Reach for this when you
  want to change the playground itself (more buttons, forms, etc.).

## What the conventions buy you

By following the template's three paint regions
(`step-counter` / `step-body` / `step-controls`) and canonical
event names (`lesson:step-N-done` / `lesson:done` /
`lesson:restart`), you get for free:

- **Mid-lesson resume**. If the user closes Duo at step 3, the
  next launch picks up at step 3 (sidecar state at
  `~/.claude/duo/lesson-state/<pack-name>.json`).
- **Lesson preview** (when ENH-055 ships). The fly-through harness
  knows what events to expect and can validate your lesson runs
  end-to-end before you ship.
- **Cross-pack consistency**. Users moving between lessons see the
  same shape (counter / body / controls) — less cognitive load.
