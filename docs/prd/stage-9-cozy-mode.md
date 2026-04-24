# Stage 9 PRD — Cozy mode (terminal typography + reader-width)

> **Status:** spec locked 2026-04-22. Ready to build.
> **Supersedes:** the ROADMAP "Stage 9" section for everything below.
> **References:**
> - [docs/VISION.md](../VISION.md) — "prose-first terminal" flagship
> - [docs/research/terminal-cozy-mode.md](../research/terminal-cozy-mode.md)
>   — what xterm.js can safely change around a running Claude Code
>   TUI; what requires a Warp-scale interposer; the validation
>   checklist this PRD inherits.

---

## 1. What we're building

Cozy mode is an opt-in typography-and-width pass on a single
terminal tab. When the user turns it on, the active tab:

- renders at a slightly larger font size with roomier line height,
- paints over a softer foreground color,
- receives padding inside the terminal host div, and
- caps its **content width** at a reader-friendly column count (the
  pane column keeps its existing width; only the inner text region
  narrows).

Toggling the mode triggers `FitAddon.fit()`. PTY receives a
`SIGWINCH` at the new cols; Claude Code (and any other foreground
process) re-layouts naturally.

**Out of scope for Stage 9:**
- Markdown rendering of the user's compose area — requires a
  Warp-scale interposer. Deferred. See research note § 4.
- Click-to-cursor in the shell regime — low return inside Duo's
  agent-centric case. Research note § 5.
- Per-line markdown styling of the scrollback — not reliably
  distinguishable from chrome without OSC 133 emission. Tracked in
  `claude-code#22528` / `#26235`.

---

## 2. Personas + jobs to be done

**Primary persona:** PM-adjacent user running long Claude Code
conversations (minutes-to-hours scale). They are reading more than
they are typing. Default terminal typography is squint-inducing; a
long answer that soft-wraps at 180 columns reads like a legal brief.

Jobs this stage does:
- "Let me read this long answer without fatigue."
- "Keep my reading column narrow when the window is wide."
- "Don't break Claude Code."

Jobs this stage does NOT do:
- Give me a rich compose area.
- Let me click anywhere in scrollback to move the cursor.
- Change the terminal typography globally across every tab.

---

## 3. Resolved decisions

