# Stage 19 PRD — Duo detection & default-to-claude tabs

> **Status:** spec drafted 2026-04-26 (originally as Stage 18).
> Renumbered 2026-04-26 to Stage 19 as part of the layered build-
> order rationalization (the old Stage 18 number now belongs to the
> first-launch installer, since installer ships first per the
> dependency graph). **Phase 19a (env signals) shipped 2026-04-26
> in commit `640ec0e`** (originally tagged "Stage 18 Phase 18a" in
> the commit message — see ROADMAP.md § Number history).
> **Slot in roadmap:** Stage 19, in Layer 3 (distribution-readiness).
> Phase 19b (passive priming) folds into **Stage 18 (first-launch
> installer)** when both ship — they share the consent sheet. Phase
> 19c (default-claude tabs) needs **Stage 12 (Atelier visual)** for
> the split-button chrome. Cross-links into Stage 5 (skill priming
> source), Stage 20 (`duo doctor` consumes the env signals).
> **References:**
> - [docs/VISION.md](../VISION.md) — "agent-native by default"
>   (principle 1) and "smooth over, don't replace" (principle 3)
> - [docs/CLI-COVERAGE.md § Terminal — P0](../CLI-COVERAGE.md) — the
>   `duo term new` gap this stage closes (renamed `duo new-tab` here
>   per owner)
> - [docs/prd/stage-11-markdown-editor.md § D33e](stage-11-markdown-editor.md)
>   — today's "⌘T always activates a new foreground browser tab" rule,
>   which this stage scopes down (terminal focus becomes the
>   exception)
> - [docs/DECISIONS.md → Open ADRs → Sandbox-tolerant transport](../DECISIONS.md)
>   — `~/Library/Application Support/duo/bin` install path lines up
>   with the sandbox-safe direction the ADR proposes

---

## 1. What we're building

Three layers that, together, make "I am running inside Duo" a
first-class fact for the agent and a one-click default for the user.

1. **Layer 1 — env signals.** Every PTY Duo spawns gets
   `DUO_SESSION=1`, `DUO_SOCKET=<path>`, `DUO_VERSION=<x.y.z>`, and
   `TERM_PROGRAM=Duo` in its environment. Foundation — Layers 2 and
   3 both depend on this.
2. **Layer 2 — passive priming.** When Claude Code starts inside a
   Duo PTY, it reads a short paragraph that teaches it to prefer
   `duo` verbs over improvised file / browser work. Delivered two
   ways (belt-and-suspenders): a SessionStart hook merged into
   `~/.claude/settings.json`, and a PATH-shim fallback at
   `~/Library/Application Support/duo/bin/claude`.
3. **Layer 3 — default-to-claude tabs.** New terminal tabs default
   to launching Claude Code directly. The tab-bar `+` button becomes
   a **split button** (`+` = new claude session, `>` = vanilla
   shell). `⌘T` from terminal focus opens a claude tab; `⌘⇧T`
   always opens a vanilla shell. CLI parity:
   `duo new-tab [--shell|--claude] [--cwd]`.

