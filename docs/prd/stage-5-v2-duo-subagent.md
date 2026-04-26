# Stage 5 v2 PRD — Duo subagent (broader scope, smaller model)

> **Status:** drafted 2026-04-26 evening, after a measurement pass
> validated the orchestrator-context savings hypothesis (~85% token
> reduction; ~50% wall-clock).
> **Slot in roadmap:** sequenced **before Stage 15** in the layered
> build order — see ROADMAP.md § Layered build order. Treated as a
> v2 of the original Stage 5 ship (skill + `duo-browser` subagent),
> not a new stage number, because the renumber on 2026-04-26 was
> explicit about the build-order semantics and inserting a new
> integer would break the meaning of the existing ones.
> **References:**
> - [docs/VISION.md](../VISION.md) — collaboration as the flagship bet
> - [docs/CLI-COVERAGE.md](../CLI-COVERAGE.md) — the verb inventory the agent operates against
> - [skill/SKILL.md](../../skill/SKILL.md) — the orchestrator-side skill
> - [agents/duo-browser.md](../../agents/duo-browser.md) — the v1 subagent (this stage subsumes it)
> - [docs/prd/stage-18-first-launch-installer.md](stage-18-first-launch-installer.md) — installer that ships the agent file to `~/.claude/`

---

## 1. What we're building

A single, broader subagent — **`duo`** — that takes a high-level Duo
goal from the orchestrator and drives the `duo` CLI to completion,
returning a clean markdown summary. Subsumes `duo-browser` (v1). Runs
on **Claude Haiku 4.5** so per-turn latency and cost are well below
the orchestrator's tier.

Today the orchestrator (whatever Sonnet/Opus tier the user is running
in Claude Code) does two jobs at once: it plans what the user is
asking for AND it drives the CLI verb-by-verb. Each Bash tool call
costs an orchestrator turn. Each CLI output dumps JSON into the
orchestrator's context. The CLI itself is fast (40–60 ms steady
state, measured); the bottleneck is **orchestrator-turn cost** and
**context pollution**, not transport.

A focused subagent moves the orchestration to a model that's
purpose-fit for it:

| | Inline (today) | Subagent (this stage) |
|---|---|---|
| Orchestrator turns per multi-step task | 5–10 | **2** (delegate + parse summary) |
| Orchestrator context per task | 1,500–2,500 tokens | **300–400 tokens** |
| Wall-clock | 15–25 s | 10–15 s |
| Cache prefix pollution across tasks | high | none |
| Recovery on unexpected CLI errors | orchestrator decides | agent surfaces, orchestrator decides |