| # | Area | Decision |
|---|---|---|
| C1 | **Scope** | One toggle per terminal tab. Not a global app mode. |
| C2 | **Trigger surface** | Electron app menu: **View → "Cozy mode (preview) — current tab"**. Checkmark reflects the current tab's state. No keybinding in v1 (research note § 6). |
| C3 | **Preview gating** | The menu item ships with the `(preview)` label as the gating signal. No separate "enable cozy mode" meta-toggle. The label warns users to expect TUI rough edges during the shake-out window. If a hard-blocking bug emerges, the label makes it easy to rename, hide, or remove. |
| C4 | **New-tab default** | **Remember last choice.** The very first tab defaults to OFF. Each time the user toggles any tab, that becomes the default for subsequent new tabs. Persisted. |
| C5 | **Per-tab persistence** | Per-tab cozy state is stored in `localStorage` under `duo.cozy.v1.byTab` (keyed by tab UUID). Since tab UUIDs do not survive an app relaunch, this is effectively a within-session cache plus the "last choice" default in C4. |
| C6 | **Last-choice persistence** | Last-choice default is stored in `localStorage` under `duo.cozy.v1.lastChoice` (boolean). Updated on every toggle. Survives relaunches. |
| C7 | **Typography values (v1)** | `fontSize` 13 → 15. `lineHeight` 1.4 → 1.55. Foreground unchanged (`#e4e4e7` is already soft). Font family unchanged. |
| C8 | **Pane padding** | Outer terminal host gains 20px vertical + 24px horizontal padding in cozy mode. Default mode keeps 0px. |
| C9 | **Reader-width cap** | Cozy mode caps the terminal content box at `max-width: 92ch` where `ch` is the xterm.js cell width at the cozy `fontSize`. On columns narrower than 92ch the cap has no effect — typography still changes. |
| C10 | **Toggle mechanics** | On toggle: write new options into the existing `Terminal` instance via its `options` setters, re-apply padding/max-width classes on the host, call `FitAddon.fit()`, push new `(cols, rows)` to the PTY. No terminal re-creation; scrollback survives. |
| C11 | **Inactive tab behavior** | Applies only to the active tab at the time of toggle. Other tabs keep their own cozy/default state regardless of which is visible. |
| C12 | **TUI alt-screen** | No special handling. When Claude Code enters `/tui fullscreen` (alt-screen), the alt-screen inherits the same typography and padding. Validated empirically (research note § 1). |
| C13 | **Theme colors** | Unchanged in v1. The existing Zinc palette is already soft enough; changing colors risks colliding with Claude Code's own color choices. |
| C14 | **Renderer** | Stay on the canvas/WebGL renderer. Do not switch to DOM renderer (research note § 2). |
| C15 | **Letter-spacing** | Never. Known to break selection and alignment (xterm.js #4881, #972, #1044). |
| C16 | **Keyboard shortcut** | None in v1. Menu-only keeps the surface small enough to monitor for TUI fallout before giving it a chord. |
| C17 | **Rollback** | If a user reports TUI breakage we cannot fix quickly, ship a one-line main-process change that hides the menu item. State in localStorage is preserved so users can re-enable once fixed. |

---

## 4. Validation checklist (must pass before merge)

Inherits from research note § 6, with a few tightening adds:

- [ ] Claude Code's box-drawing borders align cleanly after cozy
      toggle (no half-cell gaps, no overlap).
- [ ] Progress spinners render without jitter at the cozy line
      height.
- [ ] Diff output colors stay legible against the softer
      foreground.
- [ ] `shift+tab` mode switches in Claude Code still work.
- [ ] `/tui fullscreen` mode inherits cozy typography; exiting
      fullscreen restores correctly.
- [ ] Claude Code's mouse-tracking mode 1003 still reaches Claude
      (click a rendered list item; verify response).
- [ ] Toggle cozy while an answer is streaming — Claude re-layouts
      without dropping visible content.
- [ ] Toggle back to default on the same tab — no stale canvas
      artifacts, no orphan padding.
- [ ] Per-tab state: toggle tab A cozy, switch to tab B, tab B
      remains default; switch back to A, A still cozy.
- [ ] "Remember last choice": toggle cozy on tab A, create a new
      tab, new tab launches cozy. Toggle cozy off on tab A, create
      another new tab, it launches default.
- [ ] Relaunch the app — first tab honors the last-choice default.
- [ ] Narrow the window until the column is < 92ch — cozy still
      applies typography; max-width cap silently does nothing.
- [ ] Resize the window while in cozy — reader-width recomputes
      and the PTY gets the new cols.

---

## 5. Build plan

One phase. The scope is deliberately small so the TUI-safety
checklist can be exercised as a single unit.

### Phase 1 — Cozy toggle + typography

**Electron main (`electron/main.ts`)**
- Build an app menu with a View submenu containing the cozy toggle
  item. The item is a checkbox that starts unchecked; its label
  reads `"Cozy mode (preview) — current tab"`.
- On click, send an IPC message (new channel `COZY_TOGGLE`) to the
  focused renderer. The renderer owns authoritative state and
  echoes back the new checked value via `COZY_STATE` so the menu
  checkmark tracks the active tab.

**Preload (`electron/preload.ts`)**
- Expose `window.electron.cozy.onToggle(cb)` and
  `window.electron.cozy.pushState({ cozy })` on the electron API.

**Renderer `App.tsx`**
- Add `cozyByTab: Record<string, boolean>` and `cozyDefault:
  boolean` state. Hydrate both from `localStorage` on mount.
- On new-tab creation, seed the new tab with `cozyDefault`.
- On cozy toggle (from IPC), flip the active tab's boolean,
  update `cozyDefault` to match, persist both, and push the new
  state up to main so the menu checkmark refreshes.
- Pass `cozyByTab[activeTabId]` as a `cozy` prop down into
  `TerminalPane`.
- When the active tab changes, push the new active tab's cozy
  value up to main (so the checkmark tracks tab switches).

**Renderer `TerminalPane.tsx`**
- `TerminalInstance` accepts a `cozy: boolean` prop.
- On mount, initialize the xterm with the plain values.
- In an effect that fires on `cozy` changes:
  - Update `term.options.fontSize` and `term.options.lineHeight`
    to the cozy values (per C7).
  - Toggle `cozy-host` class on the host div (drives padding + max-
    width).
  - Call `fit.fit()` and push `(cols, rows)` to the PTY.

**CSS (`renderer/index.css` or Tailwind layer)**
- `.cozy-host` class: padding 20px 24px; max-width computed via a
  CSS custom property, centered with `margin-inline: auto`.
- The CSS var `--cozy-cell-px` is set from JS after the cozy fit
  using `term._core._renderService.dimensions.css.cell.width` or
  (safer) a measured monospace glyph width. Keep the measurement
  logic tight; failures should fall back to `80ch`-equivalent.

**Tests (manual)**
- Run the checklist in § 4. Capture a short note in the commit
  message referencing which items were exercised.

---

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| xterm.js canvas renderer mis-aligns at the new line height on some fonts. | Validate Claude Code box-drawing first; if any row is ragged, fall back to `lineHeight: 1.5` (conservative) and record the finding. |
| PTY resize storms when the user rapidly toggles cozy. | `FitAddon.fit()` is idempotent; the debounce already present in `ResizeObserver` paths covers the window case. Single toggles are one `fit()` each — no debounce needed. |
| Users enable cozy, hit a TUI glitch we don't catch, and assume Duo is broken. | The `(preview)` label warns them. The rollback plan (C17) is a one-line hide. |
| Stage 11 (markdown editor) wants its own typography levers and diverges from cozy. | Keep cozy scoped to terminal surface only. Stage 11 lives in the working pane and has its own font stack decisions. No shared CSS between them. |
| Per-tab `localStorage` map grows without bound as tabs come and go. | Write-through key on tab close removes stale entries. Even unbounded, the map is bytes per entry. |

---

## 7. Out of scope / future

- **Stage 9b — Compose-area interposer.** The writing half of
  cozy mode. Likely bundled with Stage 11's editor because both
  need a serious text-editing component. Research note § 4.
- **Click-to-cursor at a bare shell prompt.** Revisit if the
  common Duo case shifts away from agent-driven usage.
- **Per-region prose styling** — await Claude Code OSC 133
  emission ([`claude-code#22528`](https://github.com/anthropics/claude-code/issues/22528)).
- **Theme variants for cozy** — if the default soft foreground
  turns out to be insufficient, add a "reading" theme later.
