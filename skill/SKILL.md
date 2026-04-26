---
name: duo
description: Interact with the Duo desktop app's workspace surfaces — (1) the live embedded browser (navigate, read page content including Google Docs via the accessibility tree, click, fill, type, screenshot, diagnose via captured console logs), (2) the file navigator (move the tree, list directory contents, reveal a path to the user), (3) the Viewer/Editor column (open local files in a new tab — markdown rich editor, images, pdfs), and (4) the rich markdown editor (read/write the live buffer including the user's selection, set app theme). Use whenever the user asks you to work with whatever is open in Duo's browser pane, read or rewrite a markdown document the user is editing, reference or transform the text they've selected ("summarize the selected paragraph", "shorten this section"), open a local file they're editing, navigate their project, or drive Google Docs / Sheets / Slides / Figma / Notion in a live session.
---

# duo — driving the live browser from a Duo terminal

This skill teaches you to use the `duo` CLI to interact with the browser pane
in the Duo desktop app. When the user asks "summarize the doc open in my
browser", "click the Sign-in button", "add a bullet to the risks section",
etc., **reach for `duo`** — it is the only tool that can read and write the
live authenticated web surface the user is looking at.

## Prefer delegating to the `duo` subagent

Duo workflows tend to fan out into several CLI round-trips (url, title,
wait, ax, verify; or nav state, edit, doc read, doc write, verify). Running
them inline in your context bloats this conversation with CLI noise the
user doesn't need to see, and burns Sonnet/Opus turns on mechanical
orchestration that Haiku can do. Unless the request is a genuine
one-liner ("what URL is open?", "what's selected?"), **delegate to the
`duo` subagent** with a high-level goal and the content (when relevant) —
let it execute and return only the outcome.

The subagent is at `~/.claude/agents/duo.md` (Haiku 4.5). It covers the
full `duo` CLI surface: browser, editor, file navigator, selection,
theme. The orchestrator's job is to draft *what* to do (rewrite text,
URL to extract from, files to scan); the agent applies it.

**Only delegate if you're inside a Duo terminal.** Check first:

```bash
[ -n "$DUO_SESSION" ] && echo in_duo
```

If `DUO_SESSION` is unset, the agent will refuse cleanly anyway, but
checking saves a delegation round-trip. Without `DUO_SESSION`, fall back
to non-`duo` tools (`Read`, `Bash`, `WebFetch`) for this task.

Use this skill's direct CLI reference when the agent isn't available, or
when you're doing a single simple call.

## When NOT to use `duo`

- Public web page with no auth — use `WebFetch`.
- Local files on disk — use `Read`.
- Terminal or shell state — not `duo`'s job.
- Content that's already in your context.

## Sanity check

```bash
duo --version
```

