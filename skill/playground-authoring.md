# Authoring pages and playgrounds for Duo

> **Stage 27 — `skill/playground-authoring.md`.** Full reference for
> authoring HTML content that lives in Duo's canvas (the right pane).
> Action verbs, paint regions, form bindings, routing meta tags, and
> the anti-patterns that turn an authored page from "demo" into
> "actual tool the user keeps coming back to."
>
> **Vocabulary lock (v0.6.1).** Read this carefully — the words have
> specific meanings:
> - **canvas** — the right pane of Duo (slot, type-agnostic). Holds
>   whatever tab is active. NOT the thing you author.
> - **page** — a basic HTML tab inside the canvas. Static or lightly
>   styled. No actions, no events. Just rendered content.
> - **playground** — a page WITH interactivity. Has `data-duo-action`
>   buttons, form inputs piped via `data-payload-from`, emits events
>   via `duo:event`. The interactive tier of a page. Same `<iframe>`
>   runtime, same trust gate, same routing — distinction is what's
>   IN the HTML.
> - **lesson** — a playground paired with a guide skill (a `.md`
>   Claude reads to drive the user through). Distributed via Stage
>   18b packs.
> - **start tab** — a playground that auto-opens on first launch
>   (Stage 18b's `PACK.json § defaults[].openOnFirstLaunch`).
>   `intro-to-duo` is one. Future "set up your Duo" /
>   "tour the FAQ" / "import settings" playgrounds belong here.
>
> When the user says "build me a training" / "make a guide" / "give
> me a way to teach my team X," they're asking for a **lesson**:
> playground + skill + (optional) pack. When they say "give me a
> dashboard" or "make me a playground to test X," they're asking
> for a playground without the skill.
>
> **Reach for this file when** the user asks you to: create a
> page, build a playground, design a multi-step lesson, build a
> dashboard with paint regions, choose between page / browser /
> markdown, or pick the right action verb for a button. **Reach
> for `playground-interaction.md` when** they ask you to OPEN,
> READ, or DRIVE an existing page or playground (paint into it,
> query its DOM, react to clicks).
>
> The shorter Stage 23 cheat sheet at
> `skill/examples/canvas-actions.md` is the drive-by lookup for
> action-verb signatures.

---

## When to page / playground, when to browser, when to markdown editor

| Surface | Use when |
|---|---|
| **Playground** (interactive HTML) | The artifact is *interactive* (buttons that drive Duo via `data-duo-action`) OR *visually structured* (diagrams, multi-pane dashboards, comparison tables). Iframes are sandboxed (`allow-scripts` is OFF) so authored content stays inert outside Duo. Verbs run via the renderer's delegated dispatcher; events emit via `duo:event` for an agent to stream. |
| **Page** (static HTML) | The artifact is HTML you want rendered cleanly inside the canvas slot but it doesn't yet need interactivity. Same iframe runtime as a playground; just no `data-duo-action` buttons. Add interactivity later → it becomes a playground without changing tabs. |
| **Browser tab** | The artifact is a static reference document the user wants to read uninterrupted (long FAQ, what-duo-does page). Browser-tab routing keeps form inputs and links functional natively. Use `<meta name="duo-open-in" content="browser">` to direct Duo to open the file there instead of as a page in the canvas. |
| **Markdown editor** | The artifact is text-first prose the user wants to edit collaboratively with the agent. Use markdown when the content is *the point*, not the interaction. |

A playground is the right answer when the page IS the UI — buttons,
forms, paint regions, anything where the user clicks and Duo reacts.

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
| `claude:spawn` | `data-cwd?`, `data-cmd?` | New Claude tab in CWD; `data-cmd` is Claude's **first user message** (not a shell command — see semantic note below) |
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

## Agent-side wiring (consumer of what you author)

When you author a canvas, you're producing markup that an agent (you,
later, in a separate Claude tab) will run against. The runtime
contract:

- **Buttons emit events.** A `data-duo-action="duo:event"` click
  lands as one JSON line in `duo events --follow`.
- **Paint regions are stable.** A `data-duo-pane="<name>"` div is the
  agent's `duo html update --selector` target.
- **Form values ride along.** `data-payload-from="#input"` puts
  `.value` (or `.checked`) in the event's `payload.value`.

The full agent-side playbook — subscription patterns, `--since`
cursor resume, `duo html update` paint syntax, debugging — lives in
`skill/canvas-interaction.md`. That's where you go when you switch
hats from author to driver.

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

