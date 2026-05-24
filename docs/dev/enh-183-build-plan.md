# ENH-183 Build Plan — Claude session description lifecycle

> Sprint 21 / v0.7.9 marquee. Canonical PRD:
> [`docs/prd/enh-183-claude-session-lifecycle.html`](../prd/enh-183-claude-session-lifecycle.html).
> Notion mirror: [36a45f48854f81b49571dd1cb12a11e5](https://www.notion.so/36a45f48854f81b49571dd1cb12a11e5).
> All 13 decisions locked as of 2026-05-24 (D10–D13 via owner Notion comments).
>
> **Owner picks from Notion comments:**
> - **D10** → Variant B (vertical mini-list), copy: **"Resume previous session"** (singular)
> - **D11** → option a · 3 visible + "show all"
> - **D12** → option a · small accent dot (6×6px)
> - **D13** → option a · count `type:'user'` JSONL entries, no cache
> - **D2 addition** — first-time educational banner: *"Duo named this for you. Type `/rename
>   <new title>` in Claude any time to change it."* (once per install, dismissable)
>
> **Architectural invariant (D9):** no Duo-side metadata sidecars. All reads live from Claude's
> storage. Only Duo-owned persisted state is the per-tab `lastClaudeSession.id` pointer + the
> single boolean for the D2 educational-banner-shown flag (renderer pref, not session-scoped).

## Status

- [x] **C1** — Step 0 empirics ([notes](../research/enh-183-step-0-empirics.md))
- [x] **C2** — Cherry-pick f351719 ([8a0eba2](https://github.com/dudgeon/duo/commit/8a0eba2))
- [x] **C3** — Refactor `ClaudeResumeBanner` → polymorphic `SessionHeader`
- [x] **C4** — Read ladder (D5) + session-tracker JSONL fallback (D13)
- [x] **C5** — S2 named banner (collapsed dot + expanded)
- [x] **C6** — S1 pills (Variant B, 3-visible, "Resume previous session" copy)
- [x] **C7** — S3 restore-offer banner
- [ ] **C8** — `session-hydrator.ts` + T1 idle trigger + D8 derivation
- [ ] **C9** — T2 manual-save + T3 first-capture triggers
- [ ] **C10** — S2 inline rename (contentEditable → /rename PTY inject)
- [ ] **C11** — D2 first-time educational banner
- [ ] **C12** — CLI parity (7 new `duo session ...` verbs)
- [ ] **C13** — Smoke walk manifest + walk

After C13: propose v0.7.9 cut via `cut-version` skill (per CLAUDE.md § 10).

---

## C1 — Step 0 empirics — ✅ COMPLETE

**Output:** [`docs/research/enh-183-step-0-empirics.md`](../research/enh-183-step-0-empirics.md).

**Headline findings (read before C2):**

- **Field name is `customTitle`, not `customName`** — all 30 occurrences across PRD + this
  build plan + CLAUDE.md have been mechanically renamed. C4/C8 implementation work uses
  `customTitle` throughout.
- **JSONL is the primary store, not `sessions-index.json`** — that file is absent from most
  projects on this machine, including the Duo project itself. The PRD's D5 read ladder has
  been reworded to read JSONL entries directly (`type:"custom-title"` for renames,
  `type:"ai-title"` for Haiku summaries). `sessions-index.json` is no longer consulted; D13
  is now the primary read path, not a fallback.
- **`/rename` writes a JSONL entry** of shape
  `{"type":"custom-title","customTitle":"...","sessionId":"..."}`. Confirmed by Claude binary
  strings table (regex pattern + literal prefix) plus 5 real on-disk examples from past
  usage (one tagged "Renamed via Duo" — residue from the reverted f351719 commit; cherry-pick
  base of C2 is already correct on the write shape).
- **Haiku-vs-customTitle race is a non-issue** — the read ladder picks `customTitle` when
  present regardless of which entry was appended later. No workaround needed; D8 ships as
  designed.

**AC status:**
- [x] Notes doc written.
- [x] PRD empirics-table rows flipped to VERIFIED CORRECTED (D5/D8 reworded, schema row
      updated, sessions-index row pivoted from REVISED → VERIFIED CORRECTED).
- [x] All blocking unknowns resolved without a live test (5 real on-disk examples were
      enough).

---

## C2 — Cherry-pick `f351719` (the original ENH-177 build)

**What.** Bring back the workspace-save UUID capture + ClaudeResumeBanner UI that was reverted at
[49f4644](https://github.com/dudgeon/duo/commit/49f4644).

**Commands:**

```bash
git cherry-pick -n f351719
# Resolve conflicts. Likely areas:
#  - workspace JSON schema (Sprint 20's switcher landed after this revert)
#  - electron/main.ts (whose handlers grew between then and now)
#  - shared/types.ts (additive merge usually OK)
```

**Files touched (~412 LOC across 9 files):**
- `electron/claude-session-tracker.ts` (NEW)
- `electron/workspace-manager.ts` (extends save path)
- `shared/types.ts` (`SessionState.terminals[].lastClaudeSession`)
- `renderer/components/ClaudeResumeBanner.tsx` (will be renamed in C3)
- `renderer/components/TerminalPane.tsx`
- `renderer/store/sessionRestore.ts`
- `core/socket-server.ts` (`session:resume` IPC)
- `cli/duo.ts` (`duo session resume` verb baseline)
- `docs/CLI-COVERAGE.md`

**AC for C2:**
- [ ] `npm run typecheck` clean.
- [ ] `npm run build:cli` rebuilds `cli/duo` cleanly.
- [ ] Conflicts resolved with no behavior regression on Sprint 20's workspace switcher.
- [ ] Workspace save captures `lastClaudeSession.id` for a tab with `claudePresence === 'claude'`.

---

## C3 — Refactor to polymorphic `SessionHeader`

**What.** Rename `ClaudeResumeBanner` → `SessionHeader`. Add a `state` prop computed from
`(claudePresence, messageCount, priorSessions, workspaceMetadata)`. Header renders S0/S1/S2/S3
according to the PRD state machine.

**Files:**
- `renderer/components/SessionHeader.tsx` (renamed from ClaudeResumeBanner.tsx)
  - New: `state: 'S0' | 'S1' | 'S2' | 'S3'` discriminator
  - New: state-routing switch returning sub-components
  - Stubs only at this commit; content lands in C5/C6/C7
- `renderer/components/TerminalPane.tsx` (update import + render)
- `renderer/store/sessionHeader.ts` (NEW; per-tab UI state — `collapsed`, `pillsVisible`,
  `editingTitle` — all in-memory only per D9; no persistence to disk)

**AC for C3:**
- [ ] Tab with no Claude + no JSONL history shows no header (S0).
- [ ] All other states render the existing ClaudeResumeBanner UI as a placeholder for now.
- [ ] No regressions on Sprint 20's workspace switcher restore path.

---

## C4 — Read ladder (D5) + JSONL primary derivation (D13)

**What.** Implement the 4-rung read ladder. Per C1 empirics, the read ladder reads
JSONL entries directly — `sessions-index.json` is not consulted (it doesn't exist for most
projects on this machine).

**Files:**
- `electron/claude-session-tracker.ts`
  - `readBannerTitle(sessionUuid, cwd)`: walks the ladder; returns
    `{ title: string, source: 'customTitle' | 'aiTitle' | 'jsonl-firstmsg' | 'uuid' }`. Reads
    via reverse-scan of JSONL — pick the latest `type:"custom-title"` entry, else latest
    `type:"ai-title"`, else `cleanAndTruncate(firstUserMessage)`, else short UUID.
  - `readMessageCount(sessionUuid, cwd)`: JSONL line count filtered to `type:"user"` entries.
    No cache (per D9). No sessions-index.json preference path — JSONL is primary.
  - `cleanAndTruncate(rawFirstPrompt)`: shared with C8 derivation logic; strips
    `<ide_opened_file>…</ide_opened_file>`, drops "please " / "could you " / "can you " prefixes,
    collapses whitespace, truncates to 60 chars on word boundary with "…" suffix.
- `electron/claude-session-tracker.test.ts` (NEW)
  - Unit tests for `cleanAndTruncate`: 6+ cases (ide_opened_file wrapper, conversational
    prefix, multi-line, mid-word truncation, empty string, very-long single token).
  - Tests for `readBannerTitle` ladder ordering.
  - Tests for `readMessageCount` JSONL fallback.

**AC for C4:**
- [ ] All vitest tests pass.
- [ ] `duo session list` (placeholder verb) shows correct titles even in the duo project
  (where sessions-index doesn't exist) — JSONL fallback works.
- [ ] No new files written to `~/.claude/duo/` (D9 invariant).

---

## C5 — S2 named banner (collapsed dot + expanded)

**What.** Render the S2 state. Default is collapsed: small accent dot on the tab (D12 = a).
Click tab to expand banner.

**Files:**
- `renderer/components/SessionHeader.tsx` (S2 branch)
- `renderer/components/TabStrip.tsx` (add the dot marker when `lastClaudeSession` exists AND
  `collapsed === true`)
- `renderer/store/sessionHeader.ts` (`collapsed: Record<tabId, boolean>` — in-memory)

**Visual ACs (verify via screenshot per CLAUDE.md § 7e):**
- [ ] Collapsed state: only the small accent dot (6×6px) is visible on the tab's right edge.
- [ ] Click tab → banner expands with title + "Save workspace" button + dismiss ×.
- [ ] Title reads from D5 ladder.
- [ ] No "AUTO" badge or any provenance tag (D9 invariant).
- [ ] Click tab again → re-collapses.

---

## C6 — S1 pills (Variant B, 3-visible, "Resume previous session" copy)

**What.** Render the S1 state. Variant B (vertical mini-list). 3 sessions visible. Header copy:
**"Resume previous session"** (singular).

**Files:**
- `renderer/components/SessionHeader.tsx` (S1 branch)
- `renderer/components/SessionPillsList.tsx` (NEW — the 3-row + "show all" + footer markup)
- `core/socket-server.ts` + `electron/main.ts` — IPC `claude:user-message-submitted` fires from
  PtyManager on first Return; renderer toggles `pillsVisible=false` (in-memory only).
- `electron/pty-manager.ts` — detect Return in user input + emit the IPC

**Mockup reference:** [`docs/research/assets/enh-183-mockups/d10-pills-variants.png`](../research/assets/enh-183-mockups/d10-pills-variants.png)
(Variant B section, with the corrected "RESUME PREVIOUS SESSION" header).

**Visual ACs:**
- [ ] Header text: "Resume previous session" (singular).
- [ ] 3 rows visible by default; "N older sessions · show all" footer link.
- [ ] Click "show all" expands to a scrollable list (max-height ~220px) covering all sessions.
- [ ] Click a row → `claude --resume <uuid>` writes to PTY; pills disappear.
- [ ] First Return committed to new Claude session → pills auto-dismiss within 200ms.
- [ ] Click "Dismiss · keep new session" → pills hide for this session.
- [ ] No persistence: pills re-show on next fresh Claude session in the same CWD.

---

## C7 — S3 restore-offer banner

**What.** Render the S3 state. Restored workspace + captured `lastClaudeSession.id` + claude not
yet running → "This tab had: <title> — Resume?" with primary Resume button.

**Files:**
- `renderer/components/SessionHeader.tsx` (S3 branch)
- IPC `session:resume(tabId, uuid)` → PTY-write `claude --resume <uuid>\n` (already from C2)

**Visual ACs:**
- [ ] Workspace restore with captured UUID → banner shows correct title (read fresh from
  sessions-index per D5).
- [ ] Resume click → claude spawns, then state transitions to S2.
- [ ] Dismiss × → banner hides for this tab-restore.

---

## C8 — Session hydrator (T1 idle trigger + D8 derivation)

**What.** Implement Duo-driven `/rename` injection. Triggered when `messageCount ≥ 3` AND no
existing `type:"custom-title"` JSONL entry AND no existing `type:"ai-title"` JSONL entry
(both gates checked via JSONL reverse-scan, per C1 empirics).

**Files:**
- `electron/session-hydrator.ts` (NEW)
  - `maybeHydrate(tabId, sessionUuid, cwd)`: gates on D2 trigger conditions; derives via D8
    ladder; injects `\r/rename <derived>\n` via `PtyManager.write`. Idempotent — if a hydration
    /rename was already issued for this session (tracked in-memory only, NOT persisted; resets
    on Duo restart per D9), skip.
  - Watches Claude's storage file-watch ticks; no polling.
- Wire-up in `electron/main.ts` — instantiate hydrator on app boot; subscribe to PTY message
  events.

**AC:**
- [ ] Throw-away test: start claude, send 3 messages on an unnamed session; within ~1s of the
  3rd message, transcript shows the `/rename` line and Claude's ack.
- [ ] Banner re-renders with the new title (no Duo intervention beyond the inject).
- [ ] No files created in `~/.claude/duo/` for hydration tracking (verify with
  `find ~/.claude/duo/ -name '*hydrat*'` returns empty).

---

## C9 — T2 manual-save + T3 first-capture triggers

**What.** Wire the hydration trigger into `workspace-manager`.

**Files:**
- `electron/workspace-manager.ts`
  - `handleManualSave()`: after UUID capture, for each captured tab with no
    `type:"custom-title"` + no `type:"ai-title"` JSONL entry, call
    `sessionHydrator.maybeHydrate()` fire-and-forget.
  - `handleSessionTrackerNewSessionUuid()`: on first observation of a session UUID for a tab,
    call `maybeHydrate()` before persisting workspace metadata.
- **Autosave path unchanged** — does NOT call the hydrator (D6).

**AC:**
- [ ] ⌘S on a workspace with an unnamed live Claude session triggers a `/rename` injection.
- [ ] Autosave does NOT trigger a `/rename` injection (verify by inspecting PTY transcript over
  several autosave ticks).
- [ ] First time `session-tracker` observes a new UUID for a tab, hydrate fires.

---

## C10 — S2 inline rename (contentEditable → user-driven /rename)

**What.** User clicks the banner title → contentEditable cursor → user types new title →
Return commits via `/rename` PTY inject. Esc cancels. Click-outside commits.

**Files:**
- `renderer/components/SessionHeader.tsx` (S2 edit-mode UI)
- IPC `session:rename(tabId, newTitle)` → same path as C8's hydrator (shared injection helper).
- Gated on `claudePresence === 'claude'`. If claude isn't live in this tab, title is
  non-editable (cursor: not-allowed, tooltip explains).

**Visual ACs:**
- [ ] Click title in expanded S2 banner → contentEditable activates with accent border + cursor.
- [ ] Type new title + Return → injection fires; banner re-renders with new title.
- [ ] Esc → reverts to prior title; no PTY write.
- [ ] Click-outside → commits.
- [ ] Title is NOT editable when claude isn't running in the tab.

---

## C11 — D2 first-time educational banner

**What.** Once-per-install dismissable banner explaining `/rename`. Per Notion comment 2026-05-24.

**Files:**
- `renderer/components/SessionHeader.tsx` — render a thin secondary banner above the main S2
  banner the first time Duo auto-hydrates ANY session, after the hydration completes.
- `renderer/state/ui-prefs.ts` (or wherever renderer prefs live) — add `seenRenameTip: boolean`.
  Persisted to renderer-only prefs (localStorage or equivalent). NOT per-session. NOT in
  workspace metadata. NOT in `~/.claude/`.

**Banner copy (locked from Notion comment, refined for tone):**

> Duo named this session from your first message. To change it, type `/rename <new title>` in
> Claude any time. *[Dismiss]*

**ACs:**
- [ ] First time Duo auto-hydrates, banner appears.
- [ ] Click Dismiss → banner hides for this Duo install forever.
- [ ] Subsequent auto-hydrations do NOT re-show the banner.
- [ ] Reset by clearing renderer prefs (escape hatch for testing).

---

## C12 — CLI parity (7 new verbs)

**What.** Every UI behavior gets a `duo session ...` counterpart per CLAUDE.md § 4.

**Verbs:**

```
duo session list [--cwd <path>]      # mirror S1 pills + S3 restore options
duo session resume <tabId> <uuid>    # pill click / S3 Resume
duo session rename <tabId> "<title>" # user-driven /rename
duo session hydrate <tabId>          # force Duo-driven hydration now
duo session collapse <tabId> | expand
duo session dismiss-pills <tabId>
duo session auto-hydrate [on|off]    # power-user opt-out
```

**Files (per CLAUDE.md § 4 plumbing checklist — touch every one):**
- `shared/types.ts` — `DuoCommandName` extensions; IPC channel shapes
- `electron/preload.ts` — renderer API surface
- `electron/main.ts` — ipcMain handlers; dispatch helpers
- `core/socket-server.ts` — switch cases
- `cli/duo.ts` — verbs + `printHelp()` update; rebuild binary
- `skill/SKILL.md` — agent discovery; then `npm run sync:claude`
- `agents/duo.md` — verb cheat-sheet under `## Verb cheat-sheet`
- `docs/CLI-COVERAGE.md` — inventory update

**ACs:**
- [ ] All 7 verbs round-trip identically to their UI counterparts.
- [ ] `duo session list` returns the same data S1 pills render.
- [ ] `duo session rename <tabId> "test"` mirrors clicking the title and typing "test".
- [ ] `npm run build:cli` regenerates `cli/duo`; `npm run sync:claude` copies to `~/.claude/`.
- [ ] Help text shows the new verbs.

---

## C13 — Smoke walk

**What.** Generate smoke walk page via the `smoke-walk` skill covering all 13 ACs across
S0/S1/S2/S3 + T1/T2/T3 + CLI parity + D9 invariant verification.

**Skill invocation:**

```
.claude/skills/smoke-walk/SKILL.md  (existing skill)
```

**Generates:** `docs/dev/smoke-walks/v0.7.9.html` per the skill's manifest template.

**Items to cover** (one row per AC bullet in the PRD):
- All 13 individual ACs from PRD § 15.
- D9 invariant check: `find ~/.claude/duo/ -name '*sessions*' -o -name '*hydrated*'` returns
  empty after a full sprint of use.
- Workspace metadata audit: inspect a saved `.duo-workspace` and confirm only
  `lastClaudeSession.id` exists (no titles, no msgcount cache).

**Handoff per CLAUDE.md § 7b + § 7c:**
- Run pre-handoff clean-state checks.
- Confirm the smoke-walk page itself works (toggle a radio, Copy results, paste roundtrip).
- Hand to owner with: *"Smoke walk page is open in Duo's browser pane. Click each row,
  mark PASS / FAIL / SKIP, hit Copy results when done."*

**After paste-back:**
- Parse results per the skill's protocol.
- Flip any FAIL items back to in-progress in tasks.md.
- If all PASS, propose v0.7.9 cut via `cut-version` skill.

---

## Carry-forward / future scope (NOT in this build)

These are explicitly out of scope per PRD § 17. Don't sneak them in:

- Duo-side LLM auto-naming (the original full ENH-180 scope).
- Provenance tracking / AUTO badge (D9).
- Cross-CWD session search.
- Persistent learning of dismiss preferences.
- Multiple Claude sessions per tab (forks).
- Session header in browser tabs.
- Cross-session graph / backlinks view.

If any of these come up during build, file as a new ENH and move on.

---

## Cut sequence

1. After C13 PASS → propose `cut-version` (per CLAUDE.md § 10).
2. v0.7.9 includes only ENH-183 + the new CLAUDE.md guardrails (§ 7f, § 7g, § 12) + the
   archive moves.
3. Cut-version skill drafts release notes from `session-log.md` + commit log since v0.7.8.
4. Smoke-walk results paste in as the cut's verification.

**Estimated commits:** 13. **Estimated LOC:** ~600 (cherry-pick base ~412 + ENH-183 layer ~200).
