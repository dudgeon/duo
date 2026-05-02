# intro-to-duo lesson skill

> **You're reading this because the user clicked "Start lesson" on
> the intro-to-duo welcome canvas.** Duo spawned a fresh Claude tab
> in `~/` and the welcome canvas told you (via `data-cmd`) to walk
> the user through this skill. Your job: be the lesson — paint
> content into the canvas, react to the user's clicks, answer
> questions along the way.
>
> The user is a CLI-noob. Don't lecture; show. Six short steps,
> roughly five minutes total.

---

## How this lesson works

The user is looking at a canvas at
`~/.claude/duo/packs/intro-to-duo/canvases/welcome.html`. The
canvas has TWO stable paint regions you'll address by selector:

- `[data-duo-pane="step-counter"]` — small text above each step ("Step 1 — …")
- `[data-duo-pane="lesson-body"]` — the main content area for each step

You repaint these regions with `duo html update --selector "<sel>" --html "<…>"`.

Every step's body includes ONE button with a
`data-duo-action="duo:event"` and a unique `data-event` name. When
the user clicks, the event lands in your `duo events --follow`
subscription. You read the event, paint the next step, and wait.

### Subscription pattern

In ONE backgrounded shell:

```bash
duo events --follow
```

You'll see one JSON line per click. Match `event.name` to advance.
If you prefer, hand the watch loop to a subagent that pages you
when a known event-name shows up — keeps your context window clean.
For a 5-minute lesson, foreground polling is fine too.

### Anti-patterns

- **Don't write a giant HTML blob in one paint** — keep each step
  ~3–6 short paragraphs plus one button. Long walls of text break
  the click-through rhythm.
- **Don't escape the convention.** If the lesson seems to want
  something Stage 27 doesn't support (a custom widget, a non-canvas
  modal, a server fetch), that's a primitive gap — flag it as a
  Stage 27.5 follow-up rather than papering over it with bespoke JS.
  Canvas iframes are sandboxed without `allow-scripts`; trying to
  inline JS will fail silently.
- **Don't paint the same pane twice for one step.** Each click =
  one repaint. Race-y double-paints will momentarily flash the user.
- **Don't forget the step-counter.** Two `duo html update` calls
  per step (counter + body). The user values the progress signal.

---

## The six lesson steps

Each step below is one paint cycle. Copy the HTML inline, swap the
literal `Step N` and content as you go.

### Step 1 — The terminal (where I live)

**On entry:** the user just clicked "Start lesson" and is reading
this in a Claude tab. Tell them what they're looking at:

```bash
duo html update --selector '[data-duo-pane="step-counter"]' \
  --html 'Step 1 of 6 — The terminal'

duo html update --selector '[data-duo-pane="lesson-body"]' --html '
  <h2>The terminal is where I live</h2>
  <p>You spawned this Claude session by clicking <strong>Start lesson</strong>.
  Look to your left — that terminal tab is me. You can talk to me here
  the same way you would in any Claude Code session.</p>
  <p>You can have many terminal tabs open at once — try ⌘T to add a
  new one. Each can run its own Claude session, or just be a regular
  shell. The icon in the tab tells you which.</p>
  <button class="cta" data-duo-action="duo:event"
          data-event="lesson-step-1-done">
    Next — show me the file navigator
  </button>
'
```

**Wait for:** `lesson-step-1-done`.

### Step 2 — The file navigator (left pane)

```bash
duo html update --selector '[data-duo-pane="step-counter"]' \
  --html 'Step 2 of 6 — File navigator'

duo html update --selector '[data-duo-pane="lesson-body"]' --html '
  <h2>The file navigator (left column)</h2>
  <p>The left column has two panes: <strong>Your Claude</strong>
  (rooted at <code>~/.claude/</code> — your skills, agents, settings)
  and the <strong>project</strong> tree (whatever folder a terminal
  tab is anchored to).</p>
  <p>Clicking a file opens it in the working pane on the right.
  Right-clicking gives you Reveal / Rename / Trash / Pin.</p>
  <button class="cta" data-duo-action="nav:reveal"
          data-path="~/.claude/CLAUDE.md">
    Show me my CLAUDE.md
  </button>
  <button class="secondary" style="margin-left: 8px;"
          data-duo-action="duo:event"
          data-event="lesson-step-2-done">
    Got it — what is the working pane?
  </button>
'
```

