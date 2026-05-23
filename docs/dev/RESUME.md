# Resume after compaction — Sprint 21 / v0.7.8 start (post-cut)

**Read this first** if you came in cold via context compaction. Then read [`active-sprint.md`](active-sprint.md) for full inventory.

## Where we are

**v0.7.7 shipped 2026-05-23.** Cut + tagged + pushed to origin; GitHub Release live at https://github.com/dudgeon/duo/releases/tag/v0.7.7 with signed+notarized `Duo-0.7.7-arm64.dmg` (104 MB) attached.

**ENH-180 closed same day** — see § "Closed during planning" below.

Dev session is now bumped to v0.7.8 for Sprint 21.

## Sprint 21 build order

1. **Re-ship ENH-177 + ENH-181** (Claude session resume banner + inline rename + collapse toggle). Cherry-pick or re-implement from [f351719](https://github.com/dudgeon/duo/commit/f351719). Fold in:
   - Banner reads `sessions-index.json` for title (prefers `customName` > `summary` > short UUID fallback).
   - **ENH-181**: collapsed-marker-on-tab default state; tap tab to expand; click title in expanded banner to enter edit mode (gated on `claudePresence === 'claude'`); Return commits via PTY `/rename` inject; Esc cancels.
   - See [`docs/research/enh-177-banner-mockup.html`](../research/enh-177-banner-mockup.html) for all 7 states (3 ENH-177 + 4 ENH-181).
   - Owner walks: workspace-switch → marker on tab → tap to expand → click title → type new name → Return → confirm `/rename` lands in claude transcript → re-tap tab to collapse.
2. **Re-ship ENH-178** (Browser blocklist three modes + local-only default). Cherry-pick from [b03a8da](https://github.com/dudgeon/duo/commit/b03a8da). Owner walks the local-only bounce of `https://example.com` to system browser live before sign-off.
3. **Pick carry-forward items.** Backlog in [`active-sprint.md`](active-sprint.md).

## Closed during planning (2026-05-23)

**ENH-180 (auto-rename Claude sessions via `/rename` PTY injection)** is closed. Owner observation: Claude Code already writes a Haiku summary to `~/.claude/projects/<encoded-cwd>/sessions-index.json` automatically after a session has had a few exchanges — Duo doesn't need to generate its own title. The cleaner scope is just "ENH-177's banner reads `sessions-index.json`, falls back to UUID, `/rename` remains the manual override." That folds into ENH-177's re-ship as a ~20-line detail.

PRD preserved at [`docs/prd/enh-180-session-rename.html`](../prd/enh-180-session-rename.html) with a closure banner at top + the historical empirics (`/rename` write paths, `claude -p` cost numbers, idle-gate state machine, denylist) collapsed into a `<details>` block. The 4 decision cards are now moot — no owner action needed.

Mockup of the simplified banner experience for ENH-177's re-ship: [`docs/research/enh-177-banner-mockup.html`](../research/enh-177-banner-mockup.html) (also mirrored to the Notion page).

## All Sprint 20 / v0.7.7 commits (since v0.7.6 tag)

```
9728035 chore: bump to v0.7.8 for next sprint
e940e6c release: v0.7.7                                  ← TAG: v0.7.7
59c462a docs: flip ENH-177/178 to "built + reverted, queued for re-ship"
49f4644 Revert "feat(ENH-177): track + offer to resume Claude sessions across workspace switch"
5295849 Revert "feat(ENH-178): browser blocklist three modes"
c090064 docs(ENH-180): PRD for auto-rename Claude sessions via /rename injection
21fa66a feat(ENH-179): ⌘Z reopens the most recently closed tab
b03a8da feat(ENH-178): browser blocklist three modes — reverted in 5295849
f351719 feat(ENH-177): claude session resume — reverted in 49f4644
3d331f0 feat(ENH-176): send-pill agent + terminal variants via feature flags
ffd798b feat(ENH-174 + ENH-175): autolink off + navigate-or-focus tab
564ebee docs(sprint-20): record walk-2 results (5P/2S/0F); file ENH-175
23d9991 docs(ENH-174): lock owner-decision — disable TipTap autolink
fdffa7b fix(BUG-155): false-positive conflict from tiptap-markdown autolink round-trip
b826bf4 fix(BUG-154): Return-override fires in shell tabs running claude
342020a feat(ENH-170 v2): top-level Settings menu — single ⌘Return checkbox
1a98385 fix(BUG-153): Settings modal occluded — superseded by ENH-170 v2
aa4e5e3 fix(BUG-152): workspace switch restores browser tabs
a732731 fix(BUG-151): workspace switch dropped misleading prompt
faff37a fix(BUG-150): installer dedupes orphan unmarked hook entries
3daf480 fix(BUG-149) + feat(ENH-173): duo navigate redirect + Navigate-here
ce50e78 feat(ENH-169): navigator new-file/new-folder UX
026d4d2 feat(ENH-170 v1): Settings modal (superseded by v2 above)
2bde2f6 feat(ENH-171): workspace switcher dropdown
600d16e feat(ENH-172): show/hide hidden files
```

## What we learned (process memory locked this sprint)

- [feedback_open_every_modal_before_smoke_handoff](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_open_every_modal_before_smoke_handoff.md) — every modal/dropdown in a smoke-walk manifest gets opened via computer-use BEFORE handoff. Locked from BUG-153 (ENH-170 v1 modal occlusion under browser-pane WebContentsView).

## CLI driving etiquette (still in effect)

- Do NOT use `duo edit --reveal` or computer-use clicks unless owner is actively expecting eyes-on. Both steal focus.
- Prefer `duo doc read <path>` (read-only) over `duo edit <path>` for inspection.
- For modal/menu verification, ASK owner before invoking computer-use.

## Dev session running

- One Electron instance (last spawn during ENH-178 verification, restarted).
- Now identifies as v0.7.8 ·dev (post-cut bump).

## Mechanism notes worth keeping from ENH-180 PRD research

Useful for Sprint 21:

- **`/rename` is interactive-only.** `claude -p '/rename Foo'` returns *"isn't available in this environment"*. Slash commands are TUI-only.
- **`--name` on `--resume` doesn't visibly persist.** Also expensive — $0.73 per resume call due to Opus default + 117K cache tokens reload.
- **Writing `\r/rename <title>\n` to a live claude PTY works.** $0 cost (no LLM), ~0s latency. Writes to canonical `~/.claude/projects/<encoded-cwd>/sessions-index.json`. Visible in Claude's `/resume` picker, terminal title, and our banner once ENH-177 re-ships.
