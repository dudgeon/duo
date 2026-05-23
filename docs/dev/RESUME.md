# Resume after compaction — Sprint 20 / v0.7.7 close-out

**Read this first** if you came in cold via context compaction. Then read [`active-sprint.md`](active-sprint.md) for the full inventory.

## Where we are

**v0.7.7 dev session running.** All 13 sprint commits shipped (4 ENHs + 9 sprint-close fixes). One known **open owner-decision** before cut.

## What's owed before cut

### 1. Owner walks `v0.7.7-rev2.html` (7 items)

- Smoke walk page at `docs/dev/smoke-walks/v0.7.7-rev2.html` (gitignored).
- 7 items: re-tests **ENH-170-WALK** (post-modal-deletion + BUG-154 fix) + the 6 SKIPs from walk-1 (ENH-171, BUG-149, ENH-173, BUG-150, BUG-151, BUG-152).
- Walk-1 PASS items dropped per the never-re-walk rule: ENH-172, ENH-169.
- To re-open: `duo open /Users/geoffreydudgeon/Documents/GitHub/duo/docs/dev/smoke-walks/v0.7.7-rev2.html`.

### 2. Ship ENH-174 — disable TipTap autolink

Owner-locked 2026-05-23 (Option B/C). Single config change: `Link.configure({ autolink: false, ... })` at [`renderer/components/editor/MarkdownEditor.tsx:498`](../../renderer/components/editor/MarkdownEditor.tsx:498). BUG-155 normalize stays as belt-and-suspenders. See [tasks.md § ENH-174](../../tasks.md) for the full plumbing checklist + verification steps. Owner said "just lock the decision; don't start the build" — implementation is owner-gated, do not start without explicit go.

## All Sprint 20 commits (since v0.7.6 tag)

```
fdffa7b fix(BUG-155): false-positive conflict from tiptap-markdown autolink
b826bf4 fix(BUG-154): Return-override fires in shell tabs running claude
342020a feat(ENH-170 v2): top-level Settings menu — single Cmd+Return checkbox
1a98385 fix(BUG-153): Settings modal occluded — superseded by ENH-170 v2
aa4e5e3 fix(BUG-152): workspace switch restores browser tabs
a732731 fix(BUG-151): workspace switch dropped misleading prompt
faff37a fix(BUG-150): installer dedupes orphan unmarked hook entries
3daf480 fix(BUG-149) + feat(ENH-173): duo navigate redirect + Navigate-here
ce50e78 feat(ENH-169): navigator new-file/new-folder UX
026d4d2 feat(ENH-170 v1): Settings modal (superseded)
2bde2f6 feat(ENH-171): workspace switcher dropdown
600d16e feat(ENH-172): show/hide hidden files
```

## CLI driving etiquette (avoid distracting the owner)

- Do NOT use `duo edit --reveal` or computer-use clicks unless owner is actively expecting eyes-on. Both steal focus from whatever the owner is reading. Owner reported tab-stealing 2026-05-23 — that was me.
- Prefer `duo doc read <path>` (read-only) over `duo edit <path>` for inspection.
- For modal/menu verification, ASK owner before invoking computer-use. They may be reading something.

## Process memory rules locked this sprint

- [feedback_open_every_modal_before_smoke_handoff](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_open_every_modal_before_smoke_handoff.md) — every modal/dropdown in a smoke-walk manifest gets opened via computer-use BEFORE handoff. Locked from BUG-153 (ENH-170 v1 modal occlusion).

## Dev session running

- One Electron instance (latest spawn after BUG-154 restart).
- v0.7.7 ·dev.
- Active workspace: probably `session.duo-workspace` (on Desktop).
- about-duo.md restored to committed state at end of BUG-155 verification.
- Conflict log at `~/.claude/duo/logs/last-conflict.log` last fired 2026-05-23 05:38 (pre-BUG-155-fix) — has NOT been written to since (no false-positives post-fix).

## Smoke walk skill state

- Rev2 page is open in the browser pane (or available to re-open via `duo open docs/dev/smoke-walks/v0.7.7-rev2.html`).
- Per `/smoke-walk` § 6 the page itself is the spec — owner reads each item, marks Pass/Fail/Skip, clicks Copy results, pastes back. Parse per § 7.
