# Stage 27 PRD — Canvas authoring vocabulary + skill

> **Status:** spec drafted 2026-05-01. Sprint A of the FTUX-tutorial
> initiative. Filed in `ROADMAP.md` and `docs/roadmap.html#s27`.
>
> **Why this stage exists.** After v0.5.5 walk-2 passed, the owner
> deferred the cut and articulated a richer initiative: build the
> *primitives* for interactive canvas content, THEN use them to author
> tutorial packs. Stage 27 is the primitives. Stage 28 is the content.
> Stage 18b (already filed) is the distribution.
>
> **Owner framing (verbatim, from the planning AUQ on 2026-05-01):**
> "I want to be able to generate and preload some tutorial content for
> new users and rather than hand building these tutorials and manually
> forcing them into the app, I want to build and then use these
> patterns/primitives." Plus: "we should build and use enduring
> primitives like pinning and closing, and not rely on too much use
> case specific config and logic if it can be avoided."
>
> **Slot in roadmap:** Layer 2 (new surfaces). Extends Stage 23's
> three-verb canvas-action vocabulary. Subsumes Stage 17a.5 Direction
> A (template gallery — the five reference templates ARE the seed).
> Folds in ENH-020 (canvas authoring skill) and ENH-034 (canvas
> edit-mode toggle). Sequenced before Stage 28 (Sprint C content);
> can run independently of Stage 18b (distro packs — Sprint B —
> tutorials hand-install via `cp -r` until 18b lands).

---

## 1. What we're building

Six new canvas-action verbs, a streaming agent-event CLI, a form-input
binding pattern, a routing convention for default-editable mode, a
canvas authoring skill, and five reference templates. All in source
files under `renderer/components/HtmlCanvas/`, `core/`, `cli/`,
`shared/`, and `skill/`.

**No tutorial content lands here** — that's Stage 28. Stage 27's
deliverable is the primitives a tutorial can be assembled from.

**Validation goal for Sprint A:** by the end of the sprint, a
hand-built test canvas at `docs/dev/smoke-walks/stage-27-test.html`
should exercise every primitive (each verb, the form binding, the
event stream, the default-editable mode, all five templates rendered
and interacted with). Anywhere we have to escape the convention to
build that test canvas is a primitive gap that needs another commit
before Sprint B.

---

## 2. Background — what's already shipped (so we know what we extend)

- **Stage 23 (✅ v0.3.0)** — three canvas-action verbs:
  - `claude:spawn` — opens a new claude tab in `data-cwd` and
    optionally writes `data-cmd` to the new PTY as the first message.
  - `terminal:send` — writes `data-text` to the active PTY; optional
    `data-enter="true"` for an auto-Return.
  - `browser:open` — opens `data-url` (routes through the
    external-domain blocklist).
- **Trust gate:** path-restricted to `~/.claude/duo/` + the project
  root. Buttons in untrusted folders show a "Trust this folder?"
  prompt on first click. Stage 27's new verbs inherit the same gate.
- **Dispatcher:** `renderer/components/HtmlCanvas/canvasActions.ts`
  installs a delegated capture-phase listener on the iframe document.
  No `allow-scripts` needed — the canvas iframe stays sandboxed.
- **CDP selection observer (Stage 15.2)** — IIFE injected into the
  page that pushes selection state via `Runtime.addBinding`. Stage 27
  doesn't touch this. `duo:event` reuses the same binding pattern.
- **`duo html update --selector "<css>" --html "<…>"`** (Stage 17b)
  already exists — used by Stage 27 to paint into `data-duo-pane`
  regions. NO new CLI surface for paint; just document the convention.

---

## 3. Decisions (locked via AUQ on 2026-05-01)