If the user clicks "Show me my CLAUDE.md" first, the navigator
reveals it but no event fires for the lesson — the second button
is what advances. Be ready for either order.

**Wait for:** `lesson-step-2-done`.

### Step 3 — The working pane (browser + canvas + editor)

```bash
duo html update --selector '[data-duo-pane="step-counter"]' \
  --html 'Step 3 of 6 — Working pane'

duo html update --selector '[data-duo-pane="lesson-body"]' --html '
  <h2>The working pane (right column)</h2>
  <p>This canvas you are looking at right now <em>is</em> the working
  pane. It hosts three kinds of tab:</p>
  <ul>
    <li><strong>Browser tabs</strong> — a real Chromium browser. I
    can drive it via <code>duo navigate</code> / <code>duo click</code>
    / <code>duo text</code> / <code>duo screenshot</code>.</li>
    <li><strong>Markdown editor tabs</strong> — rich editing with
    live preview, comments, code-block copy buttons.</li>
    <li><strong>HTML canvas tabs</strong> — like this one. Sandboxed,
    but I can paint into it via <code>duo html *</code>.</li>
  </ul>
  <button class="cta" data-duo-action="browser:open"
          data-url="https://anthropic.com">
    Open a browser tab
  </button>
  <button class="secondary" style="margin-left: 8px;"
          data-duo-action="duo:event"
          data-event="lesson-step-3-done">
    Next — how does the agent loop work?
  </button>
'
```

**Wait for:** `lesson-step-3-done`.

### Step 4 — The agent loop (you and me)

```bash
duo html update --selector '[data-duo-pane="step-counter"]' \
  --html 'Step 4 of 6 — Agent loop'

duo html update --selector '[data-duo-pane="lesson-body"]' --html '
  <h2>The agent loop</h2>
  <p>Every click on a button like the ones below emits a structured
  event into a small in-process bus. I subscribe via
  <code>duo events --follow</code> and react.</p>
  <p>Try this: type your name in the box and click Submit. I read the
  value out of your input and paint a personalized greeting back.</p>
  <input id="user-name" type="text" placeholder="Type your name"
         style="padding: 6px 10px; font-size: 14px;
                border: 1px solid var(--paper-edge); border-radius: 4px;
                background: var(--paper); color: var(--ink); margin-right: 8px;">
  <button class="cta" data-duo-action="duo:event"
          data-event="lesson-name-submitted"
          data-payload-from="#user-name">
    Submit
  </button>
  <div data-duo-pane="lesson-greeting" style="margin-top: 16px;
       color: var(--ink-mute); font-size: 13px;">
    (your greeting will appear here)
  </div>
'
```

**Wait for:** `lesson-name-submitted`. Then read `event.payload.value`
and paint:

```bash
NAME="<extracted from event.payload.value>"
duo html update --selector '[data-duo-pane="lesson-greeting"]' --html "
  <strong>Hello, $NAME.</strong> See how that works? Your Submit
  click crossed the canvas → CLI bus → me, and my paint crossed
  back the other way. <button class='cta' style='margin-left: 8px;'
  data-duo-action='duo:event' data-event='lesson-step-4-done'>
  I see it — what's next?</button>
"
```

**Wait for:** `lesson-step-4-done`.

### Step 5 — Theme + terminal focus (small surfaces)

