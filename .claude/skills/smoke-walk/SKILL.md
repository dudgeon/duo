---
name: smoke-walk
description: Generate an interactive HTML smoke-walk page for the user to validate a sprint's user-visible changes. Each item has pass/fail toggle + notes; the user clicks Copy, pastes the result here, and Claude parses it to flip statuses / propose a cut. PROACTIVELY OFFER at the end of any sprint that touched renderer/, electron/, cli/duo, skill/, or agents/ — before any cut-version proposal.
---

# Smoke walk skill — Duo

> **Why this skill exists.** Geoff has been doing manual ad-hoc
> smoke walks: I list bullet points in chat, he types prose
> back, I parse it. Format drifts. He asked for something
> durable: a generated HTML page embedded in the running Duo,
> with structured pass/fail toggles + a Copy-results button.
> Encodes both the procedure AND the data shape so we don't lose
> continuity sprint-to-sprint.

> **Companion references** (`.claude/skills/smoke-walk/references/`)
> hold the long-form rules + violations. Read on-demand when the
> short rule below isn't enough:
> - `restart-and-preflight.md` — how to deal with the running dev
>   process, when to restart, the never-restart-mid-walk rule.
> - `clean-state-checks.md` — the pre-handoff verification
>   checklist + error-overlay patterns to scan for.
> - `result-format-and-parsing.md` — exact result-block shape +
>   per-status actions.
> - `manifest-authoring.md` — writing-a-good-manifest tips +
>   the regression-coverage drop-rule.

---

## When to propose a smoke walk

**Strong triggers (offer before claiming work done):**

1. A sprint of 3+ commits touches user-visible surfaces:
   `renderer/`, `electron/`, `cli/duo`, `skill/`, `agents/`,
   `~/.claude/duo/help/`, IPC contracts in `shared/`.
2. After fixing a recurring-class bug.
3. Before invoking the `cut-version` skill on a sprint that
   shipped fixes whose user-side validation hasn't happened.

**Skip when:**
- Doc-only changes (no observable behavior).
- Refactors with no behavior delta.
- The user already verified in the same session (ask to confirm
  before assuming).

---

## HARD RULE — Walk every CLI-testable step yourself before handoff

