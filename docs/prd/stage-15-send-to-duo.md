# Stage 15 PRD — "Send → Duo" cross-modality selection primitive

> **Status:** spec drafted 2026-04-25 (originally as Stage 15g).
> Visual spec added 2026-04-26 (Atelier mock). Renumbered 2026-04-26
> to top-level Stage 15 — promoted from sub-item under the original
> Stage 15 grab-bag because it's the L1 priority unlock; the rest of
> the original 15a–f primitives moved to backlog. Not started.
> **Slot in roadmap:** Stage 15, in Layer 1 (editor maturation).
> Depends on Stage 12 (Atelier visual foundation — supplies the pill
> chrome). The other primitives originally clustered as 15a–f are
> backlog; ship them when convenient.
> **References:**
> - [the roadmap § Stage 15](../roadmap.html) — slot in build order +
>   layered dependencies
> - [docs/VISION.md](../VISION.md) — collaboration as the flagship bet
> - [docs/CLI-COVERAGE.md § Browser observability](../CLI-COVERAGE.md) —
>   the unified `duo selection` primitive this builds on
> - [docs/prd/stage-11-markdown-editor.md § D29c](stage-11-markdown-editor.md) —
>   editor selection persistence (already shipped); the visual half of
>   this primitive on the editor side
> - Stage 15e (`duo zap`) — agent-driven cousin: agent picks an element,
>   pipes a packet to the active terminal. Stage 15 is the
>   user-driven version of the same loop.
> - **[docs/design/atelier/](../design/atelier/)** — visual spec for
>   the floating pill, the click-to-fire animation, and the terminal
>   payload-injection treatment. The 16-second demo loop in
>   [Duo Prototype.html](../design/atelier/project/Duo%20Prototype.html)
>   shows the full flow at t=2.0s–4.5s
>   (selection glow → pill appears → pill click drops + fades →
>   terminal swaps to Claude tab and the quoted payload appears with
>   provenance line, cursor blinking with no Enter pressed). The
>   `SendToDuoPill` component in
>   [duo-components.jsx](../design/atelier/project/duo-components.jsx)
>   is the geometric reference. Read [the bundle README](../design/atelier/README.md)
>   before implementing the UI.

---

## 1. What we're building

A **single floating affordance** that appears next to any user
selection in any tab type inside the right-column WorkingPane —
browser, markdown editor, future HTML/code editor, future image/PDF
preview — labelled "Send → Duo" (placeholder text). One click pipes
the selection into the active terminal's input line, with no Enter
pressed, so the user can complete the prompt with a verb of their
choosing ("rewrite this", "summarize this", "find similar issues").

The button is **the user-facing complement** to the agent-facing
`duo selection` verb: same payload, opposite direction.

The "rich push/pull between terminal and work area" the owner asked
for in the brief is a two-axis grid:

|  | **Read by agent** (CLI) | **Sent by user** (UI) |
|---|---|---|
| **Editor** | `duo selection` (shipped, Stage 11 D29a) | Send → Duo button (this stage) |
| **Browser** | `duo selection` (P0 gap, see CLI-COVERAGE) | Send → Duo button (this stage) |
| **Preview** | future | future |

Stage 15 lands the bottom row across modalities **and** consolidates
the top row into one verb shape.

---

## 2. Personas + jobs to be done

**Primary persona:** the same PM. They've selected a sentence in their
PRD or a paragraph on a competitor's website. They want to ask Claude
to do something *with that text*, in the agent's natural language —
without copy-paste, without typing the path to the file, without
losing track of which paragraph they meant.

Jobs:
- "Take this paragraph and emphasize the point in this sentence I
  highlighted."
- "Find me three quotes from competitors that contradict this claim."
- "Rephrase this for our voice."
- "Summarize what I'm reading."
- "Rewrite this section so it flows better."

Today the PM has to: copy → switch focus → paste into terminal → type
their verb → the agent has to *guess* what file/url/heading the text
came from. Stage 15 compresses that to: select → click → type verb →
Enter.

Job this stage does **not** do:
- Replace the agent-driven `duo zap` (which is the *agent-picks-the-element*
  flow). Stage 15 is *user-picks-the-selection*. Both ship.
- Multi-selection (selecting two ranges, sending both as one message).
  Defer to a follow-up.

---

## 3. Resolved decisions — owner to confirm

