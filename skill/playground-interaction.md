# Interacting with pages and playgrounds in Duo

> **Stage 27 — `skill/playground-interaction.md`.** How to OPEN a
> local HTML file in Duo, READ what's on a page or playground, and
> DRIVE a running playground (paint into it, query its DOM, react
> to user clicks). Companion to `skill/make-playground.md`,
> which covers CREATING pages and playgrounds.
>
> **Vocabulary lock (v0.6.1).** "Canvas" is the right pane (slot,
> type-agnostic). What you author and read here is a **page**
> (basic HTML tab) or a **playground** (page with interactivity —
> action verbs, events, form bindings). A **lesson** is a playground
> + a guide skill. See `make-playground.md` § Vocabulary lock
> for the full breakdown.
>
> **Reach for this file when** the user asks you to: open an HTML
> file they have, read what's on a page they're looking at, repaint
> a region of a playground in response to something, debug why a
> playground button isn't firing, or subscribe to playground-driven
> events. **Reach for `make-playground.md` when** they ask you
> to CREATE a page or playground from scratch or from a template.

---

## Decision tree — author or interact?

| What the user asked | Right skill |
|---|---|
| "Open today's notes" / "show me that HTML I made" | `interaction` (this file) — `editor:open` / `duo edit` |
| "Read what's in the welcome page" | `interaction` — `duo html query` / `duo html get` |
| "Add a Save button to this page" | **`authoring`** — modify markup with action verbs (page becomes a playground) |
| "Build a tutorial playground with three steps" | **`authoring`** — pick a template + author content |
| "Build me a lesson on X" | **`authoring`** — playground + paired lesson-skill |
| "Update the result pane with what I just computed" | `interaction` — `duo html update --selector` |
| "Why isn't the button firing?" | `interaction` — debug trust gate + console |
| "Watch for clicks on the lesson playground" | `interaction` — `duo events --follow` |
| "What action verbs can I add to a button?" | **`authoring`** — vocabulary cheat sheet |

In a single session you might cross between modes (a user opens a
canvas you authored, asks you to drive it, then asks you to extend
it). Both skills assume you can read each other.

---

## Opening a local HTML file

### Smart-routing: `editor:open` (CLI) / `duo edit <path>`

```bash
duo edit ~/notes/today.html
duo open ~/notes/today.html         # alias; same routing
```

Duo's smart-router does a small pre-flight on `.html` files:

- If the file's `<head>` has `<meta name="duo-open-in" content="browser">`,
  Duo opens it as a `file://` URL in a browser tab. Native form
  inputs, links, scripts all run normally.
- Otherwise, the file mounts in an HTML canvas tab. Sandboxed
  iframe; `data-duo-action` buttons fire; `<script>` tags are inert.

The `duo-open-in` hint is the file author's call. Long-form reading
docs (FAQs, references) typically pick `browser`; interactive
content (tutorials, dashboards) picks `canvas` or omits the hint.

### Force a specific surface

When you need to override the file's hint or the smart router's
default:

```html
<!-- inside an authored canvas action button -->
<button data-duo-action="editor:open"
        data-path="~/notes/today.html"
        data-mode="canvas">Force canvas</button>
```

`data-mode="editor"` for the markdown / canvas tab path,
`data-mode="canvas"` (alias), or `data-mode="browser"` to ignore the
duo-open-in hint and open via `file://`. Useful for "open this in
a real browser tab so the user can copy / paste / right-click" cases.

---

## Reading what's on a canvas

### `duo html query --selector <css>`

List elements matching a CSS selector. Returns count + a sample of
matches (id, tag, text, classes). Cheap discovery — use when you
don't yet know what's on the canvas.

```bash
duo html query --selector "[data-duo-action]"
# returns every action-bearing element

duo html query --selector "[data-duo-pane]"
# returns every paint-region (use these as `--selector` targets
# for duo html update)
```

### `duo html get --id <duo-id>` or `--selector <css>`

Read one element's outerHTML + plain text. Good for "what does the
user see in pane X right now."

```bash
duo html get --id lesson-step-1-cta
duo html get --selector "[data-duo-pane=result]"
```

### `duo selection`

What the user has selected in the active surface. The canvas variant
returns `{kind:'html-canvas', path, text, html, anchorId, anchorPath, range, surrounding}`
— `anchorId` is the nearest `data-duo-id` ancestor of the selection,
which makes "extend the section the user has highlighted" trivial.

---

## Driving a running canvas

### `duo html update --selector <css> --html "<…>"` — paint into a region

The single most useful agent-side verb for tutorials, dashboards,
and lesson runners. Replaces innerHTML of every element matching
the selector.

```bash
duo html update --selector '[data-duo-pane="lesson-body"]' \
                --html '<p>Here is what I found …</p>'
```

Pair `data-duo-pane` (stable region selector) with this verb and
you get an idempotent paint surface — agent runs, repaints with new
content, user sees the update without a tab reload.

Other `duo html *` verbs:

- `duo html replace --id <duo-id> --html "<…>"` — replace outerHTML
  (the matched element itself, not just its children)
- `duo html append --parent <duo-id> --html "<…>"` — append a new
  child to a parent
