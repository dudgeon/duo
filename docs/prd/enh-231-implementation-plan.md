# ENH-231 — Async Catch-Up: implementation plan (one PR)

> **Companion to the locked-scope PRD** ([enh-231-async-catchup-home.md](enh-231-async-catchup-home.md)).
> That doc is *what + why*; this is the *how* — the build playbook. Grounded in a
> codebase-mapping pass (7 parallel readers) + two adversarial reviews; every
> review fix is applied below and itemized in §11.
>
> **v1 scope (owner): FULL build in one PR** — board UI + digest extractor +
> Stop-hook hydration + `duo home mode` + `duo session note/next` + skill/agents
> teaching.

## 1 · Locked design recap (see PRD for rationale)
Sibling Home **mode** (Projects ↔ Catch-up), default = **remember last used**.
Catch-up renders a commingled **Command Board**: three **attention** columns —
**Needs you** (act) · **Working** (wait) · **Done** (review). Blocked is a reason
chip, not a column; phase axis cut (only *plan-to-approve* survives, as a Needs-you
reason). Cards: goal · "You asked" · next-steps (todos) · files · artifact chips ·
state badge. Done cards lead with **Open session →** (md/html leads with the
artifact; PR/diff secondary). Narrative via agent self-narration (`duo session
note/next`) + snippet fallback. Hydration: a per-session digest materialized on the
managed **Stop hook**; Home reads cached digests — **no inference at open**.
**Two-tier columns:** active/open sessions **and any session needing you** render as
**full cards**; the rest of the last-7-days (deduped) render as **compact rows**
beneath. Cron runs appear, badged **scheduled**.

## 2 · Verified codebase facts (anchors the plan relies on)
- Snapshot service: `electron/home-snapshot.ts` — `buildHomeSnapshot` (~`:481`),
  `enumerateProjectDirs` (`:200`), `rollupProjects` (`:253`).
- JSONL reader: `electron/claude-session-tracker.ts` — head/tail seek reads
  (`readSessionHeadMeta` `:628`, `readSessionTailMeta` `:515`). **The helpers
  `readJsonlLines` (`:319`), `safeParse` (`:351`), `extractAssistantText` (`:595`),
  `extractUserMessageText` (`:689`) are FILE-PRIVATE** — exporting them is a
  required P1 step (§ P1).
- IPC: channel `home:snapshot` (`shared/types.ts:~2607`); handler `electron/main.ts:3199`;
  live-process attribution `buildHomeOpenJoin` (`main.ts:~4400`); coalescing
  `homeSnapshotInflight` (`:~4415`).
- Socket server: **`core/socket-server.ts`** (NOT `electron/`). `session` case
  (`:~2539` dispatch on `op:`), `home` case (`:~2222`). Both are existing verbs
  with sub-ops → **we extend, we do not add flat verbs.**
- CLI: `cli/duo.ts` — `VERBS[]` `session` (`:~477`) + `home` (`:~483`) with inline
  `args:`/`summary:` help strings (`:478–490`).
- **CLI currency gate: `scripts/check-skill-currency.mjs` has a HARDCODED
  `SUBCOMMANDS` map (`:163–191`)** — `session:['list','resume','open']`,
  `home:['show','state','refresh']`. It does **not** auto-discover sub-ops.
  Editing it is mandatory (§ P5) or the PR deadlocks at its own gate.
- **Authoritative CLI doc for the currency check: `skill/references/cli-reference.md`**
  (PATHS.cliReference), not only `skill/SKILL.md`.
- Hooks: `electron/install-service.ts` — `ATTENTION_HOOK_EVENTS` (`:127`),
  `planManagedHooksMerge` (`:385`), `installAttentionHooks` (`:1265`), `_duo`
  marker rotate-on-bump (`:1281`); script `skill/scripts/duo-attention.sh`.
  Attention classifier `core/attention.ts:attentionForEvent` (`:15`).
- Renderer: `renderer/components/Home/HomeView.tsx` — `isActive` BUG-046 poll-gate
  (`:86–91`), click contract `onActivateSession`→`sessionAction` (focus/resume),
  recent-file open via `duo-home-open-file` CustomEvent.
- Settings: `core/settings-service.ts` (`DuoSettings`) — app-global, multi-window
  safe (ENH-191 default-ON); the persistence home for mode (NOT localStorage).
