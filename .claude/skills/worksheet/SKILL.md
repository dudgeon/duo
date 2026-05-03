---
name: worksheet
description: Generate a single-page interactive HTML worksheet for the user — items + per-item radio + textarea + sticky footer with Copy results / Send to Claude / Clear saved. Schema-driven; consumers (smoke-walk, sprint-plan, future retros / triage forms) just author a JSON manifest and feed it through generate.mjs. Use when you need structured, parseable feedback from the user that round-trips back into the conversation without you having to invent the UI each time.
---

# worksheet skill — Duo

> **Why this skill exists.** The smoke-walk skill proved the round-trip
> pattern: agent generates an interactive HTML page, user fills it in,
> a structured text payload comes back. We've extracted the shared
> chrome (item layout, controls, persistence, copy-and-send footer,
> Atelier styling, backtick-and-path-link rendering) into this skill so
> the *next* consumer (sprint-plan, retros, triage, prioritization) is
> a JSON manifest, not a parallel ~700-line HTML generator.

## When to reach for a worksheet

A worksheet is the right primitive whenever you need the user to
respond to **N items** with **a structured per-item answer + free
notes**, and you want the response back in a parseable form. Examples:

- **Smoke walk** — pass/fail/skip per shipped item.
- **Sprint planning** — priority (P0/P1/P2/skip) per backlog candidate.
- **Retro** — kept/changed/dropped per practice.
- **Triage** — accept/defer/wontfix per filed bug.
- **Compare designs** — pick A/B/C/none per option, with notes.

If you only need a single yes/no, ask in chat. If the items don't
share a control kind, build separate worksheets. If the user needs
to author the items themselves (not just rate them), you're past
worksheet — that's a markdown editor.

## Two consumption modes

1. **Copy-paste back** — user clicks "Copy results", text lands on the
   clipboard, user pastes into the Claude session. Works everywhere.
2. **Send to Claude (preferred when the user is in Duo)** — user clicks
   "Send to Claude", the text routes directly into the active Duo
   Claude terminal via `window.duoSendResult(text, { worksheet })`.
   No paste step. Falls back to clipboard automatically if the binding
   isn't wired (older Duo build, page opened outside Duo, etc.).

The worksheet HTML emits BOTH buttons unconditionally. The user picks
based on context. Don't try to detect the mode and hide a button — the
detection happens at click time, in JS, with a clear fallback.

## Authoring procedure

### 1. Build a manifest

Write a JSON file. Standard location for repo-local worksheets:
`docs/dev/worksheets/<name>.json` (gitignored by default unless the
worksheet is a recurring one). Schema:

```json
{
  "kind": "sprint-plan",
  "name": "sprint-plan-v0.6.5",
  "version": "0.6.5",
  "date": "2026-05-04",
  "title": "Sprint plan · v0.6.5",
  "intro_html": "<p>...</p>",
  "controls": {
    "primary": {
      "kind": "radio",
      "name": "priority",
      "options": [
        { "value": "P0", "label": "P0", "color": "#b13e3a" },
        { "value": "P1", "label": "P1", "color": "#c46a1c" },
        { "value": "P2", "label": "P2", "color": "#4a7d3e" },
        { "value": "SKIP", "label": "Skip", "color": "#6f6557" }
      ]
    },
    "secondary": {
      "kind": "textarea",
      "name": "notes",
      "placeholder": "Notes (optional)",
      "rows": 2
    },
    "mark_all": { "label": "Mark all P1", "value": "P1" }
  },
  "result_format": {
    "header_template": "SPRINT PLAN v{version} ({date})",
    "summary_label": "TOTAL"
  },
  "items": [
    {
      "id": "BUG-074",
      "title": "ENH-078 light-mode contrast regression",
      "subtitle": "🟡 from active-sprint.md FAIL",
      "what_fixes": "Light-mode text-zinc-50 on cream paper background is illegible.",
      "steps": ["Open the FAQ in light mode", "Confirm Sprint header is readable"]
    }
  ],
  "misc_notes": {
    "title": "Other notes",
    "help": "Anything else worth flagging?",
    "result_block_title": "OTHER NOTES"
  }
}
```

### Schema reference

**Top-level fields:**

| Field | Required? | Purpose |
|---|---|---|
| `kind` | optional | Free-form label for the worksheet kind (`smoke-walk`, `sprint-plan`, etc.). Used as the default header line and CSS class hint. |
| `name` | **required** | Globally unique worksheet name. Used as the `localStorage` key, so re-generating the same `name` restores the user's in-progress state. |
| `version` | optional | Displayed in the header; substituted into `result_format.header_template`'s `{version}` slot. |
| `date` | optional | Displayed in the header; substituted into `{date}`. |
| `title` | optional | `<h1>` text. Defaults to `name`. |
| `intro_html` | optional | HTML blob shown above the items. Use sparingly — the page is the spec. |
| `controls` | **required** | See below. |
| `result_format` | optional | Header template + summary label for the Copy / Send output. |
| `items` | **required** | Array of items. Each needs `id` + `title`. |
| `misc_notes` | optional | If present, a free-form "Other notes" textarea below the items. |

**Controls schema:**

- `controls.primary` — the radio group. Required. Kind: `radio`. Each option needs `value` + `label`; `color` is optional but recommended (CSS color string applied when checked).
- `controls.secondary` — the per-item textarea. Optional. Set `rows` (default 2) and `placeholder`.
- `controls.mark_all` — optional default-button. `{label, value}`. Renders a footer button that bulk-applies the value to every un-answered item.

