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

- [x] **C1** — Step 0 empirics ([112e37e](https://github.com/dudgeon/duo/commit/112e37e)) · notes at [`docs/research/enh-183-step-0-empirics.md`](../research/enh-183-step-0-empirics.md)
- [x] **C2** — Cherry-pick f351719 ([8a0eba2](https://github.com/dudgeon/duo/commit/8a0eba2))
- [x] **C3** — Polymorphic `SessionHeader` ([b889243](https://github.com/dudgeon/duo/commit/b889243))
- [x] **C4** — Read ladder (D5) + JSONL-primary derivation (D13) ([5b28629](https://github.com/dudgeon/duo/commit/5b28629))
- [x] **C5** — S2 named banner + collapsed dot ([5a6401a](https://github.com/dudgeon/duo/commit/5a6401a))
- [x] **C6** — S1 pills ([9b62203](https://github.com/dudgeon/duo/commit/9b62203))
- [x] **C7** — S3 restore-offer title via D5 ladder ([f1c6ddb](https://github.com/dudgeon/duo/commit/f1c6ddb))
- [x] **C8** — Session hydrator + D8 derivation ([1f0766c](https://github.com/dudgeon/duo/commit/1f0766c))
- [x] **C9** — T3 wired via enrichment hook ([1c1186f](https://github.com/dudgeon/duo/commit/1c1186f))
- [x] **C10** — S2 inline rename (contentEditable → /rename PTY inject)
- [x] **C11** — D2 first-time educational banner
- [x] **C12** — CLI parity (4 of 7 `duo session ...` verbs; 3 UI-state verbs deferred)
- [x] **C13** — Smoke walk manifest authored ([`v0.7.9.json`](smoke-walks/v0.7.9.json) → 13 items); owner walk pending

After C13: propose v0.7.9 cut via `cut-version` skill (per CLAUDE.md § 10).

---

## Test report — 2026-05-24 (C1–C9 shipped + post-build verification)

> Re-run before any C10 work to confirm no regressions. Each row is a
> green-tick check you can re-run in <1 min from a clean dev session.

### Static + unit

| Check | Status | Command |
|---|---|---|
| 45/45 ENH-183 unit tests passing | ✅ | `npx vitest run electron/claude-session-tracker.test.ts electron/session-hydrator.test.ts renderer/components/SessionHeader.test.ts` |
| `npm run typecheck` clean | ✅ | `npm run typecheck` |
| `npm run build:cli` clean (no CLI deltas yet — C12 will add) | ✅ | `npm run build:cli` |
| `cli/duo` binary unchanged in HEAD vs working tree | ✅ | `git diff --quiet cli/duo` |

Test breakdown:
- `claude-session-tracker.test.ts` — **22 cases**. encodeProjectDir (6), cleanAndTruncate (9), readBannerTitle integration (5), readMessageCount (2). Uses real JSONL fixtures under `~/.claude/projects/-tmp-enh-183-...` sandboxes with full cleanup.
- `session-hydrator.test.ts` — **8 cases**. All 6 gate conditions covered (count<3, customTitle, aiTitle, dedup, source=uuid, empty derivation) + threshold constant + reset-tracking escape hatch.
- `SessionHeader.test.ts` — **15 cases**. All 4 state-machine transitions (S0/S1/S2/S3) + dismissedBanner precedence + S2/S3 precedence over S1.

### Live IPC probes (dev running)

> All run via `duo dom --js '...'` against the main renderer. Each
> reaches main via the new C5/C6/C9 IPCs.

| IPC | Probe | Result |
|---|---|---|
| `session.readBannerTitle` | Known session `0c3e499a-...` in `/Users/.../duo` | `{title: "sunday night", source: "customTitle"}` ✅ |
| `session.readBannerTitle` | Session with aiTitle (`6a98a9e8-...`) | `{title: "Move about-duo.md to docs folder", source: "aiTitle"}` ✅ |
| `session.readBannerTitle` | Session with no titles (`b9003231-...`) | `{title: "Okay, looking at main local (uncommitted...", source: "jsonl-firstmsg"}` ✅ |
| `session.readBannerTitle` | Non-existent UUID | `{title: "ffffffff", source: "uuid"}` ✅ |
| `session.readMessageCount` | "sunday night" (17MB JSONL) | `185` user-message entries ✅ |
| `session.listPrior` | `/docs` cwd, limit 3 | 3 results, first title `"Renamed via Duo"` ✅ |
| `session.listPrior` | Non-existent cwd | `[]` (graceful failure) ✅ |
| `session.maybeHydrate` | Already-named session `0c3e499a-...` | `{hydrated: false, reason: "already-has-customTitle"}` ✅ |
| `session.maybeHydrate` | Below-threshold session (2 msgs) | `{hydrated: false, reason: "messageCount<3 (was 2)"}` ✅ |
| `session.maybeHydrate` | No-JSONL session (0 msgs) | `{hydrated: false, reason: "messageCount<3 (was 0)"}` ✅ |

**All 4 read-ladder rungs verified against real on-disk data.** Head+tail dual-read at 1MB+1MB correctly catches custom-title entries near the head of a 17MB JSONL (the empirical "sunday night" case has its entry at line 654).

### Live UI surfaces

| Surface | Status | How verified |
|---|---|---|
| **S0 quiet** (no captured UUID + no prior sessions) | ✅ | Dev boot inspection — no `.claude-resume-banner` elements when no tabs meet S1/S2/S3 conditions |
| **S1 pills** (no UUID + claude not running + prior sessions exist) | ✅ live | Activating the `/docs` shell tab renders the banner with locked "Resume previous session" header + 3 pill rows (titles: "Renamed via Duo", "Commit and push documentation changes", "Hello") |
| **S2 named banner** (UUID + claude live) | ⏳ deferred | Requires workspace save → restart → restore flow with a recent claude JSONL within 24h. Functional pieces verified (IPC returns correct title, store toggle works, tab dot conditional rendering wired). End-to-end visual deferred to C13 smoke walk. |
| **S3 restore-offer** (UUID + claude not running) | ⏳ deferred | Same constraint as S2. Polished from C3's stock banner to use D5 ladder title via IPC — verified the IPC call site renders `{title}` in the banner copy. |
| **Tab dot marker** (S2 collapsed default) | ⏳ deferred | Functional check via Tab subscribing to store. Visual confirmation deferred. |
| **Click-to-toggle on active tab** | ⏳ deferred | Logic correct; depends on a live S2 state to exercise. |

### Architectural invariants (D9)

| Check | Status |
|---|---|
| No `~/.claude/duo/hydrated-sessions.json` (or similar shadowing) | ✅ `find ~/.claude/duo -name '*hydrat*'` returns empty |
| No `~/.claude/duo/sessions-*` files | ✅ `find ~/.claude/duo -name '*sessions*'` returns empty |
| Workspace JSON schema has `lastClaudeSession` as pointer only (no `title`, no `messageCount`) | ✅ `jq '.state.terminals[0]\|keys'` → `["cwd", "kind", "lastClaudeSession", "title"]` — `title` here is the *terminal* title (cwd basename), not a session title |
| Hydration-already-done tracking is in-memory only | ✅ `alreadyHydrated` Set in [`electron/session-hydrator.ts`](../../electron/session-hydrator.ts); reset on Duo restart by construction |
| SessionHeader UI state (collapsed/dismissed/pillsVisible) is in-memory only | ✅ [`renderer/store/sessionHeader.ts`](../../renderer/store/sessionHeader.ts) module-scoped `Map`; no persistence |

### Could-not-verify (deferred to C13)

These all require live PTY input to fire and were blocked by an
unrelated environment condition (a remote-control-mode banner on the
running Claude Code that intercepts PTY-injected Enter keys):

- Actual `/rename` JSONL appearance after Duo-driven hydration injection
- Auto-hydration end-to-end on a fresh chat (T3 → maybeHydrate fires → /rename → JSONL gets `{"type":"custom-title", ...}`)
- S2 / S3 banner visual layout under real conditions
- Click-to-collapse + Click-to-expand UX
- Pill click → `claude --resume <uuid>` actually starts a new session

All five fold into the C13 smoke walk manifest.

---

## Lessons learned

> Notes from C1–C9 build session. Surfaced in chronological order;
> the rationale for each is in the relevant commit message.

### 1. Run the empirics before coding the spec

The PRD assumed the field name was `customName` and that
`sessions-index.json` was canonical. **Both wrong.** A 15-minute pass
through the Claude binary's strings table + a `find` for existing
`type:"custom-title"` JSONL entries gave us:

- Field name is `customTitle` (renamed 30 occurrences across PRD,
  build plan, CLAUDE.md before C2 started)
- `sessions-index.json` is **optional and absent from most projects** on
  this machine, including the Duo project itself. Only 2 of ~30
  projects have one. JSONL is the source of truth.
- The "Renamed via Duo" residue in an existing JSONL ([`-Users-geoffreydudgeon-Documents-GitHub-duo-docs/17d05c98-...jsonl`](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo-docs)) — from the reverted [f351719](https://github.com/dudgeon/duo/commit/f351719) — was unintended free regression evidence: it proved the cherry-pick base from C2 was already writing the right field name.

**Memory codified:** the C1 empirics doc + the CLAUDE.md § 12
"NO SIDECAR ANTI-PATTERN" rule.

### 2. JSONL is huge — head+tail dual-scan, not whole-file read

First C4 implementation had a 5MB whole-file cap. The real "sunday
night" session is 17MB; the `type:"custom-title"` entry sits at line
654 — well within a 1MB head read. Switched to **HEAD_BYTES=1MB +
TAIL_BYTES=1MB dual-read** with partial-line discards. Caught custom-
title regardless of where in the file it sits.

Performance bound: ≤2MB read per `readBannerTitle` invocation
regardless of session size. Acceptable for per-render IPC.

### 3. The IPC layer matters more than expected

Three IPCs added in C5/C6/C9 (`readBannerTitle`, `readMessageCount`,
`listPrior`, `maybeHydrate`). Each required:
- `IPC` constant in [`shared/types.ts`](../../shared/types.ts)
- ipcMain handler in [`electron/main.ts`](../../electron/main.ts) with lazy `import()` to avoid pulling claude-session-tracker into the early-boot graph
- `window.electron.session.*` surface in [`electron/preload.ts`](../../electron/preload.ts) — **relative import (`../shared/host-api`), not `@shared/...`** (preload's tsconfig has a different path-mapping; typecheck error caught the first attempt)
- `ElectronSessionAPI` interface entry in [`shared/host-api.ts`](../../shared/host-api.ts)

The pattern is well-documented in CLAUDE.md § 4 — followed it
mechanically. Skipping any step is a typecheck or runtime error.

### 4. `duo eval` ≠ `duo dom --js`

Initial probes against renderer state used `duo eval`, which targets
the **browser pane** (a WebContentsView), not the main renderer. The
main renderer is accessible via `duo dom --js '<expr>'` — different
verb, different context. Several minutes lost rediscovering this.

Should be more discoverable. Filed mental note for a possible CLI
DX follow-up.

### 5. PtyManager needed cwd tracking

The C2 cherry-pick's `PtyManager.Session` was `{id, pty}`. The C9
trigger wiring needed `cwd → tabId` lookup so the main-side enrichment
hook could call `maybeHydrate` for the right PTY after detecting a
session UUID. Added `cwd: string` to `Session` + new `listIdsByCwd()`
method. Tiny change but it was the missing piece. Without it, the
T3 wiring would have had to route through the renderer (worse design).

### 6. The 24h staleness cap blocked live hydration testing

The cherry-picked `detectLatestClaudeSession(cwd, maxAgeMs)` from C2
has a 24h cap by default. My test claude tab at `~` had its latest
JSONL from May 23 (>24h ago, the dev had been running stable on that
tab) — so the enrichment hook kept seeing `null` and never captured
a UUID. Couldn't test the auto-hydration loop end-to-end in-session.

Not a bug — the cap is intentional to prevent restore banners for
ancient sessions. But it's a verification-flow gotcha. **For the C13
smoke walk: fresh claude tab + 3+ messages + manual save is the
canonical test, not "use any existing tab."**

### 7. Remote-control mode intercepts PTY input

When I tried to spawn a fresh claude tab in `~/Documents/enh-183-hydration-test`
and chat with it for end-to-end testing, the prompt accepted the typed
text but **did not submit on Enter** — the banner showed
"/remote-control is active". Claude Code's remote-control feature
(when active) intercepts local PTY Enter keys and routes input from
a different source.

This is unrelated to ENH-183 — the build path through PTY-write +
maybeHydrate is correct, but the test environment couldn't exercise
it. Deferred end-to-end live verification to C13 smoke walk where
the owner can use a Claude session without remote-control engaged.

### 8. Idempotent dedup means autosave can safely call hydrate

D6 ("autosave doesn't fire /rename") was a worry — would T3 firing on
every autosave cause runaway /rename storms? The dedup design
prevents this: `alreadyHydrated` Set adds **only on successful
injection**. Failed-gate attempts (count<3, etc.) don't poison the
set, so the session keeps re-attempting as it grows. Once the gate
passes once and /rename fires, the set is added; subsequent autosaves
see "already-hydrated-this-run" and no-op.

Net effect: D6's spirit holds (autosave doesn't trigger redundant
injections) without needing autosave-vs-manual-save trigger
differentiation. T2 (explicit manual force-rehydrate) is therefore
a "polish" trigger, not a hard requirement.

### 9. Preload changes need full restart, every time

HMR covers renderer-only edits cleanly. Preload edits (any
`window.electron.<x>` API surface change) require a full Electron
restart — not just `npm run dev` reload, but kill + spawn. Two
restarts this session (after C5's preload + after C9's preload).
Each ~10 seconds. Documented as part of the iteration loop;
prepended `until duo doctor 2>&1 | grep -qE "✓ Unix socket"` as the
readiness gate.

### 10. The build plan's C8 + C9 boundary moved

Build plan originally had C8 = "hydrator + T1 idle trigger" and
C9 = "T2 + T3 wiring". Reality:
- C8 = hydrator function + 8 tests (the pure logic + idempotency)
- C9 = T3 wire-up only (via the existing enrichment hook). T2 and T1
  deferred as documented polish.

The boundary moved because T1 (chokidar file-watcher on JSONLs) is
substantial work that doesn't change the user-visible outcome
materially — T3 (autosave-driven) catches the same cases on any
machine that autosaves. T1's value is for "no autosave configured"
scenarios which are rare. Moved to a follow-up.

T2 (force-rehydrate on manual save) collapsed into T3's path — they
share the same enrichment hook + the idempotent dedup. Distinguishing
them would require a separate force-flag IPC; not worth it for the
v1 cut.

### 11. The build plan's C5 click-toggle UX needed thought

Build plan said "Click tab → banner expands." That conflicts with
the existing "Click inactive tab → select" behavior. Resolution:
**only the ALREADY-active tab toggles on click.** Clicking an
inactive tab still selects it (no change). Implemented in
[`renderer/components/TabBar.tsx:200-209`](../../renderer/components/TabBar.tsx). UX is "tab is selected → click to expand banner / re-collapse."

### 12. SessionHeader's S1 pills auto-dismiss on claude-presence change

Build plan called for "first user Return committed to new Claude
session → pills auto-dismiss within 200ms." A literal Return-watcher
would require a PTY-side keystroke hook. Simpler: subscribe to the
existing `claudePresence` state — when it transitions to
'claude' / 'starting', the pills auto-dismiss
([`renderer/components/SessionHeader.tsx:103-108`](../../renderer/components/SessionHeader.tsx)).

This is **stricter** than what the PRD asked for (any way claude
starts, not just first Return). Same UX outcome though — pills go
away once claude is live in the tab.

### 13. Wrote per-commit notes inline, then this rollup

Each commit's message body has the per-step justification (gate
reasons, verification ACs, deferrals). This rollup is the cross-
commit pattern summary. Don't let one displace the other —
commit messages stay loadable for `git log` archaeology; this rollup
is the synthesis sheet for the next person picking up C10.

### 14. Walk-1 fixes (post-walk-1 owner directives, 2026-05-24)

Three real bugs surfaced after the owner walked v0.7.9-rev2.
Recording them here because each one points at a process gap that
future enhancements should avoid.

**14a — Cherry-picked CSS vars were undefined ([07d7a08](https://github.com/dudgeon/duo/commit/07d7a08)).**
The C2 cherry-pick of f351719 referenced `var(--duo-text)`,
`var(--duo-text-mute)`, `var(--duo-surface)` — none of which exist
in Duo's actual CSS-var set (`--duo-ink`, `--duo-ink-mute`,
`--duo-accent`, `--duo-paper-rule`). My C5/C6 pills additions
inherited the broken vars + added more. Bg fell back to transparent,
text fell back to dark on dark. Owner reported "text renders
invisible in light mode; in dark mode I can see the text but there
is no context." Fix: hardcoded the locked Variant B mockup palette
(`#1a1814` bg, `#fbf8f1` titles, `#9a9080` mute, `#c46a1c` accent).
Process gap: my pre-handoff probe checked element existence
(`querySelector`) but not computed styles (`getComputedStyle(...).
backgroundColor` etc.). Filed into smoke-walk SKILL.md § 4c.

**14b — Banner was absolute-overlay instead of in-flow ([07d7a08](https://github.com/dudgeon/duo/commit/07d7a08)).**
Cherry-pick inherited `position: absolute; top: 8px; left: 8px;
right: 8px` — a floating card over xterm. Mockup wanted a panel
between the tab strip and xterm. With Bug 14a's transparent bg,
the shell prompt bled through where the pill row's right-side
columns should have been. Fix: restructured TerminalPane to
`flex-col` with SessionHeader above a `relative flex-1 min-h-0`
terminal container. Banner is now `position: static` (in-flow).
Process gap: should have re-read the mockup HTML during build to
catch the layout assumption, not just the color palette.

**14c — Auto-dismiss race + over-capture on fresh tabs ([2584c20](https://github.com/dudgeon/duo/commit/2584c20), [cbaeb9c](https://github.com/dudgeon/duo/commit/cbaeb9c)).**
Owner observed: "opened new raw terminal tab in same CWD, didn't
see resume UI." Two layers:

1. **Auto-dismiss race** — my pillsVisible-dismiss `useEffect`
   fired on initial mount when `useClaudePresence` briefly cached
   the previous front-terminal's 'claude' value during the new
   tab's probe lag. Fix: track `{tabId, presence}` in a ref; only
   dismiss on actual same-tab transition.

2. **Over-capture on fresh tabs** — the actual cause of the
   user's symptom. C2's enrichment hook captured
   `lastClaudeSession.id` for EVERY tab whose cwd had a recent
   JSONL — even tabs that never ran Claude. Fresh shell tab in
   `/docs` → autosave fires → hook scans `/docs/` JSONLs → captures
   the most-recent UUID onto the fresh tab → SessionHeader
   discriminator routes to S3 ("This tab had: …") instead of S1
   (pills). The tab never had anything.

   **Fix:** new module-level `tabsThatHostedClaude: Set<tabId>`
   updated by `claudePresence.onChange` whenever state transitions
   to 'claude' / 'starting' for a tab. The enrichment hook gates
   capture on membership in the set OR a pre-existing pointer from
   disk (preserves workspace-restore case). T3 hydration trigger
   moves behind the same gate.

   This is **the CAPTURE-ON-EVIDENCE-NOT-SPECULATION sub-rule** of
   D9 — now codified in CLAUDE.md § 12. The capture isn't sidecar
   storage in the literal sense (the field is on Duo's own object,
   `TabSession`) but it's semantically a sidecar: claiming an
   association ("this tab had X") that Duo has no actual evidence
   of. Capture only on real evidence; read live; show nothing when
   there's nothing to show.

**Transition note on 14c.** Existing disk-state captures from the
old rule don't reactively clear in the running renderer. To see
the new gate take effect immediately: `File > New Workspace` OR
`Open Workspace` a different file. Next autosave under the new
rule will write `null` for non-hosting tabs; next workspace open
will then surface S1 correctly. Long-term users of saved
workspaces will see their captures naturally re-stabilize as
autosaves overwrite old values when tabs are reopened.

---

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
