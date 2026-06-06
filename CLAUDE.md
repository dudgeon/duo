<!-- MAINTAINER NOTE (stripped from model context — HTML comments don't load):
     This file is the ALWAYS-ON index. Keep it slim — a CLAUDE.md that grows
     too long gets ignored. Situational/procedural detail lives in two places:
       • Path-scoped rules in `.claude/rules/*.md` (load only when matching
         files are read/edited): cli-plumbing.md, ui-verification.md,
         renderer-surfaces.md.
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

One Electron main process owns everything: the `BrowserWindow`, the
`PtyManager` (node-pty pool), the `BrowserManager` (WebContentsView), the
`CdpBridge` (Chrome DevTools Protocol commands), and the `SocketServer` (Unix
socket listener). The renderer process hosts React — xterm.js terminals, the
browser pane, the markdown editor, and the HTML canvas — talking to main via
contextBridge IPC. The `duo` CLI (standalone Node.js script) connects over the
Unix socket to drive both the browser and the renderer surfaces from inside
any terminal tab.

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
files including `.git/refs/heads/main`.)

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
   Full plumbing checklists: `.claude/rules/cli-plumbing.md`.
   - **3a. Visibility cluster** — when debugging Duo blind, reach for
     `duo dom` / `duo devtools` / `duo layout` / `duo nav-state` BEFORE building
     bespoke instrumentation (detail in `.claude/rules/cli-plumbing.md`).
4. **CLI parity with UI.** If the human can do it (click, menu, keystroke,
   toggle), the agent must be able to do the same from the CLI — UI-only
   features silently break Duo's pair-work premise. Call out deliberate
   asymmetries in the PRD. (Detail + checklists: `.claude/rules/cli-plumbing.md`.)
   - **4a. Edit open files THROUGH Duo, never around it.** Before `Edit`/`Write`
     on any file that might be open in Duo, run `duo status` and prefer the
     matching `duo` verb (`doc edit` / `doc write` · `html *` · `json set` /
     `merge`). A direct write to an open file fights the editor's autosave
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

## Current sprint

See [`docs/dev/RESUME.md`](docs/dev/RESUME.md) (cold-start orientation) and
[`docs/dev/active-sprint.md`](docs/dev/active-sprint.md) (status, carry-forward
queue, open owner-decision questions). Per-version shipped detail is in
[`docs/dev/session-log.md`](docs/dev/session-log.md).
