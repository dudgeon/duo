# ENH-203 — Duo skill ecosystem: bring the bundled skill up to standard + keep it current

> **Status:** ✅ Executed 2026-06-06 — all phases shipped, currency gate green (`check-skill-currency --strict` exit 0), synced to `~/.claude`. Pending owner review + version cut. Deferred fast-follows tracked in `tasks.md` ENH-203.
> **Priority:** Owner-requested. **Effort:** L (phased). **Owner:** Geoff.
> **Authored:** 2026-06-06, from a 6-agent parallel audit of the shipped skill
> tree + the four external skill-authoring docs.
> **Touches:** `skill/**`, `agents/duo.md`, `cli/duo.ts` (printHelp), `scripts/`,
> `package.json`, `CLAUDE.md`, `.claude/rules/cli-plumbing.md`, `docs/CLI-COVERAGE.md`,
> `electron/install-service.ts`.

---

## 1. North star

**The job of the bundled `duo` skill is to make a non-SWE user's Claude Code
default to fluent, skilled, and *safe* use of Duo's affordances — without the
user ever needing to know the `duo` CLI exists.**

The user does not read the skill; their agent does, and must act competently
and safely on their behalf. Everything below serves that sentence.

## 2. Target persona (who the agent is acting for)

Primarily **non-software-engineers, relatively new to Claude Code**. Implications
the skill must honor:

- **No CLI noise dumped on them.** Prefer delegating multi-step `duo` sequences
  to the Haiku subagent; return outcomes, not transcripts.
- **Don't assume they can debug.** When `duo` fails, the agent diagnoses
  (`duo doctor`) and surfaces a plain-language cause — it never hands the user a
  stack trace or asks them to run shell archaeology.
- **Never circumvent their employer's controls.** Many run Duo on a managed Mac.
  The agent must surface IT/sandbox blocks, not work around them.
- **They can't tell when a doc is wrong.** A phantom verb or dead link in the
  skill becomes *their* failure, unrecoverable without the agent self-correcting.
  Correctness is therefore a persona-safety property, not a nicety.

## 3. Why now

The skill ecosystem has not been reviewed holistically in a long time and has
**drifted measurably**. A parallel audit (6 agents; full evidence in the
ENH-203 workflow transcript) found the skill fails most external best-practice
gates and ships **live, agent-breaking defects** — including a phantom verb in
the always-on priming layer that is injected into *every* Duo session.

## 4. The standard we're holding to (external best practices)

Sources (owner-provided + the canonical Anthropic set):

