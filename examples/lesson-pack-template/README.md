# Lesson pack template — multi-canvas curriculum

A copy-and-customize starting point for building your own
multi-canvas Duo lesson pack. **This pack does not ship to end
users** — it lives here as a reference shape.

## What's in here

- `PACK.json` — manifest. Update `name`, `title`, `description`,
  and `defaults` for your pack.
- `canvases/00-orientation.html` — orientation launcher pattern
  (cards link to family canvases via `data-duo-event` /
  `data-duo-action="lesson:family-X-launch"`).
- `canvases/01-mental-model.html` through `07-authoring.html` —
  family canvas skeletons (paint regions + canonical
  `lesson:family-X-done` events; content placeholders).
- `canvases/source.md` — the original Claude Code 101 curriculum
  source (kept for reference; replace with your own subject
  matter).
- `lesson-skill/SKILL.md` — multi-step orchestrator skill that
  the pack invokes via `claude:spawn`.

## How to use it

1. Copy the directory into your local pack registry:
   ```bash
   cp -r examples/lesson-pack-template ~/.claude/duo/packs/<your-pack-name>/
   ```
2. Edit `PACK.json` — set `name` to match the directory name (the
   pack-loader rejects mismatches). Bump `version` whenever you
   change content (drives the per-pack-version re-fire of
   `openOnFirstLaunch`).
3. Author your canvases. Keep the canonical `lesson:` event names
   (`lesson:step-N-done`, `lesson:family-X-done`, `lesson:done`)
   so the runtime + fly-through harness work without
   customization.
4. Validate via the canonical [`pack-builder` skill](../../skill/pack-builder/SKILL.md)
   — it walks the manifest validation contract end-to-end.

## Related references

- **Single-playground lesson template (linear walk):**
  `~/.claude/skills/duo/examples/lesson-template/`
- **Multi-canvas curriculum template (canonical pattern this
  pack predates):** `~/.claude/skills/duo/examples/curriculum-template/`
- **Plugin-shape distro pack** (Claude Code plugin + Duo
  `duo-extras/` subtree, different artifact type):
  [`examples/distro-pack-template/`](../distro-pack-template/)
