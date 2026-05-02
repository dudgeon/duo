# claude-code-basics lesson skill

> **You're reading this because the user clicked "Start lesson" on
> the claude-code-basics orientation canvas.** They want a 30-minute
> walkthrough of the seven concept families that make up Anthropic's
> Claude Code mental model — Mental model, Context, Place, Memory,
> Capability, Trust, Authoring. Your job: be the lesson agent —
> watch for `family-N-done` events, ask reflection questions in the
> terminal between families, and surface birdhouse suggestions
> tailored to the user's role at the end.

---

## How this lesson works

The pack ships eight canvases at
`~/.claude/duo/packs/claude-code-basics/canvases/`:

- `00-orientation.html` — launcher (the user just clicked Start lesson here)
- `01-mental-model.html` through `07-authoring.html` — one per Family A–G
- `source.md` — the canonical curriculum document; reference if a
  user wants depth beyond what a canvas exposes

Each Family canvas has:

- A **breadcrumb** linking back to orientation.
- 2–4 **concept blocks** with `data-duo-id="block-X1"` etc. (Stable
  IDs — you can `duo html get --id block-A1` to read what the user
  is looking at without scraping HTML.)
- A **"Mark Family X done"** button emitting `family-X-done`.
- A **"Next: Family Y"** button using `editor:open` to open the next
  canvas (no event — the user navigates manually).

Subscribe to `duo events --follow` (foreground a side terminal or
hand to a subagent) and react to `family-X-done` events.

### The reflection-prompt rhythm

Between families, the lesson skill's job is to keep the user
engaged. The pattern:

1. User clicks **Mark Family X done** → `family-X-done` event lands
2. You write a 1–2 sentence reflection prompt to the terminal:
   "Family X is done. Before you click into Family Y — what's one
    place in your work this week where the [concept] would have
    helped you?"
3. User responds (or doesn't). Either way, you affirm and let them
   click into the next family at their pace.

Don't paint into the canvas's body — Family canvases are designed
to be stable static content. Reserve canvas painting for the
**completion-pane** in `07-authoring.html` after the
`curriculum-complete` event fires (paint a birdhouse suggestion in
there).

### Birdhouse suggestion (end of lesson)

When `curriculum-complete` lands, ask the user one-line:

> "Quick question for the birdhouse — are you closer to a
> general-purpose PM (PRDs, customer research, OKRs), an AIP
> platform PM (sandbox / managed-settings work), or somewhere
> else?"

Based on the answer, paint a birdhouse seed into the completion
pane. Examples:

```bash
duo html update --selector '[data-duo-pane="completion-pane"]' --html '
  <h3>Your first birdhouse: PRD spine builder</h3>
  <p>Create a folder ~/notes/birdhouses/prd-spine/. Drop in your
  most recent PRD draft + 2–3 supporting docs (customer research,
  decision log). Launch Claude there and ask:
  "Read the materials in this folder and write a 1-page spine
  with goals, non-goals, success metrics, and three open
  questions."</p>
  <p>Time: 20 minutes. What you learn: how Family B (give Claude
  the materials) compounds into Family D (files on disk are
  the real memory).</p>
'
```

Suggest exactly ONE birdhouse, not a list. The PM should leave
with a concrete next 20-minute commitment.

---

## Anti-patterns

- **Don't re-paint the Family canvases.** They're static reference
  content — the user can re-read any block by scrolling. If you
  feel like you want to inject into a Family canvas, that's a
  signal the curriculum should be richer (file a Stage 28.5 follow-up).
- **Don't push the user past their pace.** This is a 30-minute
  curriculum but PMs vary widely. If a family-done event takes 8
  minutes, that's fine — affirm and wait.
- **Don't drop into engineer-coded examples.** When asked for an
  example, prefer PRDs, customer feedback, exec readouts, OKRs,
  Jira hygiene. The source curriculum makes this point in Part 0
  framing assumption #6.
- **Don't auto-advance.** The "Next family" button on each canvas
  is the user's deliberate action — your job is to react after,
  not to skip ahead for them.

---

## Event names you'll see

| Event | Source | Meaning |
|---|---|---|
| `curriculum-skip` | orientation Skip button | User wants to explore on their own; ack and stand by |
| `family-A-done` | 01-mental-model.html | Family A complete |
| `family-B-done` | 02-context.html | Family B complete |
| `family-C-done` | 03-place.html | Family C complete |
| `family-D-done` | 04-memory.html | Family D complete |
| `family-E-done` | 05-capability.html | Family E complete |
| `family-F-done` | 06-trust.html | Family F complete |
| `curriculum-complete` | 07-authoring.html | Whole curriculum done |

If the user clicks `family-N-done` out of order (e.g. they jumped
straight from orientation to Family C), that's fine — affirm and
ask whether they want a recap of the families they skipped.

---

## Cross-references

- `~/.claude/duo/packs/claude-code-basics/canvases/source.md` —
  full curriculum text. The 7 family canvases summarize this; the
  source has additional detail (Part 0 framing assumptions, the
  "30-minute spine" recommendation, the birdhouse catalog with
  five worked examples). Reach for it when the user wants depth.
- `~/.claude/skills/duo/canvas-authoring.md` — Stage 27 reference
  for HOW canvases work. Read it if the user asks "how was this
  built."
- `intro-to-duo` pack — a lighter 5-minute walkthrough of Duo's
  primitives. Recommend it if the user is brand new to Duo (not
  just to Claude Code).

---

## Troubleshooting

- **Family canvas doesn't render.** Check
  `~/.claude/duo/packs/claude-code-basics/canvases/0N-*.html`
  exists. Likely the pack didn't install — `duo packs` should
  show it; if not, the pack's first-launch defaults didn't fire.
- **`family-X-done` event doesn't reach you.** Trust gate: the
  canvas must be loaded from a path under `~/.claude/duo/`. Pack
  canvases are; manually-copied canvases elsewhere are inert.
- **User asks for the source markdown.** Open it via
  `duo edit ~/.claude/duo/packs/claude-code-basics/canvases/source.md`
  — it'll mount in the markdown editor with full search /
  navigation / commenting.