- Cron: `core/cron-service.ts` — a run's `lastSessionId` points at a JSONL (`:176`).
- PTY: `core/pty-manager.ts` stamps `DUO_TAB`/`DUO_SESSION` (`:88`).

## 3 · The two Duo-owned stores (the §D9 boundary — central correctness property)
Review found the draft's headline invariant ("delete cache → byte-identical rebuild
from transcript") is **false for any agent-supplied field**. Resolution — **two
separate files**, only one of which is the rebuildable cache:

| File | Contents | Rebuildable from transcript? |
|---|---|---|
| `~/.claude/duo/session-digests.json` | **Transcript-derived only** — goal, youAsked, todos, files, artifacts, attention, state, gitBranch, fallbackSnippet, lastActivityAt | **Yes** — this is the cache the §D9 test gates |
| `~/.claude/duo/home-state.json` | **Duo-owned, NOT transcript-derived** — per-uuid `{note?, next?, reviewedAt?}` annotations + the "last seen Home" watermark | **No** — never claimed to be; §D9-exempt (a Duo concept the agent's prose, the review-mark, and the watermark, which Claude Code doesn't track) |

The rendered card is `digest ⊕ annotation` merged at assembly. The §D9
byte-identical-rebuild test applies **only** to `session-digests.json`. Agent
narrative (`note`/`next`) is captured at **Stop-hook time keyed by uuid** into
`home-state.json`, so it **survives after the tab closes** (the Done-review case).
This is the single most important fix from review.

## 4 · Dependency order
```
P0 types/contracts/channels ─┬─► P1 digest extractor + BOTH stores (+tests)  [spine]
                             │       ├─► P2 Stop-hook trigger + install-service
                             │       └─► P3 catchup snapshot assembly + tab→uuid resolver (+tests)
                             ├─► P5a preload+IPC bridge ─► P4 renderer board + mode toggle
                             └─► P5b CLI sub-ops + 4-surface sync + check-skill-currency edit
                                      └─► P6 cron cards ─► P7 docs/tests/smoke/cut
```
**P4 depends on P5a** (its data path needs the preload bridge) — they are *not*
cleanly parallel; do P5a before P4. P1 is the spine.

## 5 · P0 — Types, contracts, channels (no behavior)
**`shared/types.ts`** — `DuoCommandName` **unchanged** (extend existing `session`/
`home` ops). New types (near `HomeSnapshot` `:1733`, which stays untouched so
Projects mode + its tests are unaffected):
```ts
export type AttentionReason = 'plan-to-approve' | 'question' | 'blocked'
export type HomeMode = 'projects' | 'catchup'
export type DigestState = 'needs-you' | 'working' | 'done'
export interface DigestTodo { text: string; status: 'pending'|'in_progress'|'completed' }

// Transcript-derived ONLY → lives in session-digests.json (the rebuildable cache).
export interface SessionDigest {
  uuid: string; cwd: string
  goal: string                       // first user msg, cleanAndTruncate
  youAsked: string                   // LAST user msg (skip tool_result + machinery)
  todos: DigestTodo[]                // latest TodoWrite input.todos[]
  files: { path: string; kind: 'edited'|'created' }[]
  artifacts: { pr?: { number: number; url: string }; tests?: 'pass'|'fail'|'unknown'; createdFiles?: string[] }
  attention: { reason: AttentionReason } | null
  state: DigestState
  fallbackSnippet?: string           // last assistant text
  gitBranch: string | null
  lastActivityAt: number             // jsonl mtime
}
// Duo-owned, NOT rebuildable → lives in home-state.json.
export interface SessionAnnotation { uuid: string; note?: string; next?: string; reviewedAt?: number }

// Merged view the renderer consumes.
export interface CatchupCard extends SessionDigest {
  narrative?: { note?: string; next?: string }
  reviewedAt?: number
  scheduled?: boolean                // cron-minted (set by assembly, never inferred)
  tier: 'full' | 'compact'
}
export interface CatchupColumn { full: CatchupCard[]; compact: CatchupCard[] }
export interface CatchupSnapshot {
  generatedAt: number; mode: 'catchup'
  columns: { needsYou: CatchupColumn; working: CatchupColumn; done: CatchupColumn }
  watermarkAt?: number               // "since you were away"
}
```
IPC channels (near `HOME_SNAPSHOT`): `HOME_CATCHUP`, `HOME_MODE_GET`,
`HOME_MODE_SET`, `HOME_MODE_PUSH`, `SESSION_DIGEST`.
**`core/settings-service.ts`** — add `homeMode: HomeMode` to `DuoSettings` +
`DEFAULT_SETTINGS` (`'projects'`); unknown value coerces to `'projects'`.
**Tests:** settings round-trip + coerce; type-only phase, no behavior.

