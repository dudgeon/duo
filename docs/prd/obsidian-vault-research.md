# Research — Obsidian vaults opened in Duo

> **Status:** Research, 2026-05-06. Sprint 8 candidate inclusion (one
> focused addition, scoped at the bottom of this doc).
>
> **Why this matters.** Obsidian is the most-deployed personal-knowledge-
> management tool in the Duo audience's adjacency. A non-trivial slice
> of would-be Duo users already maintain markdown vaults in Obsidian.
> "Just open my vault in Duo" is a natural ask — and the closer it is
> to working, the lower the friction for those users to try Duo on
> real-life knowledge work. This doc maps Duo's current behavior
> against Obsidian's surface and proposes a tightly-scoped affordance
> set worth shipping in Sprint 8.

---

## What works today (zero code change)

Material wins from Sprint-6+ work:

| Capability | What Duo does | Why it works |
|---|---|---|
| **YAML frontmatter pass-through** | TipTap never sees the `---…---` block. `splitFrontmatter` peels it before load; `joinFrontmatter` re-attaches verbatim on save. | [markdown-io.ts](renderer/components/editor/markdown-io.ts) — Stage 11. Obsidian's `tags: [...]`, `aliases: [...]`, `cssclasses: [...]`, custom properties all survive open-and-save. |
| **`.obsidian/` config folder hidden** | Navigator's `shouldShow` filter hides dotfiles by default; user can toggle. `.obsidian/workspace.json` doesn't appear in the file tree as visual noise. | [FileTree.tsx:751](renderer/components/FileTree.tsx) — Stage 10 § D6. |
| **External-write reconciliation** | If the user has both Obsidian and Duo open on the same vault, Obsidian's saves trigger Duo's file watcher → silent reload on clean buffer; conflict banner with Reload-from-disk / Keep-mine on dirty buffer. | [BUG-085](tasks.md) — Sprint 6. Pre-save guard catches the autosave-vs-watcher race. |
| **Standard markdown editing** | StarterKit + tiptap-markdown gives headings, lists, bold/italic, links, blockquotes, code blocks (with syntax highlighting via lowlight), tables, task lists. Bullet marker (`-` / `*` / `+`) round-trips. | TipTap extensions in [MarkdownEditor.tsx:224](renderer/components/editor/MarkdownEditor.tsx) + ENH-018 marker passthrough. |
| **Find in document** | `⌘F` opens the find bar; `duo doc find <q>` for agent-driven search. Goto by heading or line via `duo doc goto`. | ENH-022 / ENH-023. |
| **Cross-file search** | `grep` via Bash or `Explore` agent — works fine but is CLI/agent-driven, not in-app keyboard-driven. | Stage 10 navigator + agent surface. |
| **Multi-tab editing** | Many notes open at once; each in its own working-pane tab. Split View if the user wants two side by side. | Stage 11 + Sprint 3 split-view. |
| **Comments on a note** | ⌘⌥M / right-click / toolbar 💬 add a comment thread that persists in `<note>.md.duo.json` sidecar. Survives close + reopen. | Sprint 6 Phase 4 — MISSING-001 / Stage 14a. |
| **Concurrent agent + user editing** | Skill enforces `duo doc write` over raw `Write`/`Edit` for active-editor mutations; pre-save guard prevents lost writes. | Stage 19b skill rule + BUG-085 reconciliation. |

**What this means in practice:** open a vault folder via the Duo navigator. Click any `.md` file. The file opens in Duo's rich editor with your YAML frontmatter intact. Edit. Save. Switch back to Obsidian. Obsidian's file-watcher picks up the change. No data loss. The basic round-trip is sound.

---

## What breaks or is subtly wrong

### Visual + invocation gaps (the most-noticed)