(Marked with `?` where I'm proposing a default; please flip if wrong.)

| # | Area | Proposal |
|---|---|---|
| **Affordance** | | |
| G1 | **Trigger** | The button appears whenever a non-empty selection exists in any WorkingPane tab. Disappears on selection collapse, on focus loss to a non-WorkingPane element (e.g. terminal, files), and on click (after firing the action). |
| G2 | **Position** | Floating, anchored ~6px above the top-right of the selection's bounding rect. Falls back to below if there's no room above. Stays in viewport on scroll (re-anchors on `selectionchange` / `scroll`). |
| G3 | **Label + icon** | "Send → Duo" with a small arrow glyph (placeholder per owner). Final wording TBD; could be "Send to terminal", "Quote to agent", etc. |
| G4 | **Style** | Small purple pill matching the editor's accent (`#7c6af7`); 11–12px text; slight drop-shadow so it reads above body content. Same in light + dark themes. |
| G5? | **Keyboard shortcut** | `⌘D` while a selection exists in the WorkingPane = same as clicking the button. Doesn't conflict with browser bookmarks (we own the focus surface). |
| **Payload** | | |
| G6 | **Cross-modality shape** | One discriminated union, matching `duo selection`: `{kind:"editor",path,text,paragraph,heading_trail,start,end}` \| `{kind:"browser",url,page_title,text,surrounding?,selector_path?}` \| future `{kind:"preview",path,text}`. The button reads from the same source the CLI reads from — no duplicate plumbing. |
| G7 | **Browser selection** | Captured via the page-side script that already needs to exist for the unified `duo selection`. For canvas apps (Google Docs/Sheets/Slides/Figma), the script prefers app-specific accessors (`_docs_annotate_getAnnotatedText('').getSelection()` for Docs) and falls back to `window.getSelection()`. |
| G8 | **Images / tables / mixed content** | v1 sends **plain text** (the text content of the selection range). Tables flatten to GFM pipe text. Images become `[image: alt or src]` placeholders. v2 can grow rich payloads (HTML / markdown / asset paths) once we know what agents need. |
| G9 | **Length cap** | 16 KB of selected text. Above that, truncate to 8 KB head + 8 KB tail with a `… (truncated, full text via duo selection) …` marker. The agent can still call `duo selection` for the full content. |
| **Injection format** | | |
| G10 | **Default format (locked 2026-04-25)** | **Default = Option A:** quote block + 1-line provenance, no Enter. Example for editor: `> "performance is critical especially for users on mobile"\n> (~/projects/foo/prd.md · Risks > Market)\n` followed by a space for the user's verb. Most forgiving across raw shells *and* Claude Code's Ink composer; readable to a human glancing at the terminal even when no agent is present. The format is **runtime-configurable** (G19) so an agent can switch to a different mode for its session. Alternatives kept on the books: **Option B** literal text only (no provenance — agent relies on `duo selection` for context), **Option C** opaque token like `<<duo-sel-abc123>>` (most compact; requires the skill to teach Claude to expand it via `duo selection`). |
| G11 | **No Enter pressed** | Matches Stage 15d (`duo tab --cmd`). The user always confirms by hitting Enter themselves. Honest-consent loop. |
| G12 | **Multi-line selections** | Each selected line becomes its own quoted line in the injected block, preserving the user's mental model of where the boundaries are. |
| **Routing** | | |
| G13 | **Target terminal** | The active terminal tab as of click time. If the focused column is the WorkingPane (which it always is when the selection exists), the *active terminal* is the most-recently-focused terminal tab. |
| G14 | **Terminal not running an agent** | The text just lands at the shell prompt. The user can edit it freely before pressing Enter. No special handling. |
| G15 | **Composer field — naming** | The receiver in the terminal isn't a "composer" in the strict sense — it's whatever process owns stdin (a shell, Claude Code's Ink editor, vim, etc.). We write to PTY stdin via `pty.write(activeTerminalId, text)`. Internal docs call this the "active terminal input"; UI strings can keep "Send → Duo" since users don't need to know the mechanism. |
| **Persistence + reuse** | | |
| G16 | **The cached selection survives focus changes** | The Stage 11 D29c "persistent selection" already paints the editor selection while focus is in the terminal. Browser selection persistence is a new piece — the browser doesn't natively repaint its selection while blurred. We can either let it disappear visually (browser convention) or paint a CDP-driven overlay (more work; defer). v1 = browser selection visually disappears when terminal takes focus, but the **payload is captured at click time** so the agent still sees what the user meant. |
| **CLI symmetry** | | |
| G17 | **`duo send` CLI** | The button's logical inverse: a CLI verb that takes a payload (`{kind, text, …}` or `--text "…"` or stdin) and writes it into the active terminal as if a Send → Duo had fired. Useful for *agents* that want to plant context for the user (e.g. "you might want to ask me about this"). Same plumbing in main / preload / pty-manager. |
| G18 | **`duo selection` browser support** | Implemented as part of this stage (P0 in CLI-COVERAGE). Same wire format as the editor variant. Single source of truth: a renderer-side selection observer pushes `EDITOR_SELECTION_PUSH` (rename to `WORKING_SELECTION_PUSH`) regardless of which WorkingPane tab is active. |
| **Format switch** | | |
| G19 | **Selection format is runtime-configurable** | The injected payload format (G10) is **app-level state**, persisted in localStorage (`duo.selectionFormat`, default `'a'`). The renderer reads it at click time. Two surfaces expose the switch: (1) a `duo selection-format [a\|b\|c]` CLI verb \u2014 no arg prints current, with arg sets and persists. Returns `{format: 'a'\|'b'\|'c'}`. (2) The skill teaches Claude that it can call `duo selection-format c` at the start of a multi-step session that benefits from compact opaque tokens. There is no UI control in v1 \u2014 the format is an agent-tuning knob, not a user preference. If users start asking for it, add a sub-menu to the existing theme/cozy submenu. |

---

## 4. UX flow

```
User selects "performance is critical" in their open PRD (markdown editor tab).
Selection range is highlighted (TipTap default).
A small purple pill appears above the selection: [ Send → Duo  ⌘D ]

User clicks the pill (or hits ⌘D).

Pill disappears. Focus moves to the active terminal tab. Terminal input
line now reads:

  > "performance is critical especially for users on mobile"
  > (~/projects/foo/prd.md · Risks > Market)
  ▌  ← cursor here, no Enter pressed

User types "rewrite this section to emphasize this" and presses Enter.

Claude Code (running in the terminal) sees the quoted block + the verb
and gets to work. It can also call `duo selection` to confirm the full
context (file path, position range) if it wants to apply a precise
edit.
```

Same flow for a browser tab — selection in any rendered page, click
the pill, terminal gets:

```
> "<selected text>"
> (https://example.com/article — "Article title")
▌
```

---

## 5. Architecture

- **Selection observer.** A renderer-side hook that watches every
  WorkingPane tab type:
  - **Editor:** TipTap's `selectionUpdate` event (already wired for
    Stage 11's `duo selection`).
  - **Browser:** a per-tab page-side script injected on each
    navigation that listens for `selectionchange` and posts the
    serialized selection back via a CDP binding (`Runtime.addBinding` +
    `Runtime.evaluate("...registerBinding...")`). For canvas apps,
    the script uses app-specific accessors first.
  - **Preview / future types:** add later as new node types come online.

- **Cache + push.** Renderer pushes the most-recent selection into
  the main-process cache (the same one used by `duo selection`).
  When the WorkingPane has focus and the selection is non-empty, a
  floating button is rendered next to the selection's screen rect.

- **PTY write.** On click, the renderer calls
  `window.electron.pty.write(activeTerminalId, formattedPayload)`.
  No Enter is appended — that's the user's job.

- **CLI plumbing for `duo send`.** Adds one new verb that the agent
  can use to plant context. Plumbing matches the six-file checklist
  in CLAUDE.md rule #4: shared/types → preload → main →
  socket-server → cli/duo → SKILL.md.

**Browser selection is the only genuinely new piece** — everything
else builds on existing infrastructure.

---

## 6. Phased build plan

Three sub-stages, each shippable.

### 15.1 — Editor button (small) + `duo send` + `duo selection-format` CLI
- [ ] BubbleMenu-style floating button on TipTap selection (existing
      machinery, single-extension addition).
- [ ] Format-resolution helper that reads the current
      `duo.selectionFormat` from localStorage and returns the formatted
      payload. Default `'a'` (quote + provenance per G10).
- [ ] Click writes the formatted payload into the active terminal
      tab's PTY via `pty.write`.
- [ ] `duo send` CLI verb (writes into the active terminal as if the
      button had fired). For agents.
- [ ] `duo selection-format [a|b|c]` CLI verb (G19) — read prints
      current, set persists. Renderer subscribes to format changes
      via the same IPC pattern as `theme:set`.
- [ ] No new IPC surface beyond `pty.write` + a tiny `selection-format`
      push/set channel pair.
- **Exit:** PM selects in a `.md`, clicks the pill, terminal gets the
  quoted block; user types verb + Enter. Agent can flip format via
  CLI for multi-step sessions.

### 15g.2 — Browser selection observer + button
- [ ] Page-side script injected on navigation; reports
      `selectionchange` events back to the renderer via CDP binding.
- [ ] Canvas-app fast-paths (Docs first; Sheets / Slides / Figma
      later as needed).
- [ ] Same floating button affordance, anchored over the
      `WebContentsView` via the existing bounds-sync pattern.
- [ ] Browser support added to `duo selection` (renamed return shape
      becomes a discriminated union).
- **Exit:** PM selects in a Google Doc, clicks the pill, terminal
  gets `> "..."` + URL.

### 15g.3 — Polish + cross-cutting
- [ ] Length cap + truncation marker (G9).
- [ ] Image / table flattening (G8).
- [ ] `⌘D` keyboard shortcut.
- [ ] Skill update so agents understand the injected format and the
      `duo send` verb.
- [ ] Smoke-checklist update: button visible from each WorkingPane
      tab type; round-trip with terminal.
- **Exit:** the primitive feels native across all WorkingPane modalities.

---

## 7. Risks + open questions

- **Browser selection across WebContentsView is the hardest piece.**
  CDP `Runtime.addBinding` is the established path; there's prior art
  in our existing `Runtime.consoleAPICalled` subscription. The page-
  side script needs to survive same-origin navigation (re-injected on
  `Page.frameNavigated`).
- **Canvas apps fight us by design.** Google Docs uses a hidden
  contenteditable iframe; Figma is full canvas. We solve Docs via
  `_docs_annotate_getAnnotatedText` (already documented in
  `skill/SKILL.md`). Sheets/Slides/Figma are out of scope for v1
  unless the owner explicitly wants them.
- **Naming the button.** Current placeholder "Send → Duo" reads
  weirdly when the user is *already* in Duo. Alternatives: "Send to
  terminal", "Quote to agent", "Ask Claude about this". The owner
  said "placeholder" so we'll iterate at kickoff.
- **Open question — payload format (G10).** Three options listed; A
  is the recommendation but B and C are real alternatives. Decide at
  kickoff before building 15.1.
- **Open question — ⌘D conflict.** Some web apps bind ⌘D to bookmark.
  Our `BrowserManager.wireKeyForwarding` allowlist would intercept it
  before the page sees it. Verify no existing user muscle memory
  expects browser-default behavior.
- **Open question — does the button require explicit user consent
  the first time?** A first-run tooltip would teach the affordance,
  but for *every* selection it's intrusive. Probably no consent;
  match Notion/Google-Docs "select → action menu" conventions.

---

## 8. Success criteria

- A PM with a paragraph selected in their open PRD can deliver
  context to the agent in two clicks (select → Send → Duo) and one
  typed verb. No copy-paste, no path-typing.
- The same affordance works in a Google Doc tab without special
  agent handling.
- The agent can both **read** the selection (`duo selection`) and
  **write** to the user's terminal (`duo send`) with the same payload
  shape.
- The injected text is small enough to be ergonomic in the terminal
  (truncated above 16 KB) but the agent can always recover the full
  selection from `duo selection`.
- The button never blocks the user's existing typing flow — it
  appears, it doesn't interrupt.

---

## 9. BUG-100 — pill missing on selections inside the split-view (aux) browser pane

> **Status:** 🟡 confirmed-open (re-triaged 2026-06-06). Filed 2026-05-06
> (smoke-walk v0.6.8 step 5). Originally scoped as a 3–4h CdpBridge
> multi-attach refactor and deferred; the BUG-134 groundwork (every browser
> tab's debugger now stays attached) has since made this an incremental fix,
> not a refactor.
> **Tracked in:** [`tasks.md` § BUG-100](../../tasks.md).
> **Touches:** `electron/cdp-bridge.ts`, `electron/browser-manager.ts`
> (no main.ts change required — see "Fix approach").

### Symptom

With at least one live Claude tab in the terminal pane **and** a browser tab
pinned into the split-view (aux) slot, selecting text inside the **aux**
pane's WebContentsView does not render the in-page Send → Duo pill. Selecting
text in the **main** browser pane works correctly under the same conditions.
Workaround: promote the aux tab back to main (⌘⇧/) before selecting.

This is a parity hole in the browser half of § 1's two-axis grid: the pill is
meant to appear on **any** selection in the right-column WorkingPane, and an
aux-pinned browser tab is part of that surface.

### Root cause (file:line)

The pill's page-side machinery is the `SELECTION_OBSERVER_IIFE` — it builds
the pill DOM and gates its visibility in `showPillFor` on the per-page
`window.__duoClaudeLive` flag (`cdp-bridge.ts:162`, gate at `:175`). Two
injection steps that arm that machinery both route through `this.dbg()`, which
returns **only the single front `this.wc`** (`dbg()` at `cdp-bridge.ts:1837`):

- `injectSelectionObserver()` (`cdp-bridge.ts:1091`) — `Runtime.evaluate`s the
  IIFE into `this.dbg()` only.
- `applyClaudeLiveToPage()` (`cdp-bridge.ts:1035`, called at the tail of
  `injectSelectionObserver` via `:1107`) — sets `__duoClaudeLive` on
  `this.dbg()` only.

`attach()` (`cdp-bridge.ts:1169`) sets `this.wc = webContents` (`:1179`) to the
**most-recently-attached** tab and runs `injectSelectionObserver()` at its tail
(`:1283`). BUG-134 (`browser-manager.ts:342–351`) keeps **every** tab's
debugger attached so binding-call events route from any tab — but it only fixed
the `duoSendToDuoClick` click-handler routing. The selection-observer IIFE
itself is still injected against `this.wc` (the front tab) only. An aux-pinned
tab that is not the front wc therefore never receives the observer IIFE, so no
`selectionchange` in it ever calls `showPillFor`, and the pill never appears.

(The closely-related `__duoClaudeLive` **flag staleness** on non-front panes
was already fixed for the *flag value* by BUG-133's
`browserManager.broadcastClaudeLive` — `browser-manager.ts:1134–1155` — which
fans the flag to every tab via `wc.executeJavaScript(...)`. That precedent is
the template for the fix below: BUG-100 is the same fan-out problem, one layer
up — the *observer that reads the flag* is what's missing on the aux tab, not
the flag.)

### Fix approach

Fan the selection-observer injection out to **every attached tab** instead of
only the front `this.wc`, reusing the BUG-134/BUG-133 multi-tab precedents.
The IIFE is already idempotent (guarded by `__duoSelectionObserver`), so
injecting it into a tab that already has it is a cheap no-op. Two viable shapes
(recommended **a**):

- **(a) — Inject the observer on every `attach()`, against the attaching
  tab's own webContents (recommended).** `browser-manager.ts:349` already calls
  `cdp.attach(view.webContents)` for every new tab including aux. The cheapest
  correct fix is to make the observer/flag injection in `attach()` target the
  `webContents` being attached (it is in scope) rather than the later-mutated
  `this.wc`. This keeps `this.wc` semantics intact for front-tab
  `Runtime.evaluate` reads while guaranteeing every attached page gets its own
  observer at attach time. Lowest blast radius; no main.ts change.
- **(b) — Add a `broadcastSelectionObserver()` fan-out on BrowserManager**,
  mirroring `broadcastClaudeLive` (iterate `this.tabs`, `executeJavaScript` the
  IIFE into each), and call it wherever aux pinning changes. More code; only
  needed if (a) proves insufficient because an aux tab can be re-pointed
  without a fresh `attach()`.

Start with (a); fall back to (b) only if a smoke-walk shows an aux tab that
slips through (e.g. an aux pin that swaps the underlying view without
re-attaching). Either way, `showPillFor`'s existing per-page
`__duoClaudeLive` / `__duoInspectActive` gates (`cdp-bridge.ts:175`, `:182`)
need no change — once the observer is present on the aux page, the flag is
already being fanned to it by BUG-133.

### CLI / UI parity

No new CLI verb. `duo selection` already reads from the per-page observer push
(`duoSelectionPush`), so once the observer is injected into the aux tab, the
agent-facing read path inherits the fix for free — the pill (UI) and
`duo selection` (CLI) regain parity together. This is a pure correctness fix to
an existing affordance, not a new surface; no deliberate asymmetry to call out.

### Smoke-walk line

- **Aux-pane Send → Duo pill** — pin a browser tab into the split-view (aux)
  slot with a live Claude tab in the terminal pane; select text inside the
  **aux** pane → the Send → Duo pill appears over the selection (matching
  main-pane behavior). Regression-guard the main pane in the same step: select
  in main while aux is pinned → pill still appears there too, and clicking
  either pill drops its quoted payload into the active terminal.
