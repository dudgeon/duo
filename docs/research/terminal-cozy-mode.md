# Terminal Cozy Mode — research note

> Grounds the Stage 9 scope decision. Cozy mode is the reading **and**
> writing surface for long human↔agent conversation — per VISION.md's
> "prose-first terminal" flagship. This note answers: what can we do
> safely inside xterm.js around a running Claude Code instance,
> without breaking its TUI? What must wait for a bigger investment?

---

## TL;DR

| Cozy-mode ambition | Feasibility | Stage |
|---|---|---|
| **Typography pass** — larger line-height (within renderer limits), nicer font stack, softer contrast, generous pane padding, reader-width cap on the terminal pane | ✅ Safe in xterm.js. Ship this as **Stage 9 v1**. | 9 |
| **Reader-width** — narrow the terminal pane; PTY resizes (SIGWINCH); Claude Code re-layouts at the new width | ✅ Works within Claude Code's existing resize handling (some known perf bugs in 2.1.15+; acceptable). | 9 |
| **Click to move the cursor** at a shell prompt | ⚠️ Only works cleanly when the foreground process is *not* in mouse-tracking mode. Claude Code turns mouse tracking ON (mode 1003). When Claude is active, our click handler would collide with Claude's own click handling. Can work *when the user is at a bare shell prompt* (readline/zle), which is not the common case inside Duo. | 9 optional; recommend deferring |
| **Markdown rendering of the user's input line** (compose-area decoration) | ❌ **Not safely achievable inside xterm.js.** Claude Code owns its own input editor (a React/Ink component). The input line isn't shell readline echo — it's part of Claude's rendered tree. Styling it from outside the terminal would mean either interposing a Warp-style composition surface (a significant build) or switching the integration model to `claude --print` with a custom chat UI (an even bigger build). | **Defer — Stage 9b or a separate arc.** |

**Recommended Stage 9 v1 scope:** typography + reader-width, per-tab
toggle, menu item only, no keybinding. No input-area rendering, no
click-to-cursor. The "writing" half of cozy mode is a follow-on.

---

## 1. What Claude Code actually is, and why it matters

