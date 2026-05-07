---
name: smoke-walk
description: Generate an interactive HTML smoke-walk page for the user to validate a sprint's user-visible changes. Each item has pass/fail toggle + notes; the user clicks Copy, pastes the result here, and Claude parses it to flip statuses / propose a cut. PROACTIVELY OFFER at the end of any sprint that touched renderer/, electron/, cli/duo, skill/, or agents/ — before any cut-version proposal.
---

# Smoke walk skill — Duo

> **Why this skill exists.** Geoff has been doing manual ad-hoc
> smoke walks: I list bullet points in chat, he types prose
> back, I parse it. The format drifts every sprint. He asked for
> something durable: a generated HTML page, embedded in the
> running Duo, with structured pass/fail toggles + a "Copy
> results" button he hits when done. Encodes both the procedure
> AND the data shape so we don't lose continuity sprint-to-sprint.

---

## When to propose a smoke walk

**Strong triggers (offer before claiming work done):**

1. A sprint of 3+ commits touches user-visible surfaces:
   `renderer/`, `electron/`, `cli/duo`, `skill/`, `agents/`,
   `~/.claude/duo/help/`, IPC contracts in `shared/`.
2. After fixing a recurring-class bug (BUG-038 family, focus
   tracking, ⌃Tab cycle, anything with multiple prior instances).
3. Before invoking the `cut-version` skill on a sprint that
   shipped fixes whose user-side validation hasn't happened.

**Skip when:**
- Doc-only changes (no observable behavior).
- Refactors with no behavior delta.
- The user already verified in the same session (ask to confirm
  before assuming).

---

## Procedure

### 1. Identify the items to validate

Read the entries in `tasks.md` flipped to `✅ Shipped <today's
date>` since the last release tag. Cross-check with the most
recent dated section in `docs/dev/session-log.md`. Aim to cover
every BUG-* / ENH-* that could plausibly need user-side
verification — small refactors get folded into the parent item.

### 2. Construct a manifest

**Precondition — verify package.json matches the in-progress version
BEFORE generating the manifest.**

```bash
grep '"version"' package.json | head -1
```

If `package.json` still reads the version that was just CUT (e.g.
"0.5.3" right after a v0.5.3 cut), the dev build's titlebar will say
`0.5.3 ·dev` while the smoke walk page is named `v0.5.4-*`. This was
the v0.5.4-rev3 confusion: Geoff asked "is the badge wrong or am I
walking the wrong build?" The answer was "neither, the cut-version
skill missed a step."

The fix lives in `cut-version` § Step 7 (post-cut bump). If you find
the version unbumped here, **stop and bump it first** — same MINOR
the smoke walk is targeting:

```bash
# Edit package.json: "version": "0.5.4"  (no -dev suffix)
# Then commit it as a separate "chore: bump to vX.Y.Z for next sprint"
# commit before generating the manifest.
```

**Then** build a JSON manifest at
`docs/dev/smoke-walks/v<NEXT_VERSION>.json` (or
`v<NEXT_VERSION>-rev<N>.json` for re-walks of the same sprint) with
this shape:

```json
{
  "version": "0.5.4",
  "date": "2026-04-30",
  "items": [
    {
      "id": "BUG-038",
      "title": "⌃Tab cycle reaches all tabs",
      "what_fixes": "Cycle was taking the browser branch when focusedColumn was stale. Added activePaneRef mirror.",
      "steps": [
        "Open ~10 mixed terminal tabs (claude + shell mix)",
        "Click the rightmost tab",
        "Press ⌃Tab repeatedly",
        "Confirm the cycle visits every tab in order with no skips",
        "Click into a browser tab; ⌃Tab from there should immediately cycle browser tabs (no first-keystroke staleness)"
      ]
    }
  ]
}
```

`generate.mjs` (Step 3) ALSO cross-checks the manifest's `version`
field against `package.json` and refuses to write the HTML when they
don't match — so even if Step 2's precondition is missed, the walk
page can't ship under a misleading version string.

Field guide:
- `id`: BUG-* / ENH-* exactly as in tasks.md.
- `title`: short noun phrase from the tasks.md entry.
- `what_fixes`: 1-2 sentences. The user reads this before testing
  to know what "passing" looks like.
- `steps`: numbered concrete actions. Imperative. Don't say
  "verify X works" — say "press ⌃Tab and confirm Y."