Each layer is independently shippable. Layer 1 is the trivial
unblocker; Layers 2 and 3 can ride on either order, but Layer 3 is
visibly the larger UX shift and benefits from Layer 2 already being
in place (so the agent that the new default tab launches actually
*knows* it's in Duo).

**Out of scope for v1:**
- Drop-to-shell from inside a running claude tab (workaround: close
  + open). Revisit if friction is real.
- Per-session priming variants (different paragraph for `duo edit`-
  heavy vs. `duo navigate`-heavy work). One paragraph for v1.
- Cross-agent generalization. The priming and the SessionStart hook
  are Claude-Code-specific. BYO-harness alignment for other agents
  lands when (if) we add them.

---

## 2. Personas + jobs to be done

**Primary persona:** the same PM. They open Duo, hit `⌘T` or click
the `+`, and expect to be talking to the agent in seconds — not
typing `claude` and waiting for a cold start. They also expect that
when the agent is asked something, it doesn't reach for `cat README.md`
when `duo doc read` is sitting right there.

**Secondary persona:** the agent itself. Claude Code starting inside
a Duo PTY today has no signal that it's in Duo unless the user
remembers to prime it. The skill is installed globally
([Stage 5 D-locked](../DECISIONS.md#skill-scoping-global-install-at-claudeskillsduo)),
but global skills are advisory; the agent still has to *notice* the
context to apply them. Layer 2 is what makes the noticing automatic.

Jobs this stage does:
- "Open a new agent in this folder" — one click, one keystroke.
- "Make the agent default to Duo verbs without me having to remind it."
- "When the agent is wrong about whether `duo` is reachable, give it
  a way to find out (`duo doctor`)."
- "Let me still get a plain shell when I want one."

Jobs this stage does NOT do:
- Replace `duo doctor` for transport-level diagnosis (Stage 20).
- Re-frame what skills are or how they install (Stage 5 / Stage 18).
- Re-style the tab strip (Stage 12).

---

## 3. Resolved decisions

Most decisions below were locked in the chat with Geoff on
2026-04-26. A handful (marked `?`) propose a default the agent can
proceed on; flip at kickoff if wrong.

### Layer 1 — env signals

| # | Area | Decision |
|---|---|---|
| D1 | **Variables exported** | `DUO_SESSION=1`, `DUO_SOCKET=<SOCKET_PATH>`, `DUO_VERSION=<APP_VERSION>`, `TERM_PROGRAM=Duo`. The first three are already exported from `electron/constants.ts`; the fourth is new. |
| D2 | **Surface** | `PtyManager.spawn` (electron/pty-manager.ts:22-28) merges these into the child env. One commit, no IPC changes, no shared-types changes. |
| D3 | **TERM_PROGRAM literal** | Set to `"Duo"` (mixed-case to match `Apple_Terminal`, `iTerm.app`, `vscode`). Tools that already key off `TERM_PROGRAM` (Powerlevel10k, oh-my-zsh, Starship) get a clean signal alongside the agent. |
| D4 | **Side effects on `cli/duo.ts`** | When `DUO_SESSION` is present, `cli/duo.ts` skips socket discovery and reads `DUO_SOCKET` directly. Nice-to-have, not load-bearing — the existing discovery still works. |
| D5 | **Side effects on `duo doctor`** | `duo doctor` (Stage 20) reads the same env vars and reports "✓ DUO_SESSION present" / "⚠ not in a Duo PTY (env vars missing — are you running this from outside the app?)" so the sandbox + non-Duo failure modes are distinguishable. |

### Layer 2 — passive priming

| # | Area | Decision |
|---|---|---|
| D6 | **Two delivery mechanisms ship** | SessionStart hook (primary) + PATH-shim fallback (secondary). Both reference the same priming text file, so editing one place updates both. |
| D7 | **Priming text location** | `~/Library/Application Support/duo/priming.md`. App-bundled default at install time; user-editable thereafter. `duo install` syncs the bundled version when the version differs and the file is unmodified; prompts before overwriting a user-edited file. |
| D8 | **Priming content (v1 draft)** | One short paragraph: *"You're running inside Duo, a workspace that pairs your terminal with a real browser, file tree, and markdown editor. Prefer `duo view <path>` and `duo edit <path>` over `cat`/`open`; `duo selection` to read what the user has highlighted; `duo navigate`/`duo ax`/`duo click` for browser work. If a `duo` call fails, run `duo doctor` first — sandbox transport, not the verb, is usually the cause."* Tunable post-launch; lives in version control next to this PRD as `skill/priming.md`. |
| D9 | **SessionStart hook shape** | Idempotent JSON merge into `~/.claude/settings.json`. The hook block is tagged with a `// duo-managed` comment marker (or the JSON-friendly equivalent: a `_duo` key inside the block) so we can detect our own previous installs and skip / replace. |
| D10 | **Hook merge policy** | (a) duo-tagged block with same version → skip. (b) duo-tagged block with different version → replace. (c) non-duo SessionStart hook present → don't merge; print a diff to the install console; the shim still primes the agent. (d) no SessionStart slot at all → install fresh. |
| D11 | **Hook gating** | The hook itself runs `[ -n "$DUO_SESSION" ] && cat ~/Library/Application\ Support/duo/priming.md`. If a Duo-managed hook somehow runs outside Duo, it self-no-ops. |
| D12 | **PATH-shim location** | `~/Library/Application Support/duo/bin/claude`. PtyManager prepends this directory to PATH for every PTY it spawns (alongside the env-var work in D1). |
| D13 | **PATH-shim content** | One-line shell script: `[ -z "$DUO_SESSION" ] && exec <real-claude> "$@"; exec <real-claude> --append-system-prompt-file ~/Library/Application\ Support/duo/priming.md "$@"`. Self-deactivates when copy-pasted into a non-Duo PATH. |
| D14 | **Resolution of `<real-claude>`** | At install time we resolve and inline the absolute path (`which claude` from a clean shell). Re-resolved on `duo install` re-runs. If `claude` is not on PATH at install time, the shim still ships but logs "Claude Code not detected — install it and re-run `duo install`" via stderr; the env vars + Layer 3 fallback still work. |
| D15 | **Uninstall path** | `duo install --uninstall-hook` removes the duo-tagged block from `~/.claude/settings.json` and deletes the shim directory. Also documented in `duo install --help`. |
| D16? | **Hook install consent** | Folded into Stage 18's first-launch consent sheet (the parallel agent's edits are landing there). Until Stage 18 ships, hook install runs on `duo install` with a printed "this will write to ~/.claude/settings.json" banner the user must Y/N. |

### Layer 3 — default-to-claude tabs

| # | Area | Decision |
|---|---|---|
| D17 | **Tab-bar button shape** | Split button. **`+` (left, primary)** = new claude session. **`>` (right, secondary)** = new vanilla shell. The default click target is the `+` half so existing muscle memory ("click the +") gets the new behavior. The `>` half is visually distinct — separator rule + tooltip "New shell tab". |
| D18 | **`⌘T` from terminal focus** | New claude tab. **Supersedes [Stage 11 D33e](stage-11-markdown-editor.md) for terminal focus only** — the rest of D33e (browser/editor/files focus → new browser tab) stays as-is. |
| D19 | **`⌘⇧T` anywhere** | New vanilla shell tab. Today's behavior, unchanged. |
| D20 | **`⌘T` from non-terminal focus** | Unchanged — new browser tab. |
| D21 | **How "claude tabs" actually spawn** | `PtyManager.spawn(<user-shell>)` exactly as today (so rc files run, the shell is the parent for env-var inheritance, the shell stays around if claude exits). Then we write `claude\n` into the PTY stdin. The user briefly sees `claude` typed at their prompt before it runs — acceptable for v1. (Alternative: `spawn("claude")` directly. Cleaner output, but rc-file env doesn't apply, and an unexpected exit closes the tab. Recommend deferring.) |
| D22 | **Exit behavior** | When `claude` exits inside a claude tab, the user lands at their shell prompt (because of D21). The tab's title reverts from "claude · ~/folder" to "~/folder". They can re-launch claude or `exit` the shell. |
| D23 | **Fallback when `claude` is not on PATH** | `+` clicks (and `⌘T` from terminal focus) open a vanilla shell with a one-line banner: `Install Claude Code to enable agent tabs: https://docs.claude.com/...`. Banner is a single shell line printed before the prompt; clears on the next command. |
| D24 | **Drop-to-shell from inside a claude tab** | Out of v1. The simplest workaround — close the tab, click `>` to open a shell — is acceptable. Revisit if real friction emerges. |
| D25 | **CWD inheritance** | Both kinds of new tab inherit the navigator's pending-CWD per [Stage 10 D9](stage-10-file-navigator.md). The CWD rule is shape-agnostic. |
| D26 | **Title format** | Claude tabs: `claude · <basename(cwd)>` (or `claude · ~` for HOME). Shell tabs: `<basename(cwd)>` (today's behavior). The `claude · ` prefix makes mixed strips legible at a glance. |
| D27 | **`duo new-tab` CLI** | New verb, P0 in [CLI-COVERAGE](../CLI-COVERAGE.md) (replaces the listed `duo term new`). Shape: `duo new-tab [--shell\|--claude] [--cwd <path>] [--cmd <pre-typed>]`. Default `--kind` matches the user's most-recent UI choice (`localStorage['duo.lastNewTabKind']`, default `'claude'`). Returns `{id, kind, cwd, title}`. |
| D28 | **Persisted "last choice" default** | The `+` button always opens claude (the *primary* affordance is opinionated). The persisted last choice only governs `duo new-tab` with no flag — so an agent that pops new tabs without flags follows the user's last manual selection. |

---

## 4. Architecture

### Layer 1 — one place to edit

```ts
// electron/pty-manager.ts:22-28 (PtyManager.create / spawn)
const env = {
  ...process.env,
  // existing assignments…
  DUO_SESSION: '1',
  DUO_SOCKET: SOCKET_PATH,
  DUO_VERSION: app.getVersion(),
  TERM_PROGRAM: 'Duo',
  PATH: `${SHIM_DIR}:${process.env.PATH ?? ''}`, // D12
}
```

`SHIM_DIR` is a constant exported from `electron/constants.ts`
(`~/Library/Application Support/duo/bin`).

### Layer 2 — install paths

Two artifacts, one source of truth:

```
~/Library/Application Support/duo/
  ├── duo.sock                     # already shipped
  ├── priming.md                   # D7 — single source of truth
  └── bin/
      └── claude                   # D12 — PATH shim, executable

~/.claude/settings.json
  └── { "hooks": { "SessionStart": [ … duo-tagged entry … ] } }
```

The shim's content (D13):

```bash
#!/bin/sh
# duo-managed; safe to delete. Reinstall via `duo install`.
REAL_CLAUDE='/opt/homebrew/bin/claude'  # resolved at install time
[ -z "$DUO_SESSION" ] && exec "$REAL_CLAUDE" "$@"
exec "$REAL_CLAUDE" --append-system-prompt-file \
  "$HOME/Library/Application Support/duo/priming.md" "$@"
```

The hook entry (D9, D10):

```jsonc
{
  "hooks": {
    "SessionStart": [
      {
        "_duo": "managed-v0.1.0",     // marker for idempotent merge
        "type": "command",
        "command": "[ -n \"$DUO_SESSION\" ] && cat \"$HOME/Library/Application Support/duo/priming.md\""
      }
    ]
  }
}
```

### Layer 3 — split button + spawn flow

Renderer side: `TabBar.tsx` gains the split-button affordance. The
existing `newTerminalTab()` callback (`renderer/App.tsx:25-29`)
becomes `newTerminalTab(kind: 'shell' | 'claude')`. The default
binding for the `+` half is `kind: 'claude'`; for `>` it's
`kind: 'shell'`.

Spawn flow (D21):

```
TabBar +/⌘T → newTerminalTab('claude')
            → makeTab(kind: 'claude', cwd: navigatorCwd)
            → window.electron.pty.create(id, undefined, cwd)
            → if claude on PATH (D14 install-time check, re-checked at spawn):
                window.electron.pty.write(id, 'claude\n')
              else:
                window.electron.pty.write(id, '<banner>\n')
```

Tab metadata (`TabSession` in `shared/types.ts`) gains:

```ts
interface TabSession {
  id: string
  title: string
  cwd: string
  kind: 'shell' | 'claude'   // new
  // …
}
```

The `kind` is captured at spawn time and used for D26 title
formatting and for whether `duo new-tab --kind` round-trips
correctly through `duo term tabs` (Stage 20).

### Layer 3 — CLI plumbing

Standard six-file checklist per [CLAUDE.md rule 4](../../CLAUDE.md):

1. `shared/types.ts` — add `'new-tab'` to `DuoCommandName`; add the
   `TabSession.kind` field.
2. `electron/preload.ts` — extend the renderer surface so the
   socket bridge can spawn a tab via the same code path the UI uses.
3. `electron/main.ts` — ipcMain handler `pty:create` already exists;
   bridge helper `dispatchNewTab({kind, cwd, cmd?})` added.
4. `electron/socket-server.ts` — new `case 'new-tab'`.
5. `cli/duo.ts` — `new-tab` verb + `printHelp()` update; rebuild
   `cli/duo` with `npm run build:cli`.
6. `skill/SKILL.md` — short pattern: "Need a fresh agent for a
   side-quest? `duo new-tab --claude --cwd <path>`. Need a shell?
   `--shell`."

---

## 5. Build plan

Three phases. Each is independently shippable, but Layers 1 and 2
should land before Layer 3 ships so that "default to claude" lands
into a primed agent.

### Phase 19a — Env signals (S, ~½ day)

- [ ] PtyManager exports the four env vars (D1–D3).
- [ ] `cli/duo.ts` skips socket discovery when `DUO_SOCKET` is
      present (D4).
- [ ] `duo doctor` reads + reports `DUO_SESSION` (D5; cross-link to
      Stage 20).
- [ ] Smoke test: `env | grep ^DUO_` inside a Duo terminal returns
      the four vars; same command outside Duo returns nothing.
- [ ] [docs/CLI-COVERAGE.md](../CLI-COVERAGE.md) updated — the
      `duo doctor` capability gains a `DUO_SESSION` line.
- **Exit:** `cli/duo.ts` and any other process spawned inside Duo
  can detect "I'm in Duo" without heuristics.

### Phase 19b — Passive priming (M, ~2 days)

- [ ] Bundle `skill/priming.md` (D8) and copy to
      `~/Library/Application Support/duo/priming.md` on `duo install`.
- [ ] Build the PATH shim (D12, D13) at install time, resolving the
      real `claude` path (D14).
- [ ] Implement the SessionStart hook merge logic (D9, D10) — pure
      JSON-with-comments handling; library or bespoke.
- [ ] Wire `duo install --uninstall-hook` (D15).
- [ ] PtyManager prepends `SHIM_DIR` to PATH (D12).
- [ ] Validation: launch a fresh `claude` session inside a Duo
      terminal; `/status` (or equivalent) should show the priming
      paragraph in the system prompt; outside Duo, no priming.
- [ ] Verify the hook fires by inspecting the agent's transcript
      (the priming text appears once at session start).
- [ ] Verify shim self-deactivation: `PATH="$SHIM_DIR" claude` from
      a non-Duo shell behaves identically to direct `claude`.
- **Exit:** a fresh Claude Code session opened inside a Duo
  terminal autonomously prefers `duo` verbs without the user
  saying anything.

> **Cross-PR note:** Phase 19b's install paths overlap with **Stage
> Stage 18's first-launch installer** (the parallel agent's work, in
> flight 2026-04-26). When both PRs land, the hook + shim install
> should fold into the Stage 18 consent sheet (D16). Until then, 19b's
> install runs through `duo install` with its own one-time prompt.

### Phase 19c — Default-to-claude tabs (M, ~2–3 days)

- [ ] Split-button affordance in `TabBar.tsx` (D17, D26).
- [ ] `newTerminalTab(kind)` takes a kind; spawn flow per D21–D23.
- [ ] `⌘T` handler in `useKeyboardShortcuts.ts` becomes
      focus-aware (D18, D20). Note: this also touches the
      [BUG-001](../../tasks.md) area (`⌃Tab` cycling), but doesn't
      fix it — that's separate.
- [ ] `TabSession.kind` plumbed through shared types + preload +
      main + socket bridge.
- [ ] `duo new-tab` CLI verb (D27). Rebuild `cli/duo` binary.
- [ ] Persisted last-kind for agent-driven calls (D28).
- [ ] Fallback banner when `claude` is not on PATH (D23).
- [ ] [docs/CLI-COVERAGE.md](../CLI-COVERAGE.md) update — move
      `duo term new` from gap (P0) to shipped (under the new
      `duo new-tab` name).
- [ ] [docs/dev/smoke-checklist.md](../dev/smoke-checklist.md) §5
      keyboard matrix — add `⌘T` from terminal focus = claude tab,
      verify across all four focus surfaces.
- **Exit:** PM clicks `+` and is talking to a primed Claude in
  under two seconds; the `>` half still gives them a vanilla shell.

**Total scope:** ~5 days of focused work. Land Phase 19a as a
standalone tiny PR (it unblocks `duo doctor` for Stage 20
independently); 19b + 19c can be one PR or two.

---

## 6. Cross-stage interactions

### Stage 5 — Skill + subagent (already shipped)

The priming paragraph (D8) is **not** the skill. The skill stays
prescriptive and capability-shaped (`SKILL.md` + examples); the
priming is a one-paragraph nudge that says "the skill applies here,
prefer it." The two are deliberately separate so the skill can
evolve without re-installing hooks.

### Stage 20 — Interaction polish

`duo doctor` (P1 in [docs/CLI-COVERAGE.md](../CLI-COVERAGE.md))
reads `DUO_SESSION` per D5 to distinguish "running outside Duo"
from "running inside Duo but transport failing." The skill's
"sandbox failure" guidance becomes precise: `duo doctor` first,
then the [transport ADR](../DECISIONS.md) escalation tree.

### Stage 18 — First-launch self-install 

The parallel agent expanding Stage 18 (first-launch self-install) is the natural place to
fold:
- the priming-text install (`fs.copyFile` from app bundle to
  `~/Library/Application Support/duo/priming.md`),
- the PATH-shim creation (resolved-real-claude inlining),
- the SessionStart hook merge (with consent),
- the consent sheet copy ("Duo wants to install … and add a
  Claude Code SessionStart hook to ~/.claude/settings.json. [Show
  diff] [Install] [Skip]").

Until Stage 18 lands, Phase 19b uses `duo install` as its own forcing
function with a smaller, scriptier prompt.

### Stage 15 — Interaction primitives

Stage 15d (`duo tab --cmd "<cmd>"`) and this stage's `duo new-tab
--cmd` overlap intentionally. Recommendation: `duo new-tab --cmd`
**executes** the command (D21 mechanism) when `--kind=claude`
*and* the command is exactly `claude` or empty; otherwise falls
back to Stage 15d's "pre-typed, user hits Enter" behavior. Lock
this at 15d kickoff if Stage 15 ships first.

### Stage 12 — Visual redesign (Atelier)

The split button is a new affordance the Atelier mock doesn't yet
cover. Two options at Stage 12 kickoff: (a) update the mock to
show the split button in the prototype's TabBar component before
17 ships, or (b) ship 19c first with a workmanlike split-button
treatment, and let 17 polish it. Either is fine; recommendation is
(b) — getting the behavior right matters more than the visual,
and Atelier's tab-strip work will absorb whatever lands.

---

## 7. Risks + open questions

- **The hook fires for every Claude Code session globally.** D11's
  `[ -n "$DUO_SESSION" ]` guard makes the hook a no-op outside
  Duo, but it's still a hook in the user's `~/.claude/settings.json`.
  Mitigation: the marker comment + `--uninstall-hook` (D15), plus
  explicit consent (D16). Open: do we want a "Duo installed a
  hook" indicator anywhere in the app's UI for transparency?
  Recommend a single line in a future Settings panel; not
  blocking.
- **D-numbered conflict with Stage 11 D33e.** D18 here scopes down
  D33e there. The ground truth for `⌘T` becomes: terminal focus →
  claude tab; everything else → browser tab. The smoke checklist
  must be updated in the same PR or the matrix in
  [docs/dev/smoke-checklist.md § 5](../dev/smoke-checklist.md)
  goes stale.
- **D21 brief-flicker UX.** Auto-typing `claude\n` into a fresh
  shell shows the user a moment of `~/folder $ claude` before the
  TUI takes over. Acceptable for v1; if it feels rough in dogfood,
  alternatives are: (a) suppress one OSC frame's render (fragile),
  (b) switch to direct `spawn('claude')` and accept the rc-file
  tradeoff (D21 alternative). Not blocking.
- **Open — priming paragraph wording.** D8 is a draft. Iterate
  during 19b. Things to test: does the agent's first response
  cite `duo` correctly? Does the agent over-rotate (calling
  `duo` when a plain `cat` would have been fine)?
- **Open — what about CLAUDE.md instances in the user's project
  directories?** Duo's priming is global; the project's CLAUDE.md
  is local. They can disagree (project says "use this script",
  Duo says "use `duo edit`"). Recommend Duo's priming explicitly
  cede precedence to project CLAUDE.md, with a "but unless this
  project tells you otherwise" hedge in D8.
- **Open — when `claude` is the user's only PATH-default shell-
  like binary (rare).** If a user aliased `claude` to `claude
  --resume`, the shim breaks the alias because we resolve to the
  real-claude absolute path at install time. Document; revisit if
  it becomes a real complaint.
- **D14 install-time PATH resolution is brittle if the user
  installs `claude` *after* Duo.** Mitigation: the shim logs a
  helpful message; `duo doctor` re-checks; `duo install` is idempotent
  and re-resolves on every run. Acceptable.

---

## 8. Success criteria

- A PM hits `⌘T` in a fresh Duo session and is talking to a primed
  Claude in under three seconds, including the agent's first
  response.
- The agent's first response on a "summarize this doc" prompt
  uses `duo ax` (Google Docs) or `duo doc read` (local md) without
  the user mentioning either.
- `⌘⇧T` and the `>` half of the split button still produce a
  bare shell. The escape hatch stays open ([VISION.md principle
  3](../VISION.md)).
- `duo new-tab --shell` and `--claude` produce the same surfaces
  the UI does. CLI parity holds ([CLAUDE.md rule 4](../../CLAUDE.md)).
- The PATH shim is a no-op when copied into a non-Duo PATH (D6,
  D13). Verified by smoke test.
- `duo install --uninstall-hook` cleanly removes the hook entry
  with no residue in `~/.claude/settings.json`.
- A user who declines the hook (D16) still gets primed via the
  PATH shim. Belt-and-suspenders is real.
- [docs/CLI-COVERAGE.md](../CLI-COVERAGE.md) shows `duo new-tab`
  shipped (no longer a P0 gap).
