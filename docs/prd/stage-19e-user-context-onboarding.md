# Stage 19e PRD — User-context onboarding hardening

> **Status:** spec drafted 2026-05-03. **Slot in roadmap:** Stage 19,
> Phase 19e (extends 19a env signals + 19b passive priming with a
> hook-independent path for non-`DUO_SESSION` Claude Code sessions).
> **Sprint candidate** for the next sprint after v0.6.5 cut. **Not
> blocking** any other stage.
>
> **References:**
> - [docs/prd/stage-19-duo-detection.md](stage-19-duo-detection.md)
>   — parent stage. 19b shipped the load-bearing PATH shim + redundant
>   SessionStart hook for in-Duo priming. 19e is the cousin: priming
>   for sessions that aren't in a Duo PTY at all.
> - [electron/install-service.ts](../../electron/install-service.ts)
>   — install service that 19e extends with a managed-block writer.
>   Existing `mergeSessionStartHook` is the structural template.
> - [skill/SKILL.md](../../skill/SKILL.md), [skill/make-page.md](../../skill/make-page.md),
>   [skill/make-playground.md](../../skill/make-playground.md) — all
>   currently cite `CLAUDE.md § Glossary` as canonical for vocabulary.
>   ENH-089 closes that broken pointer.
> - [skill/references/sandbox-troubleshooting.md](../../skill/references/sandbox-troubleshooting.md)
>   — existing reference; ENH-090 adds a sibling for enterprise
>   deployment patterns.
> - [CLAUDE.md § Glossary](../../CLAUDE.md) — current host of the
>   user-facing vocabulary that ENH-089 lifts into the shipped skill.

---

## 1. What we're building

Three coordinated changes that close the gap between "Geoff's Duo
fluency" and "what end users actually get from the installer":

1. **ENH-088 — Managed block in `~/.claude/CLAUDE.md`.** Auto-insert
   a thin (~5-line) Duo-awareness block on first launch. Pointers
   only — no inlined content. Hook-independent.
2. **ENH-089 — Lift user-facing glossary into a shipped skill
   reference.** The page/playground/lesson vocabulary is canonically
   sourced from project CLAUDE.md, but two shipped skills point to
   it as authoritative. Move the user-facing parts into
   `skill/references/vocabulary.md`; update pointers.
3. **ENH-090 — Enterprise-deployments reference.** New
   `skill/references/enterprise-deployments.md` documenting what
   parts of Duo's user-context onboarding work in
   hook-disabled / managed Claude Code installs (load-bearing) vs.
   what may be policy-restricted (best-effort).

Each ENH is independently shippable. Suggested ship order: 088 → 089
→ 090 (088 establishes the managed-block pattern; 089 cleans up the
artifact dependencies it relies on; 090 is a documentation deliverable
sized for a half-sprint slot).

**Out of scope for v1:**
- A Duo MCP server for Claude Desktop. Real work; tracked separately
  if/when prioritized. Duo's design remains "Claude Code embedded in
  Duo terminals," not "Claude Desktop drives Duo from outside."
- Settings.json permission allowlist suggestions (e.g., `Bash(duo:*)`
  pre-approval). Different concern than context onboarding; revisit
  when enterprise telemetry shows it's needed.
- Per-user CLAUDE.md customization UI inside Duo. The block is
  installer-managed; users edit `~/.claude/CLAUDE.md` directly with
  any tool they prefer.

---

## 2. Why this matters

Today, Duo onboarding has four mechanisms reaching the user's
Claude:

| Mechanism | Hook-dependent? | Settings-dependent? | Fires when |
|---|---|---|---|
| PATH shim (`~/.claude/duo/bin/claude`) | No | No | `DUO_SESSION=1` Duo PTY |
| SessionStart hook (`~/.claude/settings.json`) | **Yes** | **Yes** | `DUO_SESSION=1` Duo PTY |
| `~/.claude/skills/duo/` registry | No | No | Always (skill discovery) |
| `~/.claude/agents/duo.md` registry | No | No | Always (subagent discovery) |