| Obsidian feature | Duo behavior today | Severity |
|---|---|---|
| **Wikilinks `[[Page Name]]`** | Renders as literal `[[Page Name]]` text. Click does nothing. Type `[[` and no autocomplete fires. | **High** — the single most distinctive Obsidian convention; Obsidian users will notice instantly. |
| **Embeds `![[Page Name]]`** | Same as wikilinks — literal text. The image-embed `![alt](url)` syntax works, but Obsidian's wiki-embed doesn't. | **Medium** — less common than plain wikilinks but used in note-templating. |
| **Block references `[[Page#^block-id]]`** | Same — literal text. | **Low** — power-user feature; degrades gracefully. |
| **Inline tags `#tag-name`** | Renders as plain text. `#` is only treated as a heading shortcut at line start. No tag pane, no clickable tag pills. | **High** — pervasive in Obsidian vaults; visual noise + lost navigation. |
| **Callouts `> [!note]`, `> [!warning]`** | Render as plain blockquotes (orange left bar, no icon, no header chrome). Content readable; visual hierarchy lost. | **Medium** — Obsidian's callout chrome is part of how users skim notes. |
| **Math `$inline$` / `$$block$$`** | Render as literal LaTeX text. No KaTeX/MathJax. | **Medium** — common in research/STEM vaults. |
| **Mermaid diagrams** | `mermaid` fenced code blocks render as code with syntax highlighting, not as diagrams. | **Medium** — popular in technical vaults. |
| **`.canvas` files (Obsidian Canvas)** | JSON file; Duo opens as plain-text editor (probably; needs verification). | **Low** — distinct format; degrades to "view raw JSON." |

### Navigation + workflow gaps

| Obsidian feature | Duo equivalent today | Severity |
|---|---|---|
| **Quick switcher (`⌘O`)** — fuzzy file search across the entire vault | None. ENH-080 (Sprint 8) ships `⌘⇧A` tab-search but only across **already-open** tabs. No vault-wide fuzzy. | **High** — Obsidian users navigate primarily via `⌘O`. |
| **Full-text vault search (`⌘⇧F`)** | None as a keyboard-driven panel. Available via `grep` or `Explore` agent. | **Medium** — power-user feature but expected. |
| **Backlinks panel** — "what links here" for the active note | None. User can grep `[[Note Name]]` manually. | **Medium** — central to note-graph thinking. |
| **Outline / heading TOC panel** — for the active note | None. User can `⌘F` for headings or scroll. | **Medium** — long-note navigation. |
| **Daily notes** — auto-create today's date-stamped note | None. User creates manually. | **Low-Medium** — power-user feature; daily-note users are passionate about this. |
| **Templates** — `{{date}}` / `{{title}}` / `{{time}}` substitution on insert | None. | **Low** — replaceable with snippet/script-driven workflows. |
| **Reading mode toggle** | None. Duo's editor is live-preview only. | **Low** — Duo's live preview already approximates Obsidian's "live preview" mode; "reading mode" (no edit affordances) is the deliberate-cleaner-view variant. |
| **Graph view** | None. | **Low** for Sprint 8; high lift, low marginal benefit. |
| **Frontmatter properties panel** — typed UI over YAML | None today. Already filed as Stage 11 D15. | **Medium** — Obsidian shipped this in v1.4 (2023) and users now expect it. |

### Behavioral surprises

1. **Sidecar comment files proliferate.** Add a comment to `note.md` and `note.md.duo.json` appears beside it. In an Obsidian vault, this is novel — Obsidian doesn't have an equivalent. Users will want to either:
   - Add `*.duo.json` to their `.gitignore` (if vault is git-tracked)
   - Move the sidecars out of the vault entirely (e.g. `.obsidian/duo-comments/<relative-path>.json`)
   - Or accept them as Duo-specific annotations that travel with the notes
   - **Today:** the convention isn't documented anywhere user-facing. Obsidian users will discover the file pattern by accident the first time they git-status their vault.

2. **Workspace state divergence.** Duo's session state (open tabs, pinned files, split view layout) lives in Duo's persisted state. Obsidian's lives in `.obsidian/workspace.json`. The two don't sync. A user switching back and forth sees different "open" states in each tool.

