# Smoke walk — result format + parser invariants

> Detail backing `.claude/skills/smoke-walk/SKILL.md § 7`. The
> rules-of-thumb in SKILL.md tell you "parse the user's pasted
> result block"; this doc has the EXACT shape + edge cases.

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

## Format invariants the parser depends on

- Header: exactly `SMOKE WALK v<VERSION> (<DATE>)` then `===` rule.
- Each item: blank line above, `[STATUS] <id> — <title>` line,
  optional `  Notes: <text>` line (indented 2 spaces; multi-line
  notes use `\n  ` to preserve indentation).
- Footer: `SUMMARY: ...` line.
- **Optional `OTHER NOTES` block** at the bottom (blank line +
  `OTHER NOTES` + dash rule + free text). Only present when the
  user typed into the misc-notes field. Capture verbatim and treat
  every line as observation: file paper cuts as their own
  `BUG-* / ENH-` entries in tasks.md, surface UX drift in the
  next sprint plan, etc. Don't try to PASS/FAIL anything in this
  block.
- STATUS is exactly one of `PASS`, `FAIL`, `SKIP`.
- Items are in the same order as the manifest (so ordering errors
  in the source manifest propagate, but parse-side is positional).

## Parser tolerance

If a user manually-edits the pasted text, the parser is forgiving
— match by `id` + `STATUS` token; ignore extra whitespace.

## After parsing — actions per status

- For each `[PASS]` item: confirm the tasks.md entry stays ✅.
  No action needed.
- For each `[FAIL]` item: re-open the tasks.md entry. Flip status
  to 🟡, prepend a "User-verified failure on smoke walk" note
  with the user's notes verbatim and today's date. Add the item
  to a "carry-over for next sprint" section in session-log.
- For each `[SKIP]` (no result chosen): note in the response that
  this item wasn't tested; ask the user whether to defer it or
  whether they want a re-run. Don't silently treat as PASS.

## Summary back to the user (5–10 lines max)

- `N/M PASS` — the count.
- One bullet per FAIL with the user's notes.
- A recommendation: cut now / fix-and-recut / hold for another
  walk.
