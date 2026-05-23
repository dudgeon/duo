# Resume after compaction — Sprint 21 / v0.7.8 start (post-cut)

**Read this first** if you came in cold via context compaction. Then read [`active-sprint.md`](active-sprint.md) for full inventory.

## Where we are

**v0.7.7 cut + tagged 2026-05-23.** Not yet pushed to remote — owner has not yet given `git push --tags` approval. `dist/Duo-0.7.7-arm64.dmg` exists (signed + notarized + validated). GitHub Release for the DMG is gated on the tag push.

Dev session is now bumped to v0.7.8 for Sprint 21.

## Immediate next steps (when owner returns)

### 1. Push tag + create GitHub Release

```bash
git push                          # push the cut commit + bump commit
git push --tags                   # push v0.7.7 tag (owner must bless)
gh release create v0.7.7 \
  --title "Duo v0.7.7 — Daily-driver upgrades + ⌘Z reopen + send-pill variants" \
  --notes "$(awk -v v='0.7.7' '/^## v/ { if (capture) exit; if (== \"v\" v) capture=1 } capture { print }' docs/RELEASES.md)" \
  dist/Duo-0.7.7-arm64.dmg
```

Cut-version skill § 6.5 has the canonical text + alternative `gh` flags.

### 2. **Review the ENH-180 PRD on phone — 4 decisions need owner picks**

- **HTML (in repo):** [`docs/prd/enh-180-session-rename.html`](../prd/enh-180-session-rename.html)
- **Notion mirror (phone-friendly, with checkboxes):** https://www.notion.so/36945f48854f810ca7f9dfa275c4389d

The 4 decisions:

| # | Question | Default recommendation |
|---|---|---|
| **D1** | Visibility footprint — default-on or opt-in for the 2-line `/rename` transcript appearance? | A — Opt-in (Settings checkbox, default OFF) |
| **D2** | Title source — first-prompt truncation, `claude -p` Haiku summary, or both? | A or C — first-prompt for v1 |
| **D3** | Quality threshold — when do we skip renaming a session? | B — moderate (≥6 words OR ≥40 chars + small-talk denylist) |
| **D4** | Timing / idle gate — generous / snappy / on-session-end / manual-only? | B — snappy (2s idle, 3s steady) |

Decisions block the ENH-180 build (~3h after they lock). ENH-180 itself blocks on **ENH-177 landing first** — that's the banner that consumes the title.

### 3. Sprint 21 build order (after owner pastes decisions back)

1. **Re-ship ENH-177** (Claude session resume banner). Cherry-pick or re-implement from [f351719](https://github.com/dudgeon/duo/commit/f351719). Owner walks the workspace-switch → return → banner-appears → click-Resume flow live before sign-off.
2. **Re-ship ENH-178** (Browser blocklist three modes + local-only default). Cherry-pick from [b03a8da](https://github.com/dudgeon/duo/commit/b03a8da). Owner walks the local-only bounce of `https://example.com` to system browser live before sign-off.
3. **Build ENH-180** per locked decisions. Estimated ~3h. New `electron/claude-session-renamer.ts` + Settings checkbox (if D1 picks opt-in) + idle-gate state machine + denylist + 12-15 vitest fixtures + live walk via computer-use.

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
