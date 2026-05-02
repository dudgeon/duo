---
name: TODO-lesson-name
description: TODO — one sentence describing what this lesson teaches. The user reads this in Duo's skill picker; keep it concrete ("Walks the user through Duo's three panes" — yes; "Onboarding lesson" — no).
---

# TODO-lesson-name

> **You're reading this because the user clicked "Start lesson" on
> the TODO-lesson-name playground.** Duo spawned a fresh Claude tab
> in `~/` and the playground told you (via `data-cmd`) to walk the
> user through this skill. Your job: be the lesson — paint content
> into the playground, react to the user's clicks, answer questions
> along the way.
>
> Read `~/.claude/skills/duo/lesson-runtime.md` first if you haven't
> — that's the canonical event-loop pattern this skill assumes.

---

## TODO sections — fill these in before shipping

- [ ] Replace `TODO-lesson-name` everywhere (frontmatter, title,
      directory paths)
- [ ] Replace the `description` frontmatter field
- [ ] Set `STEPS_TOTAL` below to your actual step count
- [ ] Write each step's content (heading, body HTML, advance button)
- [ ] Decide if your lesson has branches (skip-step, choose-your-own
      path, gated-on-input). v1 template assumes linear N steps.

---

## How this lesson works

The user is looking at a playground at:
`~/.claude/duo/packs/TODO-pack-name/canvases/playground.html`

The playground has THREE stable paint regions you address by selector:

- `[data-duo-pane="step-counter"]` — small text above the body ("Step 1 of N")
- `[data-duo-pane="step-body"]` — the main content area for each step
- `[data-duo-pane="step-controls"]` — the button row at the bottom (CTA + secondary)

You repaint these regions with `duo html update --selector "<sel>" --html "<…>"`.

Every step's controls include ONE button with
`data-duo-action="duo:event"` and `data-event="lesson:step-N-done"`
where N is the step number. When the user clicks, the event lands
in your `duo events --follow` subscription. You read the event,
paint the next step, and wait.

### Subscription pattern

In ONE backgrounded shell:

```bash
duo events --follow --since "$(cat ~/.claude/duo/lesson-state/TODO-pack-name.json | jq -r .lastEventCursor // empty)"
```

Each click = one JSON line. Match `event.name` (e.g. `lesson:step-1-done`)
to advance. The `--since` flag resumes from where you left off —
critical when the user closes Duo mid-lesson and reopens it later;
your skill picks up at the same step.

For the full runtime contract (cursor file location, sidecar state
shape, error handling, anti-patterns), read
`~/.claude/skills/duo/lesson-runtime.md`.

---

## Lesson outline

**STEPS_TOTAL = TODO**

Replace each step section below with your content. Keep each step
~3-6 short paragraphs plus one action. If you need more, split into
two steps.

### Step 1 — TODO: heading

**Objective:** TODO — one sentence on what the user accomplishes.

**Body content (paint into `[data-duo-pane="step-body"]`):**

```html
<h2>TODO: step 1 heading</h2>
<p>TODO: step 1 instructions. Keep it short. End with a clear
   next action (open a file, click a thing, run a command).</p>
<p>When you're done, click <strong>Next step</strong> below.</p>
```

**Listen for:** `lesson:step-1-done`

**On receipt:**
1. Update step-counter: `Step 2 of TODO`
2. Update step-body with Step 2 content
3. (Optional) Update step-controls if the next step needs different
   buttons (e.g. enable a "Submit" button instead of "Next step")
4. Persist progress: write `currentStep: 2` + `lastEventCursor: <event.cursor>`
   to `~/.claude/duo/lesson-state/TODO-pack-name.json`

### Step 2 — TODO

(Same shape as Step 1.)

### Step 3 — TODO

(Same shape as Step 1.)

### …

### Step N (last) — TODO

**On receipt of `lesson:step-N-done`:**
1. Paint a "lesson complete" body — `<h2>You're done!</h2><p>...</p>`
2. Replace the controls with a single "Close lesson" button (or
   leave it open if they want to re-read).
3. Persist: write `completed: true` + final cursor.
4. Emit your own celebration event: `duo:event lesson:done` so
   any consumer (e.g. a meta-onboarding tracker) knows.

---

## Anti-patterns — don't do these

- **Don't write a giant HTML blob in one paint.** Keep each step
  ~3-6 short paragraphs plus one button. Long walls of text break
  the click-through rhythm. If you have more, that's two steps.
- **Don't escape the convention.** If the lesson seems to want
  something the playground primitives don't support (custom widget,
  non-canvas modal, server fetch), that's a primitive gap — flag
  it as a Stage 27.x follow-up rather than papering over with
  bespoke JS. Playgrounds are sandboxed without `allow-scripts`;
  inline JS will fail silently.
- **Don't paint the same pane twice for one step.** Each click =
  one repaint per pane. Race-y double-paints flash the user.
- **Don't forget the step-counter.** Two `duo html update` calls
  per step (counter + body), three if controls change. The user
  values the progress signal.
- **Don't lecture; show.** Ask the user to DO something on each
  step (open a file, click a button, type a thing). Then the next
  step builds on what they just did. Lessons that are just
  "click Next to read more" feel like sales decks.
- **Don't skip persisting cursor.** If the user quits mid-lesson
  and your skill doesn't write `lastEventCursor` to the sidecar,
  resumption replays every event since the lesson started — you
  paint step 1, then 2, then 3 in rapid succession. Persist after
  every advance.

---

## Cross-references

- **Playground:** `~/.claude/duo/packs/TODO-pack-name/canvases/playground.html`
- **Runtime helper skill:** `~/.claude/skills/duo/lesson-runtime.md`
- **Authoring skill (read for canvas-action verbs):** `~/.claude/skills/duo/playground-authoring.md`
- **Sidecar state file:** `~/.claude/duo/lesson-state/TODO-pack-name.json`
- **Pack manifest:** `~/.claude/duo/packs/TODO-pack-name/PACK.json`