- Order items by priority (highest first) — recurring-class bugs
  go first so the user sees them while attention is fresh.

**Get this right. The manifest is the spec.** A vague step
("test the find bar") leads to a vague pass/fail signal. A
concrete one ("⌘F → search 'Status' → press ↓ → match scrolls
to viewport center") gives unambiguous data.

### 3. Generate the HTML page

```bash
node .claude/skills/smoke-walk/generate.mjs \
  docs/dev/smoke-walks/v<VERSION>.json \
  docs/dev/smoke-walks/v<VERSION>.html
```

The generator reads the JSON, embeds the items into a self-contained
HTML page (Atelier-styled, scriptless dependencies, inline JS for
the copy button), and writes the output file.

### 4. Run `npm run dev` yourself — DO NOT ASK, AND **never restart Duo while a walk is in progress**

This is the first thing the skill must do. Geoff has been
explicit: *"run the dev server yourself."* Do not ask permission.
Do not offer options. Do not propose alternatives. The skill's
whole point is to remove the "should I?" friction from sprint-end
verification.

> **HARD RULE — Claude restarts Duo, never the user. This applies
> to EVERY verification flow, not just the smoke-walk handoff.**
>
> Never write any variant of these phrases anywhere in the
> conversation:
> - "to walk, run `npm run dev`"
> - "once you restart Duo / the dev environment / the app"
> - "after you relaunch Duo"
> - "please restart Duo and verify"
> - any other sentence that puts the restart on the user.
>
> If verification needs a fresh main-process bundle (you edited
> `electron/`, `core/`, `shared/host-api.ts`, `shared/html-boilerplate.ts`,
> or anything imported from `electron/main.ts`), YOU restart it —
> with the kill→spawn→poll procedure in CLAUDE.md §7a:
>
> ```bash
> ps -ef | grep "MacOS/Electron \." | grep -v grep | awk '{print $2}'
> # → kill that PID, then:
> npm run dev   # in background
> # poll `duo doctor` until the socket is up, THEN proceed.
> ```
>
> The user's only job in any verification flow is to *observe and
> report* — not to debug whether Duo is running, not to relaunch it,
> not to wait for HMR. If Duo is in a state where the change won't
> show, that's Claude's problem to fix before handing off.
>
> This rule has been violated multiple times — flagged 2026-05-02
> ("NO NO NO -- the fucking skill should tell you this") for the
> handoff case, and again 2026-05-05 ("'once you restart the dev
> environment' YOU restart the dev environment") for mid-sprint
> verification. Read this section before EVERY verification handoff,
> AND any time you're about to type the word "restart" in a sentence
> directed at the user.

> **CRITICAL — never restart Duo (or kill the dev process tree)
> AFTER the user has started clicking through the smoke walk page.**
> Until ENH-038 (textarea persistence) ships, the user's typed walk
> notes are DOM state in the browser-tab textareas. A Duo restart
> closes those tabs and **the textarea contents are lost**. If you
> realize a restart is required mid-walk:
>
> 1. STOP. Do not kill anything.
> 2. Tell the user verbatim: "I need to restart Duo to apply <X>,
>    but doing so will lose the walk notes you've typed so far. You
>    have three options: (a) Copy results NOW with what you have,
>    paste back, then I restart and we continue with the remaining
>    items, (b) finish the walk first and I restart after, (c) I
>    leave Duo alone and we proceed with whatever <X> would have
>    fixed unfixed."
> 3. Wait for their answer. Do NOT proceed without explicit
>    "yes restart" if option (a) or (b).
>
> Once ENH-038 ships, the page localStorage-persists textarea
> contents on every keystroke and a restart is recoverable —
> remove this warning at that point.

**Pre-flight (before starting the dev that the walk will run
against): identify any main-process changes that need to land
before the user starts walking.** Renderer-only changes HMR live;
preload + main need a restart. If you've made main-process changes
that are NOT yet running in the dev, do all the restarts BEFORE
calling Step 4 done. The user's first click on the smoke walk
page is the cutoff.

> **HARD RULE — check for an existing `npm run dev` BEFORE
> spawning a new one. Never run two dev servers at once.**
>
> Each `npm run dev` invocation spawns its OWN electron-vite, which
> spawns its OWN Electron. The two trees are *not equivalent* —
> they were compiled at different timestamps so their MAIN-process
> bundles diverge (HMR only touches the renderer). With two
> Electrons running you also have two competing socket binds and
> ambiguous routing for `duo` CLI commands. The user sees two app
> icons in the Dock and (correctly) demands an explanation.
>
> Before any `npm run dev` decision, run THIS exact probe:
>
> ```bash
> ps -ef | grep "MacOS/Electron \." | grep -v grep | awk '{print $2}'
> ```
>
> Interpret:
> - **Zero matches:** nothing running. Spawn `npm run dev` in
>   background.
> - **Exactly one match:** an existing dev (or packed app) is
>   already live. **DO NOT spawn another.** Adopt it. Renderer
>   changes you've already made are HMR'd in. If you have
>   uncommitted main-process changes (`electron/`, `core/`,
>   `shared/host-api.ts`, `shared/html-boilerplate.ts`, anything
>   imported from `electron/main.ts`), warn the user and ask whether
>   to restart that single Electron — DO NOT silently kill it, and
>   DO NOT add a parallel one. (Mid-walk restart still requires the
>   "lose textarea contents" warning below.)
> - **Two or more matches:** you (or a prior session) already
>   spawned a duplicate. Stop. Tell the user, name the PIDs, ask
>   which one to keep. Killing one without checking risks killing
>   their workspace.
>
> Violated 2026-05-04: two Electrons running in parallel because the
> agent ran `npm run dev` without checking. Geoff (rightly) flagged
> it as procedure failure. Read this section before EVERY pre-flight.
>
> **Socket-cleanup gotcha (also 2026-05-04):** when you do find a
> duplicate and kill the wrong one (or even the right one), the
> socket file at `~/Library/Application Support/duo/duo.sock` may
> get unlinked as part of either Electron's cleanup — even though
> the OTHER Electron is still alive and was the original binder.
> Symptom: `duo open` and other CLI verbs return *"Duo app is not
> running"* even though `ps` shows the process is alive. The fix
> is a restart: kill the surviving Electron and start fresh so the
> socket-server binds a clean path. Don't try to "rescue" a
> broken-socket Electron — restart is faster and more reliable.

**Action paths after the probe:**

- **A packed `.app` is running** (path contains `dist/mac-arm64/`
  or `/Applications/Duo.app`): tell the user once: *"Quitting the
  packed app and starting dev — your shipped code isn't live in
  the running build. The smoke page will reload when dev comes
  up."* Then: kill the packed app politely (`osascript -e 'quit
  app "Duo"'`) OR ask the user to quit it via ⌘Q if you don't have
  computer-use access. Do NOT proceed until it's gone — two Duo
  instances fighting over the socket is worse than no Duo.
- **Existing dev is running, no main-process changes pending**:
  adopt it as-is. Renderer changes are already HMR'd in.
- **Existing dev is running, main-process changes pending**:
  warn the user (one line: "I have main-process changes that need a
  restart for X / Y / Z; OK to restart Duo? No walk is in progress
  so no walk-notes will be lost."), wait for explicit yes, then
  restart that single Electron. Don't add a parallel one.
- **Nothing running**: launch `npm run dev` via Bash with
  `run_in_background: true`. Don't poll for output — the dev
  server takes 3–6s to boot.

After kicking it off, wait one cache-window (~270s if you have
nothing else to do, or ~10s plus a `duo nav-state` probe to
confirm the bridge is up). The probe returns JSON when the
renderer is alive; before that it errors with `ECONNREFUSED`.

If `duo nav-state` still errors after ~30s, surface the dev
server's stderr to the user — something else is wrong (port in
use, missing dependency, sandbox refusal). Don't keep silently
retrying.

### 5. Open the smoke walk page in Duo's browser pane AND bring focus to it BEFORE you ask the user to walk it

```bash
duo open docs/dev/smoke-walks/v<VERSION>.html
```

`duo open` resolves the relative path to a `file://` URL and opens
it as a browser tab. **Browser pane is required** — the page uses
`navigator.clipboard.writeText`, which doesn't work in canvas
sandboxes (no `allow-scripts`). Browser tabs are full Chromium,
which has clipboard access on user-gesture click events.

**ENH-036 (shipped v0.6.4):** `duo open` now auto-focuses the new
browser tab — flipping the WorkingPane to `activeWorking.kind === 'browser'`
even when the user was on a canvas / file tab. The expected
post-`duo open` state is "the smoke walk page is the visible tab
in the browser pane," not "tab is open but hidden."

**HARD RULE — verify the page is the active visible tab before
asking the user to walk it.** Don't hand off and assume; check.
After `duo open`, run:

```bash
duo url
duo title
```

`duo url` returns the URL of the currently-active browser tab;
`duo title` returns its document title. Confirm the URL matches
the worksheet path (`file://.../v<VERSION>.html`) and the title
matches the manifest's `title` field. If either doesn't match —
or the command errors — the page is not focused or the bridge is
dead. Re-issue `duo open`, or if you suspect socket trouble, fall
back to the pre-flight probe in Step 4.

> Violated 2026-05-04: agent ran `duo open` once, then immediately
> wrote a "smoke walk is ready, walk it" handoff message. Geoff
> reported back that no smoke walk file was active — the prior
> `duo open` had landed on a now-killed duplicate Electron, and the
> agent never verified the survivor had actually accepted the open.
> Always verify focus AFTER the open, BEFORE the handoff.

### 6. Hand off to the user

Say (briefly), incorporating the focus-the-tab nudge from Step 5:

> Smoke walk page is open as a browser tab titled **"Smoke walk
> v<VERSION>"**. Click it in the working-pane tab strip if the
> page isn't already showing. For each item: mark Pass or Fail,
> add notes if anything's off. When done, click "Copy results"
> at the bottom and paste back here.

**Don't elaborate.** The page itself is the spec. If the user has
questions they'll ask.

### 7. Parse the user's pasted results

The user pastes a block in the format the Copy button generates
(see *Result format* below). Parse it line-by-line and:

- For each `[PASS]` item: confirm the tasks.md entry stays ✅.
  No action needed.
- For each `[FAIL]` item: re-open the tasks.md entry. Flip status
  to 🟡, prepend a "User-verified failure on smoke walk" note with
  the user's notes verbatim and today's date. Add the item to a
  "carry-over for next sprint" section in session-log.
- For each `[SKIP]` (no result chosen): note in the response that
  this item wasn't tested; ask the user whether to defer it or
  whether they want a re-run. Don't silently treat as PASS.

After parsing, write a short summary (5-10 lines max):
- `N/M PASS` — the count.
- One bullet per FAIL with the user's notes.
- A recommendation: cut now / fix-and-recut / hold for
  another walk.

### 8. Decide on the cut

If everything passed, propose a `cut-version` flow.
If anything failed, the cut waits — fix the failures first, then
re-walk (a second smoke walk is fine for the same version).

---

## Result format (what the Copy button outputs)

```
SMOKE WALK v0.5.4 (2026-04-30)
==============================

[PASS] BUG-038 — ⌃Tab cycle reaches all tabs

[FAIL] BUG-042 — Browser pane focus
  Notes: Click in browser pane, ⌃Tab still cycled terminal tabs once

[PASS] BUG-043 — ⌘F find scroll-to-match + arrow keys

[SKIP] ENH-026 — Right-click on tab menu

SUMMARY: 6 PASS, 1 FAIL, 1 SKIP (8 total)

OTHER NOTES
-----------
Tab strip background contrast still feels off in dark mode.
Filed as a separate paper-cut to track.
```

**Format invariants the parser depends on:**
- Header: exactly `SMOKE WALK v<VERSION> (<DATE>)` then `===` rule.
- Each item: blank line above, `[STATUS] <id> — <title>` line, optional
  `  Notes: <text>` line (indented 2 spaces; multi-line notes use
  `\n  ` to preserve indentation).
- Footer: `SUMMARY: ...` line.
- **Optional `OTHER NOTES` block** at the bottom (blank line +
  `OTHER NOTES` + dash rule + free text). Only present when the
  user typed into the misc-notes field. Capture verbatim and treat
  every line as observation: file paper cuts as their own BUG-* /
  ENH- entries in tasks.md, surface UX drift in the next sprint
  plan, etc. Don't try to PASS/FAIL anything in this block.
- STATUS is exactly one of `PASS`, `FAIL`, `SKIP`.
- Items are in the same order as the manifest (so ordering errors
  in the source manifest propagate, but parse-side is positional).

If a user manually-edits the pasted text, the parser is
forgiving — match by `id` + `STATUS` token; ignore extra
whitespace.

---

## Manifest authoring tips

**Concrete > generic.** Bad: "test the new context menu." Good:
"right-click on whitespace below the file rows in the navigator;
expect the menu to show only New file / New folder / Open terminal
here / Reveal in Finder."

**One concept per item.** A combined "test BUG-038 + BUG-042 + ENH-024"
forces a single pass/fail for three independent things. Split them.

**Visible steps, not internal mechanism.** The user doesn't care
that we added an activePaneRef; they care that ⌃Tab now reaches
all 10 tabs. Lead with the symptom-and-fix, not the diff.

**Edge cases as separate steps.** If a fix has a degenerate case
(e.g. ⌃Tab from the rightmost tab wraps to first), make it a
distinct step in the same item — not a separate item.

**Priority ordering.** Highest-priority / recurring-class items at
the top so they get attention while the user is fresh. Scope-creep
ENHs at the bottom.

**Mandatory regression items (every release).** These are bugs
that have recurred multiple times across walks. Each release's
manifest MUST include them, with explicit verification steps.

> **HARD RULE — when a regression item gets durable automated test
> coverage that passes in CI, REMOVE it from this list AND from
> the next sprint's manifest.** The smoke walk is for things that
> MIGHT have regressed; CI catches the things the test suite
> already guarantees. Owner-flagged 2026-05-07 walk-2: "WHY AM I
> SEEING THIS IF YOU TEST IT AND IT PASSES DON'T SHOW ME THIS."
> Adding a "verify the test exists" smoke-walk row is the same
> mistake — drop the item entirely.

(Currently no items in this section — BUG-056 was removed
2026-05-07 after `electron/cdp-bridge.test.ts` landed with three
asserts on the IIFE source. Add new items here when a bug recurs
across two releases AND there's no clean automated test path
yet.)

**Code blocks + Copy buttons (ENH-046 — 2026-05-02 walk-2).** Any
shell command, code snippet, or file path the user is expected to
COPY-AND-RUN must be wrapped in single backticks in its step
string. The generator (`generate.mjs § renderStepHtml`) splits on
backticks and pulls out anything that:
- has whitespace, OR
- is longer than 25 characters, OR
- starts with a recognized shell verb (`duo`, `node`, `ls`, `pkill`,
  `bash`, `npm`, `cd`, `mkdir`, `rm`, `git`, `grep`, `find`, etc.)

…into a styled `<pre>` with a Copy button alongside. Short tokens
like `\`PASS\`` or `\`false\`` stay inline as `<code>` (no Copy
button — user wouldn't click to copy a single word).

Why this matters: walk-2 found the user pasting bare commands into
their terminal by hand because the smoke-walk page was rendering
them as inline code with surrounding prose — forcing a triple-click
+ careful selection. Wrapping in backticks gets you a one-click
copy.

Bad (forces hand-typing):
```
"From any terminal, run: ls -la ~/.claude/skills/duo/canvas-authoring.md"
```

Good (gets a Copy button):
```
"From any terminal, run: \`ls -la ~/.claude/skills/duo/canvas-authoring.md\`"
```

This convention also propagates beyond the smoke walk: any canvas
template (`skill/canvas-templates/*.html`) that includes a runnable
command should expose a Copy button via the same `<pre data-copy>`
shape. ENH-043 / ENH-046 in tasks.md have the carve-up.

---

## Files

- `.claude/skills/smoke-walk/SKILL.md` — this file (procedure).
- `.claude/skills/smoke-walk/generate.mjs` — thin transformer that
  adds smoke-walk specific defaults (PASS / FAIL / SKIP controls,
  "Mark all Pass" button, package.json version cross-check) and
  delegates to the **worksheet** generator. The HTML page chrome
  (Atelier styling, persistence, backtick → Copy-button rendering,
  path-link forwarding, Send-to-Claude footer) all live in the
  worksheet primitive — see `.claude/skills/worksheet/SKILL.md` for
  the rendering reference. This skill is the PROCEDURE doc (when
  to walk, what items to include, how to react to results).
- `docs/dev/smoke-walks/v<VERSION>.json` — generated manifest.
- `docs/dev/smoke-walks/v<VERSION>.html` — generated page (open
  via `duo open`).

The `docs/dev/smoke-walks/` directory is gitignored except for
manifests Geoff wants to keep as receipts (rare). Don't commit
the generated HTML files unless explicitly asked.