**`claude:spawn` `data-cmd` semantics — IT'S A CLAUDE PROMPT, NOT A
SHELL COMMAND.** When `data-cmd` is supplied, the runtime sends
`claude\n${cmd}\n` to the new PTY: the shell launches Claude, then
Claude reads the cmd as its **first user message**. So write
`data-cmd` as natural-language prose ("Read X and walk me through
it"), NOT as a shell invocation (`claude --prompt "..."` would be
wrong — `claude` runs first; the cmd lands in Claude's stdin, not
zsh's). This semantic was clarified in v0.6.1 (ENH-049); pre-v0.6.1
the cmd was sent directly to the shell, which meant prose cmds
errored. Authoring agents writing `claude:spawn` data-cmd should
default to prose; if the canvas needs a SHELL command in the new
tab, use `claude:spawn` without `data-cmd` and follow up with a
`terminal:send data-text="..."` button.

**Don't auth-prompt-block at startup.** A canvas that needs the user
to fill in a form before any action is available makes the canvas
useless until completed. Provide a non-form path (a button labelled
"Start without setup") so first-time visitors can explore.

**Don't bake brand colours into every template.** Use Atelier palette
tokens (`--paper`, `--ink`, `--accent`) in inline styles. The user's
theme toggle (`theme:set`) flips the variables; hard-coded `#ffffff`
won't follow.

---

## Lessons specifically — the canonical pattern

When the user asks for "a training," "a guide," "an onboarding flow,"
or "a way to teach my team X," they want a **lesson**: a playground
+ a paired guide skill that Claude reads to drive the user through.

**Don't invent a new structure each time.** Lessons share a canonical
shape that buys cross-pack consistency, mid-lesson resume, and (when
ENH-055 ships) automated fly-through validation:

1. **Start from the template.**
   ```bash
   cp -r ~/.claude/skills/duo/examples/lesson-template/ \
         ~/.claude/duo/packs/<pack-name>/
   ```
   This gives you a `canvases/playground.html` with the three stable
   paint regions (`step-counter` / `step-body` / `step-controls`) and
   a `lesson-skill/SKILL.md` with the canonical step-state outline.
2. **Read `lesson-runtime.md`** before writing skill logic. It
   defines the canonical event names (`lesson:step-N-done`,
   `lesson:restart`, `lesson:done`), the sidecar state schema at
   `~/.claude/duo/lesson-state/<pack-name>.json`, and the
   cursor-resumption pattern that makes mid-lesson Duo restarts
   recoverable.
3. **Customize content, not structure.** Replace step content,
   step count, step transitions — but keep the three paint regions
   + the event-name convention. The convention IS the contract.

**Lesson vs. plain playground.** A playground without a paired
lesson-skill is fine for many cases (dashboards, agent-emitted
reports, the smoke-walk page). The lesson template adds:
- A guide skill that drives the user step-by-step
- Sidecar state for resume
- Cursor-based event subscription (one canonical loop)

If the playground is a one-shot interaction (click button, see
result, done), skip the lesson template — author the playground
alone using `playground-authoring.md` patterns. Reach for the
lesson template when there's a TEACHING ARC the agent has to drive.

**Cross-references:**
- `~/.claude/skills/duo/examples/lesson-template/` — copy this
- `~/.claude/skills/duo/lesson-runtime.md` — the runtime contract
- `~/.claude/duo/packs/intro-to-duo/` — current example (note: pre-template;
  refactor to canonical pattern queued)

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

## On WebMCP — should authored canvases conform?

**Short answer: not for canvas-tab content. Maybe later for browser-
tab content.**

The W3C WebMCP draft proposes `navigator.modelContext.registerTool({...})`
as a JS API for pages to publish "agent-action contracts" — named,
typed, callable tools an agent can discover at runtime. Spiritually
adjacent to what Duo's `data-duo-action` vocabulary already does:
both publish discoverable contracts on the page.

The practical mismatch:

- **Canvas-tab iframes are sandboxed without `allow-scripts`.**
  `navigator.modelContext.registerTool()` requires JS execution.
  Canvas authoring CANNOT use WebMCP today. The `data-duo-action`
  attribute pattern is our equivalent — same outcome (publish a
  discoverable agent-action), declarative not imperative, no JS
  required.
- **Browser-tab content (`<meta name="duo-open-in" content="browser">`)
  CAN run scripts.** A page Duo opens in browser mode could
  theoretically register WebMCP tools. The CDP-driven browser
  reading we already do (`duo eval`, `duo dom`, `duo text`) would
  let an agent discover those tools.

**Author guidance for v1 (today):**

- For canvases (`canvas` mode): keep using `data-duo-action`. It IS
  the contract. Stable names, typed inputs (`data-*` attributes),
  declarative invocation. No additional WebMCP layer needed.
- For browser-mode HTML you author for Duo: same recommendation —
  it'll be opened by Duo specifically, so use the Duo vocabulary
  for action discovery. WebMCP is currently overkill for this case
  too.
- For arbitrary public sites the user happens to load via Duo's
  browser pane: WebMCP is the SITE author's concern, not Duo's.
  When/if a site exposes WebMCP tools, a future Duo enhancement can
  surface them. Filed as a Stage 27.5+ exploration.

**Why NOT add a parallel WebMCP layer to authoring today:**

- It would conflict with the no-allow-scripts trust gate (canvases
  ship inert outside Duo by design).
- It adds an imperative authoring path beside the declarative one;
  same expressive surface, doubled maintenance.
- It doesn't unblock anything Stage 28's lesson packs need.

**What WebMCP convergence might earn us later:** if the wider web
adopts it, a Duo browser pane could discover and call WebMCP tools
on arbitrary pages, complementing CDP-based DOM reading. That's a
Stage Z exploration item, not Sprint A authoring guidance. Keep
authoring around `data-duo-action` for now; the convention is
ours and works in the surfaces Duo controls.

---

## Cross-references

- `skill/canvas-interaction.md` — companion skill: open + read +
  drive existing canvases (`duo html update`, `duo events --follow`,
  trust-gate debugging)
- `skill/examples/canvas-actions.md` — drive-by cheat sheet (Stage 23 + 27 verbs)
- `skill/examples/canvas-templates/` — five copy-paste templates (Stage 27 Commit 6)
- `docs/prd/stage-27-canvas-authoring.md` — Sprint A PRD
- `docs/prd/stage-28-lesson-packs.md` — Sprint C consumer (intro-to-duo + claude-code-basics)
- `agents/duo.md` — `duo events --follow` cheat-sheet entry
- Stage 23 trust gate spec — `renderer/components/HtmlCanvas/canvasActions.ts § isCanvasPathTrusted`
- W3C WebMCP draft — `https://github.com/webmachinelearning/webmcp` (background reading)
