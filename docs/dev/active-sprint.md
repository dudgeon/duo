# Active sprint state — Sprint 18 / v0.7.1 "Markdown source-of-truth + browser-pane completion"

**Theme:** Make markdown files self-describing — comments, track-changes, and frontmatter all visible inline (no sidecar JSON, no hidden YAML). Bundle the unified Stage 14 chapter (BUG-138) with frontmatter UX (BUG-139) since both are "content invisible via the editor" architectural-class fixes. Plus the smaller browser-pane carry-forwards.

> **Status (2026-05-18 evening):** Phase 1 of BUG-138 SHIPPED ([429b024](https://github.com/dudgeon/duo/commit/429b024)). All gates locked. Delivery plan finalized below — ready for compaction + continuation.

---

## 🔥 Post-compaction me: read this first

**v0.7.0 cut 2026-05-18** ([release](https://github.com/dudgeon/duo/releases/tag/v0.7.0)). Sprint 18 is the next-MINOR (v0.7.1) cycle.

**What's already shipped this sprint** (since v0.7.0 tag):
- BUG-136 — `gh` PATH augmentation in `execGit` (Clone modal false-negative fix).
- BUG-137 — Markdown `[text](url)` input rule + ⌘K shortcut.
- **BUG-138 Phase 1** — CriticMarkup parser/serializer + 4 TipTap marks + tiptap-markdown integration + visual rendering. **65 unit tests passing.** Owner verified Phase 1 rendering visually with `/tmp/bug-138-roundtrip-2.md`.
- ENH-163 round-2 — pill rename + 2 CDP-pill copies missed in v0.7.0 (rev6-rev2 fix).
- Multiple v0.7.0 doc-refreshes.

**Delivery order from here (LOCKED 2026-05-18):**

| # | Item | Why this order |
|---|---|---|
| 1 | **BUG-138 Phase 2** — sidecar→inline migration + `duo author [<name>]` verb | Foundational. Migration MUST land before users save modified files (else sidecar comments clobbered). Author identity is required for Phase 3 + Phase 4 marks to carry real attribution. |
| 2 | **BUG-138 Phase 3** — agent CLI verbs (`duo doc insert / delete / substitute / comment / accept / reject`) | Agent-side surface. Independent of UI. Lets the agent ACTUALLY USE the new architecture for tracked edits. Useful sanity-check before Phase 4 lands. Uses author identity from Phase 2. |
| 3 | **BUG-138 Phase 4** — Suggesting toolbar toggle + Accept/Reject UX (rail + bulk banner) | The visible payoff of the entire BUG-138 chapter. Builds on Phases 1–3. Without it, Phase 1's marks are renderer-only and have no user-facing invocation path. |
| 4 | **BUG-139** — Frontmatter Properties panel (B locked) | Orthogonal to BUG-138 chapter; same architectural class. Owner said "don't rush." Land after BUG-138 is fully cohesive. |
| 5 | **BUG-135** — Git ribbon strictness | Small, isolated. Path-traversal heuristic. |
| 6 | **ENH-164** — `duo terminal new --kind claude` verb | Small, isolated. Plumbing checklist. |
| 7 | **ENH-148** — Multi-select v2 (⇧-click range + ⌘-A + CLI parity) | Small, isolated. |
| 8 | **BUG-130** — Browser pane `file://` auto-reload | Architectural; may slip to Sprint 19 if 1–7 fills the sprint. |

**Cut target:** v0.7.1. MINOR if BUG-138 lands fully; PATCH if only the smaller items.

---

## BUG-138 — locked plan (Markdown comments + track-changes via CriticMarkup)

Locked decisions from [`docs/research/markdown-criticmarkup-comments-trackchanges.html`](../research/markdown-criticmarkup-comments-trackchanges.html):

- **Q1 body shape:** A · Pipe-delimited prefix (`{>>id:c-01|author:claude|ts:…|reply-to:c-00?|body<<}`).
- **Q2 scope:** A · All five CriticMarkup operations (comment + insert + delete + substitute + highlight).
- **Q3 author:** B · Named (`dudgeon` / `claude` / etc.).
- **Q4 CLI:** A · Explicit per-op verbs.
- **Q5 migration:** A · Silent auto-migrate on first load.
- **Q6 backward read:** A · Read-both-until-touched; sidecar comments deprecated v0.9.0.

### Phase 1 — Parser/serializer + 4 marks + visual rendering ✅ shipped 2026-05-18

- `core/markdown/criticmarkup.ts` — pure parser/serializer, 53 tests.
- `extensions/InsertionMark.ts`, `extensions/DeletionMark.ts`, `extensions/HighlightMark.ts` — new TipTap marks.
- `extensions/CommentMark.ts` rewritten with full metadata (id, author, ts, body, replyTo).
- `markdownCriticMarkup.ts` — bridge: `applyCriticMarkupFromText` (load-side) + `materializeCriticMarkupToJSON` + `serializeWithCriticMarkup` + `preprocessSubstitutions` (strikethrough collision shield).
- Wired into MarkdownEditor.tsx's load + save boundaries.
- CSS rendering for the 4 marks (insert=green / delete=red strike / highlight=amber / comment-anchor=accent).
- Total: 65 vitest cases passing.

### Phase 2 — Migration + `duo author` (next up)

**Migration helper** (`migrateSidecarCommentsToInline.ts` or fold into `markdownComments.ts`):
- On file load, if `sidecar.comments[]` has entries AND the body has zero CriticMarkup tokens:
  - For each sidecar comment, find its re-anchor position in the body (reuse the existing excerpt/context matching from `applyCommentMarksFromSidecar`).
  - Wrap the matched range as `{==…==}{>>id:<sidecar-id>|author:<sidecar-author>|ts:<sidecar-ts>|body<<}`.
  - Splice into the body text.
  - Update `lastSavedBodyRef` so the migration write doesn't false-positive as dirty.
  - Write the migrated file via the existing autosave path.
  - Clear `sidecar.comments[]` from the JSON sidecar.
- Idempotent (re-run on a migrated file no-ops).
- Tolerant of orphan comments (where re-anchor fails) — leave in sidecar, log a warning.

**`duo author [<name>]` CLI verb:**
- Plumbing checklist per CLAUDE.md § 4: shared/types DuoCommandName, preload bridge, ipcMain handler, socket-server case, cli/duo.ts, printHelp(), skill/SKILL.md, agents/duo.md cheat-sheet, docs/CLI-COVERAGE.md.
- Storage: `localStorage['duo:author']` for the human author. Defaults to `$USER` env var on first read.
- Agent author: populated automatically from agent-context (CLI tool sets via env var `DUO_AUTHOR` or arg; default `agent` if neither present).
- Read mode (`duo author` with no arg): prints `{ "author": "dudgeon" }`.
- Write mode (`duo author "name"`): persists + echoes.

### Phase 3 — Agent CLI verbs

**Six verbs** per Q4·A:
- `duo doc insert <file> --at <anchor> --text "…"` — wraps insertion at anchor, attributed to agent.
- `duo doc delete <file> --range <anchor-pair>` — wraps deletion mark over the resolved range.
- `duo doc substitute <file> --range <anchor-pair> --with "…"` — emits `{~~old~>new~~}`.
- `duo doc comment <file> --anchor <anchor> --body "…" [--reply-to <c-id>]` — anchored comment.
- `duo doc accept <file> --range <anchor-pair>` — strip insertion mark OR delete struck text OR resolve substitution to new.
- `duo doc reject <file> --range <anchor-pair>` — inverse of accept.

**Anchor formats** (reuse Stage 11 parsing in `core/anchorResolver.ts`):
- `heading:"Risks"` — first heading whose text matches
- `line:42` — 1-indexed source line
- `text:"exact match"` — first occurrence
- `range:from-to` — char offsets (for `--range`)

**Implementation:** each verb reads the file, parses CriticMarkup ops, resolves the anchor, computes a new file content (inserts new CM token / strips existing one / etc.), writes atomically. Uses the existing `core/markdown/criticmarkup.ts` helpers for token construction.

**Plumbing per verb** — full CLAUDE.md § 4 checklist.

### Phase 4 — Suggesting toolbar + Accept/Reject UX

**Suggesting toggle:**
- New toolbar control near the existing 💬 comment button. Three states (visible label):
  - "Suggesting: off" (default) — typing edits doc directly.
  - "Suggesting: on" — typing wraps as track-changes:
    - New text → `{++…++}` insertion at cursor; mark applied to typed text.
    - Backspace / Delete with selection → `{--…--}` deletion mark; struck text stays visible.
    - Type over selection → emits substitute (parser auto-folds del+ins at serialize).
- Per-doc state stored in `sidecar.v1.suggestingMode = true|false`.
- Chord: ⌘⌥T toggles.
- Author of each auto-wrapped mark = current author from `duo author` setting.

**Accept/Reject controls:**
- **Rail-side per-suggestion** — each tracked change appears as a row in the existing comment rail (Stage 14a rail extends to track-changes). Row shows author + op type + ✓ / ✗ buttons.
- **Inline hover ✓/✗ flyout** — small floating button when hovering a CM mark in the editor body. v1 = rail-only (per BUG-138 playground "Out of scope" note "Inline ✓/✗ flyout vs rail-only — my pick: rail-only for v1").
- **Bulk banner** — top of editor when ≥1 suggestion present: "N suggestions · Accept all · Reject all".
- **Author-filter chips** — rail filter row: "All / mine / agent / others".

**Implementation:**
- New `extensions/SuggestingMode.ts` extension that intercepts `Transaction.steps` and wraps newly-inserted/deleted text in the corresponding mark when mode is on.
- Extend `extensions/CommentMark.ts`'s rail-thread builder to ALSO collect insertion/deletion/highlight marks.
- Banner component: `components/editor/SuggestingBanner.tsx` (mount above the editor when `getTrackedChangeCount(doc) > 0`).

---

## BUG-139 — locked plan (Frontmatter Properties panel)

**Fix shape:** B · Collapsible Properties panel + raw-YAML toggle.

**UX:**
- Always-visible panel above the editor body (between toolbar and text area). Renders YAML frontmatter as key:value rows.
- Each row: bold key on the left, value on the right (read-only inline text in v1).
- Panel header: "Properties (N)" with a chevron to collapse. Persisted per-doc state (collapsed/expanded) in `sidecar.v1.frontmatterPanelCollapsed`.
- "Edit raw" button (top-right of panel) flips the body of the panel into a `<textarea>` with the raw YAML. Save button or click-outside commits.
- Empty/no-frontmatter case: small "+ Add properties" button creates an empty YAML frontmatter block.

**Data flow:**
- On file load: `splitFrontmatter` already runs; frontmatter captured in `frontmatterRef`. ADD: parse the YAML into a `Record<string, unknown>` for the structured display.
- On edit (raw textarea): parse the textarea text as YAML, validate (highlight parse errors inline). On commit, write back to `frontmatterRef`.
- On save: existing `joinFrontmatter` path; unchanged.

**Implementation:**
- New `components/editor/FrontmatterPanel.tsx`.
- New `markdown/frontmatterParser.ts` — wraps `js-yaml` (already a dep, used elsewhere) with a defensive parse that returns `{ valid: boolean, parsed: object | null, error: string | null }`.
- Wire into `MarkdownEditor.tsx` between toolbar and editor body, fed from `frontmatterRef`.

---

## Carry-forward backlog items (lower urgency)

### BUG-135 — Git ribbon strictness

Locked plan in [tasks.md § BUG-135](../../tasks.md): walk path from cwd up to gitSnap.workTreeRoot; suppress ribbon when ≥2 peer-repo children in any intermediate level.

### ENH-164 — `duo terminal new --kind claude`

Locked plan in [tasks.md § ENH-164](../../tasks.md): plumbing checklist + `--cwd` flag + returns tab id.

### ENH-148 — Multi-select v2 (⇧-click range + ⌘-A + CLI parity)

Locked plan in [tasks.md § ENH-148](../../tasks.md): VS Code-style range; ⌘-A capped at "current directory + immediate children"; NavStateSnapshot extends with `selectedPaths: string[]`.

### BUG-130 — Browser pane `file://` auto-reload

May slip to Sprint 19. Architectural; on roadmap. Plan: fsevents watcher on file:// URLs in browser tabs; reload via `webContents.reload()` on change with a debounce.

---

## Locked memories from this sprint

| Memory | What it captures |
|---|---|
| [feedback_grep_all_implementations_before_rename](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_grep_all_implementations_before_rename.md) | User-visible strings often have 3+ copies (React + CDP IIFEs + test fixtures); grep all before declaring rename done. |
| [feedback_spawn_claude_for_testing_when_needed](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_spawn_claude_for_testing_when_needed.md) | Agent should start `claude` itself when verification needs claudeLive=true. |
| [feedback_always_open_playgrounds_in_duo](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/feedback_always_open_playgrounds_in_duo.md) | Claude desktop preview panel lacks navigator.clipboard; ALWAYS `duo open` instead. |

---

## Compaction-safe pointer table

After compaction, the new agent should read:

| To know | Read |
|---|---|
| What ships next | This file's "Delivery order" table above (Phase 2 of BUG-138 is up). |
| What Phase 1 of BUG-138 already does | [`renderer/components/editor/markdownCriticMarkup.ts`](../../renderer/components/editor/markdownCriticMarkup.ts) + the 4 mark extensions in `extensions/` |
| Locked playground decisions | [tasks.md § BUG-138](../../tasks.md) Decision table (Q1–Q6). |
| Locked BUG-139 shape | [tasks.md § BUG-139](../../tasks.md) — option B is locked. |
| Memory rules added this sprint | [MEMORY.md](../../.claude/projects/-Users-geoffreydudgeon-Documents-GitHub-duo/memory/MEMORY.md) — last 3 entries. |
| v0.7.0 release | [release notes](https://github.com/dudgeon/duo/releases/tag/v0.7.0) + the v0.7.0 entry in [`docs/RELEASES.md`](../RELEASES.md). |

**What's running:** Sprint-18 dev session, v0.7.1 in package.json. `/tmp/bug-138-roundtrip-2.md` is the live Phase-1 verification fixture (owner confirmed visuals 2026-05-18).