Claude Code is not "prompt output to stdout." It is an interactive
TUI application implemented as a **React tree rendered by a fork of
[`ink`](https://github.com/vadimdemedes/ink)** to the terminal. It
emits ANSI/OSC sequences from a damage-tracked Yoga layout, runs its
own input editor, and puts the terminal into mouse-tracking mode 1003.
This means:

- When the user types into `claude`, they are typing **into Claude's
  process**, not into a shell readline. The characters don't flow
  through a zsh / bash line editor first.
- Cursor position, selection, history search (Ctrl+R), inline
  suggestions — all live inside Claude's React tree.
- Claude emits fully-composed ANSI. Distinguishing "prose region" from
  "chrome region" from the outside requires parsing the ANSI stream
  backwards. Not practical.
- Claude does **not** yet emit OSC 133 prompt markers (the standard
  shell-integration primitive that iTerm2 / Warp / VS Code use for
  per-prompt styling, click-to-move, etc.) — [tracked in
  `anthropics/claude-code#22528`](https://github.com/anthropics/claude-code/issues/22528)
  and [`#26235`](https://github.com/anthropics/claude-code/issues/26235).

The practical consequence: **the input area and the output area are
both inside Claude's render tree**. Duo cannot stylize one without
the other from the outside.

### Alternate integration architecture — `claude --print`

There IS a path to a fully-custom UI: `claude --print --output-format=stream-json`
([source](https://gist.github.com/JacobFV/2c4a75bc6a835d2c1f6c863cfcbdfa5a)).
This runs Claude Code non-interactively and streams JSON events, one
per message. We could build our own chat UI (ProseMirror-style editor
for input, rendered markdown for output) around that stream.

**We are NOT taking this path for Stage 9**, because:

- It means replacing Claude Code's TUI wholesale, not wrapping it.
  Every TUI affordance — slash commands, permission prompts, thinking
  toggles, `/tui fullscreen`, `shift+tab` modes — would have to be
  reimplemented by us in Duo's UI.
- VISION.md principle #4 is "Don't break the TUI." Replacing it is
  the extreme opposite.
- It locks Duo to Claude Code's JSON schema and updates pace.
- BYO-harness becomes "BYO-harness, but re-chrome it from scratch for
  every agent."

Record it as a future option, ship the wrapping approach for now.

### `CLAUDE_CODE_NO_FLICKER` / `/tui fullscreen`

Claude Code recently shipped an alternate-screen rendering mode
(tracked via `CLAUDE_CODE_NO_FLICKER=1` env var and the `/tui
fullscreen` command) that uses the terminal's alternate screen buffer
— like vim or htop — to eliminate flicker and enable mouse support
[1]. It's opt-in today.

For cozy mode this is neutral: the alternate screen still respects
PTY resize, so our reader-width approach works either way. We should
**test both modes** when validating Stage 9.

---

## 2. xterm.js: what we can safely change

### Cell-grid invariants — do not violate

xterm.js assumes a **uniform monospace grid**. Every glyph occupies
the same cell width. Box-drawing characters, progress bars, tables,
diff output, spinners — all assume this.

Things that break the grid (avoid):

- **`letter-spacing`** via CSS — known to break text selection and
  alignment ([`xterm.js#4881`](https://github.com/xtermjs/xterm.js/issues/4881),
  [`#972`](https://github.com/xtermjs/xterm.js/issues/972),
  [`#1044`](https://github.com/xtermjs/xterm.js/issues/1044)).
  The canvas renderer measures width once per font; a CSS override
  desyncs measurement from rendering.
- **Proportional / non-monospace fonts** — obvious cell-grid
  violation.
- **Transforms on the host element** (`scale`, `rotate`) — xterm.js
  computes character geometry from `getBoundingClientRect` at fit
  time; transforms invalidate that.
- **Per-line CSS in the DOM renderer** that alters line height of
  individual lines — the scrollback becomes ragged.

### What's safe

- **Font family** — as long as we stay monospace. The current config
  already uses `JetBrains Mono, Cascadia Code, Fira Code, …`
  (see `tailwind.config.mjs`) — all prose-friendly monos. We can add
  a font-weight or adjust sizes for cozy.
- **Font size** — xterm's `fontSize` option is the right lever. Bump
  from 13 → 14 or 15 for cozy.
- **Line height** via xterm's **`lineHeight` terminal option** — not
  CSS `line-height` on the host. The option feeds into
  `CharacterJoiner`'s measurement so the grid stays consistent.
  Bumping from 1.2 → 1.4 is a typical cozy-mode move. *Known
  imperfections in the canvas renderer
  ([`#475`](https://github.com/xtermjs/xterm.js/issues/475),
  [`#992`](https://github.com/xtermjs/xterm.js/issues/992))* — validate
  empirically before settling on a value.
- **Theme colors** — softer foreground, dimmer chrome, a warmer
  background. The theme API is a safe knob.
- **Outer pane padding / margin** — the host `<div>` can have
  padding. xterm.js fits to the inner content box.
- **Outer pane max-width** — the real win. See next section.
- **Scrollback length** — already 10k lines, can bump if desired.

### Canvas vs DOM renderer

The xterm.js DOM renderer gives us real `<span>` per character and
therefore more CSS hooks for per-line styling
([xtermjs/xterm.js#3271](https://github.com/xtermjs/xterm.js/issues/3271)),
but costs performance, especially at scrollback scale. For cozy mode
**we stay on the canvas/WebGL renderer** — the typography levers
above are enough, and performance matters when the agent is dumping
long answers.

---

## 3. Reader-width — the main lever

VISION.md calls out a "reader-width soft limit with graceful
overflow." The clean mechanism inside xterm.js is:

1. Put a `max-width` on the terminal host div (e.g. 86ch, 92ch,
   or tunable).
2. `ResizeObserver` fires on the narrower host → `FitAddon.fit()`
   recomputes cols → PTY gets `SIGWINCH` with new cols.
3. Claude Code (and any other foreground process) respects the new
   width and re-lays out. We already wire this path
   ([`TerminalPane.tsx:120–146`](../../renderer/components/TerminalPane.tsx)).

Claude Code's resize handling is well-behaved in current versions
(v2.1.88+). Known issues:

- [`claude-code#20094`](https://github.com/anthropics/claude-code/issues/20094)
  — resize sluggish in v2.1.15 (fixed in later versions; pin Duo
  dependencies accordingly).
- [`claude-code#8276`](https://github.com/anthropics/claude-code/issues/8276)
  — text doesn't reflow cleanly when terminal goes wider. User
  workaround: resize the window a second time. Not a cozy-mode
  blocker.

**Reader-width lives on the outer pane only.** We do NOT shrink the
terminal window globally — the column keeps its existing width; only
the *content region* is narrowed. On narrow displays where the column
is already narrower than the reader-width target, cozy mode does
nothing to width (typography still changes).

---

## 4. Input-area markdown rendering — why it's deferred

Desired: user types `**bold**` or `# heading`, and the compose area
shows rendered formatting live, like iA Writer.

Reality:

- The compose area inside Claude Code is a React/Ink component,
  rendered to the same canvas as Claude's output. It is not a DOM
  `<input>`.
- To style it from Duo's side, we'd have to:
  1. Intercept keystrokes before they hit the PTY.
  2. Render a compose UI in Duo (React, presumably with ProseMirror
     or TipTap) that shows live markdown.
  3. Synthesize the final text and feed it to Claude Code's stdin on
     commit.
  4. Suppress Claude Code's own compose rendering — which is not
     supported today.
- That is essentially building Warp's
  [custom block input editor](https://docs.warp.dev/terminal/classic-input)
  ([more details](https://www.warp.dev/blog/why-is-the-terminal-input-so-weird)).
  Warp chose to do this by writing an entire terminal emulator in
  Rust *specifically because* the classic terminal model cannot do it.
  They had to re-implement tab completion, history search, and soft
  wrapping from scratch.

For Duo, a Warp-style composer is a large, architecturally separable
piece of work. It is worth doing *eventually*. It is **not** a "polish
the typography" stage. Capture as **Stage 9b — Compose-area
interposer** (future), or fold into the Stage 11 editor arc once we
have a serious text-editing model to reuse.

Interim alternative: if Claude Code ships OSC 133 / custom OSC
bracketing ([`#22528`](https://github.com/anthropics/claude-code/issues/22528),
[`#26235`](https://github.com/anthropics/claude-code/issues/26235)),
we might get compose-region boundaries as a signal in the stream.
That would make a lighter-weight decoration approach possible. Watch
the issues; not something we can bet on today.

---

## 5. Click-to-cursor — what works, what doesn't

Two regimes to separate:

| Foreground process | State | Click-to-cursor story |
|---|---|---|
| Bare shell at prompt (zsh / bash), mouse tracking OFF | Common in Terminal.app; uncommon in Duo (why would you use Duo without an agent?) | Workable via Duo-side mouse handler that translates click column → arrow-key injection into the PTY. Well-established pattern. |
| Claude Code active | mouse tracking mode 1003 ON | Claude Code receives the click as an ANSI sequence and decides. May already do something reasonable (cursor movement within its input editor). Don't double-handle — pass through. |
| TUI app (vim / less / htop) | mouse tracking ON | Same as Claude — pass mouse events through. |

Conclusion: In the common Duo case (Claude Code running), mouse
events already go to Claude. Adding Duo-side click-to-cursor would
collide with Claude unless we suppress it when mouse tracking is on.
**Effort-to-value is low for Stage 9.** If Claude Code's own click
handling turns out to be weak, we can revisit.

Lightweight win: **enable mouse event passthrough in xterm.js** (it
is by default) so Claude Code's existing mouse support actually works
inside Duo. This was flagged in our research note as a
[known regression area](https://www.turboai.dev/blog/claude-code-env-vars-v2-1-88);
worth a one-line verify.

---

## 6. Recommended Stage 9 v1 scope

One toggle, per terminal tab, menu item only.

When **cozy mode is on**, the active terminal tab changes:

- `fontSize`: 14 (up from 13).
- `lineHeight`: 1.4 (up from 1.2). Tune empirically against
  Claude Code's box-drawing borders and the diff renderer to verify
  alignment stays sharp.
- Foreground color: softer (e.g. `#d4d4d8` → `#e4e4e7`) — less TUI
  fatigue during long reads.
- Outer pane padding: 16–20px on all sides (up from 0).
- Outer pane `max-width`: **character-based cap**, e.g.
  `max-width: calc(92ch * <current cell width>)`. Implementation detail:
  use a CSS custom property updated when the font size changes so the
  cap tracks typography.
- On toggle: `FitAddon.fit()` → PTY resize propagates to Claude Code.

Menu label: **"Cozy mode (current tab)"** under View. Reflects current
tab's state (check mark when on). No global shortcut in v1.

**Validation checklist before merge:**

- [ ] Claude Code's box-drawing borders align correctly after cozy
      toggle.
- [ ] Progress spinners render cleanly (no frame jitter from line
      height change).
- [ ] Diff output colors stay legible in the softer theme.
- [ ] `shift+tab` mode switches in Claude Code work.
- [ ] `/tui fullscreen` mode also works in cozy (alternate-screen
      buffer should just inherit the same typography).
- [ ] Claude Code's mouse events reach Claude (click inside an
      agent-rendered list; check it responds).
- [ ] Resize behavior: toggle cozy while an answer is streaming;
      Claude re-layouts without dropping content.
- [ ] Switch between cozy and default on the same tab — no stale
      canvas artifacts.

**Do NOT ship:**

- Input-area markdown rendering (deferred to Stage 9b / fold into
  Stage 11).
- Click-to-cursor in the shell regime (low return in Duo's common
  case; revisit if it becomes a real pain point).
- Per-line markdown styling in the scrollback (can't reliably
  distinguish prose from chrome without OSC 133 or similar).

---

## 7. Future-work notes

- **Watch Anthropic OSC adoption.** If Claude Code starts emitting
  OSC 133 or a custom bracketing sequence, cozy mode can gain
  per-region styling (headings, code fences) in the scrollback
  without guesswork.
- **Re-evaluate compose-area interposer** when Stage 11 (markdown
  editor) lands. Stage 11 will build a serious in-browser text
  editor; the same component could be reused as a composer UI that
  talks to Claude's stdin. That lets us unify the "writing" surface
  across Duo.
- **Consider `claude --print` as a second mode**, not the only one.
  Long-term, Duo could offer "chat mode" (our own chat UI on the
  `--print` stream) and "TUI mode" (current), chosen per tab. Cozy
  mode stays the stylization of TUI mode.
- **Revisit click-to-cursor** once fullscreen-mode mouse support
  stabilizes (v2.1.88+ is the earliest). The bar is: does it work
  better than what Claude provides natively? Only then is it worth
  the coordination cost.

---

## Sources

- [Claude Code: How Claude Code Uses React in the Terminal (DEV)](https://dev.to/vilvaathibanpb/how-claude-code-uses-react-in-the-terminal-2f3b)
- [I studied Claude Code's leaked source and built a terminal UI toolkit from it (DEV)](https://dev.to/minnzen/i-studied-claude-codes-leaked-source-and-built-a-terminal-ui-toolkit-from-it-4poh)
- [anthropics/claude-code#22528 — Emit OSC 133 shell integration sequences](https://github.com/anthropics/claude-code/issues/22528)
- [anthropics/claude-code#26235 — Support semantic prompt zones (OSC 133)](https://github.com/anthropics/claude-code/issues/26235)
- [anthropics/claude-code#20094 — Terminal resize extremely slow in v2.1.15](https://github.com/anthropics/claude-code/issues/20094)
- [anthropics/claude-code#8276 — Text doesn't reflow when terminal is resized wider](https://github.com/anthropics/claude-code/issues/8276)
- [TurboAI — Claude Code v2.1.88: Mouse Control, REPL Mode, Flicker-Free Rendering](https://www.turboai.dev/blog/claude-code-env-vars-v2-1-88)
- [Claude Code Docs — Fullscreen rendering](https://code.claude.com/docs/en/fullscreen)
- [Using Claude Code Programmatically — `--print` / stream-json](https://gist.github.com/JacobFV/2c4a75bc6a835d2c1f6c863cfcbdfa5a)
- [xterm.js#3271 — Make the DOM renderer the default](https://github.com/xtermjs/xterm.js/issues/3271)
- [xterm.js#4881 — letter-spacing globally messes up selecting](https://github.com/xtermjs/xterm.js/issues/4881)
- [xterm.js#972 — Bad letter spacing with canvas](https://github.com/xtermjs/xterm.js/issues/972)
- [xterm.js#475 — Line Spacing Issues](https://github.com/xtermjs/xterm.js/issues/475)
- [xterm.js#992 — Incorrect line height with canvas](https://github.com/xtermjs/xterm.js/issues/992)
- [xterm.js#1044 — Support letter spacing](https://github.com/xtermjs/xterm.js/issues/1044)
- [Warp Docs — Terminal Blocks](https://docs.warp.dev/terminal/blocks)
- [Warp Docs — Classic Input](https://docs.warp.dev/terminal/classic-input)
- [Warp Docs — Modern text editing](https://docs.warp.dev/terminal/editor)
- [Warp Blog — Why is the terminal input so weird?](https://www.warp.dev/blog/why-is-the-terminal-input-so-weird)
