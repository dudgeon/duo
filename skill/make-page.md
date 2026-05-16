---
name: make-page
description: Author a basic HTML page that lives in Duo's canvas (the right pane). Use when the user asks to "make an HTML page", "create a page in Duo", "render this content as a page", "open this HTML in the canvas", "build a static reference page", or similar — anything HTML that the user wants Duo to render but DOESN'T need interactive action buttons or events. For pages WITH interactivity (buttons that drive Duo, form inputs, events) reach for `make-playground` (which extends this skill); for lesson-shaped pages with a paired guide skill, follow the lesson template referenced from `make-playground`.
---

# Authoring pages for Duo

> **Stage 27 — `skill/make-page.md`.** Author a **page**: a basic
> HTML tab that lives in Duo's canvas (the right pane). Static or
> lightly-styled content; no actions, no events, no form bindings.
> Just rendered HTML. The simplest unit of canvas authoring; the
> base that `make-playground` extends.
>
> **Vocabulary lock** (see [`references/vocabulary.md`](references/vocabulary.md)):
> - **canvas** — the right pane (slot, type-agnostic). Holds whatever
>   tab is active. NOT what you author.
> - **page** — a basic HTML tab inside the canvas. THIS is what
>   `make-page` covers.
> - **playground** — a page with interactivity (buttons that drive
>   Duo, form inputs, events). Reach for `make-playground`.
> - **lesson** — a playground paired with a guide skill. Reach for
>   `make-playground` § Lessons specifically.
>
> **Reach for this skill when** the user wants to RENDER content as
> a page in Duo's canvas — a styled reference, an embedded note, a
> visualization, a multi-pane diagram. **Reach for `make-playground`
> instead when** the user wants buttons that DO things, forms that
> capture input, or events the agent should react to.

---

## When to canvas, when to browser, when to markdown editor

| Surface | Use when |
|---|---|
| **Page** (canvas-mode HTML, reached via `duo edit <path>`) | The artifact is HTML you want to read or edit as source — diagrams, multi-column layouts, styled comparison tables, dashboards (without buttons). Same iframe runtime as a playground; just no interactivity (scripts blocked). |
| **Playground** (browser-mode HTML, reached via `duo open <path>`) | The artifact is meant to be interacted with — static reference documents the user reads uninterrupted (long FAQ, what-duo-does page), explainers with diagrams, or anything that benefits from scripts running and links/buttons being natively functional. The default for "show me the rendered thing." |
| **Markdown editor** | The artifact is text-first prose the user wants to edit collaboratively with the agent. Use markdown when the content is *the point*, not the visual structure. |

A page is the right answer when you want an HTML-shaped artifact
in the canvas — diagrams, multi-column layouts, styled comparison
tables, dashboards (without buttons — those are playgrounds).

---

## The runtime contract — what canvas pages get

Every page mounted in Duo's canvas gets:

1. **A sandboxed iframe.** `sandbox="allow-same-origin allow-popups
   allow-forms"` — explicitly NO `allow-scripts`. Authored `<script>`
   tags don't run; `onclick="…"` is inert; `<button onclick="…">`
   does nothing. This is intentional — pages stay inert outside Duo
   even if a malicious actor distributes them.
2. **Same-origin DOM access.** The parent renderer can read + mutate
   the iframe's DOM. This is how `duo html update --selector "[data-duo-pane=…]"`
   paints into a page region without re-rendering the whole tab. Even
   pure pages benefit from this if you want them re-paintable from
   Claude (e.g. a dashboard the agent updates with fresh data).
3. **A path-restricted trust gate.** Pages stay inert until they're
   under `~/.claude/duo/` (or the project root, for dev pages). This
   gate matters more for playgrounds (action verbs) than pages, but
   it applies uniformly.

What a page must NOT do:
- Run scripts. `<script>` tags are inert; CSS animations work fine.
- Network fetch. No XHR, no `fetch()`. If you need data, run the
  fetch agent-side and paint via `duo html update`.
- Cross-canvas state. Each page's iframe is isolated; localStorage is
  best-effort and not guaranteed across canvases.