| D# | Decision | Rationale |
|---|---|---|
| **D27.1** | Sprint A scope = broad sweep: 6 new verbs (the MVP three plus `selection:set` / `theme:set` / `terminal:focus`). | Owner picked option B in the AUQ. Lets tutorials orchestrate the full Duo surface, not just file/nav/event. Risk acknowledged: building verbs without a real consumer; Stage 28 is the consumer. |
| **D27.2** | `duo:event` agent-side hook = streaming `duo events --follow`. | Pulls in [issue #19](https://github.com/dudgeon/duo/issues/19) from the 15-family backlog. Composable with shell pipelines. Agents get one JSON line per event; cursor support for skip-ahead on resume. |
| **D27.3** | Templates seed = five (button-card, paint-target, form-input, lesson-scaffold, dashboard). | Owner picked option B in the templates AUQ. Anticipates Sprint C tutorial layouts. Direction A from Stage 17a.5 wins by default. |
| **D27.4** | `<meta name="duo-default-editable">` ships in Sprint A as a ride-along (folds in ENH-034). | Tutorials want canvas rendering but read-only-by-default; without this, click handlers compete with cursor placements. Toolbar toggle button lets the user opt into editing. |
| **D27.5** | `data-payload-from` binding ships in Sprint A. | Owner emphasized "UI elements the user can populate and push to Duo for next steps." This is the load-bearing form-input pattern. |
| **D27.6** | No new CLI for paint operations — reuse `duo html update --selector "[data-duo-pane=…]"`. | Owner emphasized "build and use enduring primitives… not rely on too much use case specific config." `data-duo-pane` is just a stable-selector convention; the existing CLI already handles writes. |
| **D27.7** | Skill at `skill/canvas-authoring.md` (NEW), separate from existing `skill/SKILL.md`. | Mirrors how `skill/examples/canvas-actions.md` (Stage 23) is a focused per-topic page. Cross-linked from `SKILL.md`. `npm run sync:claude` already copies all of `skill/`. |

---

## 4. The six new action verbs

Each verb is a new case in the `canvasActions.ts` dispatcher. All
verbs read their parameters from `data-*` attributes on the clicked
element (matches Stage 23 pattern). Trust gate inherited from Stage 23.

### D27.A1 — `editor:open`

```html
<button data-action="editor:open" data-path="~/notes/today.md">
  Open today's notes
</button>
```

- `data-path` (required) — absolute path, `~/`-relative, or relative
  to the file containing the button. Resolves via existing path
  helpers.
- `data-mode` (optional) — `editor` (default) | `canvas` | `browser`.
  Forces routing surface; falls back to `openFileSmart` (which
  honors `<meta name="duo-open-in">` if present).
- Implementation: dispatch IPC to call existing `openFileSmart` in
  `renderer/App.tsx`. Wire via a new `IPC.CANVAS_ACTION_EDITOR_OPEN`
  channel handled in main, OR (simpler) the canvas action handler
  posts a renderer-internal CustomEvent that `App.tsx` listens for
  via the existing event-dispatch pattern. Lean toward the
  CustomEvent path — no new IPC if the action stays in renderer.

### D27.A2 — `nav:reveal`

```html
<button data-action="nav:reveal" data-path="~/notes/today.md">
  Show in navigator
</button>
```

- `data-path` (required) — same resolution as `editor:open`.
- Implementation: dispatch a renderer CustomEvent that the existing
  `onRevealInNavigator` handler in `App.tsx` (used by file-tab
  context menu) listens for. Existing logic walks the tree, expands
  ancestors, scrolls + selects. No new code path — just a new entry
  point.

### D27.A3 — `selection:set`

```html
<button data-action="selection:set"
        data-target="editor"
        data-text="## My heading">
  Jump to heading
</button>
```

- `data-target` (required) — `editor` | `canvas`.
- One of:
  - `data-text="<string>"` — find first occurrence and select it
  - `data-line="<n>"` — go to line N (editor only — no concept of
    line in canvas)
  - `data-anchor="<id>"` — find element by `data-duo-id` (canvas only)
- Implementation: editor target reuses existing `duo doc goto`
  internals (`IPC.EDITOR_DOC_GOTO`); canvas target reuses
  `IPC.CANVAS_HTML_OP` with a new `op: 'select'` discriminant (or
  picks an existing one — audit during impl).
- **Defer** if any branch above adds significant new code: ship
  text-only for editor + anchor-only for canvas in v1, file the
  rest as Stage 27.5.

### D27.A4 — `theme:set`

```html
<button data-action="theme:set" data-theme="dark">Dark mode</button>
```

- `data-theme` (required) — `light` | `dark` | `system`.
- Implementation: existing theme IPC at `IPC.THEME_SET` is already
  in place (used by the titlebar toggle). Canvas action just calls it.

### D27.A5 — `terminal:focus`

```html
<button data-action="terminal:focus">Focus the terminal</button>
<button data-action="terminal:focus" data-tab-id="terminal-3">
  Focus terminal 3
</button>
```

- `data-tab-id` (optional) — focus a specific terminal tab by id;
  default = active terminal.
- Implementation: existing pane-focus IPC + the App.tsx state owns
  active-terminal logic. New action handler dispatches a renderer
  CustomEvent that App.tsx already listens for (the same path the
  ⌘\` toggle uses).

### D27.A6 — `duo:event`

```html
<button data-action="duo:event"
        data-event="lesson-step-1-done"
        data-payload='{"score": 5}'>
  Next step
</button>

<input id="user-name" type="text" placeholder="Your name" />
<button data-action="duo:event"
        data-event="user-introduced"
        data-payload-from="#user-name">
  Submit
</button>
```

- `data-event` (required) — string event name. Convention:
  `<source>-<noun>-<verb>` e.g. `lesson-step-1-done`.
- `data-payload` (optional) — JSON object literal merged into the
  emitted event payload.
- `data-payload-from` (optional) — CSS selector. Reads `.value`
  from the matched form element and adds it as `payload.value`.
- Implementation: emit through `core/event-bus.ts` (new — see § 5).
  The renderer-side action handler posts via a new
  `IPC.CANVAS_DUO_EVENT_EMIT` channel; main inserts into the bus;
  bus pushes to any open `duo events --follow` subscribers and
  also broadcasts to renderer (so future renderer-side hooks can
  listen too).

---

## 5. `duo events --follow` — the streaming CLI verb

Pulls in [issue #19](https://github.com/dudgeon/duo/issues/19).

### D27.E1 — `core/event-bus.ts` (new file)

In-memory pub/sub with a 200-event ring buffer. Shape:

```ts
export interface DuoEvent {
  /** Monotonic, sortable. Format: `<unix-ms>-<seq>` so two events at
   *  the same millisecond stay ordered. */
  cursor: string
  /** ISO 8601 wall-clock timestamp. */
  ts: string
  /** Where the event originated. */
  source: 'canvas' | 'editor' | 'cli' | 'main' | 'renderer'
  /** Free-form event name; convention `<noun>-<verb>` e.g.
   *  `lesson-step-done`, `selection-changed`. */
  name: string
  /** Optional structured payload. */
  payload?: Record<string, unknown>
}
```

API:
```ts
emit(event: Omit<DuoEvent, 'cursor' | 'ts'>): DuoEvent
subscribe(cb: (event: DuoEvent) => void, opts?: { since?: string }): () => void
listSince(cursor: string | undefined, limit?: number): DuoEvent[]
```

- Ring size: 200 (configurable via `DUO_EVENT_RING_SIZE` env var).
- `subscribe` with `since: cursor` first replays any events in the
  ring with cursor > `since`, then attaches a live listener.
- The bus lives in main process. Renderer pushes events via IPC.
  CLI streams via socket.

### D27.E2 — Socket-server streaming case

`core/socket-server.ts` grows a new command handler for `events`:

```jsonc
// Request
{ "cmd": "events", "args": { "follow": true, "since": "1714589123-3" } }

// Response: streaming JSON lines until socket closes.
// Each line is one DuoEvent.
{"cursor":"1714589125-1","ts":"...","source":"canvas","name":"...","payload":{...}}
{"cursor":"1714589126-1",...}
```

- Non-`follow` case: list `since` events (from the ring), close.
- `follow: true`: list `since` events first, then attach subscriber,
  emit each future event as a JSON line.
- Client closing the socket = unsubscribe. No leak risk.
- One-shot version (`duo events [--since X]` without `--follow`)
  prints the ring snapshot and exits.

### D27.E3 — `cli/duo.ts` verb

```bash
duo events                       # snapshot of recent events; exits
duo events --since <cursor>      # snapshot since cursor; exits
duo events --follow              # stream forever (or until killed)
duo events --follow --since X    # stream from cursor X forward
```

- Stdout: one JSON line per event (no pretty-printing — agents
  parse).
- Stderr: nothing on success; error string on failure.
- Plumbing checklist (CLAUDE.md item 4): `shared/types.ts` (`DuoCommandName`),
  `electron/preload.ts` (no new renderer API — main-only), `electron/main.ts`
  (no new IPC unless needed), `core/socket-server.ts` (new case +
  streaming protocol), `cli/duo.ts` (verb + `printHelp()`),
  `skill/SKILL.md` (agent discovery), `agents/duo.md` (cheat-sheet entry),
  `docs/CLI-COVERAGE.md` (inventory).

---

## 6. `data-payload-from` form-input binding

Tiny diff inside the `duo:event` handler in `canvasActions.ts`:

```ts
function captureFormValue(doc: Document, selector: string | undefined): unknown {
  if (!selector) return undefined
  const el = doc.querySelector(selector)
  if (!el) return undefined
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked
    return el.value
  }
  if (el instanceof HTMLTextAreaElement) return el.value
  if (el instanceof HTMLSelectElement) return el.value
  return undefined
}
```

The `duo:event` dispatcher:
```ts
const payloadFromSel = el.dataset.payloadFrom
const captured = captureFormValue(doc, payloadFromSel)
const payload = {
  ...JSON.parse(el.dataset.payload ?? '{}'),
  ...(captured !== undefined ? { value: captured } : {})
}
```

Documented in `skill/canvas-authoring.md` with the form-input.html
template as a worked example.

---

## 7. `<meta name="duo-default-editable">` (folds in ENH-034)

### D27.M1 — Meta read

`electron/files-service.ts § getHtmlMeta`:
```ts
const editable = head.match(
  /<meta\s+[^>]*name\s*=\s*["']duo-default-editable["'][^>]*content\s*=\s*["'](true|false)["']/i
)
if (editable) meta.defaultEditable = editable[1] === 'true'
```

`shared/host-api.ts § HtmlFileMeta`:
```ts
defaultEditable?: boolean   // undefined = backward-compat default (true)
```

### D27.M2 — Initial canvas state

`renderer/components/HtmlCanvas/CanvasTab.tsx`:
- `readOnly` initial state: `meta.defaultEditable === false ? true : (existing path-trust default)`.
- Per-path localStorage override key: `duo-canvas-editable-override:<absPath>`.
  When set, takes precedence over the meta hint.

### D27.M3 — Toolbar toggle button

`renderer/components/HtmlCanvas/CanvasTab.tsx` toolbar grows a new
button between the existing toolbar and the comment-rail toggle:
- 🔓 (unlocked) when read-only, label "Edit"
- ✏️ (locked) when editable, label "Read-only"
- Click flips `readOnly`, persists override to localStorage, fires
  a small toast.

---

## 8. Authoring skill at `skill/canvas-authoring.md`

Full reference. Sections:

1. **When to canvas vs. browser vs. markdown editor.** Decision tree.
2. **The contract — what the canvas runtime promises.** Iframe
   sandboxed (no `allow-scripts`); delegated action listeners via
   `data-action`; `data-duo-id` for stable anchors; `data-duo-pane`
   for stable paint regions; `data-payload-from` for form inputs.
3. **Action vocabulary cheat sheet.** All 9 verbs (3 from Stage 23 +
   6 new), with one-line examples each.
4. **Stable IDs (`data-duo-id`).** When to stamp them; using
   `duo html stamp-ids` (manual now that auto-inject is off);
   using meaningful suffixes on important elements
   (`data-duo-id="canvas-pane-result"`).
5. **Paint regions (`data-duo-pane`).** Convention for stable
   selectors; `duo html update --selector "[data-duo-pane=…]"
   --html "…"` is the agent-side write path.
6. **Form inputs.** `data-payload-from` patterns; how the agent
   receives the value.
7. **Agent-side: `duo events --follow`.** Subscription patterns;
   resume-from-cursor; common event-name conventions.
8. **Routing & mode meta tags.** `<meta name="duo-open-in">`,
   `<meta name="duo-default-editable">`, when to use which.
9. **Anti-patterns.** Don't put scripts that need network. Don't
   paint into the same pane on every event (race-y). Don't rely on
   localStorage for cross-canvas state. Don't fire `claude:spawn`
   without a clear `data-cwd` (lands in unspecified directory).
10. **Worked example: a click-through tutorial canvas.** Walk through
    `lesson-scaffold.html` in detail.

`npm run sync:claude` after.

---

## 9. Five reference templates at `skill/examples/canvas-templates/`

Each is ~50–100 lines, valid HTML5, Atelier palette tokens
(`--paper`, `--ink`, `--accent` etc.) inline-defined for
self-containedness, includes `<meta name="duo-default-editable" content="false">`,
and starts with a `<!-- How this works -->` comment header.

| Template | Demonstrates | Stage 28 use case |
|---|---|---|
| `button-card.html` | Card layout + CTA button using `editor:open` | Birdhouse #1 launcher |
| `paint-target.html` | Layout with `data-duo-pane="result"` for `duo html update --selector` | Lesson result panel |
| `form-input.html` | `<textarea>` + button using `data-payload-from` to push value as `duo:event` | "Tell me your name" |
| `lesson-scaffold.html` | Multi-step layout: header pane, body pane, "Next step" button → `duo:event` | Pack A intro-to-duo body |
| `dashboard.html` | Multi-pane layout with refresh buttons that paint independently | Personal home page |

---

## 10. Commit-by-commit sequence

| # | Commit | Files touched | Verifies |
|---|---|---|---|
| 1 | Six action verbs in canvasActions.ts | `renderer/components/HtmlCanvas/canvasActions.ts`, `renderer/App.tsx` (CustomEvent listeners), maybe `shared/types.ts` for new IPC channels | Hand-built test canvas; each verb fires correctly; trust gate honored |
| 2 | `core/event-bus.ts` + `duo events --follow` | NEW `core/event-bus.ts`, `core/socket-server.ts`, `cli/duo.ts`, `cli/duo` (rebuilt), `shared/types.ts`, `skill/SKILL.md`, `agents/duo.md`, `docs/CLI-COVERAGE.md` | `duo events --follow` streams events; `duo:event` clicks reach the agent; ring buffer size correct; cursor resume works |
| 3 | `data-payload-from` form-input binding | `renderer/components/HtmlCanvas/canvasActions.ts` (small) | Test canvas with `<input>` + button captures value into payload |
| 4 | `<meta name="duo-default-editable">` (ENH-034) | `electron/files-service.ts`, `shared/host-api.ts`, `renderer/components/HtmlCanvas/CanvasTab.tsx`, `renderer/components/HtmlCanvas/EditorToolbar.tsx` (or wherever toolbar lives) | Open canvas with meta:false; canvas read-only; toggle button flips; localStorage override persists |
| 5 | Authoring skill at `skill/canvas-authoring.md` | NEW skill file; cross-link in `skill/SKILL.md` | `npm run sync:claude` succeeds; live skill installed at `~/.claude/skills/duo/canvas-authoring.md` |
| 6 | Five reference templates | NEW `skill/examples/canvas-templates/*.html` (5 files) | Each template renders correctly; `duo open <template>` opens in canvas; click-through works |

End-of-sprint smoke walk: `docs/dev/smoke-walks/v0.6.0-stage-27-rev1.json`
+ `.html` (skipping the `v0.5.5` numbering since v0.5.5 won't cut on
its own — folds into v0.6.0).

---

## 11. Plumbing checklist coverage (CLAUDE.md item 4)

For each new CLI verb (`duo events --follow`):
- [x] `shared/types.ts` — `DuoCommandName` add `events`; new IPC if needed
- [x] `electron/preload.ts` — main-process-only verb; no renderer API
- [x] `electron/main.ts` — handler registration via socket-server; no new ipcMain
- [x] `core/socket-server.ts` — new streaming case
- [x] `cli/duo.ts` — verb + `printHelp()` update; rebuild `cli/duo` binary
- [x] `skill/SKILL.md` — agent discovery; run `npm run sync:claude`
- [x] `agents/duo.md` — verb cheat-sheet entry under `## Verb cheat-sheet`
- [x] `docs/CLI-COVERAGE.md` — inventory entry

For each new canvas action verb (6 of them):
- [x] `canvasActions.ts` — new case in dispatcher
- [x] `skill/canvas-authoring.md` — example
- [x] `agents/duo.md` cheat-sheet entry

---

## 12. Out of scope for Stage 27

- Tutorial CONTENT (Stage 28).
- Distro pack format / install machinery (Stage 18b).
- Stage 17e proper (script opt-in dialog, source view, find/replace,
  external-write reconciliation) — orthogonal; stays filed under 17e.
- Stage 17d-B (lock convention) and Stage 17d-C (HTML snippet bundle —
  callout / comparison-table / etc., for general status-report
  authoring) — separate authoring concerns; stay filed.
- New IPC for paint operations (`duo html update --selector` already
  exists; just document the convention).
- Any agent-side state machine for tutorials (Stage 28's lesson skill
  owns that, scoped per pack).

---

## 13. Cross-refs

- `ROADMAP.md` line 184 — Stage 27 entry
- `docs/roadmap.html#s27` — Stage 27 card
- `docs/prd/stage-23-canvas-actions.md` — TBD (Stage 23 PRD if it exists; current canvas-action vocabulary)
- `docs/prd/stage-28-lesson-packs.md` — Sprint C consumer
- `skill/examples/canvas-actions.md` — Stage 23 worked example
- ENH-020, ENH-027, ENH-034 — folded in / closed by Stage 27
- Issue #19 — `duo events --follow` (pulled in)

---

## 14. Verification (smoke-walk punch list at sprint end)

| V# | Item | How to verify |
|---|---|---|
| V1 | `editor:open` opens a markdown file in the editor | Click button on test canvas; markdown editor mounts |
| V2 | `editor:open` honors `data-mode="canvas"` for HTML | Click; HTML opens in canvas, not browser |
| V3 | `nav:reveal` reveals path + selects in navigator | Click; navigator scrolls to row, row highlighted |
| V4 | `selection:set` (text) jumps to first match in editor | Click; editor scrolls + highlights |
| V5 | `selection:set` (anchor) jumps to canvas element by `data-duo-id` | Click; canvas scrolls + element highlighted |
| V6 | `theme:set` flips light/dark | Click; theme toggles |
| V7 | `terminal:focus` puts focus on active terminal | Click; xterm has focus, ⌘\` would toggle to working pane |
| V8 | `duo:event` fires; appears in `duo events --follow` | Run in another terminal; click; line appears with correct payload |
| V9 | `data-payload-from` captures input value | Type into input; click; event payload includes `value` |
| V10 | `data-payload-from` works with checkbox | Toggle; click; event payload `value: true/false` |
| V11 | `<meta name="duo-default-editable" content="false">` opens read-only | Open canvas with meta; cursor doesn't appear on click |
| V12 | Toolbar toggle flips read-only state | Click pencil/eye icon; state flips; persists via localStorage |
| V13 | `duo events --follow` streams live | Subscribe; emit from canvas; see line within ~50ms |
| V14 | `duo events --since <cursor>` resumes from cursor | Emit, kill subscriber, restart with cursor; missed events replay |
| V15 | Five templates render correctly | `duo open <each>` ; visual smoke; click-through with mocked agent works |
| V16 | Trust gate still honors path restriction | Open a template from outside `~/.claude/duo/`; first click prompts trust |
| V17 | Skill at `~/.claude/skills/duo/canvas-authoring.md` post-sync | `ls`; spot-check content |

---

## 15. Open questions to surface as work begins

- **`selection:set` for canvas — does it use existing `op: 'select'` or a new op?** Audit `htmlOps.ts` during Commit 1.
- **`editor:open` IPC vs. CustomEvent:** lean toward CustomEvent for lower friction. Confirm during Commit 1.
- **`duo events --follow` socket protocol — line-delimited JSON or length-prefixed?** Existing socket protocol is request/response with JSON bodies. Streaming is new. Pick LDJSON for simplicity (each line is `JSON.stringify(event) + "\n"`); document.
- **`shared/feature-flags.ts` — does `duo:event` need a flag?** Probably no; primitive is small + harmless. Skip.
- **Existing `duo events` ENH currently filed?** Search tasks.md / GitHub issue #19 first; don't double-file.
