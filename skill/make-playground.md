---
name: make-playground
description: Add interactivity to a Duo page — buttons that drive Duo, form inputs the agent can read, events the agent reacts to. Use whenever the user mentions ANY of these: "interactive", "make this clickable", "add buttons", "make it react", "drive Duo from a page", "page that does things", "form inputs", "events", "send a message when X", "agent should react when Y", "build a dashboard", "make a tool", "build a training" / "make a guide" / "create a lesson" / "teach my team X" / "tutorial for Y" / "onboarding flow", "interactive demo", "playground for testing X", "custom Duo workflow", "automation surface", "control panel". The bar for reaching for this skill is LOW — if there's any hint of "the user clicks and Duo reacts" or "the page does something beyond render content", reach for this skill. Extends `make-page` (read that first if you're building from scratch). For lesson-shaped playgrounds with a paired guide skill driving step-by-step, see § Lessons specifically below — that section points at the canonical lesson template at `skill/examples/lesson-template/`.
---

# Authoring playgrounds for Duo

> A **playground** is an HTML tab with interactivity: buttons that drive
> Duo via playground-action verbs, form inputs piped through
> `data-payload-from`, events emitted via `duo:event`. The interactive
> tier on top of `make-page`.

## Contents

- [The action contract](#the-action-contract)
- [REQUIRED defaults — every playground includes these](#required-defaults--every-playground-includes-these)
- [Action vocabulary cheat sheet](#action-vocabulary-cheat-sheet)
- [Form inputs (data-payload-from)](#form-inputs-data-payload-from)
- [Agent-side wiring (consumer of what you author)](#agent-side-wiring-consumer-of-what-you-author)
- [Anti-patterns](#anti-patterns)
- [Lessons specifically — the canonical pattern](#lessons-specifically--the-canonical-pattern)
- [Worked example: a click-through tutorial playground](#worked-example-a-click-through-tutorial-playground)
- [Verb-driven modality — duo open = browser, duo edit = canvas](#verb-driven-modality--duo-open--browser-duo-edit--canvas)
- [On WebMCP — should authored playgrounds conform?](#on-webmcp--should-authored-playgrounds-conform)
- [Cross-references](#cross-references)

---

> **Modality is verb-driven.** The verb decides: `duo open <path>` →
> browser pane (scripts run, buttons fire); `duo edit <path>` → canvas
> iframe (source-editable, scripts blocked). No meta declaration is
> needed — playgrounds just need to be opened via `duo open`. The user
> **interacts** with the running surface — they don't edit source while
> it's running. Editing the source = open the same file via `duo edit`
> (or right-click → "Edit in canvas"). See
> [`references/vocabulary.md`](references/vocabulary.md).
>
> **Vocabulary lock** (see [`references/vocabulary.md`](references/vocabulary.md)):
> - **canvas (the slot)** — the right pane (type-agnostic)
> - **canvas mode** — HTML tab in the canvas iframe; editable, scripts blocked, buttons inert. Reached via `duo edit`.
> - **browser mode** — HTML tab in the browser pane; scripts run, buttons fire. Reached via `duo open`.
> - **page** — HTML opened via `duo edit` (canvas mode) — see `make-page`
> - **playground** — HTML opened via `duo open` (browser mode) — THIS skill
> - **lesson** — playground + paired guide skill — see § Lessons specifically
> - **start tab** — a playground that auto-opens on first launch
>
> **Reach for this skill** any time the user wants the page to DO
> something — click handlers that drive Duo (open files, focus the
> terminal, send selected text to Claude), forms that capture user
> input, or events the agent should react to. The bar is low: if
> you're tempted to make the user click anything, reach for this.
>
> **Read `make-page` first** if you're building from scratch. This
> skill assumes you have the page basics (sandboxing, paint regions,
> stable IDs, verb-driven routing) — those are documented there.
> Playground = page + interactivity + **browser-mode default**.

---

## The action contract

Every playground gets, on top of the page contract:

1. **A delegated click listener.** Duo intercepts every click before
   contentEditable's cursor placement runs and looks for a
   `data-duo-action` attribute on the click target (or the nearest
   ancestor). When present, it parses the action and dispatches it
   through the trusted-action handler in App.tsx.
2. **A form-input reader.** Buttons with `data-duo-action="duo:event"`
   AND `data-payload-from="<selector>"` ship the matched element's
   `.value` (or `.checked`) in the event's `payload.value`.
3. **An event bus.** `duo:event` clicks emit JSON-line events on Duo's
   internal bus. Agents stream them via `duo events --follow`. Cursor-
   resumable across reconnects (`--since <cursor>`).
4. **The same trust gate as pages.** Action verbs only fire when the
   playground's path is under `~/.claude/duo/` (or the project root,
   for dev playgrounds). Outside that, clicks log a one-line
   `onUntrusted` warning and don't dispatch.

**Use `data-duo-action="<verb>"` (NOT `data-action`)** on clickable
elements, plus per-verb `data-*` siblings carrying the args.
**Use `data-duo-pane="<region-name>"`** on container elements the
agent will repaint with `duo html set --selector "[data-duo-pane=…]"`
(see `make-page` § Paint regions for the full pattern).
**Use `<meta name="duo-default-editable" content="false">`** on every
playground — read-only mode means clicks dispatch the action verb
instead of placing the cursor in a contentEditable field. Without
this, the user clicks "Submit" and Duo treats it as "place cursor here."

---

## REQUIRED defaults — every playground includes these

Every playground Claude scaffolds for the user
**must** include two affordances by default. Skip them only when the
playground's purpose is genuinely incompatible (e.g. a static
visualization with no output to send / copy — and even then, default to
including).

### 1. "Send to Claude" button

A button that posts the playground's current output / selection / state
to the active Claude terminal so the user can hand-off without a copy /
paste round-trip. Use the `terminal:send` action verb with
`data-payload-from` (or static `data-text`) so the runtime fills in the
payload from a form field, output area, or computed value.

```html
<button class="cta"
        data-duo-action="terminal:send"
        data-payload-from="#output"
        data-text="Here's the playground result:&#10;&#10;"
        data-enter="false">
  Send to Claude
</button>
```

For a multi-line composed payload, pair with `duo:event` + a
JS-side handler that builds the text and calls
`window.duoPlaygroundAction({ verb: 'terminal:send', text: composed })`.

### 2. "Copy output" button

A button that copies the playground's structured output to the system
clipboard. Use `navigator.clipboard.writeText(...)` — no Duo verb
needed; it's a plain browser API. Pair with a brief "Copied!" flash
on the button so the user has feedback.

```html
<button id="copy-btn" class="cta-secondary">Copy output</button>
<script>
  document.getElementById('copy-btn').addEventListener('click', async () => {
    const out = document.getElementById('output')?.textContent ?? '';
    await navigator.clipboard.writeText(out);
    const btn = document.getElementById('copy-btn');
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy output'; }, 1200);
  });
</script>
```

### Why both

The two patterns are complementary:

- **Send to Claude** is the "round-trip back to the agent" path — works
  when the user wants to continue a conversation about the playground's
  result. Friction-free (one click; no clipboard).
- **Copy output** is the "use this elsewhere" path — works when the
  user wants to paste into Slack, Notion, the markdown editor, etc.
  Doesn't require an active Claude terminal.

A playground that hands the user a useful output but offers neither
button forces them to manual-select + ⌘C, which is hostile UX. Default
to including both; remove only with explicit reason.

### Reference: a decision-capture playground

The canonical shape of this pattern: a set of multiple-choice
questions + per-question notes + a sticky bottom Copy-decisions button
that assembles a structured payload. Reuse the JS pattern (build a
labeled payload, write it to clipboard, flash the button) for any
"feedback round-trip" playground. The `worksheet` skill (see
Cross-references) is the reusable primitive that generates exactly
this layout from a JSON manifest.

---

## Action vocabulary cheat sheet

The playground can drive nine distinct operations. All inherit the trust
gate; all parse from `data-*` attributes on the clicked element.

| Verb | Signature (data-*) | What it does |
|---|---|---|
| `claude:spawn` | `data-cwd?`, `data-cmd?` | New Claude tab in CWD; `data-cmd` is Claude's **first user message** (not a shell command — see semantic note in Anti-patterns) |
| `terminal:send` | `data-text`, `data-enter?` | Write to active terminal's PTY; optional auto-Enter |
| `browser:open` | `data-url` | New browser tab (external-domain blocklist applies) |
| `editor:open` | `data-path`, `data-mode?` | Open file in editor / canvas / browser |
| `nav:reveal` | `data-path` | Show in file navigator + select |
| `selection:set` | `data-target`, `data-text? \| data-line? \| data-anchor?` | Scroll-to-and-select inside the active surface |
| `theme:set` | `data-theme` | Flip light / dark / system |
| `terminal:focus` | `data-tab-id?` | Focus the active or named terminal tab |
| `duo:event` | `data-event`, `data-payload?`, `data-payload-from?` | Emit a named event into the bus |

For per-verb examples see [`examples/canvas-actions.md`](examples/canvas-actions.md) —
the worked drive-by reference. The patterns below show how to compose
verbs into multi-step interactions.

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

When you author a playground, you're producing markup that an agent
(you, later, in a separate Claude tab) will run against. The runtime
contract:

- **Buttons emit events.** A `data-duo-action="duo:event"` click
  lands as one JSON line in `duo events --follow`.
- **Paint regions are stable.** A `data-duo-pane="<name>"` div is the
  agent's `duo html set --selector` target.
- **Form values ride along.** `data-payload-from="#input"` puts
  `.value` (or `.checked`) in the event's `payload.value`.

The full agent-side playbook — subscription patterns, `--since`
cursor resume, `duo html set` paint syntax, debugging — lives in
[`playground-interaction.md`](playground-interaction.md). That's where
you go when you switch hats from author to driver.

---

## Anti-patterns

**Don't ship a playground with scripts that need network.** Same as
pages — `allow-scripts` is OFF. Run network agent-side; paint via
`duo html set`.

**Don't paint into the same pane on every event.** A "save" button
that re-renders the whole `data-duo-pane="status"` block on each
click is fine. A typing-into-an-input flow that fires `duo:event`
on every keystroke and repaints in response will race with itself.
Throttle agent-side, or fire the event on `blur` / explicit submit.

**Don't rely on localStorage for cross-playground state.** Iframes
share the parent renderer's localStorage, but state visible to one
playground is not guaranteed to be visible to another. For multi-
playground state, push it through the agent — the agent owns the
"between playgrounds" memory.

**Don't fire `claude:spawn` without a clear `data-cwd`.** Without
`data-cwd`, the new tab inherits the renderer's pending-CWD which is
typically the navigator's current folder — which may not be where
the user expects to start. Always specify the CWD when spawning from
a playground; the user's `~` is rarely the right answer.

**`claude:spawn` `data-cmd` semantics — IT'S A CLAUDE PROMPT, NOT A
SHELL COMMAND.** When `data-cmd` is supplied, the runtime sends
`claude\n${cmd}\n` to the new PTY: the shell launches Claude, then
Claude reads the cmd as its **first user message**. So write
`data-cmd` as natural-language prose ("Read X and walk me through
it"), NOT as a shell invocation (`claude --prompt "..."` would be
wrong — `claude` runs first; the cmd lands in Claude's stdin, not
zsh's). If the playground needs a SHELL command in the new tab,
use `claude:spawn` without `data-cmd` and follow up with a
`terminal:send data-text="..."` button.

**Don't auth-prompt-block at startup.** A playground that needs the
user to fill in a form before any action is available makes the
playground useless until completed. Provide a non-form path (a
button labelled "Start without setup") so first-time visitors can
explore.

**Don't bake brand colours into every playground.** Use Atelier
palette tokens (`--paper`, `--ink`, `--accent`) in inline styles.
The user's theme toggle (`theme:set`) flips the variables; hard-
coded `#ffffff` won't follow.

**Inline the Atelier kernel — don't re-author CSS from scratch.**
The canonical stylesheet is
[`references/duo-atelier.css`](references/duo-atelier.css). Copy its
full contents into the playground's `<style>` block as the first thing
inside it; add per-playground overrides AFTER. The kernel ships color
tokens + typography + the class library (`.intro`, `.decision-card`,
`.q-option`, `.q-notes`, `.copy-bar`, `details.deferred`) — common
patterns you'd otherwise re-type for every playground. Class library +
minimal-skeleton template documented at
[`references/atelier-css.md`](references/atelier-css.md).

---

## Lessons specifically — the canonical pattern

When the user asks for "a training," "a guide," "an onboarding flow,"
"a tutorial," "a way to teach my team X" — they want a **lesson**:
a playground + a paired guide skill that Claude reads to drive the
user through step-by-step.

**Don't invent a new structure each time.** Lessons share a canonical
shape that buys cross-pack consistency, mid-lesson resume, and
automated fly-through validation:

**Two shapes, two templates:**

| Shape | Template | When |
|---|---|---|
| **Linear lesson** — single playground, N steps | `~/.claude/skills/duo/examples/lesson-template/` | One topic, ~5-15 min, user works through linearly. Most common. |
| **Curriculum** — orientation + multiple module canvases | `~/.claude/skills/duo/examples/curriculum-template/` | Multi-topic, ~20-60+ min, user picks order or follows prerequisites. |

**Workflow (either template):**

1. **Start from the template.**
   ```bash
   # For linear lessons:
   cp -r ~/.claude/skills/duo/examples/lesson-template/ \
         ~/.claude/duo/packs/<pack-name>/
   # For curricula:
   cp -r ~/.claude/skills/duo/examples/curriculum-template/ \
         ~/.claude/duo/packs/<pack-name>/
   ```
   The linear template gives you a single `canvases/playground.html`
   with three stable paint regions (`step-counter` / `step-body` /
   `step-controls`) plus a `lesson-skill/SKILL.md` skeleton. The
   curriculum template gives you an `orientation.html` launcher +
   one `module-template.html` to copy per module + an orchestrator
   skill skeleton.
2. **Read `~/.claude/skills/duo/lesson-runtime.md`** before writing
   skill logic. It defines the canonical event names
   (`lesson:step-N-done`, `lesson:restart`, `lesson:done`,
   `lesson:module-<id>-launch`/`-done`/`-abandon`), the sidecar
   state schema at `~/.claude/duo/lesson-state/<pack>.json`, and
   the cursor-resumption pattern that makes mid-lesson Duo restarts
   recoverable. § Curriculum case covers the multi-canvas
   extension.
3. **Customize content, not structure.** Replace step content,
   step count, step transitions, module ids, prerequisites — but
   keep the canonical paint regions + event-name conventions.
   The convention IS the contract.

**To test what you build, fly through it:** the
`~/.claude/skills/duo/lesson-flythrough.md` skill (auto-loads on
"fly through this lesson", "test my new lesson", "preview the
lesson") walks the lesson end-to-end without manual clicking.
Linear lessons today; multi-canvas curricula extension is queued.

**Lesson vs. plain playground.** A playground without a paired
lesson-skill is fine for many cases (dashboards, agent-emitted
reports, the smoke-walk page, "start tab" customizations). The lesson
template adds:
- A guide skill that drives the user step-by-step
- Sidecar state for resume across Duo restarts
- Cursor-based event subscription (one canonical loop)

If the playground is a one-shot interaction (click button, see
result, done), skip the lesson template — author the playground
alone using the patterns above. Reach for the lesson template
when there's a TEACHING ARC the agent has to drive.

**Cross-references:**
- `~/.claude/skills/duo/examples/lesson-template/` — copy this
- `~/.claude/skills/duo/lesson-runtime.md` — the runtime contract
- `~/.claude/duo/packs/intro-to-duo/` — current example (note:
  pre-template; refactor to canonical pattern queued)

---

## Worked example: a click-through tutorial playground

The `lesson-scaffold.html` template at
[`examples/canvas-templates/`](examples/canvas-templates/)
demonstrates a complete two-step tutorial:

```html
<!DOCTYPE html>
<html>
<head>
  <!-- Playgrounds open in browser mode via `duo open <path>` —
       the verb decides routing, so no meta declaration is needed. -->
  <!-- Soft default for the canvas-mode override path: when the user
       opens this file via `duo edit` to modify the source, the canvas
       mounts read-only by default. -->
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
duo html set --selector '[data-duo-pane="step-counter"]' \
             --content 'Step 2 of 2'
duo html set --selector '[data-duo-pane="body"]' \
             --content '<p>Now type some content and press ⌘S to save.</p>
                        <button data-duo-action="duo:event"
                                data-event="lesson-step-2-done">Done ✓</button>'
```

The user sees the lesson advance without any page reload. The agent
emits a final summary event (`lesson-step-2-done`) and unsubscribes.

For a fully-canonical lesson with sidecar resume + the lesson-runtime
event-loop, see the lesson-template at
`~/.claude/skills/duo/examples/lesson-template/` (referenced in
§ Lessons specifically above).

---

## Verb-driven modality — `duo open` = browser, `duo edit` = canvas

The verb decides the surface. Playgrounds open in browser mode via `duo open <path>` (or file-tree double-click) — the file lands in Duo's browser pane as a real Chromium tab, scripts run, buttons fire their `data-duo-action` handlers, form inputs are live, events stream to Claude via `duo events --follow`.

No meta declaration is needed: the verb is the signal. The legacy `<meta name="duo-open-in">` declaration is no longer consulted (any existing declarations are harmless). `duo open` ALWAYS produces a real browser tab for HTML.

**Editing a playground's source — `duo edit`.** When the user wants to mutate a playground's HTML source, they open the same file via `duo edit <path>` (or right-click a browser tab whose URL is `file://…` → "Edit in canvas"). The file mounts in the canvas iframe — buttons render but **clicks place a cursor instead of firing handlers** (no `allow-scripts` in the iframe). The user edits the HTML source via contentEditable + markdown shortcuts. Save reflects in the running browser tab if it's still open — the file watcher reloads the browser tab.

Rare overrides:
- `duo open --canvas <path>` — force canvas mount via the open verb (useful for inspecting a playground's source without firing its scripts).
- `duo edit --browser <path>` — force browser mount via the edit verb (symmetric override).

### The escape hatch — `window.duoPlaygroundAction`

The browser-pane runtime exposes `window.duoPlaygroundAction(jsonBundle)` directly on the page's window. Inline JS can call it without going through a click. Bundle shape:

```js
window.duoPlaygroundAction(JSON.stringify({
  attrs: {
    'data-duo-action': 'duo:event',
    'data-event': 'walk:item-changed',
    'data-payload': JSON.stringify({ id: 'item-001', value: 'PASS' })
  }
}));
```

This unlocks the **live-event pattern** for any user interaction: the page's existing change/input/keydown handlers can call `duoPlaygroundAction` directly and Claude (subscribed via `duo events --follow`) sees the interaction live. No click needed; no `<button data-duo-action>` ceremony.

**When to reach for this:**
- The user clicks a radio / checkbox / select inside a worksheet → inline JS handler emits `duo:event` so Claude sees the answer live.
- The user types into a textarea and pauses → debounced inline JS emits `duo:event` with the current value.
- The user reaches a milestone (form complete, lesson step done) → inline JS emits a custom event payload.

**Don't over-decorate.** The point is that Claude is subscribed to `duo events --follow` and reacts to events as they fire. **Don't fire an event on every keystroke** — that floods the bus and races with itself. Fire on `change` for radios/selects, on `blur` or debounced `input` for textareas, on explicit submit for forms.

**Defensive guard.** Always check `typeof window.duoPlaygroundAction === 'function'` before calling — the function is undefined when the page is opened outside Duo (plain Chrome, etc.) or in older Duo builds. Fall through to whatever fallback your playground provides (clipboard copy, `window.duoSendResult`, etc.).

### Reference implementations

The smoke-walk page (`~/.claude/skills/smoke-walk/`) and the worksheet primitive (`~/.claude/skills/worksheet/`) are the reference implementations. Both open in browser mode via `duo open` (verb-driven routing; no meta declaration required) and use the inline-JS escape hatch for live event emission.

---

## On WebMCP — should authored playgrounds conform?

**Short answer: not for canvas-tab playgrounds. Maybe later for
browser-tab content.**

The W3C WebMCP draft proposes `navigator.modelContext.registerTool({...})`
as a JS API for pages to publish "agent-action contracts" — named,
typed, callable tools an agent can discover at runtime. Spiritually
adjacent to what Duo's `data-duo-action` vocabulary already does:
both publish discoverable contracts on the page.

The practical mismatch:

- **Canvas-tab iframes are sandboxed without `allow-scripts`.**
  `navigator.modelContext.registerTool()` requires JS execution.
  Playground authoring CANNOT use WebMCP today. The `data-duo-action`
  attribute pattern is our equivalent — same outcome (publish a
  discoverable agent-action), declarative not imperative, no JS
  required.
- **Browser-mode HTML (opened via `duo open`) CAN run scripts.**
  A playground Duo opens in browser mode could theoretically register
  WebMCP tools. The CDP-driven browser reading we already do (`duo
  eval`, `duo dom`, `duo text`) would let an agent discover those
  tools.

**Author guidance for v1 (today):**

- For playgrounds (canvas mode): keep using `data-duo-action`. It IS
  the contract. Stable names, typed inputs (`data-*` attributes),
  declarative invocation. No additional WebMCP layer needed.
- For browser-mode HTML you author for Duo: same recommendation —
  it'll be opened by Duo specifically, so use the Duo vocabulary
  for action discovery. WebMCP is currently overkill for this case
  too.
- For arbitrary public sites the user happens to load via Duo's
  browser pane: WebMCP is the SITE author's concern, not Duo's.
  When/if a site exposes WebMCP tools, a future Duo enhancement can
  surface them. Filed as a later exploration.

**Why NOT add a parallel WebMCP layer to authoring today:** it would
conflict with the no-allow-scripts trust gate; it adds an imperative
authoring path beside the declarative one (same expressive surface,
doubled maintenance); it doesn't unblock anything the lesson packs
need.

---

## Cross-references

- **Page basics (read first if building from scratch):** [`make-page.md`](make-page.md)
- **Drive an existing playground (author → driver):** [`playground-interaction.md`](playground-interaction.md)
- **Per-verb action examples:** [`examples/canvas-actions.md`](examples/canvas-actions.md)
- **Lessons — runtime contract:** [`lesson-runtime.md`](lesson-runtime.md)
- **Lessons — canonical template:** [`examples/lesson-template/`](examples/lesson-template/)
- **Reference templates (mostly playgrounds):** [`examples/canvas-templates/`](examples/canvas-templates/)
- **Decision-capture / feedback-round-trip primitive:** `~/.claude/skills/worksheet/`
- **Lesson in the wild:** `~/.claude/duo/packs/intro-to-duo/`
  (note: pre-canonical structure — authored before the canonical
  template existed; refactor queued.)
- **Vocabulary:** [`references/vocabulary.md`](references/vocabulary.md) — the
  canvas / page / playground / lesson hierarchy.
