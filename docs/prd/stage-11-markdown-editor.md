# Stage 11 PRD — Collaborative markdown editor (human↔agent)

> **Status:** spec drafted 2026-04-24. 11a shipped 2026-04-24. Visual
> spec for 11c (just-added highlight) and 11d (track changes) added
> 2026-04-26 from the Atelier mock.
> **Sub-stages promoted (2026-04-26):** the original 11b/c/d/e
> sub-stages were promoted to top-level stages during the layered
> build-order rationalization, since they're independent ships with
> different priorities and dependencies:
> - **11b** (external-write reconciliation) → **Stage 16**
> - **11c** (just-added highlight + warn-before-overwrite) → **Stage 13**
> - **11d** (CriticMarkup track-changes + comments) → **Stage 14**
> - **11e** (outline + find + polish) → **Backlog**
> - 11a tail items (frontmatter panel, drag-drop, slash menu) → Backlog
>
> Decision sections (D1–D33) below remain authoritative. § 6 still
> describes the work using the original 11a–e labels — read each
> sub-section as the spec for its new top-level Stage.
> **Supersedes:** the ROADMAP "Stage 11" outline — see the roadmap for
> top-level stage sequencing; decisions here are authoritative for
> the editor surface specifically.
> **References:**
> - [docs/VISION.md § The flagship bet — the reading and writing pair](../VISION.md)
> - [docs/DECISIONS.md § Layout model + working-pane model](../DECISIONS.md)
> - [docs/prd/stage-10-file-navigator.md](stage-10-file-navigator.md) — WorkingPane shell, `duo-file://`, per-type registry
> - **[docs/design/atelier/](../design/atelier/)** — visual specs for
>   11c (just-added highlight) and 11d (Suggesting / Accepted track-
>   changes modes). The 16-second demo loop in
>   [Duo Prototype.html](../design/atelier/project/Duo%20Prototype.html)
>   shows both, and the Tweaks panel toggles between them. The
>   editor's serif body voice + page width come from Atelier too;
>   read [the bundle README](../design/atelier/README.md) before
>   touching the editor surface.
> - [CriticMarkup spec](http://criticmarkup.com/spec.php) — `{++ins++}`, `{--del--}`, `{~~old~>new~~}`, `{==hl==}`, `{>>comment<<}`
> - [CommonMark](https://spec.commonmark.org/) + [GFM](https://github.github.com/gfm/)

---

## 1. What we're building

A **world-class markdown document editor** that lives as an `editor` tab
type in the WorkingPane, with a **Google Docs–quality human experience**
while persisting **pure `.md`** on disk. Any agent — Claude Code inside
a Duo terminal, a remote CI job, `cat` — can read and rewrite the file
without a translation layer.

Three commitments that set the bar:

1. **Visual-first editing, no decorations toggling.** We do NOT render
   markdown syntax chars (`#`, `*`, `_`, `|`) inline and ask the user
   to see through them. Typing `# ` becomes a real H1 node; typing
   `**bold**` becomes a real bold mark; typing `|` drops into a real
   table. Obsidian-style "show the markdown under your cursor"
   decorations are explicitly rejected (see D2).
2. **Two-way agent surface.** The agent isn't pasting into a text box —
   it reads the live in-memory doc, inserts comments anchored to spans,
   and writes edits that land in the editor with a visible "just
   changed" highlight (transient, not CriticMarkup) or as
   track-changes insertions (persistent, if the toggle is on).
3. **Pure open formats.** `.md` body + GFM tables + CriticMarkup for
   annotations + YAML frontmatter for doc-level metadata + a sibling
   `<file>_assets/` folder for images. Every byte is legible to any
   markdown tool. The only Duo-specific convention is a human-readable
   `[author · ts]` prefix inside CriticMarkup comments — still
   spec-compliant text.

**Out of scope for v1** (D30): real-time multi-user collaboration,
math (KaTeX), Mermaid/diagram rendering, PDF/HTML export, wikilinks +
backlinks, `.docx`/`.pdf` import.

---

## 2. Personas + jobs to be done

**Primary persona:** the same PM from VISION — writes drafts, reviews
what the agent wrote, leaves comments, uses Find & Replace, expects
the file to open cleanly in GitHub, Obsidian, or `cat` later.

Jobs this stage does:
- "Let me write a PRD with headings, tables, and comments, the way I
  would in Google Docs."
- "When Claude rewrites a paragraph, show me exactly what changed and
  let me accept or reject it."
- "When I ask Claude a question about this paragraph, let me do it
  *in* the paragraph, not by copy-pasting into the terminal."
- "Save as real markdown so I can drop the file into a GitHub PR
  without a conversion step."

Jobs this stage does NOT do:
- Multi-user live collab (single-user editing; D30).
- Render math / Mermaid (D30).
- Replace Google Docs. Google Docs tabs stay as browser tabs
  (`/export?format=md` read path already shipped in Stage 3).

---

## 3. Resolved decisions

| # | Area | Decision |
|---|---|---|
| **Framework** | | |
| D1 | **Editor core** | **TipTap** on top of ProseMirror. ProseMirror schema is rigid but gives us: tables (`@tiptap/extension-table`), node-accurate undo, and a mature plugin ecosystem for comments and suggestions. We accept the tradeoffs: markdown is not the in-memory model, so we own the serializer; tables beyond GFM round-trip lossily (see D12). |
| D2 | **No decoration-toggling model** | We do NOT render raw markdown syntax (`#`, `**`, `|`) inline with styled decorations that flip between "styled" and "exposed" modes. All structural markdown converts to real editor nodes. Typing `**bold** ` collapses to a bold mark; the asterisks vanish. This is the single biggest UX differentiator from Obsidian-style editors. |
| **Canvas + typography** | | |
| D3 | **Canvas shape** | Centered column, max-width ~720px (widen toggle to ~960px for table-heavy docs). Generous side padding. Neutral serif-ish default body; sans-serif headings. User-configurable theming deferred to Stage 12 (Atelier visual). |
| D4 | **Tab placement** | `editor` tab type in the unified WorkingPane tab strip (see [DECISIONS.md § Layout](../DECISIONS.md)). Browser, editor, and preview tabs coexist in one strip. Same file can appear as both an editor tab and a rendered-preview tab. |
| **Toolbar + input** | | |
| D5 | **Toolbar layout** | Fixed top bar + contextual floating bubble. Top bar: heading-level picker, B / I / U / S, inline code, link, bullet list, numbered list, task list, blockquote, code block, horizontal rule, insert table, insert comment, track-changes toggle, find & replace. Floating bubble appears on selection with the same inline marks + "comment on this" + "convert to…" group. Table-row/column controls appear contextually when the cursor is in a table cell. |
| D6 | **Markdown input rules** | Active. `# ` → H1 (up to `######` → H6), `- `/`* ` → bullet list, `1. ` → ordered list, `- [ ] ` → task list, `> ` → blockquote, ```` ``` `` ```` → code fence (with language hint prompt), `---` on empty line → hr, `[text](url)` → link, `**x**`/`*x*`/`_x_`/`` `x` `` → bold / italic / italic / inline code. Typing `|` at line start enters table-builder mode (D12). |
| D7 | **Slash menu** | `/` at line start opens a command palette: heading 1–6, bullet list, numbered list, task list, blockquote, code block, table, image, link, divider, comment, footnote, inline footnote. Filter-as-you-type. |
| D8 | **Keyboard shortcuts** | Google-Docs-parity set: `⌘B` / `⌘I` / `⌘U` / `⌘⇧X` (strike) / `⌘E` (inline code), `⌘K` (link picker), `⌘⌥0..6` (paragraph / H1–H6), `⌘⇧7` / `⌘⇧8` (numbered / bullet list), `⌘⇧9` (task list item), `⌘⇧C` (new comment), `⌘/` (toggle track-changes — document scope), `⌘F` (find), `⌘⌥F` (find & replace), `⌘Z` / `⌘⇧Z` (undo / redo). |
| D9 | **Paste handling** | URL pasted on selection → link. HTML clipboard → sanitized + converted to markdown (Turndown with custom rules for tables + task lists). Rich-text from Google Docs / Notion → markdown. Tabular paste from Sheets / Excel → GFM table (or HTML table if the source has merged cells). Image on clipboard → copied into the asset folder and inserted (D13). Plain text → plain text. |
| **Content features** | | |
| D10 | **Core markdown set (v1)** | H1–H6, bold, italic, strike, inline code, fenced code blocks with syntax highlighting (Shiki; language picker inside the block), blockquote, bullet + ordered + task lists (arbitrarily nested), horizontal rule, links, images, tables. |
| D11 | **Beyond-core (v1)** | Task lists (`- [ ]`), footnotes (`[^1]`), syntax-highlighted fenced code. KaTeX math, Mermaid, callouts — deferred. |
| D12 | **Tables** | GFM pipe tables by default. Features GFM can't express (merged cells, block content in cells, multiline paragraph cells) emit a raw `<table>` HTML block — still valid markdown, downstream renderers vary. Table editing UX: keyboard — `Tab` / `Shift-Tab` next/previous cell, `Enter` new row at end, `⌘⌫` delete row; UI — floating row / column handle on hover. |
| D12a | **Table contextual toolbar** | When the cursor is inside a table cell, a small contextual toolbar appears (either as a floating pill above the table or a section of the top toolbar that swaps in). Actions: **insert row above / below**, **insert column left / right**, **delete row**, **delete column**, **delete table**, **toggle header row**. Mirrors the inline experience of Notion/Confluence. Keyboard shortcuts: `⌥⇧↑/↓` insert row above/below, `⌥⇧←/→` insert column left/right. |
| D13 | **Images** | Pasted or dropped images are copied into a sibling folder `<file-stem>_assets/` next to the `.md` (created on first image insert). Reference uses a GitHub-compatible relative path: `![alt](./<stem>_assets/img-<ulid>.<ext>)`. No base64. Absolute paths and remote URLs pasted as URLs are left as-is. |
| D14 | **Links** | Plain markdown `[text](path-or-url)` in the file — renders correctly on GitHub, in Obsidian, anywhere. No wikilink syntax in v1. `⌘K` opens a picker that autocompletes against files in the navigator subtree + an "external URL" input, and emits a relative path (`./notes/foo.md`) when the target is under the current project root. |
| **Frontmatter** | | |
| D15 | **Frontmatter UX** | Obsidian/Notion-style **properties panel** above the document body. YAML stays in the file as `---` fenced at top; the panel is a typed editor over it. Typed values: `string`, `number`, `date`, `tag[]`, `boolean`. Unknown keys render as a plain text field. New keys addable via "+ Add property." Raw-YAML edit escape hatch ("Edit source") for power users. |
| D16 | **Reserved keys** | Duo owns the `duo.*` namespace inside frontmatter. v1 uses `duo.trackChanges: true|false` (D18). All other keys are untouched. |
| **Annotations (CriticMarkup)** | | |
| D17 | **Comments persistence** | Pure CriticMarkup: `{>>[author · ts] body<<}` — e.g. `{>>[geoff · 2026-04-24 14:32] needs data<<}`. The prefix is plain text inside the comment body; any parser reads it as a comment, Duo parses the prefix for UI. No sidecar file. No thread-nesting syntax in v1 — adjacent comments on the same span render as a visual thread but remain separate CriticMarkup marks. |
| D18 | **Track changes** | Per-document toggle, persisted as `duo.trackChanges: true` in frontmatter. Author = the logged-in macOS user (for now — revisit if Duo grows a user concept). When on: every text change becomes CriticMarkup — `{++new++}`, `{--removed--}`, `{~~old~>new~~}`. Toolbar toggle + `⌘/`. |
| D19 | **Accept / reject UX** | Each CriticMarkup mark gets inline accept / reject buttons on hover and a prev / next navigator in the top bar ("3 changes"). Bulk accept / reject all. Accepting removes the markup and commits the change to the body; rejecting removes the markup and reverts. Comments have only resolve (deletes the mark) and reply (appends a new adjacent comment). |
| D20 | **CriticMarkup visual render** | Word-style inline + right-hand comment rail. Insertions: green underline. Deletions: red strikethrough. Substitutions: red-strike old next to green-underline new. Highlights: yellow background. Comments: numbered anchor icon in the body + threaded entries (parsed from the `[author · ts]` prefix) in the rail. Rail collapses when there are no comments. |
| **Save + safety** | | |
| D21 | **Save model** | Autosave with ~800ms debounce after last keystroke; `⌘S` forces immediate flush. Dirty dot on the tab clears on flush. |
| D22 | **Autosave stability** | Serializer emits **stable, diff-friendly output**: consistent trailing newline, no reflow of existing lines that weren't edited, paragraphs wrap at a configurable column (default: no wrap — one paragraph per line) for predictable git diffs. Avoids the "touch one char, reformat the whole file" trap. |
| D23 | **External-write reconciliation** | `chokidar` watches the file. External change + no local dirty → silent reload (preserving cursor position by line / column best-effort). External change + local dirty → conflict dialog with three options: **keep mine** (re-writes to disk), **take theirs** (discards local edits with confirm), **show diff** (opens a three-pane diff and lets the user pick ranges). Never silently clobber. |
| D24 | **Warn-before-overwrite (agent side)** | If `duo doc write` arrives while the user is actively editing (dirty buffer + cursor active in the last 5s), the write is held, a banner appears in the editor ("Claude wants to rewrite this file"), and the user accepts or declines from the editor chrome — not the terminal. Track-changes-on users get the write applied as CriticMarkup regardless (D18 takes precedence — there's no clobber risk). |
| **Agent API** | | |
| D25 | **`duo edit <path>`** | Opens the file in a new editor tab in the WorkingPane. If already open, focuses the existing tab. Creates the file if missing (with a prompt). Returns `{ok, tabId, path}`. |
| D26 | **`duo doc read [path]`** | Returns the live in-memory editor content as markdown (includes unsaved edits and applied CriticMarkup), not just the disk copy. If `path` is omitted, uses the active editor tab. Returns `{ok, path, content, dirty}`. |
| D27 | **`duo doc write <path>`** | Preferred over agents writing to disk directly. Flags: `--text <str>` or `--stdin` (full replacement), `--patch <unified-diff>` (range edit), `--at <anchor>` (insertion). Behavior depends on modes: track-changes off + clean buffer → writes through the editor with a **transient "agent insertion" highlight** (see D28); track-changes on → writes as CriticMarkup insertions / substitutions the user accepts; dirty buffer → triggers the D24 banner. Returns `{ok, path, appliedAs: "live"\|"tracked"\|"pending"}`. |
| D28 | **Agent-write transient highlight** | Visually distinct from CriticMarkup — a soft blue-tint background fade (~2s hold, ~1s fade) on just-inserted ranges + a small "✨ Claude" chip in the document margin near the change that dismisses on click or after 10s. Not stored in the file. Purpose: show the user where the agent just wrote without turning every agent touch into a track-changes review. |
| D29 | **`duo doc comment <path>`** | Flags: `--anchor <selector>` (one of: `heading:"Risks"`, `line:42`, `text:"exact match"`, `range:start-end`), `--body <text>`. Inserts a `{>>[agent · ts] body<<}` span at the resolved anchor. Returns `{ok, commentId}`. Also surfaces in the comment rail with a "✨ Claude" author badge. |
| D29a | **`duo selection`** | Returns the user's current editor selection as JSON: `{path, text, paragraph, heading_trail, start, end}`. `text` is the selected substring (`""` when collapsed). `paragraph` is the textContent of the surrounding block. `heading_trail` is the ancestor-heading chain (outermost first). `start`/`end` are ProseMirror positions used by `doc-write --replace-selection`. Returns `null` when no editor tab is active. Unblocks "summarize this", "fix this", "shorten this" agent patterns. |
| D29b | **`duo doc write [--replace-selection \| --replace-all]`** | Companion to `duo selection`. Default mode: `replace-selection` \u2014 swaps the user's current selection (or inserts at the caret) with text from `--text "\u2026"` or stdin. v1 treats this text as plain text inside the selection range. `--replace-all` swaps the entire document body and parses the input as markdown (formatting, lists, tables all round-trip). Useful for "rewrite this paragraph" where the agent prefers full markdown control. |
| D29c | **Persistent visible selection across focus changes** | When the user selects text in the editor, then clicks into the terminal to brief the agent ("/duo summarize this"), the selection range stays painted as a tinted overlay (`.duo-blurred-selection`). Implemented as a ProseMirror decoration plugin keyed off focus/blur events \u2014 only painted while the editor is blurred so it doesn't double up on the native focused-selection paint. Critical for the human\u2194agent loop: without it the user can't see what they're asking the agent to act on. **See also [Stage 15g \u2014 "Send \u2192 Duo"](stage-15g-send-to-duo.md)**, which extends this primitive across modalities (browser + future HTML editor) and adds a floating click affordance that pipes the selection into the active terminal. |
| **Doc polish** | | |
| D30 | **Outline / TOC sidebar** | Auto-generated from H1–H6. Click to jump (smooth-scroll). Collapsible. Drag to reorder — reorders the underlying sections in the document. Shows per-heading change counts when track-changes is on or there are unresolved comments. |
| D31 | **Find & replace** | `⌘F` opens an inline find bar (count, prev / next, case-sensitive, whole-word, regex). `⌘⌥F` extends to replace + replace-all. Scope: current document only in v1. |
| D32 | **Drag & drop** | Files dropped from the OS onto the editor: images → copied into `<stem>_assets/` + inserted at the drop point (D13). `.md` files → inserted as a relative-path link. Anything else → inserted as a generic link to the file's absolute path (quoted). |
| D33 | **Spellcheck** | Native macOS spellcheck via Electron's `webContents.on('context-menu')` + Chromium spellchecker. On by default. "Add to dictionary" works via the OS menu. Grammar deferred. |
| **New-file flow** | | |
| D33a | **`⌘N` creates a new markdown file** | Anywhere in the app, `⌘N` opens a new `editor` tab with a pending path scoped to the navigator's current folder (`<cwd>/untitled.md`, auto-incremented `-1`, `-2`… to avoid collisions with existing files **and** already-open untitled tabs). Tab chip reads "Untitled.md" until named. |
| D33b | **Filename-first interstitial** | Before the editor canvas, the new tab renders a prominent inline "Name this document" bar (large text input + "Create" button). The input is auto-focused and pre-populated with the suggested filename minus extension. Escape closes the tab and discards the buffer; Enter or clicking Create commits the name, creates an empty file on disk, and **moves focus to the editor prose** so the user can begin typing without an extra click. `.md` is appended if the user didn't type an extension. |
| D33c | **Tab dirty while unnamed** | Unnamed new-file tabs do not write to disk until named. They show a dashed pen icon in the tab strip so users can distinguish them from saved files. Closing an unnamed tab silently discards (matches Google Docs "untitled" behavior). |
| **Appearance** | | |
| D33d | **Theme toggle (system / light / dark)** | App-level setting (not editor-specific, but implemented alongside Stage 11 because the editor's canvas is the most theme-sensitive surface). Three modes: **System** (follow macOS `nativeTheme`), **Light**, **Dark**. Default: **System**. Exposed as a View → Appearance submenu + a small icon button in the top chrome row. Persisted in localStorage (`duo.theme`). v1 light theme palette is pragmatic (zinc-50/100/200 surfaces, zinc-900 text, accent unchanged) — enough to be usable, refinement in Stage 12 (Atelier visual). |
| **Cross-cutting shortcut behavior (caused by editor focus)** | | |
| D33e | **`⌘T` always activates a new foreground browser tab** | When focus is in an editor tab (or anywhere else), `⌘T` must: (1) flip the WorkingPane's `activeWorking` to `browser`, (2) create a new browser tab, (3) move keyboard focus to the address bar so the user can immediately type a URL. Regression caught when the new tab opened *behind* the active editor tab and never received focus. |
| D33e2 | **Duo shortcuts must reach the renderer regardless of focus surface** | Chromium's `WebContentsView` swallows keydowns before our renderer hears them. `BrowserManager.wireKeyForwarding` keeps an explicit allowlist of Duo shortcut keys (`t`, `n`, `l`, `w`, `b`, `[`, `]`, `1-9`) that get `preventDefault`-ed and forwarded to the renderer via `IPC.BROWSER_KEY_FORWARD`. Any new app-level `⌘<letter>` shortcut must be added to that list, otherwise it silently no-ops when focus is on a browser tab. Editor tabs are renderer-side React, so they don't need the forwarder \u2014 only the browser surface does. |
| D33f | **`⌘N` filename commit hands focus to the prose** | After the user types a filename and presses Enter (or clicks Create), focus must move from the filename input to the editor's prose canvas so they can immediately start typing. The interstitial bar disappears as part of the commit transition; the editor instance stays mounted across the transition, so a `editor.commands.focus()` after the empty-file write is sufficient. |
| **v1 scope / non-goals** | | |
| D34 | **Explicitly out of v1** | Real-time multi-user cursors / CRDT / presence. KaTeX math. Mermaid rendering. Wikilinks + backlinks. PDF / HTML / docx export. Custom themes (default theme only). In-editor git status. Sections reorder-via-outline is in; full document outline collaboration is not. |

---

## 4. On-disk file shape

A saved `.md` file looks like this — every byte legible by any tool:

```markdown
---
title: Q2 PRD — Duo Editor
status: draft
duo.trackChanges: true
---

# Overview

Duo's markdown editor is the flagship writing surface. {>>[geoff · 2026-04-24 14:32] Do we have a launch date?<<}

It ships as the second half of the reading / writing pair described in
VISION.md.

{++A new paragraph Claude inserted that the user hasn't accepted yet.++}

## Risks

| Risk | Severity |
| --- | --- |
| Tables with merged cells | Medium |
| CriticMarkup in nested blocks | Low |

![hero](./q2-prd_assets/img-01hxyz.png)
```

What the user sees in the editor:
- YAML collapses into a properties panel above the body.
- `{>>...<<}` renders as a numbered comment anchor + entry in the rail.
- `{++...++}` renders as a green-underlined insertion with accept / reject.
- GFM table is a real table with row / column handles.
- Image renders inline.

---

## 5. Architecture notes

- **Package layout.** `renderer/components/Editor/` with:
  - `EditorTab.tsx` — the tab shell (dirty dot, conflict banner, outline column, comment rail).
  - `RichEditor.tsx` — the TipTap instance + registered extensions.
  - `serializer/` — ProseMirror schema ↔ markdown + CriticMarkup + frontmatter.
  - `agentOverlay/` — transient highlight rendering (D28) and `duo doc write` plumbing.
- **Extensions.** TipTap's StarterKit + `table`, `taskList`, `link`, `image`, `codeBlockLowlight` (Shiki adapter), + custom: `criticmarkup`, `frontmatterProperties`, `slashMenu`, `floatingToolbar`, `agentTransientHighlight`, `commentRail`, `outlineSidebar`.
- **File I/O.** Read via the Stage 10 `duo-file://` protocol handler (bytes as `Buffer`, decoded at the edge); write via the same handler's write method. Atomic write: write to `<file>.duo.tmp` then rename.
- **Watcher.** Reuse Stage 10's chokidar instance; editor subscribes by absolute path.
- **Agent edits over the socket.** `doc:read`, `doc:write`, `doc:comment`, `doc:selection` socket commands added to `electron/socket-server.ts`, wired through `cli/duo.ts`. All commands route into the live editor model; they do not read / write disk directly.
- **Tab identity.** Stage 10 D13 rule applies: `path + type` is the identity. Reopening the same file focuses the existing tab.
- **Undo / redo.** TipTap's history plugin. CriticMarkup mark lifecycles participate in history. Accept / reject of an agent-written block is a single undoable action.

---

## 6. Phased build plan

Five sub-stages — each ends in something demonstrable.

### 11a — Core editor + file binding (~4–6 PRs)
- [x] WorkingPane `editor` tab type registered; `.md` click opens it (upgrades Stage 10 D12 preview).
- [x] `duo edit <path>` CLI + socket command.
- [x] TipTap instance with core marks + nodes (D10) and input rules (D6) — StarterKit provides the input rules.
- [x] Top toolbar (D5, top-bar half). Floating bubble + slash menu (D7) deferred to 11a.1.
- [x] Classic keyboard shortcuts (D8, subset: B/I/U/S/E/K/Z).
- [x] Serializer: via `tiptap-markdown` (commonmark + GFM tables + task lists + footnotes). Known non-byte-stable output (D22 risk) — sharpen in a follow-up pass.
- [x] Save: autosave + `⌘S` + dirty dot (D21, D22).
- [x] Contextual table controls (D12a).
- [x] `⌘N` new-file flow (D33a–D33c).
- [x] Theme toggle (D33d).
- [x] Persistent editor selection across blur (D29c).
- [x] `duo selection` + `duo doc write` (D29a, D29b) — replace-selection (plain text) and replace-all (markdown).
- [ ] Frontmatter properties panel (D15, D16) — pending; YAML is currently preserved verbatim but shown nowhere (invisible to the user).
- [ ] Paste + drag-drop images (D9, D13, D32) — pending.
- [ ] Slash menu (D7) + floating selection bubble (D5) — pending.
- **Exit:** PM opens a `.md`, edits, saves, and the on-disk file is clean markdown another tool can read.

### 11b — External edits, conflict safety (~2 PRs)
- [ ] chokidar-backed external-write detection (D23).
- [ ] Conflict dialog with three-pane diff.
- [ ] Warn-before-close on dirty (existing WorkingPane hook).
- **Exit:** agent writes to the file via disk → editor reloads or prompts; user never loses work.

### 11c — Agent API + transient highlight (~3 PRs)
- [ ] `duo doc read / write / comment / selection` socket commands (D26–D29a). **Note 2026-04-26:** `read` / `write` / `selection` already shipped; only `comment` remains for this sub-stage.
- [ ] Transient "just-changed" highlight + margin chip (D28).
- [ ] Warn-before-overwrite banner for dirty buffers (D24).
- [ ] Skill doc update: new `skill/examples/edit-markdown-file.md`.
- **Exit:** `duo doc write --stdin < ./revised-section.md` lands in the open editor with a blue fade; the user sees what changed.

> **Visual spec (added 2026-04-26):** the transient highlight uses
> Atelier's `mark` token (yellow) with a 6-second fade, not the
> "blue fade" placeholder above. The exact treatment is in
> [docs/design/atelier/](../design/atelier/) — `@keyframes
> duo-just-added` in [Duo Prototype.html](../design/atelier/project/Duo%20Prototype.html)
> and the `justAdded` mark / block class in
> [duo-components.jsx](../design/atelier/project/duo-components.jsx).
> The prototype's 16-second demo loop fires the highlight at ~8s
> (one new sentence appended to a paragraph + one new paragraph
> below). When implementing, replace "blue fade" with the Atelier
> spec; the mock also handles the cross-fade-in for newly inserted
> *blocks*, not just inline text.

### 11d — CriticMarkup track-changes + comments (~3–4 PRs)
- [ ] CriticMarkup parser + serializer extension for TipTap.
- [ ] Track-changes toggle (D18) writing `duo.trackChanges` to frontmatter.
- [ ] Insertion / deletion / substitution mark rendering (D20).
- [ ] Comment rail (D20) with author / ts prefix parsing (D17).
- [ ] Accept / reject / resolve inline + navigator (D19).
- [ ] `duo doc comment` end-to-end (D29).
- **Exit:** track-changes-on + agent writes = CriticMarkup review flow that works like Google Docs suggestions.

> **Visual spec (added 2026-04-26):** the Atelier mock
> ([docs/design/atelier/](../design/atelier/)) realizes the
> "Suggesting" mode end-to-end: green-underlined insertions,
> red-strikethrough deletions, and a top-of-editor banner
> ("3 changes from Claude · Accept all / Reject all"). Three modes
> are demonstrated — **Live** (no marks), **Suggesting**
> (insertions + deletions both visible), **Accepted** (deletions
> disappear, insertions stay). The mock toggles between modes via
> the Tweaks panel; in the real editor, this maps to D18's track-
> changes toggle. See `insertion` / `deletion` mark renderings in
> [duo-components.jsx](../design/atelier/project/duo-components.jsx).

### 11e — Outline, find, polish (~2 PRs)
- [ ] Outline / TOC sidebar with jump + reorder (D30).
- [ ] Find & replace (D31).
- [ ] Spellcheck integration (D33).
- [ ] Selection primitive (D29a) wired end-to-end with a skill example.
- **Exit:** the editing experience feels competitive with Google Docs / Notion for a 30-minute PRD-drafting session.

Total: ~14–16 PRs. Sequenced so that 11a unlocks real usage and every sub-stage after adds a clean capability without rewriting 11a.

---

## 7. Risks + open questions

- **Markdown round-trip fidelity.** Arbitrary `.md` in the wild (existing PRDs in the repo) may not round-trip byte-perfect. Mitigation: document what we preserve; add a "this file used features we can't fully round-trip — editing here may reformat" banner when we detect exotic input. Hard gate: never silently destroy content.
- **CriticMarkup in nested blocks.** Comments inside list items, table cells, footnotes. TipTap marks inside nodes with constrained schemas need care. Parser test-cases for each combination before 11d ships.
- **Schema rigidity vs. markdown flexibility.** ProseMirror demands every node be declared. Rare markdown (e.g. raw HTML blocks, reference-style links) needs explicit schema entries or an "unknown block" passthrough node that renders as a monospace read-only block with "edit source." Resolve during 11a.
- **Agent-write arrives mid-keystroke.** Race between user typing and `duo doc write`. Hold agent writes for ~300ms after last keystroke; if that doesn't suffice, queue and apply at the next idle moment with the D24 banner.
- **Open question — author identity.** D18 uses the macOS user. When Duo grows a `duo login` concept for Trailblazers (Stage 6 / 14), revisit.
- **Open question — comment threading.** Adjacent `{>>...<<}` marks render as a thread via a convention. If threads prove fragile in use, add a Duo-specific threading convention inside the prefix (e.g. `[geoff · ts · reply-to:abc]`). Still spec-compliant. Decide after 11d usage.
- **Open question — outline-driven reorder semantics.** Dragging a section header moves "everything until the next same-or-higher heading." Edge case: trailing content after the last heading. Spec exact behavior at 11e kickoff.

---

## 8. Success criteria

- A PM opens a `.md`, types a full PRD with tables and comments, and
  the resulting file renders cleanly on GitHub.
- When Claude rewrites a paragraph via `duo doc write`, the user sees
  where the change landed (blue fade) or accepts it as a CriticMarkup
  suggestion (track-changes on) — and the paragraph is not silently
  clobbered under an in-progress edit.
- The user never sees a raw `#`, `*`, `|`, or `{++...++}` while typing
  prose in the default visual mode. Source is available via "Edit
  source" for power users.
- Opening the same `.md` in Obsidian, VS Code, or a GitHub PR shows a
  file that reads naturally — no Duo-specific escape sequences, no
  sidecar metadata required.