Two real gaps:

**Gap 1 (hook fragility).** Enterprise Claude Code installations
commonly disable hooks, lock down `settings.json` to managed
templates, or run with policies that skip hook execution. The
SessionStart hook is already documented as the redundant safety net
in [electron/install-service.ts](../../electron/install-service.ts);
the PATH shim is load-bearing. But the architecture has *no*
hook-independent path for non-`DUO_SESSION` sessions — Claude Code
running in Terminal.app, iTerm, VS Code's integrated terminal, or
agent worktrees not spawned by Duo's `PtyManager` gets nothing
beyond skill+agent registry presence.

**Gap 2 (broken cross-references).** Both `make-page.md` and
`make-playground.md` cite `CLAUDE.md § Glossary` as the canonical
source for the page/playground/lesson vocabulary. CLAUDE.md ships
only with the source repo. End users following the pointer arrive
at a doc they can't read; the local copies in each skill are
already at risk of drifting from the canonical version.

Stage 19e closes both gaps.

---

## 3. Personas + jobs to be done

**Primary persona (ENH-088):** an end user running Claude Code in a
non-Duo terminal — VS Code's integrated terminal, an iTerm window
they alt-tabbed to, an agent worktree another tool spawned. They
ask the agent something Duo-adjacent ("read the doc open in my
browser"). Without the managed block, Claude has no signal Duo
exists; with it, Claude reaches for the `duo` skill and the workflow
lands.

**Primary persona (ENH-089):** an agent (Claude or otherwise)
following the Vocabulary lock pointer in `make-page.md` /
`make-playground.md`. Today the pointer goes to `CLAUDE.md §
Glossary` — invisible to end users. After the lift, the canonical
glossary lives in a shipped skill reference both maintainers and
agents can read.

**Primary persona (ENH-090):** an enterprise Duo user (or their
admin) running a managed Claude Code install — hooks disabled,
restrictive `permissions.deny`, possibly a managed skills directory.
They need to know which Duo features will work and which won't, and
how to file a useful bug if something doesn't fire as expected.

**Secondary persona (all three):** future maintainers who need the
hook-independence design property documented so they don't
accidentally regress it in a later sprint.

---

## 4. Design + key decisions

### ENH-088 — Managed block

**Block content (draft).** ~5 lines, pointers only, no inlined
verb cheat-sheet (that lives in priming.md for in-Duo sessions and
in the skill body for triggered loads):

```markdown
<!-- duo:managed-vX.Y.Z — installed by Duo. Edit freely; remove this block to opt out. -->
## Duo workspace integration

Duo (https://duo.app) is installed on this machine — a desktop app pairing Claude Code terminals with an embedded browser, file tree, markdown editor, and HTML canvas. When the user references Duo's surfaces ("the browser pane", "the editor", "what's selected", a `duo` CLI verb), reach for the **`duo` skill** at `~/.claude/skills/duo/SKILL.md` or delegate multi-step CLI sequences to the **`duo` subagent**. If a `duo` command hangs or returns `ECONNREFUSED`, see `~/.claude/skills/duo/references/sandbox-troubleshooting.md`.
<!-- duo:end -->
```

**Hook-independence (load-bearing design property).** This block
must remain the primary mechanism for Duo awareness in
non-`DUO_SESSION` Claude Code sessions. It must NOT depend on
Claude Code's hook runtime or any `settings.json` configuration.
CLAUDE.md is loaded by Claude Code's core context loader and works
regardless of hook/permission policy. The existing SessionStart hook
(Stage 19b) remains the redundant safety net for in-Duo sessions
only; this block is the load-bearing path for everything else.

**Insert / replace / respect-removal logic.** Mirror
`mergeSessionStartHook` in
[electron/install-service.ts](../../electron/install-service.ts):

| Scenario | Action |
|---|---|
| `~/.claude/CLAUDE.md` does not exist | Create with block + trailing newline. Set `installed.json.claudeMdManaged = true`. |
| File exists with `<!-- duo:managed-* -->` marker | Version-aware regex replace. Update marker version. Surrounding content untouched. |
| File exists, no marker, `claudeMdManaged !== true` | First-time append. Prepend `\n\n` if file doesn't end in `\n`. Set flag. |
| File exists, no marker, `claudeMdManaged === true` | User removed it. **Respect that.** No-op. Never re-add. |

**Why a managed block instead of a separate file.** Claude Code only
reads files in specific conventions: `~/.claude/CLAUDE.md`, project
CLAUDE.md, skill files. A separate `~/.claude/duo-prelude.md` would
need an `@import` mechanism that Claude Code does not have. The
managed-block pattern is well-established in the OSS world (`.zshrc`,
`.bashrc`, `.gitconfig` blocks); precedent in this codebase is the
existing SessionStart hook merge tagged `_duo`.

### ENH-089 — Vocabulary lift

**New file:** `skill/references/vocabulary.md`. Contents lifted
from project CLAUDE.md § Glossary:

- The "User says vs internal name" table — *user-facing column only*.
  Internal names (`WorkingTab.kind === 'page'`,
  `renderer/components/Page/`) stay in project CLAUDE.md; they're
  contributor lore, not user-facing.
- "The page/playground distinction is content-level, not kind-level"
  paragraphs.
- "When to reach for which" decision tree.

**Pointer updates:**
- [skill/make-page.md:9](../../skill/make-page.md) — change
  "see CLAUDE.md § Glossary" to "see `references/vocabulary.md`"
- [skill/make-playground.md:9](../../skill/make-playground.md) —
  same change.
- Project [CLAUDE.md](../../CLAUDE.md) § Glossary — replace lifted
  content with a one-line pointer at the shipped reference; keep a
  trimmed contributor-facing internal-names table (or move that to
  a future ARCHITECTURE.md if it grows).

**Why not duplicate.** The vocabulary is locked (terminology lock
2026-05-02); maintainers and end users should read the *same*
canonical document. Duplication invites drift; the v0.6.1 → v0.6.5
ENH-052 rename was driven precisely by terminology debt that
duplicated copies would re-create.

### ENH-090 — Enterprise-deployments reference

**New file:** `skill/references/enterprise-deployments.md`. Single-
page reference, ~150-200 lines. Sections:

1. **Mechanism dependency map.** Table from this PRD § 2 — what
   Duo features work hook-free, what depends on settings.json,
   what assumes user-space `~/.claude/`.
2. **Common enterprise restrictions.** Hooks disabled
   (SessionStart hook silently skipped → no impact on in-Duo
   priming). Restrictive `permissions.deny` policies (e.g.
   `Bash(duo:*)` may need explicit allowlist additions in
   organization settings — direction users to their admin if
   blocked). Managed `~/.claude/skills/` (rare; Duo's installer
   would fail at write time with a clear error message).
3. **What still works.** PATH shim priming (no hook needed),
   skill discovery, subagent discovery, the user CLAUDE.md
   managed block.
4. **Reporting checklist.** What logs to capture, what to share
   with the user's IT/admin, what to send upstream as a Duo
   issue.

**Why a reference, not a FAQ entry or roadmap section.** The
content is policy-environment-dependent, evolves slowly, and is
the kind of thing a user would search for after hitting a problem.
Skill-references are the right surface — they're synced via
`sync:claude` + the installer, and the user CLAUDE.md managed block
in ENH-088 already points at this directory.

---

## 5. Implementation plan

### Phase 1 — ENH-088 (managed block)

**Files touched:**
- [electron/install-service.ts](../../electron/install-service.ts)
  — new `mergeUserClaudeMd(version: string)` function;
  call site alongside existing `mergeSessionStartHook` invocation.
- `core/installed-packs-service.ts` (or wherever `installed.json`
  is written) — add `claudeMdManaged: boolean` to the schema.
- New unit test `electron/install-service.test.ts` (or the existing
  one if extant) covering the four insert/replace/respect-removal
  scenarios from § 4.

**Acceptance criteria:**
- Fresh home dir (no `~/.claude/CLAUDE.md`) → install creates file
  with block.
- Existing CLAUDE.md without marker → install appends block; user
  content untouched.
- Existing CLAUDE.md with old marker → install replaces block in
  place.
- User removes block, runs install again → block stays removed
  (`claudeMdManaged` flag prevents re-add).
- All four scenarios verified by unit test.

**Smoke walk:** confirmed via the next sprint's smoke-walk page —
pre-cut acceptance test "open Claude Code in Terminal.app, ask 'what's
in my Duo browser pane?' — Claude should reach for the `duo` skill,
not say it doesn't have access."

### Phase 2 — ENH-089 (vocabulary lift)

**Files touched:**
- New `skill/references/vocabulary.md` (lifted from CLAUDE.md
  glossary).
- [skill/make-page.md](../../skill/make-page.md) — update one
  pointer line.
- [skill/make-playground.md](../../skill/make-playground.md) —
  update one pointer line.
- Project [CLAUDE.md](../../CLAUDE.md) — replace lifted glossary
  content with pointer to `skill/references/vocabulary.md`; keep
  contributor-facing notes only.
- `package.json` `sync:claude` script — verify references/ tree
  is already synced (it is, per `installed.json`); no script change
  needed.

**Acceptance criteria:**
- Both `make-page.md` and `make-playground.md` pointer lines
  resolve to a real file under `skill/references/`.
- Project CLAUDE.md section explicitly notes the canonical version
  is shipped; contributor-facing internal naming notes remain.
- `npm run sync:claude` followed by inspection of
  `~/.claude/skills/duo/references/vocabulary.md` confirms the
  reference is present in the installed tree.

### Phase 3 — ENH-090 (enterprise reference)

**Files touched:**
- New `skill/references/enterprise-deployments.md` (~150-200
  lines).
- ENH-088's managed block already points at
  `references/sandbox-troubleshooting.md`; consider a
  one-line cross-reference there back to enterprise-deployments
  for users hitting policy-driven blockers.

**Acceptance criteria:**
- Reference exists and follows the sandbox-troubleshooting
  format conventions.
- One end-to-end read-through with a hypothetical
  enterprise-restricted Claude Code persona — does the doc
  answer "what works, what doesn't, what to do about it?"

---

## 6. Verification

Smoke-walk items added pre-cut:

1. **CLAUDE.md insert (clean home).** Move `~/.claude/CLAUDE.md`
   aside; relaunch Duo; confirm file is created with the block.
2. **CLAUDE.md insert (existing content).** Restore CLAUDE.md;
   relaunch; confirm block appended without modifying surrounding
   content.
3. **CLAUDE.md respect-removal.** Remove the block; relaunch;
   confirm block does NOT come back.
4. **Vocabulary pointer.** Open `~/.claude/skills/duo/make-page.md`
   in any reader; follow the Vocabulary lock pointer; confirm it
   resolves to a real shipped file (not an unreachable repo
   reference).
5. **Non-DUO_SESSION priming.** Open Terminal.app (not iTerm-via-
   Duo); start a Claude Code session; ask a Duo-shaped question;
   confirm Claude knows what Duo is from the managed block.

---

## 7. Open questions

(None blocking; defer or close.)

- Should the managed block include a one-line version note (e.g.,
  "managed by Duo v0.6.X — refresh by relaunching Duo after
  upgrade")? Probably yes, but as a comment line, not visible
  prose. Decide during implementation.
- Should the install banner mention that the block was added?
  Lean toward yes — transparency. One-liner: "We added a thin Duo
  reference to your `~/.claude/CLAUDE.md`. You can edit or remove
  it anytime."
- Does ENH-090 need a sibling in the FAQ? Probably not — FAQ is
  for end users; enterprise-deployments is for the agent-driven
  troubleshooting loop. Different audiences.