The numbers are from a measured 5-verb representative task on
2026-04-26 (read + selection + write + verify, the same shape as
Send → Duo's flagship loop). Full data in
[CLAUDE.md § Latest session](../../CLAUDE.md).

## 2. Personas + jobs to be done

**Primary persona:** the orchestrating Claude Code instance the user
talks to — Sonnet 4.5 / 4.6 / 4.7 / Opus, depending on the user's
Claude Code config. The user is whatever PM is using Duo.

**Jobs the subagent does:**

- "Open this `.md`, read it, replace the third paragraph with the
  text I'm passing you, verify the buffer reflects the change."
- "Navigate the browser to this URL, extract the main heading and
  the first three list items, return them."
- "List the markdown files in the navigator's current cwd, read
  each, and tell me which ones mention 'risk'."
- "There's a selection in the editor. Tell me what's selected and
  what its surrounding context is so I can decide what to do next."
- "Apply the rewrite I'm passing you to the active editor.
  Acknowledge the just-added highlight fired."

**Jobs the subagent does NOT do:**

- Decide *what* to write. Content authoring is the orchestrator's
  job; the subagent applies content the orchestrator hands it. (See
  A8.)
- Make architectural decisions about the user's task. The
  orchestrator owns "what should this commit do?"; the agent owns
  "how do I land this paragraph in this editor."
- Run outside Duo. The agent assumes a live `duo` CLI socket; if
  it isn't reachable, it surfaces and stops.

## 3. Decisions

(All "**P**" — proposed defaults — until kickoff. Owner-confirmed
become "**C**.")

| # | Area | Decision |
|---|---|---|
| **Identity** | | |
| A1 **P** | **Name** | `duo`. Symmetric with the CLI verb (`duo ...` in shell vs. `duo` in Claude Code's subagent namespace). Cleaner than `duo-cli` or `duo-agent`; the subagent IS the Duo agent. Conflict surface is nil — agent names live in `~/.claude/agents/`, CLI names in `$PATH`. |
| A2 **P** | **Model** | `claude-haiku-4-5`. CLI orchestration is bounded, mechanical, and pattern-heavy — Haiku territory. Frontmatter makes the swap to Sonnet trivial if recovery proves brittle. |
| A3 **P** | **Scope** | Full `duo` CLI surface (browser + editor + files + nav + theme + cozy + selection + send). The agent is the canonical Duo-CLI driver. |
| A4 **C** | **Subsume `duo-browser`** | Yes — delete `agents/duo-browser.md`. Browser orchestration is a special case of "drive `duo` for a multi-step task"; two subagents = two prompts to keep in sync = drift. |
| **Contract** | | |
| A5 **P** | **Goal shape** | Orchestrator passes a natural-language goal plus, when relevant, the **content** the agent should apply (rewrite text, URL to navigate to, etc.). The agent does not generate content; it applies it. (See A8.) |
| A6 **P** | **Output shape** | Markdown summary by default — what the agent did, what it observed, what (if anything) needs orchestrator follow-up. Optional `format: json` for callers that want structured data. No trace by default (A11). |
| A7 **P** | **Concurrency** | Two `duo` subagents calling the CLI in parallel is undefined behaviour for v1. The CLI socket is unlocked, so calls technically interleave, but the underlying state (active editor, browser tabs) isn't designed for concurrent mutation. Skill teaches: **one agent at a time**. |
| A8 **P** | **Content authority** | The orchestrator drafts; the subagent applies. The agent's contract excludes creative writing or open-ended summarization — those are orchestrator turns. This keeps Haiku in its lane and makes failures predictable. The orchestrator can ask the agent to "read and report what's at /path", but transformations on that content come back to the orchestrator. |
| A9 **P** | **Cold-start optimization** | Before opening a file, the agent checks `duo nav state` to see if it's already open. If so, skip the `duo edit` cold-start (~150 ms savings per task). Same idea applies to the active browser tab — prefer `duo url` over `duo open` when the URL is already loaded. |
| **Errors** | | |
| A10 **P** | **Failure mode** | Hard fail to orchestrator. If a CLI verb errors, the agent surfaces the error in its summary and stops. The orchestrator decides whether to retry, fall back to inline CLI, or ask the user. No silent recovery, no improvisation on unexpected error shapes. |
| A11 **P** | **Trace mode** | Deferred. v1 returns the summary only. If debugging gets hard, add an opt-in `trace: true` in the goal that returns the per-verb call log. The agent records the calls anyway (for its own reasoning); the question is just whether to expose them. |
| **Installation + lifecycle** | | |
| A12 **P** | **Install path** | `~/.claude/agents/duo.md` — global, same scope as `~/.claude/skills/duo/SKILL.md` (locked Stage 5 D-decision). Per-project agents are out of scope; matches the existing skill scoping. |
| A13 **P** | **Bundled with the app** | Yes. The Duo `.app` bundle includes `agents/duo.md` in `extraResources` (same shape as Stage 18's bundling for the skill). Stage 18's first-launch installer copies it to `~/.claude/agents/duo.md`. |
| A14 **P** | **Update model** | Every time the user opens a new Duo build, the installer detects whether `~/.claude/agents/duo.md` matches the bundled version. If it doesn't and the user hasn't modified it locally (a content hash check), overwrite silently. If user-modified, prompt: "Duo wants to update the duo subagent. Your local edits will be overwritten. [View diff] [Overwrite] [Keep mine]." Same shape as the equivalent skill-update flow in Stage 18. |
| A15 **P** | **Dev-side sync** | `npm run sync:claude` (already exists for the skill + `duo-browser`) extends to copy `agents/duo.md`. One-line change in the script. End users don't run this; it's a dev convenience. |
| A16 **P** | **Uninstall** | Out of scope for v1. Same as the skill: the file stays in `~/.claude/agents/` after the user removes Duo. Acceptable because the skill explicitly checks `duo --version` before doing anything; a stale agent file with no live socket is inert. |
| **Validation** | | |
| A17 **P** | **V1 testing** | Manual fixture set + smoke checklist update. See § 6 for the fixtures. No automated harness in v1; we want to ship and learn before investing. |
| A18 **P** | **V2 testing** (follow-up, not this stage) | Bash + Claude Code SDK eval harness that runs each fixture, captures wall-clock + token cost, and asserts pass/fail against expected outputs. Lives in `tests/duo-agent/`. |
| A19 **P** | **Smoke checklist** | New section in `docs/dev/smoke-checklist.md` § Agent: walk one fixture per release, verify orchestrator-context savings vs inline, verify no regressions in browser/editor flows. |
| **Session containment** | | |
| A20 **C** | **Session-guard env-var check** | Because the agent installs globally at `~/.claude/agents/duo.md`, **every** Claude Code session on the user's machine sees it — including non-Duo terminals (a normal iTerm, a VS Code integrated terminal, a CI runner, etc.). Without a guard, the orchestrator running outside Duo could route a Duo-flavored request to the agent, the agent would burn turns trying CLI verbs that fail with `Cannot connect: Duo app is not running`, and the user gets a confusing failure rather than a clean refusal. **Guard:** the agent's first action on every invocation is to check `$DUO_SESSION`. Stage 19a Phase 19a (commit `640ec0e`) exports `DUO_SESSION=1` for every Duo PTY (alongside `DUO_SOCKET=<path>` and `DUO_VERSION=<app-version>` — all visible via `electron/pty-manager.ts:33-35`). If `$DUO_SESSION` is unset or empty, the agent refuses cleanly with a one-line message naming the cause, and does not invoke any `duo` verb. The orchestrator gets a clean signal to fall back to non-Duo tooling. |
| A21 **P** | **Skill-side guard (orchestrator)** | The skill (`SKILL.md`) gets a parallel "When to delegate to `duo`" rule: **only delegate if `$DUO_SESSION=1`**. The orchestrator can `echo $DUO_SESSION` once at task kickoff to decide. This is belt-and-suspenders: the agent's own A20 guard is the load-bearing one (since the agent could be invoked in ways the skill doesn't see), but checking on the orchestrator side avoids a wasted delegation round-trip. |
| A22 **P** | **Stale-session handling** | If `$DUO_SESSION=1` is set but the socket is dead (e.g., the Duo app crashed mid-session, leaving the env var in the shell), the agent proceeds normally and lets the first CLI verb fail with the CLI's own `Cannot connect: Duo app is not running` message. That's already a clean error shape; no special path needed. The point of A20 is to short-circuit the case where the env var was never set — i.e., we're not in a Duo terminal at all — not to detect every possible runtime sadness. |
| **Browser routing** | | |
| A23 **P** | **Default route → Duo browser; configured exceptions → system default browser** | The Duo app's premise is that web work happens in the embedded `WebContentsView` (SSO-persistent, agent-readable). The agent's default routing is therefore: any web navigation goes through `duo open <url>` (or `duo navigate` for the active tab) — *not* macOS `open`. The exception is a configured list of hostnames where the embedded `WebContentsView` is known not to work well — common candidates today: `claude.ai`, `chatgpt.com`, any site the user prefers to keep in their hardened personal browser, sites that block Electron-Chromium UAs. The list lives at `~/.claude/duo/external-domains.json` (sibling of the skill + agent install paths), seeded empty by Stage 18's installer. Format: `{ "domains": ["claude.ai", "chatgpt.com"] }` — exact-match hostname or `*.suffix` glob, decided at kickoff. List ships empty for v1 — the user (or owner during development) populates it as friction is observed; we don't pre-judge which sites belong on it. |
| A24 **P** | **`duo external <url>` verb** | New CLI verb (Stage 5 v2 ships it as a sibling of the agent itself, since the agent needs it). Wraps `shell.openExternal(url)` (Electron API → macOS `open`) so the agent doesn't need shell access to anything other than `duo *`. Tool surface stays clean. The verb takes a URL, validates it parses, fires `shell.openExternal`, returns `{ ok: true, opened: "<url>" }`. Errors surface normally. **Agent decision algorithm:** (1) extract hostname from the target URL; (2) match against list — if listed, use `duo external <url>`; (3) otherwise, check `duo tabs` for an existing duo-browser tab on that hostname and `duo tab <n>` to it (avoids dup tabs) OR `duo open <url>` to create one. |
| A25 **P** | **Existing-tab preference (v1, simplest path)** | For Duo-routed URLs (i.e., not in the external-domains list), the agent SHOULD check `duo tabs` for an existing tab on the same hostname before opening a new one, but the call costs ~50ms and adds a turn — so v1 only does the existence check when the orchestrator's goal explicitly suggests reuse ("go to the github tab", "switch to the example.com tab"). For "open https://example.com" the default is just `duo open` and let the user have multiple tabs if they want them. Polish (fuzzy hostname matching, focused-tab preference, etc.) is a v2 follow-up. |
| A26 **P** | **List authoring + maintenance** | List content is owner-driven, not designed by this stage. Ship empty. As the owner uses Duo and observes "X site doesn't render right in WebContentsView" or "I want to keep banking-site cookies out of the duo-browser SSO partition," they add hostnames to `~/.claude/duo/external-domains.json` by hand. A future polish stage (Backlog: list editor in app preferences) adds UI; for v1 the file IS the UI. The skill's `SKILL.md` documents the file's existence so PMs running their own Duo can populate it. |

## 4. On-disk shape

A saved agent is a single markdown file with YAML frontmatter — same
shape as the existing `agents/duo-browser.md`:

```markdown
---
name: duo
description: |
  Drives the duo CLI to land Duo workflows. Use for any task
  involving the Duo app's browser, editor, file navigator, or
  selection — including any multi-step duo CLI sequence (3+
  verbs). Returns a markdown summary of what was applied and
  what to do next.
model: claude-haiku-4-5
tools:
  - Bash
---

# Duo subagent

You drive the duo CLI to land Duo-app workflows. The orchestrating
Claude has handed you a goal and (when relevant) the content to apply.

## Session guard (run this FIRST, every invocation)

Before doing anything else, check that you're inside a Duo terminal:

```bash
[ -n "$DUO_SESSION" ] && echo "in_duo" || echo "not_in_duo"
```

If the result is `not_in_duo`, **stop immediately** and return:

> I'm the Duo subagent — I only operate inside Duo terminal sessions.
> This terminal isn't a Duo session (`$DUO_SESSION` is unset), so I
> can't help here. Fall back to non-Duo tooling for this task.

Do NOT run any `duo` CLI verbs from a non-Duo terminal. They'll fail
with `Cannot connect: Duo app is not running` and burn turns for no
reason. The `DUO_SESSION` env var is exported by Duo's PtyManager for
every PTY launched inside the app, so its presence is the canonical
"am I inside Duo" signal.

## What you do

- Run `duo` CLI verbs to read state, navigate, and apply changes.
- Return a markdown summary of what you did + what was observed.
- Surface errors faithfully. Do not improvise on unexpected output
  shapes.

## What you do NOT do

- Generate content. Rewrites, summaries, drafts come from the
  orchestrator. You apply what's handed to you.
- Make architectural decisions. If the goal is ambiguous, ask the
  orchestrator (one round-trip back) rather than guessing.
- Run outside Duo. The session guard above catches this.
- Open URLs in the system default browser by default. Use Duo
  unless the URL's hostname is on the configured exception list
  (see "Web routing" below).

## Tools

You have one tool: `Bash`, restricted to `duo *` invocations (plus
the one-line session-guard echo above).

## Web routing — Duo browser by default; configured exceptions go external

Every web URL goes through Duo unless its hostname matches a domain
in `~/.claude/duo/external-domains.json`. Read that file at the
start of any task involving web navigation:

```bash
cat ~/.claude/duo/external-domains.json 2>/dev/null
```

Format: `{ "domains": ["claude.ai", "chatgpt.com"] }`. Empty or
missing file = no exceptions = everything goes through Duo. Match
on exact hostname or `*.suffix` glob (e.g. `*.banking-corp.com`).

Decision per URL:

1. **External (listed):** `duo external <url>` — opens in the macOS
   default browser via Electron's `shell.openExternal`. The user's
   hardened personal browser handles it; Duo doesn't try.
2. **Duo (not listed):** prefer an existing tab on the same
   hostname when the orchestrator's goal hints at reuse ("go to
   the github tab"). Use `duo tabs` to find it and `duo tab <n>`
   to switch. Otherwise `duo open <url>` for a new tab.

Why the list exists: some sites (Claude.ai, ChatGPT, banking
sites, sites that block Electron UAs) work poorly in the embedded
`WebContentsView`. Sending those to the user's normal browser is
better than trying and failing visibly. The user or owner curates
the list as friction is observed; ship time it's empty.

## Verb cheat-sheet

[full duo CLI verb table — abbreviated form of skill/SKILL.md, tuned
for orchestration patterns]

## Patterns

[5 examples covering top task shapes — read+rewrite editor, browser
extract, multi-tab orchestration, file-tree exploration, Send → Duo
round-trip]

## Failure protocol

[how to surface errors, when to escalate]
```

Length budget: ~200–300 lines. Compact enough that Haiku's prefix
caches efficiently across tasks within a session.

## 5. Installation lifecycle

End-to-end picture, integrating with the existing pieces:

```
Dev (us)
├── Edit agents/duo.md in the repo
├── npm run sync:claude   →   ~/.claude/agents/duo.md (immediately visible to dev's Claude Code)
└── Commit + ship in next Duo .app build

App bundle (Stage 18)
└── electron-builder.yml extraResources: [skill/, agents/]   (already bundles `agents/`; just adds the new file)

End-user, first launch (Stage 18 consent flow)
├── User double-clicks Duo.app
├── Consent sheet: "Duo will install the duo CLI, the duo skill, and the duo subagent into ~/.claude/. [Install] [Cancel]"
├── On Install: fs.copyFile from app bundle → ~/.claude/agents/duo.md (and the skill, and the CLI)
└── Subsequent Claude Code session: subagent auto-discovered

End-user, app update
├── Existing user opens new Duo.app build
├── Installer hashes ~/.claude/agents/duo.md vs the bundled version
├── If unchanged from previous bundled: silent overwrite
├── If user-modified: "Duo wants to update the duo subagent. [View diff] [Overwrite] [Keep mine]"
└── Either path leaves a single canonical file at ~/.claude/agents/duo.md
```

The key load-bearing piece is **A14** (update model). We must not
silently clobber user customization. The hash-and-prompt flow is
the same shape Stage 18 needs for the skill itself; this stage
doesn't introduce new installer machinery, it just adds one more
file to the existing flow.

## 6. Validation matrix

Three classes of validation. V1 covers all three manually; V2
(deferred) automates Class B and C.

### Class A — Functional ("does the agent do what's asked?")

A small fixture set in `agents/duo-tests.md` (committed alongside the
agent so the contract is co-located with the code). Each fixture is a
natural-language goal + the expected effect. Manually walked once
per release.

| # | Fixture | Goal | Verifies |
|---|---|---|---|
| F1 | Read-rewrite-write | "Open `/tmp/foo.md`, read its content, then replace the second paragraph with this text: <text>." | Editor open, content matches on disk after debounce. Just-added highlight fires. |
| F2 | Browser extract | "Navigate to https://example.com, extract the H1 and the first three list items, return as JSON." | URL loaded; structured extraction returned. |
| F3 | Multi-tab orchestration | "Open https://a.com, https://b.com, and https://c.com in three tabs. Tell me the title of each." | Three tabs open; titles correct. |
| F4 | File-tree exploration | "List markdown files in `/tmp/test-dir/`. Read each. Tell me which ones contain the word 'risk'." | Correct file list returned. |
| F5 | Send → Duo round-trip | "Read the active editor's selection. Apply this transformation: <text>. Verify it landed." | Selection read, write applied, just-added highlight visible. |
| F6 | Error recovery | "Read `/nonexistent/path.md`." | Agent surfaces clean error; orchestrator can branch on it. |
| F7 | Already-open editor | "Open `/tmp/foo.md` (already open in another tab)." | No cold-start cost; agent reuses the existing tab. |
| F8 | **Web routing — default Duo path** | "Navigate to https://example.com and read the H1." | URL opens via `duo open`, NOT `duo external`. H1 returned. |
| F9 | **Web routing — listed external** | Seed `~/.claude/duo/external-domains.json` with `claude.ai`. Goal: "Open https://claude.ai/new". | URL opens via `duo external`, NOT `duo open`. Agent surfaces "Opened in your default browser." Duo's tab list unchanged. |
| F10 | **Web routing — existing-tab reuse** | Pre-open https://example.com in a Duo tab. Goal: "Go to the example.com tab and read the H1." | Agent uses `duo tabs` + `duo tab <n>` to switch (no new tab created). |

### Class B — Performance ("does it actually save what we measured?")

For F1 + F5 (the two flagship shapes), capture:

- Orchestrator turn count: inline path vs subagent path.
- Orchestrator context tokens: inline vs subagent (token diff
  measured via the Claude Code SDK's usage report).
- Wall-clock: inline vs subagent.

Pass criteria for v1: ≥60% orchestrator-token reduction, ≥30%
wall-clock reduction. (Lower than the ~85% / ~50% from the initial
measurement to give margin for prompt overhead.)

### Class C — Recovery ("does it fail gracefully?")

Inject:

- C1: Duo socket missing. Agent should surface "Duo isn't running"
  cleanly, not retry.
- C2: CLI verb returns malformed JSON. Agent should surface raw
  output + "unexpected shape", not improvise.
- C3: Editor is in a new-file-name interstitial state. Agent
  should detect (`duo nav state` or similar) and surface, not
  fight the modal.
- C4: Browser is mid-navigation when a `duo click` arrives. Agent
  should `duo wait` or surface the timeout.
- **C5: Invoked outside Duo (no `$DUO_SESSION`).** Run the agent in
  a non-Duo terminal (a normal iTerm, a VS Code integrated terminal,
  or a Claude Code session that never launched from a Duo PTY).
  Agent should hit the A20 session guard, refuse cleanly with the
  one-line message naming `$DUO_SESSION` as the cause, and **not
  attempt any `duo` verb**. Verify zero `Cannot connect: Duo app is
  not running` errors in the agent's output — those would mean the
  guard didn't fire and the agent went on to invoke verbs anyway.
- **C6: Web routing — list parse failure.** Drop a malformed
  `~/.claude/duo/external-domains.json` (e.g. truncated JSON).
  Agent should fall back to the safe default (everything through
  Duo) and surface a one-line warning, NOT crash the task.
- **C7: Web routing — listed domain attempted via `duo open`.** If
  the orchestrator (or a poorly-trained future agent) tries to use
  `duo open https://claude.ai/new` for a listed domain, the duo
  CLI itself will open it in the embedded view — the routing
  decision is the agent's responsibility, not the CLI's. Agent's
  pattern in `agents/duo.md` must enforce the route before calling
  the verb. Verify by reading the agent's call log: no `duo open`
  for any listed hostname.

### Class D — Smoke ("don't break what already worked")

Replace the few duo-browser test cases that exercised the old
subagent. They should pass identically through the new agent.

## 7. Out of scope (v1)

- Concurrent agent invocations (A7). Locking is a Stage 5 v3.
- Trace mode (A11). Add only if debugging gets hard.
- Per-project agent overrides. Global only, matching the skill.
- Eval harness (A18). Manual walks first, automation later.
- Sonnet escalation logic. Hard fail to inline-CLI fallback.
- Agent self-update (independent of the Duo .app version). Out;
  the Duo install pipeline is the only update path.
- Voice or other modalities. Markdown summary only.

## 8. Open questions

| # | Question | Needed by |
|---|---|---|
| Q1 | Is `claude-haiku-4-5` the right model alias for the Anthropic registry as of ship date? Verify against current model list before merging. | First commit. |
| Q2 | Does Claude Code's subagent dispatch surface support `model: <name>` in YAML frontmatter today, or do we need a workaround? Verify against the v1.x docs. | Drafting `agents/duo.md`. |
| Q3 | When the orchestrator delegates, does the user see the subagent's intermediate turns in the Claude Code UI, or is it hidden? Affects A11 (trace mode) framing. | Before Class B perf measurement. |
| Q4 | Should the agent prompt include the full verb table (rich, ~500 LOC) or a compact reference (~100 LOC) plus a "look up details in the skill"? Latter saves prefix tokens; former is self-contained. | Drafting `agents/duo.md`. |

## 9. Build order

1. **Verify Q1 + Q2 + Q3 + Q4** (~30 min).
2. **Ship `duo external <url>` CLI verb** (A24) — wraps
   `shell.openExternal`. Single-purpose; ~30 LOC across `cli/duo.ts`,
   `electron/socket-server.ts`, `shared/types.ts`, plus a one-line
   entry in `docs/CLI-COVERAGE.md` and the new-verb plumbing
   checklist (see CLAUDE.md "CLI parity"). Rebuild `cli/duo` binary.
3. **Bootstrap external-domains list** (A23) — Stage 18's installer
   gets one extra step: ensure `~/.claude/duo/external-domains.json`
   exists with `{ "domains": [] }` if it isn't there yet. Never
   overwrite a populated file. (Update Stage 18 PRD; not breaking,
   just additive to the install sequence.)
4. **Draft `agents/duo.md`** (~half day) — full prompt, frontmatter,
   verb table, 5 patterns, failure protocol, **A20 session guard as
   the literal first instruction** in the prompt, A23/A24/A25 web
   routing pattern in the patterns section.
5. **Update `skill/SKILL.md`** — "When to delegate to the `duo`
   subagent" section, including the A21 orchestrator-side
   `$DUO_SESSION` check ("only delegate if you're inside Duo").
   Cross-link to the agent file. Document the
   external-domains.json file (A26) so PMs know it exists.
6. **Delete `agents/duo-browser.md`** — replace with a 1-line
   migration note in the skill.
7. **Update `npm run sync:claude`** to include the new agent file.
8. **Update `electron-builder.yml`** — confirm `agents/` is in
   `extraResources` (it is, per Stage 18 commit `20b4701`).
9. **Walk Class A fixtures manually.** Capture Class B numbers on F1
   + F5. **Walk C5 + C6 + C7 explicitly** — they're the
   load-bearing guard tests.
10. **Update `docs/dev/smoke-checklist.md`** with the new agent
    section. Include C5 outside-Duo walk and a quick web-routing
    walk (one Duo URL + one listed external URL).
11. **Ship.** Cross-link from CLAUDE.md, ROADMAP.md, roadmap.html.

Estimated total: ~1.5 dev days (added the new CLI verb + list
bootstrap). Lands before Stage 15 starts.