## 6 · P1 — Digest extractor + both stores (pure, deterministic, no-inference)
**First task — confirm JSONL shapes against live data** (review: unconfirmed in the
build env). `grep` real `~/.claude/projects/*/*.jsonl` for `"TodoWrite"`,
`"ExitPlanMode"`, `"EnterPlanMode"`, `"create_pull_request"`, and a `tool_result`
error to pin field names + the top-level `toolUseResult` dict. Build fixtures from
the real shapes. **Do not code the scanners before this.**

**Required first step — export the 4 private tracker helpers** (`readJsonlLines`,
`safeParse`, `extractAssistantText`, `extractUserMessageText`) from
`claude-session-tracker.ts` + a regression test asserting the tracker's own behavior
is unchanged. (They are private today; the extractor reuses them, never duplicates.)

**New file `core/session-digest.ts`:**
```ts
export async function extractSessionDigest(jsonlPath: string, uuid: string,
  opts?: { tailBytes?: number }): Promise<SessionDigest | null>  // null on I/O failure only
export function scanTodoWrite(lines: string[]): DigestTodo[]
export function scanFiles(lines: string[]): SessionDigest['files']
export function scanArtifacts(lines: string[]): SessionDigest['artifacts']
export function extractAttentionReason(lines: string[]): AttentionReason | null
export function deriveState(isLive: boolean, attention: AttentionReason | null): DigestState
```
Deterministic rules (+ review hardening):
- `goal` — first user text → `cleanAndTruncate`. `youAsked` — reverse scan for last
  user text, skipping `tool_result` carriers + machinery wrappers.
- `todos` — latest `tool_use name==='TodoWrite'` → `input.todos[]`; none ⇒ `[]`
  (never inferred).
