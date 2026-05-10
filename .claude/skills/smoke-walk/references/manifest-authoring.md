# Smoke walk — manifest authoring tips

> Detail backing `.claude/skills/smoke-walk/SKILL.md § 2`. The
> rules-of-thumb in SKILL.md tell you "the manifest is the spec";
> this doc has the writing patterns + the regression-coverage
> drop-rule.

## Concrete > generic

Bad: "test the new context menu."
Good: "right-click on whitespace below the file rows in the
navigator; expect the menu to show only New file / New folder /
Open terminal here / Reveal in Finder."

## One concept per item

A combined "test BUG-038 + BUG-042 + ENH-024" forces a single
pass/fail for three independent things. Split them.

## Visible steps, not internal mechanism

The user doesn't care that we added an activePaneRef; they care
that ⌃Tab now reaches all 10 tabs. Lead with the symptom-and-fix,
not the diff.

## Edge cases as separate steps

If a fix has a degenerate case (e.g. ⌃Tab from the rightmost tab
wraps to first), make it a distinct step in the same item — not a
separate item.

## Priority ordering

Highest-priority / recurring-class items at the top so they get
attention while the user is fresh. Scope-creep ENHs at the
bottom.

## Mandatory regression items (every release)

Bugs that have recurred multiple times across walks. Each
release's manifest MUST include them, with explicit verification
steps.

> **HARD RULE — when a regression item gets durable automated
> test coverage that passes in CI, REMOVE it from this list AND
> from the next sprint's manifest.** The smoke walk is for things
> that MIGHT have regressed; CI catches the things the test
> suite already guarantees. Owner-flagged 2026-05-07 walk-2:
> "WHY AM I SEEING THIS IF YOU TEST IT AND IT PASSES DON'T SHOW
> ME THIS." Adding a "verify the test exists" smoke-walk row is
> the same mistake — drop the item entirely.

(Currently no items in this section — BUG-056 was removed
2026-05-07 after `electron/cdp-bridge.test.ts` landed with three
asserts on the IIFE source. Add new items here when a bug recurs
across two releases AND there's no clean automated test path
yet.)

## Code blocks + Copy buttons (ENH-046 — 2026-05-02 walk-2)

Any shell command, code snippet, or file path the user is
expected to COPY-AND-RUN must be wrapped in single backticks in
its step string. The generator (`generate.mjs § renderStepHtml`)
splits on backticks and pulls out anything that:

- has whitespace, OR
- is longer than 25 characters, OR
- starts with a recognized shell verb (`duo`, `node`, `ls`,
  `pkill`, `bash`, `npm`, `cd`, `mkdir`, `rm`, `git`, `grep`,
  `find`, etc.)

…into a styled `<pre>` with a Copy button alongside. Short tokens
like `` `PASS` `` or `` `false` `` stay inline as `<code>` (no
Copy button — user wouldn't click to copy a single word).

Why this matters: walk-2 found the user pasting bare commands
into their terminal by hand because the smoke-walk page was
rendering them as inline code with surrounding prose — forcing a
triple-click + careful selection. Wrapping in backticks gets you
a one-click copy.

Bad (forces hand-typing):

```
"From any terminal, run: ls -la ~/.claude/skills/duo/canvas-authoring.md"
```

Good (gets a Copy button):

```
"From any terminal, run: \`ls -la ~/.claude/skills/duo/canvas-authoring.md\`"
```

This convention also propagates beyond the smoke walk: any canvas
template (`skill/canvas-templates/*.html`) that includes a
runnable command should expose a Copy button via the same
`<pre data-copy>` shape. ENH-043 / ENH-046 in tasks.md have the
carve-up.

## Manifest field guide

- `id`: BUG-* / ENH-* exactly as in tasks.md.
- `title`: short noun phrase from the tasks.md entry.
- `what_fixes`: 1-2 sentences. The user reads this before testing
  to know what "passing" looks like.
- `steps`: numbered concrete actions. Imperative. Don't say
  "verify X works" — say "press ⌃Tab and confirm Y."
