---
name: playground-interaction
description: Open, read, and drive an existing HTML page or playground in Duo from the CLI. Use when the user asks to open an HTML file they have, read what is on a page or playground they are looking at, repaint a region of a running playground, subscribe to user clicks, or debug why a playground button is not firing or events are not arriving. For CREATING a page or playground from scratch, reach for `make-page` / `make-playground` instead.
---

# Interacting with pages and playgrounds in Duo

> How to OPEN a local HTML file in Duo, READ what is on a page or
> playground, and DRIVE a running playground — paint into it, query its
> DOM, and react to user clicks. This is the **consumer** companion to
> `make-page.md` (author a static page) and `make-playground.md`
> (author an interactive playground); reach for those when the user
> wants to CREATE markup, this file when they want to OPEN, READ, or
> DRIVE markup that already exists.

## Contents

- [Vocabulary](#vocabulary)
- [Decision tree — author or interact?](#decision-tree--author-or-interact)
- [Opening a local HTML file](#opening-a-local-html-file)
- [Reading what is on a page](#reading-what-is-on-a-page)
- [Driving a running playground](#driving-a-running-playground)
- [Reacting to user clicks (`duo events --follow`)](#reacting-to-user-clicks-duo-events---follow)
- [Debugging — when a playground is not behaving](#debugging--when-a-playground-is-not-behaving)
- [Safety](#safety)
- [What you do NOT need to know](#what-you-do-not-need-to-know)
- [Cross-references](#cross-references)

---

## Vocabulary

The **canvas** is the right pane — a type-agnostic slot. What you read
and drive here is one of:

- A **page** — basic HTML in canvas mode: source-editable, `<script>`
  tags inert, action buttons fire. Reached via `duo edit <path>`.
- A **playground** — HTML in browser mode: scripts run, buttons fire,
  form inputs work like a real web page. Reached via `duo open <path>`.
- A **lesson** — a playground plus a paired guide skill.

See `make-playground.md` for the full breakdown.

---

## Decision tree — author or interact?

| What the user asked | Right skill |
|---|---|
| "Open today's notes" / "show me that HTML I made" | **interaction** (this file) — `duo open` / `duo edit` |
| "Read what's in the welcome page" | **interaction** — `duo html query` / `duo html get` |
| "Add a Save button to this page" | **`make-playground`** — add markup with action verbs |
| "Build a tutorial playground with three steps" | **`make-playground`** — pick a template + author content |
| "Build me a lesson on X" | **`make-playground`** — playground + paired lesson-skill |
| "Update the result pane with what I just computed" | **interaction** — `duo html set --selector` |
| "Why isn't the button firing?" | **interaction** — debug routing + trust gate + console |
| "Watch for clicks on the lesson playground" | **interaction** — `duo events --follow` |
| "What action verbs can I add to a button?" | **`make-playground`** — vocabulary cheat sheet |

In a single session you might cross between modes (a user opens a
playground you authored, asks you to drive it, then asks you to extend
it). The skills assume you can read each other.

---

## Opening a local HTML file

**Modality is verb-driven.** The same HTML file opens in a different
surface depending on the verb you use:

```bash
duo open ~/notes/today.html      # browser mode — scripts run, buttons fire
duo edit ~/notes/today.html      # canvas mode — source-editable, scripts inert
```

- **`duo open <path>` → browser mode** (`kind: 'browser'`). The file
  loads as a `file://` URL in a browser tab. Native form inputs, links,
  and `<script>` tags all run. This is the default for "show me the
  thing" — anything interactive (tutorials, dashboards, playgrounds).
- **`duo edit <path>` → canvas mode** (`kind: 'page'`). The file mounts
  in an HTML canvas tab: source-editable, `<script>` tags inert,
  `data-duo-action` buttons still fire. This is the default for "let me
  modify the source."

### Forcing the other surface

When you need to override the verb's default:

```bash
duo open --canvas ~/notes/today.html    # open, but in canvas mode
duo edit --browser ~/notes/today.html   # edit-intent, but render in browser mode
```

You can also right-click a `file://` browser tab and choose
"Edit in canvas" to flip a running tab into canvas mode.

> Legacy note: an older `<meta name="duo-open-in">` declaration in a
> file's `<head>` is no longer consulted — modality is chosen entirely
> by the verb (and the `--canvas` / `--browser` overrides). Any such
> meta tag is harmless but ignored.

---

## Reading what is on a page

### `duo html query <css-selector>`

List elements matching a CSS selector inside the active canvas. Returns
an array of `{id, tag, text, classes}` (text truncated to ~200 chars —
use `get` for full content). Cheap discovery — use it when you don't
yet know what is on the page.

```bash
duo html query "[data-duo-action]"
# every action-bearing element

duo html query "[data-duo-pane]"
# every paint-region — use these as targets for `duo html set`
```

### `duo html get --id <duo-id>` (or `--selector <css>`)

Read one element's `outerHTML` + `textContent`. Returns
`{id, tag, html, text}`. Good for "what does the user see in pane X
right now."

```bash
duo html get --id lesson-step-1-cta
duo html get --selector '[data-duo-pane="result"]'
```

### `duo selection`

What the user has selected in the active surface. The canvas variant
returns `{kind:'page', path, text, html, anchorId, anchorPath, range,
surrounding}` — `anchorId` is the nearest `data-duo-id` ancestor of the
selection, which makes "extend the section the user has highlighted"
trivial. `duo selection` also reveals the active page's `path`, which
you need for the trust-gate check in the debugging section below.

### `duo status` vs `duo nav state`

- `duo status` lists the **open tabs** (path, kind, dirty flag) — use
  it to confirm which page is active before driving it.
- `duo nav state` returns the **file-tree** state
  (`{ cwd, selected, expanded, pinned }`), NOT open tabs.

---

## Driving a running playground

### `duo html set` — paint into a region (replaces innerHTML)

The single most useful agent-side verb for tutorials, dashboards, and
lesson runners. Replaces the `innerHTML` of the matched element. Target
by `--id` or by `--selector`; supply content via `--content` or pipe it
on stdin.

```bash
duo html set --selector '[data-duo-pane="lesson-body"]' \
             --content '<p>Here is what I found …</p>'

# by id, content piped on stdin:
echo '<p>Updated.</p>' | duo html set --id result-pane
```

Pair a stable `data-duo-pane` (or `data-duo-id`) region with this verb
and you get an idempotent paint surface: the agent runs, repaints with
new content, and the user sees the update without a tab reload.

### `duo html replace` — swap an element (replaces outerHTML)

Replaces the matched element **itself** (its `outerHTML`), not just its
children. Target by `--id` or `--selector`; content via `--html` or
stdin.

```bash
duo html replace --id status-badge \
                 --html '<span id="status-badge" class="ok">Done</span>'
```

> `set` replaces *what is inside* an element; `replace` swaps *the
> element itself*. There is no `duo html update` verb — use `set` for
> innerHTML-style paints and `replace` for outerHTML swaps.

### Other `duo html *` mutators

- `duo html append --parent <duo-id> --html "<…>"` — append a new child
  to a parent element.
- `duo html remove --id <duo-id>` (or `--selector <css>`) — delete an
  element.
- `duo html attr --id <duo-id> [--set k=v …] [--remove k …]` — modify
  attributes (`--set` / `--remove` repeat).

### `duo html click` — fire an action programmatically

`duo html click --id <duo-id>` (or `--selector <css>`) triggers the
canvas-action dispatcher exactly as a real user click would:
`data-duo-action` verbs fire, events emit, downstream paint ops run.
Used by lesson fly-through harnesses to walk a playground without manual
clicking. Returns `{id, tag}`.

### Comments on a page

`duo html comment --id <duo-id> --body "…"` writes a comment thread
anchored to the nearest `data-duo-id` ancestor of the target (anchor via
`--id`, `--selector <css>`, or `--text "<substring>"`; body via flag or
stdin). It does NOT modify the page's HTML — threads live in
`<file>.duo.json § comments[]`. `duo html comments` lists threads in
document order.

Useful when the user asks you to "leave a note here for later" without
cluttering the page itself.

---

## Reacting to user clicks (`duo events --follow`)

When a playground has `data-duo-action="duo:event"` buttons, clicks emit
structured events into Duo's in-process bus. Subscribe:

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

Cursor format: `<unix-ms>-<seq-within-ms>`. The bus keeps a 200-event
ring; older events are evicted.

### Common patterns

**Lesson runner:**

```bash
duo events --follow | while IFS= read -r line; do
  case $(jq -r '.event.name // empty' <<< "$line") in
    "lesson-step-1-next")
      duo html set --selector '[data-duo-pane="body"]' \
                   --content '<p>Step 2 — install the CLI…</p>'
      ;;
    "lesson-step-2-done")
      duo html set --selector '[data-duo-pane="body"]' \
                   --content '<p>You finished!</p>'
      ;;
  esac
done
```

**Form-collected onboarding:**

```bash
duo events --follow | while IFS= read -r line; do
  if [[ $(jq -r '.event.name' <<< "$line") == "user-introduced" ]]; then
    name=$(jq -r '.event.payload.value' <<< "$line")
    duo html set --selector '[data-duo-pane="greeting"]' \
                 --content "<p>Hello, $name. Let's begin.</p>"
  fi
done
```

For a long-running lesson that needs many subscribers, hand the watch
loop to a Task subagent so the main session's context window stays clean.

---

## Debugging — when a playground is not behaving

### "I clicked a button and nothing happened"

Reasons in order of likelihood:

1. **Wrong surface for what the button does.** A `<script>`-driven
   button only runs in **browser mode** (`duo open`). If the file was
   opened with `duo edit` (canvas mode), its `<script>` tags are inert —
   only `data-duo-action` buttons fire there. Confirm the tab's `kind`
   with `duo status`; reopen with `duo open` if the button needs real
   JavaScript.

2. **Trust gate.** `data-duo-action` verbs only fire when the page's
   path is under `~/.claude/duo/`. Pages authored elsewhere stay inert.
   Confirm the path with `duo selection` (its response includes the
   page's `path`) and check whether it is under that trust root.

3. **Editable mode is ON.** In canvas mode, when a page is editable (the
   default), clicking lands in `contentEditable` and places a cursor
   instead of firing the action. Look at the page's toolbar — if you see
   "Edit" and not "Read-only," the user is in editable mode. Tell them to
   flip via the toolbar, or author the page with
   `<meta name="duo-default-editable" content="false">`.

4. **Markup typo.** `data-action` ≠ `data-duo-action`. The runtime only
   listens for the duo-prefixed attribute. `duo html query
   "[data-duo-action]"` lists every action button the runtime sees; a
   missing button means it is mis-attributed.

### "The agent isn't seeing my events"

- Confirm the page is under the trust root (same trust gate as buttons).
- Confirm `duo events --follow` is actually subscribed —
  `duo events --limit 5` should show recent events from the ring. If the
  ring is empty after clicks, the page runtime is not reaching the bus
  (report it with the page's path + the click target's `outerHTML`).
- Confirm the event name matches what your subscriber's `case` statement
  is looking for. Names are exact-match in the bus.

### "`duo html set` doesn't paint"

- Verify the selector matches: `duo html query "<sel>"` should return ≥ 1
  hit. Zero hits means your selector is wrong; the paint would silently
  no-op without the query check.
- The active page matters. If the user has two canvas/browser tabs open,
  `duo html *` operates on the active one. `duo status` (or
  `duo selection`) confirms which is active.

---

## Safety

**Safety — never circumvent the user's controls.** Duo may run on a
managed or corporate Mac. Never enable `duo browser-mode unfiltered`,
`dangerouslyDisableSandbox`, or any host / IT / sandbox control to work
around a block on the user's behalf — surface the block to the user and
stop. Never send the user's files, credentials, or page contents to an
external destination. When a `duo` call is blocked or hangs, run `duo
doctor` to diagnose and report the cause; do not bypass it.

---

## What you do NOT need to know

- **The action-verb vocabulary** — that is an authoring concern. If the
  user asks you to add a verb to a page, switch to `make-playground.md`.
- **The `data-duo-id` naming convention** — same; authoring.
- **How to write a `<meta name="duo-default-editable">` block** — same;
  authoring.

When in doubt: if the task involves writing markup, you are authoring
(`make-page.md` / `make-playground.md`). If it involves running CLI verbs
against an existing page, you are interacting (this file).

---

## Cross-references

- `make-page.md` — author a basic page (static HTML in the canvas).
- `make-playground.md` — author an interactive playground (action
  vocabulary, templates, anti-patterns) and lessons.
- `playground-interaction.md` — this file: OPEN / READ / DRIVE an
  existing page or playground.
- `skill/SKILL.md` § Command reference — `duo html *`, `duo open`,
  `duo edit`, `duo events`, `duo selection`, `duo status`.