```bash
duo html update --selector '[data-duo-pane="step-counter"]' \
  --html 'Step 5 of 6 — Small surfaces'

duo html update --selector '[data-duo-pane="lesson-body"]' --html '
  <h2>Theme &amp; focus — small but useful</h2>
  <p>Two more verbs you should know about. Try these:</p>
  <p>
    <button class="cta" data-duo-action="theme:set" data-theme="dark">
      Switch to dark mode
    </button>
    <button class="secondary" style="margin-left: 8px;"
            data-duo-action="theme:set" data-theme="system">
      …back to system
    </button>
  </p>
  <p>And to put focus on the terminal so you can type to me again:</p>
  <p>
    <button class="cta" data-duo-action="terminal:focus">
      Focus the terminal
    </button>
  </p>
  <p>(All these run from the same canvas-action vocabulary you can
  author into your own canvases. See
  <code>~/.claude/skills/duo/canvas-authoring.md</code>.)</p>
  <button class="cta" data-duo-action="duo:event"
          data-event="lesson-step-5-done">
    Last step
  </button>
'
```

**Wait for:** `lesson-step-5-done`.

### Step 6 — You're done

```bash
duo html update --selector '[data-duo-pane="step-counter"]' \
  --html '✓ Lesson complete'

duo html update --selector '[data-duo-pane="lesson-body"]' --html '
  <h2>You finished the intro</h2>
  <p>You now know about the terminal, the file navigator, the working
  pane (browser / editor / canvas), the agent loop, and a few small
  verbs for theme + focus.</p>
  <p>Next stop: the <strong>claude-code-basics</strong> pack —
  a 30-minute curriculum on Claude Code itself, organized into
  seven concept families. Ask me to "open the claude-code-basics
  orientation" any time.</p>
  <p>You can close this tab whenever — it won''t reopen on the next
  Duo launch.</p>
  <button class="cta" data-duo-action="duo:event"
          data-event="lesson-complete"
          data-payload="{\"pack\":\"intro-to-duo\"}">
    Thanks!
  </button>
'
```

**On final click:** acknowledge in the terminal — "great, ping me
any time." The user dismisses the canvas tab when ready.

---

## Reference — every action verb the canvas uses

| Verb | Used in | What it does |
|---|---|---|
| `claude:spawn` | welcome.html "Start lesson" | Spawned this very session |
| `nav:reveal` | step 2 | Reveal CLAUDE.md in navigator |
| `browser:open` | step 3 | Open anthropic.com in a browser tab |
| `theme:set` | step 5 | Flip theme |
| `terminal:focus` | step 5 | Put focus on terminal |
| `duo:event` | every step's "next" button | Emit event into the bus |
| `editor:open` | welcome footer "Open the FAQ" | Open the FAQ HTML |

If the user clicks an `editor:open` / `nav:reveal` / `browser:open`
mid-step, that's fine — those don't fire lesson events; just
acknowledge the side effect ("I see you opened the FAQ — want me to
walk you through it after the lesson?") and stay on the current step.

---

## When the user dismisses

- They close the welcome.html tab → done. Stage 18b's first-launch
  flag stays marked, so the canvas won't re-open on subsequent boots.
- They version-bump the pack (you ship a new lesson) → first-launch
  fires again with the new content.
- They install `claude-code-basics` later → that pack's orientation
  canvas opens on its first boot, independent of intro-to-duo.

---

## Troubleshooting

- **Canvas isn't painting.** Check `duo html query --selector "[data-duo-pane=lesson-body]"` returns a hit. If not, the canvas might have closed; ask the user to re-open via "Open ~/.claude/duo/packs/intro-to-duo/canvases/welcome.html".
- **`duo events --follow` shows nothing on click.** Click handlers only fire when the canvas's path is under `~/.claude/duo/` (Stage 23 trust gate). The pack canvas is — but if the user manually copied it elsewhere, actions inert. Tell them.
- **Multiple events per click.** Shouldn't happen with v1, but if you ever see it, the symptom is a double-jump in lesson steps. Make each step idempotent (re-painting the same step's HTML is harmless).