What a page CAN do (and should):
- Use rich CSS (Atelier palette tokens, prefers-color-scheme, layouts,
  animations). HTML + CSS is the entire authoring surface.
- Embed images, SVG, video, audio (subject to sandbox restrictions).
- Use `data-duo-id` and `data-duo-pane` attributes (see below) for
  re-paintability — even pure pages can be re-painted by the agent.

---

## Stable IDs (`data-duo-id`)

When the agent needs to address a specific element by name — to read
its content, replace its HTML, scroll a button into view — give that
element a `data-duo-id`. Stable IDs survive HTML reformatting and
agent-driven mutations.

```html
<section data-duo-id="weather-summary">
  <h2>Today's weather</h2>
  <p>Sunny, 72°F</p>
</section>
```

The agent can later reference this element via:

```bash
duo html get --id weather-summary
duo html replace --id weather-summary --html "<section data-duo-id='weather-summary'><h2>Today's weather</h2><p>Cloudy, 68°F</p></section>"
duo doc goto --anchor weather-summary
```

**Naming convention.** Use kebab-case with a meaningful prefix:
`<page-name>-<region>-<role>`. Examples: `weather-summary`,
`dashboard-balance-pane`, `quiz-q3-answer-c`. Random IDs (e.g. `id-37`)
are OK for quick scaffolds but defeat the agent's "name what you mean"
addressing.

---

## Paint regions (`data-duo-pane`)

When the agent will *repaint* a region of the page with new content
— a dashboard refresh, a status pane after an action elsewhere —
mark that region with `data-duo-pane="<name>"`.

```html
<main>
  <h1>Dashboard</h1>
  <section data-duo-pane="balance">
    <p>Balance: loading…</p>
  </section>
  <section data-duo-pane="recent-activity">
    <p>Recent activity: loading…</p>
  </section>
</main>
```

The agent paints into a pane via:

```bash
duo html update --selector '[data-duo-pane="balance"]' \
                --html '<p>Balance: $1,247.50</p>'
```

`duo-pane` and `duo-id` overlap functionally, but `pane` flags
"expect repaints here" while `id` flags "stable handle for one
element." Use `pane` for whole regions; use `id` for single
addressable elements.

---

## Routing — verb-driven (ENH-156)

The verb that opens the file decides its surface:

- **`duo open <path>` → browser mode.** Scripts run, buttons fire,
  the user **interacts** with the running surface. This is the
  default for "show me the rendered thing." Use this for explainers,
  playgrounds, FAQ-style reference docs, anything the user looks at
  rather than edits.
- **`duo edit <path>` → canvas mode.** Source-editable, scripts
  blocked, buttons render but clicks place a cursor. Use this for
  modifying the HTML source itself.

No meta declaration is needed for routing — the verb is the signal.
The legacy `<meta name="duo-open-in" content="browser">` declaration
is no longer consulted; existing declarations on user files are
harmless.

Rare overrides:
- `duo open --canvas <path>` — force canvas mount (inspect source
  without firing scripts).
- `duo edit --browser <path>` — force browser mount (symmetric).
- UI: right-click a `file://` browser tab → "Edit in canvas"
  (equivalent to `duo edit`).

### `<meta name="duo-default-editable" content="false">`

Soft hint for canvas mode (`duo edit`): the page mounts read-only
by default, but a toolbar toggle lets the user flip into edit mode
at runtime. Their choice persists per-path in localStorage.
**Recommended for any page that's primarily display** — it prevents
accidental cursor placement and content edits when the user clicks
around in canvas mode.

