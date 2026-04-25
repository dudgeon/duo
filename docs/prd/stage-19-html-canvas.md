# Stage 19 PRD — HTML canvas (rendered + editable, agent-collaborative)

> **Status:** spec drafted 2026-04-25. Renumbered 2026-04-26 from
> Stage 13 → Stage 19 to avoid collision with the existing Stage 13
> (interaction polish + `duo doctor` + TCP transport — pre-dates this
> PRD; references throughout the codebase). Originated from a design
> conversation captured in `docs/conversations/html-canvas-kickoff.md`
> — three of four scoping questions answered (editing surface, file
> scope, script policy); stable-ID strategy and downstream conventions
> proposed here as owner-to-confirm defaults.
> **Slot in roadmap:** new Stage 19. Sibling tab type to Stage 11
> (markdown editor) inside the WorkingPane. Sequenced after the
> flagship pair: depends on Stage 11c (just-added highlight, supplies
> the Atelier visual reused in H20), Stage 15g (Send → Duo, supplies
> the discriminated-union selection shape reused in H25–H27), and
> Stage 17 (Atelier tokens — supplies the visual language reused in
> H20, H23, H26). Stage 11d (CriticMarkup track-changes) is a
> nice-to-have but not a prerequisite — H39 defers HTML diff to a
> follow-up.
> **References:**
> - [docs/VISION.md](../VISION.md) — collaboration as the flagship bet
> - [docs/prd/stage-10-file-navigator.md](stage-10-file-navigator.md) —
>   WorkingPane shell, `duo-file://`, per-type registry
> - [docs/prd/stage-11-markdown-editor.md](stage-11-markdown-editor.md) —
>   sister surface; this PRD borrows Stage 11's selection persistence
>   (D29c), Atelier "just-added" highlight (D28), comment rail (D20),
>   and `duo selection` discriminated-union shape
> - [docs/prd/stage-15g-send-to-duo.md](stage-15g-send-to-duo.md) —
>   the cross-modality selection primitive this surface participates in
> - **[docs/design/atelier/](../design/atelier/)** — same palette and
>   motion grammar as the markdown editor; the canvas is a Duo-native
>   surface, not a raw browser

---

## 1. What we're building

A new WorkingPane tab type — **`html-canvas`** — that opens any local
`.html` file rendered, lets the human edit it directly (Google-Docs-on-
HTML, not view-source), and exposes the live DOM to the agent so Duo
can read structure, write changes, anchor comments, and surface where
the user is looking. Saves clean `.html` to disk; metadata that isn't
load-bearing for the document (comments, recent-edit log, script-
allowed flag) lives in a sidecar `<file>.duo.json`.

Two beliefs animate the bet:

1. **HTML is increasingly the right interactive surface between agent
   and human.** Markdown is fine for prose; HTML is what an agent
   reaches for when it wants tables that actually fit, side-by-side
   layouts, callouts with iconography, mini-dashboards, embedded
   forms, or interactive checklists. Claude is fluent in HTML and
   Tailwind. The format is far more expressive than `.md`.
2. **The bottleneck is the human-edit story.** Raw HTML is fast for
   Claude and slow for a person. A canvas that renders the page
   *and* takes contentEditable edits closes that loop; both sides
   work in their natural register.

A third commitment is operational: the canvas must not flinch on
arbitrary HTML. The kickoff framing was "agent/human can collaborate
on arbitrary html, without anything breaking if there are unexpected
patterns used." Convention is what *Duo-authored* HTML follows; the
editor must work on whatever it's pointed at.

