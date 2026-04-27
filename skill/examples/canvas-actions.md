# Authoring canvas actions (Stage 23)

When you write an HTML canvas the user will open in Duo, you can make
the page itself drive the workspace by tagging clickable elements with
`data-duo-action="<verb>"` plus per-verb `data-*` siblings carrying the
arguments. The host (Duo's renderer) intercepts the click before the
canvas's own JS or `contentEditable` see it, so the side effect is
predictable, scriptless, and inert outside Duo.

## Trust gate (v0.3.0)

Actions only fire when the canvas file's path is under
`~/.claude/duo/`. Outside that root they are silently ignored (a
single `console.info` line logs the attempt for debugging). This
covers Duo's own help pages and Stage 18b skill-pack canvases. The
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
  (Stage 23b — same flag as `duo send --text "…" --enter` on the CLI).
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

## Patterns

**Quiz flow (bidirectional Claude ↔ HTML).** A canvas displays a
prompt + four choices; each choice button is
`<button data-duo-action="terminal:send" data-text="The user picked: …" data-enter="true">`.
Submitting writes the choice into the active Claude tab where the
agent grades it and (via `duo html replace`) writes the next quiz
slide back into the canvas.

**Lesson runner.** A canvas shows a markdown explainer plus a "next
section" button:
`<button data-duo-action="terminal:send" data-text="next section" data-enter="true">`.
The agent listens to the active terminal and writes the next section
to the canvas.

**Worked-example dashboard.** A canvas shows a list of common queries
the agent supports; each row is
`<button data-duo-action="claude:spawn" data-cmd="Tell me about …">`.
Clicking opens a fresh Claude tab with the question pre-typed —
useful for "starting points" pages a Trailblazer can keep pinned.

## Error surfacing

Malformed markup (unknown verb, missing required `data-text`/`data-url`,
empty action attribute) logs to the canvas's console with a
`[duo-canvas-action]` prefix. Dispatch failures (no active terminal
for `terminal:send`, etc.) log there too. There is no in-canvas toast
in v0.3.0 — open the iframe DevTools (right-click → Inspect) to see
errors during authoring.

## What this is not

- **Not a scripting hook.** Canvases do not get `allow-scripts`. The
  3-verb vocabulary is exactly the surface; you cannot read DOM
  state, fetch URLs, or call MCP servers from a canvas action.
- **Not bidirectional automatically.** "The agent grades the answer"
  in the quiz pattern still requires the agent to be running and
  listening. Canvas actions are a click-to-side-effect channel; they
  don't bring the agent into existence on their own.
- **Not for off-host workflows.** Untrusted canvases stay inert; if
  you need to share an interactive HTML with someone outside Duo,
  ship them a real web page with real JavaScript.
