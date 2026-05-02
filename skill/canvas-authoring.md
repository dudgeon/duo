# Authoring canvases for Duo

> **Stage 27 — `skill/canvas-authoring.md`.** Full reference for the
> canvas authoring vocabulary: action verbs, paint regions, form
> bindings, agent-side event stream, routing meta tags, and the
> anti-patterns that turn an authored canvas from "demo" into "actual
> tool the user keeps coming back to."
>
> This skill is the source of truth for canvas authoring. The shorter
> Stage 23 cheat sheet at `skill/examples/canvas-actions.md` is the
> drive-by reference for the action verbs alone; reach for THIS file
> when you're designing a multi-step lesson, dashboard, or any canvas
> the agent and user will collaborate over.

---

## When to canvas, when to browser, when to markdown editor

| Surface | Use when |
|---|---|
| **HTML canvas** | The artifact is *interactive* (buttons that drive Duo) OR *visually structured* (diagrams, multi-pane dashboards, comparison tables). Click handlers on buttons drive `data-duo-action` verbs. Canvas iframes are sandboxed (`allow-scripts` is OFF) so authored content stays inert outside Duo. |
| **Browser tab** | The artifact is a static reference document the user wants to read uninterrupted (long FAQ, what-duo-does page). Browser-tab routing keeps form inputs and links functional natively. Use `<meta name="duo-open-in" content="browser">` to direct Duo to open the file there instead of the canvas. |
| **Markdown editor** | The artifact is text-first prose the user wants to edit collaboratively with the agent. Use markdown when the content is *the point*, not the interaction. |

Canvas is the right answer when the page IS the UI — buttons, forms,
paint regions, anything where the user clicks and Duo reacts.

---

## The contract — what the canvas runtime promises

Every canvas mounted in Duo gets:

1. **A sandboxed iframe.** `sandbox="allow-same-origin allow-popups
   allow-forms"` — explicitly NO `allow-scripts`. Authored `<script>`
   tags don't run; `onclick="…"` is inert; `<button onclick="…">`
   does nothing.
2. **A delegated click listener.** Duo intercepts every click before
   contentEditable's cursor placement runs and looks for a `data-duo-action`
   attribute on the click target (or the nearest ancestor). When
   present, it parses the action and dispatches it through the
   trusted-action handler in App.tsx.
3. **Same-origin DOM access.** The parent renderer can read + mutate
   the iframe's DOM. This is how `duo html update --selector "[data-duo-pane=…]"`
   paints into a canvas region without re-rendering the whole tab.
4. **A path-restricted trust gate.** Action verbs only fire when the
   canvas file's path is under `~/.claude/duo/` (or the project root,
   for dev canvases). User-authored canvases elsewhere stay inert by
   default — clicking a button calls a one-line `onUntrusted` log,
   not the action.

The contract you fill in:

- Use `data-duo-action="<verb>"` (NOT `data-action`) on clickable
  elements, plus per-verb `data-*` siblings carrying the args.
- Use `data-duo-id="<stable-name>"` on elements you want the agent to
  address by name (paint targets, click destinations, anchors).
- Use `data-duo-pane="<region-name>"` on container elements the agent
  will repaint via `duo html update --selector "[data-duo-pane=…]"`.
- Use `<meta name="duo-default-editable" content="false">` to mount
  read-only by default (recommended for interactive canvases — see
  Mode meta tags below).

---

## Action vocabulary cheat sheet

The canvas can drive nine distinct operations. All inherit the trust
gate; all parse from `data-*` attributes on the clicked element.

| Verb | Signature (data-*) | What it does |
|---|---|---|
| `claude:spawn` | `data-cwd?`, `data-cmd?` | New Claude tab in CWD; optional pre-typed prompt |
| `terminal:send` | `data-text`, `data-enter?` | Write to active terminal's PTY; optional auto-Enter |
| `browser:open` | `data-url` | New browser tab (external-domain blocklist applies) |
| `editor:open` | `data-path`, `data-mode?` | Open file in editor / canvas / browser |
| `nav:reveal` | `data-path` | Show in file navigator + select |
| `selection:set` | `data-target`, `data-text? \| data-line? \| data-anchor?` | Scroll-to-and-select inside the active surface |
| `theme:set` | `data-theme` | Flip light / dark / system |
| `terminal:focus` | `data-tab-id?` | Focus the active or named terminal tab |
| `duo:event` | `data-event`, `data-payload?`, `data-payload-from?` | Emit a named event into the bus |

For per-verb examples see `skill/examples/canvas-actions.md`. The
cheat-sheet there is the worked drive-by; the patterns below show how
to compose verbs into multi-step interactions.

---

