# Example: Authoring in the HTML canvas (Stage 17a)

**Status:** Stage 17a is the render + edit primitive. The full agent
write surface (`duo html query / get / set / replace / append / remove
/ attr / comment`) lands in 17b/c. Until then, the agent's CLI levers
are limited to:

- `duo html new <path.html> [--title "…"]` — create a new file from
  boilerplate and open it in the canvas.
- `duo edit <path.html>` — open an existing `.html` file in the canvas.
  Same dispatch as `duo view` (extension-based).
- `duo open <path.html>` — opens in the **browser**, not the canvas.
  Use this for one-shot artifact previews where you don't need to
  edit (countdown timers, throwaway visualizers, etc. — see
  `iterate-artifact.md`).

## When to use the canvas vs the browser

| Goal | Use |
|---|---|
| Show the user a one-shot interactive HTML page | `duo open` (browser) |
| Hand the user a Q2 status report they'll edit + save + share | `duo html new` (canvas) |
| Polish prose inside an HTML doc | `duo edit foo.html` (canvas) |

The canvas writes back clean HTML; another tool (browser, GitHub,
email attachment) opens it without any Duo dependency.

## Scope of 17a

What works:
- The page renders inside a sandboxed iframe.
- The body is `contentEditable` — typing + selection works like a
  rich-text doc.
- Toolbar buttons + keyboard shortcuts: bold (⌘B), italic (⌘I),
  underline (⌘U), strikethrough, inline code, link picker (⌘K).
- Autosave (~800 ms after the last edit) + ⌘S + dirty dot in the tab
  strip.
- Save serializes the iframe's DOM back to disk as-is. Whitespace,
  attribute order, and quote style may shift on first save vs the
  source file (pretty-printer ships in 17b/e).

What's deferred:
- **Stable IDs / `data-duo-id`** (17b) — agent-side `set` / `replace`
  by element id.
- **Sidecar `.html.duo.json`** (17b) — comments, recent-edits log,
  scripts.allowed flag.
- **Agent overlay** — Atelier "just-added" highlight on `duo html
  set/replace` (17c). Until then, edits land silently from the user's
  perspective.
- **Send → Duo pill** on the canvas (17c). The pill ships on the
  markdown editor + browser pane today; canvas joins them once the
  selection observer is wired.
- **Comments** + **lock convention** (17d).
- **Scripts** (17e) — inline `<script>` and event handlers are
  preserved on disk but inert in the canvas. The script-opt-in dialog
  (PRD H8) gates execution per file.
- **Source view** (17e) — CodeMirror toggle for power users / agent
  debugging.
- **Slash menu / component snippets** (17e).

## Don't lean on conventions yet

The Stage 17 PRD's authoring conventions (`data-duo-component`
tagged snippets, `data-duo-lock="structure"` on body grids, the
ten H18 component snippets) are 17d work. Until they ship, write
plain HTML the way you'd hand-author it — clean tags, semantic
hierarchy, no Duo-specific markers. The canvas accepts arbitrary
HTML by design (PRD H2), so nothing here will break in 17a, but
features that key off the conventions (locked regions, snippet
recognition) won't fire either.

## Round-trip test

```bash
duo html new /tmp/q2-status.html --title "Q2 Status"
# → { ok: true, path: "/tmp/q2-status.html" }
# Canvas opens with <h1>Q2 Status</h1><p></p>.

# (no agent CLI for editing in 17a; the user types in the canvas.)

cat /tmp/q2-status.html
# → clean HTML; Duo-specific attributes are NOT sprinkled into the
#   markup until 17b ships data-duo-id injection.
```