**Per-item fields:**

| Field | Required? | Purpose |
|---|---|---|
| `id` | **required** | Stable identifier (BUG-074, T1, opt-A). Used in the result block + as a DOM data attribute. |
| `title` | **required** | One-line headline. |
| `subtitle` | optional | Italic subtitle line below the title. Good for source-of-record badges ("from active-sprint.md FAIL"). |
| `what_fixes` | optional | Short description (1-2 sentences) — what the item *means* and what success looks like. |
| `steps` | optional | Array of strings. Rendered as a numbered list. Backticks pulled out as Copy buttons (commands) or inline code (short tokens); `~/foo` and `/Users/...` paths get clickable `data-duo-path` links. |
| `body_html` | optional | Pre-rendered HTML escape hatch when `subtitle/what_fixes/steps` aren't expressive enough. The string is inserted verbatim — escape your input. |

### 2. Generate the HTML

```bash
node .claude/skills/worksheet/generate.mjs \
  docs/dev/worksheets/<name>.json \
  docs/dev/worksheets/<name>.html
```

Or programmatically:

```javascript
import { generateWorksheet } from '.claude/skills/worksheet/generate.mjs'
const html = generateWorksheet(manifest)
```

### 3. Open in Duo's browser pane

```bash
duo open docs/dev/worksheets/<name>.html
```

The browser pane is required — clipboard.writeText doesn't work in
canvas sandboxes. The worksheet declares `<meta name="duo-open-in"
content="browser">` to force this.

### 4. Hand off to the user

Brief, no elaboration:

> Worksheet **{title}** is open as a browser tab. Click each item, fill
> in the controls, then **Send to Claude** (or **Copy results** + paste
> back) when done.

### 5. Parse the user's response

The result text follows this exact shape:

```
SPRINT PLAN v0.6.5 (2026-05-04)
===============================

[P0] BUG-075 — Phase 3b chord regression
  Notes: Right-click + CLI work, but ⌘\ ignored

[P1] BUG-074 — ENH-078 light-mode contrast

[SKIP] ENH-085 — Split View aux header right-click parity

TOTAL: 1 P0, 1 P1, 1 SKIP (3 total)

OTHER NOTES
-----------
Worth thinking about a `duo dev autosave-delay` knob for testing.
```

**Format invariants the parser depends on:**

- Header: `<HEADER_TEMPLATE-substituted>` then `===` rule of equal length.
- Each item: blank line, then `[<value>] <id> — <title>`. Optional
  `  Notes: <text>` lines (indented 2 spaces; multi-line notes use
  `\n  Notes: ` per line).
- Footer: `<SUMMARY_LABEL>: <count> <value>, ... (<TOTAL> total)`.
- Optional `<MISC_RESULT_BLOCK_TITLE>` block at the bottom (`---` rule
  + free text). Only present when the misc-notes textarea was filled.

Match items by `id` + `value`; ignore extra whitespace; treat the
misc block as observation-only (file paper-cuts as their own
follow-ups; don't try to PASS/FAIL it).

## Send to Claude — what the binding contract looks like

Worksheets call:

```javascript
window.duoSendResult(text, { worksheet: NAME })
```

The Duo main process is responsible for:

1. Exposing the binding via the CDP injector pattern (parallel to
   `duoOpenPath` in `electron/cdp-bridge.ts`).
2. Routing the `text` argument to the active Claude terminal session
   (the same plumbing `duo send` uses; the option to `--enter` is
   implicit — Send to Claude submits on the user's behalf, by design).
3. Resolving when delivery is confirmed; rejecting if no Claude
   session is active (the worksheet falls back to clipboard with
   a "no Duo binding" hint).

If the binding isn't wired in the user's Duo build, the worksheet
falls back to clipboard.writeText and tells the user to paste back.
That keeps Send-to-Claude a progressive enhancement: the worksheet
ships today and starts working better as the binding lands.

## File layout

- `.claude/skills/worksheet/SKILL.md` — this file.
- `.claude/skills/worksheet/generate.mjs` — schema-driven generator.
  Default-export `generateWorksheet(manifest) → string`; CLI
  entrypoint when invoked directly.
- `docs/dev/worksheets/<name>.json` — manifest (gitignored unless
  the worksheet is a recurring one Geoff wants to keep).
- `docs/dev/worksheets/<name>.html` — generated page (gitignored).

## Authoring tips

**Concrete > generic** in item titles + steps. Bad: "test the new
context menu." Good: "right-click whitespace below the file rows in
the navigator; expect only New file / New folder / Open terminal here
/ Reveal in Finder."

**One concept per item.** A combined item forces a single rating for
multiple things. Split them.

**Highest-priority items first.** The user is fresh at the top of the
list; attention drifts as they go. Order matters.

**Use backticks for runnable commands.** `` `npm run dev` `` becomes a
copyable code block. Plain prose with embedded commands forces
hand-typing.

**Use `~/...` and `/Users/...` paths inline.** The renderer wraps
them in `<a class="duo-path-link" data-duo-path="...">` so the user
can click to open the file in Duo (via the existing CDP path-link
forwarder).

**The manifest IS the spec.** Vague items lead to vague responses.
Spend the time on the manifest; it's where the value is.