## Stable IDs (`data-duo-id`)

When the agent needs to address a specific element by name — to read
its content, replace its HTML, scroll a button into view — give that
element a `data-duo-id`. Stable IDs survive HTML reformatting, comment
sidecar resolution, and `duo html *` mutations.

```html
<button data-duo-id="lesson-step-1-cta"
        data-duo-action="duo:event"
        data-event="lesson-step-1-done">Got it</button>
```

The agent can later reference this element via:

```bash
duo html get --id lesson-step-1-cta
duo html replace --id lesson-step-1-cta --html "<button …>Done ✓</button>"
duo doc goto --anchor lesson-step-1-cta
```

**Naming convention.** Use kebab-case with a meaningful prefix:
`<canvas-name>-<region>-<role>`. Examples: `intro-step-1-cta`,
`dashboard-balance-pane`, `quiz-q3-answer-c`. Random IDs (e.g. `id-37`)
are OK for quick scaffolds but defeat the agent's "name what you mean"
addressing.

`duo html stamp-ids` (Stage 27.5 follow-up) will auto-generate IDs for
unmarked elements when an authoring agent is starting from a draft.
The legacy auto-injection prompt is gated off via
`FEATURE_AUTO_INJECT_IDS = false` — any IDs you want must be authored.

---

## Paint regions (`data-duo-pane`)

When the agent will *repaint* a region of the canvas with new content
on user interaction — quiz feedback, lesson body for the next step,
dashboard refresh — mark that region with `data-duo-pane="<name>"`.

```html
<main>
  <h1>Lesson 1 — Setup</h1>
  <section data-duo-pane="body">
    <p>Welcome. Click <strong>Next</strong> below to continue.</p>
  </section>
  <button data-duo-action="duo:event" data-event="lesson-step-1-next">
    Next
  </button>
</main>
```

The agent (subscribed via `duo events --follow`) sees the click and
paints in the next step:

```bash
duo html update --selector '[data-duo-pane="body"]' \
                --html '<p>Step 2 — install the CLI…</p>'
```

`duo-pane` and `duo-id` overlap functionally, but `pane` flags
"expect repaints here" while `id` flags "stable handle for one
element." Use both when a button's behaviour might change between
states.

---

## Form inputs (`data-payload-from`)

When a button should ship the value of an associated input as part of
its emitted event payload, pair `data-duo-action="duo:event"` with
`data-payload-from="<css-selector>"`. The runtime reads the matched
element's `.value` (or `.checked` for `type="checkbox"|"radio"`) and
adds it as `payload.value`.

```html
<input id="user-name" type="text" placeholder="Your name" />
<button data-duo-action="duo:event"
        data-event="user-introduced"
        data-payload-from="#user-name">
  Submit
</button>
```

The agent receives:

```json
{"cursor":"…","ts":"…","source":"canvas","name":"user-introduced","payload":{"value":"Geoff"}}
```

Supported elements: `<input>`, `<textarea>`, `<select>` (multi-selects
return `string[]`). Static `data-payload` keys win on collision —
authoring `data-payload='{"value": "x"}'` keeps `"x"` even if the
input has a different value.

---

## Agent-side: `duo events --follow`

Subscribers stream events from main's bus. Each event is a single
JSON line on stdout:

```bash
duo events --follow
```

```jsonc
{"cursor":"1714589125-1","ts":"…","source":"canvas","name":"lesson-step-1-next","payload":{}}
{"cursor":"1714589140-3","ts":"…","source":"canvas","name":"user-introduced","payload":{"value":"Geoff"}}
```

### Resume from cursor

If the subscriber dies and restarts, pass `--since <cursor>` to
replay events that landed during the gap:

```bash
duo events --follow --since 1714589125-1
```

Cursor format: `<unix-ms>-<seq-within-ms>`. The bus keeps a 200-event
ring buffer; older events are evicted. Subscribe early in a session
to avoid missing the first event.

### Common patterns for the agent

**Lesson runner:**

```bash
duo events --follow | while IFS= read -r line; do
  case $(jq -r '.event.name // empty' <<< "$line") in
    "lesson-step-1-next")
      duo html update --selector '[data-duo-pane="body"]' --html '<p>Step 2…</p>'
      ;;
    "lesson-step-2-done")
      duo html update --selector '[data-duo-pane="body"]' --html '<p>You finished!</p>'
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

---

## Routing & mode meta tags

Two meta tags control how Duo opens an HTML file. Both go in `<head>`.

### `<meta name="duo-open-in" content="browser|canvas">`

Routes the file to the chosen surface on open. `browser` opens via
`file://` URL in a browser tab — useful for read-only reference docs
that benefit from native form-input behaviour. `canvas` (or omitted)
opens in Duo's editable canvas tab.