**Out of scope for v1** (H39): scripts/network with permissive defaults
(opt-in per file is the model — see H8); cross-file linking and import
resolution; collaborative multi-user editing; HTML diff merge from
external writers (we reload on conflict); non-HTML asset editing
inside the canvas (images render but aren't edited).

---

## 2. Personas + jobs to be done

**Primary persona:** the same PM. They asked Claude in a terminal for
a one-page status report; Claude wrote a polished HTML page with a
header, three columns of progress, and a risks table. The PM wants
to: tweak two sentences in the intro, fix a typo in the table, leave
a comment on the third risk asking Claude for data, and have the
final file land in their company shared drive as a normal `.html`.

Jobs this stage does:
- "Open this `.html` file the agent just made; let me edit prose in
  place without learning HTML."
- "Show me, visually, where Claude just changed something."
- "Let me leave a comment on this card and say 'add a chart here'."
- "When I'm done, my file is just `.html` — anyone can open it."
- "Build me a quick interactive checklist (HTML form-style) right
  here in the canvas."

Jobs this stage does NOT do:
- Make `.html` round-trip to `.md` or vice versa.
- Be a visual layout builder (drag boxes, edit CSS via inspector).
- Replace a real IDE for HTML/CSS/JS app development.
- Co-edit live with another human.

---

## 3. Resolved decisions

(Answers confirmed in the kickoff conversation are marked **C** for
"confirmed by owner." Everything else is **P** for "proposed default
— owner to confirm." The kickoff paused at the stable-ID question;
a default is proposed for that here.)

| # | Area | Decision |
|---|---|---|
| **Editing surface** | | |
| H1 **C** | **Editing model** | WYSIWYG on the rendered output via `contentEditable`, not a split rendered/source view, not block-style. The canvas IS the page; edits are direct. A "View source" toggle exists for power users and for debugging Duo's writes (H32), but it is not the primary mode. |
| H2 **C** | **Schema flexibility** | The editor must accept arbitrary HTML — including hand-rolled, third-party, or generated-elsewhere markup — without breaking. Duo's authoring conventions (boilerplate, locked regions, ID strategy) apply to *Duo-generated* output; they are never preconditions for the editor to function. |
| H3 **P** | **No ProseMirror schema** | Unlike Stage 11, we do NOT model the document as a strict ProseMirror schema. The reason is H2: ProseMirror demands every node be declared, and the canvas must accept anything. Implementation is `contentEditable` on a sandboxed iframe body + a `MutationObserver` that emits structural change events. We trade node-accurate undo (MutationObserver replay covers most cases) for matching arbitrary input. |
| H4 **P** | **Iframe sandbox** | The rendered HTML lives in a same-process iframe (`srcdoc` for v1; Electron `WebContentsView` if we hit isolation needs). Same-process keeps the DOM bridge synchronous and cheap. Sandbox attributes: `allow-same-origin allow-popups allow-forms` always; `allow-scripts` only when scripts are allowed for this file (H8). |
| **File scope** | | |
| H5 **C** | **What opens** | Any local `.html` file. Graceful: malformed HTML, exotic doctypes, files without `<html>`/`<body>`, fragments — all open, all render best-effort, all are editable. The browser already does this; we lean on it. |
| H6 **P** | **`duo html new`** | A CLI command creates a new `.html` from boilerplate (H17) at a specified path. Equivalent surface from inside Duo: `⌘⇧N` (sibling of Stage 11's `⌘N` for markdown). |
| H7 **P** | **Tab identity** | Same as Stage 10 D13: identity is `(absolute path, type)`. Reopening the same file focuses the existing canvas tab. |
| **Script + style policy** | | |
| H8 **C** | **Scripts** | Full JavaScript execution, **opt-in per file**. The file's first open in Duo prompts: "This file contains script tags / inline event handlers. Allow them to run? [Allow once] [Always allow this file] [Never] [Open in source-only view]." Choice persists in `<file>.duo.json` under `scripts.allowed`. |
| H9 **P** | **External assets** | Images, stylesheets, and fonts loaded by relative URL resolve against the file's directory (existing browser behavior). Remote URLs always allowed for images and CSS (no opt-in). Remote scripts gated by H8. |
| H10 **P** | **Inline event handlers** | Treated identically to `<script>` tags for the H8 prompt. `onclick="…"` and friends only run when scripts are allowed for the file. |
| H11 **P** | **Source-only fallback** | If the user picks "Open in source-only view" at the H8 prompt, the canvas opens read-only with syntax-highlighted HTML and a "Trust this file" button. Useful for "agent gave me a page from a sketchy source." |
| **Stable IDs** | | |
| H12 **P** | **ID strategy** | **Auto-inject on every editable element when Duo opens the file**, persist on save. Attribute name: `data-duo-id`. Format: `ULID` (26-char Crockford base32; sortable by creation time; collision-safe at our scale). Existing `id=""` attributes are never modified; `data-duo-id` is additive. Re-opening a file with `data-duo-id` already present preserves them — IDs are stable across sessions. |
| H13 **P** | **What gets an ID** | All elements *inside* `<body>` except: text nodes (text is addressed by parent-id + offset), `<br>`, `<hr>`, and elements explicitly carrying `data-duo-id="opt-out"`. `<head>` elements skipped. |
| H14 **P** | **ID injection on first open** | When opening an `.html` file that has no `data-duo-id` attributes, Duo annotates the file in-memory and prompts before saving the annotations to disk: "Add stable IDs to all elements? Recommended — makes future agent edits more reliable. [Yes, save with IDs] [No, keep file pristine until save]." A "Don't ask again" checkbox persists the choice (`duo.html.autoInjectIds` setting, optionally per-directory). Files Duo creates from boilerplate (H17) ship with IDs already. |
| H15 **P** | **ID stability under edits** | When the human or agent inserts new elements, new ULIDs are minted at insertion time. Element moves preserve IDs. Cut+paste within the canvas preserves IDs (within-session); paste from outside generates new IDs. Element duplication mints new IDs for the copy. |
| **Conventions Duo follows when authoring** | | |
| H16 **P** | **Skill bundle** | Conventions ship as `skill/examples/html-canvas-authoring.md` — read by Claude Code subagents at session start, same delivery as the markdown skill. Defines: H17 boilerplate, H18 component snippets, H19 lock markers, H20 change-attribution markers. The skill is descriptive, not prescriptive — Duo doesn't *enforce* the conventions on the editor side; it just makes Duo-generated HTML easier to work with. |
| H17 **P** | **Boilerplate** | The default skeleton for new files: HTML5 doctype, viewport meta, a `<title>` derived from filename, a `<style>` block with sane resets and a body width cap (~720px to match Stage 11 D3), Tailwind via CDN behind the script-opt-in. A semantic body — `<header>`, `<main>`, `<footer>` — with the structural elements pre-marked H19-locked. Pre-applied `data-duo-id`s. |
| H18 **P** | **Component snippets** | The skill lists ~ten reusable HTML+Tailwind snippets Claude can drop in: callout (info / warning / success), comparison table, two-column card grid, definition list, code-block with copy button, status badge row, stat tile, image with caption, embedded checklist, footnote. Each snippet's outer element carries a `data-duo-component` tag so Duo (and humans) can recognize them. |
| H19 **P** | **Locked vs editable regions** | Convention: `data-duo-lock="structure"` on elements whose markup is load-bearing (the body grid, navigation, footer scaffolding). Locked elements are still readable and visible; their text content is editable, but their tag, attributes, and child structure are protected from accidental human edits. The editor renders a subtle dashed outline on hover for locked elements with a tooltip ("Structural element — text editable; layout locked"). Override: hold `⌥` while clicking to enter "edit lock" mode for that element. |
| H20 **P** | **Change attribution** | Ephemeral, not persisted to the `.html` file. When the agent edits an element via `duo html set` / `replace` / `append`, the canvas paints the affected region with the **Atelier "just-added" yellow highlight** (Stage 11 D28; 6-second fade) and shows a "✨ Claude" margin chip. Recent-edits log lives in the sidecar under `recentEdits` (last 50, with timestamps + agent name + element ID); the canvas reads it at open time to repaint highlights for changes made while the canvas was closed (within the freshness window). |
| **Comments** | | |
| H21 **P** | **Anchor model** | Comments are anchored by element `data-duo-id` plus an optional `range: { startOffset, endOffset, textPath }` for sub-element selections (a sentence inside a paragraph). Stored in `<file>.duo.json` under `comments[]`. The HTML file itself is never modified by comment authoring. |
| H22 **P** | **Sidecar shape** | One sibling JSON file per `.html` — `<file>.duo.json`. Schema versioned (`version: 1`). Holds: `scripts.allowed`, `comments[]`, `recentEdits[]`, optional `properties` (free-form metadata, like Stage 11 frontmatter). Absent sidecar = empty defaults; presence is opportunistic. Git-friendly. The `.html` is fully readable without it. |
| H23 **P** | **Comment UX** | Re-uses Stage 11 D20's comment rail component — right-side rail, threaded entries, numbered anchor icon in the body, accept / resolve / reply, "✨ Claude" badge for agent comments. Same Atelier styling as the markdown editor. |
| H24 **P** | **`duo html comment`** | CLI parallel to Stage 11 D29: `--anchor <id>` (preferred) / `--selector <css>` (resolved server-side to nearest element with `data-duo-id`) / `--text "…"` (substring match), `--body <text>`. |
| **Selection** | | |
| H25 **P** | **`duo selection` for canvas tabs** | Returns the discriminated-union shape from Stage 15g G6: `{kind:"html-canvas", path, text, html, anchorId, anchorPath, range, surrounding}`. `text` is the selected substring; `html` is the selected outerHTML for non-collapsed selections; `anchorId` is the nearest ancestor with a `data-duo-id`; `anchorPath` is the trail of ancestor data-duo-ids (outermost first). Collapsed selections return caret position only. |
| H26 **P** | **Persistent visible selection across blur** | Inherits Stage 11 D29c — when the user selects in the canvas and clicks into the terminal, the selection stays painted as a tinted overlay while the canvas is blurred. Implementation: same focus / blur decoration pattern, applied to the iframe body. |
| H27 **P** | **Send → Duo pill** | Stage 15g's floating pill works on the canvas surface natively, since H25 provides the payload. No additional work beyond wiring the canvas's selection observer into the existing dispatcher. |
| **Editing UX** | | |
| H28 **P** | **Top toolbar** | Floating top bar with: bold / italic / underline / strike / inline code (operates on selection inside contentEditable; we write our own selection-aware mark applicator rather than lean on `document.execCommand`), link picker (`⌘K`), insert component (snippet menu — H18), insert comment (`⌘⇧C`), view-source toggle, find & replace (`⌘F` / `⌘⌥F`), and a "lock / unlock element" button when a locked element is selected. |
| H29 **P** | **Slash menu** | `/` at line start in a contentEditable text node opens a snippet picker: H18 components plus headings, lists, blockquote, code block, table, hr. Filter-as-you-type. Same UX as Stage 11 D7. |
| H30 **P** | **Floating selection bubble** | On non-collapsed text selection: bold / italic / underline / strike / link / "comment on this" / "Send → Duo." Same component as Stage 11 D5 with HTML-mode action handlers. |
| H31 **P** | **Insert component** | The toolbar's "Insert component" button opens H18's snippet menu. Each snippet inserts at the caret with `data-duo-component` and `data-duo-id`s pre-populated. |
| H32 **P** | **Source view** | The canvas top bar has a "View source" toggle. When on, the rendered surface flips to a syntax-highlighted, **also-editable** code view (CodeMirror 6 with the `html` lang). Edits in source view sync to the rendered DOM on toggle-back; edits in render view sync to source on view-source open. View-source is the escape hatch for power users; the rendered canvas is the primary surface. |
| **Save + watcher** | | |
| H33 **P** | **Save model** | Autosave with ~800ms debounce; `⌘S` flushes. Inherits Stage 11 D21. The sidecar saves on the same debounce so comments / edits stay in sync with the html file. |
| H34 **P** | **Serializer stability** | Output HTML is pretty-printed with 2-space indentation and a stable attribute order (`id`, `class`, `data-duo-id`, then everything else alphabetical). Untouched markup is preserved as-is for elements the human didn't edit — we minimize diff churn for git. |
| H35 **P** | **External-write reconciliation** | Inherits Stage 11 D23 — chokidar watches the file; external write + clean buffer = silent reload; external + dirty = three-pane conflict dialog. The sidecar reconciles separately (its conflicts are JSON merges; v1 is last-write-wins with a warning if both changed). |
| H36 **P** | **Warn-before-overwrite** | Inherits Stage 11 D24 — `duo html set / replace / append` arriving while the buffer is dirty + cursor active triggers a banner ("Claude wants to edit this page") and the user accepts or declines from the canvas chrome, not the terminal. |
| **Agent CLI surface** | | |
| H37 **P** | **`duo html *` namespace** | New CLI namespace, parallel to `duo doc *`. Verbs: `query`, `get`, `set`, `replace`, `attr`, `append`, `remove`, `comment`, `selection`, `changes`, `new`, `allow-scripts`. See § 5. |
| H38 **P** | **Selectors** | All `--selector` flags accept CSS selectors; the canvas resolves them inside the iframe and returns either the matched element's `data-duo-id` (preferred address) or, if no `data-duo-id` is present, an XPath. `--id` flags take a `data-duo-id` directly. The skill teaches Claude to prefer `data-duo-id`-based addressing. |
| **v1 scope / non-goals** | | |
| H39 **P** | **Explicitly out of v1** | Multi-document linking and import resolution. Visual layout builder. Real-time multi-user co-editing. Track-changes mode (HTML diff is harder than markdown CriticMarkup; the just-added highlight covers the common case; revisit). HTML → Markdown export. Mobile / responsive preview toggle. Inspector-style CSS editing. Embedded markdown blocks (`<div data-duo-md>` is interesting but defers to a follow-up). |

---

## 4. On-disk file shape

A saved canvas file is two artifacts on disk:

**`q2-status.html`** (legible to any browser, GitHub, anything):

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Q2 Status — Conversational Servicing</title>
  <style>/* sane resets + body cap */</style>
</head>
<body>
  <header data-duo-id="01HXYZ001" data-duo-lock="structure">
    <h1 data-duo-id="01HXYZ002">Q2 Status</h1>
  </header>
  <main data-duo-id="01HXYZ003">
    <section data-duo-id="01HXYZ004" data-duo-component="callout">
      <p data-duo-id="01HXYZ005">On track for July 1 launch.</p>
    </section>
    <table data-duo-id="01HXYZ006" data-duo-component="risk-table">
      …
    </table>
  </main>
</body>
</html>
```

**`q2-status.html.duo.json`** (Duo-side metadata; safe to delete; absence
is fine):

```json
{
  "version": 1,
  "scripts": { "allowed": "always" },
  "comments": [
    {
      "id": "cmt_01HXYZ",
      "anchorId": "01HXYZ005",
      "range": { "textPath": "p[1]", "startOffset": 0, "endOffset": 28 },
      "author": "geoff",
      "ts": "2026-04-25T14:32:00Z",
      "body": "Add a chart here once we have the numbers."
    }
  ],
  "recentEdits": [
    {
      "ts": "2026-04-25T14:30:11Z",
      "author": "claude",
      "anchorId": "01HXYZ006",
      "kind": "replace"
    }
  ]
}
```

What the user sees in the canvas:
- The page rendered, full visual fidelity.
- A subtle dashed outline appearing on hover for locked elements.
- A yellow Atelier "just-added" highlight on Claude's recent edit
  (fading over 6 seconds; if older than the freshness window when
  the canvas opens, no paint).
- A numbered comment icon on the callout paragraph; the rail shows
  geoff's note + a "Reply" affordance.
- The toolbar across the top with the verbs from H28.

---

## 5. CLI surface — `duo html *`

| Command | Purpose | Flags / Shape |
|---|---|---|
| `duo html new <path>` | Create a new file from boilerplate (H17). | `--title <str>`; `--component <name>` to seed with a snippet. Returns `{ok, path, tabId}`. |
| `duo html query <selector>` | List elements matching a CSS selector inside the active canvas. | Returns `[{id, tag, text, classes}]`. |
| `duo html get <id>` | Read outerHTML of a specific element. | `--id <duo-id>` or `--selector <css>`. Returns `{ok, html, text}`. |
| `duo html set <id> --content "…"` | Replace innerHTML. | Body via `--text` / stdin / `--html`. |
| `duo html replace <id> --html "…"` | Replace outerHTML. | Same addressing. |
| `duo html append <parent-id> --html "…"` | Append child. | Returns the new child's `data-duo-id`. |
| `duo html remove <id>` | Delete element. | Same addressing. |
| `duo html attr <id> --set k=v` / `--remove k` | Modify attributes. | |
| `duo html selection` | User's current selection (H25). | Returns the discriminated-union payload. |
| `duo html comment` | Add a comment (H24). | `--anchor <id>`, `--body <text>`. |
| `duo html changes` | Recent edits log (sidecar `recentEdits`). | `--since <ts>`, `--limit N`. |
| `duo html allow-scripts <path>` | Toggle script execution for a file. | `--mode allow\|deny\|once`. |

`duo open` stays browser-only. `duo edit` stays markdown. `duo view`
opens a file in the appropriate canvas based on extension — for
`.html` it opens the HTML canvas tab type.

---

## 6. Architecture notes

- **Package layout.** `renderer/components/HtmlCanvas/` with:
  - `CanvasTab.tsx` — tab shell (toolbar, conflict banner, comment rail, view-source toggle).
  - `RenderedCanvas.tsx` — iframe-srcdoc host + MutationObserver + ID injection.
  - `SourceView.tsx` — CodeMirror 6 wrapper with the html lang.
  - `idInjector/` — ULID minting + re-injection logic.
  - `serializer/` — DOM ↔ pretty-printed HTML (H34).
  - `commentAnchor/` — sidecar persistence; range resolution.
  - `agentOverlay/` — Atelier just-added highlight; margin chip.
- **Iframe bridge.** Same-process iframe via `srcdoc`. Parent ↔ iframe
  communication via direct DOM access (no `postMessage` for v1; we
  own both frames). MutationObserver in the iframe reports structural
  changes to the parent renderer; parent emits `CANVAS_CHANGE_PUSH`
  IPC for downstream consumers (recentEdits writer, dirty signal).
- **Selection observer.** A renderer-side hook subscribes to
  `selectionchange` inside the iframe and pushes the H25 payload up
  to main via `WORKING_SELECTION_PUSH` (the same channel Stage 15g
  uses). This is what lights up `duo selection` and the Send → Duo
  pill for canvas tabs.
- **File I/O.** Reads via Stage 10's `duo-file://` handler (bytes,
  decoded at the edge). Writes atomically (`<file>.duo.tmp` →
  rename); the sidecar writes the same way.
- **Watcher.** Reuse Stage 10's chokidar instance.
- **Schema-free undo.** Native browser undo per contentEditable
  surface, plus a top-level MutationObserver-driven undo stack for
  non-text mutations (insertions, removals, attribute changes). v1
  keeps the two stacks separate; merge if it feels disjoint in use.
- **Tab identity.** `(absolute path, type='html-canvas')`. Same-file
  open focuses existing tab.
- **Skill delivery.** `skill/examples/html-canvas-authoring.md` ships
  in the skill bundle synced via `npm run sync:claude` (Stage 8
  plumbing).

---

## 7. Phased build plan

Five sub-stages.

### 19a — Render + edit primitive (~3–4 PRs)
- [ ] WorkingPane registers `html-canvas` tab type; `.html` click opens it (replaces today's "open with default app" for `.html`).
- [ ] `duo html new` + `duo edit <path.html>` (alias under the existing `duo edit` if extension is `.html`).
- [ ] Iframe-srcdoc host with contentEditable on body; render-on-write.
- [ ] Top toolbar (H28 inline marks + link picker).
- [ ] Save: autosave + `⌘S` + dirty dot (H33).
- [ ] Skill stub (H16) — README only, no snippets yet.
- **Exit:** PM opens an `.html`, edits prose, saves; the file is clean HTML another tool can read.

### 19b — Stable IDs + sidecar foundation (~2 PRs)
- [ ] ULID minting + auto-injection (H12, H13).
- [ ] First-open prompt for ID injection (H14).
- [ ] Sidecar reader / writer; `version: 1` schema (H22).
- [ ] `duo html query / get / set / replace / append / remove / attr` end-to-end.
- [ ] `data-duo-component` recognition (no UI yet).
- **Exit:** Claude edits a specific element by `data-duo-id`; the change persists; the sidecar tracks the edit.

### 19c — Agent overlay + selection (~2 PRs)
- [ ] Atelier just-added highlight (H20) for agent edits.
- [ ] `recentEdits` log + repaint-at-open within freshness window.
- [ ] `duo selection` for canvas (H25).
- [ ] Persistent blurred selection (H26).
- [ ] Send → Duo pill on canvas surface (H27).
- [ ] Warn-before-overwrite banner (H36).
- **Exit:** PM selects on the canvas, hits the pill, terminal gets the quoted block; agent writes back, the change paints yellow.

### 19d — Comments + lock convention (~3 PRs)
- [ ] `duo html comment`; comment rail re-used from Stage 11 (H23).
- [ ] Range resolution against `data-duo-id` + textPath (H21).
- [ ] Resolve / reply / accept UX (re-use Stage 11 D19).
- [ ] `data-duo-lock="structure"` rendering + ⌥-click override (H19).
- [ ] Skill snippet bundle (H17 boilerplate, H18 ten core components).
- **Exit:** PM leaves a comment on a callout; Claude reads it via `duo html changes` (or a `duo html comments` flag) and acts.

### 19e — Polish + scripts + source view (~2 PRs)
- [ ] Script opt-in dialog (H8) + sidecar persistence (H22).
- [ ] Source view toggle with CodeMirror 6 (H32).
- [ ] Find & replace (`⌘F` / `⌘⌥F`) — re-use Stage 11 component if feasible.
- [ ] External-write reconciliation (H35) — re-use Stage 11's three-pane diff.
- [ ] Slash menu (H29).
- [ ] Floating selection bubble (H30).
- **Exit:** the canvas feels native enough that an HTML report from Claude is the natural artifact, not the markdown.

Total: ~12–14 PRs. Sequenced so 19a unlocks real usage and every later stage adds capability cleanly.

---

## 8. Risks + open questions

- **contentEditable quirks.** Cross-browser contentEditable is famously inconsistent. We're single-browser (Chromium via Electron), which mitigates most of it, but Chromium's contentEditable still has edge cases (Enter inside list items, deletion across block boundaries, paste handling). Mitigation: write a thin normalization layer on day one; build a regression set against the H18 snippets.
- **Arbitrary HTML + ID injection.** Some files (legacy templates, server-rendered pages) carry IDs we'd collide with or class patterns we don't want to mutate. The H14 prompt is the v1 escape valve; if it's annoying, add a per-directory toggle into the navigator's right-click menu.
- **Iframe sandbox vs script execution model.** Same-process srcdoc gives synchronous DOM access but no real isolation; if a malicious file ran scripts it could reach the parent renderer. Mitigation: H8's script opt-in is the gate. Long-term, move to `WebContentsView` for script-allowed files (true OS-level isolation, async DOM bridge via CDP) — defer until we see threats.
- **Sidecar file management.** Two files per canvas means: copy / rename in Finder loses the sidecar; git PRs need both. Mitigation: when the user copies / renames the `.html` *inside Duo* (right-click → rename, or `duo mv`), the sidecar follows. External moves are accepted as data loss. Document explicitly.
- **`document.execCommand` is deprecated.** H28 deliberately rejects it; we write our own selection-aware mark applicator on day one. Capture as a non-negotiable in 19a.
- **Open question — should `data-duo-id` survive in production HTML?** The user might publish the `.html` to a website. The IDs are harmless (plain data attributes) but visually noisy in source. Possible: a `duo html export` command that strips Duo-specific attributes. Decide at 19e.
- **Open question — Tailwind CDN vs inline styles.** H17 boilerplate proposes Tailwind via CDN behind script-opt-in. Alternative: ship a Duo-bundled minimal CSS that approximates Tailwind's most-used utilities — no CDN, no script gate. Decide at 19d kickoff before snippets harden.
- **Open question — markdown blocks inside HTML.** A `<div data-duo-md>…</div>` block that renders as live markdown inside the canvas would be a nice cross-stage feature, riffing on the progressive-disclosure pattern. Defer to a Stage 19f or beyond.
- **Open question — Duo-authored scripts in this session.** Claude generating a one-page interactive checklist with inline `<script>` is a real use case. The H8 prompt is fine for "agent gave me a sketchy file," but for "Claude just wrote this in *this* session" prompting feels like over-friction. Consider a "trust files Duo created in this session by default" rule. Decide at 19e.
- **Open question — embedded comments in the file vs sidecar only.** H21/H22 puts comments entirely in the sidecar so the `.html` stays pristine. Alternative: also emit `<!-- duo:cmt id="…" -->` HTML comments inline so a sidecar-less copy still preserves anchor positions. Adds noise to the file but increases robustness. Decide at 19d.

---

## 9. Success criteria

- A PM opens an `.html` file Claude generated, edits two paragraphs and a table cell, leaves a comment on a third element, and saves — and the file opens cleanly in any browser.
- When Claude rewrites an element via `duo html replace`, the user sees exactly which element changed (yellow Atelier highlight) and where (margin chip), without having to flip to source view.
- The user never sees `data-duo-id` attributes in the rendered canvas; they're addressing primitives, not user-facing chrome. Power users can see them via "View source."
- A `.html` file with no Duo conventions at all (raw HTML pasted from anywhere) opens, renders, and edits without the canvas crashing or reformatting unexpected markup.
- Send → Duo on the canvas surface lands the same shape of payload in the terminal as it does from a markdown editor or a browser tab — one primitive, three modalities.