If this fails with `Cannot connect: Duo app is not running`, the app is
closed — ask the user to launch it and retry. If it fails with any
other shape — `Socket error: connect EPERM`, `ECONNREFUSED`, a hang
that ends in `Timeout waiting for response`, or every subsequent `duo`
call failing the same way — jump to
[Troubleshooting: Claude Code sandbox](#troubleshooting-claude-code-sandbox)
below. Do not retry blindly.

## Detecting "I'm in Duo"

Every PTY Duo spawns sets four environment variables, so you can tell
without heuristics whether you're running inside a Duo terminal:

- `DUO_SESSION=1` — presence is the signal.
- `DUO_SOCKET=<path>` — the live socket the `duo` CLI talks to.
- `DUO_VERSION=<x.y.z>` — Duo app version.
- `TERM_PROGRAM=Duo` — alongside the usual `Apple_Terminal`/`iTerm.app`
  values.

Quick check: `[ -n "$DUO_SESSION" ] && echo "in Duo" || echo "not in Duo"`.
If `DUO_SESSION` is unset, you're in a plain shell — `duo` commands will
fail with `Cannot connect: Duo app is not running` (the socket path
isn't being exported). Ask the user to launch Duo, or fall back to
non-`duo` tools (`Read`, `Bash`, `WebFetch`).

## Web routing — Duo by default; configured exceptions go external

Every web URL goes through Duo (`duo open` for a new tab,
`duo navigate` for the active tab) unless its hostname is on a
user-curated exception list at `~/.claude/duo/external-domains.json`.
Hostnames on that list route to the macOS default browser via
`duo external <url>`. The list ships empty; the user populates it with
sites that don't render well in the embedded `WebContentsView` (Claude.ai,
ChatGPT, banking sites, sites that block Electron UAs, anything they
prefer to keep cookied in their hardened personal browser).

Format: `{ "domains": ["claude.ai", "chatgpt.com", "*.banking-corp.com"] }`.
Match on exact hostname or `*.suffix` glob. Empty / missing / malformed
file = no exceptions = everything goes through Duo (the safe default).

You generally don't read this file directly — the `duo` subagent owns
the routing decision. The list exists so PMs running their own Duo can
declare friction sites once and stop fighting them.

## Command reference

| Command | Purpose | Output |
|---|---|---|
| `duo navigate <url>` | Navigate the **active tab** to URL | JSON: `{ok, url, title}` |
| `duo open <path-or-url>` | Open a local file or URL in a **new** tab, activate it. Use for showing the user agent-generated artifacts. | JSON: `{ok, id, url, title}` |
| `duo external <url>` | Open `<url>` in the **macOS default browser** (via Electron's `shell.openExternal`). Used for hostnames listed in `~/.claude/duo/external-domains.json` — sites that don't render well in Duo's embedded `WebContentsView` (Claude.ai, ChatGPT, banking, sites that block Electron UAs). NOT the default route — Duo handles everything not on the list. http(s) and mailto schemes only. | JSON: `{ok, opened}` |
| `duo url` | Current URL | plain text |
| `duo title` | Current page title | plain text |
| `duo text [--selector <css>]` | Visible text (DOM `innerText`) | plain text |
| `duo ax [--selector <css>] [--format md\|json]` | **Accessibility tree** — use for canvas apps | Markdown (default) or JSON |
| `duo dom` | Full page HTML | HTML |
| `duo click <selector>` | Click element | JSON |
| `duo fill <selector> <value>` | Set input value (DOM-level) | JSON |
| `duo focus <selector>` | Focus element (required before `type`/`key` in canvas apps) | JSON |
| `duo type <text>` | Synthesize keystrokes into the focused element | JSON |
| `duo key <name> [--modifiers cmd,shift,alt,ctrl]` | Dispatch a named key (Enter, Backspace, ArrowDown, Home, End, Tab, PageUp/Down, or single letter) | JSON |
| `duo eval <js>` | Execute JS, return its value | JSON |
| `duo screenshot [--out <path>] [--selector <css>]` | PNG (base64 or file path) | path or base64 |
| `duo console [--since <ms>] [--level log,warn,error,...] [--limit N]` | Buffered console events | NDJSON |
| `duo errors [--since <ms>] [--limit N]` | **Uncaught exceptions** (separate ring buffer from `console`; populated by `Runtime.exceptionThrown`). Use this when a click/eval looks fine in `console` but the page actually threw. | NDJSON |
| `duo network [--since <ms>] [--filter <regex>] [--limit N]` | HTTP request lifecycle (URL, method, status, mime, encoded length, error text). `--filter` is a regex against the URL. | NDJSON |
| `duo tabs` / `duo tab <n>` / `duo close <n>` | List / switch / close browser tabs | JSON |
| `duo wait <selector> [--timeout <ms>]` | Wait for element | JSON |
| `duo view <path>` | Open a local file as a new tab in the Viewer/Editor (`.md` → rich markdown editor, image → inline, pdf → native viewer, else → "Open with default app" card). Distinct from `duo open` (browser/URL). | JSON: `{ok}` |
| `duo edit <path>` | Open a `.md` in the rich markdown editor (Google-Docs-feel, TipTap/ProseMirror). Returns `{ok}`. Behaves like `view` for non-`.md` files. | JSON: `{ok}` |
| `duo reveal <path>` | Move the file navigator to `<path>`. A dismissible chip ("Claude moved to …") tells the user why their tree jumped. | JSON: `{ok}` |
| `duo ls [path]` | List a directory's contents. Defaults to the navigator's current folder. | JSON array of `{name, path, kind, size?, mtimeMs?}` |
| `duo nav state` | Current navigator snapshot: `{cwd, selected, expanded, pinned}`. | JSON |
| `duo selection [--pane auto\|editor\|browser]` | Active surface's selection. **Use when the user says "this", "the selected paragraph", "this section", "here".** Default `auto`: prefers a non-empty browser highlight; falls back to the editor's cached selection (still useful when collapsed — caret context). Returns `{kind: 'editor', path, text, paragraph, heading_trail, start, end}` or `{kind: 'browser', url, text, surrounding, selector_path}`, or `null`. | JSON |
| `duo doc read [path]` | Print the active editor's **live buffer** (frontmatter + body, including unsaved edits). Optional path pins the read to a specific file. The body goes to stdout; the path + dirty flag go to stderr (so you can pipe the body straight into a file). | text |
| `duo doc write --replace-selection` | Swap the user's current editor selection with new text (reads stdin or `--text "…"`). For collapsed selection, inserts at caret. Plain text in v1 — use `--replace-all` if you need markdown formatting. | JSON: `{ok}` |
| `duo doc write --replace-all` | Replace the entire document body with new markdown (frontmatter preserved). Use for "rewrite this doc" / "restructure this section" tasks. | JSON: `{ok}` |
| `duo theme [system\|light\|dark]` | Read the current theme (no arg → JSON `{mode, effective}`) or set it. Usually only changed on explicit user request. | JSON |
| `duo selection-format [a\|b\|c]` | Read or set the **Send → Duo** payload format (Stage 15 G19, agent-tunable runtime knob). `a` = quote + provenance (default, human-readable); `b` = literal text only (compact, agent calls `duo selection` for context); `c` = opaque token like `<<duo-sel-abc123>>` (most compact, requires expansion). No arg → JSON `{format}`; with arg → set + persist for the rest of the session. | JSON |
| `duo send [--text "…"]` | Write a payload into the **active terminal's PTY** (no Enter appended — user confirms). Without `--text`, reads stdin. Stage 15 G17: the agent-facing inverse of the Send → Duo button. Use sparingly to plant context for the user (e.g. "you might want to ask me about this"). | JSON: `{ok, written, terminalId}` |

## Patterns

### Transform the user's selected text in the markdown editor

This is the canonical "summarize this / shorten this / rewrite this"
flow when the user has a `.md` file open in Duo's rich editor.

1. Call `duo selection`. If it returns `null`, there's no editor tab
   active — tell the user to open the file with `duo edit <path>` or
   click into the editor first.
2. If `text` is empty, the selection is collapsed at the caret — in
   that case ask the user to select the thing they mean, unless the
   request is clearly about the surrounding `paragraph` or the whole
   section described by `heading_trail`.
3. Do the transform in-process (think, don't tool-call unnecessarily),
   then:

```bash
# Replace the user's selection with the transformed text.
echo "the new text" | duo doc write --replace-selection
```

The selection overlay stays visible even while the terminal has focus
(PRD D29c), so the user can see exactly what range you're operating on.

**Future Stage 15 (not yet shipped):** when the user clicks a
"Send → Duo" button next to a selection (or hits the keyboard
shortcut), the selection is injected into your terminal as a quoted
block plus a one-line provenance ("from /path/to/foo.md · Risks > Market"),
ready for you to read alongside the user's typed verb. The injection
format is itself runtime-configurable via `duo selection-format`:

- `duo selection-format` — print the current format (default `a`).
- `duo selection-format c` — switch to opaque tokens like
  `<<duo-sel-abc123>>` for the rest of the session. Useful when
  you're going to do many transforms in a row and the quoted blocks
  would clutter your context.
- `duo selection-format a` — switch back to the human-readable
  default.

Format `c` requires you to call `duo selection` to read what the
token refers to. Format `a` (default) gives you the text inline plus
a `duo selection` round-trip available if you want richer context
(line range, heading trail).

### Rewrite an entire markdown document

When the user says "restructure this PRD" or "convert this outline into
prose", use `replace-all` so you can emit markdown (headings, lists,
tables). The editor's frontmatter is preserved automatically.

```bash
cat <<'EOF' | duo doc write --replace-all
# Rewritten doc

Your new content here, with **bold**, `code`, lists, tables…
EOF
```

### Open a markdown file for the user to read or edit

```bash
duo edit ~/projects/foo/prd.md
```

Opens in the rich editor with a centered prose column, toolbar, and
auto-discovered frontmatter. Internal links to other `.md` files are
followed as new editor tabs.

### Read or edit a Google Doc

Google Docs renders into a `<canvas>`, so the usual extractors (`duo
text`, `duo dom`) return chrome or empty. The canonical read is `duo
eval` with the same-origin `/export?format=md` fetch — full doc with
formatting:

```bash
duo eval "(async () => {
  const m = location.pathname.match(/\\/document\\/d\\/([^/]+)/);
  if (!m) return 'not on a Doc page';
  const r = await fetch('/document/d/' + m[1] + '/export?format=md');
  return await r.text();
})()"
```

Editing is limited: plain-text insertion via `duo type` works (include
`\n` for paragraph breaks; you do NOT need `duo key Enter`), but `duo
key` chords for formatting (cmd+B, headings, undo, select-all) are
silent no-ops because Docs routes keyboard input through a hidden
iframe CDP can't reach. For format changes, defer to the user or
escalate to the Docs REST API.

For the offline fallbacks (`_docs_annotate_getAnnotatedText`, AX tree
on visible viewport), the full list of canvas traps to avoid (the
`<noscript>` red herring, the `export?format=txt` download trap), and
the keyboard-input limitation in detail, see
[references/google-docs.md](references/google-docs.md).

### Read an ordinary DOM page

```bash
duo navigate "https://example.com"
duo text                      # or: duo text --selector "article"
```

Use `duo text` for classic DOM-rendered pages — it's simpler than `ax` and
plenty accurate.

### Fill and submit a form

```bash
duo fill 'input[name="email"]' "user@example.com"
duo fill 'input[name="message"]' "Hello"
duo click 'button[type="submit"]'
duo wait ".success" --timeout 5000
duo text --selector ".success"
```

### Show the user a local file ("open this PRD", "preview that image")

Use `duo view <path>` to open any local file in the Viewer/Editor column:

```bash
duo view ~/Documents/prd.md       # markdown → rendered preview
duo view /tmp/chart.png           # image → inline preview
duo view ~/tmp/notes.pdf          # pdf → Electron's native viewer
```

The tab uses the filename as its title; the path is in the tooltip. If the
file is already open in a tab, `duo view` activates that tab rather than
creating a duplicate. Unknown types (`.xlsx`, `.mov`, etc.) show a card
with an "Open with default app" button — don't grind; tell the user.

**Never use** `duo open <path>` for local files — that's the browser
command (takes URLs and loads them in a browser tab). Two commands, two
columns:

- `duo open <url-or-path>` → **browser tab** (URLs, HTML artifacts you want
  to render live, file:// URLs when you explicitly want browser rendering).
- `duo view <path>` → **editor/preview tab** (the normal answer for local
  files the user wants to read / edit).

### Navigate the user's file browser ("show me where that lives")

If you've just modified a file and want the user to see it in their
navigator, use `duo reveal`:

```bash
duo reveal ~/Documents/prd.md
```

The navigator jumps to that folder and a chip appears so the user knows
the tree moved because of you. Pair with `duo view` when you want to both
open a file and surface its location.

### Discover files without opening them

```bash
duo ls                          # contents of the user's current nav folder
duo ls ~/Documents              # specific path
duo nav state                   # { cwd, selected, expanded, pinned }
```

Good for deciding what to do next without guessing; cheaper than asking
the user.

### Show the user a generated HTML artifact ("show me X" / "open that")

When the user asks for an interactive prototype, a quick visualization,
or "show me {UI idea}", write the HTML to disk and open it in a new
browser tab with `duo open`. A single command handles path resolution
(absolute, `~/…`, relative) and opens a fresh tab so existing tabs
aren't disturbed.

```bash
# 1. Generate HTML locally
cat > /tmp/countdown.html << 'EOF'
<!doctype html>
<!-- your prototype here -->
EOF

# 2. Open it in a new tab (becomes active)
duo open /tmp/countdown.html
# → { ok: true, id: 2, url: "file:///tmp/countdown.html", title: "Countdown" }

# 3. Interact with it — the new tab is active, so every other duo command
#    targets it automatically:
duo click "#start"
duo eval "document.getElementById('t').textContent"
duo screenshot --out /tmp/countdown.png
```

**Iterating.** Once the artifact is open and the user asks for a
change, rewrite the same file and reload the same tab by re-navigating:

```bash
# rewrite /tmp/countdown.html with the new styles…
duo navigate "file:///tmp/countdown.html"   # targets the ACTIVE tab
```

The active tab is the artifact you just opened, so `duo navigate`
reloads in place — no new tabs accumulate.

**When to use `duo open` vs `duo navigate`:**

- `duo open <path-or-url>` — first load of a new artifact, or any time
  you want a fresh tab. Use this for "show me X" and "open that".
- `duo navigate <url>` — replaces the URL of the currently-active tab.
  Use this for iterating on the prototype in place, or for navigating
  an existing tab to a different page.

`duo open` accepts the same URL schemes as `duo navigate` (http(s),
file, about, data, etc.), plus local file paths with `~/` or relative
paths — path resolution happens client-side.

### Diagnose a failing interaction with the page

If a `duo click` or `duo eval` doesn't produce the expected result, the
page probably logged a warning, threw an uncaught exception, or
returned a non-2xx from an API. Three ring buffers cover those:
`console` (logs + warnings), `errors` (uncaught exceptions, populated
by `Runtime.exceptionThrown`), and `network` (HTTP request lifecycle).
Grab a timestamp before the action so you can scope each one:

```bash
TS=$(date +%s000)
duo click "button.flaky"
sleep 1
duo console --since $TS --level warn,error
duo errors  --since $TS              # uncaught exceptions never reach `console`
duo network --since $TS --filter '/api/'   # XHR/fetch responses + failures
```

Common failure modes and which buffer to check first:
- "Looks like nothing happened" → `errors` (a thrown exception aborts a
  click handler before any `console.error` runs).
- "Spinner forever, no UI update" → `network --filter '/api/'` for 4xx/5xx
  or `failed: true` entries.
- "Page logged something I want to see" → `console`.

Each `network` entry includes `{url, method, status, statusText, mimeType,
encodedDataLength, failed, errorText, startTs, endTs}`. Use the regex
`--filter` to scope to one origin / route — the ring buffer is bounded
(~300 entries), so a noisy SPA can otherwise crowd out the request you
care about.

## Error recovery

When a selector fails:

1. Confirm the element actually exists:
   ```bash
   duo eval "!!document.querySelector('YOUR_SELECTOR')"
   ```
2. Inspect the surrounding DOM:
   ```bash
   duo dom | grep -i "part_of_the_text"
   ```
3. Re-issue `duo focus` immediately before `duo type` — focus is easy to
   lose between commands, especially in canvas apps.
4. For canvas apps, never assume `duo text` captured anything meaningful;
   switch to `duo ax`.
5. Retry transient navigation/timing errors up to three times before
   declaring the operation impossible.

## Troubleshooting: Claude Code sandbox

Claude Code's macOS Seatbelt sandbox blocks Unix-domain sockets by
default, which is the channel `duo` uses. If `duo` calls fail with
`Socket error: connect EPERM` / `ECONNREFUSED`, or hang ending in
`Timeout waiting for response`, **run `duo doctor` first** — don't
retry blindly. It reports socket reachability and TCP-fallback status,
and prints a sandbox-detection line when that's the cause.

For the failure shapes, the two fixes (`allowUnixSockets` in project
settings, or per-call `dangerouslyDisableSandbox` as a last resort),
and why retrying just burns tokens, see
[references/sandbox-troubleshooting.md](references/sandbox-troubleshooting.md).

## The canvas-text trap (why `ax` exists)

```bash
# This will return almost nothing on a Google Doc, even if the doc is huge.
duo text --selector ".kix-appview-canvas"
```

Canvas elements have no text children. Google Docs, Sheets, Slides, Figma,
and newer Notion surfaces all fall into this pattern. If a page looks rich
but `duo text` returns a short string or chrome-only content, assume canvas
rendering and retry with `duo ax`.

## Version compatibility

This skill targets `duo` v0.1.x. Run `duo --version` and verify the
major/minor match before trusting complex patterns.