- [Claude Code — Skills](https://code.claude.com/docs/en/skills)
- [Anthropic — Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Anthropic — Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [OpenAI Codex — Skills](https://developers.openai.com/codex/skills)

Distilled gates, with Duo's current compliance:

| # | Gate (with hard number where one exists) | Source | Duo now |
|---|---|---|---|
| G1 | **SKILL.md body < 500 lines** | Anthropic BP | ❌ **827 lines / 65 KB** (65% over) |
| G2 | No single in-body section dominates (> ~150 lines → bundle it) | Anthropic BP | ❌ `## Patterns` = **458 lines** (55% of file) |
| G3 | **Level-2 body < 5k tokens** (3-tier loading: metadata always-on ~100 tok; body on-trigger; refs on-demand) | Anthropic overview | ❌ body ≈ **16–18k tokens** (3–4×) |
| G4 | `description` ≤ 1024 chars, third-person, states what + when ("use when…") | Anthropic BP | ⚠️ 937 chars (PASSES ceiling) but one run-on sentence; trigger not front-loaded |
| G5 | `name` ≤ 64 chars, lowercase/hyphen, no `claude`/`anthropic` | Anthropic BP | ✅ `duo` |
| G6 | **References one level deep** from SKILL.md (no depth-2 reads) | Anthropic BP | ❌ make-page / lesson-runtime / playground-interaction / atelier-css reachable only via make-playground.md |
| G7 | **Reference files > 100 lines need a `## Contents` TOC** | Anthropic BP | ❌ **0 of 10** qualifying files have one |
| G8 | Standard layout: `scripts/` (executed) · `references/` (docs) · `assets/` (templates) | Anthropic BP + Codex | ⚠️ `references/` ✅; no `scripts/`/`assets/`; hook in `hooks/`, templates in `examples/` |
| G9 | Portable forward-slash paths; no absolute machine paths | Anthropic BP | ⚠️ `references/vocabulary.md` links `../../../../Documents/GitHub/duo/CLAUDE.md` |
| G10 | No orphans (everything readable is reachable) | Anthropic BP | ❌ 5 `examples/*.md` shipped with zero inbound links |
| G11 | No time-sensitive/ticket prose in body; collapse to history | Anthropic BP | ⚠️ **108 ticket tags** (ENH-/BUG-/Stage/Sprint/PRD/D-num) in agent-facing prose |
| G12 | Explicit safety directive: never circumvent host/IT/sandbox; never exfiltrate | Anthropic overview | ⚠️ strong *mechanical* gating (browser-mode, `--i-understand`, allowlist) but **no stated principle** |
| G13 | Default-with-escape-hatch; one focused job | Anthropic BP + Codex | ⚠️ very broad surface (driving + authoring + lessons + install) |
| G14 | Local installs only (no global/sudo on default path) | Anthropic overview | ✅ auto-shim PATH; `--system` flagged "not recommended" |
| G15 | ≥3 evals; tested on every targeted model (Haiku/Sonnet/Opus) | Anthropic BP | ❔ Haiku subagent ships; **no eval artifacts** found |
| G16 | (Codex) skills list capped ~8k chars when window unknown → front-load triggers | OpenAI Codex | ⚠️ description leads with a surface enumeration, not the trigger |

## 5. Current-state defect ledger (what's actually broken)

The "no regressions / go green on first run" requirement means these get fixed
**in the same change** that adds the guard. Categorized, highest-blast-radius first:

### 5a. Live correctness defects (agent-breaking)

| ID | Where | Defect | Fix |
|---|---|---|---|
| C1 | `skill/priming.md:11` | Phantom verb **`duo files`** in the **always-on** layer (every session) | → `duo status` (open tabs) / `duo ls` (dir) |
| C2 | `SKILL.md:665,673` + `playground-interaction.md:277,290` + 2 template comments | Dead links to **`canvas-authoring.md` / `canvas-interaction.md`** — renamed; `sync:claude` even `rm`s them | → `make-page.md` / `make-playground.md` / `playground-interaction.md` |
| C3 | 5 spokes (27×) + 5 templates (10×) | Phantom op **`duo html update`** (never existed) | → `duo html set` (innerHTML) / `replace` (outerHTML) |
| C4 | `SKILL.md:675` | Same phantom `duo html … update` in the hub | → `set`/`replace` |
| C5 | `references/enterprise-deployments.md:157-159` | Phantom **`duo about` / `duo whereami`** (audience = users in broken installs) | → `duo doctor` |
| C6 | `SKILL.md:826` | Version gate **"targets v0.1.x"** (app is **0.9.2**) — agent distrusts every pattern | Template from `package.json` / `$DUO_VERSION` |
| C7 | `SKILL.md` + `agents/duo.md` | **`duo pack list\|uninstall`** undocumented (only `packs` alias) → subagent can't reach pack uninstall | Add rows |
| C8 | `cli/duo.ts` printHelp | Omits real verbs **`image`, `pack`**; false-positive token `modify`; `nav-state`/`nav state` split | VERBS[] refactor (see §7) |
| C9 | `SKILL.md` html table | Real verb **`duo html click`** undocumented | Add row |

### 5b. Stale / orphaned content

| ID | Where | Defect | Fix |
|---|---|---|---|
| S1 | `examples/html-canvas-authoring.md` | Frozen Stage-17a museum piece — tells the agent **shipped features don't exist** and **not** to use `data-duo-id` | **Delete** + drop `cp` |
| S2 | `examples/{read,edit}-google-doc.md`, `fill-form.md`, `iterate-artifact.md` | Orphans; duplicate `references/google-docs.md` + SKILL.md sections | Cut (or index — see D-scope) |
| S3 | 9 files | Still teach deprecated **`<meta duo-open-in>`** router (ENH-156 made it verb-driven) | One sweep → "ignored legacy" framing |
| S4 | `playground-interaction.md` (whole file) | Wrong on 3 axes at once (dead links + duo-open-in + `html update`); no frontmatter | **Rewrite in one pass** (CLAUDE.md rule 7g) |
| S5 | `references/vocabulary.md:16` | Absolute machine path to `CLAUDE.md` | Stable in-skill reference or drop |
| S6 | `BUILD-PROCEDURES.md` | Repo-dev-only but stale (v0.1.0, Stage gates) + orphan | Refresh or fold into CLAUDE.md + delete |

### 5c. Structural root cause — why it drifted

- **4-way verb duplication.** 64 of 65 CLI verbs are re-documented, often
  near-verbatim, across `SKILL.md` + `agents/duo.md` + `docs/CLI-COVERAGE.md`
  (+18 in `priming.md`) ≈ **~256 hand-maintained cells.** Every new verb is a
  4-surface manual edit; drift is inevitable (proof: `duo pack` already drifted).
- **Zero mechanical enforcement.** The "CLI is the spec" rule lives only in
  prose (CLAUDE.md rules 3/8/9, `cli-plumbing.md`, ~26 MEMORY entries). The repo's
  only `check:*` guard is `check-materialization.sh`; **no CI** (`.github/workflows`
  absent), no git hooks. The advisory rule is exactly the gap the owner flagged.
- **`sync:claude` is a hand-listed ~40-step `cp` chain** with no completeness
  check — a new sub-doc silently fails to ship unless someone edits the one-liner.
- **`priming.md` deployment drift.** The installed `~/.claude/duo/priming.md`
  is bootstrap-only (`install-service.ts` "preserved verbatim"), so repo fixes
  **never reach installed users**; the live copy is already missing the BUG-085
  safe-edit line. Priming is also double-injected (PATH shim + SessionStart hook)
  → ~2× always-on cost.

## 6. Requirements

- **R1 — Fluency by default.** The hub routes the agent to the right verb fast;
  the ~12 everyday verbs are surfaced; multi-step work delegates to the subagent.
- **R2 — Persona-appropriate.** No CLI noise; diagnose-don't-delegate-to-user;
  plain-language outcomes. (§2)
- **R3 — Safe.** An explicit, stated directive: **never circumvent the host's
  IT/sandbox/browser-mode controls; never exfiltrate user data; surface — don't
  bypass — a managed-policy block.** Capabilities (`browser-mode unfiltered`,
  `dangerouslyDisableSandbox`) stay *documented*; the *behavior* is gated.
- **R4 — Correct.** Zero phantom verbs, zero dead links, version-accurate, across
  every shipped surface. The currency guard goes green only when 5a/5b are fixed.
- **R5 — Lean + progressively disclosed.** Meets G1–G3, G6, G7. Complete files
  are one hop from SKILL.md; long references carry a TOC.
- **R6 — Self-current.** A mechanical guard fails the moment a verb is added to
  the CLI without landing in every required surface (the explicit owner ask).
- **R7 — Parity preserved.** Nothing that breaks CLI/UI parity is *deleted*;
  persona-irrelevant verbs are *relocated* to a full reference, not removed.
- **R8 — Single-source verbs.** Reduce the 4-way duplication so currency is cheap.

## 7. Target architecture

### 7a. The hub becomes a router (~200 lines, hard ceiling 500)

`SKILL.md` keeps only: the north-star/when-to-use intro, in-Duo detection
(`DUO_SESSION`), the **safety directive (R3)**, the subagent-delegation rule, the
two **CRITICAL "never Write/Edit an open file"** callouts (hoisted *above the
fold* so a one-shot read never misses them), a **~12-verb "most-used" quick
table**, the high-frequency browser/editor flows, and **one-level-deep pointers**
to everything else. The 458-line `## Patterns` block and the ~99-row command
table move out.

### 7b. Bundled layout (adopt the standard names)

```
skill/
  SKILL.md                      # lean router (≤500, target ~200)
  references/
    cli-reference.md            # FULL ~99-verb table (parity home) + "Workspace & session" subsection
    patterns-browser.md         # ex-Patterns: DOM, forms, artifacts, diagnose-failure
    patterns-editor.md          # ex-Patterns: selection transform, rewrite, comments pointer
    patterns-canvas.md          # ex-Patterns: page/playground authoring pointers
    install-troubleshooting.md  # ex-"command not found" archaeology
    debugging.md                # ex-console/errors/network triage
    comments.md  google-docs.md  sandbox-troubleshooting.md  enterprise-deployments.md  vocabulary.md  atelier-css.md   # existing
    duo-atelier.css  distro-v1-schema.json                                                                              # data (parsed, not executed) — stays
  scripts/
    duo-open-file-guard.sh      # moved from hooks/ (the sole executable) — update install-service.ts source path
  assets/
    canvas-templates/*.html     # moved from examples/ (templates, not prose)
  make-page.md make-playground.md playground-interaction.md lesson-runtime.md lesson-flythrough.md   # spokes, each linked one-level-deep + given a ## Contents TOC
```

Every reference > 100 lines gets a `## Contents` TOC (G7). All 5 heavy authoring
docs get **direct** links from SKILL.md (G6).

### 7c. Currency machinery (the keep-current deliverable, R6/R8)

1. **Prerequisite — `cli/duo.ts` printHelp renders from a structured
   `const VERBS = [{name, aliases?, summary, since?}]`.** This is the single
   source of truth both `printHelp()` and the guard read; it kills the parser
   ambiguity (false-positive `modify`), forces `image`+`pack` back into `--help`,
   and resolves `nav-state`/`nav state`. *(Mirrors how `build-cli.mjs` already
   injects `__DUO_VERSION__` from package.json.)*
2. **`scripts/check-skill-currency.mjs`** (Node, modeled on
   `check-materialization.sh`): default **warn-and-continue** with an actionable
   banner; `--strict` → exit 1. Assertions:
   - **A1 coverage** — every VERBS entry (+documented subcommands) appears in
     SKILL.md `references/cli-reference.md`, `agents/duo.md` cheat-sheet, and
     `CLI-COVERAGE.md` §1.
   - **A2 no phantoms** — every `` `duo <verb>` `` token in `priming.md`,
     `SKILL.md`, `agents/duo.md`, and the spokes resolves to a real VERBS entry.
     *(Catches C1, C3, C4, C5.)*
   - **A3 version** — version string in SKILL.md == `package.json` major.minor.
   - **A4 no dangling refs** — every relative skill-doc path resolves on disk and
     is not a name `sync:claude` `rm`s. *(Catches C2.)*
   - **A5 budgets** — SKILL.md ≤ ceiling lines; `description` ≤ char budget.
   - **A6 sync completeness** — `find skill -type f` ⊆ files `sync:claude` copies.
3. **Wiring:** append to `predev`/`pretest` (`--quiet || true`, non-blocking
   local feedback) · add `--strict` gate to the **cut-version** skill (no version
   ships drifted).
4. **Process:** a short section in `.claude/rules/cli-plumbing.md` (already globs
   `cli/**` + the doc surfaces) + a one-line pointer in CLAUDE.md rules 3/9:
   *"After adding/renaming a verb, run `npm run check:skill-currency`."*

### 7d. Always-on priming + deployment drift

Trim `priming.md` to ~8–10 lines (you're in Duo · prefer `duo` verbs · `duo status`
before Edit/Write · **never bypass the sandbox/policy — `duo doctor` to diagnose** ·
delegate multi-step to the subagent · full reference = the duo skill). Fix C1.
Add a **duo-managed region** seam (like the distro `priming-additions` block) so
repo fixes propagate on upgrade, + a version stamp `duo doctor` can flag.

## 8. Quality checks (mechanical, enforceable)

QC1 SKILL.md ≤ 500 lines (target ~200) · QC2 no section > ~150 lines · QC3
`description` ≤ 1024 chars (target ≤ 500), third-person, trigger front-loaded ·
QC4 every doc one-level-deep from SKILL.md · QC5 every ref > 100 lines has
`## Contents` · QC6 layout = scripts/ + references/ + assets/ · QC7 portable
paths only · QC8 no orphans · QC9 no ticket/version stamps in agent body (per D1) ·
QC10 safety directive present · QC11 zero phantom verbs · QC12 full verb coverage
across surfaces · QC13 version gate == package.json · QC14 (stretch) ≥3 evals on
Haiku/Sonnet/Opus. QC1–QC8, QC11–QC13 become `check-skill-currency` assertions.

## 9. Decisions (locked 2026-06-06)

- **D1 — Ticket tags → REMOVE from the skill; preserve provenance as structured
  data.** Strip every ENH-/BUG-/FOLLOWUP-/Stage/Sprint/PRD/D-num tag from all
  agent-facing surfaces (they carry zero runtime value). Their one legitimate use
  — verb↔feature coverage validation — is served better by a `since` field on each
  `cli/duo.ts` `VERBS[]` entry (contributor-facing source, machine-readable by the
  currency guard) + surfaced in `docs/CLI-COVERAGE.md`. Provenance stays in the
  repo, out of the shipped skill, and becomes *usable* for coverage checks.
- **D2 — Currency = Check-first.** Ship `check-skill-currency` + the `VERBS[]`
  printHelp refactor now; **generating** the doc tables from `VERBS[]` is a tracked
  fast-follow (see FOLLOWUP, §10).
- **D3 — One lean skill.** Driving + authoring stay in one skill; authoring lives
  in load-on-demand spokes linked one level deep.
- **D4 — Execute all phases this session** (Phases 1–3): live fixes + guard first,
  then the content refactor, then verify.

## 10. Implementation plan (phased; no regressions)

- **Phase 0 — Track & baseline.** This PRD + `tasks.md` ENH-203. Snapshot current
  `find skill -type f`, line counts, and `npm run typecheck` green.
- **Phase 1 — Correctness + currency guard (D4a).** Fix every 5a/5b defect;
  VERBS[] printHelp refactor (D2); `check-skill-currency.mjs` + wiring (§7c);
  `priming.md` trim + drift seam (§7d). `npm run build:cli`, `sync:claude`,
  `check:skill-currency --strict` green. Verify installed copies at
  `~/.claude/skills/duo/` + `~/.claude/duo/priming.md`.
- **Phase 2 — Progressive-disclosure refactor (§7a/7b).** Move the command table
  + Patterns into `references/`; create `scripts/` + `assets/`; one-level links;
  TOCs; safety directive; tighten description; rewrite `playground-interaction.md`;
  ENH-156 sweep. Update `sync:claude` (prefer `rsync`). Guard stays green.
- **Phase 3 — Verify + ship.** No-regression check: every pre-refactor capability
  still reachable (diff the verb/flow inventory before/after); subagent
  discoverability gap closed; `smoke-walk` if any renderer-observable surface
  changed; `cut-version`.
- **Stretch — Evals (QC14).** ≥3 scenarios run on Haiku/Sonnet/Opus.

## 11. Out of scope / non-goals

- The repo's **dev-only** `.claude/skills/` (worksheet, smoke-walk, sprint-plan,
  cut-version) — not user-installed.
- Adding/removing CLI **capability** — this is a docs/structure/currency change,
  not a feature change. (The VERBS[] refactor is behavior-preserving.)
- Re-litigating the page/playground/canvas vocabulary (locked in DECISIONS.md).

## 12. Success criteria

Guard green on first run · SKILL.md ≤ 500 lines · zero phantom verbs / dead links
across shipped surfaces · explicit safety directive present · a new CLI verb that
skips a doc surface **fails the currency check** · installed `~/.claude` copies verified current ·
no capability regressions.
