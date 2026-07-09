# Agent-agnostic Duo — runtime audit evidence appendix (2026-07-09)

> Raw per-cluster evidence behind
> [`agent-agnostic-duo-v2.html`](agent-agnostic-duo-v2.html) (the decision
> playground) and the ENH-189 rev-5 update in `tasks.md`. Six parallel audit
> passes over the tree at **v0.13.7-dev** (branch
> `claude/duo-agent-agnostic-review-aebd6b`, post-v0.13.6). All file:line
> references verified against source at audit time. This is the implementer's
> reference — the playground carries the consolidated matrix + decisions.
>
> Prior baseline: ENH-189's `agent-agnostic-duo.html` (rev 4, 2026-06-06,
> 19 touchpoints). Everything marked **[post-189]** shipped after that
> baseline.

---

## Cluster 1 — Session storage, presence detection, resume plumbing

Note: the tracker lives at **`electron/claude-session-tracker.ts`** (moved from `core/`).

### Shared contracts Duo hard-codes

| # | Artifact | Where defined | Public? |
|---|---|---|---|
| C1 | Session store path `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`; encoding maps `/` and `.` → `-` after `realpathSync` symlink resolution | `electron/claude-session-tracker.ts:66-74` `encodeProjectDir`, `:99`, `:305-313` | **Private** file format, reverse-engineered |
| C2 | JSONL record schema: `type` ∈ `custom-title`/`ai-title`/`user`/`assistant`/`system`/`last-prompt`; fields `customTitle`,`aiTitle`,`message.content` (string or `{type:'text',text}` blocks), `cwd`,`gitBranch`,`sessionId`,`timestamp`,`isSidechain`,`isCompactSummary`,`toolUseResult`,`tool_use` blocks (`TodoWrite`/`Edit`/`Write`/`MultiEdit`/`NotebookEdit`/`ExitPlanMode`), subagent transcripts under `<uuid>/subagents/**` | `claude-session-tracker.ts:180-208,563-614,688-707`; `session-digest.ts:34-408` | **Private** ("SHAPE CONFIRMED against live JSONL 2026-06-23") |
| C3 | Process identity: descendant `comm` basename `=== 'claude'` | `core/claude-presence.ts:141-198,271,319-320` | **Private/observable** |
| C4 | CLI: `claude`, `claude --resume <uuid>`, `--fork-session`, `--session-id <uuid>`, positional prompt, `--append-system-prompt`; headless `-p`/`--print`/`--bare`/`--output-format` gated off | `claude-session-tracker.ts:41-45`; `core/cron-command.ts:59-72,115-116`; `install-service.ts:1023` | **Public** CLI contract |
| C5 | Binary named `claude` on PATH / well-known install dirs | `core/resolve-claude.ts:57-159` | **Public-ish** |
| C6 | Project markers `CLAUDE.md` file / `.claude/` dir | `core/projects-service.ts:108-119` | **Public** convention |

Different-agent baseline: Codex CLI stores rollout JSONL under `~/.codex/sessions/`, Gemini CLI under `~/.gemini/tmp/<hash>/`, aider writes `.aider.chat.history.md` in-repo — none populate `~/.claude/projects/*.jsonl`, none present process `comm==='claude'`, none accept `--resume <uuid>`/`--fork-session`. Every C1/C2/C3/C4 touchpoint below **silently no-ops or shows stale/empty info** under a non-Claude agent; none crash (all reads are best-effort try/catch → `null`/`[]`).

### A. Session-storage reads (JSONL scraping)

`electron/claude-session-tracker.ts` — the entire primitive layer:

- `encodeProjectDir` (:66-74) / `jsonlPathFor` (:305-313) — cwd → encoded projects dir. Other agent: path never exists → all downstream reads empty.
- `detectLatestClaudeSession` (:94-124) — newest `.jsonl` mtime → `{id,capturedAt,jsonlModifiedAt}`; feeds workspace-autosave `lastClaudeSession` capture. Other agent: `null` → no resume pointer ever captured.
- `readBannerTitle`/`titleFromLines` (:163-208) — D5 title ladder: `custom-title` → `ai-title` → first `user` msg → short-UUID.
- `readMessageCount` (:217-230) — counts `type:"user"`.
- `listPriorSessions` (:390-428) — S1 resume pills.
- `listTopLevelSessions` (:469-485) — stat-only enumeration, structurally excludes `<uuid>/subagents/**`.
- `readSessionTailMeta` (:518-593) — seek tail read for `assistant`/`last-prompt` snippet, `gitBranch`,`sessionId`,`timestamp`.
- `readSessionHeadMeta` (:631-686) — head+tail read for `cwd` evidence + title.
- `extractAssistantText`/`extractUserMessageText` (:598-707) — nested `message.content` block shape.
- `buildResumeCommand` (:41-45) — emits `claude --resume <uuid>[ --fork-session]\n`.

