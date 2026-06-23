<!-- MAINTAINER NOTE (stripped from model context — HTML comments don't load):
     This file is the ALWAYS-ON index. Keep it slim — a CLAUDE.md that grows
     too long gets ignored. Situational/procedural detail lives in two places:
       • Path-scoped rules in `.claude/rules/*.md` (load only when matching
         files are read/edited): cli-plumbing.md, ui-verification.md,
         renderer-surfaces.md, vault.md.
       • Load-on-demand docs linked under § Where to look.
     Before adding anything here, ask: is it always relevant? If it only
     matters when touching certain files, it belongs in a path-scoped rule.
     War-story rationale belongs in session-log.md / memory files, not here. -->

# Duo — CLAUDE.md

> Project context for Claude instances. Slim by design. Most domain detail
> lives in the load-on-demand docs and path-scoped rules linked below.

## What this project is

A macOS desktop app ("Duo") pairing multiple Claude Code terminal sessions
with an embedded Chrome browser, connected by a local CLI bridge (`duo`) so
Claude Code can read and drive the browser as naturally as it runs shell
commands. Owner: Geoff.

## Audience — no company-specific references

Duo is a personal, open-source project for both individual users and
enterprise teams. **Do not write company-specific references into the
codebase, docs, or commit messages** — no employer names, internal
project/program/cohort codenames, or anything tying Duo to a specific
organization. Use generic descriptors (e.g. "early-adopter cohort"). The only
exceptions: references to Claude / Anthropic, and domain names that appear in
the browser blocklist.

## Architecture in one paragraph

One Electron main process owns everything: one or more `BrowserWindow`s (the
`WindowRegistry` tracks them, each wrapped in a `WindowContext` that owns that
window's `BrowserManager` / `CdpBridge` / navigator / terminals / geometry),
the `PtyManager` (node-pty pool), and the `SocketServer` (Unix socket
listener). The renderer process hosts React — xterm.js terminals, the browser
pane, the markdown editor, and the HTML canvas — talking to main via
contextBridge IPC. The `duo` CLI (standalone Node.js script) connects over the
Unix socket to drive both the browser and the renderer surfaces from inside
any terminal tab; each terminal carries a `DUO_WINDOW` env stamp so
`duo --window N <verb>` can address a specific window (default resolution is
the lowest-id "primary" window, by identity — never focus).

## Where to look (load-on-demand docs)

- **`docs/roadmap.html`** — canonical roadmap, single source of truth (status,
  layered build order, per-stage cards). Served at
  `http://localhost:8765/roadmap.html`. Edit this for any roadmap change.
  Historical fragments: [`docs/dev/roadmap-history.md`](docs/dev/roadmap-history.md).
- **`docs/DECISIONS.md`** — locked architectural decisions + open ADRs (notably
  the sandbox-tolerant-transport ADR and the editor/canvas-convergence lock).
- **`docs/CLI-COVERAGE.md`** — authoritative CLI verb inventory + gap roadmap.
- **`docs/prd/`** — per-stage PRDs with D-numbered decisions.
- **`docs/dev/RESUME.md`** — cold-start orientation. **Read FIRST after any
  compaction** or when picking up an in-flight initiative.
- **`docs/dev/active-sprint.md`** — running sprint scratchpad: current status,
  carry-forward queue, open owner-decision questions.
- **`docs/dev/session-log.md`** — session-by-session log of what shipped, why,
  and what's owed (most recent on top). The home for historical detail — do
  NOT re-paste it into this file.
- **`docs/dev/smoke-checklist.md`** — test matrix walked before any UI change
  is called done.
- **`idle-thoughts.md`** — Geoff's idea/bug inbox. **Notion is canonical**
  ([Duo Idle Thoughts](https://www.notion.so/Duo-Idle-Thoughts-34d45f48854f8032ba68fae6dc0473fe));
  the local file is a **gitignored read-only mirror** — never edit it directly.
  To process: fetch canonical via `mcp__…__notion-fetch` (rewriting the local
  mirror to match — preserve the YAML frontmatter block), file each Unprocessed
  bullet into `tasks.md`, then strike + move it to `# Processed` in Notion with
  an `**Action <date>:**` note, and re-fetch to re-sync.
- **`.claude/skills/worksheet/`** — schema-driven primitive for interactive
  HTML pages (per-item radios + notes + Copy/Send). Reach for it instead of
  hand-building long "which of these…" bullet lists. Consumers: `smoke-walk`,
  `sprint-plan`.
- **`skill/references/vocabulary.md`** — canonical user-facing vocabulary
  (page / playground / lesson / canvas / start-tab hierarchy).
- **`docs/design/atelier/`** — visual source-of-truth (read its README before
  UI work). Atelier CSS kernel + class library:
  [`skill/references/atelier-css.md`](skill/references/atelier-css.md).
- **`docs/VISION.md`** — product north star.
- **The vault / "graphbook" (ENH-208 · ENH-216)** — Duo's typed work-notes
  knowledge graph (product name **graphbook**; internal/CLI name **vault**).
  Core in `core/vault/**`; CLI verbs `duo vault` / `graph` / `base`. Start
  with [`skill/references/vault.md`](skill/references/vault.md) (agent ops +
  the rollup authoring loop), then
  [`skill/references/vault-guide.html`](skill/references/vault-guide.html)
  (the human walkthrough — ships with the skill so installed users get it;
  `duo open` it), `docs/prd/enh-208-vault.md` (the PRD), and
  `docs/research/graphbook-intent.html` (the product intent). **The typing
  key is `type:` (not `class:`); rollups are `.base` views in Obsidian mode
  vs static listings via `duo vault publish` in OKF mode.**
- **`distro-pack-builder/`** — repo-only workshop for first-time distro-pack
  builders (does NOT ship to end users).
- **`docs/research/duo-as-chrome-extension/`** — Chrome-extension exploration
  (Stages A–H, on branch `duo-chrome-extension-exploration`). Non-gating. Read
  `distribution-strategy.md` before any Phase 7+ work.

## Path-scoped rules (load automatically when matching files are touched)

- **`.claude/rules/cli-plumbing.md`** — the CLI is the spec; UI/CLI parity; the
  visibility cluster; new-CLI-verb + new-page-op checklists; the sandbox
  gotcha. Loads for `cli/**`, `shared/types.ts`, `electron/socket-server.ts`,
  `agents/duo.md`, `skill/SKILL.md`, `docs/CLI-COVERAGE.md`.
- **`.claude/rules/ui-verification.md`** — request Electron access at session
  start; restart Duo yourself; verify clean state before smoke-walk handoff;
  always run `/smoke-walk` via the Skill tool; never rewrite an open fixture.
  Loads for `renderer/**`, `electron/main.ts`, `electron/preload.ts`, `**/*.css`.
- **`.claude/rules/renderer-surfaces.md`** — editor/canvas parity rule; new
  WorkingPane tab-type checklist + global-keystroke-escape patterns. Loads for
  `renderer/components/**`.
- **`.claude/rules/vault.md`** — the graphbook/vault model (one graph, two
  serializers: OKF vs Obsidian); `type:` not `class:`; rollups = `.base`
  (Obsidian) vs static listings (OKF); the corpus-is-the-schema / no-sidecar
  invariant. Loads for `core/vault/**`, `core/markdown/vaultLinks.ts`,
  `skill/references/vault.md`.

## Glossary — internal-name mapping for contributors

User-facing vocabulary lives in
[`skill/references/vocabulary.md`](skill/references/vocabulary.md). This table
is the contributor-facing map from those terms to the codebase.

| User says | Internal name |
|---|---|
| **the canvas** (the slot) | `WorkingPane` / `activeWorking` |
| **canvas mode** (HTML in canvas iframe — editable, scripts blocked) | `WorkingTab` with `kind: 'page'` (`PageTab` in `renderer/components/Page/`) |
| **browser mode** (HTML in browser pane — scripts run, buttons fire) | `WorkingTab` with `kind: 'browser'` (rendered via `BrowserManager` WebContentsView) |
| **a tab** | `WorkingTab` (kinds: `editor`, `page`, `browser`, `image`, `pdf`, `json`, …) |
| **JSON / YAML viewer-editor** | `WorkingTab` with `kind: 'json'` (`JsonView` in `renderer/components/Json/`); format implicit from extension via `formatFromPath()` |
| **a page** | HTML in canvas mode — source-editable, scripts blocked. Reached via `duo edit <html>` |
| **a playground** | HTML in browser mode — scripts run, buttons fire. Reached via `duo open <html>` (runtime: `playgroundActions.ts`) |
| **a lesson** | Stage 28 lesson pack at `packs/<name>/{canvases/, lesson-skill/}` |
| **the navigator** | `FileTree` / `useNavigator` |
| **the terminal** | `TerminalPane` / `tabs[]` |
| **a terminal tab** | `TabSession` |
| **a window** (top-level app window — own workspace/browser/navigator/terminals) | `WindowContext`, tracked in the `WindowRegistry` |
| **the primary window** (default CLI/app-resolution target) | lowest-id `WindowContext` (resolved by identity, never focus) |
| **this terminal's window id** | `DUO_WINDOW` env stamp on every Duo terminal; addressable via `duo --window N` |
| **this terminal's tab id** | `DUO_TAB` env stamp on every Duo PTY (companion to `DUO_WINDOW`); how the attention hook names its tab |
| **a scheduled (cron) job** | `CronJob` / `CronService` (`core/cron-*.ts`); store `~/.claude/duo/cron-jobs.json`; UI `renderer/components/Home/CronSection.tsx` |
| **the attention badge** ("waiting on you" tab dot) | a transient per-tab `needsAttention` flag; set via `duo attention` (Duo-managed Claude Stop hook), keyed on `DUO_TAB` |
| **file version history** | `FileHistoryService` (`core/file-history-service.ts`); `HistoryModal` (`renderer/components/editor/`); `duo history` |
| **the graphbook** (the product name) | **the vault** — `core/vault/**`; CLI `duo vault` / `graph` / `base`. Same thing; "graphbook" is user-facing, "vault" is internal. |
| **a note's type / "class"** | the **`type:`** YAML frontmatter key (`core/vault/corpus.ts`). There is no `class:` field — "class:task" means `type: task`. |
| **a rollup / rollup view** | a saved query over note frontmatter. **Obsidian mode:** a live **`.base`** file (`duo base render`). **OKF mode:** static `index.md`/`log.md` listings (`duo vault publish`) — no `.base` files. |

**Modality is verb-driven (ENH-156, 2026-05-16).** The same HTML file flips
surface by verb: `duo open <path>` → **browser mode** (`kind: 'browser'`,
interactive — the default for "show me the thing"); `duo edit <path>` →
**canvas mode** (`kind: 'page'`, source-editable, scripts blocked — the default
for "modify the source"). Overrides: `duo open --canvas`, `duo edit --browser`,
or right-click a `file://` browser tab → "Edit in canvas". Legacy
`<meta name="duo-open-in">` declarations are no longer consulted (harmless).
The "canvas" terminology lock and the page/playground history live in
`docs/DECISIONS.md`.

## Build commands

```bash
npm install          # installs deps + rebuilds node-pty for Electron
npm run dev          # launch app in dev mode (HMR) — runs predev check first
npm run build        # production build → out/
npm run typecheck    # TypeScript type checking (no emit)
npm run dist         # build + package as macOS DMG → dist/
npm run build:cli    # rebuild cli/duo from cli/duo.ts (commit the binary)
npm run sync:claude  # copy skill/ + agents/ into ~/.claude/ (dev-only)

npm run check:materialization   # warn if any files are dataless / cloud-evicted
npm run materialize             # force-download evicted files + git-restore stuck
```

**iCloud Drive trap (macOS Optimize Storage).** If `~/Documents` is in iCloud
Drive with "Optimize Mac Storage" ON, macOS can evict tracked file bytes to
cloud-only (the `dataless` flag) under disk pressure. Symptoms: `git status` →
`short read while indexing`; `npm run dev`/vitest → `Unexpected end of JSON
input`; `git rev-parse HEAD` → `fatal: ambiguous argument 'HEAD'`. The
`predev`/`pretest` hooks warn once via `scripts/check-materialization.sh`;
recovery is `npm run materialize`. (Fired once Sprint 22 with 13k+ dataless
files including `.git/refs/heads/main`.) **Second variant — sync-conflict
duplicates:** iCloud can also drop a *copy* named `<file> 2.ts` (space +
digit) next to the real file. These are **untracked**, but `tsconfig`'s
`core/**`/`renderer/**` globs pick them up → spurious `TS6307` typecheck
errors on files you never touched (155 of them blocked the v0.11.1 cut). `npm
run materialize` does NOT clean these — the same `predev`/`pretest` check now
warns about them, and `bash scripts/materialize.sh --dedup` (or
`check-materialization.sh --fix`) moves them to `$TMPDIR`.

---

## Working style — Claude instances must follow these

These are the always-on *principles*. Mechanical detail lives in the
path-scoped rules under `.claude/rules/` (see above).

1. **Ask before deciding.** Use `AskUserQuestion` whenever there's a meaningful
   choice (layout, UX, approach, prioritization). Don't silently pick. Batch
   related questions (up to 4 per call).
2. **Don't re-debate the stack.** Electron, xterm.js, WebContentsView, Unix
   socket CLI — all locked. See `docs/DECISIONS.md`.
3. **The CLI is the spec.** Every new CLI verb stays in sync across
   `cli/duo.ts`, `skill/SKILL.md`, `agents/duo.md`, and `docs/CLI-COVERAGE.md`.
   `npm run check:skill-currency` enforces this 4-surface sync (warn in
   predev/pretest; strict in cut-version). Full plumbing checklists:
   `.claude/rules/cli-plumbing.md`.
   - **3a. Visibility cluster** — when debugging Duo blind, reach for
     `duo dom` / `duo devtools` / `duo layout` / `duo nav state` BEFORE building
     bespoke instrumentation (detail in `.claude/rules/cli-plumbing.md`).
4. **CLI parity with UI.** If the human can do it (click, menu, keystroke,
   toggle), the agent must be able to do the same from the CLI — UI-only
   features silently break Duo's pair-work premise. Call out deliberate
   asymmetries in the PRD. (Detail + checklists: `.claude/rules/cli-plumbing.md`.)
   - **4a. Edit open files THROUGH Duo, never around it.** Before `Edit`/`Write`
     on any file that might be open in Duo, run `duo status` and prefer the
     matching `duo` verb (`doc edit` / `doc write` · `html *` · `json set` /
     `merge`; `doc insert`/`substitute`/`highlight` emit CriticMarkup for
     tracked *suggestions* — never `<ins>`/`<del>` HTML). A direct write to an open file fights the editor's autosave
     (BUG-085) and skips the change-highlight; a `DUO_SESSION`-gated PreToolUse
     hook warns (never blocks) when it catches this.
5. **The skill is a first-class deliverable.** Ship both the app and
   `skill/SKILL.md`, or neither.
6. **State-and-proceed on minor open questions.** If blocked on a
   layout/aesthetic/naming detail, state the assumption and proceed; don't stall.
7. **NEVER claim UI work done without previewing it.** Build-passing +
   types-clean is not enough — type checking verifies code correctness, not
   feature correctness. The UI-specific hard rules (**7a** restart Duo yourself ·
   **7b** always run `/smoke-walk` via the Skill tool · **7c** verify clean app
   state before any smoke-walk handoff · **7d** never rewrite an open fixture ·
   **7e** request Electron access at session start) load automatically from
   `.claude/rules/ui-verification.md` when you touch renderer/main/preload/CSS.
   Two general sub-rules that apply to ALL artifacts, not just UI:
   - **7f. Verify artifacts end-to-end before claiming "done".** A successful
     tool response is NOT verification. Read the artifact back through the path
     the user will use: `Read` a written file; `notion-fetch` a Notion page
     (confirm newlines/tables render, image URLs resolve); fetch a Release URL;
     skim a pushed commit's diff. If verification reveals problems, fix them
     silently rather than reporting "done but with caveats".
   - **7g. Rewrite, don't patch, after a second round of mess-feedback.** If the
     user says any variant of "you've made a mess / start over" on the SAME
     artifact a second time, stop layering edits — acknowledge in one sentence,
     discard the broken draft, and rewrite in one pass from the original intent.
     <!-- 7f + 7g intentionally stay inline (NOT moved to ui-verification.md):
          they're general-purpose, applying to ALL artifacts, not just UI.
          7a–7e are UI-specific, so they live in the path-scoped rule. Don't
          "finish the job" by relocating 7f/7g — that would hide them on
          non-UI work where they still apply. -->
8. **After editing `skill/` or `agents/`, run `npm run sync:claude`.** The repo
   is canonical; `~/.claude/skills/duo/` + `~/.claude/agents/duo.md` are copies,
   not symlinks. Remind the user too if they edit by hand.
9. **After editing `cli/duo.ts`, regenerate + commit the binary.**
   `npm run build:cli` && `git add cli/duo` (it's a tracked esbuild bundle so
   users install without a build step). Commit it alongside the source change.
10. **Propose a version cut after ship-moments — Geoff won't ask.** After a
    stage flips ✅, after a substantial commit to a user-visible surface
    (`renderer/`, `electron/`, `cli/duo`, `skill/`, `agents/`, IPC contracts in
    `shared/`), or when the user signals closure ("shipped"/"done") on something
    user-facing — propose a cut via the `cut-version` skill. If the sprint
    touched UI, run the `/smoke-walk` skill FIRST and wait for pasted results;
    straight-to-cut is fine only for doc-only changes.
11. **Planning artifacts default to interactive HTML playgrounds, never plain
    markdown.** When a research note, refactor proposal, or architectural plan
    needs owner *decisions*, write it as an HTML page at
    `docs/research/<slug>.html`: inline the Atelier CSS kernel
    ([`skill/references/atelier-css.md`](skill/references/atelier-css.md)),
    diagrams + side-by-side `.option-card`s, inline `.decision-card` blocks
    (radios + `.q-notes`), a sticky `.copy-bar` that round-trips decisions to
    clipboard. File it as a tracked ENH in `tasks.md`. Markdown is for
    no-decision content (implementation notes, locked-scope PRDs, ledgers).
    - **In a cloud / web Claude session, hand the reviewer a rendered preview
      link.** The owner can't open a local file path from a remote session, and
      GitHub renders committed HTML as *source*, not a page. After you commit +
      push the artifact to the working branch, give them a CDN-rendered URL:
      `https://raw.githack.com/<owner>/<repo>/<branch>/<path>` (e.g.
      `…/dudgeon/duo/claude/my-branch/docs/research/foo.html`). It serves the
      file with the right content-type so interactive JS runs. After any new
      push, a hard-reload (or bumping a `?v=N` query) busts githack's cache.
      Put the same link in the PR body so the artifact is reviewable without a
      clone or merge.
12. **No sidecar anti-pattern — state lives where it belongs.** Before adding
    any Duo-owned file/cache that mirrors another system's state, ask: *would
    this drift from the source of truth?* Read external state live every time
    (Claude Code storage, git worktree, Chrome/CDP state, filesystem mtimes).
    Acceptable in Duo storage: *pointers* (an ID that resolves live, captured
    only on actual evidence — not speculatively from a cwd/kind match),
    in-memory session state, and Duo-owned concepts the external system doesn't
    track (workspace layout, pins, install metadata). Full litmus test + the
    ENH-183 § D9 invariant: `docs/DECISIONS.md`.
13. **Docs are deliverables — keep the ledger and PRDs honest.** Code without its
    doc updates is not "done."
    - **`tasks.md` is the ledger.** Every bug/enhancement gets a tracked
      `BUG-###` / `ENH-###` entry with a Status line *before* work starts, and the
      Status flips to **✅ Shipped** the moment its PR merges. The `cut-version`
      auto-archive keys off the ✅ glyph — a merged-but-unflipped entry never
      archives and rots. One feature = one first-class entry; don't bury a shipped
      feature's status inside another entry.
    - **A PRD is required for every major feature** — a new user-visible surface,
      a new CLI verb family, a new WorkingPane tab type, or a new persisted store.
      Write `docs/prd/<id>-<slug>.md` with D-numbered decisions and link it from
      the `tasks.md` entry *before* building. (Owner *decisions* are captured in
      an interactive HTML playground per rule 11; the PRD is the locked-scope
      record that outlives it.)
    - **Functional-requirement changes update the existing PRD.** If you change
      what an existing feature *does* (not just how it's coded), update its PRD in
      the SAME PR — append a dated "requirements changed / fixes applied" note or
      section; never let a PRD drift from shipped behavior. (Pattern: the cron
      PRD's § 11.)
    - **Orientation docs track reality.** When a feature merges or the version
      moves, refresh `docs/dev/RESUME.md` (cold-start state + version) and
      `docs/dev/active-sprint.md` (status + carry-forward) in the same change — a
      stale RESUME misorients every post-compaction agent.

---

## Locked decisions (from owner)

| Decision | Choice |
|---|---|
| App name | Duo — CLI is `duo`, skill at `~/.claude/skills/duo/` |
| CLI packaging | esbuild compiled binary — no Node.js on user's PATH needed |
| Browser tabs | Visible tab strip inside BrowserPane; drivable via `duo tab <n>` |
| Brainstem / MCP | **Not included** — Skills panel is CWD-scan only |
| Skills CWD source | PTY launch CWD (not moving shell CWD); two scopes (project + home) |
| First-launch install | Electron permission dialog before installing CLI + skill + agent (deferred; currently manual) |
| Distribution / cert | Shipped incrementally through Stage 21 (signed+notarized DMG, auto-update, session restore, browser-history persistence, app icon, fork-friendly architecture, cohort distro packs + pack-builder skill). Per-stage history + still-open items live in `docs/roadmap.html`. |
| Multiple windows (ENH-191) | Shipped v0.10.0. "Allow Multiple Windows" setting **default ON**; New Window (⌥⌘N) / `duo window new` opens a BLANK second window (does not clone pins). Default CLI/app resolution is by IDENTITY (lowest-id primary), **never focus** (grep-gated). Session file is a v2 envelope (`{version:2, windows:[…]}`), forward-migration lossless + `.v1.bak`; downgrade boots empty gracefully. |
| File version history (ENH-221) | Shipped #104 (v0.11.2 batch). Content-addressed, append-only store at `~/.claude/duo/file-history/` (§D9-clean — Duo-owned log, never a sidecar), captured fire-and-forget OFF the save path (zero added latency). History modal (timeline · inline diff · restore-with-confirm); `duo history list\|show\|restore`. ADR in `docs/DECISIONS.md`. |
| Worktree lifecycle (ENH-222) | Shipped #105 (v0.11.2 batch). Create a worktree from the navigator dropdown — slug-validated, no git typing — and graceful removal-recovery (revert to MAIN, dismissible banner, never a render crash). `duo worktree new\|remove`. |
| Scheduled (cron) sessions (ENH-223) | Shipped #103 (v0.11.2 batch). **Interactive-only**, in-app next-fire timer (NOT a system daemon — fires only while Duo is open); headless `-p` behind a default-OFF flag; scheduler starts only after `SESSION_STATE_RESTORE_SETTLED`; store is §D9-clean. Create/manage from Home; `duo cron …`. ADR in `docs/DECISIONS.md`. |
| Attention badge (ENH-225) | Shipped #103 (v0.11.2 batch). A Duo-managed Claude hook (Stop/Notification=set, UserPromptSubmit=clear) posts to the socket via `duo attention`, keyed on the `DUO_TAB` env stamp; amber tab dot, never on the active tab, clears on focus/activity. |
| Managed Claude Code hooks | `install-service` writes Duo's hooks into `~/.claude/settings.json` via a `_duo`-marker merge (the PreToolUse open-file guard + the ENH-225 attention hooks). Re-surfaces on version bump. (Distinct from the still-manual first-launch CLI/skill/agent install above.) |

## Current sprint

See [`docs/dev/RESUME.md`](docs/dev/RESUME.md) (cold-start orientation) and
[`docs/dev/active-sprint.md`](docs/dev/active-sprint.md) (status, carry-forward
queue, open owner-decision questions). Per-version shipped detail is in
[`docs/dev/session-log.md`](docs/dev/session-log.md).
