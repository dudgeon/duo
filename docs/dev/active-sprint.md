# Active sprint state — Sprint 15 (cut target v0.6.13)

**Theme: Repo cleanup close-out + FTUX-content-→-packs migration + enterprise-friendly install hardening.** v0.6.12 shipped 2026-05-10; Sprint 15 picks up the close-out tail (BUG-117 already shipped in v0.6.13-dev), the surgical FTUX-pack migration (ENH-138 P0), the FAQ removal (ENH-135), and the claude-code-basics template move (ENH-136). Beginner's Guide content (ENH-137) awaits owner-authored draft.

## Sprint 15 P0 commitments (decided 2026-05-10 close-out)

### Already shipped in the v0.6.12 → v0.6.13 cleanup batch (5 commits ahead of origin)

- ✅ **v0.6.12 release** (commit `18725c7`) — JSON/YAML viewer-editor + visibility CLI + view-source panel-fill + image-handling close-out + Return semantics. Tagged + pushed; GitHub Release with DMG attached.
- ✅ **chore: bump to v0.6.13** (`6822a66`)
- ✅ **chore: repo-root cleanup** (`ce74481`) — rm RESUME.md, mv duo-brief.md → docs/, rm stray PNG, prune old DMGs
- ✅ **docs: README refactor** (`32eab90`) — 535 → 168 lines + new docs/dev/CONTRIBUTING.md (412 lines)
- ✅ **docs: tasks.md trim** (`e4ff756`) — pruned BUG-001..BUG-017 era entries (-697 lines)
- ✅ **docs(research): ENH-134 planning artifact + CLAUDE.md § 11 rule** (`089521f`, `650609b`) — planning artifacts default to HTML interactive playgrounds
- ✅ **docs+fix: ENH-134 refocus + BUG-117 + 4 follow-ups** (`bf8db68`) — playground reframed to maintenance + surgical question; SessionStart hook write hardened for enterprise-locked settings.json; filed BUG-116 / BUG-117 / ENH-135 / ENH-136 / ENH-137
- ✅ **fix(cli): rebuild stale cli/duo binary** (`8d1f96e`) — v0.6.12 cut committed pre-rebuild copy; missing ENH-130 `--reveal` flag in dev-install path
- ✅ **docs: BUG-118 task entry** (`e2b1f8c`) — cut-version skill should sanity-check cli/duo binary
- ✅ **docs: ENH-138 + playground § 5 refactor** (`f04f113`) — capture the FTUX-content-→-packs principle + 3 decisions

### To ship in Sprint 15 (per ENH-134 close-out decisions)