Use `browser` for: long-form reading, content with embedded media,
pages that include forms whose default submit behavior should fire.

Use `canvas` for: anything with `data-duo-action` buttons. The action
runtime only attaches inside the canvas surface.

### `<meta name="duo-default-editable" content="false">`

Soft hint: canvas mounts read-only by default but a toolbar toggle
lets the user flip into edit mode at runtime. Their choice persists
per-path in localStorage. Recommended for any canvas with click
handlers — read-only mode means clicks dispatch the action verb
instead of placing the cursor in a contentEditable field.

There's a related hard-lock variant `<meta name="duo-editable" content="false">`
that hides the toolbar toggle entirely. Use the hard lock for system
reference HTMLs (FAQ, what-duo-does); use `duo-default-editable` for
tutorials and lesson canvases the user might want to annotate.

---

## Anti-patterns

**Don't ship a canvas with scripts that need network.** Canvases are
sandboxed without `allow-scripts`. Even allowed scripts have no
network access. If you need a fetch, run it agent-side and write the
result back via `duo html update`.

**Don't paint into the same pane on every event.** A "save" button
that re-renders the whole `data-duo-pane="status"` block on each
click is fine. A typing-into-an-input flow that fires `duo:event`
on every keystroke and repaints in response will race with itself.
Throttle agent-side, or fire the event on `blur` / explicit submit.

**Don't rely on localStorage for cross-canvas state.** Canvas iframes
share the parent renderer's localStorage, but state visible to one
canvas is not guaranteed to be visible to another (path-keyed override
patterns work; arbitrary blobs won't survive the read-only-default
toolbar's clear-overrides flow). For multi-canvas state, push it
through the agent — the agent owns the "between canvases" memory.

**Don't fire `claude:spawn` without a clear `data-cwd`.** Without
`data-cwd`, the new tab inherits the renderer's pending-CWD which is
typically the navigator's current folder — which may not be where the
user expects to start. Always specify the CWD when spawning from a
canvas; the user's `~` is rarely the right answer.

**Don't auth-prompt-block at startup.** A canvas that needs the user
to fill in a form before any action is available makes the canvas
useless until completed. Provide a non-form path (a button labelled
"Start without setup") so first-time visitors can explore.

**Don't bake brand colours into every template.** Use Atelier palette
tokens (`--paper`, `--ink`, `--accent`) in inline styles. The user's
theme toggle (`theme:set`) flips the variables; hard-coded `#ffffff`
won't follow.

---

## Worked example: a click-through tutorial canvas

The `lesson-scaffold.html` template at `skill/examples/canvas-templates/`
demonstrates a complete two-step tutorial:

```html
<!DOCTYPE html>
<html>
<head>
  <meta name="duo-default-editable" content="false">
  <style>/* Atelier palette tokens, padded layout, etc. */</style>
</head>
<body>
  <header>
    <h1>Lesson — Saving a markdown file</h1>
    <p data-duo-pane="step-counter">Step 1 of 2</p>
  </header>
  <main data-duo-pane="body">
    <p>Click below to open today's notes in the editor.</p>
    <button data-duo-action="editor:open" data-path="~/notes/today.md">
      Open notes
    </button>
    <button data-duo-action="duo:event"
            data-event="lesson-step-1-done"
            style="margin-left: 1rem;">
      I did it — next step
    </button>
  </main>
</body>
</html>
```

The agent (subscribed via `duo events --follow`) reacts to
`lesson-step-1-done`:

```bash
duo html update --selector '[data-duo-pane="step-counter"]' \
                --html 'Step 2 of 2'
duo html update --selector '[data-duo-pane="body"]' \
                --html '<p>Now type some content and press ⌘S to save.</p>
                        <button data-duo-action="duo:event"
                                data-event="lesson-step-2-done">Done ✓</button>'
```

The user sees the lesson advance without any page reload. The agent
emits a final summary event (`lesson-step-2-done`) and unsubscribes.

---

## Cross-references

- `skill/examples/canvas-actions.md` — drive-by cheat sheet (Stage 23 + 27 verbs)
- `skill/examples/canvas-templates/` — five copy-paste templates (Stage 27 Commit 6)
- `docs/prd/stage-27-canvas-authoring.md` — Sprint A PRD
- `docs/prd/stage-28-lesson-packs.md` — Sprint C consumer (intro-to-duo + claude-code-basics)
- `agents/duo.md` — `duo events --follow` cheat-sheet entry
- Stage 23 trust gate spec — `renderer/components/HtmlCanvas/canvasActions.ts § isCanvasPathTrusted`