3. **Hotkey conflicts.** Obsidian uses `⌘O` for quick switcher, `⌘P` for command palette, `⌘E` for reading-mode toggle, `⌘⇧F` for full-text search. Duo uses `⌘O` for "open file via dialog" (or doesn't bind it explicitly?), `⌘⇧A` for tab search (Sprint 8). Some chords land on different surfaces. User confusion is likely on first session.

4. **`.obsidian/workspace.json` write churn.** Obsidian writes to this file frequently as the user navigates. Duo's file watcher would normally fire on every change. Hidden by the dotfile filter, so the navigator doesn't surface it — but if Duo's file watcher reads dotfiles too, it could fire spurious change notifications. Worth verifying.

---

## Affordances ranked by value-to-Obsidian-user × LOE

### Tier A — defensive baseline (must-have to not break trust)

| Item | LOE | Sprint candidate? |
|---|---|---|
| **A1: Document the sidecar convention.** README + faq.html addition explaining `<note>.md.duo.json`, recommending `*.duo.json` in `.gitignore` for git-tracked vaults. Sets expectations before users discover the files by accident. | XS | **Sprint 8 ✓** |
| **A2: Vault-aware sidecar location (optional).** If Duo detects an Obsidian vault (presence of `.obsidian/` folder), put new sidecars at `.obsidian/duo-comments/<relative-path>.json` instead of next to the note. Existing same-folder sidecars keep working. | M | Defer — clean v1 ships A1 only. |
| **A3: Frontmatter round-trip test for Obsidian YAML shapes.** Add vitest fixtures: `tags: [foo, bar]`, `aliases: [...]`, `cssclasses: [...]`, custom YAML properties — assert open-and-save preserves byte-for-byte. | XS | **Sprint 8 ✓** (folds into FOLLOWUP-009's testing infra work). |
| **A4: Verify `.obsidian/workspace.json` doesn't trigger Duo's noisy file watcher.** Hidden in navigator — but is the file watcher subscribing to it? Confirm + add ignore rule if needed. | XS | **Sprint 8 ✓** |
| **A5: Wikilink visual no-op (don't auto-convert).** Confirm tiptap-markdown leaves `[[Foo]]` as literal text on round-trip. If it transforms it (e.g. into a broken Link mark), file as a bug. | XS | **Sprint 8 ✓** (verification only; fix only if broken). |

### Tier B — distinctive Obsidian features (Phase B in this doc's tier-ranking)

| Item | LOE | Sprint candidate? |
|---|---|---|
| **B1: Wikilink rendering.** Custom TipTap node/mark that recognizes `[[Page Name]]`, renders as a styled inline span (Atelier accent), `cmd+click` opens the linked file from the current vault root (the navigator's CWD or the file's containing folder up to the vault root, detected via `.obsidian/`). | M | **Sprint 8 candidate** — single most-noticed gap. |
| **B2: Wikilink autocomplete.** When the user types `[[`, popup with fuzzy-matching note paths from the vault. Tab/Enter inserts. Esc dismisses. Same UX shape as ENH-080's tab-search palette. | M | **Sprint 8 candidate** — pairs naturally with B1; without it, B1 is half-built. |
| **B3: Inline tag rendering.** `#tag-name` (preceded by space or line-start, with hyphen-allowed body) renders as a clickable pill. Click → search across vault for the tag. | M-L | Defer to Sprint 9+. Lower priority than wikilinks. |
| **B4: Vault quick switcher.** `⌘O` opens fuzzy file search across the entire vault root. Distinct from ENH-080 (open tabs). Could share base palette implementation with ENH-080. | M | **Sprint 8 candidate** — pairs with ENH-080 already in scope; both are fuzzy palettes. |
| **B5: Full-text vault search panel.** `⌘⇧F` opens a sidebar / overlay with grep-style search; results = file path + match snippet. | L | Defer. Available via CLI agent; the panel UX is a separate sprint. |

### Tier C — quality-of-life

| Item | LOE | Defer? |
|---|---|---|
| C1: Backlinks panel | M-L | Defer |
| C2: Outline panel | M | Defer |
| C3: Daily notes (`⌘⇧D`) | S | Defer |
| C4: Callout rendering (TipTap extension) | M | Defer |
| C5: Frontmatter properties panel (Stage 11 D15) | L | Already filed; not Sprint 8. |
| C6: Math rendering (KaTeX) | M-L | Defer |
| C7: Mermaid rendering | M | Defer |

### Tier D — out of scope or indefinitely deferred

D1: Graph view · D2: `.canvas` file support · D3: Reading-mode toggle · D4: Embed rendering · D5: Block references · D6: Plugin compatibility · D7: Theme compatibility.

---

## Recommended Sprint 8 addition: "ENH-096 — Obsidian-vault-friendly editor (tier A + B1/B2/B4)"

The sprint already has Stage 21d as the anchor + 3 bugs + 3 polish items + ENH-080 (tab-search palette). Adding Obsidian-friendliness as one focused enhancement:

**Scope:**
- **A1 — Sidecar convention doc** (XS): faq.html + what-duo-does.html addition explaining `<note>.md.duo.json` sidecars; recommend `*.duo.json` in `.gitignore` for git-tracked vaults.
- **A3 — Frontmatter round-trip tests** (XS): vitest fixtures for Obsidian-style YAML; folds into FOLLOWUP-009's `@testing-library/react` infra.
- **A4 — File watcher ignore for `.obsidian/`** (XS): if not already, add `.obsidian/` to the file watcher's ignore list (separate from navigator hide).
- **A5 — Wikilink no-op verification** (XS): confirm tiptap-markdown round-trips `[[…]]` cleanly; smoke walk item.
- **B1 — Wikilink rendering** (M): custom TipTap mark/node, click-to-open, Atelier-styled. Vault root resolution = walk up from the file's directory until `.obsidian/` is found, fall back to the navigator CWD.
- **B2 — Wikilink autocomplete** (M): popup on `[[`, fuzzy-search vault notes, share a base implementation with ENH-080's palette.
- **B4 — Vault quick switcher** (M): `⌘O` opens vault-wide fuzzy file search. Shares the palette base.

**Pairs naturally with already-in-sprint items:**
- ENH-080 (tab-search palette): same fuzzy-palette primitive; B2 + B4 reuse it.
- FOLLOWUP-009 (testing-library/react infra): A3 fixtures land in the new test directory.
- Stage 21d (distro packs): a future "Obsidian companion" distro pack could ship Obsidian-tuned skills (e.g. `obsidian-quickstart` skill that walks new users through Duo's Obsidian-friendly affordances).

**Defer to Sprint 9+:**
- B3 (tag rendering), B5 (full-text search panel), all of Tier C, all of Tier D.

**Acceptance:**
1. User opens an Obsidian vault folder via Duo's navigator.
2. Clicks any `.md` note. Frontmatter is intact (verified by save + reload).
3. `[[Other Note]]` wikilinks render as styled clickable spans; `cmd+click` opens the linked note in a new tab.
4. Typing `[[` opens an autocomplete fuzzy-list of vault notes; Enter inserts.
5. `⌘O` opens a vault-wide quick switcher; type to filter; Enter opens.
6. `.obsidian/` doesn't appear in the navigator (already-shipped).
7. Edit + save in Duo. Switch to Obsidian. Obsidian sees the changes. No frontmatter loss.
8. Smoke walk passes; FOLLOWUP-009 tests cover the frontmatter round-trip cases.

**Effort estimate:** 2-3 PRDs of work. B1+B2+B4 share a fuzzy-palette base implementation that ENH-080 also benefits from.

---

## Open questions for the next sprint conversation

1. **Vault root detection algorithm.** Walk up from the active file's directory until `.obsidian/` is found? Or use the navigator's current CWD? Or let the user mark a folder as "this is a vault root" once and persist? Decision affects wikilink resolution semantics.
2. **`*.duo.json` sidecar location for vaults.** Same folder as the note (today's behavior, simple) vs. centralized under `.obsidian/duo-comments/<relative-path>.json` (cleaner but adds path-resolution complexity). This is the A2 trade.
3. **Obsidian's "shortest path when possible" wikilink resolution.** Obsidian resolves `[[Foo]]` by name across the whole vault, not by relative path. Should Duo match that semantic, or stick with relative-path resolution? Names-first matches user expectation; can be ambiguous if multiple files named `Foo.md` exist.
4. **Companion distro pack for Obsidian users.** A future "obsidian-companion" distro pack (Stage 21d format) could ship: `obsidian-quickstart` skill walking the user through Duo's Obsidian-friendly affordances; canvas templates for note-graph dashboards; playgrounds for vault analytics. Worth scoping after Sprint 8 lands the editor-side affordances.
5. **Hotkey conflict policy.** Duo's existing chord set vs. Obsidian users' muscle memory. `⌘O` is the most likely contention point. Worth a one-time first-Obsidian-vault-detected banner explaining the differences? Or just document in faq.html.

---

## Cross-references

- [Stage 11 markdown editor PRD](stage-11-markdown-editor.md) — frontmatter pass-through; D15 properties panel queued.
- [tasks.md § BUG-085](../../tasks.md) — external-write reconciliation that makes concurrent Obsidian/Duo work safe.
- [tasks.md § ENH-080](../../tasks.md) — tab-search palette (Sprint 8); shares palette base with B2 + B4 here.
- [tasks.md § FOLLOWUP-009](../../tasks.md) — testing-library/react infra (Sprint 8); A3 frontmatter fixtures land here.
- [Stage 21d PRD](stage-21d-distro-packs.md) — distro pack format; future Obsidian-companion pack lives here.
