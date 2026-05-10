# Curriculum template

The canonical Duo curriculum skeleton. Use when a single-canvas
linear lesson is too tight — you need an ORIENTATION launcher +
multiple module canvases the user navigates between.

For single-canvas linear lessons (one playground, N steps), use
`lesson-template/` instead. Curricula are the bigger sibling.

## What's here

```
curriculum-template/
├── canvases/
│   ├── orientation.html        ← the launcher (user sees this first)
│   └── module-template.html    ← copy this per-module (rename to module-A.html, module-B.html, ...)
├── lesson-skill/
│   └── SKILL.md                ← the orchestrator skill skeleton (the author copies + customizes)
└── README.md                   ← this file
```

You'll also want a `PACK.json` at the pack root — describing
your pack's `name`, `version`, `title`, and the `defaults[]`
that decide which canvas auto-opens on first launch. See
`~/.claude/duo/packs/intro-to-duo/PACK.json` for the simplest
shape (single canvas + auto-open). For a multi-canvas reference,
see the in-repo `examples/lesson-pack-template/PACK.json` — that
example predates this template, so its event names + paint
regions aren't fully canonical, but the manifest shape is.

## How to use it

1. `cp -r ~/.claude/skills/duo/examples/curriculum-template/ ~/.claude/duo/packs/<pack-name>/`
2. Decide your module ids (default template uses A, B; adjust):
   - For `~/.claude/duo/packs/<pack-name>/canvases/module-<id>.html`,
     copy `module-template.html` once per module and rename.
3. In `canvases/orientation.html`:
   - Replace `TODO: curriculum title` and the lead copy.
   - Add one `.module-card` per module (template starts with A + B
     as examples).
   - Verify `data-event` names use the canonical `lesson:module-<id>-launch`
     pattern.
4. In each `canvases/module-<id>.html`:
   - Replace the title and step 1 content.
   - On the last step's CTA, change `data-event` from
     `lesson:step-N-done` to `lesson:module-<id>-done` (this is
     what marks the module complete).
5. In `lesson-skill/SKILL.md`:
   - Replace `TODO-curriculum-name` everywhere.
   - Set `MODULE_IDS` to your actual ids.
   - Define prerequisites per module.
   - Write each module's per-step outline.
6. Add a `PACK.json`:
   ```json
   {
     "schemaVersion": 1,
     "name": "<pack-name>",
     "version": "0.1.0",
     "title": "<Curriculum display title>",
     "description": "<one sentence — what user walks away with>",
     "defaults": [
       {
         "kind": "page",
         "path": "canvases/orientation.html",
         "openOnFirstLaunch": true
       }
     ]
   }
   ```
7. Restart Duo; verify with `duo packs`.

## Required reading before customizing

- `~/.claude/skills/duo/lesson-runtime.md § Curriculum case` — the
  canonical event-loop, sidecar state schema with per-module
  completion, prerequisite-check pattern.
- `~/.claude/skills/duo/make-playground.md` — action verb
  vocabulary, paint regions, anti-patterns. Reach for this when
  changing the playground itself (more buttons, forms, etc.).

## When to reach for curriculum-template vs. lesson-template

| Shape | Pick | Why |
|---|---|---|
| Single playground, N linear steps, ~5-15 min | `lesson-template/` | Simplest. One file to change content; one skill to drive. Minimal cognitive overhead for the author. |
| Single playground, BRANCHING steps (skip ahead, choose path) | `lesson-template/` + custom logic | The template's three paint regions still apply; the skill handles branching state. Fork the linear template if needed. |
| Multiple playgrounds, user picks order, can revisit | **`curriculum-template/`** | Module-launch + module-done events; per-module completion in sidecar; orchestrator switches tabs between orientation + modules. |
| Multiple playgrounds, ALWAYS LINEAR (must complete A→B→C) | Either, but `curriculum-template/` is more honest | If the modules are large enough to deserve their own canvases, `curriculum-template/` is right; if they're small enough to fit in one canvas's N-step shape, use `lesson-template/`. |

## What the conventions buy you

By following the canonical orientation paint regions
(`curriculum-progress`, `module-<id>`) and event names
(`lesson:module-<id>-launch`, `lesson:module-<id>-done`,
`lesson:module-<id>-abandon`), you get for free:

- **Mid-curriculum resume** across Duo restarts (sidecar tracks
  `currentModule` + per-module completion).
- **Cross-pack consistency** — users moving between curricula see
  the same shape (orientation card grid, in-module step counter +
  body + controls).
- **Lesson fly-through harness compatibility** (the v0.6.2 harness
  walks linear lessons today; multi-canvas curriculum support is
  a v1.5 extension to `lesson-flythrough.md`).