- `files` — `Edit`/`Write`/`NotebookEdit` `file_path`, deduped. **created-vs-edited
  from the `toolUseResult` create/update signal** (review: "Write to unseen path ⇒
  created" mislabels Write-over-existing); when the signal is absent, default to
  **`edited`** (never wrongly claim `created`).
- `artifacts.pr` — `gh pr create` URL in a Bash `toolUseResult`, **or** a
  `mcp__github__create_pull_request` result `{url,number}`; capture the URL so the
  Done card deep-links (no open-time lookup, no network).
- `attention` (deterministic, heuristic where noted):
  - `plan-to-approve` — last `tool_use` is `ExitPlanMode` with no following `user`
    entry. (`EnterPlanMode` with no matching `ExitPlanMode` ⇒ still planning, **not**
    needs-you → leave `null`, state `working`.)
  - `question` — ends on an assistant turn **and** the ENH-225 attention flag fired
    (passed in at Stop-hook write time); at open, degrade to "ended on assistant".
  - `blocked` — **read the top-level `toolUseResult` dict** (exit code / stderr),
    NOT just `is_error` (review: `is_error` present on 1/81 records; real `fatal:`
    errors carry none). Documented as **false-negative-heavy** — degrades silently.
- `fallbackSnippet` — last assistant text (clamped).

**New file `core/session-digest-store.ts`** — the **rebuildable cache** for
`session-digests.json` (`{version:1,digests:[…]}`, atomic tmp+rename,
corrupt-tolerant). Public: `load`, `getDigest`, `setDigest`, `deleteDigest`,
`readOrExtractDigest(uuid,cwd,jsonlPath,now)` (miss ⇒ rebuild+write;
`cached.lastActivityAt < jsonl.mtime` ⇒ prefer transcript, re-extract), `whenIdle`
(write-queue drain for the CLI+Stop race).
**New file `core/home-state-store.ts`** — the **Duo-owned** `home-state.json`
(`{version:1, watermark, annotations:[{uuid,note?,next?,reviewedAt?}]}`): `getAnnotation`,
`setNote`, `setNext`, `markReviewed`, `getWatermark`, `setWatermark`. **Not** part of
the rebuildable guarantee.

**Tests:** `core/session-digest.test.ts` (fixture sandbox mirroring
`claude-session-tracker.test.ts`): every field; each attention reason in isolation +
combos; created-vs-edited from `toolUseResult`; PR via both gh + mcp;
EnterPlanMode-without-Exit ⇒ no attention; **assert zero `Date.now()` + zero network
inside `extractSessionDigest`** (clock injected by callers). Store tests: missing →
empty; corrupt → coerce; concurrent `setDigest` serialized. **§D9 gate test:**
materialize → delete cache → `readOrExtractDigest` rebuilds → **deep-equal** original
(only `session-digests.json` fields; annotations excluded by construction).

## 7 · P2 — Stop-hook digest trigger
**`skill/scripts/duo-attention.sh`** — add a `digest` arm that calls
`"$DUO_BIN" session digest "$DUO_TAB" || true` with a short timeout. On **Stop**, run
both `set` (existing badge) and `digest` arms, each `|| true`-guarded (a hung digest
never blocks the badge). On **UserPromptSubmit**, in addition to `clear`, fire
`session digest "$DUO_TAB" --you-asked-only` to refresh "You asked".
**`electron/install-service.ts`** — piggyback the existing `Stop→set` arm via the
script (no second Stop hook entry → no version-bump merge duplication); the `_duo`
marker rotation (`:1281`) is untouched. **Known race (documented, not fixed):**
the UserPromptSubmit refresh may read the *previous* user msg if the new one isn't
flushed yet — eventual-consistency; the next Stop digest corrects it.
**Tests:** merge fixture (upgrade → no duplicate Stop entries); script test (`STATE=digest`
calls `session digest $DUO_TAB`; a digest failure doesn't abort `set`).

## 8 · P3 — Catchup assembly + the tab→uuid resolver
**New primitive (review: load-bearing, did not exist).** `sessionIdForTab(tabId)`:
resolve `DUO_TAB` → live PTY (pty-manager) → its cwd → newest `<uuid>.jsonl` via the
existing open-session attribution (`detectLatestClaudeSession` / the
`buildHomeOpenJoin` live map). Only resolvable while the tab is live — which is
exactly when the Stop hook and `duo session note/next` fire. Closed sessions are
reached by uuid at assembly, never by tab.

**`electron/home-snapshot.ts`** — `buildCatchupSnapshot(deps + {daysSince=7, now,
digestStore, homeStateStore, openByUuid, cronSessionIds})`:
1. `enumerateProjectDirs`→`rollupProjects`→flatten; keep `mtime ≥ now−7d`.
2. `readOrExtractDigest` per session (cache fast-path), `mapLimit` at existing
   `READ_CONCURRENCY`.
3. `isLive = openByUuid.has(uuid)`.
4. Column by attention/state: `attention!=null`⇒`needsYou`; `isLive&&null`⇒`working`;
   else⇒`done`.
5. **Two-tier (review fix): a card is `full` if `isLive` OR `attention!=null`;
   `compact` only when non-live AND no attention**, within the 7-day window, deduped
   by uuid. (A closed session awaiting plan approval is the highest-value Needs-you
   card — it must be a full card, not demoted to a one-liner.)
6. Merge `home-state.json` annotation (narrative/reviewedAt) → `CatchupCard`.
7. `scheduled` from `cronSessionIds` (P6). `watermarkAt` from `home-state.json`.
**`electron/main.ts`** — `HOME_CATCHUP` handler (coalesced like `homeSnapshotInflight`);
one `SessionDigestStore` + `HomeStateStore` at startup, injected here and into the
socket `session` path. NavBridge: `getCatchupBoard(asJson)`, `getHomeMode`,
`setHomeMode` (writes Settings **and broadcasts `HOME_MODE_PUSH` to ALL windows via
`WindowRegistry`** — review: app-global mode is pointless if only the calling window
hears it), `getSessionDigest(tabId)`, `getSessionNote/NextSteps(tabId)`,
`setSessionNote/Next(tabId,text)` (resolve tab→uuid, write `home-state.json`).
**Known limitation (documented):** `claude --resume` can mint a new uuid for the
"same" work → a duplicate card (one Done, one Working). v1 dedups by uuid only; flag
in PRD risks; future mitigation = collapse by `sessionId` lineage.
**Tests:** extend `home-snapshot.test.ts` — 7d window; column assignment; **two-tier
incl. the closed-needs-you⇒full case**; dedup; `scheduled`; cache-hit vs miss → same
board.

## 9 · P4 — Renderer board (theme-legible, poll-gated)  ·  P5a preload first
**P5a (do before P4):** `electron/preload.ts` — expose `home.mode.{getMode,setMode,
onModeSet}`, `home.catchup()`, `session.digest(tabId)`; wire `HOME_MODE_*`,
`HOME_CATCHUP`, `SESSION_DIGEST`. **`onModeSet` is a subscription → return a
removeListener teardown** (mirror `onTerminalTabAttention` `:1038`; leak risk if
omitted).
**`HomeView.tsx`** — `homeMode` seeded from `home.mode.getMode()` (not localStorage);
toggle persists via `setMode` (IPC→Settings) + subscribes to `HOME_MODE_PUSH`.
`projects`→existing tree (unchanged); `catchup`→`<CatchupBoard>`. **BUG-046:** the
`HOME_CATCHUP` fetch is wired into the **same `isActive`-gated effect/interval**
(`:86`) — a hidden Home polls nothing; **toggling mode does NOT fetch** (only pushes
the pref). New components: `ModeToggle` (a11y `radiogroup`), `CatchupBoard`
(3 columns → full `SessionDigestCard`s then `CompactSessionRow`s; per-column empty
state), `SessionDigestCard` (goal · "You asked" · todo chips · files · artifact chips
· state badge · narrative-or-`fallbackSnippet`; **primary "Open session →"** via
`onActivateSession`; md/html ⇒ primary "Open <artifact> →" via `duo-home-open-file`;
PR/diff secondary), `CompactSessionRow`, `AttentionChip`, `ScheduledBadge`.
`homeModel.ts` — pure `assignCatchupColumns`/`splitTiers` selectors (server is
authoritative; these are for presentation + unit tests).
**Theme (hard rule):** `var(--duo-*)` + shared `duo-banner-*`/`duo-text-*`
(`plan-to-approve→warn`, `question→info`, `blocked→error`); dark via
`[data-theme="dark"]`. **No Tailwind color utils, no `dark:`.** Grep test over new
CSS bans `text-red`/`bg-…/NN`/`dark:` **and bare hex / `color-mix(...black|white)`**.
**Tests:** `homeModel.test.ts` (columns + tiers); component tests (placement, chip
class+text, primary/secondary actions); a11y (keyboard toggle); BUG-046 test (hidden
Home → zero `HOME_CATCHUP` fetches; toggle → no fetch).

## 10 · P5b CLI sub-ops + 4-surface sync  ·  P6 cron  ·  P7 docs/cut
**P5b — `cli/duo.ts`** (extend existing verbs):
- `session`: `digest <tab>`, `note <tab> [text]` (read/write), `next <tab> [text]`.
- `home`: `mode [projects|catchup]` (read/write), **`catchup [--json]` as a `home`
  sub-op** (review: a flat `duo catchup` would force `DuoCommandName`/`VERBS[]`
  additions + currency churn — so it's `duo home catchup`, routed `send('home',
  {op:'catchup'})`). Update the inline `args:`/`summary:` help strings in the
  `session`/`home` `VERBS[]` entries (`:478–490`).
**`core/socket-server.ts`** — extend the existing `session` case (`op∈{…,'digest',
'note','next'}`) and `home` case (`op∈{…,'mode','catchup'}`).
**MANDATORY currency edit (review: the deadlock fix) — `scripts/check-skill-currency.mjs`
`SUBCOMMANDS` (`:163–191`):** add `digest,note,next` to `session`; add `mode,catchup`
to `home`. Without this, `check:skill-currency` A2 hard-fails ("unknown subcommand").
**4 doc surfaces** (all required): `skill/references/cli-reference.md` (the
authoritative table A1/A2 read) · `skill/SKILL.md` · `agents/duo.md` (verb cheat-sheet
`~:286`) · `docs/CLI-COVERAGE.md`. **Mechanical, in order:** `npm run build:cli &&
git add cli/duo` → `npm run sync:claude` → `npm run check:skill-currency` (must pass)
→ `npm run typecheck`.
**P6 — cron:** pass cron runs' `lastSessionId` set into `buildCatchupSnapshot` as
`cronSessionIds`; assembly sets `scheduled:true` (never inferred from transcript);
`ScheduledBadge` renders (theme-legible). Test: uuid ∈ cronSessionIds ⇒ badge.
**P7 — docs/cut:** flip `tasks.md` ENH-231 status; finalize PRD D-decisions
(incl. the two-store split + narrative-not-rebuildable); ADR in `docs/DECISIONS.md`
(digest cache = rebuildable index; `home-state.json` = Duo-owned annotations);
refresh `RESUME.md` + `active-sprint.md` + roadmap; run `/smoke-walk`, wait for
pasted results, then `cut-version`.

## 11 · Adversarial-review fixes applied (traceability)
1. **§D9 narrative contradiction** → narrative/reviewedAt/watermark moved to a
   separate non-rebuildable `home-state.json`; cache holds transcript-derived only;
   §D9 test scoped to the cache (§3, P1).
2. **`check-skill-currency.mjs` SUBCOMMANDS hardcoded** → mandatory P5b edit (§10).
3. **`duo catchup` flat verb** → `duo home catchup` sub-op (§10).
4. **tab→uuid resolver missing** → `sessionIdForTab` primitive (P3, §8).
5. **4 tracker helpers private** → required P1 export + regression test (§6).
6. **`cli-reference.md` + inline `VERBS[]` help omitted** → added to the 4 surfaces (§10).
7. **`HOME_MODE_PUSH` single-window** → WindowRegistry fan-out to all windows (P3, §8).
8. **Closed-needs-you demoted to compact** → full card if `isLive OR attention!=null` (P3, §8).
9. **`blocked` via `is_error` (1/81)** → read top-level `toolUseResult`; documented
   false-negative-heavy (§6).
10. **created-vs-edited mislabel** → from `toolUseResult`; default `edited` when absent (§6).
11. **EnterPlanMode unhandled** → EnterPlanMode-without-Exit ⇒ working, not needs-you (§6).
12. **resume mints new uuid → dup card** → documented v1 limitation + future lineage dedup (§8).
13. **youAsked read-race** → documented eventual-consistency; next Stop corrects (§7).
14. **P4∥P5 not parallel** → P5a preload sequenced before P4 (§4, §9).
15. **BUG-046 catchup** → fetch in the same isActive gate; toggle-no-fetch test (§9).
16. **Theme grep** → also bans bare hex + `color-mix(black|white)` (§9).

## 12 · Risks / unknowns (carry into the PR)
- **JSONL shapes for TodoWrite / ExitPlanMode / create_pull_request are unconfirmed
  in this environment** — P1's first task pins them against live transcripts; the
  scanner designs are assumptions until then. *Highest-priority unknown.*
- `blocked` attention is heuristic (false-negative-heavy) — acceptable for v1; a
  mislabel only changes a reason chip, never the column.
- `claude --resume` uuid churn can double-card a resumed session (v1 limitation).
- Large cold board (many 7-day sessions, cache cold) = N extractions on first open;
  bounded by the 7-day window + `READ_CONCURRENCY`; warm after the first Stop digest.

## 13 · Acceptance checklist
- [ ] Mode toggle persists app-global (Settings), remembers last used, fans out to
  all windows; `duo home mode` reads/writes the same store.
- [ ] Catch-up renders 3 attention columns; blocked = chip; two-tier (full incl.
  closed-needs-you, compact for the rest); cron badged.
- [ ] Every card field is from the pre-hydrated digest — **zero inference at open**
  (test asserts no `Date.now()`/network in the extractor).
- [ ] **§D9: delete `session-digests.json` → board rebuilds byte-identical** from
  transcripts; annotations live separately and are not claimed rebuildable.
- [ ] `duo session note/next` stamps `home-state.json` (by uuid; survives close);
  snippet fallback when absent.
- [ ] BUG-046: hidden Home fires zero catchup fetches; toggle fires none.
- [ ] `check:skill-currency` PASS (SUBCOMMANDS + all 4 doc surfaces); `build:cli`
  committed; `sync:claude` run; `typecheck` clean.
- [ ] `/smoke-walk` passed (pasted) before `cut-version`.