`electron/session-digest.ts` — deterministic per-session digest (ENH-231, **[post-189]**, #108 2026-06-24):

- `extractSessionDigest` (:429-509) + scanners `scanTodoWrite` (:193), `scanFiles`/`createdPaths` (:221-287), `scanArtifacts` (:293-343, PR-URL/`gh pr create`/`create_pull_request`/test-runner regex), `extractAttentionReason` (:350-408, `ExitPlanMode`/`tool_result.is_error`/`toolUseResult` string `Error:`), `extractGoal` (:180-187, `isCompactSummary` recap + `<command-name>` rungs). Deepest C2 dependency (tool-call schema, `toolUseResult` create/error shapes). Other agent: digest never built; if another agent wrote JSONL-ish files the tool-name schema is Claude-specific → wrong/empty digests.

`electron/home-snapshot.ts` — Home "Projects" rollup + Catch-Up board (ENH-212 / ENH-231, **[post-189]**):

- `enumerateProjectDirs` (:208-228) + `buildHomeSnapshot` (:489-588) — enumerate `~/.claude/projects/*`, roll worktrees into main repo via `.git` `gitdir:` pointer (:164-181), per-project session cards, hero tail-snippets, titles, session counts. Default root `path.join(os.homedir(),'.claude','projects')` (:490,667,802).
- `buildCatchupSnapshot` (:666-790) — Command Board columns (needs-you/working/done) from digests.
- `listHomeSessions` (:796-825) — "all N sessions" pager.
- Other agent: `~/.claude/projects` empty → **Home shows zero projects, empty greeting, empty board**; if the user previously ran Claude it shows only stale Claude history, never current Codex/Gemini work.

### B. Presence / liveness detection

`core/claude-presence.ts` — `comm==='claude'` matching (C3):

- `ClaudePresenceProbe` (:38-133) + `hasClaudeDescendant`/`treeHasClaude` (:141-198) — 500ms `ps -ax -o pid,ppid,comm` BFS of front-terminal PTY tree; gates the Send→Duo pill and titlebar presence dot. States `no-pty`/`shell`/`claude`/`starting` (:26). Other agent: never matches → permanently `'shell'` → pill/dot never light.
- `probeAllTabs` (:242-280) — per-tab verdict + `unattributedClaudePids`.
- `mapLiveClaudeOwners` (:303-336) — every live `claude` + owning Duo PTY; the process-primary open/live signal for Home. Other agent: `[]` → no open/focus pills; resume always treats sessions as closed.

Consumers in `electron/main.ts`: import (:107); pill live-state (:1050-1054); `buildHomeOpenJoin` (:4826-4872) — `mapLiveClaudeOwners` → lsof cwd → group → `listTopLevelSessions` → attribution (re-encodes projects dir at :4858). `closeTerminalTabForCli` (:5695-5709) — refuses `duo term close` on a tab with a live `claude` owner unless `--force`; **the data-loss guard is Claude-only** (a live Codex tab closes without warning).

Renderer: `renderer/hooks/useClaudePresence.ts` (:12-31), `renderer/components/ClaudePresenceDot.tsx` (:22-30), `renderer/components/SessionHeader.tsx` (:63-92, gated on `claudePresence==='claude'`).

### C. Resume / fork / spawn plumbing (C4)

- `main.ts:1645` `sessionResume` — writes `claude --resume <uuid>\n` into the PTY.
- `main.ts:1912-1915` cron `sessionExists` — checks `~/.claude/projects/<enc>/<sessionId>.jsonl` exists.
- `main.ts:3632-3692` `HOME_SESSION_ACTION` + `:5719-5766` `sessionOpenForCli` — focus/resume/fork click contract; `buildResumeCommand(uuid,{fork})`.
- `core/cron-command.ts` (ENH-223, **[post-189]**, #103) — `buildFreshRunCommand` `claude --session-id <uuid> '<prompt>'` (:59-63), `buildResumeRunCommand` `claude --resume <uuid> '<prompt>'` (:69-73), headless gate `-p`/`--print`/`--bare`/`--output-format` (:115-159). Assumes `--session-id` pre-allocation + interactive positional prompt.
- `core/cron-service.ts:203-212` — resume-vs-fresh decision via `sessionExists`. Shell-command cron jobs (#112, **[post-189]**) bypass Claude entirely (`buildShellCommand`).
- `renderer/App.tsx` — auto-types `claude\n` on `kind==='claude'` tab spawn (`dispatchPostSpawnWrite` :1910-1961, esp. :1927), `CLAUDE_MISSING_BANNER` (:130-131), `claudeOnPath()` gate (:1915), default new-tab kind `'claude'` (:118-119).

### D. Binary resolution & priming shim

- `core/resolve-claude.ts` — `resolveClaudeBinary` (:75-159): well-known dirs (`~/.local/bin`, `~/.npm-global/bin`, `~/.volta/bin`, `~/.bun/bin`, `/opt/homebrew/bin`, …) + PATH + shell fallback, all statting for an executable literally named `claude` (:104). Other agent: `null` → `isClaudeOnPath()` (`main.ts:6276-6278`) false → install banner.
- `electron/install-service.ts:985-1029` — writes `~/.claude/duo/bin/claude` PATH shim that execs real-claude with `--append-system-prompt "$(cat ~/.claude/duo/priming.md)"` when `DUO_SESSION` set. `core/pty-manager.ts:74-86` sets `DUO_SESSION:'1'` + prepends SHIM_DIR.

### E. `~/.claude/**` non-session runtime touchpoints

- `core/projects-service.ts:108-119` `hasMarker` + `home-snapshot.ts:189-192` — project qualification on `CLAUDE.md`/`.claude/` (C6); also home-rollup fold qualifier (`home-snapshot.ts:286-298`). Other agent: `AGENTS.md`-only projects may fail to qualify.
- `renderer/components/claudeContextPath.ts:28-36` + `renderer/hooks/useUserClaudeNavigator.ts` + `renderer/components/UserClaudePane.tsx` — "Your Claude settings" pane hard-roots at `~/.claude/`, curates `CLAUDE.md`/`skills/`/`agents/`/`duo` (`useUserClaudeNavigator.ts:165`); context wash marks `./.claude/` + `./CLAUDE.md` only.
- Install/distro writes: `install-service.ts:74,255,520-556`; `distro-pack-service.ts:21-22,356-365`.

### F. Post-2026-06-06 ships in this cluster

- **ENH-212 "Home"** (2026-06-12/13): entire `home-snapshot.ts` rollup, JSONL head/tail primitives, `mapLiveClaudeOwners`, `--fork-session` path, `/rename` custom-title titles. Heavy new C1+C2+C3 surface.
- **ENH-223 + ENH-225** (#103, 2026-06-21): cron command builders, `sessionExists` probe, attention hooks.
- **ENH-231 Catch-Up board** (#108, 2026-06-24): `session-digest.ts` + catchup snapshot — deepest C2 dependency.
- **Shell cron jobs** (#112, 2026-06-27): the one agent-agnostic addition.
- Net: the three biggest post-cutoff features all **deepen** Claude coupling; a non-Claude agent gets an empty Home, empty board, and non-firing scheduled sessions, all silently.

---

## Cluster 2 — Hooks, settings.json management, install pipeline

### A. Hardcoded `~/.claude` path constants

`electron/install-service.ts:71-118`: `DUO_DIR = ~/.claude/duo` (:72), `SKILLS_DUO_DIR = ~/.claude/skills/duo` (:73), `AGENTS_DIR = ~/.claude/agents` (:74), `SETTINGS_PATH = ~/.claude/settings.json` (:103), `SHIM_PATH = ~/.claude/duo/bin/claude` (:104), `USER_CLAUDE_MD_PATH = ~/.claude/CLAUDE.md` (:105), `HOOKS_DEST_DIR = ~/.claude/duo/hooks` (:116-118). Plus `core/constants.ts:29` `SHIM_DIR`.

Codex uses `~/.codex/`, Gemini `~/.gemini/`, aider `.aider*` — none read `~/.claude/`. Every write no-ops for other agents (harmless, but no feature activates). Private contract.

### B. SessionStart hook — priming safety net

- Command: `install-service.ts:146` — `[ -n "$DUO_SESSION" ] && cat "$HOME/.claude/duo/priming.md" 2>/dev/null || true`
- Merge: `installSessionStartHook()` :1101-1167 — upserts into `hooks.SessionStart` in `~/.claude/settings.json`, atomic tmp+rename (:1163-1166). Entry shape (:1151-1156): `{ _duo: "managed-v<ver>", hooks: [{ type: "command", command }] }`. Marker convention (:139-140). Status readback (:916-955) flags `hookConflict` on foreign entries. Orphan cleanup (:1131-1149, BUG-150).
- Contracts: event name `SessionStart`; settings shape `hooks.<Event>[]`; Claude tolerates unknown sibling key `_duo`; SessionStart injects the cat'd text.
- Other agent: no such event/file → no-op, no pollution. Private.

### C. PreToolUse open-file guard (ENH-195)

- `install-service.ts:118` `PRETOOL_GUARD_COMMAND = $HOME/.claude/duo/hooks/duo-open-file-guard.sh`; merge `installPreToolUseHook()` :1190-1253 with **`matcher: 'Edit|Write|MultiEdit'`** (:1236-1242); script `skill/scripts/duo-open-file-guard.sh` — DUO_SESSION-gated, reads PreToolUse event JSON from stdin, extracts `tool_input.file_path`, calls `duo status`, warns to stderr, always exit 0.
- Contracts: event `PreToolUse`; matcher regex format; stdin JSON schema; Claude's internal tool names `Edit`/`Write`/`MultiEdit`. **The most Claude-coupled touchpoint** (private event schema + tool names).
- Other agent: no-op entirely.

### D. Attention hooks (ENH-225)

- Events table `install-service.ts:127-131`: `Stop→set`, `Notification→set`, `UserPromptSubmit→clear`; command `$HOME/.claude/duo/hooks/duo-attention.sh <arg>` (:126, :1277-1280); pure merge `planManagedHooksMerge()` :385-417; registration `installAttentionHooks()` :1265-1287 (single atomic write).
- Script `skill/scripts/duo-attention.sh` — gated on `$DUO_SESSION && $DUO_TAB`, dispatches set|clear|digest, calls `duo attention --tab $DUO_TAB --state …` and `duo session digest $DUO_TAB` (ENH-231 piggyback).
- `$DUO_TAB` stamped per-PTY: `core/pty-manager.ts:88-92` (also `DUO_SESSION` :86, `DUO_SOCKET` :87). CLI consumer `cli/duo.ts:443-447, 2821-2833`. Pure logic `core/attention.ts:15-18`.
- Contracts: Claude hook event names + settings shape + turn-lifecycle semantics. Other agent: hooks never fire → no badge, no digest. `duo attention` works if called manually. Private.

### E. PATH shim — `--append-system-prompt` priming (load-bearing)

- `installShim()` :980-1030; core line :1023: `exec "$REAL_CLAUDE" --append-system-prompt "$(cat "$PRIMING_FILE")" "$@"`; gate :1015 (only when `$DUO_SESSION` set AND priming readable; else transparent pass-through :1016).
- Real-binary resolution :1046-1048 → `core/resolve-claude.ts` (PATH scan for `claude` :15, shell `command -v claude` :18, `excludeShimDir` anti-loop).
- PRD note :43-48: `--append-system-prompt-file` does NOT exist; only inline string — Duo inlines via `$(cat)`.
- Contracts: binary named `claude`; flag exists + argv passthrough. Other agent: shim never fires (wrong binary name) → not primed. Private.

### F. Managed CLAUDE.md block (ENH-088)

- Markers :156-158 (`<!-- duo:managed-v… -->` / `<!-- duo:end -->`); compose `composeManagedClaudeMdBlock()` :250-265 (points at `~/.claude/skills/duo/SKILL.md` + `duo` subagent); merge decision `planClaudeMdMerge()` :280-317 (create/version-replace/append/respect-removal); I/O `mergeUserClaudeMd()` :1078-1099; sticky provenance flag :184-190, :863.
- Contract: Claude's core context loader reads `~/.claude/CLAUDE.md` every session regardless of hook policy (:246-249) — **the "works even in enterprise hook-disabled installs" fallback**.
- Other agent: Codex reads AGENTS.md, Gemini GEMINI.md, aider CONVENTIONS.md — no-op.

### G. Distro-pack CLAUDE.md merge (parallel system)

- `electron/distro-pack-service.ts:416-427` `composeDistroClaudeMdBlock()` — marker `<!-- distro:<name>-managed-v<ver> -->`; :437-460 plan; :471-495 merge from `duo-extras/claude-md-snippet.md`; uninstall strips :573-595. Deferred/NOT implemented: distro `hooks/`, `.mcp.json`, `.lsp.json` merging (:27-28).

### H. Boot orchestration

- `electron/main.ts:1876-1883` `ensureCliShim()` on ready; IPC :3313-3320; version-bump re-surface: `status()` :435 `needsUpdate` → FirstLaunchBanner; every `run()` rewrites hooks with fresh `managed-v<newver>` markers.

### Cluster-2 summary

Every Claude-specific write targets `~/.claude/` + Claude's event/matcher/flag vocabulary; all silently no-op for other agents, never polluting their config. Only the env-var layer (`DUO_SESSION`/`DUO_TAB`/`DUO_SOCKET`, `pty-manager.ts:82-100`) and the `duo` CLI/socket are agent-agnostic. All contracts private, mildest exception = CLAUDE.md-as-memory (documented but Claude-proprietary).

---

## Cluster 3 — Terminal/tab lifecycle & scheduled (cron) sessions

### A. Terminal tab kind `kind: 'claude'`

- **A1** `shared/types.ts:4-7` — `TerminalTabKind = 'shell' | 'claude'`; comment: `'claude' types 'claude\n' into the PTY after spawn`. `:166-167` — `--claude` flag; no flag = persisted last-kind, defaults `'claude'`. Private.
- **A2** `renderer/App.tsx:130-131` `CLAUDE_MISSING_BANNER` (Anthropic install URL); `:1910-1941` `dispatchPostSpawnWrite` — `claude\n${cmd}\n` stdin-seed trick (:1927); `:1952-1959` `\r` submit retries at [4000,10000,20000,32000,45000]ms — **assumes Claude's REPL raw-mode boot timing and that bare `\r` submits a drafted prompt**; `:2010-2016` `openClaudeIn`. Other agent: types `claude` regardless → command-not-found or wrong-agent banner. Public (invocation) / private (raw-mode timing).
- **A3** `renderer/App.tsx:219-227` tab title `claude · <basename>`. Misleads.
- **A4** `renderer/components/TabBar.tsx:451-498` `TabIcon` — Claude spark glyph for the kind. Misleads.
- **A5** `TabBar.tsx:13-17,54-67,102,194-197` — split `+` button "New Claude session (⌘T…)" tooltip/aria; `ClawdGlyph`. Misleads.
- **A6** `FileTree.tsx:1287,1804-1805` (+ `FilesPane.tsx:40`, `FileTree.tsx:66,1026,1165,1461,1793,2092`) — "Start a Claude session here" / "New Claude tab in <name>". Misleads + breaks.
- **A7** `App.tsx:1978-1989` `newTab`; `:815` session-restore rehydrates `t.kind` (persisted 'claude' tabs re-launch claude on restore); `:1282` `hasClaudeKindTerminal`; `:1390` kind-as-live-work proxy; `ProjectRail.tsx:32` presence flag. Misleads.
- **A8** `core/pty-manager.ts:62-127` — spawn itself is shell-based and agent-neutral; Claude-specifics are the SHIM_DIR PATH prepend + renderer typing. `:170-186` resize guards (BUG-156) generic-TUI. Works.

### B. Presence probe / Enter-key semantics

- **B1** `core/claude-presence.ts:19-22,178-198` (+ :141, :242-280, :303-336) — literal `claude` comm matching (see Cluster 1 §B). Private.
- **B2** `renderer/components/TerminalPane.tsx:399-415` — `claudeIsLive = tab.kind === 'claude' || claudePresence === 'claude'`; Enter → `\x1b\r` (ESC+CR) for newline vs `\r` for submit. Comments :325-398 document the discovery that **Claude's REPL reads ESC+CR as insert-newline** — an undocumented REPL byte contract. Other agent: different TUI may submit or garble. Private.
- **B3** `renderer/hooks/useClaudeKeyPrefs.ts:2-24` (`duo.claudeReturn.v1` localStorage); `cli/duo.ts:450-460, 1397-1427` verbs `claude-return`/`shift-return`; `shared/types.ts:113,1570-1597,2495-2496`. Misleads.

### C. Env stamps + shim

- **C1** `core/pty-manager.ts:82-99` — `PATH=${SHIM_DIR}:…`, `DUO_SESSION='1'`, `DUO_SOCKET`, `DUO_TAB=id`, `DUO_WINDOW`, `DUO_VERSION`, `TERM_PROGRAM='Duo'`. Env stamps agent-neutral (work); shim interception Claude-only (no-op elsewhere).
- **C2** attention hook reads `$DUO_TAB` (see Cluster 2 §D). Claude-exclusive trigger.
- **C3** priming shim (see Cluster 2 §E).

### D. Cron (ENH-223/237)

- **D1** `shared/types.ts:742-799` — `CronJobKind = 'claude' | 'shell'`; legacy jobs without `kind` load as `'claude'` (:795); claude arm carries `instruction`/`session`/`lastSessionId`. `core/cron-store.ts:30-64` coercion. Breaks for other agents; shell arm is the only escape hatch.
- **D2** `core/cron-command.ts:10-15,59-73` — fresh: `claude --session-id <uuid> '<instruction>'`; resume: `claude --resume <uuid> '<instruction>'`. `:112-159` `assertInteractiveCommand` / `HEADLESS_TOKENS = {-p, --print, --bare}`, `HEADLESS_PREFIXES=['--output-format']` — **the headless denylist encodes Claude's exact flag names** (a different agent's headless flag wouldn't be caught).
- **D3** `electron/main.ts:1912-1915` `sessionExists` → JSONL path probe; `core/cron-service.ts:200-219` resume-or-fresh → silent `fresh-fallback` for any non-Claude agent (session continuity lost, labeled "ran · fresh").
- **D4** `core/cron-service.ts:103-113,186-231`; `cron-command.ts:27-34` `mintSessionId` — assumes Claude accepts a pre-minted `--session-id`.
- **D5** `electron/main.ts:1901-1937` — runner spawns `kind:'shell'` tab typing the full `claude …\n` command; catch-up `core/cron-service.ts:137-160` re-runs the same builder.
- **D6** `core/cron-store.ts:17` — store at `~/.claude/duo/cron-jobs.json` (works; path coupling only).
- **D7** UI copy: `CronJobRow.tsx:96` "Schedule a Claude session for this project"; `NewCronJobModal.tsx:311-317` headless note, `:373` "What should Claude do?", `:474-488` Fresh/Same control; `CronJobRow.tsx:42-43` `fresh-fallback` label.
- **D8** `cli/duo.ts:436-441, 2729-2816` — `cron add --say` (claude) vs `--run` (shell), mutually exclusive; `core/cron-service.ts:437-481` `addFromArgs`.
- **D9** `electron/main.ts:1910` `headlessAllowed: FEATURE_HEADLESS_CRON`.

### E. `duo send` / resume writes

- **E1** `cli/duo.ts:418-421, 2005-2026` — `duo send` writes raw PTY bytes; agent-neutral (works). Only submit-semantics vary by REPL.
- **E2** `renderer/components/TerminalPane.tsx:184-186`; `electron/main.ts:1645, 5714, 5759-5760`; `electron/claude-session-tracker.ts:41-44`; `shared/types.ts:17-18,289-294,1732-1892` — the `claude --resume` write paths.

### F. Storage-dir coupling

- `core/cron-store.ts:17`, `core/resolve-claude.ts:50`, `install-service.ts:101,146,1012`; `shared/types.ts` ~30 refs to `~/.claude/duo/*` (cron-jobs 722, packs 227/372/403/461/467, nav-pins 646/2304, projects 691, session-state 834/2315, external-domains 117/1626, pins 2300, vault 2293, checkouts 1968, file-history 102, session-digests 1820). Project-marker detection keys on `CLAUDE.md`/`.claude/` (`types.ts:666,682,2661-2664`; `FileTree.tsx:1132`).
- **Duo's entire private storage tree lives inside Claude Code's config dir.** Agent-neutral code, structurally Claude-branded location. Highest-leverage single decoupling point if ever moved (but high churn).

### Agent-agnostic escape hatches that already exist

Cron `kind:'shell'` (`--run`), PtyManager shell spawn (any agent typed manually), `duo send` raw bytes.

---

## Cluster 4 — `duo` CLI, doctor, Skills panel, shipped skill/agent artifacts

Tree-wide negative results: grep for `~/.codex`, `~/.gemini`, `.aider`, `.agents/skills`, `agent-skills.dev` → **zero hits**. The only `AGENTS.md` references are explicit exclusions. Every artifact ships to `~/.claude/…`.

### 1. `duo doctor` (cli/duo.ts:3810-3966)

- **1a** :3880-3882 — transport diagnostic prints "Claude Code sandbox detected (Unix socket blocked)" + tells user to edit `.claude/settings.local.json` `allowUnixSockets`. Misleads a non-Claude user who hit TCP for another reason.
- **1b** :3921-3925 — red-flags (✗) missing `~/.claude/skills/duo/SKILL.md` + `~/.claude/agents/duo.md` unconditionally. **The one true doctor false-red** under a different agent.
- **1c** :3902-3911 — `knownInstallTargets` = `~/.claude/duo/bin/duo`, `~/.claude/bin/duo`, `~/.local/bin/duo`, `/usr/local/bin`. Claude-centric framing, not misleading.
- **1d** — doctor does NOT check for the `claude` binary, hooks, or settings.json (no false-red there).
- Header comment :3810-3817 frames the verb around "a sandboxed Claude Code session".

### 2. Verbs / help text naming Claude

- **2a/2b** :450-459, 1397-1430 — `claude-return` / `shift-return` verbs; help says "Claude reads ESC+CR".
- **2c** :413-415, 2184-2193 — `new-tab [--shell|--claude]`; no `--codex`/`--gemini`/generic `--agent <cmd>` flag exists.
- **2d** :443-447, 2821-2833 — `attention` (manual use agent-neutral; automatic trigger Claude-only).
- **2e/2f** :485-487; main.ts:1645 — `session list|resume|open|digest|note|next` — whole family reads Claude's JSONL store / spawns `claude --resume`.
- **2g** :481, 433, 487 — close-guards keyed on live-Claude presence.
- **2h** :440 — `cron add --say` = Claude session.
- **2i** :538 — `link --system` "not recommended for Claude Code use."
- **2j** :3591, 582 — `rollup doctor` repair guidance names "Fix with Claude".
- Header cli/duo.ts:4: CLI "Called by Claude Code like any shell command."

### 3. Presence/binary (cross-ref Cluster 1) — `treeHasClaude` :178-198; `resolveClaudeBinary`; `main.ts:3540-3546 terminal:claude-on-path` (gates install banner); `main.ts:4817-4838` Home unattributed-live cards.

### 4. Project detection + the "Skills panel"

- **4a** `core/projects-service.ts:98-114` `hasMarker` — project = git root OR `CLAUDE.md`/`.claude/`; **:103 explicitly states `tasks.md`/`AGENTS.md` deliberately do NOT qualify** (code-frozen decision). A Codex/aider project marked only by AGENTS.md (no git) doesn't appear in the project rail.
- **4b** `renderer/components/claudeContextPath.ts:28-36` — context wash narrowed to `./CLAUDE.md` + `./.claude/` (comment :9 notes the old broader `CANDIDATE_NAMES` incl. AGENTS.md was deliberately narrowed).
- **4c** `shared/projects.ts:26-63` — `~/.claude/` special-case.
- **4d** `renderer/hooks/useUserClaudeNavigator.ts:165`, `UserClaudePane.tsx:6,119` — the only "skills panel" = home-scoped `~/.claude` curated navigator (`['CLAUDE.md','skills','agents','duo']`). **No `~/.agents/skills` / `.agents/` / other-agent dir support anywhere.**

### 5. Shipped deliverables + install destinations

- **5a** `package.json:23` `sync:claude` — all destinations `~/.claude/…`.
- **5b** `install-service.ts:72-105` — constants table (see Cluster 2 §A).
- **5c** :255 — managed CLAUDE.md block points Claude at the skill/subagent.
- **5d** `agents/duo.md:1-15` — `model: haiku`, `tools: Bash` frontmatter = Claude Code subagent schema.
- **5e** `skill/SKILL.md:1-4` — SKILL.md frontmatter + progressive-disclosure router. **The format is now the open agent-skills standard** — Codex/Gemini/aider could read it if installed to their skills dir; content is agent-neutral (drives `duo` CLI). Only the destination is Claude-only.
- **5f** `scripts/check-skill-currency.mjs:671-722` (+ :564, :572) — A6 SYNC asserts the `sync:claude` chain; hardcodes `~/.claude` paths.
- **5g** `scripts/postinstall.ts:2`.
- **5h** `distro-pack-service.ts:21-41, 356-376` — distro skills/agents/CLAUDE.md all target `~/.claude`; `.user-modified` preservation dir too.

### 6. Hooks (cross-ref Cluster 2). 7. Served docs

- **7a** `packs/duo-default/canvases/what-duo-does.html` — **126 "claude" hits**; shipped + served; frames the CLI as "what you ask Claude to use". Highest-value single rename target.
- **7b** `docs/legacy/faq.html` — 117 hits but **RETIRED** (`install-service.ts:1531` maps it to null; `browser-manager.ts:28-29,539` ENH-135). NOT shipped — skip. (Note: one audit initially flagged it as the boot-default tab; the retirement mapping is the controlling fact.)
- **7c** `docs/roadmap.html` — 119 hits, repo-only.
- **7d** `skill/references/enterprise-deployments.md` — titled "managed Claude Code installs"; the "hook-free floor" argument (:102-119, :177-201) rests entirely on the Claude-only CLAUDE.md loader; zero mention of non-Claude agents.
- **7e** `skill/references/sandbox-troubleshooting.md`, `install-troubleshooting.md`, `help/canvas-actions-demo.html` (13), `rollup-guide.html` / `vault-guide.html` (17 each).

---

## Cluster 5 — Distro packs, pack-service, first-launch install, storage locations

Two distinct "pack" systems: **distro packs** (external Claude-Code-plugin-shaped folders, `~/.claude/duo/extra-packs/`, `.claude-plugin/plugin.json` + `duo-extras/DISTRO.json`, owned by `electron/distro-pack-service.ts`) vs **Duo/lesson packs** (bundled canvas+lesson bundles, `~/.claude/duo/packs/`, `PACK.json`, owned by `core/pack-loader.ts` + install-service).

### A. Distro-pack pipeline

- **A1** install-root scan `distro-pack-service.ts:43` `EXTRA_PACKS_DIR`; `:123-135` `discoverPacks()`; boot `main.ts:3331 → 5237-5273`. Works mechanically; exists to feed Claude dirs.
- **A2** skills → `~/.claude/skills/<distro>-<name>/` (:39, :356-363; discovery requires SKILL.md :234-255). No-ops/pollutes for other agents.
- **A3** agents → `~/.claude/agents/<distro>-<name>.md` (:40, :365-374; listing :260-271). No-ops/pollutes.
- **A4** CLAUDE.md managed block (:41, :416-495; orchestrated `main.ts:5256-5265`) — org guidance silently absent for non-Claude users AND pollutes `~/.claude/CLAUDE.md` for a Claude they may not run.
- **A5** manifest requires `.claude-plugin/plugin.json` (:145) + `duo-extras/DISTRO.json` (:146); name regex :156. Template `$schema: https://code.claude.com/schemas/plugin.json`. **No marketplace / `claude plugin install` — Duo does its own decomposition** (:6-11): format-coupled, mechanism-independent. Renameable.
- **A6** provenance `.installed-files.json` (:320, :385-393); atomic replace (:331-350); `uninstallPack` (:530-623, strips CLAUDE.md :583-596); `listInstalledPacks` (:631-643) → `duo pack list` (`cli/duo.ts:2327-2344`). Mechanically agent-neutral.
- **A7** `requiresDuoVersion` gate (:56-59, :181-226) — agent-agnostic.
- **A8** deferred routing (:28-31): lesson-pack + canvas legs to `~/.claude/duo/{packs,distros}` (Duo-internal, neutral). Deferred: distro `hooks/`, `.mcp.json`, `.lsp.json` (:27-28) — v1 never merges settings.json for distros.

### B. Pack-builder authoring surfaces

- **B1** `skill/pack-builder/SKILL.md` — teaches "a Claude Code plugin folder" (:3, :12-18, :26-27); SKILL.md "per Claude Code plugin spec" (:38, :94, :139); agent format (:97-98); `<distro>-<skill>` ≤64 chars "(Claude Code spec)" (:59-60). `distro-pack-builder/{README,CLAUDE,playground,.claude/skills/pack-builder-workshop}`. Never mentions other agents.
- **B2** distribution paths (:158-233): zip → `~/.claude/duo/extra-packs/`; `.pkg` postinstall (scripts/build-pkg.sh) → same; future `bundled-distros/`.

### C. First-launch install (cross-ref Cluster 2 for hooks detail)

- C1 skill → `~/.claude/skills/duo/` (`constants.ts:18-19`; header :4).
- C2 subagent → `~/.claude/agents/duo.md` (:74; header :5).
- C3 managed CLAUDE.md (ENH-088) — "the load-bearing path… always works in any Claude Code install" (`enterprise-deployments.md:38-42`) — **the single biggest coupling: the universal fallback is Claude-only.**
- C4 PATH shim (header :18-25; `resolve-claude.ts:5,50,71,161`).
- C5 priming.md (:101; header :16-17).
- C6 SessionStart hook (:103, :133-146, :385-417, :705-729).
- C7 PreToolUse guard (:107-118, :731-747).
- C8 attention hooks (:120-131, :749-762).
- C9 CLI binary → `~/.local/bin/duo` + `~/.claude/duo/bin/duo` (:88-100) — agent-neutral binary; second copy placed for the SHIM_DIR PATH-prepend (Claude-sandbox rationale :84-100).
- C10 lesson packs → `~/.claude/duo/packs/` (:78-80, :614-641; fork opt-out `__DUO_PACKS_DISABLED__` :624-641; loader `core/pack-loader.ts:180-215`). Agent-neutral storage.
- C11 `renderer/components/FirstLaunchBanner.tsx:1-86` — consent banner; copy assumes Claude; surfaces `priming.hookConflict`. **Reports install success even though nothing will consume the artifacts for a non-Claude user.**

### D. `~/.claude/duo/` full storage enumeration

Two roots: `~/Library/Application Support/duo/` (`constants.ts:9`) = socket `duo.sock` (:10), `duo.port` (:16), `browser-session/` (:44) — conventional + agent-neutral; **everything else** under `~/.claude/duo/`:

bin/claude + bin/duo (shim: Claude-coupled) · priming.md (content Claude-voiced) · hooks/*.sh (Claude-coupled) · packs/ · extra-packs/ · distros/ · installed.json · installed-packs.json · cron-jobs.json (`cron-store.ts:3,17`) · file-history/ (`file-history-service.ts:21,73`) · checkouts/ (`open-checkout.ts:4,33`) · projects.json (`projects-service.ts:5,19`) · pins.json · nav-pins.json · session-state.json (`session-state-service.ts:3,71`) · session-digests.json (`session-digest-store.ts:15`) · settings.json (Duo's own — distinct from CC's `~/.claude/settings.json`; `settings-service.ts:2,56`) · external-domains.json · browser-history.json · open-recents.json · workspace-history · active-workspace.json · home-state.json (`home-state-store.ts:18`) · update-check.json · help/*.html · logs/install-shim.log.

**Of ~26 items, only bin/ + hooks/ (4 files) are functionally Claude-coupled; the rest are agent-neutral state under a Claude-branded parent.** The Library-vs-.claude split is inconsistent, not principled (`constants.ts:26-28` rationale: keep user-facing Duo state in one place).

### E. Lesson packs (Stage 28)

`packs/intro-to-duo/lesson-skill/SKILL.md` + `examples/lesson-pack-template/` — copied to `~/.claude/duo/packs/<name>/lesson-skill/` (`install-service.ts:614-641, 1954-1972`). **NOT auto-discovered** (not in `~/.claude/skills/`) — read on demand because a Duo canvas `data-cmd` tells the running Claude tab to walk it. The lesson narrative ("Duo spawned a fresh Claude tab") is Claude-scripted; experience breaks for other agents even though files copy fine.

### F. Enterprise doc

`skill/references/enterprise-deployments.md` — mechanism map (:25-47), hooks-disabled analysis (:102-119), Bash allowlist `Bash(duo:*)` (:121-138), locked `~/.claude/` (:141-154), CLAUDE.md authority (:157-173), hook-free floor (:177-201). Every fallback rung is a Claude mechanism; the floor does not exist for non-Claude agents.

### Cluster-5 cross-cutting conclusions

1. Both skill-delivery mechanisms are Claude-only in the auto-discover leg.
2. Priming has two legs (shim + SessionStart hook), both Claude-coupled; no agent-neutral priming path exists.
3. **The universal fallback ("CLAUDE.md reaches every session") is the deepest coupling.**
4. Manifest borrows plugin.json format, not runtime — easily neutralized.
5. Storage root is a namespacing coupling only.
6. Lesson-skills depend on a Duo-spawned Claude tab following a script.

---

## Cluster 6 — Renderer UI, user-facing copy, vault/graphbook, shipped docs

### Group 1 — FUNCTIONAL (rename alone doesn't fix)

1.1 Agent tab = typing `claude\n` (`shared/types.ts:4-7`; `App.tsx:1927, 130-131, 1915`; `resolve-claude.ts`) — surfaces: TabBar split button (`TabBar.tsx:17,192`), ⌘T (`App.tsx:4085`), FileTree hover (`FileTree.tsx:1801`), canvas `claude:spawn` (`App.tsx:2462`), cron, rollup repair.
1.2 Presence probe consumers — `ClaudePresenceDot` (titlebar), Send pill gate (`App.tsx:5298`), `SessionHeader.tsx:81,89`, attention dot, `HomeView` liveness.
1.3 Resume — `SessionHeader.tsx:164, 9-14, 67-70`; `HomeView.tsx:12-17,161`; `shared/types.ts:845-852` `lastClaudeSession`.
1.4 Cron (`shared/types.ts:745,769-796`; modal copy).
1.5 Worktree creation — `FileTree.tsx:1174,1198,1265,1287` — creates branch **`claude/<slug>`** under `<repo>/.claude/worktrees/<slug>` (`shared/host-api.ts:1680,1806-1807`; `shared/worktree-slug.ts`) — the branch prefix is functional, not just copy.
1.6 Enter-key semantics — `shared/types.ts:1565-1581`; menu "⌘Return for Claude submit" (`electron/main.ts:3913`); `\r` vs `\x1b\r` tuned to Claude's TUI.
1.7 Claude-context wash — `claudeContextPath.ts:29-38`; `.bg-claude-context` (`globals.css:22-32`); `projectColors.ts:13-15` reserves a hue band; `FileTree.tsx:2015` special-case. Wrong files highlighted for other agents.
1.8 Install/priming pipeline — `install-service.ts:255` block text: "a desktop app pairing **Claude Code** terminals…".
1.9 Vault/rollup repair — `RollupsView.tsx:743` "Fix with Claude", `:823` "Normalize with Claude"; `VaultView.tsx:170` "Start a Claude authoring session…"; prompts `App.tsx:2740-2801`.
1.10 Project-close confirm — `App.tsx:1408-1414` "…has a Claude terminal…"; flag `types.ts:714`.

### Group 2 — COSMETIC (rename suffices)

| # | file:line | current | suggested |
|---|---|---|---|
| 2.1 | TabBar.tsx:102 | "New Claude session (⌘T…)" | "New agent session" |
| 2.2 | TabBar.tsx:478-498, 516; App.tsx:226 | ClaudeIcon/ClawdGlyph; title prefix `claude · ` | neutral glyph; `agent · ` |
| 2.3 | TabBar.tsx:398-399 | "Waiting on you — Claude needs your input" | "…the agent needs your input" |
| 2.4 | ClaudePresenceDot.tsx:28-30 | "Claude active in the front terminal" | "Agent active…" |
| 2.5 | WriteWarningBanner.tsx:44,61 | `agent` prop defaults "Claude"; **neither host passes it** (PageTab.tsx:1795, MarkdownEditor.tsx:2601) | change default / wire prop |
| 2.6 | UserClaudePane.tsx:14,71,90-95,118-119 | "Your Claude settings" | "Your agent settings" |
| 2.7 | FileTree.tsx:1804-1805 | "New Claude tab in {name}" | "New agent tab…" |
| 2.8 | FileTree.tsx:1287 | "Start a Claude session here" | "Start an agent session here" |
| 2.9 | FirstLaunchBanner.tsx:143 | "Claude inside Duo's terminals will arrive Duo-aware" | "Your agent…" |
| 2.10 | FirstLaunchBanner.tsx:166,209 | "Couldn't find Claude Code on this Mac" | keep for the Claude install path |
| 2.11 | HomeView.tsx:256-257 | "…another terminal or the Claude desktop app…" | generic |
| 2.12 | RollupsView.tsx:740 | "…let Claude repair it." | "…let the agent repair it" |
| 2.13 | VaultView.tsx:256,263 | "…a Claude authoring session" | "…an agent authoring session" |
| 2.14 | electron/main.ts:3913 | menu "⌘Return for Claude submit" | "⌘Return to submit" |
| 2.15 | App.tsx:5305 | "Send → agent" — **already neutral** ✅ | (reference model) |
| 2.16 | SendToDuoPill.tsx:40-44,71 | "Send → agent" w/ comment "(Claude / Codex / etc)" ✅ | (reference model) |

### Group 3 — Vault/graphbook

**Engine agent-neutral ✅** — `core/vault/**` has zero `claude` refs except `~/.claude/duo/…` storage paths; `skill/references/vault.md` has one hit (:7, a path). Shipped guides hard-code Claude as the agent name (cosmetic, installed to `~/.claude/skills/duo/references/`): `vault-guide.html` 17 hits (CLAUDE legend role :143, `.who.claude` :53; steps :186,334,444,494,545,547; prose :399,490,509,505); `rollup-guide.html` 17 hits (ch. 8 :108,332; :177,336,344,386,396); `rollup.md` 8 hits (:37-38, :118,135,143, :187,204,207).

### Group 4 — Shipped canvases

- `packs/duo-default/canvases/what-duo-does.html` — SHIPPED, 126 hits, ":88 frames the CLI as what you ask Claude to use"; dozens of "When Claude is working with you…" (:166,229,358,368,384).
- `packs/intro-to-duo/canvases/welcome.html` — SHIPPED FTUX, 12 hits; Start-lesson spawns a Claude tab.
- `claude-code-basics` pack — an onboarding curriculum content-coupled to Claude (not just naming).
- `docs/legacy/faq.html` — RETIRED (not shipped).
- `skill/SKILL.md` — 10 hits, agent-facing; Claude-naming arguably correct here.

### Group 5 — IPC/type identifiers containing "claude" (refactor surface)

`shared/types.ts`: `TerminalTabKind='claude'` (:7), `lastClaudeSession` (:19,852), `hasClaudeKindTerminal` (:714), `CronJobKind`/`CronClaudeJob` (:745,772), `ClaudeReturnMode`/`ClaudeKeyPrefsSnapshot` (:1577,1580), `CLAUDE_KEY_PREFS_*` (:2495-2496), `TERMINAL_CLAUDE_PRESENCE_CHANGED` (:2516), `CLAUDE_READ_SELECTION` (:2559). `shared/host-api.ts`: `ClaudePresenceState` (:669), `claudeOnPath` (:656), `onClaudePresenceChange` (:665), `onClaudeReadSelection` (:483), `ElectronClaudeKeyPrefsAPI`/`claudeKeyPrefs` (:591,1089), `realClaudePath` (:861). `shared/playground-actions.ts`: **`'claude:spawn'`** (:31,69) — leaks into user-authored canvas HTML.

Electron native chrome: only one user-visible Claude string — the Settings menu item (main.ts:3913). No tray; notification bodies are generic.

---

## Cross-agent integration surfaces (from ENH-189, re-affirmed; re-verify at implementation time)

| Capability | Claude Code | Codex CLI | Gemini CLI | aider |
|---|---|---|---|---|
| Global memory file | `~/.claude/CLAUDE.md` | `~/.codex/AGENTS.md` (+ project `AGENTS.md`) | `~/.gemini/GEMINI.md` (+ project) | `CONVENTIONS.md` |
| Skills | `~/.claude/skills/` + open `~/.agents/skills/` | `~/.agents/skills/` (open agent-skills standard) | `~/.agents/skills/` | `~/.agents/skills/` (partial) |
| Per-session system-prompt flag | `--append-system-prompt` | **none** (openai/codex#11588 closed-unmerged) | `--system-prompt` / `GEMINI_SYSTEM_MD` | conventions file |
| Lifecycle hooks | settings.json hooks (SessionStart/PreToolUse/Stop/Notification/UserPromptSubmit) | `notify` program on `agent-turn-complete` (carries thread-id; openai/codex#4005) | limited | none |
| Session store | `~/.claude/projects/<enc>/*.jsonl` (private) | `~/.codex/sessions/Y/M/D/rollout-*.jsonl` (private; enumeration gap openai/codex#8923) | `~/.gemini/tmp/<hash>/` | `.aider.chat.history.md` |
| Resume | `claude --resume <uuid>` / `--fork-session` / `--session-id` | `codex resume <id>` / `--last` | limited | n/a (in-repo history) |
| Headless | `-p` / `--print` / `--output-format` | `codex exec` (+ `--json`) | `-p` | `--message` |
| Subagents | `~/.claude/agents/*.md` | none | none | none |