There's a related hard-lock variant `<meta name="duo-editable"
content="false">` that hides the toolbar toggle entirely. Use the
hard lock for system reference HTMLs (FAQ, what-duo-does); use
`duo-default-editable` for display-oriented pages the user might
occasionally want to annotate.

---

## Copy buttons on `<pre>` blocks (auto-injected)

**Any `<pre>` block in a canvas page automatically gets a Copy button.**
The renderer scans the document for `<pre>` elements on mount + on any
HTML mutation, and appends a small "Copy" affordance that copies the
inner `<code>` text (or `<pre>` text if there's no inner `<code>`) to
the clipboard.

This is auto-mode — you don't opt in, you don't add a class. Just
write `<pre><code>your runnable text</code></pre>` and the user gets
a one-click copy. Use it for:

- Shell commands the user is expected to run (`npm install`, `duo open …`, etc.)
- File paths the user will paste into their navigator
- Multi-line snippets that are awkward to triple-click-select

If you specifically DON'T want a Copy button on a `<pre>` block (very
short literals, decorative ASCII art), inline it as `<code>` instead
of `<pre>` — copy buttons attach to `<pre>` only.

The same auto-injection runs in the smoke-walk page generator, the
canvas templates (`lesson-template/canvases/playground.html` etc.),
and any agent-emitted page that uses `<pre>` blocks. One contract,
one renderer-side implementation, no per-page wiring needed.

---

## Anti-patterns

**Don't ship a page with scripts that need network.** Pages are
sandboxed without `allow-scripts`. Even if scripts COULD run,
they'd have no network access. If you need a fetch, run it
agent-side and write the result back via `duo html update`.

**Don't bake brand colours into every page.** Use Atelier palette
tokens (`--paper`, `--ink`, `--accent`) in inline styles. The user's
theme toggle (`theme:set` from a playground) flips the variables;
hard-coded `#ffffff` won't follow.

**Don't auth-prompt-block at startup.** A page that demands the user
fill in a form before any content is visible makes the page useless
until completed. (This anti-pattern is more common in playgrounds —
where forms are interactive — but pages with `<input>` elements that
gate visible content fall into the same trap.)

**Don't write a wall of text and call it a page.** If the artifact
is text-first prose, use the markdown editor instead — that's what
it's for. Pages earn their existence with visual structure (multi-
column, embedded media, styled blocks). When in doubt, ask: would
this read better as a markdown file?

---

## Worked example: a static reference page

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Project Charter — Q3 2026</title>
  <meta name="duo-default-editable" content="false">
  <style>
    :root {
      --paper: #FBF8EE;
      --ink: #1A1410;
      --ink-soft: #3D352A;
      --accent: #C66A2E;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --paper: #1A1611;
        --ink: #F0E9D6;
        --ink-soft: #C8BFA3;
      }
    }
    body {
      margin: 0;
      padding: 48px 32px;
      background: var(--paper);
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      line-height: 1.6;
    }
    main { max-width: 720px; margin: 0 auto; }
    h1 { color: var(--accent); }
    section { margin-bottom: 24px; }
  </style>
</head>
<body>
  <main>
    <h1>Project Charter — Q3 2026</h1>
    <section data-duo-pane="objective">
      <h2>Objective</h2>
      <p>Ship the FTUX-tutorial trio (Stages 27 + 18b + 28).</p>
    </section>
    <section data-duo-pane="status">
      <h2>Status</h2>
      <p>v0.6.0 shipped 2026-05-02.</p>
    </section>
  </main>
</body>
</html>
```

The `data-duo-pane="status"` lets the agent re-paint that region
without touching the rest of the page:

```bash
duo html update --selector '[data-duo-pane="status"]' \
                --html '<h2>Status</h2><p>v0.6.1 in flight (canonical lesson template).</p>'
```

A page like this is enough for many agent-driven artifacts. When you
need the user to CLICK something to drive Duo (open a file, focus a
terminal, fire an event), graduate to a playground via `make-playground`.

---

## Cross-references

- **Add interactivity:** `~/.claude/skills/duo/make-playground.md`
- **Drive an existing page or playground:** `~/.claude/skills/duo/playground-interaction.md`
- **Reference templates:** `~/.claude/skills/duo/examples/canvas-templates/`
  (button-card, paint-target, form-input, lesson-scaffold, dashboard —
  most are playgrounds; lesson-scaffold is the lesson-shaped subset.)
- **Vocabulary:** see CLAUDE.md § Glossary for the canvas / page /
  playground / lesson hierarchy.