> **If a smoke-walk step CAN be run via the `duo` CLI without a mouse
> click or visual judgment, the agent MUST run it before handing the
> walk to the owner.** Mark items as known-PASS in the intro when
> agent-walked successfully, so the owner can skip them and focus on
> the genuinely-eyes-on items.
>
> CLI-testable categories (run yourself, no exceptions):
> - `duo dom` / `duo eval` / `duo nav-state` / `duo layout` / `duo
>   doctor` / `duo url` / `duo title` / any deterministic verb that
>   returns text or JSON.
> - Verb sequences with verifiable end-state via the visibility cluster
>   (e.g. `duo split 80` then `duo edit --reveal foo` then `duo layout`
>   to confirm `splitPct: 50` + `active: 'file'` — verify the layout
>   change WITHOUT the user).
> - Anything where success/failure is a string or JSON shape match.
>
> Owner-only categories (genuinely require eyes / hands):
> - Visual rendering checks ("the panel fills the editor area", "the
>   tint covers the image", "no quote marks around the blockquote").
> - Native gestures the agent can't synthesize cleanly (drag-drop from
>   Finder, keyboard chords with timing, right-click context menus —
>   menu.popup is a native NSMenu so we can't programmatically click).
> - Final user-perception calls ("does this feel right", "is the chord
>   discoverable").
>
> **Don't ship a manifest where the agent could have caught a failure.**
> If the agent walks step 1 and it fails, the agent fixes it before
> handoff — owner shouldn't see the failure at all. The walk surface
> is the OWNER's verification of OWNER-judgment items, not a test
> harness for things the agent should have validated.
>
> Owner directive that produced this rule (2026-05-10 walk-2 on
> v0.6.12-rev2): *"ran step 1; did not confirm the rest -- this is
> something you should be able to walk for me (and I expect you to)."*

---

## HARD RULE — Never re-walk what the user already verified

> **The manifest contains ONLY items the user has not yet PASSed.**
>
> **First walk of a version (`v<VERSION>.json`):** every shipped item
> needing user verification.
>
> **Re-walk (`v<VERSION>-rev<N>.json`, N ≥ 2):** the union of
> 1. items that FAILed in walk-(N-1), now being re-tested (annotate
>    the title with `(walk-N — <fix-summary>)`), and
> 2. carry-forward decision-gate SKIPs that explicitly persist across
>    walks (e.g. ENH-110-style items the owner deferred), and
> 3. new items shipped between walks (rare).
>
> **It does NOT contain the walk-(N-1) PASS rows.** The user already
> walked them; making them re-walk is redundant work and visual
> noise. This applies even when a walk-N fix touches code that also
> affects the PASS items — trust the prior PASS unless you have
> specific reason to suspect a regression. If you do suspect one,
> call it out in the intro; don't hide it inside a re-tested
> manifest entry.
>
> **Same rule for items covered by passing automated tests.** If a
> regression has CI coverage that passes, it is NOT a smoke-walk
> item — drop it.
>
> Owner directives that produced this rule:
> - 2026-05-07 walk-2 on v0.6.9: *"WHY AM I SEEING THIS IF YOU TEST
>   IT AND IT PASSES DON'T SHOW ME THIS."*
> - 2026-05-10 walk-2 on v0.6.12-rev2: *"why are there stale,
>   already verified tasks still showing in
>   docs/dev/smoke-walks/v0.6.12-rev2.html"* / *"I don't want to see
>   already-walked tasks."*

---

## HARD RULE — the Copy-results button must NEVER silently fail

> **The programmatic clipboard (`navigator.clipboard.writeText` AND the
> legacy `execCommand('copy')`) can no-op SILENTLY in the split-view aux
> WebContentsView — reporting success while writing nothing.** The user
> clicks "Copied!", pastes an empty string, and the walk is lost. This
> has recurred MULTIPLE times.
>
> Two-part defense (both already implemented — do not regress them):
> 1. **The generator ALWAYS surfaces a pre-selected `<textarea>` modal**
>    (`#copy-modal .copy-modal-ta`) when "Copy results" is clicked, with
>    the full result text selected, so the user can `⌘C` it reliably. The
>    programmatic copy is a bonus, never the only path. (`worksheet/
>    generate.mjs` `showCopyModal`; regression tests in `generate.test.ts`
>    "copy reliability".)
> 2. **The pre-handoff check verifies the MODAL appears, not just a
>    stubbed payload.** Stubbing `writeText` to capture the text MASKS the
>    real failure (the stub always "succeeds"). After clicking copy, you
>    MUST confirm `#copy-modal .copy-modal-ta` exists and holds the result
>    block (see § 5b item 3). If you ever "fix" the generator to trust the
>    clipboard alone, you are reintroducing this bug.
>
> Owner directive that produced this rule (2026-06-21, v0.11.2 ENH-224
> walk): *"you have yet again produced a smoke walk sheet with broken copy
> functionality … implement a fix to avoid this in the future."*

## HARD RULE — manifest fixtures must be OPENABLE files

> **Every fixture path a manifest step tells the owner to open MUST be a
> file Duo's classifier can actually open — i.e. it has an extension the
> classifier recognizes (`.md` / `.json` / `.yaml` / `.html` / image /
> pdf …).** A bare `README` (no extension) cannot be opened as an editor
> doc, so the owner gets a dead step and FAILs an item that was never
> about the feature.
>
> - When a step opens a remote/GitHub file, pick a URL whose path ends in
>   a real extension (e.g. `…/blob/main/README.md`, not `…/blob/master/
>   README`).
> - **Walk the fixture open yourself before handoff** (`duo open <fixture>`
>   then `duo layout` to confirm it mounted as the expected `kind`). Per
>   the "walk every CLI-testable step" rule, a fixture that won't open is
>   an agent-catchable failure — fix the manifest, don't ship it.
>
> Owner directive (2026-06-21, v0.11.2 ENH-224 walk): two items FAILed
> with *"README has no extension so Duo cannot open it"* / *"cannot edit
> file; see prior step."*

---

## Procedure

### 1. Identify items to validate

**For a first walk (no prior `rev`):** read entries in `tasks.md`
flipped to `✅ Shipped <today's date>` since the last release tag.
(Newly-shipped ✅ entries stay in `tasks.md` until the cut-version skill
archives them to `tasks-archive.md` — ENH-191/D1 — so this pre-cut read is
correct; older closed history lives in the archive, not the open backlog.)
Cross-check the most recent dated section in
`docs/dev/session-log.md`. Cover every BUG-/ENH- that plausibly
needs user-side verification — small refactors fold into the
parent item.

**For a re-walk (rev2+):** read the user's pasted walk-(N-1) result
block from chat (parsed in step 7 of the previous walk). The manifest
is exactly the FAIL ids + carry-forward SKIP ids. **Do not include
PASS ids.** See HARD RULE above.

**Always include 🟡 owner-decision gates.** Scan `tasks.md` for
`Status:** 🟡 Awaiting` entries. Each one is a playground requiring
owner walk + Copy-decisions round-trip. These items MUST appear in
every smoke-walk manifest (first walk or any re-walk) until the
owner closes the gate. They appear in the manifest with the playground
path as the steps:

```json
{
  "id": "GATE-BUG-125-v2",
  "title": "DECISION GATE — BUG-125 v2 canvas baseline (4 decisions)",
  "what_fixes": "Owner-decision gate. Walk the playground, pick a radio for each decision card, copy-paste back to Claude. Implementation blocked until decisions land.",
  "steps": [
    "Open the playground: `duo open docs/research/bug-125-canvas-baseline-v2.html`",
    "Read the 4 decision cards. Pick a radio for each + add any notes.",
    "Click **Copy decisions** at the bottom; paste back.",
    "Mark PASS if you copy-paste; SKIP only if you want to defer the gate longer (blocks the cut)."
  ]
}
```

The cut-version skill's Step 0 enforces the same — gates must close
before any cut. Smoke-walk manifests surface them so they don't
disappear silently.

### 2. Construct a manifest

**Precondition — verify package.json matches the in-progress
version BEFORE generating.**

```bash
grep '"version"' package.json | head -1
```

If `package.json` still reads the just-CUT version, **stop and
bump it first** (the dev build's titlebar would say one version
while the walk page says another). Fix lives in `cut-version` §
Step 7 (post-cut bump). Commit as `chore: bump to vX.Y.Z for
next sprint`.

Then write a JSON manifest at
`docs/dev/smoke-walks/v<NEXT_VERSION>.json` (or
`v<NEXT_VERSION>-rev<N>.json` for re-walks).

**Re-walk reminder (HARD RULE above): the rev<N> manifest contains
ONLY the walk-(N-1) FAIL items + carry-forward SKIPs. Never copy
the walk-(N-1) manifest forward.** A first walk has 12 items, walk-2
should have ~5, walk-3 should have ~2, and so on — items get
verified out of the rotation, not perpetually re-walked.

```json
{
  "version": "0.6.11",
  "date": "2026-05-09",
  "items": [
    {
      "id": "BUG-038",
      "title": "⌃Tab cycle reaches all tabs",
      "what_fixes": "1-2 sentences on why the original failure happened + what the user should see when it passes.",
      "steps": ["Imperative step 1.", "Imperative step 2.", "..."]
    }
  ]
}
```

`generate.mjs` (Step 3) cross-checks `manifest.version` against
`package.json` and refuses to generate when they don't match.

**The manifest is the spec.** A vague step ("test the find bar")
gives a vague pass/fail. A concrete step ("⌘F → search 'Status'
→ press ↓ → match scrolls to viewport center") gives unambiguous
data. See `references/manifest-authoring.md` for writing patterns,
the regression-coverage drop-rule, and the backtick → Copy-button
convention.

### 3. Generate the HTML page

```bash
node .claude/skills/smoke-walk/generate.mjs \
  docs/dev/smoke-walks/v<VERSION>.json \
  docs/dev/smoke-walks/v<VERSION>.html
```

The generator embeds the items into a self-contained HTML page
(Atelier styling, Copy + Send-to-Claude buttons, localStorage
persistence) and writes the output file.

### 4. Bring up the dev — YOU restart it, never the user

Probe before touching anything:

```bash
ps -ef | grep "MacOS/Electron \." | grep -v grep | awk '{print $2}'
```

- **Zero matches:** spawn `npm run dev` in background.
- **Exactly one match:** adopt it. Renderer changes are HMR'd.
  Main-process changes need a restart — warn first, don't
  silently kill.
- **Two or more:** stop. Name the PIDs to the user, ask which to
  keep.

After spawning, poll `until duo doctor 2>&1 | grep -qE "✓ Unix
socket"; do sleep 2; done` (clamped 60s) before proceeding.

> **Hard rules:** Claude restarts Duo, never the user. Never
> restart Duo mid-walk (loses textarea contents until ENH-038
> ships). See `references/restart-and-preflight.md` for the full
> rules + violation history + socket-cleanup gotcha.

### 4b. ALWAYS force a hard reload of the main renderer

> **HARD RULE — after any sequence of dev restarts during this
> sprint's build, force a hard reload of the renderer BEFORE
> handoff.** HMR through multiple restarts can leave the renderer
> bundle pinned to an older module graph than what's on disk; the
> agent's pre-handoff DOM probes might see the new code while the
> user (who hasn't reloaded since) sees the old.

This rule was added 2026-05-24 after ENH-183 v0.7.9 walk-1 returned
2 FAILs on the foundational S1 visual surface ("I don't see
anything"). Root cause: the SessionHeader module had been edited 7
times across C3/C5/C6/C7/C9/C10/C11; the agent restarted dev twice
for IPC changes; renderer HMR settled into a state where the
TerminalPane was rendering xterms cleanly but the SessionHeader
child wasn't producing any DOM. Agent's pre-handoff probe (before
the user walk) had seen the live S1 banner, so the agent thought
it was clean. After the user reported "I don't see anything", the
agent injected a debug span on the S0 branch — still no DOM. Then
`window.location.reload()` on the main renderer: immediately the
S1 banner rendered correctly with all 3 pill rows. The code was
always right; the running renderer was stale.

**Required commands** (run after every dev restart and once more
right before handoff):

```bash
duo dom --js 'window.location.reload()'
# Wait for renderer to come back. The IPCs become unavailable for
# ~1-2s during reload — poll until a known IPC returns success.
sleep 3
until duo dom --js 'typeof window.electron?.session' 2>&1 | grep -q object; do
  sleep 1
done
```

The reload covers TWO classes of failure the HMR path doesn't:
1. **Module-pinning staleness** — the case described above, where
   HMR partially reapplied a re-exported component.
2. **localStorage drift** — if a renderer pref was set by a debug
   probe (e.g. a tip dismissed during agent verification),
   reloading doesn't reset it. **You also reset any pref the
   manifest exercises** (see § 5b item 7).

### 4c. PROBE the actual surface in the live renderer

> **HARD RULE — verify with a DOM query that the surface the
> manifest's first item exercises is actually mounted in the
> renderer AFTER the reload, AND that its computed styles aren't
> rendering it invisible.** Don't trust that "the code looks
> right" — query the DOM for the data-attribute AND inspect
> computed styles on the surface root + key children.

Every renderer-touching surface in ENH-XXX work MUST expose a
stable `data-*` attribute so the smoke-walk preflight can probe
it. Example for ENH-183:

```bash
# Open a known-good cwd that should fire the surface, then probe.
duo dom --js '(() => {
  const tabs = document.querySelectorAll("[role=tab]");
  // Click a known-good tab that triggers the surface
  // ...feature-specific selector...
  const surface = document.querySelector("[data-session-header-state]");
  if (!surface) return JSON.stringify({mounted: false});
  const cs = getComputedStyle(surface);
  // CRITICAL — also probe computed styles. ENH-183 walk-1 had the
  // surface MOUNTED with the right textContent but invisible:
  // - bannerBg: rgba(0,0,0,0) — transparent (var(--duo-surface) undef)
  // - text colors falling back to dark-on-dark (var(--duo-text) undef)
  return JSON.stringify({
    mounted: true,
    state: surface.dataset.sessionHeaderState,
    visible: cs.visibility !== "hidden" && cs.display !== "none",
    bgColor: cs.backgroundColor,
    color: cs.color,
    position: cs.position,
    height: surface.offsetHeight
  });
})()'
```

If the probe returns `{mounted: false}`, the renderer is stale OR
the gate logic is broken. Either way, **do not hand off** until
the probe returns the expected mounted state.

**If `bgColor` is `rgba(0,0,0,0)` (transparent) OR `color` matches
`bgColor` or any parent's bgColor, FAIL the preflight.** That's the
"surface is mounted but invisible" failure mode from ENH-183
walk-1. The bug was undefined CSS vars (`var(--duo-text)`,
`var(--duo-surface)` — neither exists in Duo's actual token set);
fallbacks resolved to dark-on-dark text. Element existence checks
PASSED but the user saw nothing.

**Manifest authors:** in your manifest's intro, list the DOM
selectors AND the expected computed-style invariants for each
surface (e.g. "background must be opaque", "primary text color
must contrast with banner bg by ≥ 4.5:1"). Future agents
re-walking the same manifest re-probe identically.

### 4d. PROBE the renderer-state preconditions every gate depends on

> **HARD RULE — when a surface's gate depends on renderer/main
> state (workspace metadata, in-memory stores, IPC-driven flags),
> verify that state explicitly before claiming the surface "should
> render."** Don't just check that the surface CAN render; check
> that the state-machine inputs are what you think they are.

ENH-183 walk-1 had a second mount failure that this rule would
catch: the user opened a fresh shell tab in a CWD with prior
sessions, expecting S1 pills. The pills didn't render — but neither
was the surface "broken." S3 was rendering instead because the
autosave-driven enrichment hook had silently captured
`lastClaudeSession.id` on the fresh tab. The discriminator was
working correctly given its inputs; the inputs were wrong.

**Probe pattern for state-dependent gates:**

```bash
# For ENH-183 specifically:
duo dom --js '(() => {
  // Direct introspection of the renderer-state fields the
  // discriminator reads. Add a debug attribute in the surface
  // component (or call window.__duoGetState() if exposed) so the
  // preflight can see the actual inputs.
  const banner = document.querySelector("[data-session-header-state]");
  return JSON.stringify({
    renderedState: banner?.dataset.sessionHeaderState,
    expectedStateIf: "fresh shell tab + prior sessions in cwd should be S1",
    diagnostics: banner?.dataset // any data-debug-* attrs the surface exposes
  });
})()'
```

When the probe shows the rendered state ≠ the expected state,
**investigate the discriminator inputs** before assuming the
surface is broken. The fix may not be in the renderer at all —
it could be in main, in workspace metadata, in an IPC handler, or
in the gate condition itself. The Walk-1 fix for ENH-183 was in
`electron/main.ts`'s `setEnrichBeforePersistHook`, not in the
SessionHeader component.

### 5. Open the smoke walk page in the SPLIT-VIEW AUX

The owner runs the walk in the **Split View aux pane** — walk sheet pinned
in the aux, main pane left FREE for the validation tasks (opening fixtures,
`duo edit`, side-by-side checks). Open it THERE, not in the main pane. It's
a browser tab (NOT canvas — the page uses `navigator.clipboard.writeText`,
which needs Chromium's user-gesture clipboard access), then pinned into aux:

```bash
duo open docs/dev/smoke-walks/v<VERSION>.html   # opens as a browser tab
duo tabs                                         # find the "Smoke walk · v<VERSION>" tab id
duo split-view open-browser <id>                 # pin THAT tab into the aux pane
```

**Verify it landed in the aux BEFORE handoff — with the RIGHT probes.**
Because the sheet is in the aux, `duo url` / `duo title` / `duo tab` report
the MAIN pane, NOT the walk sheet — do NOT use them to verify here. Use:

```bash
duo split-view state   # aux.activePath must == the walk .html; aux.activeKind: "browser"
duo eval '(() => (document.querySelector("h1")||{}).textContent)()'
                       # duo eval targets the AUX (scripting) tab → must print "Smoke walk · v<VERSION>"
```

`duo eval` targets the aux browser page; `duo dom --js` targets the renderer
React shell. Don't cross them — that burned a debugging loop on the v0.9.1 walk.

**Stale-aux recovery.** Session-restore can wedge a tab into a half-aux
state (`duo tabs` shows `inAux: true` while `duo split-view state` shows
`aux: null`, and `duo tab <n>` errors *"pinned in Split View aux"*). Don't
fight it — close that tab and re-open fresh: `duo close <staleId>` →
`duo open <walk.html>` → `duo tabs` → `duo split-view open-browser <newId>`.

### 5b. Verify the app is in a CLEAN state before handoff

> **HARD RULE — never hand off if the app is in a crashed /
> errored state.** See `references/clean-state-checks.md` for the
> 6-point checklist + common error-overlay patterns + the
> Sprint 11 walk-1 violation (TipTap suggestion-key collision
> caught by ErrorBoundary, missed by agent).

Quick-pass version:

1. `duo doctor` clean.
2. `duo nav-state` returns OK.
3. **Exercise the worksheet primitive itself** — via `duo eval`
   (it targets the aux walk sheet, per § 5): select a radio, then
   click the **"Copy results"** button (match `textContent ===
   "Copy results"`, NOT a per-step backtick-command Copy). TWO things
   to verify — payload AND the guaranteed-paste-back fallback:
   - **Payload:** stub the clipboard to capture the text
     (`navigator.clipboard.writeText = t => { captured = t; return Promise.resolve(); }`)
     and confirm `captured` is the `[PASS]/[FAIL]/[SKIP]` block.
   - **Guaranteed fallback (the durable fix — do NOT skip):** after the
     click, confirm a `#copy-modal` overlay exists whose
     `.copy-modal-ta` textarea contains the result text. The generator
     ALWAYS surfaces this pre-selected textarea so the owner can ⌘C even
     when the programmatic copy silently no-ops in the aux
     WebContentsView. **A stub-only check is NOT enough — it MASKS the
     real failure** (stubbing makes the copy "succeed" while the owner's
     real click writes nothing). See the HARD RULE below.
   Then verify the localStorage round-trip — the per-version key is
   `worksheet:smoke-walk-v<VERSION>` (or `…-<slug>` when the manifest
   filename carries a slug); confirm it's DISTINCT from any older walk's
   key (the BUG-110 collision guard). Reset to fresh (uncheck +
   `localStorage.removeItem`) so the owner walks clean.
4. **Walk EVERY CLI-testable step in the manifest.** Per the HARD
   RULE at the top of this skill — if a step can be run via `duo
   <verb>`, the agent runs it before handoff. Capture the actual
   output; compare against the step's expected result; fix any
   FAILs before the user sees them. Mark agent-walked items in the
   manifest's intro so the owner knows which rows they can skim
   ("agent-walked: ENH-122-SELECTOR, ENH-122-JS, ENH-124-LAYOUT").
5. **Exercise the FIRST failure-prone visual step.** Computer-use
   granted: screenshot Duo + scan for error overlays. Computer-use
   denied: at minimum mount the relevant surface via CLI (e.g. `duo
   edit /tmp/preflight-X.md`).
6. Restart on uncertainty if many changes since last verified
   clean state.
7. **Force a hard renderer reload** (per § 4b) AND re-probe the
   surfaces the manifest's items exercise (per § 4c). The reload
   flushes module-pinning HMR staleness; the re-probe confirms
   the surface mounts AFTER the reload, not just at the moment
   you wrote the manifest.
8. **Reset any feature-specific renderer prefs** that the manifest
   exercises. Examples for ENH-183: `duo dom --js 'localStorage.
   removeItem("duo:enh-183:seen-rename-tip")'`. The user should
   walk a fresh first-time experience, not pick up your debug-
   probe state.

### 6. Hand off to the user

Brief handoff — the page itself is the spec:

> Smoke walk **v<VERSION>** is pinned in the **Split View aux pane**
> (main pane left free for your validation tasks). For each item: mark
> Pass or Fail, add notes if anything's off. When done, click **"Copy
> results"** at the bottom and paste back here.

If verification was impossible (no computer-use AND CLI
preflight skipped a step), say so EXPLICITLY in the first
sentence: *"I couldn't verify the app's render state — please
check DevTools (Cmd+Opt+I) for any error overlay before
walking."*

### 7. Parse the user's pasted results

The user pastes the Copy-button output. Parse line-by-line:

- `[PASS]` — entry stays ✅. No action.
- `[FAIL]` — flip tasks.md status to 🟡, prepend a "User-verified
  failure on smoke walk" note with verbatim user notes + today's
  date. Add to next-sprint carry-over.
- `[SKIP]` — note in the response that this wasn't tested; ask
  whether to defer or re-run. Don't silently treat as PASS.

Then write a 5-10-line summary (`N/M PASS`, one bullet per FAIL,
recommendation: cut now / fix-and-recut / hold for another walk).

See `references/result-format-and-parsing.md` for the EXACT
format invariants and OTHER NOTES handling.

### 8. Decide on the cut

If everything passed, propose a `cut-version` flow.
If anything failed, fix the failures first, then re-walk (a
second smoke walk is fine for the same version).

---

## Files

- `.claude/skills/smoke-walk/SKILL.md` — this file (procedure).
- `.claude/skills/smoke-walk/generate.mjs` — thin transformer
  that adds smoke-walk specific defaults (PASS / FAIL / SKIP
  controls, "Mark all Pass" button, package.json version
  cross-check) and delegates to the **worksheet** generator.
  HTML page chrome lives in the worksheet primitive — see
  `.claude/skills/worksheet/SKILL.md` for the rendering
  reference.
- `.claude/skills/smoke-walk/references/*.md` — companion
  reference docs (load on demand).
- `docs/dev/smoke-walks/v<VERSION>.json` — generated manifest.
- `docs/dev/smoke-walks/v<VERSION>.html` — generated page (open
  via `duo open`).

The `docs/dev/smoke-walks/` directory is gitignored except for
manifests Geoff wants to keep as receipts (rare). Don't commit
the generated HTML files unless explicitly asked.