| ID | Title | Status | Decisions captured |
|---|---|---|---|
| **ENH-138** | Move FTUX-loadable HTML/markdown into `packs/duo-default/` (NOW-SKELETON migration) | 🟢 P0 — implementation gated on the WDD migration smoke walk | Q1 ADOPT / Q2 NOW-SKELETON / Q3 FLAG-IN-PACK-JSON |
| **ENH-135** | Remove FAQ from default install + move to `docs/legacy/` | 🟢 P0 — folds into ENH-138 sub-tasks (#6 default-pins-literal removal, #7 default-landing-URL pivot) | Sub-decisions for landing/boot-tab/pin replace dissolve once ENH-138 lands |
| **ENH-136** | Treat `packs/claude-code-basics/` as a template (move to `examples/`) | 🟢 P0 — 1-day move + README clarification | (a) Move to `examples/lesson-pack-template/` (recommended) — owner confirmation in next session |
| **BUG-118** | cut-version skill should sanity-check cli/duo binary | 🟢 P0 — ~30 min: post-build `git diff --quiet cli/duo` guard | None needed |
| **ENH-137** | Beginner's Guide to Duo (owner draft + Claude polish) | 🟡 awaiting owner draft | Surface decision dissolves — content drops into ENH-138's `packs/duo-default/canvases/` |
| **BUG-116** | `dist-signed.sh` validates wrong DMG via glob | 🟢 P1 — small fix; pass explicit version-pinned DMG path | None needed |
| **ENH-139** | PackManifest schema extension for markdown / playground kinds | 🟡 deferred — file when ENH-137 author chooses markdown OR explicit-browser routing needed | Confirmation answer captured in ENH-138 entry |

### Recommended Sprint 15 commit order

1. **ENH-136** (smallest; 1-day; doesn't depend on anything else) — move `packs/claude-code-basics/` → `examples/lesson-pack-template/` + README + skill pointer.
2. **BUG-118** (~30 min) — cut-version skill sanity-check.
3. **ENH-138 NOW-SKELETON migration** (~half-day) — create `packs/duo-default/` with PACK.json (`builtIn: true`) + canvases/ subdir; `git mv help/what-duo-does.html packs/duo-default/canvases/what-duo-does.html`; add `builtIn` field to PackManifest type + loader + uninstaller.
4. **ENH-135 (folded into ENH-138)** — `git mv help/faq.html docs/legacy/faq.html`; remove default-pins literal at `install-service.ts:520-528`; pivot `browser-manager.ts:49` default landing URL.
5. **BUG-116** (~30 min) — `dist-signed.sh` glob fix.
6. **Smoke walk** — fresh install verifies WDD opens via pack + gets pinned; FAQ doesn't appear; `duo pack uninstall duo-default` is refused.
7. **Cut v0.6.13.**

ENH-137 ships in a future sprint when the owner-authored draft is ready (drops into the same pack — no new install-pipeline work).

## Confirmation log — pack defaults can deliver which content kinds

Per ENH-134 owner general-comment 2026-05-10:

| Kind | v1 schema support | Trigger to add |
|---|---|---|
| HTML canvas (canvas mode — editable raw HTML) | ✅ supported via `kind: 'canvas'` | — |
| HTML playground (browser mode — scripts run) | ✅ supported via `kind: 'canvas'` + `<meta duo-open-in=browser>` in the file | — |
| Markdown editable (TipTap rich editor) | ❌ needs ENH-139 schema extension (`kind: 'editor'`) | When ENH-137 chooses markdown, OR a future pack default needs it |
| Markdown locked (read-only preview) | ❌ needs ENH-139 schema extension (`kind: 'markdown-preview'`) | When a "user reads, doesn't edit" pack default surfaces |

**Sprint 15's NOW-SKELETON migration uses v1 schema as-is** — `what-duo-does.html` is HTML, opens cleanly. ENH-139 lands later if/when needed.

---

## Open AUQs for the new session

- **ENH-136 confirmation** — owner picked option (a) Move to `examples/lesson-pack-template/`? Surface at start of next session before code work.
- **ENH-138 default-landing-URL pivot** — `browser-manager.ts:49` currently returns `helpUrl('faq.html')` (becomes broken after ENH-135). Pivot to `null` (blank canvas on new tab — recommended) or to the pack canvas? Surface as a sub-AUQ when implementing.
- **ENH-138 boot-default first tab** — `electron/main.ts:305-310` opens FAQ unconditionally on cold start; remove entirely (recommended), OR replace with the pack canvas? Surface as a sub-AUQ when implementing.

---

## Carry-forwards / candidate slate (Sprint 16+)

These items are NOT in Sprint 15 but stay queued. Read `tasks.md` entries for each:

- **ENH-137 Beginner's Guide content** — owner-authored draft + Claude polish + drops into `packs/duo-default/canvases/`.
- **ENH-139 PackManifest schema extension** — gated on ENH-137 markdown choice or future need.
- **ENH-123 `duo devtools`** + **ENH-124 `duo layout`** — sister verbs to ENH-122 (visibility-tooling cluster).
- **BUG-103** blockquote CSS leak (still 🟡 Open).
- **ENH-082** Terminal Context Bar — research doc owed before code.
- **Obsidian backlinks panel cluster** (Tier C from the Obsidian-vault research doc).

---

## Not-yet-decided items (will accumulate as Sprint 15 progresses)

_Empty as of Sprint 15 kickoff (2026-05-10 close-out). New decision gates will surface during implementation._