- `duo html remove --id <duo-id>` / `--selector <css>` — delete an
  element
- `duo html attr --id <duo-id> --set k=v ...` / `--remove k ...` —
  modify attributes
- `duo html set --id <duo-id> --content "…"` — replace innerHTML of
  a single element by ID

### Comments on a canvas

`duo html comment --id <duo-id> --body "…"` writes a sidecar
comment anchored to a stable `data-duo-id`. Doesn't modify the
canvas HTML; mutates `<file>.duo.json` next to the canvas.
`duo html comments` lists threads.

Useful when the user asks you to "leave a note here for later" and
you don't want to clutter the canvas itself.

---

## Reacting to user clicks (`duo events --follow`)

When a canvas has `data-duo-action="duo:event"` buttons, clicks
emit structured events into Duo's in-process bus. Subscribe:

```bash
duo events --follow
```

Each line is one JSON event:

```jsonc
{"cursor":"1714589125-1","ts":"…","source":"canvas","name":"lesson-step-1-next","payload":{}}
{"cursor":"1714589140-3","ts":"…","source":"canvas","name":"user-introduced","payload":{"value":"Geoff"}}
```

### Resume from cursor

A subscriber that dies and restarts can pass `--since <cursor>`:

```bash
duo events --follow --since 1714589125-1
```

Cursor format: `<unix-ms>-<seq-within-ms>`. Bus keeps a 200-event
ring; older events are evicted.

### Common patterns

**Lesson runner:**

```bash
duo events --follow | while IFS= read -r line; do
  case $(jq -r '.event.name // empty' <<< "$line") in
    "lesson-step-1-next")
      duo html update --selector '[data-duo-pane="body"]' \
                      --html '<p>Step 2 — install the CLI…</p>'
      ;;
    "lesson-step-2-done")
      duo html update --selector '[data-duo-pane="body"]' \
                      --html '<p>You finished!</p>'
      ;;
  esac
done
```

**Form-collected onboarding:**

```bash
duo events --follow | while IFS= read -r line; do
  if [[ $(jq -r '.event.name' <<< "$line") == "user-introduced" ]]; then
    name=$(jq -r '.event.payload.value' <<< "$line")
    duo html update --selector '[data-duo-pane="greeting"]' \
                    --html "<p>Hello, $name. Let's begin.</p>"
  fi
done
```

For a long-running lesson that needs many subscribers, hand the
watch loop to a Task subagent so the main session's context window
stays clean.

---

## Debugging — when a canvas isn't behaving

### "I clicked a button and nothing happened"

Three reasons in order of likelihood:

1. **Trust gate.** Action verbs only fire when the canvas's path is
   under `~/.claude/duo/`. User-authored canvases elsewhere stay
   inert. Confirm with `duo selection` (the response includes the
   canvas's path) and check whether it's under the trust root.

2. **Read-only mode is OFF.** When a canvas is editable (the
   default), clicking lands in contentEditable and places a cursor
   instead of firing the action. Look at the canvas's toolbar — if
   you see "Edit" and not "Read-only," the user is in editable mode.
   Tell them to flip via the toolbar, or author the canvas with
   `<meta name="duo-default-editable" content="false">`.

3. **Markup typo.** `data-action` ≠ `data-duo-action`. The runtime
   only listens for the duo-prefixed attribute. `duo html query
   --selector "[data-duo-action]"` will list every action button
   the runtime sees; missing your button = it's mis-attributed.

### "The agent isn't seeing my events"

- Confirm the canvas is under the trust root (same trust gate as
  buttons).
- Confirm `duo events --follow` is actually subscribed —
  `duo events --limit 5` should show recent events from the ring;
  if the ring is empty after clicks, the canvas runtime isn't
  reaching the bus (file a bug with the canvas path + the click
  target's outerHTML).
- Confirm the event name matches what your subscriber's case
  statement is looking for. Names are exact-match in the bus.

### "duo html update doesn't paint"

- Verify the selector matches: `duo html query --selector "<sel>"`
  should return ≥ 1 hit. Zero hits = your selector is wrong; you'd
  silently no-op without the query.
- The active canvas matters. If the user has two canvas tabs open,
  `duo html *` operates on the active one. `duo selection` confirms
  which.

---

## What you DON'T need to know

- **The action-verb vocabulary** — that's authoring concern. If the
  user asks you to add a verb to a canvas, switch to
  `canvas-authoring.md`.
- **The data-duo-id naming convention** — same; authoring.
- **How to write a `<meta name="duo-default-editable">` block** —
  same; authoring.

When in doubt: if the task involves writing markup, you're in
authoring. If it involves running CLI verbs against an existing
canvas, you're in interaction.

---

## Cross-references

- `skill/canvas-authoring.md` — CREATE canvases (action vocabulary,
  templates, anti-patterns)
- `skill/SKILL.md` § Command reference — `duo html *`, `duo edit`,
  `duo open`, `duo events`
- `skill/examples/canvas-actions.md` — drive-by cheat sheet for
  every action verb
- `agents/duo.md` — `duo events --follow` cheat-sheet entry
- Stage 23 trust gate — `renderer/components/HtmlCanvas/canvasActions.ts § isCanvasPathTrusted`
