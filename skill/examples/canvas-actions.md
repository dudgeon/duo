# Authoring canvas actions

When you write an HTML canvas the user will open in Duo, you can make
the page itself drive the workspace by tagging clickable elements with
`data-duo-action="<verb>"` plus per-verb `data-*` siblings carrying the
arguments. The host (Duo's renderer) intercepts the click before the
canvas's own JS or `contentEditable` see it, so the side effect is
predictable, scriptless, and inert outside Duo.

This file is the per-verb reference. The companion authoring guides
point here: writing a page → `make-page.md`; writing an interactive
playground → `make-playground.md`; driving an existing playground →
`playground-interaction.md`.

## Contents

- [Trust gate](#trust-gate)
- [Vocabulary](#vocabulary)
  - [`claude:spawn` — open a new Claude tab](#claudespawn--open-a-new-claude-tab)
  - [`terminal:send` — write into the active terminal](#terminalsend--write-into-the-active-terminal)
  - [`browser:open` — open a URL in the embedded browser](#browseropen--open-a-url-in-the-embedded-browser)
  - [`editor:open` — open a file in the editor / canvas / browser](#editoropen--open-a-file-in-the-editor--canvas--browser)
  - [`nav:reveal` — show a path in the file navigator](#navreveal--show-a-path-in-the-file-navigator)
  - [`selection:set` — scroll to and select inside the editor or canvas](#selectionset--scroll-to-and-select-inside-the-editor-or-canvas)
  - [`theme:set` — flip Duo's light/dark/system theme](#themeset--flip-duos-lightdarksystem-theme)
  - [`terminal:focus` — give focus to the active terminal](#terminalfocus--give-focus-to-the-active-terminal)
  - [`duo:event` — emit a named event into the bus](#duoevent--emit-a-named-event-into-the-bus)
- [Patterns](#patterns)
- [Error surfacing](#error-surfacing)
- [What this is not](#what-this-is-not)

## Trust gate

Actions only fire when the canvas file's path is under
`~/.claude/duo/`. Outside that root they are silently ignored (a
single `console.info` line logs the attempt for debugging). This
covers Duo's own help pages and bundled skill-pack canvases. A
"user-marked-trusted folders" extension is on the roadmap; until then,
canvases the agent writes into project folders stay inert.

## Vocabulary

### `claude:spawn` — open a new Claude tab

```html
<button data-duo-action="claude:spawn">Open a fresh Claude session</button>
```

Optional siblings:

- `data-cwd="<absolute path>"` — override the navigator's pending CWD.
- `data-cmd="<text>"` — type the given text into the spawned PTY
  *before* `claude` takes over (so the agent sees it as the user's
  first prompt). No `\n` is added — pair with a literal newline if you
  want to submit, or expect the user to confirm.

### `terminal:send` — write into the active terminal

```html
<button data-duo-action="terminal:send" data-text="duo --version">
  Print Duo version
</button>
```

- `data-text="<text>"` (required) — payload written into the active
  terminal's PTY.
- `data-enter="true"` — append `\n` so the command runs immediately
  (the same flag as `duo send --text "…" --enter` on the CLI).
  Defaults to `false`; the user confirms by pressing Enter when omitted.

### `browser:open` — open a URL in the embedded browser

```html
<a href="#" data-duo-action="browser:open" data-url="https://docs.claude.com/claude-code">
  Read the Claude Code docs
</a>
```

- `data-url="<url>"` (required) — navigated in a new browser tab.
- The user's `~/.claude/duo/external-domains.json` still applies:
  hostnames on that list punt to the macOS default browser via `duo
  external` instead of opening in Duo's embedded view.

### `editor:open` — open a file in the editor / canvas / browser

```html
<button data-duo-action="editor:open" data-path="~/notes/today.md">
  Open today's notes
</button>
```

- `data-path="<path>"` (required) — absolute path or `~/`-relative.
- `data-mode="editor|canvas|browser"` (optional) — force the routing
  surface. When omitted, Duo routes by file type (a markdown file opens
  in the editor; an HTML file opens per the verb-driven default — see
  below).

**Surface is verb-driven for HTML.** The same `.html` file flips
surface by how it's opened: `duo open <path>` → **browser mode**
(interactive — scripts run, buttons fire); `duo edit <path>` →
**canvas mode** (source-editable, scripts blocked). For an
`editor:open` action targeting HTML, set `data-mode="browser"` for the
interactive playground surface or `data-mode="canvas"` for the
source-editable surface. (Legacy `<meta name="duo-open-in">`
declarations are no longer consulted and are harmless if present.)

### `nav:reveal` — show a path in the file navigator

```html
<button data-duo-action="nav:reveal" data-path="~/notes/today.md">
  Show in navigator
</button>
```

- `data-path="<path>"` (required) — same resolution as `editor:open`.
- The navigator scrolls the row into view, expands ancestors as
  needed, and selects it.

### `selection:set` — scroll to and select inside the editor or canvas

```html
<button data-duo-action="selection:set"
        data-target="editor"
        data-text="## Glossary">
  Jump to the glossary
</button>

<button data-duo-action="selection:set"
        data-target="canvas"
        data-anchor="result-pane">
  Show the result pane
</button>
```

- `data-target="editor|canvas"` (required).
- One of `data-text`, `data-line`, or `data-anchor`. Editor handles
  `text` (find first match) and `line` (1-indexed); canvas handles
  `anchor` (matches `data-duo-id`, then `id`) and `line` (Nth
  top-level child of `<main>` / `<body>`).

### `theme:set` — flip Duo's light/dark/system theme

```html
<button data-duo-action="theme:set" data-theme="dark">Dark mode</button>
```

- `data-theme="light|dark|system"` (required). Persists via the same
  localStorage key the titlebar toggle and `duo theme <mode>` use.

### `terminal:focus` — give focus to the active terminal

```html
<button data-duo-action="terminal:focus">Focus the terminal</button>
<button data-duo-action="terminal:focus" data-tab-id="terminal-3">
  Focus terminal 3
</button>
```

- `data-tab-id="<id>"` (optional) — focus a specific terminal tab by
  id; absent, the currently active terminal gets focus.

### `duo:event` — emit a named event into the bus

```html
<button data-duo-action="duo:event"
        data-event="lesson:step-1-done"
        data-payload='{"score": 5}'>
  Next step
</button>
```

- `data-event="<name>"` (required) — convention `<source>-<noun>-<verb>`
  for generic canvas events (e.g. `compute-balance`,
  `refresh-notifications`). **Lesson events use a mandatory `lesson:`
  colon prefix** (e.g. `lesson:step-1-done`, `lesson:restart`,
  `lesson:done`) so concurrent lessons don't collide — see
  `lesson-runtime.md`.
- `data-payload="<json-object>"` (optional) — JSON object literal merged
  into the emitted event payload.
- `data-payload-from="<css-selector>"` (optional) — read `.value` (or
  `.checked` for `type="checkbox"|"radio"`) of the selected form
  element and add it as `payload.value`. Static `data-payload` keys
  win on collision. Supported elements: `<input>`, `<textarea>`,
  `<select>` (multi-selects return an array).
- Subscribers stream events via `duo events --follow`.

#### Form-input pattern

A "submit name" button that ships the user's typed value as part of
the emitted event:

```html
<input id="user-name" type="text" placeholder="Your name" />
<button data-duo-action="duo:event"
        data-event="user-introduced"
        data-payload-from="#user-name">
  Submit
</button>
```

The agent (subscribed via `duo events --follow`) sees:

```json
{"cursor":"…","ts":"…","source":"canvas","name":"user-introduced","payload":{"value":"Geoff"}}
```

## Patterns

**Quiz flow (bidirectional Claude ↔ HTML).** A canvas displays a
prompt + four choices; each choice button is
`<button data-duo-action="terminal:send" data-text="The user picked: …" data-enter="true">`.
Submitting writes the choice into the active Claude tab where the
agent grades it and (via `duo html replace`, which swaps outerHTML)
writes the next quiz slide back into the canvas.

**Lesson runner.** A canvas shows a markdown explainer plus a "next
section" button:
`<button data-duo-action="terminal:send" data-text="next section" data-enter="true">`.
The agent listens to the active terminal and writes the next section
to the canvas.

**Worked-example dashboard.** A canvas shows a list of common queries
the agent supports; each row is
`<button data-duo-action="claude:spawn" data-cmd="Tell me about …">`.
Clicking opens a fresh Claude tab with the question pre-typed —
useful for a "starting points" page that a power user can pin.

## Error surfacing

Malformed markup (unknown verb, missing required `data-text`/`data-url`,
empty action attribute) logs to the canvas's console with a
`[duo-canvas-action]` prefix. Dispatch failures (no active terminal
for `terminal:send`, etc.) log there too. There is no in-canvas toast;
open the iframe DevTools (right-click → Inspect) to see errors during
authoring.

## What this is not

- **Not a scripting hook.** Canvases do not get `allow-scripts`. The
  `data-duo-action` vocabulary above is exactly the surface; you
  cannot read DOM state, fetch URLs, or call MCP servers from a canvas
  action.
- **Not bidirectional automatically.** "The agent grades the answer"
  in the quiz pattern still requires the agent to be running and
  listening. Canvas actions are a click-to-side-effect channel; they
  don't bring the agent into existence on their own.
- **Not for off-host workflows.** Untrusted canvases stay inert; if
  you need to share an interactive HTML with someone outside Duo,
  ship them a real web page with real JavaScript.
