# Duo — Bug & Task Backlog

> **Scope.** Engineering ledger — open work + root-cause writeups for
> closed bugs. **Canonical version-by-version inventory lives in
> [CHANGELOG.md](CHANGELOG.md)** and the prose log in
> [docs/RELEASES.md](docs/RELEASES.md); this file is the
> running notebook with the "why did this break, what did we learn"
> detail those don't carry.
>
> **Reading guide.** Status field on each entry: `🆕 Filed` / `🟡` /
> `⏳ Open` (active work) vs. `✅ Shipped vX.Y.Z` (closed; kept for
> historical reference). To find what's actively open at a glance:
> `grep -B1 "Status:\*\* (🆕\|🟡\|⏳)"`.
>
> **Pruning policy.** Closed entries stay until the lesson migrates
> to DECISIONS.md / CLAUDE.md plumbing checklist / smoke-checklist
> (then they're prune candidates). The Sprint 15 cleanup pass
> (2026-05-10) trimmed BUG-001..BUG-017 (697 lines from the v0.3 /
> v0.4 era; lessons live in DECISIONS.md / plumbing checklists / the
> smoke-checklist). Cross-references to those IDs may still appear
> inline in other entries as historical citations — see git history
> before commit `<v0.6.13-cleanup>` for the original writeups. Next
> prune candidate: closed BUG-018..BUG-040 era entries once their
> lessons similarly internalize.

## DRAFT — Sprint-9+ candidates from idle-thoughts sweep (2026-05-06)

> Filed during the v0.6.8 cut close-out sweep. Each entry below is a
> draft of an idea from `idle-thoughts.md` that needs sprint planning
> input before code work — chord conflicts, exact UX choice, scope
> boundaries. **Refine in the next sprint-plan session.**

### ENH-098: Focus-chord set — ⌘⇧L (terminal) · ⌘⇧; (main canvas) · ⌘⇧' (split view)

**Status:** ✅ **Shipped Sprint 9 (2026-05-07)** — chord set ⌘⇧L/;/' verified working in walk-3. Owner: "carat landed!" — focus + caret BOTH transfer reliably. Walk-3 surfaced two adjacent bugs (file-changed-on-disk dialog after typing, and right-click → Copy path no-op) — filed as BUG-104 + BUG-105 for follow-up; both are independent of the chord fix itself. Walk-1 re-pick (⌘⌥ → ⌘⇧) escaped owner's system-level window-manager interception. Walk-2 visibility filter (`findVisibleWorkingPaneCE`) addressed BUG-046's display-toggled-mounted tabs winning the selector race. Chord matchers + dispatch + browser-pane allowlist + CLI parity (`duo focus-pane`) all wired and type-clean. 13 vitest fixtures green for the matcher (incl. all three chord shapes, modifier specificity, in-editable-surface escape, plain ⌘L still maps to focusAddressBar). End-to-end CLI test against the dev session: all three targets return `{target}` ok; bogus argument errors out cleanly. The only path not autonomously verified is actually pressing the chord in the live UI and confirming the OS-level focus shift — code path is identical to the CLI test (both call the same `focusPane()`).
**Priority:** Medium (QOL chord coverage; agent + power users want named chords for each pane).
**Filed:** 2026-05-06 (idle-thoughts sweep).
**Implementation summary (Sprint 9 Phase 2, 2026-05-07).**
- `renderer/keyboard/globalShortcuts.ts` — three new ShortcutId entries (`focusTerminalPane`, `focusMainPane`, `focusAuxPane`); matchers use `e.code` (KeyL / Semicolon / Quote) because Option on macOS modifies the produced character (Option+L → '¬', Option+; → '…', Option+' → 'æ').
- `renderer/hooks/useKeyboardShortcuts.ts` — three new dispatch cases + opts.
- `renderer/App.tsx` — single `focusPane(target)` callback shared by the three chord callbacks AND the CLI verb's IPC subscriber. Implements per-target focus (terminal: xterm helper textarea + reclaimFocus; main: focus active main file/browser slot; aux: focus aux WCV/contenteditable, no-op + console.info if split view closed).
- `electron/browser-manager.ts § isDuoShortcut` — allowlist `input.alt && (KeyL|Semicolon|Quote)` so chord escapes Chromium when browser pane has focus.
- `shared/types.ts` — `DuoCommandName` extended with `focus-pane`; `IPC.PANE_FOCUS_JUMP` channel constant.
- `shared/host-api.ts` — `onPaneFocusJump` typed bridge subscription.
- `electron/preload.ts` — `keyboard.onPaneFocusJump` IPC subscription.
- `electron/main.ts` — `focusPane` bridge implementation pushes PANE_FOCUS_JUMP IPC to renderer.
- `core/socket-server.ts` — `case 'focus-pane'` socket verb + `focusPane` on NavBridge.
- `cli/duo.ts` — `case 'focus-pane'` parser + help text.
- `skill/SKILL.md` + `agents/duo.md` + `docs/CLI-COVERAGE.md` — verb cheat-sheet entries.

**Open question deferred (decided per recommended path).**
- Aux behavior when not present: no-op + `console.info` hint (not a toast UI). Toast/banner deferred until pattern is reused elsewhere.
- Per-pane vs. per-tab: chose pane-level (focus the active tab in the named pane). Per-tab is `⌘1-9` / `⌘⇧1-9`.

**What's wanted.** Three new chords that move focus to a specific pane:
- `⌘⌥L` → terminal pane focus (whatever the active terminal tab is).
- `⌘⌥;` → main canvas / working-pane focus (whatever the active main-pane tab is).
- `⌘⌥'` → split-view (aux) pane focus.

Today: `⌘\`` cycles between panes (terminal ↔ working ↔ aux when present). Useful as a generic toggle, but doesn't let the user JUMP to a specific pane without cycling through.

**Needs refinement.**
- **Chord conflicts.** `⌘⌥;` and `⌘⌥'` are unusual on macOS but: confirm they don't collide with macOS system chords (none I'm aware of), Chromium-WCV-default-handlers (need a `before-input-event` whitelist entry per the BUG-002 family), or any TipTap / canvas extension shortcuts. `⌘⌥L` may conflict with browser-pane address-bar focus on some extensions — verify.
- **Aux behavior when not present.** `⌘⌥'` no-ops when split view isn't open? Or auto-opens an empty aux? (Recommend: no-op; arrow forward to "open split view first" toast.)
- **Per-pane vs. per-tab.** Focus the pane (whatever tab's currently active there) vs. focus a SPECIFIC tab? Recommend pane-level — tab-jump is what `⌘1-9` / `⌘⇧1-9` already does.

**Affected files.** `globalShortcuts.ts` (3 new entries), `useKeyboardShortcuts.ts` (3 dispatch branches), `browser-manager.ts § isDuoShortcut` (whitelist `KeyL` / `Semicolon` / `Quote` — codes pending verification).

---

### ENH-099: 3-way 33/33/33 pane-size chord — ⌘⌥4

**Status:** ✅ Shipped v0.6.11 (Sprint 13 walk-3, 2026-05-09). On-demand sibling of ENH-126's auto-redistribute on aux-open. Same canonical layout: outer terminal/working = 33/67 + inner aux = 50/50 (when aux is open). When aux isn't open, only the outer ratio changes. Three trigger surfaces:

- **`⌘⌥4` chord** via View → Pane size → 3-way even (33/33/33) menu accelerator in [electron/main.ts](electron/main.ts).
- **`duo split 3way` CLI verb** via `cli/duo.ts` (also accepts `3-way` and `even-3way` aliases for forgiveness). Routes through new `LAYOUT_3WAY_EVEN` IPC.
- **Application menu item** (View → Pane size → 3-way even) for discoverability.

Plumbing: `shared/types.ts § IPC.LAYOUT_3WAY_EVEN` + `LAYOUT_3WAY_EVEN` discriminator on `DuoCommandName`; `electron/main.ts § setLayout3wayEven` dispatch helper + menu entry; `electron/preload.ts § layout.onLayout3wayEven` bridge; `shared/host-api.ts § onLayout3wayEven` type; `renderer/App.tsx` subscriber that does `setSplitPct(33) + setAuxState(...splitPct: 0.5)`; `core/socket-server.ts § case 'layout-3way-even'`; `cli/duo.ts § case 'split'` with `3way` preset; full skill/SKILL.md + agents/duo.md + CLI-COVERAGE.md cheat-sheet entries. **Priority:** Low-medium (cosmetic; pairs with ENH-126's auto-redistribute as the on-demand trigger of the same canonical layout). **Filed:** 2026-05-06 (idle-thoughts sweep). **Pulled into Sprint 13 walk-3** alongside ENH-117 + ENH-127 as substantive work to round out the cut.

**What's wanted.** New chord `⌘⌥4` that resizes terminal / main / split-view to ~33/33/33 widths simultaneously.

**Needs refinement.**
- **3-way layouts not supported by current resize state.** Current panes are: terminal (left column) + working pane (right column with optional aux split). Aux is INSIDE the working pane, not a third sibling. So a "33/33/33" doesn't have a clean home — it's terminal/main/aux where aux is sub-divided from the working column. Need to decide: does this resize the OUTER terminal/working split to 33% terminal + 67% working, then sub-split working to 50/50 main/aux? Or does it require a layout refactor?
- **Aux must already be open** for the chord to make sense. No-op when no split view? Or auto-open one?
- **Chord ergonomics.** `⌘⌥1/2/3/0/9` are taken; `⌘⌥4` is free. But the existing "even" layout `⌘⌥2` already covers 50/50; this 33/33/33 is a meaningfully different layout that probably warrants its own preset name in `duo split <preset>` too.

**Recommend deferring** until we know whether 3-way layouts are a real workflow need (vs. a "nice to have" idea).

---

### ENH-100: Lock/unlock context menu verb for filetypes that support editability

**Status:** ⬜ DRAFT — needs refinement before code.
**Priority:** Medium (concept exists in code via `<meta duo-default-editable="false">` and the read-only/edit toggle strip; right-click menu would surface it more discoverably).
**Filed:** 2026-05-06 (idle-thoughts sweep).

**What's wanted.** Right-click on a tab (or in the editor body?) → "Lock" / "Unlock" verb that toggles editability. Current state: HTML canvases with `<meta duo-default-editable="false">` mount in read-only mode with a toggle strip; markdown editor has a `Saved` / `Save` button area but no lock concept.

**Needs refinement.**
- **What "lock" means per filetype.** HTML canvas: write `<meta duo-default-editable="false">` to disk and re-mount in read-only? Markdown editor: ??? (no equivalent meta convention; tiptap-markdown doesn't have a read-only mark). PDF / image: no-op since they're not editable to start with.
- **Where the menu lives.** Right-click on the tab title in the strip? Or a kebab menu in the toolbar? Or both?
- **Persistence.** Does "lock" persist across sessions (write to file or sidecar) or is it a session-only state?
- **Markdown editor scope.** Is the markdown editor in scope for v1, or does this start as a canvas-only verb that gets a sister implementation later?

**Recommended path.** Start with canvas-only, write the meta tag on lock, surface via right-click on the tab. Markdown later if there's a real use case.

**Update 2026-05-08 — markdown driver landed.** ENH-106 files the data-model + editor wiring for markdown lock/unlock (YAML frontmatter `duo-default-editable: false`, mirrors ENH-034). Real first user: the local `idle-thoughts.md` Notion mirror. ENH-100's "Markdown later" arm reopens once ENH-106 ships — at that point this verb extends to markdown tabs alongside canvas tabs.

---

### ENH-101: Expand/collapse chords — ⌘⌥T (terminal) · ⌘⌥C (canvas)

**Status:** ❌ **CLOSED — won't fix (Sprint 10 sprint-plan, 2026-05-07).** Redundant with the existing `⌘⌥0` (full terminal, canvas hidden) / `⌘⌥9` (full canvas, terminal hidden) chords — those already do exactly what "full-screen this pane" would mean for ⌘⌥T/⌘⌥C. The only meaningfully-different interpretation was "rail-collapse to a fixed-width strip" (toggling between rail-collapsed and last-known-width, distinct from full-screen), but the user-research signal for that distinct gesture isn't there yet — owner-decided 2026-05-07: kill the ticket; the existing chords cover the use case. Revisit only if a real workflow surfaces "I want to rail-collapse the terminal but keep the canvas at its current width" as a recurring need.
**Priority:** Closed.
**Filed:** 2026-05-06 (idle-thoughts sweep).

**What's wanted.** Two new chords that toggle expand/collapse of the terminal and canvas panes respectively. Distinct from the "focus" chords above — these change PANE VISIBILITY, not focus.

**Needs refinement.**
- **Overlap with `⌘⌥0` / `⌘⌥9`.** Currently `⌘⌥0` = full terminal (canvas hidden), `⌘⌥9` = full canvas (terminal hidden). The proposed `⌘⌥T` / `⌘⌥C` could be the same gestures, OR could be DIFFERENT (e.g., collapse the pane to the rail, not full-screen). Owner clarify which interpretation.
- **Rail-collapse as the target?** Both panes have a CollapsedRail when fully collapsed (visible in the screenshot earlier). `⌘⌥T` could toggle terminal between full-rail-collapsed and last-known-width. That's distinct from `⌘⌥0`'s behavior.
- **Chord conflicts.** `⌘⌥T` and `⌘⌥C` need to clear the same gauntlet as ENH-098 (system / Chromium / TipTap / canvas extension).

**Recommended.** If the intent is "rail-collapse / restore", file as a NEW behavior orthogonal to the existing full-pane chords. If the intent is "full-screen this pane", these are redundant with `⌘⌥0/9` and we should defer.

---

### ENH-102: ⌘⇧⌫ delete current file (with confirm)

**Status:** 🟡 **LANDED in Sprint 9 (2026-05-07)** — UI smoke verification owed. Chord matcher + dispatch + browser-pane allowlist + App.tsx callback all wired and type-clean. 6 vitest fixtures green for the matcher (⌘⇧⌫ matches; plain ⌫ / ⌘⌫ alone / ⇧⌫ alone / ⌘⌥⇧⌫ all fall through; chord still matches inside editable surfaces because file deletion is a higher intent than line-edit).
**Priority:** Medium (matches macOS file-management muscle memory; closes a gap where the only delete path is right-click → Move to Trash via the navigator or the tab strip).
**Filed:** 2026-05-06 (idle-thoughts sweep).
**Implementation summary (Sprint 9 Phase 4, 2026-05-07).**
- `renderer/keyboard/globalShortcuts.ts` — `deleteCurrentFile` ShortcutId + matcher on `e.code === 'Backspace'` (unambiguous between Backspace and Delete physical keys on Mac extended keyboards).
- `renderer/hooks/useKeyboardShortcuts.ts` — dispatch case + opt.
- `renderer/App.tsx` — `deleteCurrentFile` callback. Reads `activeWorking`; no-ops on non-file surfaces (browser/terminal — `⌘W` already handles tab close); for file tabs, fires confirm dialog ("Move <title> to Trash?" + recover-from-Finder hint), runs `files.trash`, closes the tab. Soft-success on ENOENT (mirrors the right-click trash flow's Sprint 7 rev6 fix — file's gone, user's intent is still "close the tab").
- `electron/browser-manager.ts § isDuoShortcut` — allowlist `input.shift && input.code === 'Backspace'` so chord escapes Chromium's history-back default when browser pane has focus (no-op-then anyway, but the chord shouldn't trigger a back-navigation surprise).

**Resolved (per recommended path).**
- Chord choice: `⌘⇧⌫` (owner-recommended).
- Scope: working-pane file tabs only. Browser tabs (close, not delete) and terminal tabs (close session) explicitly out of scope — `⌘W` covers those.
- Confirm dialog style: same as right-click → Move to Trash (reuses `dialog.confirm`).
- Tab close semantics post-delete: tab closes (matches BUG-098 path).

**What's wanted.** Pressing `⌘⇧⌫` (Cmd+Shift+Delete) — or `⌥⇧⌫` (Option+Shift+Delete), whichever is more common — when a tab is open should trigger "delete current file" with a confirmation dialog. Same destination as right-click → Move to Trash on a tab.

**Needs refinement.**
- **Chord choice.** macOS has no canonical "delete file from open editor" chord; both `⌘⇧⌫` and `⌥⇧⌫` are free. Pick one and document. (Recommend `⌘⇧⌫` — same modifier shape as `⌘⇧S`, easy to remember.)
- **Scope.** Working pane file tabs only? Includes browser tabs (close tab, NOT delete URL — different verb)? Includes terminal tabs (close session, NOT delete anything)?
- **Confirm modal style.** Same modal as right-click → Move to Trash today? Or a different "destructive shortcut, confirm" pattern?
- **Tab close semantics post-delete.** Tab closes with the file? Tab stays open with a "file deleted" banner? Recommend: tab closes (matches BUG-098 path).

---

### ENH-103: Consolidate "Saved / Saving / Save" indicator + button into a single control

**Status:** ✅ **Shipped 2026-05-07 (Sprint 10 P0 anchor).** Owner-locked design via AUQ: pill button with four color/text states (Saved muted gray · Save bg-accent + white · Saving… disabled with spinner · Failed-retry red on muted bg). Lives in [renderer/components/editor/SaveControl.tsx](renderer/components/editor/SaveControl.tsx); replaces the prior text-span + Save button at the right edge of EditorToolbar. Both editor (TipTap) + canvas (PageTab) surfaces consume the shared control. Failed-retry state takes priority over saving (defensive against a stuck saving flag) and over unsaved (user needs the retry affordance, not a bare Save). Save-error state cleared on next edit + on next successful save. Locked priority order via 8 unit tests at [renderer/components/editor/SaveControl.test.ts](renderer/components/editor/SaveControl.test.ts).
**Priority:** Medium (UI clarity — current setup has TWO controls that perform the same conceptual thing).
**Filed:** 2026-05-06 (idle-thoughts sweep).

**What's wanted.** Today the markdown editor + canvas toolbar shows: a "Saved" / "Saving..." status indicator AND a "Save" button. They duplicate state. Consolidate into a single control that shows current state AND lets the user fire a manual save.

**Needs refinement.**
- **Behavior states.** When clean: "Saved" (button disabled, or just static text). When dirty: "Save" (button active, click triggers save). When mid-save: "Saving…" (button disabled, spinner). When error: "Failed — retry" (red, click retries). Owner sign-off on the four-state model.
- **Visual treatment.** Pill button (matches the existing accent-bg button family)? Inline label only when clean, full button when dirty? Material-style FAB? Recommend pill button.
- **Surfaces.** Markdown editor + canvas — both toolbars get the new control. Position-match with the current Save button.

**Affected files.** `MarkdownEditor.tsx § toolbar`, `RenderedPage.tsx § toolbar` (or wherever the canvas's Save lives), shared `<SaveControl>` component if we want one.

---

### ENH-104: Autosave should be toggle-able

**Status:** ✅ **Shipped 2026-05-07 (Sprint 10 P0, paired with ENH-103).** Hover-reveal "Autosave: on/off" toggle adjacent to the SaveControl pill — opacity-0 by default, group-hover and focus-within reveal it. Single global localStorage key (`duo.autosave.v1`, default ON) shared across editor + canvas via the [renderer/components/editor/autosavePreference.ts](renderer/components/editor/autosavePreference.ts) hook. Off mode suppresses ONLY the 800ms debounce timer — ⌘S, the Save button, and unmount-flush still write (autosave-off is about latency in steady-state edits, not data preservation on tab close). When OFF, the toggle's text is amber-tinted to hint that the non-default mode is active. Cross-tab sync via a `duo:autosave-changed` CustomEvent so flipping the toggle in one editor updates every visible SaveControl in the same Duo session.
**Priority:** Low (current autosave is fine for the dominant flow; toggle is for users who want explicit control).
**Filed:** 2026-05-06 (idle-thoughts sweep).

**What's wanted.** A user-controllable toggle that disables autosave (`AUTOSAVE_DEBOUNCE_MS` debounce). When off, only `⌘S` / Save-button clicks persist edits to disk.

**Needs refinement.**
- **Where the toggle lives.** App-level (`localStorage` setting, persists across sessions)? Per-tab (toggle on the editor's toolbar)? Per-file (in a sidecar)? Recommend app-level — autosave is a global preference, not per-doc.
- **UI surface.** Settings panel (we don't really have one — see Stage 19a/22 territory)? Edit menu? View menu? Right-click on the new SaveControl from ENH-103?
- **Sidecar interaction.** Autosave-off mode still saves the sidecar (comments) on demand? Or treat sidecar saves identically to body saves under the same toggle?
- **Persistent dirty state.** With autosave off, dirty state can persist for hours/days. Need a visual cue stronger than the current dot.

**Pairs with ENH-103** — the SaveControl naturally surfaces "autosave: on / off" as a hover-revealed setting.

---

### ENH-105: `@` triggers filename autocomplete in the canvas editor

**Status:** ✅ **Shipped Sprint 11 (2026-05-08, walks 1-3).** Implemented as `AtMention` TipTap extension at [renderer/components/editor/extensions/AtMention.ts](renderer/components/editor/extensions/AtMention.ts) using `@tiptap/suggestion` + custom `findAtMentionMatch` ([renderer/components/editor/extensions/suggestionMatchers.ts](renderer/components/editor/extensions/suggestionMatchers.ts)) that rejects mid-word `@` (so `email@example` doesn't trigger). Inserts the canonical `[[wikilink]]` form (not `@filename`) so vault round-trip is unified across `[[` and `@` triggers. Shared lifecycle + popover with WikilinkSuggestion (ENH-096 B.2) + VaultQuickSwitcher (ENH-096 B.4).
**Priority:** Medium (high pedagogical value: `@` for "reference a sibling file" matches Obsidian + Notion + Slack + every modern note tool).
**Filed:** 2026-05-06 (idle-thoughts sweep).

**What's wanted.** In the canvas editor (and probably the markdown editor too), typing `@` triggers a filename autocomplete popover. Source: parent folder of the active file, recursively (all subfolders). Result resolves to either a file path or a folder path (clicking opens the file or navigates to the folder). Escape dismisses.

**Needs refinement.**
- **Markdown editor scope.** ENH-096 already ships `[[wikilink]]` rendering and (Sprint 9 P0) cmd+click navigation. `@` autocomplete in the markdown editor would compete with — or complement — `[[`. Recommend: scope to canvas FIRST; markdown follows once the wikilink P0 closes.
- **What "parent folder" means.** Active file's directory? Or the navigator's CWD? Or the vault root if one exists (matches ENH-096's vault-root walk)? Recommend: vault root if `.obsidian/` exists, else navigator CWD. Falls in line with the rest of the vault-aware editor surface.
- **Autocomplete UI.** Popover list at caret, fuzzy-filter as user types, keyboard nav (↑↓), Tab/Enter to insert. Same shape as ENH-096's deferred B2 (wikilink autocomplete on `[[`) — pair them as ONE component.
- **Insertion shape.** Plain text path? Markdown link `[name](path)`? `@filename` as a literal token (a la Slack)? Owner pick.
- **Trigger char escape.** What if the user wants to type a literal `@` (e.g. an email address)? Standard pattern: dismiss-on-space, dismiss-on-non-matching-char.

**Affected files.** New `<AtMentionPopover>` component, integration with TipTap (suggestion plugin), file-list IPC (`files.list` recursive variant), keyboard handler. Probably 2–3 days of focused work.

**Pair with ENH-096 B2** — same primitive.

---

### ENH-106: Extend lock/unlock to Markdown files (frontmatter persistence)

**Status:** ⬜ DRAFT — needs refinement before code.
**Priority:** Medium-High (real first-user exists: `idle-thoughts.md` is a regenerable Notion mirror that should never accept local edits, but today there's no mechanism to enforce that).
**Filed:** 2026-05-08 (idle-thoughts processing pattern shift to Notion-canonical).

**What's wanted.** Extend the lock / unlock concept (ENH-034 + ENH-100) from HTML canvases to Markdown files. The HTML side ships today via `<meta name="duo-default-editable" content="false">` parsed in `electron/files-service.ts § getHtmlMeta`; markdown has no equivalent. Add a parallel mechanism so a `.md` file can be marked "open in read-only mode" with the same eye/pencil toggle strip the HTML canvas uses.

**Real-world driver.** The local `idle-thoughts.md` is now a read-only mirror of [Duo Idle Thoughts (Notion)](https://www.notion.so/Duo-Idle-Thoughts-34d45f48854f8032ba68fae6dc0473fe) — refreshed via the Notion MCP every time Claude reads idle-thoughts. Local edits get silently overwritten on next sync. Surfacing this as a UI lock (with explicit unlock to override) prevents the data-loss footgun. Lesson packs (Stage 28) are the second use case: lesson markdown should mount read-only by default for the same reason canvas lessons do.

**Recommended persistence — YAML frontmatter.**

```markdown
---
duo-default-editable: false
---

# Document body…
```

Rationale:
- **Standard convention.** Jekyll, Hugo, Obsidian, Notion-export all use YAML frontmatter. Agents writing markdown already know the pattern.
- **Single-file unit.** No sidecar, no localStorage divergence between machines.
- **Mirrors the HTML mechanism.** Same key name (`duo-default-editable`), same true/false semantics, same precedence rules. Re-uses the per-tab pencil/eye toggle that ENH-034 already shipped (just gate it on a different parser path).

**Plumbing checklist (mirrors ENH-034).**

1. **`electron/files-service.ts`** — add `getMarkdownMeta(filePath)` that parses YAML frontmatter and returns `{ editableDefault: boolean | null }`. Reuse a small frontmatter parser (e.g. `gray-matter` is dep-heavy; a 30-line custom parser handling `---\nkey: value\n---` is enough for v1).
2. **`shared/host-api.ts`** — extend `MarkdownFileMeta` (new shape, parallel to `HtmlFileMeta`) with `editableDefault?: boolean`.
3. **`renderer/components/editor/MarkdownEditor.tsx`** — read meta on mount, seed initial `readOnly` state. Hide TipTap's full toolbar when `readOnly`; show a `Read-only · Edit` strip parallel to `CanvasTab`'s.
4. **TipTap read-only.** TipTap-core has `editor.setEditable(false)` (it's the standard pattern; "tiptap-markdown doesn't have a read-only mark" in ENH-100 was wrong — `setEditable` is at the editor level, not the markdown extension). Verify it disables ProseMirror input + paste + drop + IME without breaking the rendered view.
5. **Persisting unlock.** Mirror ENH-034: per-file localStorage key `duo:editor:readOnly:<path>` overrides the meta default. Toggling the strip flips localStorage, NOT the source frontmatter (so the file stays canonically "this is a locked doc" but the user can scribble locally if they really mean it).
6. **`agents/duo.md` + `skill/SKILL.md`** — document the frontmatter convention so agents can write `duo-default-editable: false` into generated lessons / mirrors / docs.

**Cross-reference ENH-100.** ENH-100 is the right-click "Lock / Unlock" verb; ENH-106 is the underlying data-model + editor wiring it depends on. ENH-100's "Markdown later if there's a real use case" arm closes once ENH-106 lands. After ENH-106:
- ENH-100 v2 surfaces "Lock" / "Unlock" on markdown tabs alongside canvas tabs.
- Right-click "Lock" on a markdown tab writes the frontmatter on save (or surfaces an AskUserQuestion if the file has no frontmatter block — "add `duo-default-editable: false` to the top of the file?").

**Open questions for owner.**
- **Frontmatter visibility in the editor.** TipTap by default would render `---\nduo-default-editable: false\n---` as visible content. Options: (a) frontmatter is hidden in the rendered view but visible in source view (Obsidian-style); (b) frontmatter renders as a small grey collapsed strip at the top; (c) frontmatter is fully invisible and only the toggle strip surfaces it. Recommend (a) — matches Obsidian, gives advanced users a clear handle, doesn't pretend the file is something it isn't.
- **Sidecar fallback?** If frontmatter proves too invasive (e.g. for files the user wants to keep clean source for), allow a parallel `.duo.json` sidecar with `{ "editableDefault": false }`. Defer to v2.
- **Other frontmatter fields (forward-compat).** While we're parsing frontmatter, ENH-096 (Obsidian-vault-friendly editor) lands with its own conventions (vault-root, sidecar, wikilink config). The frontmatter parser should be a shared module both can consume. Plan the API once, ship it twice.

**First user lined up.** `idle-thoughts.md` already carries an explicit `<!-- Canonical: ... -->` warning header today. Once ENH-106 ships, the Notion-sync writer adds a `duo-default-editable: false` frontmatter block to every refresh, so the file auto-locks. Pre-loading the frontmatter NOW (before ENH-106 ships) is harmless — TipTap renders it as visible YAML until the parser lands, then it goes invisible and the lock activates.

---

### ENH-107: Terminal tab strip — context-menu commands to move tabs left / right

**Status:** ⬜ DRAFT — needs refinement before code.
**Priority:** Medium-Low (working-pane tabs already have drag-and-drop reorder via ENH-042; terminal tabs have neither drag-reorder nor context-menu reorder today, so users with 3+ terminal tabs have no way to reorganize them).
**Filed:** 2026-05-08 (idle-thoughts sweep).

**What's wanted.** Right-click on a terminal tab in `TerminalPane.tsx` → context menu with at minimum two entries: `Move tab left` (disabled when tab is at index 0) and `Move tab right` (disabled when tab is at last index).

**Current state.** `TerminalPane.tsx` (line 162) maps tabs to buttons with NO `onContextMenu` handler — terminal tabs have no right-click menu at all today. `WorkingTabStrip.tsx` already has drag-and-drop reorder (ENH-042) and a working tab context menu (ENH-026: Reveal in Navigator + others); the working-pane patterns can be cribbed for the terminal side.

**Plumbing checklist.**

1. **`renderer/components/TerminalPane.tsx`** — add `onContextMenu` on each tab button. Spawn a small popover-style menu (matches `WorkingTabStrip.tsx`'s ENH-026 affordance — same visual language).
2. **State plumbing.** Terminal tab order lives in `renderer/App.tsx` § `tabs` state (line ~307 area). Add a `moveTerminalTab(id, direction)` callback or expose `setTabs` reorder helper. Persist tab order in `~/.claude/duo/session-state.json` so reorder survives restarts (terminal tabs already restore via Stage 21c Phase 2).
3. **CLI parity (per CLAUDE.md working-style item 4).** UI feature → CLI counterpart. New verb: `duo terminal move <tab-index> <left|right>` (or `duo terminal reorder <from> <to>`). Bridge → `electron/socket-server.ts` → renderer state. Touch the full plumbing checklist (shared/types.ts, preload.ts, main.ts, socket-server.ts, cli/duo.ts, skill/SKILL.md, agents/duo.md, docs/CLI-COVERAGE.md).
4. **Optional v2: drag-and-drop reorder.** Crib from `WorkingTabStrip.tsx § ENH-042`. Reuse the same drag-target overlay logic. Could ship in the same PR if low-cost; defer to v2 if context-menu version lands first.

**Open questions for owner.**
- **Menu scope.** Just `Move left` / `Move right`, or also `Close tab` / `Close other tabs` / `Pin tab` while we're adding context-menu plumbing? Recommend: just the two reorder entries for v1; expand if there's a real ask.
- **Keyboard chord parallel?** Working-pane tab reorder via `⌘⇧←` / `⌘⇧→` would be a natural pair. Could file as a sub-ENH or roll in.

**Affected files.** `renderer/components/TerminalPane.tsx`, `renderer/App.tsx` (state), `electron/main.ts` (session-state persistence), CLI plumbing chain. Smaller surface than ENH-105/106 but still touches the full CLI-parity stack.

---

### ENH-108: Paste-image handling — markdown editor + HTML canvas (save to active file's parent dir)

**Status:** ⬜ DRAFT — needs refinement before code. **Owner-directive P0 for Sprint 9 (high priority).**
**Priority:** **High** — owner explicit "high priority item to the roadmap / include in the next sprint" (idle-thoughts sweep, 2026-05-08). Closes a workflow-defining gap: today, dropping an image into a doc means save-to-Desktop → drag-to-finder → markdown-link-by-hand. After this lands, ⌘V into either editor surface "just works" the way Obsidian / Notion users expect.
**Filed:** 2026-05-08 (idle-thoughts sweep).

**What's wanted.** In BOTH the markdown editor (`MarkdownEditor.tsx`) and the HTML canvas (`RenderedPage.tsx` iframe), paste-from-clipboard with image data should:

1. **Save the image** to the parent directory of the active file (or a fallback location for untitled docs).
2. **Insert a reference** at the caret — markdown editor uses `![](relative-path)`, HTML canvas uses `<img src="relative-path">` ("html tagging" per the owner's bullet).
3. **Both surfaces feel identical** from the user's perspective: same trigger (⌘V), same auto-naming, same in-folder save.

**Plumbing checklist.**

1. **TipTap Image extension audit.** Verify `@tiptap/extension-image` is in the editor config; if not, add it. Confirm it round-trips through tiptap-markdown's serializer as `![](path)` and not as inline base64.
2. **Markdown-editor paste handler.** TipTap exposes `editorProps.handlePaste`. Detect `event.clipboardData.items` entries with `image/*` MIME types, extract as Blob, IPC-save via the new endpoint, insert the image node at caret.
3. **Canvas paste handler.** `RenderedPage.tsx` mounts the iframe; install a `paste` listener on the iframe document. Same Blob → IPC → insert flow, but inserts an `<img>` element via `execCommand('insertHTML', ...)` or direct DOM manipulation (matches existing canvas mutation patterns).
4. **IPC endpoint.** `electron/files-service.ts § saveImageBeside(activeFilePath, buffer, ext) → { path, error? }`. Writes to `dirname(activeFilePath)/<generated-name>.<ext>`. Returns the relative path the editor should insert.
5. **Filename generation.** `image-<YYYYMMDD-HHMMSS>-<4charhash>.<ext>` — sortable, zero collisions, readable. Hash is `crypto.randomBytes(2).toString('hex')`.
6. **MIME → extension mapping.** `image/png` → `.png`, `image/jpeg` → `.jpg`, `image/gif` → `.gif`, `image/webp` → `.webp`, `image/svg+xml` → `.svg`. Reject other MIMEs with a console warn.
7. **Untitled-file edge case.** If the active file has no on-disk path (new tab, never saved), surface an AskUserQuestion: "Save document first to use paste-image, or save image to ~/.claude/duo/scratch-images/?" Recommend the prompt-to-save default.
8. **Drag-and-drop parity (v1).** Same handler for `drop` events with image files attached. One handler implementation, two trigger sources.
9. **CLI parity (per CLAUDE.md working-style item 4).** New verb: `duo image insert <local-path>` — insert an image from a local file into the active editor's caret position (copies to active-file parent dir if outside it; references it if inside). Touches the full plumbing chain (shared/types.ts, preload.ts, main.ts, socket-server.ts, cli/duo.ts, skill/SKILL.md, agents/duo.md, docs/CLI-COVERAGE.md).
10. **Skill stub.** `skill/examples/paste-image-workflow.md` showing the agent-side trigger pattern.

**Open questions for owner.**

- **Filename strategy.** Timestamp + hash (recommended — sortable, collision-free), or content-hash dedupe (saves disk if user pastes the same image twice, but harder to read), or per-folder counter `image-1.png`?
- **Vault-relative vs file-relative paths.** ENH-096 introduces vault-root awareness. For v1, paths are file-relative (simpler). v2 could opt into vault-root if `.obsidian/` exists.
- **Alt-text prompt.** Empty for v1 (users can edit), or AskUserQuestion on every paste? Recommend: empty for v1.
- **Max image size.** No limit for v1, or reject > N MB to prevent accidental huge-PNG pastes? Recommend: no limit; surface as v2 if it becomes a problem.
- **Image format normalization.** Clipboard PNGs are often huge (browser screenshots). Convert to JPEG for photographic content? Recommend: keep clipboard format for v1; revisit if disk-bloat reports surface.
- **Markdown editor scope vs HTML canvas scope.** Both surfaces ship together (same PR), or one-at-a-time? Recommend: ship together — the user-facing promise ("paste an image, it goes in") is identical, and the IPC + filename code is shared.

**Affected files.**
- `renderer/components/editor/MarkdownEditor.tsx` (paste handler).
- `renderer/components/Page/RenderedPage.tsx` (iframe paste handler).
- `renderer/components/Page/PageTab.tsx` (mount the handler if needed).
- `electron/files-service.ts` (`saveImageBeside`).
- `shared/host-api.ts` + `electron/preload.ts` (IPC contract).
- `electron/socket-server.ts` (CLI verb routing).
- `cli/duo.ts` (`duo image insert`).
- `skill/SKILL.md` + `agents/duo.md` (cheat-sheet entry).

**Cross-refs.**
- **ENH-096** (Obsidian-vault-friendly editor) — adjacent territory; Obsidian's "default location for attachments" is the design precedent. This ENH picks the simplest variant (same folder as active file).
- **BUG-061** (canvas markdown gap — bullets/indent missing) — same theme of MD/HTML editor parity. Both ENH-108 and BUG-061 push toward "the two surfaces feel identical for content authoring."
- **Editor-canvas parity rule** in CLAUDE.md (Locked decision 2026-05-02) — **mandatory disposition for both surfaces in this PR**: this is option (a) **Mirrored** — same feature in both the markdown editor and the HTML canvas, same PR.

**Smoke after ship.**
1. Open a markdown file. ⌘C an image from a screenshot, ⌘V into the editor → image appears inline; check the source for `![](image-...)` markdown link; confirm the file landed beside the markdown.
2. Same flow in HTML canvas → image appears inline; source view shows `<img src="image-...">`.
3. Drag-and-drop a `.jpg` from Finder onto either surface → same outcome.
4. Untitled markdown tab + ⌘V image → AskUserQuestion appears.
5. CLI: `duo image insert /path/to/local-image.png` from a different cwd → image saved beside active doc, inserted at caret.

---

### ENH-113: Tab should detect file deletion and close-with-alert

**Status:** 🆕 Filed 2026-05-07 (Sprint 9 walk-1, owner ENH idea).
**Priority:** **Low–Medium** — UX paper cut. Active editor tabs become orphaned views of disk state when the file is deleted out from under them; typing into the buffer continues but autosave starts erroring or recreates the file silently.
**Filed:** 2026-05-07.

**What's wanted.** When a file with an active tab is deleted (e.g. `rm -f /tmp/foo.md` from any terminal, or any other process), Duo should detect the deletion via the file watcher and either:
1. Close the tab automatically with a brief banner ("`foo.md` was deleted from disk; closed."), OR
2. Mark the tab visually as "orphaned" + offer a button to recover (re-save the in-memory buffer to the original path) or close.

Recommended: option 1 for clean state + option 2 for dirty state — clean buffer = nothing to lose, just close; dirty buffer = preserve the work behind a banner.

**Affected code.**
- `electron/files-service.ts § watch` already runs chokidar on the navigator's CWD; it emits unlink events.
- `renderer/App.tsx` listens to navigator state pushes and could subscribe to a `file-deleted` channel.
- New IPC channel `IPC.FILES_DELETED` (broadcast on chokidar unlink for any watched path).
- Renderer-side handler in App.tsx: scan fileTabs for matching path; for clean tabs, closeFileTab; for dirty tabs, mark with a `deletedFromDisk: true` flag + render the banner.

**Cross-ref:** Surfaced during ENH-091 walk-1 — owner reset the test file with `rm -f /tmp/enh091-fresh.html`, then re-`duo edit`'d, and the failed ENOENT showed the autosave-against-deleted-file path is currently silent.

---

### ENH-112: Distro Pack Builder Workshop — repo-resident playground doc + assistant skill

**Status:** 🟡 **LANDED in Sprint 9 (2026-05-07)** — initial scaffolding shipped. Workshop folder `distro-pack-builder/` carries scoped CLAUDE.md + README.md + step-by-step playground.md (11 steps from scaffold-from-template through cohort distribution) + project-scoped assistant skill at `.claude/skills/pack-builder-workshop/SKILL.md`. Does NOT ship to end-user machines (npm sync:claude unchanged); only people who clone Duo and open Claude in the workshop folder pick it up. Root CLAUDE.md updated to reference the new folder. Refines as real pack builders surface friction.
**Priority:** Sprint 9 P1 (locked 2026-05-07 sprint-plan session — owner directive).
**Filed:** 2026-05-07.

**Verification owed.** A real pack builder (or owner) walking the playground end-to-end on a non-Geoff machine. Closes the FOLLOWUP-011 cross-machine-validation gap simultaneously. Scaffolding is in place; walking it surfaces real-builder friction the v1 doc doesn't anticipate.

**Resolved (per recommended path).**
- Folder location: top-level `distro-pack-builder/` (not under `examples/` — keeps the workshop itself separate from the template the workshop references; existing `examples/distro-pack-template/` stays where it is and is *referenced* from the workshop).
- CLAUDE.md scope: explicit "inherits from `../CLAUDE.md`" reference + workshop-specific scope on top. No partial-merge mechanics.
- Skill discovery: project-scoped at `<workshop>/.claude/skills/pack-builder-workshop/`; not synced to `~/.claude/`.
- Doc format: markdown, step-by-step with embedded code examples, "Common pitfalls" troubleshooting table.
- Smoke validation: included as Step 10 of playground.md (smoke install on builder's own Mac before distribution).


**What's wanted.** A rich, step-by-step playground doc that walks an enterprise distro pack builder through Duo's pack-builder primitives — what's available, how to build them, where to load them. Bundled with an authoring-assistant skill scoped to the cwd. The skill ships **in the repo** (so contributors / forkers / enterprise pack builders cloning Duo get it) but **NOT in the canonical signed DMG / ~/.claude/skills/** (end users don't need it).

**Workflow.** A distro pack builder clones / forks the Duo repo, opens Claude Code in `<repo>/distro-pack-builder/` (or wherever the workshop folder lives), and immediately has:
- A scoped CLAUDE.md telling Claude "you are helping build a Duo distro pack — here are the primitives, here are the conventions, here's where things load."
- Human-facing step-by-step docs for the builder to read.
- An assistant skill that helps with the mechanical work — manifest authoring (`plugin.json` + `DISTRO.json`), validation, build-zip / build-pkg / build-bundled-fork, version bumping, smoke testing.

**Distinct from the existing `pack-builder` skill (Stage 21d-ii).** That skill ships globally via `npm run sync:claude` → `~/.claude/skills/pack-builder/`. It's the *canonical authoring path* for any user. ENH-112 is the **workshop wrapper** — guided tutorial + scoped CLAUDE.md + assistant — that lives in the repo and only activates for people working IN the repo. Ideally the new skill *uses* the existing pack-builder skill rather than duplicating it.

**Needs refinement.**
- **Folder location.** Top-level `distro-pack-builder/`? Under `examples/` (alongside the existing `examples/distro-pack-template/`)? Under `tooling/`? Recommend top-level `distro-pack-builder/` with the existing template folder remaining at `examples/distro-pack-template/` and being *referenced* from the workshop.
- **Workshop CLAUDE.md scope.** Does it inherit from the project root CLAUDE.md? Override? Partial merge? Recommend: reference the project root via "see `../CLAUDE.md`" + add workshop-specific scope on top.
- **Skill discovery.** If the skill lives at `<repo>/distro-pack-builder/.claude/skills/`, Claude Code auto-discovers it when cwd is inside that folder. No `npm run sync:claude` step needed for the workshop skill — it's project-scoped by design.
- **Doc format.** Markdown (renders in Duo canvas, easy to read). Step-by-step with embedded code examples, screenshots if useful.
- **Smoke validation.** The workshop should be walkable end-to-end by someone unfamiliar with Duo internals. A second-person walk (cross-machine cohort validation) closes the FOLLOWUP-011 gap simultaneously.

**Affected files / new structure (proposed).**
- `distro-pack-builder/CLAUDE.md` — scoped builder instructions.
- `distro-pack-builder/README.md` — entry point linking to the playground doc.
- `distro-pack-builder/playground.md` — step-by-step walk through primitives.
- `distro-pack-builder/.claude/skills/pack-builder-workshop/` — assistant skill (project-scoped, not synced).
- Cross-references to `examples/distro-pack-template/` and `skill/references/distro-v1-schema.json`.

**Pairs with FOLLOWUP-011** (cross-machine substrate validation) — a real enterprise pack builder following the workshop on a non-Geoff machine validates Stage 21d's substrate end-to-end.


## Missing features

### MISSING-001: Markdown editor — no way to add a comment

**Status:** 🟡 **PARTIAL** in v0.6.7 (Sprint 6 Phase 4, 2026-05-04). Full TipTap data plane SHIPPED (mark + sidecar + re-anchor + rail + 3 affordances all work end-to-end and reopen-survives), but smoke walk surfaced one regression: clicking a rail thread beyond #1 doesn't activate the corresponding anchor's stronger background tint. Filed as BUG-087 — follow-up before the v0.6.7 cut. Full TipTap data plane:

- **`CommentMark` extension** (new `renderer/components/editor/extensions/CommentMark.ts`). Inline mark with a `commentId` attribute that renders as `<span data-duo-comment-id="…" class="duo-comment-anchor-text">`. Inclusive boundaries (typing at the edge extends the anchor); doesn't merge with adjacent marks of a different id; commands `applyCommentMark(id, from?, to?)` and `removeCommentMark(id)` for the comment lifecycle.
- **Sidecar persistence** (`<file>.md.duo.json`, same shape as canvas — extended `SidecarComment` with optional `excerpt` / `contextBefore` / `contextAfter` for re-anchoring). Markdown source stays clean: `Markdown.html` is configured `false` so the spans strip on serialize; comments live entirely in the sidecar JSON.
- **Re-anchor on file load** (`renderer/components/editor/markdownComments.ts` — new module). Walks the parsed doc looking for each sidecar comment's excerpt; uses `contextBefore` / `contextAfter` for disambiguation when the same excerpt appears multiple times. Pre-save pass refreshes excerpt + context to the latest text so the next reopen finds it. PM-position → text-offset mapping handles node-boundary off-by-one cleanly.
- **CommentRail + composer** wired in MarkdownEditor with the same primitive shared with the canvas. The `NewCommentComposer` got extracted from PageTab into `primitives/NewCommentComposer.tsx` so both surfaces use one implementation.
- **Three discoverable affordances** (parity with BUG-081's canvas redesign):
  - Toolbar 💬 button via `EditorActions.startComment` + `canStartComment`. Wires through a `startCommentRef` so the editorActions closure stays stable while the toolbar always invokes the latest handler.
  - ⌘⌥M global shortcut (no new chord — same `'startComment'` ShortcutId from Phase 2; the markdown editor listens for `'duo-start-comment'` window events identically to the canvas).
  - Right-click "Comment" menu entry. `electron/main.ts` gate extended: shown when EITHER the canvas iframe (`frameURL` is `about:srcdoc`) OR the main BrowserWindow's renderer with an editable selection (`isEditable === true`). Browser-tab WCVs have their own ecmOptions instance so they're never affected.
- **Visual decoration** in `globals.css` mirrors the canvas's `[data-duo-has-comment]` rule for `.ProseMirror [data-duo-comment-id]` — soft accent background + bottom border, stronger when the thread is active. Light + dark mode parity.
- **Bidirectional click-to-focus** wired: clicking a thread in the rail → scroll editor to the marked range; clicking the marked text → activate the corresponding rail thread.

Verified live: created comment via toolbar / ⌘⌥M / right-click; the rail mounts; the second paragraph picks up the orange decoration; close + reopen the file — decoration reappears via the re-anchor pass; Electron-restart cycle preserves everything (sidecar on disk).

Promoted 2026-05-04 after owner asked "I thought we shipped comments a long time ago for both the markdown editor and HTML canvas — I can't find them in the app." Stage 14a was deferred sprint after sprint; this is the cycle that ships it. Pairs with BUG-081 (canvas comments regression — file together as the "comments are real and visible" sprint).
**Priority:** **High** (was Medium — feature gap that the owner recently re-discovered; the comments capability was always communicated as "shipped on canvas, coming to markdown next" but Stage 14a never landed).
**Filed:** 2026-04-26 (v0.3.0 pre-cut smoke). Re-prioritized 2026-05-04.

**Context:**
Stage 14a (CommentRail binding for the markdown editor) is the planned home for this — currently labeled "next" on the roadmap, with the visual primitive (`<CommentRail>`) already built in 17d-A and reused by the canvas. The markdown half hasn't shipped. `MarkdownEditor.tsx` has zero comment imports; the entire comment data plane (TipTap mark + decoration + anchor reconciliation across edits) is the unbuilt half.

**Suggested next step:**
Pair with BUG-081 fix in v0.6.7. Sprint shape:
1. Fix BUG-081 first (canvas regression; smaller scope, restores known-good behavior).
2. Stage 14a — TipTap mark for `data-duo-comment-id` anchors, decoration to render the floating Comment pill on selection, anchor-reconciliation across edits (the hard part — when the user edits text mid-comment, the anchor should follow), CommentRail data-plane wire-up. The visual primitive + new-comment composer pattern are already solved canvas-side and reused.
3. Smoke walk to validate both surfaces end-to-end before next cut.

**Cross-ref:** BUG-081 (the canvas-side regression discovered in the same investigation). Stage 14 / 14a on `docs/roadmap.html`. Stage 17d-A (where the canvas-side first shipped).

---

## Enhancement opportunities

### ENH-001: New HTML canvases should default to stable IDs

**Status:** ✅ Shipped 2026-04-26 (v0.3.1)
**Priority:** Medium (UX papercut)
**Filed:** 2026-04-26 (v0.3.0 pre-cut smoke)

**Today:**
First open of a new canvas pops the "Add stable IDs to all elements?" prompt (Stage 17b H12–H14). Per-directory choice persists.

**The papercut:**
When Duo *itself* wrote the canvas (`duo html new`), the prompt is unnecessary friction — Duo's own boilerplate ships with no IDs, and the agent is the most common CLI user.

**Suggested fix:**
- `duo html new` could write a sidecar (`<file>.duo.json`) with `idChoice: 'always'` so the first open auto-injects without prompting.
- Or: `duo html new` injects IDs at write time so the file lands on disk with them already.

The prompt remains valuable for HTML files Duo *didn't* author (a hand-authored or downloaded canvas the user opens).

---

### ENH-004: Better default boilerplate for new HTML canvases (paired with ENH-001)

**Status:** ✅ Shipped 2026-04-26 (v0.3.1)
**Priority:** Medium (pair with ENH-001 — both touch `duo html new`'s output)
**Filed:** 2026-04-26 (during v0.3.0 cut, owner suggestion)

**Today:**
`shared/html-boilerplate.ts` ships a minimal H17 v1 skeleton: `<!doctype html>`, title meta, `<h1>${title}</h1>`, empty `<p>`. No styles, no IDs, no Atelier flavor. The first-open prompt asks the user about ID injection (because IDs are absent).

**Suggested combined improvement (closes ENH-001 + ENH-004):**
1. **Inject `data-duo-id="<ulid>"` on every element at write time**, not on first open. The first-open prompt becomes redundant for Duo-authored canvases (closes ENH-001 by construction; the prompt remains valuable for hand-authored / downloaded HTML the user opens later).
2. **Add a small inline CSS block** so the canvas reads well immediately:
   - Atelier-ish defaults (cream paper, ink-soft body, serif headings, accent ochre).
   - `prefers-color-scheme: dark` media query for dark mode.
   - Body width cap (~720px max-width, centered, generous line-height).
3. **Add `<meta name="viewport">`** for sensible defaults if a canvas gets shared as a web page later.
4. **Drop a small invisible HTML comment** describing what the file is and how to extend (helps an agent see "this is a Duo canvas, the IDs are stable, etc." when reading via `duo html get`).

The styles must remain canvas-local and editable — the user can delete or rewrite them at will. They're a starting hint, not a contract. The "no Duo chrome leaks" guarantee (`duo-just-added`, `data-duo-canvas-runtime`, etc.) still applies; these are user-authored CSS, not runtime-only attributes.

**Affected files:**
- `shared/html-boilerplate.ts` — extend the template.
- `renderer/components/HtmlCanvas/idInjector.ts` (or the equivalent ulid mint) — used at write time too.
- `electron/main.ts § htmlNew` — call the new boilerplate that already has IDs.
- `renderer/App.tsx § onCommitNewFile` — same call site for ⌘N + `.html` path.

**Cross-refs:** ENH-001 (closed by this), Stage 17 PRD H17 (full Atelier body width + Tailwind opt-in is still 17b/17e scope; this is a smaller "useful defaults out of the box" middle ground).

---

### ENH-003: "What Duo Does" should default-pin alongside the FAQ

**Status:** ✅ Shipped 2026-04-26 (v0.3.1)
**Priority:** Medium (FTUX consistency)
**Filed:** 2026-04-26 (during v0.3.0 cut)

**Today:**
First-launch (and every fresh window) shows the FAQ as the default browser-pane landing tab. "What Duo Does" — the canonical capability inventory at `~/.claude/duo/help/what-duo-does.html` — is reachable only via a link from the FAQ.

**The request:**
Make "What Duo Does" a second pinned default tab alongside the FAQ so users see both reference surfaces immediately without hunting. The FAQ explains *concepts*; What Duo Does enumerates *capabilities* — they pair.

**Suggested implementation:**
- Bootstrap a `~/.claude/duo/pins.json` with the two help URLs pre-pinned at install time (Stage 18b's `PACK.json § pins` is the natural home, but a smaller direct-write at install can ship sooner).
- Or: extend the `BrowserManager.defaultLandingUrl()` to seed *two* tabs on a fresh session instead of one, both pre-pinned.

Cross-refs Stage 24 (pin storage), Stage 18b (distro pre-pins).

---

### ENH-002: "Paste as plain text" — menu item + keyboard shortcut for all editors

**Status:** ✅ Shipped 2026-04-26 (v0.3.1)
**Priority:** Medium (request; cross-editor consistency)
**Filed:** 2026-04-26 (v0.3.0 pre-cut smoke)

**Scope:**
Both the markdown editor (TipTap) and the HTML canvas (contentEditable) inherit the standard rich-paste behavior. Users coming from Google Docs / web apps regularly want to drop the styling.

**Suggested implementation:**
- Single menu item "Edit → Paste and Match Style" wired via Electron's app menu.
- Keyboard shortcut: ⌘⇧V (macOS standard).
- Each editor handles by reading the clipboard's `text/plain` instead of `text/html`.
- Pairs with BUG-016 — fixing paste-as-plain-text by default for the canvas would also kill the dark-mode contrast bug.

---

## Follow-ups (open · process / docs)

### FOLLOWUP-001: Add `agents/duo.md` to the new-CLI-verb plumbing checklist (CLAUDE.md)

**Status:** ✅ Closed 2026-04-26 late-evening (Stage 5 v2)
**Priority:** Low (process)
**Filed:** 2026-04-26 evening
**Closed:** Item 7 of the plumbing checklist now reads "every new verb
must update the agent's verb cheat-sheet" without the *pending*
qualifier. The `duo` subagent file at `agents/duo.md` is load-bearing.

**What.** When Stage 5 v2 (Duo subagent) lands, the existing "every new CLI verb must touch these places" checklist in `CLAUDE.md` (currently `shared/types.ts` + `electron/preload.ts` + `electron/main.ts` + `electron/socket-server.ts` + `cli/duo.ts` + `skill/SKILL.md`) needs a new entry: **`agents/duo.md`**. Once the agent is the canonical CLI driver for orchestrators, every new verb without an agent-prompt update means agents will be unaware of it and orchestrators will fall back to inline-CLI for that verb, defeating the purpose.

**Why deferred.** The agent file doesn't exist yet — Stage 5 v2 is the stage that creates it. Updating the checklist now would point at a missing file and confuse anyone shipping a verb in the meantime.

**When to actually do it.** Build-order step in `docs/prd/stage-5-v2-duo-subagent.md` § 9 already includes "update CLAUDE.md plumbing checklist." Treat this `tasks.md` entry as the surface that surfaces the work if the PRD step gets dropped during execution.

**Affected file:** `CLAUDE.md` (the "Plumbing checklist for a new CLI verb" inside the "CLI parity" rule, near line ~330 of the file).

---

### FOLLOWUP-002: Harden `agents/duo.md` session guard against Bash-allowlist denial

**Status:** ⏳ Open (low priority — corner case)
**Priority:** Low
**Filed:** 2026-04-26 late-evening, during Stage 5 v2 live walks

**What.** When the agent's session-guard bash command (`[ -n "$DUO_SESSION" ] && echo "in_duo" || echo "not_in_duo"`) is permission-denied — typically because a user wrote a tight `Bash(duo *)` allowlist that doesn't cover `[`/`echo`/compound commands — the agent currently proceeds with the task anyway. C5 walk surfaced this: with `--allowedTools "Bash(duo *)"` the guard check was denied 3 times, then the agent fell through to `duo doc read /tmp/foo.md` and reported the file's contents.

**Fix.** Add to the agent prompt's session-guard block: "If you cannot run the check (the Bash call is permission-denied or otherwise unable to execute), treat that the same as `not_in_duo` — refuse and stop. Never run a `duo` verb without first confirming `$DUO_SESSION` is set."

**Why low priority.** Most users don't hand-write Bash allowlists for the duo agent specifically; the realistic outside-Duo scenario (no allowlist) works correctly — verified live in C5.

**Affected file:** `agents/duo.md` (Session guard section, lines 19–37).

---

### FOLLOWUP-003: Re-measure Class B perf with cumulative-context methodology

**Status:** ⏳ Open (open question, not blocking)
**Priority:** Low
**Filed:** 2026-04-26 late-evening, during Stage 5 v2 live walks

**What.** The synthetic Class B measurement during Stage 5 v2 ship inverted the PRD's hypothesis: subagent path (`Sonnet → Task(duo)`) was ~2× the cost and 2× the wall-clock of inline (`Sonnet → Bash(duo *)`) on a fresh F1. Cause: Claude Code already routes mechanical tool execution to Haiku regardless of `--model`, so the subagent path stacks a second Haiku context on top of the existing fast-tier Haiku.

**Why the PRD pass criteria don't apply.** "≥60% orchestrator-token reduction" assumed the top-level Sonnet was processing CLI dumps. In Claude Code today, it isn't. The benefit framing has to shift to: *bounded context per task*, *specialized prompt*, *clear orchestrator/agent contract* — qualitative wins that scale with session length, not per-task dollar wins on a cold-cache synthetic.

**Right methodology.** Track cumulative orchestrator-context tokens across a multi-task session — e.g. 10 sequential duo tasks in one Claude Code session, with vs without subagent. The cache-pollution argument should show up there.

**Why low priority.** The agent already shipped; the qualitative wins are real even if the quantitative measurement disagreed with the PRD. Re-measurement is "would be nice for justifying the architecture" not "blocking next stage."

**Affected files:** none directly. Notional follow-up for whoever wants to validate the architectural choice.

---

### FOLLOWUP-004: Visual smoke of Stage 5 v2 + Stage 15.1 (CLI half + pill UI) via computer-use

**Status:** ⏳ Open (deferred — user couldn't approve computer-use access in the spawning session)
**Priority:** Low (CLI surface is verified via API responses; this would only catch UI/renderer regressions)
**Filed:** 2026-04-26 late-evening, after `request_access` for Electron timed out

**What.** Run the visual sanity pass on the live Duo app to confirm:
1. App boots cleanly post-Stage-5-v2 main-process changes (`shell.openExternal`, the `external` socket case, `getSelectionFormatState`/`setSelectionFormat`, `sendToActiveTerminal`, `TERMINAL_ACTIVE_PUSH` IPC) — no preload/main errors at mount.
2. The renderer's `useSelectionFormat` hook initializes cleanly and does its initial pushState (verify by running `duo selection-format` immediately after boot — should return `{format: 'a'}` for a fresh install or whatever was last persisted).
3. The `terminal:active-push` IPC fires on tab switch — open two terminal tabs, switch between them, run `duo send --text "marker"` while each is active, verify the payload lands only in the focused one.
4. The previously-issued `duo send` payloads from this session ("hello from duo send", "from stdin", the multi-line G10 sample) are visible in the active terminal's scrollback. (Will not have been "executed" — no Enter was pressed.)
5. No console / DevTools errors related to the new IPC channels.

**Why deferred.** `request_access` for Electron timed out — the user couldn't approve in the dialog from the session that needed it. Walking the smoke checklist § 1 (App boot) + § 2 (Terminal pane) + § 7 (Agent bridge — selection-format + send) by eye next session covers this faster than re-attempting computer-use.

**Recipe** (manual, ~5 min):
1. Launch Duo, open DevTools (⌘⌥I), check console for errors.
2. **CLI half:** in a Duo terminal: `duo selection-format` → expect `{format: 'a'}`; `duo selection-format c` → verify persisted state; `duo selection-format` → expect `{format: 'c'}`; `duo selection-format a` to restore. `duo send --text "smoke"` → expect "smoke" appended to terminal input line, no Enter pressed. Switch to a second terminal tab, repeat — payload lands in the new active tab only.
3. **Pill UI half (Stage 15.1):** open `/tmp/pill-fixture.md` (or any `.md`) via `duo edit`. Select a sentence in the editor with the mouse. **Expect:** a small purple pill labelled "Send → Duo ↗" floating ~6px above the selection, right-aligned to the selection's right edge. **Click the pill.** Expect: pill disappears, focus moves to the active terminal, and the formatted payload appears at the prompt — by default format A (`> "your selection"\n> (~/path · heading_trail)\n`), no Enter pressed. Verify with `duo selection-format b` then re-select-and-click → expect literal text only. Verify with `duo selection-format c` then re-select-and-click → expect an opaque token like `<<duo-sel-abc123>>`.
4. **Edge cases:** select near the top of the editor (no room above) → pill should appear *below* the selection; select to the far right of the column → pill should clamp to the viewport edge; click outside the editor without clicking the pill → pill should disappear (it follows editor focus).

**Affected files:** none directly. Just a verification pass.

---

## v0.4.2 punch list (filed 2026-04-27 from owner-side smoke)

Owner installed the prebuilt v0.4.2 DMG and walked the surfaces. These
came back as observations — a mix of bugs and enhancements. Filed
together so the v0.4.3 patch (or v0.5.0 cut) can scoop them in one
pass.

---

### BUG-018: ⌘T opens new browser tab landing on FAQ

**Status:** ✅ Shipped v0.4.3 (2026-04-27) — `⌘T` now opens fresh `about:blank` instead of duplicate FAQ
**Priority:** Medium (papercut — every new tab needs to be re-navigated)
**Filed:** 2026-04-27

**Today:**
`⌘T` from any pane opens a new browser tab that loads `~/.claude/duo/help/faq.html` (the default landing). The FAQ is right above as the default *first* tab — so `⌘T` produces a duplicate FAQ rather than a fresh canvas to navigate from.

**Expected:**
A "new tab" experience — about:blank, a stub "Where to?" page, or the most-recent-history URL. Whichever, it shouldn't be the FAQ.

**Suggested fix:**
`electron/browser-manager.ts § defaultLandingUrl()` is the FIRST-tab default. `⌘T`'s code path — `addTab(defaultLandingUrl())` — uses the same call. Split the two: keep `defaultLandingUrl()` as the boot default; add `newTabUrl()` (or accept an `addTab(undefined)` → about:blank) for the keyboard path.

**Affected files:** `electron/browser-manager.ts`, possibly `electron/main.ts` if the IPC for ⌘T-add-tab routes through there.

---

### BUG-019: ⌘T new browser tab doesn't focus the address bar

**Status:** ✅ Shipped v0.4.3 (2026-04-27) — address-bar focus via two nested `requestAnimationFrame`s after new-tab commit
**Priority:** Medium (pairs with BUG-018; together they're the "⌘T felt right" fix)
**Filed:** 2026-04-27

**Today:**
`⌘T` opens a new browser tab but the address bar stays unfocused. Browser-default behavior is for `⌘T` to land focus in the address bar so the user can type a URL immediately.

**Expected:**
After `⌘T` resolves, `BrowserRenderer`'s address-bar input has keyboard focus.

**Suggested fix:**
The new-tab code path needs to push focus to the address bar after `addTab()` resolves. There's likely a renderer-side `useEffect` that watches active tab changes; add a focus-the-address-bar branch when the new tab's URL is the new-tab placeholder (paired with BUG-018).

**Affected files:** `renderer/components/BrowserRenderer.tsx` (or the address-bar component); the new-tab dispatch in `App.tsx` / `WorkingPane.tsx`.

---

### BUG-020: First FAQ tab non-closeable but not pinned

**Status:** ✅ Shipped v0.4.3 (2026-04-27) — first/last tab now closeable; opens fresh `about:blank` first, then closes (Notion pattern)
**Priority:** Medium (UX inconsistency — should match an existing affordance)
**Filed:** 2026-04-27

**Today:**
The boot-time first browser tab (FAQ) doesn't render a close-X. Trying to ⌘W on it does nothing. But it doesn't show a pin glyph either — it looks like a regular tab that just happens to be undeletable.

**Expected:**
Either: (a) auto-pin the FAQ default tab on first install (matches Stage 24's pin model — pin glyph, sorts leftmost, ⌘W gates behind confirm modal); OR (b) keep it non-closeable but pin-styled so the affordance is visible; OR (c) make it closeable like every other tab and let the user re-open it via the help menu / pinned state.

**Owner suggestion:** "we did mean for this to be pinned instead?" — leans toward (a). Stage 24 + ENH-003 already default-pin FAQ + What Duo Does, so the pin should be in `pins.json` post-install. Verify whether the close suppression is from `BrowserManager.closeTab`'s "cannot close last tab" guard (degenerate) vs. the pinned-confirm modal. If it's the former, the bug is "BrowserManager allows closing the only tab if the user really wants to" + "first-launch pins.json includes the FAQ".

**Affected files:** `electron/browser-manager.ts` (closeTab guard), `electron/install-service.ts` (pin bootstrap — verify FAQ is pre-pinned), `renderer/components/WorkingPane.tsx` (close-X visibility).

---

### BUG-021: ⌃Tab cycle skips restored tabs after session restore

**Status:** ✅ Shipped v0.4.3 (2026-04-27) — cycle now uses refs instead of closure-captured tabs so post-session-restore state is always visible
**Priority:** **High** (load-bearing for session-restore credibility — "the tabs are there but I can't reach them with the keyboard")
**Filed:** 2026-04-27

**Today:**
After Duo relaunches and session restore re-creates tabs (terminals + browser tabs), `⌃Tab` only cycles the tabs created/touched in the CURRENT session — not the restored ones. Owner observation: "still seeing a weird tab cycle bug where ; hard to pin down but I think ctrl tab is only cycling this session's tabs, not restored tabs; either way, it is only cycling some of the tabs."

**Expected:**
`⌃Tab` cycles the full strip — restored + current-session — in display order.

**Hypothesis:**
The keyboard-shortcut handler likely captures the cycle list at mount time (or memoizes it on a stale dep), so tabs added later (via session restore's mount-time hydration) aren't in the cycle set. Could also be a tab-id-shape mismatch (restored tabs get fresh UUIDs; the handler may be tracking against the original-session UUIDs).

**Suggested triage:**
1. Look at `useKeyboardShortcuts` and the ⌃Tab branch — does it pull from a `tabs` ref/state that's reactive to changes?
2. Check the tab-cycle order — is it cycling correctly on tab CREATE within the current session but breaking only on RESTORED tabs? Or is the cycle generally broken with > N tabs?
3. The session-restore hydration in `App.tsx` calls `setTabs(restoredTabs)` — confirm the keyboard hook re-computes its cycle list when this fires (probably yes since deps include `tabs`, but the `?` is whether the handler closure captures a stale `tabs` reference).

**Affected files:** `renderer/hooks/useKeyboardShortcuts.ts`, `renderer/App.tsx` (the session-state hydration block I added in Phase 2B).

---

### BUG-022: New HTML canvas doesn't focus the writing area on open

**Status:** ✅ Shipped v0.4.3 (2026-04-27) — `RenderedCanvas` calls `doc.body.focus()` on canvas mount
**Priority:** Medium (papercut — every new canvas needs an extra click)
**Filed:** 2026-04-27

**Today:**
`⌘N` → name a `.html` file → opens a fresh HTML canvas with the smart-blank overlay. The canvas mounts unfocused; the user must click into the page to start typing.

**Expected:**
After the canvas mounts, focus moves to the contentEditable body so the first keystroke lands as content. (Mirrors the markdown editor's behavior — `⌘N` → name `.md` → editor opens already focused.)

**Suggested fix:**
`renderer/components/HtmlCanvas/RenderedCanvas.tsx` `onReady` callback (the iframe-load hook) — after `wired` is set, call `iframe.contentDocument.body.focus()` (or whatever the focus surface is). May need to handle the "iframe steals focus from the address bar" edge case.

**Affected files:** `renderer/components/HtmlCanvas/RenderedCanvas.tsx`, possibly `renderer/components/HtmlCanvas/CanvasTab.tsx`.

---

### BUG-023: HTML canvas click area too small — must click ON existing text

**Status:** ✅ Shipped v0.4.3 (2026-04-27) — body fills viewport (`min-height: 100vh`) with content in a 720px `<main>` child so clicks anywhere place a cursor
**Priority:** Medium-High (significant friction for the canvas surface)
**Filed:** 2026-04-27

**Today:**
Owner observation: "clickable area in html canvas still too small; must click RIGHT on existing text to place cursor". Clicking in the visual margin of the page (or in whitespace between paragraphs) doesn't place a cursor; only clicking directly on a glyph or inside a tight bounding box around existing text places it.

**Expected:**
Click anywhere within the page's content column places a cursor at the nearest text position (typical browser/Word/Notion behavior).

**Hypothesis:**
The contentEditable body has a too-tight min-height or its child blocks have margins that are outside the click-receptive area. Possibly `<body>` itself isn't claimed as the editable surface or there's a conflicting padding/click-target setup in the boilerplate stylesheet (ENH-001/004 introduced inline Atelier styles).

**Suggested triage:**
1. Inspect the iframe DOM in DevTools, check `<body>` and its contentEditable boundary.
2. Look at `shared/html-boilerplate.ts` — the inline stylesheet may need a `min-height: 100%` on body or different padding to expand the click-receptive area.
3. Worst case: add a click-handler to the iframe document that captures clicks on the *body* and synthetically positions the cursor at the nearest text node.

**Affected files:** `shared/html-boilerplate.ts` (boilerplate stylesheet), `renderer/components/HtmlCanvas/RenderedCanvas.tsx` (iframe + contentEditable wiring).

---

### BUG-024: Comment button occludes Send → Duo pill on canvas selection

**Status:** ✅ Shipped v0.4.3 (2026-04-27) — Comment button stacks below selection (Send→Duo stays above), falls back to "stack above" when selection is at viewport bottom
**Priority:** Medium (selection UX — both pills appear at the same anchor and stack visually)
**Filed:** 2026-04-27

**Today:**
Selecting text on an HTML canvas surfaces both the Send → Duo pill (Stage 15.2) and the Comment button (Stage 17d-A). They render at the same selection anchor and visually overlap; one tends to be hidden behind the other.

**Owner suggestion:** "combine buttons?"

**Possible fixes:**
- (a) Single combined pill with a split affordance — primary action (one half) is Send → Duo, secondary (other half, maybe a chevron) is Comment.
- (b) Stack vertically — Send → Duo on top, Comment below (or vice versa). Both visible, neither occluded.
- (c) Single primary pill with a hover-to-reveal flyout containing additional actions. More refined but more clicks.

**Recommend:** (a) or (b) for v1; (c) is post-1.0 polish.

**Affected files:** `renderer/components/HtmlCanvas/CanvasTab.tsx` (selection UI), the `SendToDuoPill` primitive in `renderer/components/editor/`.

---

### BUG-025: Folder chevron click promotes/opens the row instead of just toggling expansion

**Status:** ✅ Shipped v0.5.0 (2026-04-27) — Stage 26 PR 1: chevron split into discrete button with `e.stopPropagation()`
**Priority:** Medium (papercut on the most-used navigator gesture)
**Filed:** 2026-04-27

**Today:**
The whole folder row in `FileTree.tsx` is a single `<button>` with one `onClick` that does both `actions.toggleExpand(entry.path)` AND `actions.selectItem(entry.path, 'folder')`. Clicking the chevron is structurally identical to clicking anywhere else on the row — there's no chevron-only hit-target.

**Why this is a bug now (and why it pairs with the Stage 26 / nav-polish item 1):**
Once we land single-click-to-select / double-click-to-open semantics (Stage 26 item 1), the row's primary click becomes "select/promote." The chevron must remain a discrete affordance that *only* toggles expansion, otherwise clicking it will also select the folder (and, in the future, double-clicking to open will fight the toggle).

**Expected:**
- Click on chevron → toggle expand/collapse only. Does not change selection. Does not open.
- Click on the rest of the row → select-only (per Stage 26 item 1) or open (today, until item 1 lands).

**Suggested fix:**
Split the chevron out of the row `<button>` into its own button with `e.stopPropagation()` on click. Two paths:
- (a) Nest a `<span role="button">` inside the row button (semantically iffy but simple).
- (b) Refactor the row into a `<div>` containing two siblings: a chevron button and a row button. Cleaner; matches VS Code / Finder DOM. *Recommend.*

**Affected files:** `renderer/components/FileTree.tsx` (the `TreeNode` component, lines ~158-200).

**Cross-refs:** Stage 26 item 1 (double-click-to-open) — these ship together; item 1 alone without BUG-025 leaves the chevron half-broken.

---

### BUG-026: Pasted markdown lands as a code block in the markdown editor

**Status:** ✅ Shipped v0.5.1 (PR 2, 2026-04-28) — root cause: tiptap-markdown's `clipboardTextParser` always parses with `{ inline: true }`, so block-level markdown (headings, lists, fences) lands as a single chunk that the schema collapses into a code block. Fix: new `MarkdownPaste` TipTap extension (priority 1000) installs a higher-priority `clipboardTextParser` that inspects the source text — block markers (`^# `, `^- `, `^1. `, `^> `, ` ``` `, blank-line separator) trigger block-mode parse; otherwise inline-mode is preserved (so the "paste a bold word mid-sentence" case still works). Verified live: pasting `# Heading\n\nA paragraph with **bold**.\n\n- list item 1\n- list item 2\n\n> blockquote` lands as proper H1 + paragraph + bullet list + blockquote.
**Priority:** Medium-High (degrades the core "paste from another agent / doc" loop)
**Filed:** 2026-04-27

**Today:**
Pasting raw markdown text into the TipTap markdown editor wraps the entire paste in a single `<pre><code>` block — even when the source has no triple-backtick fences. Headings, lists, bold/italic, links — all rendered as literal characters inside a code block.

**Repro:**
1. Copy any markdown text from outside the editor (another markdown file, ChatGPT/Claude output, GitHub raw view).
2. Paste into a markdown editor tab.
3. The whole paste becomes one code block.

**Expected:**
The paste lands rendered: `# Heading` becomes a heading, `- item` becomes a list, `**bold**` becomes bold. Plain prose stays prose. Existing fenced code blocks (with triple-backticks in the source) stay code blocks.

**Hypothesis:**
TipTap's default paste handler treats unknown text/plain content as code on the current schema (likely because of a `code-block` extension's paste rule that's matching too greedily, or because the `text/plain` clipboard payload is being routed through the code-block path before any markdown parser sees it).

**Suggested triage:**
1. Inspect the editor's TipTap configuration — which paste rules are registered, in what order? Look in `renderer/components/editor/extensions/` and `renderer/components/editor/MarkdownEditor.tsx`.
2. Add a markdown-aware paste rule that runs ahead of the code-block path: when `text/plain` clipboard data parses cleanly as markdown (or has structural markers like `#`, `-`, `*`, fenced blocks), parse it via the existing markdown→ProseMirror pipeline (whatever drives the initial doc load).
3. Edge cases to think through: pure prose with no markers should still paste as prose (not code); content with backtick-fenced code blocks inside should keep those as code blocks; smart-paste needs to not destroy line breaks in poetry/lists.

**Affected files:** `renderer/components/editor/MarkdownEditor.tsx`, `renderer/components/editor/extensions/` (paste rule lives here).

**Cross-refs:** ENH-002 (paste-as-plain-text — a complementary affordance for users who *want* the plain-text version).

---

### BUG-027: ⌘⇧T in browser focus opens claude tab instead of reopening last-closed browser tab

**Status:** ✅ Shipped v0.5.1 (PR 3, 2026-04-28) — `BrowserManager` grows a `closedTabs` stack (cap 10, skips `about:blank`); `closeTab` pushes the URL+title before tear-down; new `reopenLastClosed()` pops + addTab + switchTab. New IPC `BROWSER_REOPEN_LAST_CLOSED` + preload `browser.reopenLastClosed`. `useKeyboardShortcuts` dispatch branches: `pane === 'working'` → `browser.reopenLastClosed()`, otherwise → existing `newClaudeTab` (per BUG-008's universal-vs-pane-aware resolution). Verified live: opened `https://example.com/page1`, ⌘W'd it, ⌘⇧T from browser focus brought it back.
**Priority:** Medium (Chrome-parity on the browser pane; muscle memory)
**Filed:** 2026-04-27

**Today:**
Per BUG-008's spec resolution (2026-04-26 evening), ⌘⇧T was locked as "new claude tab everywhere" for predictability — flipping the previous Stage 19c assignment of "vanilla shell tab." From browser focus today, ⌘⇧T spawns a claude terminal tab.

**Owner request:**
Browser-pane ⌘⇧T should match Chrome: **reopen the last-closed tab** in the browser pane, not spawn a claude terminal tab.

**Expected (revised spec):**
- ⌘⇧T from browser focus → reopen the last-closed browser tab (Chrome parity).
- ⌘⇧T from terminal / files / editor focus → new claude tab (current behavior).
- Re-introduces pane-awareness on this specific shortcut, contra BUG-008's "universal" line.

**Spec impact:**
This re-opens the BUG-008 universal-vs-pane-aware debate that was closed in favor of universal. Worth documenting the rationale clearly in `globalShortcuts.ts` and the smoke matrix. Pane-awareness on the *browser pane* is closer to Chrome muscle memory than on the *terminal pane* — defensible to make ⌘⇧T pane-aware here without litigating ⌘T again.

**Implementation:**
1. `BrowserManager` grows a closed-tab stack — capped (~10), entries hold `{ url, title, favicon, closedAt }`. Push on `closeTab`, pop on reopen.
2. New IPC channel `BROWSER_REOPEN_LAST_CLOSED` + preload bridge entry.
3. `renderer/keyboard/globalShortcuts.ts` — change the ⌘⇧T row's intent from `'newClaudeTab'` to a pane-aware dispatcher (browser focus → `reopenLastClosedBrowserTab`; otherwise → `newClaudeTab`).
4. CLI parity per CLAUDE.md §4: `duo browser reopen` (or `duo tab reopen --kind browser`).

**Edge cases:**
- Stack empty → no-op (or subtle toast: "Nothing to reopen").
- Reopening a tab that's currently in another pane's history (e.g., the URL is also in current-session history) — fine, just open it fresh.
- Session restore + reopen — the closed-tab stack can persist across relaunch via `~/.claude/duo/session-state.json` (additive — defer to a later cut if it's friction).

**Affected files:** `electron/browser-manager.ts` (closed-tab stack), `electron/main.ts` (IPC), `electron/preload.ts` (bridge entry), `renderer/keyboard/globalShortcuts.ts`, `cli/duo.ts`, `skill/SKILL.md`, `agents/duo.md`, `docs/CLI-COVERAGE.md`.

**Cross-refs:** BUG-008 (the universal-⌘⇧T resolution this revises); Stage 21c Phase 2 (session restore — fold the closed-tab stack into persisted state if needed).

---

### ENH-005: Copy button on code blocks (markdown editor + HTML canvas)

**Status:** ✅ Shipped v0.5.1 (PR 2 + PR 2 follow-up, 2026-04-28) — **both surfaces working live**:

- **Canvas (PR 2):** runtime-only buttons injected into the iframe contentDocument via `injectCodeBlockCopyButtons`. Marked `data-duo-canvas-runtime` so the serializer strips them on save.
- **Markdown editor (PR 2 follow-up):** PM widget + node decorations via the `CodeBlockCopyButton` extension. The node decoration adds the host class (`Decoration.node` survives PM transactions; direct `pre.classList.add` gets reverted). The widget decoration at `pos+1` renders a `<button>` inside the codeBlock content; CSS positions it absolute top-right of the pre. Click handler clones the `<code>` content, strips the button descendant, and `navigator.clipboard.writeText`s the cleaned text. Verified live: 2 buttons render on a 2-pre sample.md, click copies just the code text (no "Copy" label leakage).

**Files:** `renderer/components/editor/codeBlockCopyButton.ts` (canvas helper), `renderer/components/editor/extensions/CodeBlockCopyButton.ts` (TipTap extension), `renderer/components/editor/MarkdownEditor.tsx` (registration), `renderer/styles/globals.css` (positioning + hover-to-reveal).
**Priority:** Medium (high-value reading-side ergonomic)
**Filed:** 2026-04-27

**Today:**
Code blocks in both the markdown editor and HTML canvas render as syntax-highlighted (via lowlight + highlight.js) but have no affordance to copy the contents. User has to manually select-all and `⌘C`.

**Expected:**
Hover-to-reveal "Copy" button (top-right of each `<pre>` / `<code>` block) that copies the block's text content to the clipboard. Standard pattern (GitHub, Notion, Stack Overflow).

**Suggested implementation:**
- Markdown editor (TipTap): a code-block extension that renders a button alongside the block via `addNodeView()`. Or simpler: a renderer-level `useEffect` that scans `document.querySelectorAll('.tiptap pre')` and injects a button child.
- HTML canvas: similar — scan `<pre>` blocks in the iframe contentDocument and inject the button at iframe-load time. The button must NOT be persisted to disk (mark with `data-duo-canvas-runtime` so the serializer strips it on save, mirroring the existing runtime-chrome pattern).

**Affected files:** `renderer/components/editor/MarkdownEditor.tsx` (+ a new TipTap extension or DOM-level script), `renderer/components/HtmlCanvas/RenderedCanvas.tsx` (+ runtime-chrome injector).

---

### ENH-006: Right pane gets a "new browser tab" button (split-button pattern)

**Status:** ✅ Shipped v0.5.1 (PR 4, 2026-04-28) — `WorkingTabStrip` grew a split button mirroring `TabBar`'s terminal-strip pattern: `+` (primary, wider, ⌘N file) | `>` (secondary, narrower, ⌘T new browser tab). The browser-tab handler reuses the existing `addTab` + two-RAF address-bar focus dance (BUG-019 carryover), so the new tab arrives focused and ready for typing. Replaces the prior ⌥-click-on-`+` muscle memory with a discrete affordance that's visible at rest. **Note:** kept inline in `WorkingTabStrip` rather than extracting a shared `<SplitTabButton>` primitive — the two strips have minor styling differences and a 3rd consumer doesn't exist yet; defer the abstraction. Verified live: clicking `>` opened `about:blank` with the address bar selected.
**Priority:** Medium (mirrors terminal pane's discovery affordance for the working pane)
**Filed:** 2026-04-27

**Today:**
The WorkingPane tab strip has a `+` button that opens a file interstitial (⌘N flow). The terminal pane has a split `+` button (`+` = claude tab, `>` = shell tab — Stage 19c). Owner wants the WorkingPane to follow the same pattern: `+` for file (existing), and a sibling button for new browser tab.

**Expected:**
A second affordance on the WorkingPane tab strip — could be a `+ 🌐` button next to the existing `+` (file), or a split-button reuse (`+` defaults to last-used kind, `>` opens the secondary). Whichever mirrors the terminal-side convention.

**Owner phrasing:** "use same convention as double new button on terminal side."

**Suggested impl:**
- Reuse the same `<SplitTabButton>` primitive that Stage 19c built for the terminal strip — it's already a polymorphic split-button.
- Wire one half to the existing file-new flow, the other half to `electron.browser.addTab()` (which currently exists for the CLI path; just needs a UI binding).

**Affected files:** `renderer/components/WorkingTabStrip.tsx`, possibly `renderer/components/WorkingPane.tsx`. The Stage 19c split-button might need to be promoted to a shared primitive in `renderer/components/` (it currently lives in the terminal-strip component).

---

### ENH-007: Comment rail collapses but stays findable when all resolved

**Status:** ✅ Shipped v0.5.1 (PR 2, 2026-04-28) — `<CommentRail>` primitive grows internal `expanded` state. When every thread is resolved AND the user hasn't toggled expand, the rail collapses to a small "N resolved" pill (right edge of the canvas chrome). Click to expand into the full rail (in normal mode but with a "Hide" affordance in the header for re-collapse symmetry). Live verification deferred — would need a canvas authored to all-resolved state, which is awkward to set up in the dev smoke session; code-side review confirms the path. Both bindings (canvas Stage 17d already wired; markdown Stage 14 future) get this for free since it's primitive-level.
**Priority:** Low-Medium (BUG-015 hides it entirely; ENH-007 polishes "what if you've resolved all")
**Filed:** 2026-04-27

**Today:**
BUG-015 (shipped v0.3.1) gates the comment rail render on `railThreads.length > 0`. So when you have 0 OPEN threads (or 0 threads at all), the rail is hidden. The "🆕 there are 5 resolved threads but no open ones" case looks identical to "no threads at all" — the user has no way to see resolved comments.

**Expected:**
A collapsed pill / chip somewhere on the canvas chrome that says "5 resolved" (or similar), clickable to expand the rail in a "show resolved only" view. Mirrors how Google Docs / Notion handle resolved comments.

**Owner phrasing:** "comment rail looks good; rail should collapse but be findable when all comments resolved."

**Suggested impl:**
- Add a "rail toggle" affordance to the canvas toolbar / header: shows the count of resolved threads when there are 0 open. Click → reveals rail in resolved-only mode.
- Update `<CommentRail>` to support a `mode: 'open-only' | 'resolved-only' | 'both'` prop.
- The `data-duo-canvas-runtime` sentinel handles the "don't persist this UI to disk" part automatically.

**Affected files:** `renderer/components/editor/primitives/CommentRail.tsx`, `renderer/components/HtmlCanvas/CanvasTab.tsx`.

---

### ENH-009: Expand default external-domains.json bootstrap list

**Status:** ✅ Shipped v0.4.3 (2026-04-27) — fresh-install defaults expanded to Slack/Gmail/Google Workspace/Atlassian/M365 (mile 1); existing-user additive merge folded into Stage 21e-iii
**Priority:** Medium-High (every Trailblazer hits Slack / Gmail / Google Docs daily; the embedded browser breaks SSO on most of them)
**Filed:** 2026-04-27

**Today:**
`electron/install-service.ts` (and the dev-only `sync:claude` script) bootstraps `~/.claude/duo/external-domains.json` with a single default: `["*.capitalone.com"]`. URLs matching it route to the system default browser; everything else stays in Duo's embedded `WebContentsView`.

**Owner observation:** "the block list of urls that duo browser should not attempt to open and should bounce to chrome/system browser, eg `*.capitalone.com`, `*.slack.com`, `gmail.com`, `docs.google.com`, other Google apps"

**Expected:**
A more comprehensive default list covering common SaaS apps that fail in the embedded browser due to SSO + corporate-managed browser requirements:

- `*.capitalone.com` (existing)
- `*.slack.com` (Slack web — SSO conditional access)
- `mail.google.com` (Gmail web — Google login + 2FA flows often broken in embedded)
- `docs.google.com` (Google Docs)
- `drive.google.com` (Google Drive)
- `calendar.google.com` (Google Calendar)
- `meet.google.com` (Google Meet — getUserMedia access patterns)
- `chat.google.com` (Google Chat)
- `accounts.google.com` (Google login flow, used by all Google apps)
- `*.atlassian.net` (Jira / Confluence — common enterprise SSO)
- `*.microsoftonline.com` (Microsoft 365 login — same SSO story as Atlassian)

**Two-mile fix:**

1. **Fresh-install defaults expand.** New install picks up the wider list. Lands cleanly in `electron/install-service.ts`'s bootstrap block + the `package.json sync:claude` dev script for parity. ~10 LOC.
2. **Upgrade-additive merge** (optional, deferred):
   - On version-bump install, read existing `external-domains.json`, parse `domains` array, add any MISSING bundled defaults (don't remove user entries, don't re-add entries the user explicitly deleted — would need a "dismissed-defaults" tracker for that, deferred).
   - Without this, existing users who already have an `external-domains.json` won't get the new domains. Workaround: delete the file → next launch re-bootstraps with new list.
   - Fold into Stage 21e-iii's provenance-aware install pattern (mile 2 belongs to v0.5.0 alongside the SHA tracking).

**v0.4.3 scope (this patch):** mile 1 only — fresh-install defaults expand. Document the existing-user migration path in release notes ("delete `~/.claude/duo/external-domains.json` to pick up the new defaults, or edit by hand").

**Affected files:**
- `electron/install-service.ts` (bootstrap defaults)
- `package.json` `sync:claude` script (dev-side parity)
- `fork.config.default.json` on the stage-21e branch (so the Vite-injected runtime defaults match — fold in when 21e rebases on v0.4.3)
- Release notes for v0.4.3 (existing-user migration note)

---

### ENH-008: Tooltip on "Your Claude settings" navigator pane

**Status:** ✅ Shipped v0.4.3 (2026-04-27) — "Your Claude settings" + "Project Claude context" headers got explanatory `title` tooltips
**Priority:** Low (small comprehension nudge for non-technical PMs)
**Filed:** 2026-04-27

**Today:**
Stage 22 (v0.4.0) introduced the dual-pane navigator with the top pane labeled "Your Claude settings" — surfacing `~/.claude/CLAUDE.md` + `skills/` + `agents/` in plain English. The header is text-only with no explanation of WHAT these are or WHERE on disk they live.

**Expected:**
A tooltip / hover (or a small `(?)` glyph next to the header) explaining: "These files live at `~/.claude/` and apply to ALL of your Claude Code sessions, not just this project. Edit them to teach Claude your preferences globally."

**Owner phrasing:** "tooltip/hover that explains what these are (global for user) and where they live."

**Suggested impl:**
- `<UserClaudePane>` header gets a small `(?)` icon (or just title-attribute on the existing label) that surfaces the explanation on hover. Native browser title-attr is the lowest-effort option; a custom tooltip component would be richer but more work.
- Reciprocal tooltip on the bottom pane's "Project Claude context" section header would be symmetric ("These files live in this project's repo and apply only to Claude sessions started here").

**Affected files:** `renderer/components/UserClaudePane.tsx`, `renderer/components/ProjectClaudeContext.tsx`.

---

### ENH-010: Pinned files & folders section at the bottom of the navigator

**Status:** ✅ Shipped v0.5.0 (2026-04-27 night) — Stage 26 PR 2 landed Pinned section with right-click Pin/Unpin + CLI parity (`duo nav pin/unpin/pins`)
**Priority:** Medium (frequent-target shortcut for cross-folder workflows; pairs naturally with the rest of Stage 26)
**Filed:** 2026-04-27

**Today:**
The navigator's left pane has two sections — "Your Claude settings" (top, Stage 22) and the project tree (bottom, Stage 10) — but no surface for *user-pinned* files or folders. WorkingPane tab pinning (Stage 24) covers tabs in the right column, not the navigator. Frequent targets that aren't on the project tree's current visible subtree (e.g., `~/Documents/notes/inbox.md`, a sibling project's `tasks.md`, a deep config file) require manual breadcrumb navigation every time.

**Expected:**
A new third section at the *bottom* of the left pane labeled "Pinned" (collapsible, hidden when empty). Each entry shows:
- File icon (or folder icon for folder pins).
- Filename / folder name in primary text.
- A *shortened path* secondary line — e.g., `~/Documents/notes` or `…/sibling-project/.claude` — to disambiguate same-named files (`tasks.md` from three different projects, all pinned).

Entries are **grouped by parent folder** with the parent path as a small subdued group header. Single-/double-click semantics inherit from Stage 26 item 1 (single = select, double = open / reveal in tree).

**Pin scope (recommended for v1):**
- *Navigator pins are independent of WorkingPane tab pins* — different verbs, different storage. A user can pin a folder to navigate into quickly even if they never open it as a tab.
- Storage at `~/.claude/duo/nav-pins.json` (atomic tmp-rename writes; schema v1; corrupt → empty list). Mirrors Stage 24's `pins.json` shape but separate file.

**Pin verbs:**
- Right-click on any nav row → "Pin to navigator" / "Unpin from navigator". Pairs with the right-click menu added in Stage 26 item 6.
- CLI parity per CLAUDE.md §4: `duo nav pin <path>` / `duo nav unpin <path>` / `duo nav pins [--json]`.

**Open questions:**
- a. Drag-to-reorder within the Pinned section? Defer — v1 is insertion order or alphabetical-by-parent.
- b. Group expand/collapse per parent folder? Defer — v1 has flat groups; collapse the whole "Pinned" section as a unit.
- c. What does double-click on a *folder* pin do? Two options: (c1) open it as the navigator's current root (replaces breadcrumb); (c2) reveal-and-expand it in the project tree above. Pick (c1) for v1 — it's the "jump to" muscle memory; the tree always re-roots on entry.
- d. Shortened path algorithm: `~/` for home, `…/` for paths longer than ~30 chars. Pin to the same heuristic the breadcrumb uses for symmetry.

**Plumbing checklist:**
1. `shared/types.ts` — `NavPinsSnapshot` schema; new IPC channels `NAV_PINS_LOAD` / `SAVE` / `PUSH`.
2. `electron/preload.ts` — `electron.navPins.{load, save, subscribe}`.
3. `electron/main.ts` — IPC handler + atomic-write service (mirrors Stage 24's `pins-service.ts` — likely refactor to a shared `json-state-file.ts` helper since the pattern is identical).
4. `electron/socket-server.ts` — `nav pin/unpin/pins` cases.
5. `cli/duo.ts` — `duo nav pin/unpin/pins` subcommand parser. Rebuild binary.
6. `skill/SKILL.md` + `agents/duo.md` cheat-sheet.
7. `docs/CLI-COVERAGE.md` — inventory.
8. `renderer/hooks/useNavPins.ts` — new state machine (mirrors `useNavigator`).
9. `renderer/components/PinnedNav.tsx` — new section component, mounted at bottom of `FilesPane`.
10. `renderer/components/FilesPane.tsx` — slot the new section below the project tree; threading the `useNavPins` API.
11. `renderer/components/FileTree.tsx` — extend the row context menu (item 6) with Pin/Unpin entries.

**Affected files (high-level):** `shared/types.ts`, `electron/main.ts`, `electron/preload.ts`, `electron/socket-server.ts`, `cli/duo.ts`, `skill/SKILL.md`, `agents/duo.md`, `docs/CLI-COVERAGE.md`, `renderer/components/FilesPane.tsx`, `renderer/components/FileTree.tsx` (context menu), new `renderer/components/PinnedNav.tsx` + `renderer/hooks/useNavPins.ts`.

**Cross-refs:** Stage 24 (WorkingPane tab pins — separate concept, similar architecture; consider sharing a `json-state-file.ts` helper); Stage 26 item 6 (right-click menu — Pin/Unpin entries land there); Stage 26 item 8 (Go-to-path input — pinned folders are a common Go-to target, so the path input could optionally show pin matches as autocomplete).

---

### ENH-011: Plain-English rewrite of welcome / update banner copy

**Status:** ✅ Shipped v0.5.1 (PR 5, 2026-04-28) — `FirstLaunchBanner` now reads in plain user-model English:

- **Welcome:** "Welcome to Duo. Set up the files Duo needs to work with Claude — they go in `~/.claude/`, and we won't touch any of your existing files."
- **Update available:** "Duo update available. Refresh the agent files in `~/.claude/` (currently from v{version})."
- **CLI install failed:** unchanged (already plain enough — "Couldn't drop Duo's CLI helper into `~/.local/bin/`; try again or symlink `cli/duo` manually.")
- **Success:** unchanged ("Installed. Claude inside Duo's terminals will arrive Duo-aware.")

Removed user-facing jargon: "skill", "subagent", "priming shim", "SessionStart hook" — replaced with "agent files" / "make Claude Duo-aware" framing. Technical terms remain in code comments + the README per the spec. Verified live: Update banner now reads "Refresh the agent files in ~/.claude/ (currently from v0.4.5)."
**Priority:** Medium (the install banner is the FIRST thing every new user sees; tone is load-bearing for AIP/Trailblazers cohort)
**Filed:** 2026-04-27

**Today (post-v0.4.5):**
The success-state copy and "Claude Code not detected" follow-up note got a plain-English pass in v0.4.5. The other three states still read like Stack Overflow:

- **Welcome (idle, fresh install):** "Welcome to Duo. Install the skill, subagent, help files, and CLI into `~/.claude/` + `~/.local/bin/`, and install a priming shim + SessionStart hook so `claude` sessions inside Duo arrive Duo-aware. Your existing files won't be touched."
- **Update available (idle, needsUpdate):** "Duo update available. Refresh the installed skill + subagent + help files + CLI + SessionStart hook in `~/.claude/` (currently at v{status.version})."
- **CLI install failed (success, !cli.installed):** "Installed. Skill + subagent + help files + SessionStart hook in `~/.claude/`. (CLI binary couldn't be copied — try again or symlink `cli/duo` manually.)"

Each one mentions terms the non-technical PM audience doesn't have a model for: "skill", "subagent", "priming shim", "SessionStart hook". Even reading them as a developer, the copy doesn't land — they're describing implementation, not outcome.

**Expected:**
The user model is "Duo will work with Claude" / "Update Duo" / "Something went a bit wrong but you can probably ignore it." Copy should match that register.

**Suggested rewrites (starter — wordsmithing welcome at write-time):**

- **Welcome:** "Welcome to Duo. Set up the files Duo needs to work with Claude — they go in `~/.claude/`, and we won't touch any of your existing files."
- **Update available:** "Duo update available — refresh the agent files in `~/.claude/` (currently from v{version})."
- **CLI failed:** "Installed. Agent files added to `~/.claude/`. (Couldn't drop Duo's CLI helper into `~/.local/bin/` — try again or symlink `cli/duo` manually.)"

Plus a sweep of inline jargon — "skill", "subagent", "priming shim", "SessionStart hook" — replaced with "agent files" / "make Claude Duo-aware" framing throughout. The technical terms can stay in code comments and the README, but the user-facing surface should be plain.

**Affected files:** `renderer/components/FirstLaunchBanner.tsx` (the idle / running / error / success-CLI-failed branches; success state was already partially rewritten in v0.4.5).

**Cross-refs:** v0.4.5 (which started this rewrite for the success state + shim-missing note); the broader "non-technical PM audience" thread that surfaced after v0.4.4 / v0.4.5 install. Owner pushback: "I barely understand it" / "that's not user-friendly" — the install banner copy is one of the first surfaces where Duo loses non-technical users.

---

### ENH-012: "Your Claude settings" navigator pane defaults collapsed

**Status:** ✅ Shipped in Stage 26 PR 2 (folded in 2026-04-27 evening)
**Priority:** Medium
**Filed:** 2026-04-27

**Today (post-Stage 22):** The "Your Claude settings" pane (top of the navigator) defaults to EXPANDED on first install. Owner observation while testing PR #29: "while we are working in the navigator, the 'your Claude settings' should default collapsed."

**Reason it matters:** Most users live in the project tree below. The user-claude pane is a settings-discovery aid — load-bearing on first use, then noisy when always-open. Defaulting collapsed gives the project tree more vertical room without removing the discovery surface.

**Fix (shipped):** `renderer/components/UserClaudePane.tsx § useState init` flipped — was `localStorage.getItem(LS_KEY) === '1'` (defaults expanded when null), now `localStorage.getItem(LS_KEY) !== '0'` (defaults collapsed when null). Users who explicitly expanded on a prior version have `'0'` in localStorage and stay expanded; first-launch users get the collapsed default.

---

### BUG-029: Right-click context menu on Pinned section gets clipped at viewport bottom

**Status:** ✅ Shipped v0.5.1 (PR 1, 2026-04-28) — `<ContextMenu>` now measures rendered height in `useLayoutEffect` and flips up/left when the natural position would overflow the viewport. Verified live: right-click on Pinned "Documents" at viewport bottom flipped the menu upward with all four items visible.
**Priority:** Medium
**Filed:** 2026-04-27

**Today:** Pinned section lives at the bottom of FilesPane. Right-click on a pin opens `<ContextMenu>` at the click `(x, y)`, rendering downward. If the row is near viewport bottom (usual case for pins), the lower menu items (Reveal in Finder / Unpin from navigator) extend past the window edge and clip.

**Suggested fix:** in `renderer/components/ContextMenu.tsx`, compute projected height (item count × ~32px + chrome) and flip upward when `y + projectedHeight > window.innerHeight`. Same logic should apply horizontally for right-edge clipping.

**Workaround:** use `duo nav unpin <path>` from the CLI. Functionally equivalent — though see BUG-030 for the renderer-refresh gap.

**Cross-cuts:** the same fix lifts the project-tree right-click menu (Stage 26 PR 1) and the inline-rename / Pin/Unpin entries to flip-aware behavior. Worth fixing once at the `<ContextMenu>` level.

---

### BUG-030: Navigator pin state doesn't push to renderer when changed via CLI

**Status:** ✅ Shipped v0.5.1 (PR 1, 2026-04-28) — new `IPC.NAV_PINS_CHANGED` push channel; `mainWindow.webContents.send` from both the IPC `NAV_PINS_TOGGLE` handler and the socket-server `nav-pin` op via new `NavBridge.pushNavPinsChanged`; `useNavPins` subscribes via `electron.navPins.onChange`. Verified live: `duo nav pin/unpin <path>` from a terminal flips the renderer's Pinned section count immediately, no reload.
**Priority:** Low
**Filed:** 2026-04-27

**Today:** `useNavPins` calls `electron.navPins.list()` ONCE on mount. CLI `duo nav pin/unpin` mutates `~/.claude/duo/nav-pins.json` on disk; main-process service sees it; but the renderer has no subscription, so on-screen Pinned section is stale until next renderer mount (reload / relaunch).

**Verified:** Pinned 2 files via right-click; ran `duo nav unpin <one>` from CLI; renderer still showed 2; after relaunch, showed 1 correctly.

**Suggested fix:** add an `IPC.NAV_PINS_CHANGED` push channel. Main broadcasts on every `NAV_PINS_TOGGLE` reply + every socket-server `nav-pin` op. Renderer's `useNavPins` subscribes via `electron.navPins.onChange(cb)`. Same pattern as Stage 21c's session-state push.

**Affected files:** `shared/types.ts`, `electron/main.ts`, `electron/preload.ts`, `renderer/hooks/useNavPins.ts`.

**Cross-refs:** Stage 24's `usePins` has the same shape (snapshot-on-mount, no push). A shared `json-state-file.ts` helper that bundles the push gives both systems live updates from one fix.

---

### BUG-028: Escape doesn't dismiss inline rename in navigator

**Status:** ✅ **Shipped v0.5.1, owner-verified v0.5.5** (walk-1, 2026-05-01) — code fix held under live testing. Code-side fix: Escape branch in inline-rename calls `e.stopPropagation()` + sets a `cancelledRef` + explicitly calls `inputRef.current?.blur()` before `onCancel()`, with the blur handler short-circuiting when the cancel ref is set. Belt-and-suspenders against any React-18 batching path that could swallow the keydown's setState.
**Priority:** Medium
**Filed:** 2026-04-28 (referenced in roadmap + session log; never had a tasks.md entry)

**Today:**
Stage 26 PR 1 added inline rename: right-click → Rename flips the row label into a contenteditable input. ↵ commits, but ⎋ does not cancel — the input keeps focus, the rename state stays "in flight," and the only way out is to commit (or click elsewhere, which may or may not commit depending on blur handler).

Conventional file-tree spec (Finder, VS Code): ⎋ cancels rename, restores the original name, exits rename mode.

**Repro:**
1. Right-click a file row in the navigator → Rename.
2. Type a partial new name.
3. Press ⎋.

**Expected:** Input dismisses, original name restored, row exits rename state, focus returns to the row.
**Actual:** ⎋ does nothing visible; input keeps focus and content.

**Suggested fix:**
Inline-rename handler in `renderer/components/FileTree.tsx` (the row whose `isRenaming` flag is true) gets a `onKeyDown` branch:
```ts
if (e.key === 'Escape') {
  e.preventDefault();
  setRenamingId(null);  // exit rename state
  // input is unmounted; original label re-renders
}
```
Also worth ensuring blur doesn't auto-commit (or if it does, ⎋ has to set a flag the blur handler reads to suppress commit).

**Cross-cuts:** Same gesture model should apply to the Stage 26 inline-rename surface in the Pinned section (PR 2) — single rename-in-progress at a time, ⎋ cancels everywhere. Probably one cancel handler covers both surfaces if they share state.

**Affected files:** `renderer/components/FileTree.tsx` (row rename handler).

**Cross-refs:** Stage 26 PR 1 (the surface this lands on); BUG-029 (context menu clipping — same right-click flow surfaces both bugs together); BUG-030 (nav pins push channel — different bug, same PR cluster).

---

### ENH-013: "Send → Duo" pill enabled only when front terminal has a live Claude session

**Status:** ✅ Shipped v0.5.1 (PR 3, 2026-04-28) — strict mode (option a). New `electron/claude-presence.ts` polls the active terminal's PTY child-process tree via one `ps -ax -o pid,ppid,comm` walk every 500ms, looking for any descendant whose basename is `claude`. State machine: `'no-pty' | 'shell' | 'claude' | 'starting'` (the latter is a 1.5s grace window after a `kind: 'claude'` tab spawn so the pill doesn't flicker off during the launch gap). State pushes via `IPC.TERMINAL_CLAUDE_PRESENCE_CHANGED`; renderer hook `useFrontTerminalClaudeLive` returns `state === 'claude' || state === 'starting'`. App.tsx gates the `onSendToDuo` prop on the hook — when false, pill primitive returns null entirely. PtyManager exposes `getPid(tabId)`. Renderer's `pushActiveId` now carries `kind` so main can arm the grace window correctly. Verified live: shell-only terminal + selected text in canvas → no pill. (CLI `duo terminal claude-state` deferred to a follow-up — not ship-blocking.)
**Priority:** Medium-High (correctness — the pill currently routes to dead PTYs / shell tabs and silently fails)
**Filed:** 2026-04-28

**Today:**
The "Send → Duo" pill renders on selection across three surfaces (markdown editor — Stage 15.1; browser pane — Stage 15.2; HTML canvas — Stage 17c) regardless of what's running in the focused terminal. If the user's front terminal is a bare shell (or a `kind: 'claude'` tab where they've `/exit`'d back to the shell), clicking the pill pushes selection text into a non-Claude prompt — looks broken.

`TabSession.kind` only records launch *intent*, not current process state — survives `/exit` to a bare shell, survives the claude process dying.

**Owner spec (option a — strict):**
- Pill is enabled only when the *front-of-terminal-column* tab has a live `claude` descendant in its PTY's process tree.
- Pill is disabled (or hidden — design call below) when: no terminals exist; front terminal has no claude descendant (bare shell); claude is mid-startup (>500ms gap from launch — see below).
- *Strict*, not permissive: even if another terminal tab has a live claude, the pill stays disabled until the user focuses that tab. Predictable trade for the muscle-memory cost.

**Implementation:**
1. **Process-tree probe.** New `electron/claude-presence.ts` (or fold into `electron/pty-manager.ts`) walks the PTY's child-process tree looking for a `claude` (or `node` running the claude entrypoint) descendant. Use `pgrep -P <ptyPid>` recursively, or one `ps -ax -o pid,ppid,comm` walk and filter. Sub-millisecond per walk.
2. **Polling loop.** Per active tab, probe every ~500ms while the tab exists. Cache last result; broadcast on flip only.
3. **State machine.** New `TerminalClaudeState` per tab: `'no-pty' | 'shell' | 'claude' | 'starting'`. `'starting'` covers the gap between `+ claude` click and the descendant appearing — gated by a 1500ms grace window from tab creation when `kind: 'claude'`. After the grace window, falls back to whatever ps says.
4. **IPC push channel.** New `TERMINAL_CLAUDE_STATE_CHANGED` channel — main → renderer broadcast on every state flip. Renderer caches `Map<tabId, TerminalClaudeState>`.
5. **Gating logic in the three pill sites.**
   - `renderer/components/editor/primitives/SendToDuoPill.tsx` (or wherever the pill primitive lives — locate during PR 3) reads `useFrontTerminalClaudeState()` hook.
   - When state !== 'claude' && state !== 'starting': render in disabled state (or hide entirely — owner picks during PR 3 walk; *recommend* render with grey-out + tooltip "Focus a Claude terminal to enable" so the user learns the rule, vs. silent disappear).
   - Same logic for the browser-pane pill and the canvas pill.
6. **CLI parity per CLAUDE.md §4.**
   - `duo terminal claude-state` → prints front-tab state (`shell` / `claude` / `starting` / `no-pty`).
   - `duo terminal claude-state --json` → all tabs as `[{tabId, kind, claudeLive, state}]`.
   - `duo terminal claude-state --tab <n>` → specific tab.
7. **Bonus: FOLLOWUP-002 piggyback.** The agent's session guard (`agents/duo.md`) currently relies on `$DUO_SESSION` env var checks; the same `pgrep` plumbing makes the agent guard cheaper and more robust. Land both at once.

**Edge cases to walk:**
- Claude crash → process disappears → state flips to `'shell'`, pill greys out. ✓
- `/exit` from claude back to shell → same as crash. ✓
- User runs `claude` directly (bypassing the `+ button` shim path) → descendant still named `claude`, state flips to `'claude'`. ✓
- Two terminal panes both with live claude — pill targets the front one only (per option a). Predictable.
- Terminal column not focused (browser focus / editor focus) → "front" is the most-recently-focused terminal tab. Same logic; the pill is about the routing target, not the user's current focus.
- Subprocess of claude (claude → bash → vim) — pgrep recursion finds claude in the chain regardless of depth. ✓
- Stage 19b PATH-shim wraps `claude --append-system-prompt` — descendant is still `claude`. ✓

**Affected files:**
- `electron/main.ts` (instantiate prober + broadcast)
- `electron/pty-manager.ts` (expose ptyPid per tab if not already)
- new `electron/claude-presence.ts` (the prober)
- `electron/preload.ts` (renderer subscription bridge)
- `electron/socket-server.ts` (new `terminal claude-state` case)
- `cli/duo.ts` (new verb + `printHelp()` update; rebuild binary)
- `shared/types.ts` (TerminalClaudeState type + IPC channel name + DuoCommandName extension)
- `renderer/hooks/useFrontTerminalClaudeState.ts` (new)
- `renderer/components/editor/primitives/SendToDuoPill.tsx` (gating)
- (browser-pane pill site + canvas pill site — locate during PR 3)
- `skill/SKILL.md` (verb cheat-sheet — sync:claude after)
- `agents/duo.md` (verb cheat-sheet entry under `## Verb cheat-sheet`)
- `docs/CLI-COVERAGE.md` (inventory)

**Cross-refs:** Stage 15.1 / 15.2 / 17c (the three pill sites); Stage 19c (`+ button` claude-launch — provides the `kind: 'claude'` marker we use as the grace-window seed); FOLLOWUP-002 (agent guard hardening — same plumbing).

**Open questions (decide during PR 3):**
- Disabled-pill UX: grey-out-with-tooltip vs. hide entirely. *Recommend* grey-out for discoverability.
- Polling cadence: 500ms vs. 1000ms vs. event-driven (xterm output sniff). *Recommend* 500ms polling for v1; event-driven is fragile across shell variants.
- Should `'starting'` count as enabled? *Recommend* yes — the user's intent is clearly "send to claude", and the pill click queues vs. fails, no worse than the existing flow.

---

### BUG-031: HTML canvas / split-pane divider can't be dragged rightward (right pane shrinks-blocked)

**Status:** ✅ Fix shipped 2026-04-28 (v0.5.2 sprint PR 1) — option (1) overlay div implemented in `renderer/App.tsx` (`isDraggingSplit` state + `<div className="fixed inset-0 z-50 cursor-col-resize"/>` mounted while dragging). Verified in dev: synthetic mousedown on `.split-divider` mounts an overlay covering the full 1440×600 viewport; mouseup unmounts it. The iframe-trapping path is closed. **Browser-pane (WebContentsView) coverage is NOT in scope for this PR** — z-index can't push DOM above an Electron WebContentsView; if drag-over-browser repros for the user, file as a follow-up needing IPC-driven `setBounds` suppression during drag.
**Priority:** Medium-High (one of the most-felt papercuts; user can grow the right pane but never give it back to the left)
**Filed:** 2026-04-28

**Repro:**
1. Open a `.html` canvas (or any working-pane content that mounts an iframe / WebContentsView).
2. Drag the split divider rightward (intent: shrink the right pane, grow the terminal column).

**Expected:** Divider follows the cursor smoothly across the full 20–80% range, in either direction.
**Actual:** Drag works leftward (right pane grows). Drag rightward stalls — the divider stops as the cursor crosses the iframe's edge, even though `mousemove` is bound to `window`.

**Root cause (traced):**
`renderer/App.tsx:887–905` registers `mousemove` / `mouseup` on `window`, but iframes (HTML canvas) **and** the WebContentsView (browser pane) are out-of-process surfaces that *trap* mouse events when the cursor crosses into them. Once trapped, the events fire on the iframe's `contentDocument` window, never bubble up to the parent — so the parent's listener stops getting positions. The divider freezes wherever the cursor crossed the iframe edge.

The bug is invisible for empty / pure-text working-pane content because there's no out-of-process surface to capture events. It's specific to canvas + browser pane (which is most of the time the user is in a real layout).

**Proposed fix:** During an active drag, install a transparent overlay covering the entire split-container's right pane (z-index above the iframe + WebContentsView). Three patterns to consider:
1. **Overlay div (recommended).** While `isDragging.current === true`, render a `<div className="fixed inset-0 cursor-col-resize"/>` over the split area. Mouse events stay in the parent document. Cleanup on mouseup.
2. **`pointer-events: none` on iframes.** Toggle inline style on every mounted iframe + the WebContentsView host element. More invasive (need to know all surfaces); breaks if a new surface ships without registering.
3. **Pointer capture API.** `e.target.setPointerCapture(e.pointerId)` on mousedown — but this only works for events whose initial target is the divider itself, and the divider is a 1-2px sliver. Brittle.

Recommendation: **(1)**. One overlay element, one CSS class, no per-surface registration. Same pattern VS Code, Figma, and most pro web apps use for resize handles over rich content.

**Affected files (proposed):**
- `renderer/App.tsx` — extend `onDividerMouseDown` / mouse handlers to mount the overlay; read `isDragging.current` for visibility; cleanup on `mouseup`.
- `renderer/index.css` (or wherever split-divider styles live) — add `.split-drag-overlay` class.

**Cross-ref:** ENH-014 (pane-size presets — same divider plumbing).

---

### BUG-032: Canvas iframe steals focus from terminal on re-mount / agent edit

**Status:** ✅ Fix shipped 2026-04-29 (v0.5.2 sprint PR 4). `RenderedCanvas` accepts a new `shouldStealFocus` prop (default `true` for backwards compat); the `wire()` function reads it through a ref and only calls `doc.body.focus()` when truthy. `CanvasTab` gates it on `focused === true` (threaded from `WorkingPane.focused`, which is `focusedColumn === 'working'` at App.tsx). The ref-based read keeps the host effect from tearing down + re-mounting the iframe whenever focus toggles.

Effect: BUG-022's "first keystroke lands as content" ergonomic still fires when the user has the working pane focused. A re-mount triggered by srcdoc changes / HMR / post-doc-write reloads under terminal focus no longer yanks the cursor mid-typing.

**Re-reported 2026-04-30** (`20260430-improvement-notes.md` item 5 — "when focus is on terminal, and html canvas is open in work space, sometimes the cursor spontaneously jumps from the terminal to the html canvas"). Owner confirmed via AskUserQuestion that they were on a pre-v0.5.2 build; pull main + rebuild picks up the fix. No code change needed.

**Priority:** Medium (annoying mid-typing; intermittent so easy to dismiss until it happens enough)
**Filed:** 2026-04-28

**Repro (intermittent):**
1. Open an HTML canvas in the right pane.
2. Click into a terminal tab (focus on left pane).
3. Type into the terminal — at some point the cursor jumps into the canvas without the user clicking, and subsequent keystrokes land in the canvas.

**Root cause hypothesis (traced; needs confirm with logs):**
`renderer/components/HtmlCanvas/RenderedCanvas.tsx:162` calls `doc.body.focus()` on every iframe `load` event ("BUG-022 fix — focus the body when the canvas opens so the first keystroke lands as content"). The `wire()` function runs on the `load` event, which fires:
- Initial mount (intended).
- Whenever the iframe's srcdoc changes (e.g. `bumpVersion()` triggers a re-render via dependency on `[path, bumpVersion, readOnly, onCanvasAction, homeDir]` in CanvasTab's `onReady` effect — BUT the iframe srcdoc is keyed on initial HTML, not version, so this *shouldn't* re-fire).
- HMR re-mounts in dev.
- After a `duo html *` op that mutates the DOM enough to re-stamp srcdoc — we don't currently do this, but worth confirming.

The intermittency suggests the trigger isn't every-mutation but some specific path. Top suspects, in order:
1. Agent calls `duo html *` → DOM mutation observer fires `handleChange` → autosave fires → `setDirty(false)` → no re-render. Probably not it.
2. ENH-013's `useFrontTerminalClaudeLive` push-channel resubscribes the working-pane parent and the canvas re-mounts with `key={tab.id}` — but the key is stable per-tab, so this shouldn't tear down. Worth verifying with a `console.count` in `onReady`.
3. External file change (chokidar) — but neither editor wires file-watcher reload (confirmed: `grep -n "watch\|external\|reload" renderer/components/HtmlCanvas/CanvasTab.tsx renderer/components/editor/MarkdownEditor.tsx renderer/App.tsx` shows no path).

**Proposed fix:** Make the `body.focus()` call conditional on "canvas is the active pane focus." Two patterns:
1. **Skip focus when terminal column is focused** (recommended). RenderedCanvas accepts a `shouldStealFocus` prop; CanvasTab passes `focusedColumn === 'working'`. When the canvas re-mounts under terminal focus, no focus theft.
2. **Move the focus call to a one-shot effect** keyed only on initial mount — drop `wire()`'s focus side effect and put it in a separate `useEffect(() => { doc.body.focus() }, [])` that runs once.

Recommendation: **(1)** — keeps the BUG-022 ergonomic (first keystroke lands in canvas when the user opens one with intent) but doesn't fight focus when the user has clearly chosen a different surface.

**Affected files (proposed):**
- `renderer/components/HtmlCanvas/RenderedCanvas.tsx:148–162` — gate `doc.body.focus()` on a new prop.
- `renderer/components/HtmlCanvas/CanvasTab.tsx` — pass `focusedColumn` through (already lifted in App.tsx; thread via a new prop or context).

**Verification asks:**
- Add a `console.count('[RenderedCanvas] wire fire')` instrumentation and reproduce, to confirm WHICH path causes the re-fire — root-cause certainty before code change.
- Repro on markdown editor (MarkdownEditor doesn't have an iframe so likely immune) — confirm.

**Cross-ref:** BUG-022 (the original "canvas should focus on open" fix that this regresses).

---

### BUG-033: Autosave races with `duo doc-write` / `duo html *` mid-edit

**Status:** ✅ v1 fix shipped 2026-04-29 (v0.5.2 sprint PR 5).
- **(a) Autosave paused while pending agent write is on screen.** Both surfaces add a `blockAutosaveRef` set true when `pendingWrite` / `pendingHtmlOp` becomes non-null. The timer is cleared immediately on transition to non-null; the change-handler arm-path skips queueing new timers while blocked. Save resumes naturally on accept / decline (the next user keystroke or sidecar mutation arms a fresh timer). Covers all three autosave call sites in `CanvasTab.tsx` (DOM-mutation handler, sidecar-mutation handler).
- **(b) Markdown replace-all banner copy sharpened.** `'Replace the whole document'` → `'Replace the whole document (your unsaved edits will be lost)'`. Canvas ops are already granular (`replace`, `set`, etc.) — no monolithic destruction surface, so existing copy stays.
- **(c) Diff preview already in tree** (140-char peek of the proposed text via existing `preview` prop on `WriteWarningBanner`). Both surfaces already pass it.

v2 still backlog: OT-style merge for `replace-selection` writes that land on dirty buffer; per-section locks. Stage 16 (external-write reconciliation) home.

**Priority:** Medium (real correctness risk — agent's writes can clobber user keystrokes; today partially mitigated by dirty-buffer banner)
**Filed:** 2026-04-28

**Today's behavior (traced):**
- **Markdown editor** (`MarkdownEditor.tsx:582–604`): clean buffer → agent's `duo doc-write` applies immediately. Dirty buffer → renders `WriteWarningBanner`, holds the IPC reply until user accepts/declines (Stage 13b). One pending write at a time; subsequent writes return `'Another write is awaiting the user's decision.'`
- **HTML canvas** (`CanvasTab.tsx:706–722`): same gate — dirty + write op → banner; clean + write op → applies immediately (Stage 17c PRD H36).

**The race the user is hitting:**
The dirty-buffer gate works *eventually*, but there's a window where the ergonomic outcomes can still surprise:

1. **Stale-snapshot save during agent write (canvas).** User types; autosave timer set for 800ms (`AUTOSAVE_DEBOUNCE_MS = 800`). Agent calls `duo html append`; clean-buffer-by-the-time-IPC-arrives → DOM mutates → MutationObserver fires → handleChange → autosave timer reset. But if user typed *just before* the agent op, the buffer is dirty → banner appears → user is mid-keystroke and accepts on muscle memory → applyDocWrite runs → user's recent keystrokes survive (DOM mutations merge), but the autosave that was queued for the user's earlier keystroke fires later and writes the merged state, in a non-deterministic order.
   *Why it feels like a fight:* the user sees their intended edit, the agent's edit, and sometimes a save state that looks half-applied — depending on the autosave timing.
2. **`replace-all` is silently destructive when accepted under typing.** The banner gives Yes/No. If the user accepts, `applyDocWrite` does `editor.commands.setContent(req.text, true)` — **replaces the entire buffer**. Anything the user typed between the agent's request and their acceptance is lost. The banner copy doesn't currently call this out (or does it — verify during fix).
3. **Markdown's banner accept doesn't pause autosave.** If autosave was about to fire and the user clicks accept, both happen.

**Proposed fix (split into v1 / v2):**

**v1 (small, ship soon):**
- (a) Pause the autosave timer while a `pendingWrite` is shown (markdown + canvas) — `clearTimeout` on banner show; user's accept/decline triggers the appropriate next state.
- (b) `WriteWarningBanner` copy update for `replace-all`: explicit "this will replace the entire document, including your unsaved changes." (Today's copy is generic.)
- (c) Add a "snapshot diff" preview to the banner so the user can SEE what the agent wants to write — at least a line count + "first 200 chars" peek. Lower-stakes acceptance.

**v2 (bigger):**
- (a) Operational-transform style merge for `replace-selection` writes that land on dirty buffer — apply the agent's insert at its anchor without dropping the user's edits. Not trivial; PM/TipTap supports this pattern but it's a real implementation.
- (b) Per-section locks: agent op declares a target anchor (`--id` or `--selector`); we lock just that subtree from user keystrokes for the brief op duration. Simpler than full OT; trades some keystroke-eating for guaranteed merge.

Recommendation: **v1 is the unblock**, ship in next bug-smashing sprint. v2 is a real Stage 16 (external-write reconciliation) item — fold there.

**Affected files (v1):**
- `renderer/components/editor/MarkdownEditor.tsx` — pause autosave timer on `setPendingWrite`; add diff preview to banner.
- `renderer/components/HtmlCanvas/CanvasTab.tsx` — ditto (canvas's autosave timer at line 425–429).
- `renderer/components/editor/primitives/WriteWarningBanner.tsx` — accept new `mode` + `preview` props; render explicit `replace-all` warning + diff peek.

**Cross-ref:** Stage 13b (markdown banner), Stage 17c PRD H36 (canvas banner), Stage 16 (external-write reconciliation — v2 home).

---

### BUG-034: Canvas onboarding overlay occludes content on populated files

**Status:** ✅ Fix shipped 2026-04-29 (v0.5.2 sprint PR 2). Per the user's verbatim ask ("remove it and add a TODO to revisit"):
- `installPlaceholder` call site in `CanvasTab.tsx` replaced with a no-op (`cleanPlaceholder = () => {}`); import removed.
- TODO header added to `placeholder.ts` describing the right gate (`isJustBoilerplate(doc)` checked at install time, not on first mutation) so the Stage 17a.5 rebuild has the design context inline.
- Module file kept in tree as a starting point for the Stage 17a.5 onboarding refresh.

Verified: opening a populated `.html` (e.g. `~/demo.html`) now shows only its content — no centered "TYPE / SOON / SOON / SOON" card floating over the heading.

**Re-reported 2026-04-30** (`20260430-improvement-notes.md` item 4 — "the html canvas, on initial load, shows the 'features' view, which occludes the content below it; please just delete this feature"). Owner confirmed via AskUserQuestion that they were on a pre-v0.5.2 build; pull main + rebuild picks up the fix. No code change needed.

**Priority:** Medium (visible on every populated `.html` open until user types — high friction)
**Filed:** 2026-04-28

**Repro:**
1. `duo edit ~/some-existing-canvas.html` (or open via FileTree) — file has real content (not the boilerplate).
2. Canvas tab loads with the existing content visible — and a centered card overlay floating *over* the content showing "Markdown shortcuts work as you type · Component blocks via / · Start from a template · Ask the agent to draft this."

**Expected:** Overlay only on fresh / boilerplate canvases (which is what the original Stage 17a polish item 7 was scoped to).
**Actual:** `installPlaceholder` (`renderer/components/HtmlCanvas/placeholder.ts`) calls `refresh()` unconditionally at install time (line 168). There's no startup check against `isJustBoilerplate(doc)` — the helper exists at line 206 and is used only inside the MutationObserver callback to decide whether to dismiss on subsequent mutations.

So:
- Fresh canvas (boilerplate) → overlay shows → user types → first `input` event dismisses. ✓ intended.
- Populated canvas → overlay shows → MutationObserver checks on next mutation, sees `!isJustBoilerplate`, dismisses. But until a mutation fires (which on read-only viewing may be never), the overlay stays. ✗ bug.

**User's ask (verbatim):** "remove it and add a TODO to revisit."

**Proposed fix (matches the user's ask):**
1. **Remove the placeholder install entirely** for v1. Comment out the `installPlaceholder(doc)` call site in `CanvasTab.tsx` (or guard it behind a feature flag set to `false`).
2. **File the smart-blank onboarding work as a deferred substage of Stage 17a.5** with a note that the right gate is `isJustBoilerplate(doc)` checked at install time, not on first mutation. The `placeholder.ts` module stays in tree as a starting point for the rebuild.

**Cross-ref:** Stage 17a polish item 7, Stage 17a.5 directions A/E (template gallery / registry — overlap with the "soon" doors mentioned in the placeholder).

**Affected files:**
- `renderer/components/HtmlCanvas/CanvasTab.tsx` — find + comment out `installPlaceholder` call (search `installPlaceholder` in CanvasTab; the import is at line 20).
- `renderer/components/HtmlCanvas/placeholder.ts` — leave as-is; add a top-level TODO comment "v1 disabled per BUG-034 — re-enable with isJustBoilerplate gate at install time."

---

### ENH-014: View menu — preset pane sizes (50:50, 67:33, 33:67, full-left, full-right)

**Status:** ✅ Shipped 2026-04-29 (v0.5.2 sprint PR 1, bundled with BUG-031). Menu surface, keyboard accelerators, and CLI verb all wired:
- View → Pane size submenu: Even (50/50), Terminal heavy (67/33), Canvas heavy (33/67), Full terminal (80), Full canvas (20).
- Accelerators: ⌘⌥1 = 67/33, ⌘⌥2 = 50/50, ⌘⌥3 = 33/67, ⌘⌥0 = full terminal, ⌘⌥9 = full canvas. (⌘1–⌘9 stayed bound to `jumpTerminalTab`, so the proposal's bare-⌘ scheme would have collided — escalating modifier picked the orthogonal slot.)
- CLI: `duo split <pct|even|terminal-heavy|canvas-heavy|terminal|canvas>`. Numeric arg clamps to 20–80. Returns `{pct}`.
- Plumbing: new `IPC.SPLIT_SET` channel; `setSplit` exported from `electron/main.ts`; new `'split'` case in `socket-server.ts`; `ElectronLayoutAPI` in shared/types + preload; App.tsx subscribes via `window.electron.layout.onSplitSet`.
- Persistence: session-only (matches today's `splitPct` state — not persisted across relaunches; queue for a follow-up if the user wants the preset to stick).

**Priority:** Medium (depends on BUG-031's fix — divider has to actually move both ways first)
**Filed:** 2026-04-28

**Why:** Users frequently want a known-good split — 50:50 for parity, ~67:33 for "terminal-heavy", inverse for "canvas-heavy." Doing this with the divider is finicky; a menu shortcut is faster.

**Proposed surface:**
- Native macOS Edit / View menu adds a "Pane size" submenu with: 50/50, 67/33 (terminal heavy), 33/67 (canvas heavy), Full terminal, Full canvas.
- Keyboard shortcuts for the three most-used: ⌘1 = 67/33, ⌘2 = 50/50, ⌘3 = 33/67.
- CLI parity per CLAUDE.md §4: `duo split <pct>` (0–100) sets the percentage. `duo split 50` mirrors the menu's 50/50.

**Affected files (proposed):**
- `electron/main.ts` — extend the application menu.
- `renderer/keyboard/globalShortcuts.ts` — register ⌘1/⌘2/⌘3 → `setSplit:33|50|67`.
- `renderer/App.tsx` — exposed setter / IPC handler.
- `cli/duo.ts` + `electron/socket-server.ts` — new `split` verb.
- `shared/types.ts` — `SPLIT_SET` IPC channel + `DuoCommandName` extension.

**Cross-ref:** BUG-031 (divider drag fix — must ship before this lands or the menu is the only way to resize, which is wrong).

---

### ENH-015: File-navigator collapse button discoverability

**Status:** ✅ Shipped 2026-04-30 (v0.5.3 sub-sprint, late-evening). Two of the three proposed tweaks applied to `FilesPane.tsx § CollapseButton`: (1) color bumped from `text-zinc-600` (barely visible on cream paper) to `text-ink-mute` so the button reads as present-and-clickable at rest; (2) glyph swapped from chevron-into-rail to a macOS-Finder-style sidebar-toggle (rounded outer rect + left-side filled column). The third proposed tweak (first-launch coach-mark) stays deferred to Stage 18 FTUX. Smoke-walk verification owed.
**Priority:** Low-Medium (button exists today; this is purely visibility)
**Filed:** 2026-04-28 · shipped 2026-04-30

**Today:** `CollapseButton` exists at `renderer/components/FilesPane.tsx:234–249`. Renders next to the pin button in the Files header. Icon: 12×12 chevron-into-rail SVG. Color: `text-zinc-600` → `hover:text-zinc-300`. Tooltip: "Collapse files column (⌘B)."

**User's report:** "cannot find the button to collapse the file navigator — is there one? I can see the button to un-collapse it when it is collapsed via window size."

The button **is there.** It's just too muted to find. Three things compound the discoverability:
1. **Color contrast** — `zinc-600` is barely-there on the cream surface; the eye doesn't catch it.
2. **Position** — sits to the right of the pin button, which is itself a small icon. Two small icons next to each other read as a single "controls cluster."
3. **Icon glyph** — the chevron-into-rail is unconventional (most apps use a sidebar / hamburger / stack). Users don't recognize it as "collapse."

**Proposed fix:** Three small things:
1. Bump default color to `text-zinc-500` or `text-zinc-400` so the glyph is visible at rest.
2. Swap the glyph for a more conventional sidebar-toggle icon (matches macOS Finder's sidebar toggle, VS Code's sidebar toggle).
3. Consider a one-time tooltip / coach-mark on first launch ("⌘B toggles the files column") — but this is an FTUX additive, not strictly required.

**Affected files:**
- `renderer/components/FilesPane.tsx:234–249` (CollapseButton — color + glyph).

**Cross-ref:** Stage 18 (FTUX) for the optional coach-mark.

---

### ENH-016: Create new file / new folder from FileTree context menu

**Status:** ✅ v1 + v1-hotfix shipped 2026-04-30. **Partially working** — user-verified that the entries fire correctly when right-clicking on an existing file or folder row, but the entries don't appear when right-clicking in the empty space below the file tree. Tracked as **BUG-041** (no-target context menu fallback).

**v1 (commit `59769da`, since superseded):** `buildMenuItems` added "New file…" / "New folder…" entries to the row context menu. The original v1 used `window.prompt()` for the filename, which silently returned `null` in the Electron renderer (Electron disables prompt() for security). The menu fired, the click handler fired, but `name` was always null and the early-return killed the action without surfacing an error.

**v1-hotfix (commit `3eee115`):** replaced the prompt with the create-default-name + auto-rename pattern (closer to the v2 design we'd flagged anyway). Click "New file…" → write `untitled.md` (or `untitled-N.md` if it exists) → refresh + drop the new row into rename mode immediately. Same shape for "New folder…" with `untitled-folder`. New `pickUniquePath()` helper handles conflict-suffix walking; `files.exists` already lives in the IPC contract.

**Affected files:** `renderer/components/FileTree.tsx`, `electron/files-service.ts § mkdir`, `electron/main.ts`, `electron/preload.ts`, `shared/host-api.ts`, `shared/types.ts § FILES_MKDIR`.

**Still open (see BUG-041):** right-click on the whitespace below the last file row should fire the same context menu (with the project root as the implicit target). Today it fires no menu at all.

**Priority:** **High** (parity with VS Code / Finder; re-asked 2026-04-30 with explicit "new folder" emphasis)
**Filed:** 2026-04-28 · re-asked 2026-04-30 (`20260430-improvement-notes.md` item 3 — "need new folder button in file explorer")

**Today:** Right-clicking a row in the FileTree (`renderer/components/FileTree.tsx:174–223`) shows: Open terminal here / Open in editor, Reveal in Finder, Copy path, Open with default app, Pin/Unpin, Rename, Move to Trash. **No "New file" or "New folder."**

`⌘N` exists for "new markdown file" (`App.tsx § onCommitNewFile`) but it spawns at the active pane / project root, not at the right-clicked folder. There's no way to "new file inside this folder" without a terminal.

**Proposed surface:**
1. Right-click a folder row → context menu adds **"New file…"** and **"New folder…"** at the top (above "Open terminal here").
2. Right-click a file row → menu adds **"New file in this folder…"** and **"New folder in this folder…"** (parent folder is the implicit target).
3. Right-click empty space inside the FileTree (no row hit) → menu shows "New file…" / "New folder…" / "Reveal in Finder" / "Open terminal here" against the project root.
4. Selection: clicking either entry reveals the new row inline in the tree with the rename input pre-focused (re-uses the existing `RenameInput` component). Empty default name; commit on Enter, cancel on Esc.

**CLI parity per CLAUDE.md §4:** Already covered — `duo new-file <path>` and `mkdir` from a terminal both work. The CLI side doesn't need new verbs; this is pure UI.

**Affected files (proposed):**
- `renderer/components/FileTree.tsx:174–223` — extend `buildContextMenu` to include the new entries; thread handlers from caller.
- `renderer/components/FilesPane.tsx` — handle `onContextMenu` on the empty area below the tree (currently drops; add a fallback menu).
- `renderer/App.tsx` (or wherever FileTree is mounted) — wire `onCreateFile(parent: string)` / `onCreateFolder(parent: string)` callbacks; reuse the `onCommitNewFile` plumbing.
- `electron/files-service.ts` — confirm `mkdir` / `writeFile` are exposed to renderer (they are; `files.write` works for new paths).

**Open questions:**
- For a new file, what's the default extension? Recommend: leave the rename input fully blank (user types `name.ext`); auto-classify on commit via `fileClassifier.ts`.
- For a new folder created via context menu on a file-row, do we expand the parent folder in the tree before showing the inline rename? Recommend: yes (otherwise the new row is invisible in a collapsed parent).

**Cross-ref:** Stage 26 (navigator polish — this folds into PR 3 ambient signals + Go-to path or stands alone).

---

### ENH-017: Install service offers to add CLI dir to shell PATH

**Status:** ✅ Shipped 2026-04-29 (v0.5.2 sprint PR 6). Banner-driven action:
- `installService.addToShellPath()` detects shell from `$SHELL` (zsh / bash / fish), picks the right rc file (`~/.zshrc`, `~/.bash_profile`, `~/.config/fish/config.fish`), and appends a fenced `# >>> duo PATH ... # <<< duo PATH <<<` block. Idempotent — re-runs detect the fence and return `{alreadyPresent: true}` without rewriting.
- `INSTALL_ADD_TO_PATH` IPC channel + `install.addToShellPath()` preload exposure.
- New `showAddToPathNote` row in `FirstLaunchBanner` renders when `cli.installed && !cli.onPath` (post-install state). Three sub-states: idle ("Use duo from outside the app? Add to PATH" + button), running ("Updating shell config…"), done (success copy that names the rc file + tells the user to open a new terminal or source it), error (manual-line fallback copy).

Failure modes are explicit (unrecognized shell, rc not writable) and surface a manual-line copy block. Cross-platform: macOS-only as scoped (Windows/Linux deferred).

**Priority:** Medium (current banner-hint flow loses users; "duo command not found" is the most-cited papercut in retros)
**Filed:** 2026-04-28

**Today (traced):**
- `electron/install-service.ts:73` — `CLI_DEST_DIR = ~/.local/bin`. CLI lands at `~/.local/bin/duo`, chmod 755.
- Stage 19b PATH shim → `~/.claude/duo/bin/claude` (a wrapper, not a duo binary).
- `isOnPath()` (line 193) checks if `~/.local/bin` is on `process.env.PATH`. Surfaces a banner hint in the install panel.

The banner only tells the user "add this line to your shell rc" — it doesn't *do* it. Most users either don't see the hint, or skip it on first read, then hit "duo: command not found" the first time they try the CLI from a Duo terminal.

**User's feedback (retro):** "neither `~/.claude/bin` nor `~/.local/bin` is on $PATH, even though duo install correctly symlinked the cli to both locations. Is this something that the install script should improve?"

(Note: `~/.claude/bin` doesn't exist as a CLI install target today — the user may be conflating with `~/.claude/duo/bin/claude` shim. Confirm during fix.)

**Proposed fix:**
1. **Add a "Add to PATH" button to the install banner.** Click → install service appends `export PATH="$HOME/.local/bin:$PATH"` to the user's shell rc:
   - Detect shell from `$SHELL` env: `zsh` → `~/.zshrc` (or `~/.zshenv` if it exists; zsh users with chezmoi/dotfiles often prefer `.zshenv`).
   - `bash` → `~/.bash_profile` (macOS convention) with fallback to `~/.bashrc`.
   - `fish` → `~/.config/fish/config.fish` (different syntax: `set -gx PATH $HOME/.local/bin $PATH`).
2. **Idempotent.** Wrap the appended line in a fenced block:
   ```
   # duo PATH (added by Duo installer; safe to remove or move)
   export PATH="$HOME/.local/bin:$PATH"
   # /duo PATH
   ```
   On re-install, detect the fence and skip if already present. If user moved the line manually, leave their version alone.
3. **Tell the user what to do next.** Banner success state: "Added `~/.local/bin` to your PATH in `~/.zshrc`. Open a new terminal (or run `source ~/.zshrc`) to pick it up."
4. **Surface failure modes clearly.** If the rc file is owned by another user, read-only, or in a non-standard location, show the manual-line copy block as today. Don't fail silently.

**Risks + safeguards:**
- Editing user shell rc files is invasive. Pattern: prompt explicitly via the banner button (not a silent default). Document the change in the success state. Use a fenced block so future-Duo can detect / remove its own line.
- Some users have `.zshenv` *and* `.zshrc` and PATH gets reset by `.zshrc` after `.zshenv` — appending to `.zshrc` is the safe default. Document this in the banner copy.
- macOS Bash users with `.bash_profile` *and* `.bashrc` — same hierarchy concern. `.bash_profile` for login shells (Terminal default), so that's the right target.

**Affected files (proposed):**
- `electron/install-service.ts` — new `addToShellPath()` method; called from a new IPC handler.
- `electron/main.ts` — register IPC handler.
- `electron/preload.ts` — expose `install.addToShellPath()` to renderer.
- `renderer/components/FirstLaunchBanner.tsx` (or wherever the install banner lives) — render the "Add to PATH" button when `isOnPath === false`.
- `shared/types.ts` — IPC channel + result type.

**Cross-ref:** Stage 18 (FTUX — install service home), Stage 19b (PATH shim — overlapping concern), retro feedback from Capital One trailblazers cohort.

**Open questions:**
- Should it offer to fix the shim path too (`~/.claude/duo/bin` for the `claude` wrapper)? That's already handled silently by the shim install — and it's only on PATH if the user has set it up. Recommend: same button covers both PATHs (symlink dirs the install service writes to).
- Windows / Linux story? Out of scope for v1 — Duo is macOS-only today. File as a follow-up if/when cross-platform lands.

---

### BUG-035: False-positive "Couldn't find Claude Code" banner when shell init takes >5s

**Status:** ✅ v1 fix shipped 2026-04-29 (v0.5.2 sprint PR 3). `electron/resolve-claude.ts` now:
1. Walks well-known absolute install dirs (`~/.local/bin`, `~/.npm-global/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.volta/bin`, `~/.bun/bin`, `~/bin`) + every entry in `process.env.PATH` with `fs.access(..., X_OK)` BEFORE attempting any shell.
2. Falls back to shell only when fast path misses; bumps per-attempt timeout from 5s → 15s; reorders flag-sets fastest-first (`-l` before `-l -i`).

**Verified on the user's machine:** the previously-timing-out call (5236ms, hit timeout) now resolves in **0.8ms** via the fast path (`~/.local/bin/claude`). 6500x speedup.

v2 (still backlog): banner copy that distinguishes "rc is slow" vs "claude genuinely missing"; in-banner `duo doctor` retry.

**Priority:** High (visible-on-every-launch friction; the banner accuses users of not having Claude Code installed when they do)
**Filed:** 2026-04-29

**Repro (timed on the user's machine):**
```
$ time zsh -l -i -c 'command -v claude'
/Users/geoffreydudgeon/.local/bin/claude
zsh -l -i -c 'command -v claude'  2.12s user 1.91s system 77% cpu 5.236 total
```

The shell takes **5.236s** to spawn-resolve. The resolver's per-attempt timeout is **5000ms** (`electron/resolve-claude.ts:69`), so the first attempt times out. The next attempts (`-i -c`, `-l -c`) likely time out the same way for users with rich `.zshrc` (NVM, conda, plugins). All three flag-sets time out → resolver returns `null` → `installShim()` throws → `priming.shimInstalled = false` → the banner copy `"Couldn't find Claude Code on this Mac. Duo searched your usual shell paths and didn't see claude."` fires falsely.

**Root cause:**
1. **Timeout too short** for users with slow rc files. 5s is below the realistic ceiling for a login-interactive zsh on a populated dev machine (NVM source, conda init, oh-my-zsh, asdf shims, etc.).
2. **No fast path** — the resolver always pays the cost of a full login-interactive shell load even when `claude` is already on `process.env.PATH` or in a well-known install location.
3. **Silent failure** — `try/catch` discards the actual error code (timeout vs ENOENT vs rc-file syntax error), so the false-positive banner gives the same copy whether the user lacks claude entirely or simply has slow rc files. No diagnostic surface.

**Proposed fix (split into v1 / v2):**

**v1 (small, ship soon):**
1. **Fast path before shell:** check well-known absolute install locations directly with `fs.access` — `~/.local/bin/claude`, `~/.npm-global/bin/claude`, `/opt/homebrew/bin/claude`, `/usr/local/bin/claude`, `~/.volta/bin/claude`, `~/.bun/bin/claude`, plus every entry in `process.env.PATH`. Return the first executable hit. Costs ~5–10 stat calls (~ms total) vs ~5–15s for the shell path. Catches the vast majority of installs without ever spawning a shell.
2. **Bump timeout to 15s** for the shell-fallback path. The user's measured 5.2s sets the realistic floor; 15s gives 3x headroom for users with even fattier rc files.
3. **Order shell variants fastest-first:** try `-l -c` (no `.zshrc`, fast) before `-l -i -c` (full load, slow).

**v2 (later):**
- Surface the actual failure mode in the banner: distinguish "rc file is slow" (suggest `duo doctor` or shell tuning) from "claude not on PATH at all" (suggest install link). Today's monolithic copy hides the difference.
- Auto-retry via `duo doctor` button right in the banner: spawns a one-shot login shell with longer timeout and shows the real `command -v claude` output.

**Affected files (v1):**
- `electron/resolve-claude.ts` — add `tryFastPaths()` that walks well-known locations + `process.env.PATH` before falling through to shells. Bump shell timeout to 15s. Reorder flag-sets so the fastest combo (no `-i`) goes first.

**Cross-ref:** v0.4.5 was the previous "Claude not detected" fix (drift between install-service and main.ts on which shell flags they used). This is a similar issue (timeout / fast-path) that v0.4.5's all-shell-fallback approach didn't anticipate.

---

### BUG-036: ⌘T from terminal focus opens browser tab — should open vanilla shell tab (decision reversal)

**Status:** ✅ Fix shipped 2026-04-30 (v0.5.3 sprint W1). `useKeyboardShortcuts` dispatcher is now pane-aware:
- `⌘T` from terminal focus → `newShellTab()` (front terminal's launch CWD via `pendingCwd`).
- `⌘T` from any other focus → `newBrowserTab()` (Chrome parity, unchanged).
- `⌘⇧T` from terminal focus → `newClaudeTab()` (front terminal's launch CWD).
- `⌘⇧T` from browser focus → `reopenLastClosed()` (BUG-027, unchanged).
- `⌘⇧T` from any other focus → `newClaudeTab()` (unchanged).

The matcher in `globalShortcuts.ts` stays pane-agnostic (returns canonical `newBrowserTab` / `newClaudeTab` IDs); pane mapping is at dispatch only. `what-duo-does.html` items 18 + 19 updated to reflect the new bindings.

Note: "current CWD" resolves to the active tab's launch CWD (not live cwd post-`cd`). Live-cwd tracking would require an OSC 7 hook in PtyManager — separate ENH if requested. Pairs with Stage 26 PR 3 item 2 (active terminal CWD highlight) which has the same dependency.

**Priority:** Medium (revives pane-aware ⌘T mental model; reverses BUG-008 spec resolution)
**Filed:** 2026-04-30 (`20260430-improvement-notes.md` item 2)

**Owner ask:** "need to revert decision: cmd+t in terminal should open new terminal, not new browser tab"

**Resolution clarified 2026-04-30 (AskUserQuestion):**
- `⌘T` from terminal focus → **vanilla shell tab in current CWD**.
- `⌘⇧T` from terminal focus → **claude tab in current CWD**.
- `⌘T` from browser focus → new browser tab (Chrome-parity, unchanged).
- `⌘T` from files / editor / canvas focus → fall through to new browser tab (current behavior; recommend keep — only the terminal pane has a coherent "new of this kind" gesture).

**Today (post-BUG-008 + v0.2.0):**
- `renderer/hooks/useKeyboardShortcuts.ts` — `⌘T` everywhere → `newBrowserTab()`; `⌘⇧T` → `newClaudeTab()` from any focus.
- `renderer/components/TerminalPane.tsx` xterm allowlist bubbles `⌘T` / `⌘⇧T` to the window so the global handler fires.
- The `>` (shell) button on the terminal strip is the only path to a vanilla-shell tab today.

**What changes:**
1. `⌘T` branch in `useKeyboardShortcuts.ts` becomes pane-aware: `activePaneFocus === 'terminal'` → spawn shell tab at front terminal's CWD; otherwise → `newBrowserTab()`.
2. `⌘⇧T` branch becomes pane-aware too: from terminal focus → claude tab at front terminal's CWD; from any other focus → claude tab at last-known CWD (keeps the universal "spawn a Claude" affordance).
3. Front-terminal CWD plumbing already exists for the navigator/breadcrumb (Stage 10) and is being threaded for Stage 26 PR 3 item 2 (active-CWD highlight). Reuse it here.

**Cross-ref:** BUG-008 (the spec this reverses) — its "Chrome-parity ⌘T everywhere" rationale loses to "pane-aware muscle memory" once a user spends time in terminals. The discovery affordance for browser tabs lives on the browser pane's split `+` button (Stage 19c / ENH-006).

**Open questions:**
- Update `docs/dev/smoke-checklist.md § 5` keyboard matrix.
- `~/.claude/duo/help/faq.html` "⌘T conflict" entry needs rewrite; `what-duo-does.html` "Open a Claude tab" line stays accurate (`⌘⇧T` still spawns Claude).
- Roadmap card for Stage 19c gets a third spec note (this is now its third revision).

**Affected files:**
- `renderer/hooks/useKeyboardShortcuts.ts`
- `renderer/App.tsx` (thread current-CWD into the hook)
- `docs/dev/smoke-checklist.md`
- `~/.claude/duo/help/faq.html`

**Class of issue:** spec-revision (third on the `⌘T` family). Worth adding a note in `DECISIONS.md` once this lands so the next future-Claude doesn't re-debate it.

---

### BUG-037: HTML canvas — clicking inside the canvas while focus is elsewhere doesn't switch focus to it

**Status:** ✅ Fix shipped 2026-04-30 (v0.5.3 sprint W1) — **canvas surface only.** User-verified working post-build. The matching gap on the **browser pane (WebContentsView)** was discovered the same day during smoke-walk follow-up — filed as **BUG-042** (sibling bug; same root cause shape but a different pane that needs a different forwarder mechanism since WebContentsView clicks don't reach renderer JS at all).

Iframe-mousedown forwarder pattern: `RenderedCanvas` accepts `onUserInteract?: () => void`; inside `wire()` it attaches a capture-phase `mousedown` listener to the iframe document that calls the prop (read through a ref so prop changes don't re-mount the iframe). `CanvasTab` + `WorkingPane` thread it up; `App.tsx` passes `onCanvasFocusGained={() => setFocusedColumn('working')}`. Symmetric to BUG-032: that fix stopped the iframe from STEALING focus when the user had chosen another surface; this lets the iframe ACQUIRE focus when the user clicks in.
**Priority:** Medium (breaks the "click → focus" invariant; cascades into wrong-pane keyboard shortcuts)
**Filed:** 2026-04-30 (`20260430-improvement-notes.md` item 9)

**Owner observation:** "when focus is not on html canvas, clicking within the html canvas does not switch focus there"

**Repro:**
1. Open an HTML canvas in the working pane.
2. Click into the terminal so the terminal column has focus (orange chrome strip).
3. Click anywhere inside the canvas iframe.

**Expected:** The working column gains focus (chrome strip flips orange) AND the click places a cursor in the canvas body.
**Actual:** The cursor may place (BUG-023's "click anywhere → cursor lands" path) but `focusedColumn` stays `'terminal'`. Subsequent ⌃Tab cycles the wrong pane's tabs; subsequent ⌘T spawns the wrong-pane new-tab.

**Root cause hypothesis (untraced):**
The canvas iframe is a separate document. Click events inside the iframe don't bubble to the outer column wrapper's `onMouseDown` handler that sets `focusedColumn`. The outer wrapper sees the click happening on the `<iframe>` element itself (outer DOM), not on its contents.

For comparison: clicking into the markdown editor (no iframe) DOES flip `focusedColumn` because the contentEditable lives in the same document.

**Suggested fix:**
Install a `mousedown` listener on the iframe's document; on first interaction, post a message / call a parent-exposed setter that sets `focusedColumn = 'working'`. Pattern is symmetric to BUG-032's iframe focus-steal solution (it added an opt-out for iframe → terminal focus theft; this adds an opt-in for terminal → canvas focus acquisition on user click).

```ts
// renderer/components/HtmlCanvas/RenderedCanvas.tsx
iframe.contentDocument.addEventListener('mousedown', () => {
  onUserClickInCanvas?.()  // parent calls setFocusedColumn('working')
}, { capture: true })
```

**Affected files:**
- `renderer/components/HtmlCanvas/RenderedCanvas.tsx`
- `renderer/components/HtmlCanvas/CanvasTab.tsx` (forward the prop)
- `renderer/App.tsx` (pass setter)

**Cross-ref:** BUG-022 (canvas should focus body on open — opposite gesture, same component); BUG-032 (canvas iframe focus-steal — opposite direction); BUG-023 (click anywhere places cursor — adjacent fix).

---

### BUG-038: ⌃Tab cycle still skips some tabs (BUG-021 follow-up)

**Status:** ✅ **v4 fix shipped 2026-04-30 (v0.5.3 sub-sprint).** The working-pane else-branch in `useKeyboardShortcuts` no longer calls `browser.getTabs()` + `browser.switchTab()` directly. Instead it dispatches a `duo-cycle-working-tab` CustomEvent (mirrors the `duo-tree-start-rename` pattern). `WorkingPane.tsx` installs a window listener, reads its `mergedTabs` — which already interleaves file + browser tabs in the strip's pinned-first display order — feeds the pure `cycleNext` helper from `renderer/keyboard/tabCycle.ts`, and calls `handleSelect()` with the next id. `handleSelect` already dispatches correctly to either `setActiveWorking({kind:'file',id})` or `browser.switchTab()` based on the strip-id encoding (`f:` vs `b:`). Refs ensure the listener installs once but always sees fresh state. Smoke-walk verification owed: ⌘N spawns a markdown file at far-left of strip → ⌃Tab now visits it.

**Was 🟡 (v3 didn't fix it — re-opened 2026-04-30 from v0.5.3 smoke walk):** The closure-staleness fix was real and may have helped a subset of repros, but the user-reported symptom that prompted the re-open is **structurally different from the previous four flavors**. New symptom: in the WORKING pane (not terminal), ⌃Tab cycles through "the left two html viewers" (browser tabs pointing at local HTML files) but skips a leftmost markdown editor tab. Confirmed by the user re-spawning a fresh markdown file via ⌘N — the new markdown tab landed at far left and was unreachable from ⌃Tab.

**v4 root cause (5th instance):** The cycle handler's working-pane branch calls `window.electron.browser.getTabs()` and switches via `browser.switchTab()`. That IPC pair only knows about BrowserManager's tab list — i.e. browser tabs only. **File tabs (markdown editors, HTML canvases, image previews) live in `App.tsx`'s `fileTabs` state and are invisible to the working-pane cycle.** The strip's `mergedTabs` interleaves both kinds for display, but the cycle code only iterates browsers.

```ts
// useKeyboardShortcuts.ts § cycleTabsForward / Backward — working-pane branch
} else {
  void (async () => {
    const btabs = await window.electron.browser.getTabs()  // ← browsers only
    ...
    await window.electron.browser.switchTab(btabs[nextIdx].id)  // ← can't activate a file tab
  })()
}
```

**v4 fix sketch (carry into next sprint):**
1. App.tsx threads the merged working-pane tab list through useKeyboardShortcuts (a function getter, since the list re-builds every render and we want it fresh at keystroke time).
2. App.tsx threads a `setActiveWorking({kind, id})` callback so the hook can switch to either a file tab or a browser tab.
3. The hook's working-pane cycle iterates merged tabs in their display order, finds active by composite id, advances by delta, calls the right setter. Pure-helper `cycleNext` already supports this — it just needs the merged list, not just browsers.
4. The browser-only `browser.switchTab` path stays as a fallback for ⌘1–9 working-pane jumps that already work.

**Class summary update.** This is now the FIFTH instance of "⌃Tab doesn't reach all tabs":
- BUG-001 (xterm eats keystroke) — fixed
- BUG-021 (closure-stale tabs ref) — fixed
- BUG-038 v1 (xterm-focus listener) — partial fix
- BUG-038 v2/v3 (activePaneRef closure-staleness) — real fix but DIDN'T cover the working-pane flavor
- BUG-038 v4 (this) — working-pane cycle ignores file tabs entirely

The pure-helper extraction (`renderer/keyboard/tabCycle.ts`) DID help — it made the math testable AND it's the right shape for v4 (just feed it the merged list). The v4 fix is a wiring fix, not a math fix. PROCESS-001 Phase 2 unit tests for cycleNext will pin a regression net for this whole family once the framework lands.

**Was ✅ v3 (briefly):** Root cause was identified as closure staleness on `opts.activePaneFocus` inside `useKeyboardShortcuts.ts`. The dispatcher closure read `opts.activePaneFocus` directly from `useEffect`'s closure, which was up-to-date *eventually* (the deps array re-ran the effect on focus change), but there was a window where: (1) user clicks into a terminal tab, React schedules `setFocusedColumn('terminal')`, (2) before the effect re-runs and rebinds the closure, the user presses ⌃Tab, (3) the document-capture handler fires the dispatcher, which reads the STALE `pane` value (often `'working'` from a prior browser/canvas click), takes the BROWSER cycle branch, and only reaches the (much smaller) browser-tab list. The v3 fix added `activePaneRef`, mirroring `opts.activePaneFocus` like BUG-021's `tabsRef` mirrors `opts.tabs`. The fix is correct for what it addresses but doesn't cover the working-pane file-tab gap above.

**Was 🟡 (re-opened 2026-04-30)** after user verified v0.5.3 build. Symptom unchanged from the original report: "can only cycle between the last 3 tabs in the group; left 7 tabs are nonresponsive to ⌃Tab and not included in the cycle when starting from the rightmost tabs." So my W1 fix (xterm-focus listener flipping `focusedColumn` → `'terminal'`) was insufficient: the cycle is consulting the right `pane` value but the cycle list itself isn't covering all visible tabs.

**Hypothesis revision (next-sprint scope):**
- The xterm focus listener fired and `focusedColumn === 'terminal'` is correct.
- The cycle handler reads `tabsRef.current` (BUG-021 fix) which should include all 10 tabs.
- BUT only the rightmost 3 are reachable. That smells like a **list-slicing bug** — possibly:
  1. The cycle is iterating a SLICED view of tabs (e.g. only "browser-pane terminal tabs" vs all of them — Stage 24 pinned-tab partitioning?).
  2. Tab IDs of the leftmost 7 don't match `activeTabIdRef.current` lookup — so `findIndex(...)` returns -1 and the cycle defaults to a bounded subset.
  3. Pinning-related sort order: pinned tabs are sorted to leftmost on the strip but the cycle list is unsorted — `findIndex` on the un-sorted list locates the active tab at index 7+, then `(7+1) % 10` advances correctly, but the next iteration of `(8+1) % 10 = 9` is the rightmost; from there `(9+1) % 10 = 0` should land on the leftmost. If it doesn't, something is partitioning the list.

**Verification asks (carry into next sprint):**
1. From the user's repro: count the EXACT tab kinds on the strip (claude / shell / browser) — pinned vs. unpinned, and which ones are reachable.
2. Add a `console.log({ tabsRef, activeTabIdRef })` instrumentation to the cycle handler, reproduce, capture the snapshot.
3. Check `Stage 24 pins-service` — does the cycle handler iterate a different list than what the strip displays?

**Class summary update:** This is now the FOURTH instance of "⌃Tab doesn't reach all tabs" (BUG-001, BUG-021, BUG-038 v1, BUG-038 v2). Each previous fix addressed a real subset of the failure mode but didn't enumerate all the partitioning the cycle was doing. Next-round fix MUST land with a regression test that opens N tabs of mixed kinds (claude + shell + browser, pinned + unpinned) and asserts every visible tab ID is visited exactly once from any starting tab. The smoke checklist row 11b alone (added in v0.5.3) is insufficient — needs an actual unit / integration test.

---

**Original v0.5.3 fix attempt (kept for reference; insufficient):**

Diagnosis + fix:

**Root cause confirmed.** The cycle logic itself in `useKeyboardShortcuts.ts § cycleTabsForward / Backward` is correct (reads from refs, indexes by id, advances mod length). The bug was upstream: `focusedColumn` was getting stuck at `'working'` when the user thought they were "in" a terminal, so `pane !== 'terminal'` and the cycle went through browser tabs (which has fewer entries) — exactly matching the user's "right few tabs reachable" report.

Two paths where focus tracking lost the user's intent:
1. **Click into HTML canvas** — iframe events don't bubble to the column wrapper's `onMouseDown`, so `focusedColumn` stayed wherever it was last set. Fixed by BUG-037's mousedown forwarder.
2. **Focus arriving at xterm via a non-click path** — `webContents.focus()` reclaim (BUG-002), `⌘`-pane-cycle, post-spawn PTY init. xterm manages its own DOM heavily; the column wrapper's React `onMouseDown` doesn't fire on these.

**BUG-038-specific fix:** TerminalPane installs a `focus` listener on xterm's helper textarea. Whenever xterm gains focus by ANY path (click, programmatic, key-routed), `focusedColumn` flips to `'terminal'`. Belt+braces over the column wrapper's onMouseDown.

**Durable test coverage** (per the recurring-class regression rule):
- `docs/dev/smoke-checklist.md` row 11 expanded with **11b** (full-cycle: open ≥4 tabs, ⌃Tab N times, every tab visited, including post-session-restore) and **11c** (cross-pane focus tracking: alternate clicking terminal → canvas → terminal, ⌃Tab routes correctly each time).
- A unit test framework isn't in place yet (PROCESS-001 Phase 2 deferred); when it lands, the cycle helper extracts cleanly into a pure function for fixture-based testing.

**Class summary.** This is the third instance of "⌃Tab doesn't reach all tabs" (BUG-001, BUG-021, BUG-038). The first two were closure / xterm-eats-shortcut bugs; this one was a focus-tracking bug. All three resolutions are now structural: capture-phase matcher, ref reads, focus-event listeners. The smoke checklist row covers the scenario going forward.

**Priority:** Medium (load-bearing for tab navigation; user reports recurrence on 2026-04-30)
**Filed:** 2026-04-30 (`20260430-improvement-notes.md` item 11)

**Owner observation:** "still an issue where some tabs are included when we cycle (ctrl-tab) through tabs, others are not; currently I can only cycle through the right few tabs with ctrl-tab, but not the rest"

**Context:**
BUG-021 (shipped v0.4.3) fixed the closure-stale-tabs case by switching the cycle handler to read `tabs` via a ref instead of capturing it in a useEffect closure. The user is reporting a different symptom — ⌃Tab reaches some tabs but not others, asymmetrically (not just "session-restored tabs unreachable" which BUG-021 closed).

**Triage hypotheses:**
1. **Pinned tabs sort vs. cycle order.** Stage 24 pins sort to leftmost; does the cycle iterate `tabs` in display order (post-sort) or insertion order? If insertion, pinned tabs may be skipped when cycling forward from a non-pinned tab.
2. **Browser vs. terminal cycle list sync.** ⌃Tab in browser focus → `browser.getTabs()` + `switchTab(nextId)`; ⌃Tab in terminal focus → terminal-tab cycle. Are the two cycle lists aligned with the strip's display order?
3. **`focusedColumn` stale during transitions.** If ⌃Tab fires while focus is mid-transition, the cycle may consult the wrong pane's list.
4. **First-tab special handling (BUG-020 era).** The first FAQ tab has historical special-casing — confirm it's not being treated as "outside the cycle list."

**Verification ask (owner):** enumerate WHICH tabs are reachable vs. not in a specific repro session — e.g., "5 terminal tabs, ⌃Tab reaches tabs 3/4/5 but skips 1/2." The asymmetry will narrow the hypothesis.

**Class of issue:** Recurring regression on the same family of code. Per the global preference for durable test coverage on recurring regressions, this fix should land WITH a regression test that opens N terminal + browser tabs, presses ⌃Tab N times from each pane focus, and asserts every tab ID was visited exactly once.

**Cross-ref:** BUG-001 (xterm-eats-shortcut, three-part fix), BUG-021 (closure-stale tabs, ref fix). This is the third instance of "⌃Tab doesn't reach all tabs."

**Affected files (suspected):** `renderer/hooks/useKeyboardShortcuts.ts`, `renderer/App.tsx`.

---

### BUG-039: Session restore errors when a previously-open file was deleted between sessions

**Status:** ✅ Fix shipped 2026-04-30 (v0.5.3 sprint W5). New `files.exists(path): Promise<boolean>` IPC method (`electron/files-service.ts § exists` — `fs.stat` + `isFile()`, returns false on ENOENT). Session-restore hydration in `App.tsx` now `Promise.all`s an existence check across all restored file tabs, drops missing ones silently, and logs a one-shot console diagnostic listing dropped paths so unexpected drops are diagnosable. Active-working selection falls through to default `'browser'` when its target was dropped. New IPC channel `FILES_EXISTS`; preload + host-api types updated.
**Priority:** Medium-High (visible-on-launch error; common case for any user who deletes files between sessions)
**Filed:** 2026-04-30 (`20260430-improvement-notes.md` item 12)

**Owner observation:** "when a file that was open in a session is deleted between sessions, duo attempts to reopen the tab/file at relaunch, and shows an error (because it is gone)"

**Repro:**
1. Open a file (e.g. `~/Documents/notes/scratch.md`) in a WorkingPane tab.
2. Quit Duo.
3. Delete the file from disk (Finder / `rm`).
4. Relaunch Duo.

**Expected:** Either the tab is silently dropped during session-restore hydration, OR it opens with a friendly placeholder ("file not found at `<path>` — close tab? reveal parent in Finder?").
**Actual:** Duo attempts to read the file, hits ENOENT, surfaces an unhandled error in the tab.

**Suggested fix:**
During session-restore tab hydration, `fs.access(path)` each restored file path before pushing the tab into `tabs`. On ENOENT: drop silently OR push a `kind: 'missing-file'` tab shape that renders a placeholder. Recommend the placeholder for better mental-model continuity (the user knows what disappeared); silent drop is fine as a 30-LOC v1.

**Affected files:**
- `electron/session-store.ts` (session hydration)
- `renderer/App.tsx` (restoreTabs hydration block)
- `renderer/components/WorkingPane.tsx` (placeholder kind, if added)

**Cross-ref:** Stage 21c Phase 2 (session restore — original home of this code path). BUG-007 (deleted-files-linger in navigator — adjacent symptom; both stem from missing `unlink` event handling).

---

### BUG-040: External-domain blocklist not bouncing capitalone.com / gmail.com to system browser

**Status:** ✅ Fix shipped 2026-04-30 (v0.5.3 sprint W2). Diagnosis revealed the bug was bigger than a matcher tweak — there was **no routing interceptor for user-driven navigation at all.** Pre-fix, `external-domains.json` was an agent-only convention: the duo subagent read the file from `priming.md` and chose `duo external <url>` for off-host targets, while the BrowserManager's `webContents.loadURL` called from address-bar typing / link clicks bypassed the file entirely. Fix:
- New `core/external-domains-service.ts` — loads + parses + caches + matches; watches the file for live edits (250ms debounce). The matcher `*.foo.com` already handled bare-domain (`foo.com`) since Stage 25 — that part wasn't broken; the missing piece was hooking it into BrowserManager.
- `BrowserManager` now installs `will-navigate` + `will-redirect` interceptors on every WebContentsView (catches address-bar, link clicks, form posts, redirects). Off-host hosts → `event.preventDefault()` + `shell.openExternal(url)` + push the existing `EXTERNAL_REDIRECTED` IPC banner.
- `setWindowOpenHandler` consults the same matcher for popups.
- `addTab` initial load checks first; off-host URLs leave the tab on `about:blank` to avoid a flash-load-then-bounce.
- `electron/main.ts` `openExternalUrl` reuses the same service for the post-redirect banner reason lookup; the inline `lookupExternalDomainReason` + `matchesDomain` are gone.
**Priority:** **High** (defeats the whole point of the off-host blocklist; SSO + corporate-managed-browser flows break in the embedded browser)
**Filed:** 2026-04-30 (`20260430-improvement-notes.md` item 13)

**Owner observation:** "we still need to implement the browser blocklist ... capitalone.com and gmail still load in the duo browser -- this should not happen"

**State of the bundled blocklist (per ENH-009 v0.4.3 + Stage 21e v0.5.0):**
Fresh installs get an expanded `~/.claude/duo/external-domains.json` covering `*.capitalone.com`, `*.slack.com`, `mail.google.com`, `docs.google.com`, `drive.google.com`, `*.atlassian.net`, `*.microsoftonline.com`, etc. Existing-user upgrade-additive merge was deferred (mile 2 of ENH-009) — see ENH-021 below.

**Two distinct problems behind the user's report:**

1. **gmail.com loads in embedded browser** — likely existing-user issue. User installed pre-v0.4.3, their `external-domains.json` only contains `["*.capitalone.com"]`, gmail isn't on their list because additive merge never landed. Resolution path: ENH-021 (additive merge) OR `rm ~/.claude/duo/external-domains.json && relaunch` to re-bootstrap.

2. **capitalone.com STILL loads in embedded browser despite being in the user's list** — this is the real bug. The pattern-match / route-decision code is failing for an entry that's known-present. Hypotheses, in order of likelihood:
   - **Bare-domain mismatch.** Pattern is `*.capitalone.com` (subdomain wildcard) but user is hitting `capitalone.com` (no subdomain). `*.capitalone.com` doesn't match `capitalone.com` itself — only subdomains. This is the most common cause of "blocklist ignored my entry."
   - **In-page redirect / nested-frame blind spot.** Browser-Manager's URL-decision path may only check the top-level navigation URL, not subsequent in-page redirects (e.g., `capitalone.com` → `www.capitalone.com` → `myaccounts.capitalone.com`). The `will-navigate` vs `did-navigate-in-page` events handle these differently.
   - **Stale or invalid `external-domains.json`.** JSON parse failure could silently fall back to empty-list — confirm with explicit logging.

**Suggested triage:**
1. Owner: paste contents of `~/.claude/duo/external-domains.json`. If it's `["*.capitalone.com"]` only, item 1 (existing-user gap) is confirmed — workaround = delete the file, relaunch.
2. Test bare vs. subdomain navigation in the embedded browser. If `capitalone.com` (bare) loads but `www.capitalone.com` bounces to system browser, the matcher is strict-wildcard-only.
3. Log the URL + match decision in `BrowserManager`'s `will-navigate` / `will-redirect` handlers temporarily.

**v1 fix scope:**
- (a) Confirm bundled defaults cover both bare AND wildcard forms (`capitalone.com` + `*.capitalone.com`, `gmail.com` + `mail.google.com`, etc.). Add bare-domain entries where missing.
- (b) Fix the matcher to handle bare-domain entries OR document the subdomain-only semantic in the file's leading comment + ship a `duo blocklist test <url>` verb so users (and agents) can validate routing decisions deterministically.
- (c) Trace `will-redirect` / `did-navigate-in-page` to confirm same routing is applied to redirects.

**Affected files (suspected):**
- `electron/browser-manager.ts` (URL-routing decision; matcher logic)
- `electron/install-service.ts` (bundled defaults — add bare forms)
- `cli/duo.ts` (new `blocklist test/list` verb — optional v1 scope)

**Cross-ref:** ENH-009 (the original mile 1 — fresh-install defaults expansion); ENH-021 below (additive-merge for existing users); Stage 21e-iii (provenance-aware install pattern that was supposed to host the merge).

---

### ENH-018: Markdown editor — bullet marker character should match the source (`*` → disc, `-` → dash)

**Status:** ✅ Fix shipped + user-verified 2026-04-30 (v0.5.3 sprint W3 + post-walk hotfix `3eee115`). Initial v1 had a CSS bug where `list-style-type: '–  '` rendered as a tiny dot indistinguishable from disc; hotfix replaced with `::before` pseudo-elements. User verified working on the freshly-built `dist/mac-arm64/Duo.app`. Three coordinated changes ship the locked v1 spec end-to-end:

A. **Schema attribute on `bulletList`.** New `BulletListWithMarker` extension (`renderer/components/editor/extensions/BulletListWithMarker.ts`) extends `@tiptap/extension-bullet-list` with a `marker: '*' | '-' | '+'` attribute (default `'-'`). `parseHTML` / `renderHTML` round-trip via a `data-marker` attribute on the `<ul>`. `StarterKit.configure({ bulletList: false })` disables the default bullet so ours wins.

B. **markdown-it parse pass.** `parse.setup` registers a markdown-it core ruler that runs after the block parser; for every `bullet_list_open` token, it copies `token.markup` (the actual `*`/`-`/`+` from the source) into `data-marker` HTML attribute so tiptap-markdown's HTML pipeline carries it back into the ProseMirror tree.

C. **Serialize override.** `addStorage().markdown.serialize` reads `node.attrs.marker` and emits `${marker} ` per item, replacing tiptap-markdown's default that read the global `bulletListMarker` option. Each list keeps its source character on save.

D. **Input rule preserves typed character at top level only.** `wrappingInputRule({ find: /^\s*([-+*])\s$/ })` — the matched character sets `marker` on the new node. Per the locked spec (AskUserQuestion), inside an existing list the character is conformed to the parent's marker (TipTap's `wrappingInputRule` only fires when there's no surrounding bulletList, so this is enforced naturally — the rule never matches inside a list).

E. **CSS visual marker.** `globals.css` adds `ul[data-marker="*"]` → `disc`, `ul[data-marker="-"]` → en-dash + space, `ul[data-marker="+"]` → plus + space. Lists arriving without the attribute (legacy paths) fall through to the browser's `disc` default.

**Round-trip scope shipped (v1):** Direct edits (Enter, Backspace, indent/outdent), save → reopen, copy out (free with serializer fix). **Deferred to v2 (known limitation):** paste-fidelity from another markdown source — pasted markdown with mixed markers normalizes to the destination context's marker. cozy-md-editor explicitly didn't solve this either; the right home is `extensions/MarkdownPaste.ts` when picked up.

**Cozy-md-editor port note:** I didn't end up needing the `BULLET_RE` + `findParentListType` text-based fallback because tiptap-markdown's serializer hook + markdown-it parse hook gave us AST round-trip directly. If a behavioral regression appears (Enter splitting a list with the wrong marker), Cozy's regex utility is a clean drop-in for the keymap layer.

**Priority:** Medium (visual fidelity — what's on disk should match what's rendered, character by character)
**Filed:** 2026-04-30 (`20260430-improvement-notes.md` item 1; spec corrected same day)

**Owner observation:** "treat dashed bullets as dashed bullets -- not round bullets" → corrected to: "`*` should render as round bullets, `-` should render as dash bullets"

**Today:**
- TipTap's `BulletList` node has no concept of "which marker character was in the source" — it normalizes to a single `bulletList` node type.
- `markdown-io.ts` round-trips both `*` and `-` to a single canonical character on save (currently `-`). This means a user who typed `* foo` gets `- foo` back on save → marker character is silently rewritten.
- `renderer/styles/globals.css` `.duo-editor-prose ul:not([data-type="taskList"])` falls through to browser default `disc` for everything.

**Expected:**
1. `* foo` in source → renders as a **round bullet (disc)** AND round-trips back to `* foo` on save.
2. `- foo` in source → renders as a **dash** (en-dash `–` or hyphen-style) AND round-trips back to `- foo` on save.
3. Mixed lists in the same document preserve their respective markers.
4. New lists created via toolbar / shortcut default to one or the other (recommend `-`, matching CommonMark norm + current default).
5. Lists started by typing `* ` (input rule) → disc marker; lists started by `- ` → dash marker.

**This is structurally larger than the original "swap disc for dash" suggestion.** Three pieces:

**A. Schema attribute on `bulletList` to track the source marker.**
- Extend TipTap's `BulletList` (or wrap it) with a `marker: '*' | '-'` attribute, default `'-'`.
- Round-trip:
  - Parse: `markdown-io.ts` markdown → ProseMirror parser sets `marker` to whichever character was at the start of the list. (Requires reading the source line — most md→PM parsers don't expose this. May need a custom remark plugin or post-parse pass.)
  - Serialize: ProseMirror → markdown writes the `marker` attribute back as the bullet character.

**B. CSS rendering keyed on the attribute.**
```css
.duo-editor-prose ul[data-marker="*"]:not([data-type="taskList"]) {
  list-style-type: disc;
}
.duo-editor-prose ul[data-marker="-"]:not([data-type="taskList"]) {
  list-style-type: '–  ';  /* en-dash + double space */
}
```

**C. Input rules respect the typed character.**
- TipTap's default bullet-list input rule matches `[*+-]\s` and creates a `bulletList`. Override (or add a parallel rule) so the matched character sets `marker` on the new node.
- Toolbar "bullet list" button defaults to `'-'` (CommonMark canonical).

**Round-trip risks:**
- A list started with `*` and later edited (split / merged / re-flowed) — the `marker` attribute should propagate through edits. ProseMirror handles attribute preservation for splits but verify behavior for merging two lists with different markers.
- Lists nested inside other lists — each `bulletList` carries its own `marker`. Should compose naturally.
- Pasting markdown with `+` (third CommonMark bullet character) — for v1, recommend `+` → dash (treat as `-` synonym) OR add a third style. Plus is rare; defer.

**v1 scope (locked 2026-04-30 after research + AskUserQuestion):**

| Decision | Choice |
|---|---|
| Round-trip #1 — direct edits (Enter, Backspace, indent/outdent) preserve marker | ✅ ship in v1 |
| Round-trip #2 — save → reopen preserves marker | ✅ ship in v1 |
| Round-trip #3 — paste from another markdown source preserves markers | ⏳ deferred to v2 (document as known limitation; markers normalize to canonical on paste) |
| Round-trip #4 — copy out preserves markers in `text/markdown` clipboard MIME | ✅ free with #2 (serializer covers it) |
| Marker variants supported | **All three: `*`, `-`, `+`** (full CommonMark) |
| Mixed-list collision behavior | **Inherit parent's marker.** If user types `* ` inside an existing dashed list, the new item conforms to `-`. Cozy-md-editor's pattern — predictable, surprise-free. Mixed-marker authoring requires explicit edit at the source. |

**Implementation sketch (informed by cozy-md-editor research):**

A. **Schema attribute on `bulletList`.** Add `marker: '*' | '-' | '+'` (default `'-'`) via a small `BulletListWithMarker` extension that wraps `@tiptap/extension-bullet-list`.

B. **Parse: source character → attribute.** Custom remark plugin (or post-parse pass on the mdast tree) reads the bullet character at each list's start position and stamps it into the `bulletList` node attrs. The remark `list` node has a `start` offset that lets us peek at the original character in the raw source.

C. **Serialize: attribute → source character.** Extend the ProseMirror→markdown serializer in `markdown-io.ts` to emit the stored marker character per list.

D. **Input rules respect the typed character on list creation.** Override TipTap's default bullet-list input rule (matches `[*+-]\s`) so the matched character sets `marker` on the new node. **Inheritance rule: if the new list is being created inside an existing `bulletList`, inherit the parent's marker; only top-level new lists adopt the typed character.**

E. **CSS attribute selectors.**
```css
.duo-editor-prose ul[data-marker="*"]:not([data-type="taskList"]) { list-style-type: disc; }
.duo-editor-prose ul[data-marker="-"]:not([data-type="taskList"]) { list-style-type: '–  '; }
.duo-editor-prose ul[data-marker="+"]:not([data-type="taskList"]) { list-style-type: '+  '; }
```

F. **Behavioral fallback (Cozy-port).** Even with full AST tracking, on Enter / Backspace / Shift+Tab inside a list, run a Cozy-style regex (`/^(\s*)([-*+])\s/`) over the current line as a second-line check. Catches edge cases where ProseMirror's command output drifts from the AST attribute. Cozy's `findParentListType` is the reference for outdent inheritance.

**Test plan:**
- Round-trip fixture: `tests/fixtures/bullet-markers.md` with `*`, `-`, `+` lists, nested mixed lists, and an alternating sibling pattern. Parse → serialize → assert byte-identical with the source.
- Behavioral tests: Enter on a `*` line yields `*`, Enter on a `-` line yields `-`, Shift+Tab on a `* child` under `- parent` outputs `- child`.
- Known-failure test for paste fidelity (until v2): paste `- A\n* B` → both render with the canonical marker; document as expected.

**Out of scope (v1):**
- Paste fidelity (round-trip #3).
- HTML canvas marker selection — canvas authors hand-craft their own CSS; ENH-020 templates may follow this convention but it's not enforced.
- Numbered list marker variants (`1.` vs `1)`) — same architectural shape but separate ENH.
- Ordered-list re-numbering on outdent (cozy-md-editor's open TODO line 590) — out of scope.

**Reusable assets from cozy-md-editor** (`/Users/geoffreydudgeon/VSC Projects/vsc-cozy-md-editor/src/commands/editing.ts`): the `BULLET_RE` regex, `findParentListType()` function, and the Enter / Shift+Tab handlers. These are pure TypeScript text utilities — not VS Code-specific. Port verbatim into a `bullet-marker-utils.ts` helper in `renderer/components/editor/` and call it from the TipTap commands.

**Affected files:**
- `renderer/components/editor/extensions/BulletListWithMarker.ts` (new — wraps `@tiptap/extension-bullet-list` with the `marker` attribute + input rules)
- `renderer/components/editor/markdown-io.ts` (parse + serialize)
- `renderer/components/editor/bullet-marker-utils.ts` (new — Cozy-port of `BULLET_RE` + `findParentListType` for behavioral fallback)
- `renderer/styles/globals.css` (attribute-selector CSS rules)
- `renderer/components/editor/EditorToolbar.tsx` (bullet button: default to `-`; if cursor is inside an existing list, adopt that list's marker)

**Cross-ref:** Cozy-md-editor's `findParentListType` + `BULLET_RE` are the behavioral reference. v2 (paste fidelity) maps to `extensions/MarkdownPaste.ts` — fold there when picked up.

---

### ENH-019: Suppress OS scrollbar UI on horizontal tab strip overflow

**Status:** ✅ Fix shipped 2026-04-30 (v0.5.3 sprint W3). The `scrollbar-none` Tailwind class was already referenced on `TabBar.tsx` and `WorkingTabStrip.tsx` overflow containers — but the underlying CSS rule was never defined, so the class was a no-op and macOS painted its overlay scrollbar handle on every tab-strip overflow. Defined the utility in `globals.css § @layer utilities` covering Firefox (`scrollbar-width: none`), Chromium / WebKit (`::-webkit-scrollbar { display: none; width: 0; height: 0 }`), and old Edge (`-ms-overflow-style: none`). Pure cosmetic; ⌃Tab cycle / tab activation unchanged.
**Priority:** Low (visual polish)
**Filed:** 2026-04-30 (`20260430-improvement-notes.md` item 14)

**Owner observation:** "when scrolling horizontally through tabs in either the terminal or the working area/right pane, an os-default scroll bar ui/handle renders -- this is not necessary and should be suppressed"

**Today:**
The terminal tab strip (`renderer/components/TabBar.tsx`) and the WorkingPane tab strip (`renderer/components/WorkingTabStrip.tsx`) both use horizontal `overflow-x: auto`. macOS renders a transient scrollbar handle when content exceeds container width. Visually noisy.

**Suggested fix (v1):**
- `overflow-x: scroll; scrollbar-width: none` (Firefox) + `&::-webkit-scrollbar { display: none }` (Chromium) on the tab-strip scroll containers. Pure cosmetic suppression, no interaction change. ⌃Tab cycle + tab activation already cover keyboard navigation.
- Alternative (deferred): change to `overflow-x: hidden` and add ◀/▶ chevron buttons revealed only when overflow exists. UX polish but changes interaction model.

**Affected files:**
- `renderer/components/TabBar.tsx` (or its CSS)
- `renderer/components/WorkingTabStrip.tsx` (or its CSS)
- Possibly a single shared utility class in `globals.css`.

---

### ENH-020: Skill — "Building effective HTML canvases" (templates + ID conventions + agent-event buttons)

**Status:** ✅ Shipped v0.6.0+ — superseded by Stage 27's canvas-authoring skill split. The original ask landed as `skill/canvas-authoring.md` (Stage 27), then expanded into the v0.6.1 vocabulary-lock series: `skill/make-page.md` (basic HTML pages), `skill/make-playground.md` (interactive playgrounds with action verbs + events), `skill/playground-interaction.md` (driving / reading existing playgrounds), `skill/lesson-runtime.md` (lesson runtime), `skill/lesson-flythrough.md` (validation harness). Templates live at `skill/examples/canvas-templates/*.html` (5 seed templates) and `skill/examples/lesson-template/` (linear lesson) + `skill/examples/curriculum-template/` (multi-canvas curriculum). All discoverable via `skill/SKILL.md` + `agents/duo.md` cheat-sheet entries; deployed to user systems via `npm run sync:claude` and Stage 18 install banner.
**Priority:** Medium (canvas authoring is the most-used Stage 17 surface; structured guidance turns ad-hoc canvas builds into reproducible patterns)
**Filed:** 2026-04-30 (`20260430-improvement-notes.md` item 10)

**Owner ask:** "we need skill for building effective html canvases -- should include things like a template (eg notion-like structure you previously recommended), and rules for unique identifiers for divs where appropriate, guidance to make button elements function well with the duo cli for sending events from canvas >> duo, etc; skill should include multiple templates"

**Scope:** A dedicated skill at `skill/examples/canvas-authoring.md` (per CLAUDE.md plumbing checklist § 8 stub for new tab types) covering:

1. **Anatomy of a Duo canvas.** Boilerplate from `shared/html-boilerplate.ts` walked line-by-line — atelier palette tokens (`--paper`, `--ink`, `--accent`), dark-mode `@media`, `body min-height: 100vh` (BUG-023 fix), `<main>` content column at 720px max-width.
2. **Stable IDs (`data-duo-id`).** Why agent edits rely on them; auto-stamping at write time (ENH-001); when to author IDs by hand (durable anchors for comment threads / agent-targeted ops); ULID pattern.
3. **Agent-event buttons.** `data-duo-action` triple — `claude:spawn`, `terminal:send`, `browser:open`. Trust-gate path restriction (Stage 23 — actions only fire from `~/.claude/duo/`). Worked examples: a "run this checklist with Claude" button, a "send selected text to terminal" button, an "open external doc in browser" button.
4. **CLI ops cheat-sheet.** `duo html append/replace/prepend/set/delete/wrap/move/edit-attr/get/query` — what each does, when to reach for it, how `--id` vs `--selector` resolves.
5. **Three (or more) templates** at `skill/examples/canvas-templates/`:
   - `notion-doc.html` — title + heading hierarchy + callout blocks + checklist; mirrors a Notion-style daily-doc.
   - `dashboard.html` — top-row metric cards + a status table + an "ask Claude" CTA.
   - `walkthrough.html` — numbered step blocks each with a `claude:spawn` button + collapsible details. Pairs well with onboarding flows.
6. **Anti-patterns.** `<script>` tags swallowed by the iframe sanitizer; absolutely-positioned overlays (BUG-034 onboarding card story); inline `style` attributes harmless but discouraged.

**Discoverability:**
- New row in `skill/SKILL.md` linking to the skill file.
- New row in `agents/duo.md` cheat-sheet noting the skill location (so the Haiku-driven subagent can find it).
- `npm run sync:claude` after edits.

**Cross-ref:**
- Stage 17a.5 (template gallery — direct overlap; this skill's templates seed the 17a.5 gallery if/when it ships).
- `backlog-templates` roadmap item (template registry across markdown + HTML).
- ENH-001 + ENH-004 (stable IDs + atelier defaults — already shipped; this skill teaches users how to use them).

**Affected files (proposed):**
- `skill/examples/canvas-authoring.md` (new)
- `skill/examples/canvas-templates/*.html` (new — at least 3 seed templates)
- `skill/SKILL.md` (link + summary line)
- `agents/duo.md` (cheat-sheet entry)

---

### ENH-021: External-domains.json — additive-merge for existing users on upgrade

**Status:** ✅ Shipped 2026-04-30 (v0.5.3 sprint W2). `electron/install-service.ts § bootstrapOrMergeExternalDomains()` replaces the prior bootstrap-only block. On every install/upgrade: parse the existing `~/.claude/duo/external-domains.json`, compute `missing = bundledDefaults - userHosts` (string-equal compare against `host` field; handles both string and `{host, reason?}` entry forms), append missing to the array, write back. User entries preserved verbatim. Malformed-JSON case → leave alone (don't clobber edit-in-progress); the runtime service handles parse failures with empty-list fallback. v2 deferred: dismissed-defaults sidecar so a default the user explicitly deleted doesn't come back on next install.
**Priority:** Medium-High (gates ENH-009's reach for any pre-v0.4.3 install; pairs with BUG-040)
**Filed:** 2026-04-30 (`20260430-improvement-notes.md` item 13 — partial; the existing-user side)

**Today:**
`electron/install-service.ts:296–303` bootstraps `~/.claude/duo/external-domains.json` only if absent. Existing users with a populated file (typically just `["*.capitalone.com"]` from the original v0.x bootstrap) don't pick up v0.4.3's expanded list (Slack, Gmail, Google Docs, Atlassian, M365). The comment at line 293 references "Stage 21e-iii (v0.5.0) adds an additive-merge upgrade path" — but Stage 21e shipped without that mile.

**Expected:**
On install / version-bump, read existing `external-domains.json`, parse `domains`, add any MISSING bundled defaults to the array. Don't remove user entries. Don't re-add entries the user explicitly deleted (requires a "dismissed-defaults" tracker — deferred to v2).

**v1 algorithm:**
1. Read `external-domains.json`. If parse fails, fall through to bootstrap-from-scratch (existing path).
2. Compute `missing = bundledDefaults - userDomains`.
3. If `missing` is non-empty, write back `userDomains ∪ missing`. Atomic tmp-rename pattern (existing `writeFileAtomic` helper).
4. Log: "added N new bundled defaults — capitalone.com (bare), mail.google.com, docs.google.com, *.slack.com, *.atlassian.net".
5. Surface in the install banner (or a one-shot toast on first relaunch post-upgrade): "Updated your blocklist with N new SaaS domains. Edit at `~/.claude/duo/external-domains.json`."

**v2 (deferred):**
- "Dismissed-defaults" tracker (sibling JSON) so re-runs don't re-add user-removed entries.
- In-app UI to view / toggle the blocklist (settings panel).
- `duo blocklist add/remove/test/list` CLI verbs.

**Affected files:**
- `electron/install-service.ts` — `mergeExternalDomains()` helper alongside the existing bootstrap block.
- `shared/external-domains-defaults.ts` — extract the bundled default array if not already (so install-service + matcher share one source).
- `fork.config.default.json` — verify the Vite-injected runtime defaults match bundled.
- Release notes for the version that ships this.

**Cross-ref:** ENH-009 (the original mile 1 — fresh-install defaults), BUG-040 (the bare-domain matcher fix that pairs with this).

---

### ENH-022: `duo doc goto` — agent-driven editor navigation (heading / line / anchor)

**Status:** 🔵 **DEFERRED — owner call v0.5.4 walk: "I'm tired of working this one, please drop priority level on this bug — it should not block the next release".** v4 added disk-reload (re-read file before each goto if the editor's clean) + `matched_heading` diagnostic field; v5 added `console.log('[doc-goto v4]', { didReload, bufferStale, heading })` for instrumentation. Both shipped in v0.5.4 but rev3 walk still showed BUG-034 instead of BUG-048. Carries over indefinitely; do NOT pull into the next sprint without owner re-prioritization. The instrumentation stays in the codebase so a future debugging pass has data without re-instrumenting.
**Priority:** Deferred (was Medium; owner downgraded 2026-05-01)

**Was 🟡 (v3 partially fixed — released as-is in v0.5.3):** v3 precedence chain DID move the match (rev2: BUG-032; rev3: BUG-034 — different wrong heading, so the precedence change is doing something), but still wrong target. v4 hypotheses, in priority order:
1. **Buffer staleness (most likely).** TipTap's editor.state.doc was loaded when tasks.md was opened. Subsequent disk edits don't reload (Stage 16 external-write reconciliation is ⬜). The headings the precedence chain walks are from a stale buffer. The "different wrong heading" pattern between rev2 (BUG-032) and rev3 (BUG-034) is consistent with a buffer-from-different-snapshot.
2. **Word-boundary regex permissive.** My v3 regex `(^|\W)bug-038(\W|$)` should match a heading text containing "BUG-038" as a word, but my heading walk is comparing against `node.textContent` which loses formatting context — possibly multiple headings span "BUG-038" in their text via inline marks. Diagnose: log all headings the walk produces, see what matches.
3. **Closer numeric matches.** Rev2 picked BUG-032 (4 chars apart from 038); rev3 picked BUG-034 (4 chars apart). Coincidence? Or my word-boundary regex is matching shared prefix "bug-03" somehow. The needle "bug-038" should match exactly one heading; debugging via `matched_heading` field is the diagnostic path.

**Next-walk diagnostic ask:** when re-running, share the FULL CLI JSON response — the `matched_heading` field will name the actual heading text picked. With that, the cause is unambiguous.

**Was the v3 close attempt:** Match precedence tightened: `exact (case-insensitive) > starts-with > word-boundary > substring`. Previous v2 logic used a single `includes` pass which could pick a heading that mentions the needle as a stray substring; the precedence chain ranks intentional matches above incidental ones. Response shape (`DocGotoResult`) extends with `matched_heading` so wrong-match reports are self-diagnosing.

**Was 🟡 (v2 partially fixed — re-opened 2026-05-01 from v0.5.3-rev2 smoke walk):** Editor scrolled (v2 fix landed) but to BUG-032 instead of BUG-038. v2 fix proved the scroll plumbing; v3 fixes the heading-match logic.

**v3 hypotheses (carry into next sprint):**
1. **Heading match precedence is too loose.** Current impl: `headings.find(h => h.text.toLowerCase().includes(needle))`. First match wins, but `includes` is permissive — a heading text "BUG-032 (… mentions BUG-038 in body)" wouldn't match (only the heading text is searched), so this is unlikely. Worth verifying with the actual returned `anchor` field from the CLI response.
2. **Buffer staleness.** If the user opened tasks.md before tonight's edits and the editor's TipTap doc hasn't reloaded from disk (Stage 16 external-write reconciliation is ⬜), the `editor.state.doc.descendants` walk sees stale headings — possibly a version where BUG-038's heading text was different. Quick verify: run `duo doc read` against tasks.md, compare the buffer against the disk file.
3. **Heading text shifted.** If the BUG-038 heading was renamed in a recent edit, an old anchor / heading text in the user's mental model wouldn't match the current text. Same diagnosis path as #2.
4. **Different file is the active editor.** `duo doc goto` operates on the active editor's path. If a different markdown file is active and contains a heading like "BUG-032 (… BUG-038 follow-up)", the match could land there. The CLI response's `path` field would tell us. Earlier smoke walks showed `path: ".../tasks.md"` so this seems unlikely but worth ruling out.

**Diagnostic ask for the next walk:** when re-running, share the FULL CLI JSON response (path / line / anchor fields). With that, the wrong-match cause is unambiguous.

**Was ✅ (v2 — briefly):** Two-pronged fix in `MarkdownEditor.tsx`'s doc-goto handler. (1) Chain `focus()`, `setTextSelection(pos)`, `scrollIntoView()` into a single `editor.chain().run()` so the scrollIntoView flag is on the same transaction that moves the selection — the original three-separate-commands form ended up with `scrollIntoView` running on an empty transaction after the selection had already settled, which PM treated as "selection visible — nothing to do" depending on layout. (2) Belt-and-braces RAF callback that resolves the target's DOM node via `view.domAtPos()` and calls native `scrollIntoView({ block: 'center', behavior: 'smooth' })` — same fix shape as BUG-043. v2 fixed the SCROLL gap; v3 must fix the MATCH gap.

**Was 🟡 (CLI parses + IPC returns ok, but the renderer doesn't scroll. Re-opened 2026-04-30 from v0.5.3 smoke walk):** User repro:

```
$ duo doc goto --heading "BUG-038"
{
  "ok": true,
  "path": "/Users/.../tasks.md",
  "line": 1802,
  "anchor": "bug-038-tab-cycle-still-skips-some-tabs-bug-021-follow-up"
}
```

The CLI lexical-scope fix (commit `bc5e520`) is correct — the response parses cleanly with the right path / line / anchor. The bug is now downstream in the renderer-side `dispatchDocGoto` handler, the markdown editor's response to that IPC, OR the editor's scroll-to-position implementation. The successful response means main + IPC are fine; the issue is in `MarkdownEditor.tsx`'s actual scrolling.

**v2 diagnosis (carry into next sprint):**
- Walk the path: `electron/main.ts § dispatchDocGoto` → IPC.DOC_GOTO_REQUEST → renderer handler in `MarkdownEditor.tsx` → ProseMirror commands.
- Most likely: the editor's `scrollToHeading` / `scrollToLine` helper has the same scroll-container-mismatch issue as BUG-043's find-bar (`scrollBy` on the wrong element). Look for `scrollIntoView` on a non-scrolling parent.
- Or: the active-editor matching is dropping the path mid-flight.
- Quick check: open tasks.md, run `duo doc goto --line 100`, watch the Electron devtools for any ProseMirror command errors.

**Was ✅ (briefly):** Lifted `flagValue(args, name)` to module scope in `cli/duo.ts` so all subcommand cases share a single arg-flag lookup. Renamed the local one-arg shim in `case 'html'` to `flag` (closure over `subRest`) and updated all html-op call sites. Smoke-tested: `node cli/duo doc goto --heading "BUG-040"` against the live app returned `ok:true` with the resolved anchor. Original v1 (84f5a35) had the renderer/IPC plumbing right (or so I thought); only the CLI parser was broken — but the renderer's actual scroll handler is now exposed as the second half of this bug.

**Was 🟡 (broken at CLI surface — re-opened 2026-04-30):** User repro:
```
$ duo doc goto --heading "BUG-040"
duo: flagValue is not defined
```

**Root cause:** `cli/duo.ts § case 'doc' / sub === 'goto'` (lines ~479–481) called `flagValue(subRest, '--heading')` etc., but `flagValue` was defined locally INSIDE `case 'html'` (line ~652) and wasn't visible from the `'doc'` case scope. Pure lexical-scope bug.

**Implementation (renderer / IPC / main — all good, just blocked by the CLI bug):**
New `duo doc goto [<path>] --heading "X" | --line N | --anchor "Y"` verb. Markdown editor handles `--heading` (case-insensitive substring on heading text), `--line` (1-indexed; PM-tree walk to map line → block position), and `--anchor` (GitHub-slug match against headings; exact > prefix > substring). HTML canvas handles `--anchor` (`data-duo-id` first, falls back to `id`) and `--line` (top-level child of `<main>` / `<body>` — coarse). After landing: focus the editor, place caret / scroll into view, paint a 1.5s `.duo-goto-flash` highlight on canvas matches. Plumbing: full 8-step checklist + types in shared/types.ts (`DocGotoRequest` / `DocGotoResult`) + IPC channels + preload/host-api + main dispatch + socket-server case + cli verb + skill + agents + CLI-COVERAGE.
**Priority:** **High** (real workflow gap — owner hit it 2026-04-30 looking for BUG-040 in `tasks.md`; agent has no way to land the editor view at the right spot after `duo edit`)
**Filed:** 2026-04-30 (sprint addition)

**Owner ask:** "duo doc goto --heading|--line|--anchor so the agent can land the editor view after duo edit (the gap I just hit looking for BUG-040)." Followed by: "Should probably be go-to arbitrary dom element in html, and heading in markdown."

**Today:** `duo edit <path>` opens the file in the working pane. The user / agent then has to scroll to find what they came for. For a 2200-line `tasks.md` looking for `### BUG-040`, that's manual scrolling. Same gap exists for HTML canvases (no way to scroll to a specific `data-duo-id` after `duo edit`).

**Expected (v1):**

```
duo doc goto [<path>] --heading "Foo"
duo doc goto [<path>] --line 1043
duo doc goto [<path>] --anchor "bug-040"
```

`<path>` optional — defaults to the active editor's path. One of the three flags is required. Returns `{ ok, path, line?, anchor?, error? }`.

**Resolution semantics:**

- **`--heading "Foo"`** (markdown only) — case-insensitive substring match against heading text in document order. First match wins. Errors with helpful message + list of matched headings if zero matches.
- **`--line N`** (any text editor) — 1-indexed (vim / VS Code convention). Clamps to last line if N > line count.
- **`--anchor "X"`** —
  - **Markdown editor:** matches the slugified-id of any heading. `### BUG-040: Foo` → slug `bug-040-foo`. `--anchor "bug-040"` matches via prefix or substring (case-insensitive). The slug computation matches GitHub's: lowercase, replace whitespace with hyphens, strip non-alphanumerics-or-hyphens.
  - **HTML canvas:** matches the FIRST element whose `data-duo-id` OR `id` attribute equals `--anchor`. `data-duo-id` wins if both exist on different elements. Owner clarification: "go-to arbitrary dom element in html" — so any `id` is in scope, not just `data-duo-id`.

**After landing:**
- Scroll the matched line / element into view (centered or top-third — recommend top-third for context).
- Place cursor at start of line (markdown) / focus the body and select the matched element (canvas).
- Focus the editor surface so subsequent keystrokes land in the doc.
- Push a brief "just-added" highlight on the matched line / element so the user sees where it landed.

**Plumbing checklist (per CLAUDE.md § 4):**

1. `shared/types.ts` — `DocGotoRequest` / `DocGotoResult` discriminated unions; new IPC channels `DOC_GOTO_REQUEST` / `DOC_GOTO_RESULT`.
2. `electron/preload.ts` — wire request/reply pair (mirror `dispatchDocWrite`).
3. `electron/main.ts` — `dispatchDocGoto()` + socket-server handler.
4. `core/socket-server.ts` — extend NavBridge with `docGoto`; new case in command switch.
5. `cli/duo.ts` — `case 'doc'` branch with `goto` subcommand; flag parsing for `--heading | --line | --anchor`; `printHelp()` update. Rebuild binary.
6. `skill/SKILL.md` — verb cheat-sheet entry under § Verb cheat-sheet.
7. `agents/duo.md` — same.
8. `docs/CLI-COVERAGE.md` — inventory update.

**Renderer side:**
- `MarkdownEditor.tsx` — accept a new `onGotoRequest` callback or expose a ref method. Use TipTap's `editor.commands.setTextSelection` + `editor.view.dispatch` with a scroll-into-view marker. Heading lookup: walk the editor's doc tree, find heading nodes, match text. Line lookup: count newlines in the markdown (or use TipTap's `state.doc.resolve`). Anchor lookup: compute slug from each heading, match.
- `CanvasTab.tsx` — accept goto via the existing `htmlOp`-style dispatch OR a dedicated channel. Use `iframe.contentDocument.querySelector('[data-duo-id="X"], #X')`, then `element.scrollIntoView({ block: 'center' })` and add a "just-added" CSS class to the element for ~2s.

**Scope:**
- v1 ships markdown + canvas goto (the two surfaces with editor semantics).
- Browser tab goto (scroll to anchor in a loaded page) deferred — `BrowserManager` could add `--anchor` for `#fragment` URLs, but that's URL-bar work, not editor work.
- Image / PDF / markdown-preview tabs don't make sense for goto.

**CLI shape examples:**
```
$ duo doc goto --heading "BUG-040"
{"ok":true,"path":"/Users/geoff/.../tasks.md","line":2161,"anchor":"bug-040-external-domain-blocklist-not-bouncing-capitalonecom-gmailcom-to-system-browser"}

$ duo doc goto ~/notes/scratch.md --line 42
{"ok":true,"path":"/Users/geoff/notes/scratch.md","line":42}

$ duo doc goto --anchor "checklist-section"
{"ok":true,"path":"...","anchor":"checklist-section"}
```

**Cross-ref:** Stage 11 (markdown editor host), Stage 17a (canvas), Stage 15 (CLI plumbing checklist), `duo reveal` (file-level analog — this is the in-document analog).

---

### ENH-023: ⌘F find-in-document for the markdown editor (v1)

**Status:** ✅ Shipped 2026-04-30 (sprint addition).
- New `FindHighlight` TipTap extension (`renderer/components/editor/extensions/FindHighlight.ts`) — pure-decoration ProseMirror plugin, paints `.duo-find-match` (yellow) on every match + `.duo-find-match-current` (orange/accent) on the cursor's current match. Storage exposes `{query, caseSensitive, total, current, open}` for the FindBar's match counter.
- New `FindBar` component (`renderer/components/editor/FindBar.tsx`) drops below the toolbar when open: input + case-sensitive toggle + counter + prev/next/close buttons.
- Keyboard: ⌘F opens / re-focus + select; ⌘G next; ⌘⇧F previous; ↩ / ⇧↩ inside the input next/prev; ⎋ closes.
- App.tsx routes via `window.dispatchEvent(new CustomEvent('duo-editor-find-{open,next,prev}'))`. Only one MarkdownEditor mounts at a time (WorkingPane swaps activeRenderer per-tab) so the listener is unambiguous.
- CLI counterpart `duo doc find <query> [<path>] [--case-sensitive]` shipped with ENH-022's plumbing — markdown only v1, returns `{matches, first: {line, col}}`.

**v2 deferrals:**
- Replace input + Replace / Replace All buttons.
- Regex toggle.
- Canvas / browser / terminal find variants.
- Selection sync — currently the editor's caret stays put when navigating matches (intentional: don't steal focus from the find input). v2 could add a "press ↩ + then ⎋ jumps to current match" finalize gesture.

**Priority:** Medium-High (every editor has this; missing it makes long docs feel hostile)
**Filed:** 2026-04-30 (sprint addition)

**Owner ask:** "⌘F find-in-document for the markdown editor (with v2 extensions for canvas / browser / terminal, and a duo doc find CLI counterpart)."

**Locked spec (AskUserQuestion 2026-04-30):**

| Decision | Choice |
|---|---|
| v1 surfaces | Markdown editor only |
| Find vs find+replace | **Find only** |
| Open chord | `⌘F` |
| Next match | `⌘G` (also `↵` while find input has focus) |
| **Previous match** | **`⌘⇧F`** (chosen to avoid the `⌘⇧G` conflict — that chord just shipped as "Go to folder" / breadcrumb edit) |
| Close | `⎋` while find input has focus |
| Case sensitivity | Case-insensitive default; toggle for case-sensitive |
| Regex | Defer to v2 |

**v1 UI:**
- A find bar drops down from the top of the markdown editor's chrome (above or below the comment-rail header — TBD; probably above). Inputs: query text, case-sensitive toggle, prev/next buttons, close button. Match counter ("3 of 17") to the right of the input.
- Match-as-you-type: every keystroke re-runs the search; all matches are highlighted inline with a yellow `--mark` background; the current match gets a stronger orange `--accent` highlight.
- Arrow keys / `↵` cycle through matches; the current-match highlight scrolls into view (top-third for context).
- `⎋` closes the bar but preserves the query for next ⌘F.

**Implementation approach:**
- TipTap doesn't ship a built-in find extension, but the prosemirror-search package OR a hand-rolled decoration plugin both work. Recommend hand-rolled since the surface is contained: a custom TipTap extension that maintains a `findQuery` state, runs a regex-or-string search over the doc on each update, emits a `Decoration.inline` set with two classes (`duo-find-match` + `duo-find-match-current`).
- Bar component lives in `renderer/components/editor/FindBar.tsx`; mounts conditionally based on `findOpen` state in `MarkdownEditor`.
- Keyboard wiring: `⌘F` is currently unused (bullet bind doesn't exist). Add to `globalShortcuts.ts` matcher with id `openFind`. Dispatch through `useKeyboardShortcuts` to `MarkdownEditor`'s ref API. Inside the find input, `↵` / `⇧↵` / `⎋` are local handlers — they don't need to escape to the matcher. `⌘G` and `⌘⇧F` route through the matcher when the editor (not the input) has focus.

**CLI counterpart (`duo doc find`):**
```
$ duo doc find "BUG-040"
{"ok":true,"path":"...","matches":3,"first":{"line":2161,"col":4}}
```

Returns count + first-match line/col so an agent can decide whether to `duo doc goto --line N` next. v1 markdown only. Returns `{ ok:false, error: "..." }` if active doc isn't a markdown editor (or no doc is open).

**Plumbing checklist (per CLAUDE.md § 4) — same 8 steps as ENH-022.**

**v2 deferrals:**
- Replace input + "Replace" / "Replace all" buttons (⌘⌥F to open replace mode).
- Regex toggle.
- Canvas find (search the iframe's contentEditable body — same decoration pattern but a separate plugin since canvas isn't TipTap).
- Browser find (delegates to Chromium's `webContents.findInPage`).
- Terminal find (xterm.js's `SearchAddon`).

**Cross-ref:** ENH-022 (`duo doc goto` — find's natural follow-up: find the line, goto it). Stage 11 (markdown editor home).

---

<!-- (Duplicate older draft removed 2026-04-30; the canonical entry is the
ENH-022 above with shipped status and full plumbing notes.) -->

<!-- (Duplicate older draft removed 2026-04-30; the canonical entry is the
ENH-023 above with shipped status and full plumbing notes.) -->

### BUG-041: Right-click on FileTree whitespace shows no context menu (ENH-016 follow-up)

**Status:** ✅ Shipped 2026-04-30 (v0.5.3 sprint). Wrapper-level `onContextMenu` in `FileTree.tsx`; gates on `e.target === e.currentTarget` so row clicks don't double-fire. Synthesized "root" target = `{name: basename(state.cwd), path: state.cwd, kind: 'directory'}`; new `whitespaceMode` flag on `buildMenuItems` trims the menu to the safe set (New file / New folder / Open terminal here / Reveal in Finder). Suppressed: Rename, Move to Trash, Copy path, Open with default app, Pin/Unpin — all of which would target the project root (almost always destructive or irrelevant).
**Priority:** Medium-High (paired with ENH-016 — without this, "new file" / "new folder" only works from a row-anchored right-click, which is a discoverability gap)
**Filed:** 2026-04-30 (smoke-walk follow-up)

**Owner observation:** "context menu fires on existing file/folder rows, but no menu fires when right-clicking in the whitespace below the files in the navigator."

**Today (traced):** `renderer/components/FileTree.tsx § TreeNode` wires `onContextMenu` per-row. The empty area below the last row sits inside the FileTree wrapper (`.flex-1 overflow-auto scrollbar-none py-1`) but has no `onContextMenu` handler — the right-click bubbles up but no listener catches it. ENH-016 originally proposed (3) "right-click empty space inside the FileTree (no row hit) → menu shows New file… / New folder… / Reveal in Finder / Open terminal here against the project root." That bullet wasn't implemented in v1.

**Proposed fix:**
- Add `onContextMenu` to the FileTree wrapper div that opens a project-root-anchored context menu when `e.target === e.currentTarget` (i.e., the click hit the wrapper, not a nested row that has its own handler).
- Menu items: "New file…", "New folder…", "Open terminal here", "Reveal in Finder" — all targeting `state.cwd`.
- The "New file…" / "New folder…" items reuse the same handlers wired in v1-hotfix.

**Affected files:**
- `renderer/components/FileTree.tsx` — extend the wrapper's `onContextMenu`; reuse `buildMenuItems` with a synthesized "root folder" entry.

**Cross-ref:** ENH-016 (parent enhancement). Stage 26 PR 3.

---

### BUG-042: Browser pane click while focus is elsewhere doesn't switch focus (BUG-037 sibling)

**Status:** ✅ Shipped 2026-04-30 (v0.5.3 sprint). Subscribed to `webContents.on('focus', ...)` in `BrowserManager.wireKeyForwarding()` and added IPC channel `BROWSER_FOCUS_GAINED` (`browser:focus-gained`). Renderer subscribes via `window.electron.keyboard.onBrowserFocusGained` and flips `focusedColumn = 'working'`. Symmetric to the BUG-037 canvas mousedown forwarder. The `focus` event covers click-to-focus, Tab-to-focus from devtools, and programmatic `webContents.focus()` calls — every path that gives the WebContentsView OS keyboard focus. Combined with BUG-038's v3 ref fix, this closes the "wrong-pane keyboard shortcut" failure family.
**Priority:** Medium (same root-class as BUG-037 but for a different surface; cascades into wrong-pane keyboard shortcuts including BUG-038's symptom)
**Filed:** 2026-04-30 (smoke-walk follow-up)

**Owner observation:** "BUG-037 squashed for html canvas; still open for browser panes."

**Repro:**
1. Open a browser tab in the working pane.
2. Click into a terminal so terminal column has focus (orange chrome strip).
3. Click anywhere inside the browser viewport.

**Expected:** The working column gains focus (chrome strip flips orange) and subsequent ⌃Tab / ⌘T fire against the working pane.
**Actual:** `focusedColumn` stays `'terminal'`. The browser does receive the click (link follow-through, scroll, etc. work), but the pane-focus signal doesn't update.

**Why BUG-037's fix doesn't cover this:** The canvas uses an `<iframe srcdoc>` that lives in the same renderer process — `RenderedCanvas` could install a `mousedown` listener on `iframe.contentDocument` and call back into the parent. The browser pane uses `WebContentsView` (a SEPARATE WebContents process) — its DOM events don't reach renderer JS at all. The forwarder mechanism has to live in the main process, not the renderer.

**Suggested fix (proposal — refine in next sprint):**
- `electron/browser-manager.ts § wireKeyForwarding` already forwards keystrokes from each `WebContentsView` to the main BrowserWindow via `before-input-event`. Extend with a parallel `mousedown` forwarder via `webContents.on('input-event', …)` (or a similar hook) that fires `IPC.WORKING_PANE_FOCUS` to the renderer.
- The renderer (`App.tsx`) handles the IPC and calls `setFocusedColumn('working')`.
- Symmetric to BUG-038 fix's xterm-focus listener — different mechanism but same outcome shape.

**Class summary:** When BUG-038 shipped, I noted "focus arriving by non-click paths" as a symptom, but the BROWSER-pane equivalent of click-acquires-focus wasn't traced or fixed at the same time. BUG-038's recurring failures are partially downstream of this — if the user clicked into a browser tab and `focusedColumn` stayed `'terminal'`, ⌃Tab cycles terminal tabs (the user's mental model says "I'm in the browser now, ⌃Tab should cycle browser tabs"). Fixing BUG-042 should also un-stick part of BUG-038's reproduction surface.

**Cross-ref:** BUG-037 (canvas equivalent — shipped), BUG-032 (canvas focus-steal — shipped, opposite direction), BUG-038 (recurring ⌃Tab cycle bug — partial overlap).

---

### BUG-043: ⌘F find counts matches but doesn't scroll; arrow keys do nothing (ENH-023 follow-up)

**Status:** ✅ Shipped 2026-04-30 (v0.5.3 sprint).

**Owner observation:** "the cmd-f find seems to count the number of instances of the search string, but does not scroll to it, and the up/down arrows (I assume for next/prev) also do nothing."

**Root causes (two distinct):**
1. **Scroll-to-match silently failed.** `FindHighlight.ts § view.update` called `editorEl.scrollBy({ top, behavior: 'smooth' })` on `view.dom.parentElement`. But the actual scroll container is 2–3 ancestors up — `MarkdownEditor.tsx` wraps `<EditorContent>` in `<div class="mx-auto max-w-[760px] ...">` inside `<div class="flex-1 overflow-auto">`. `view.dom.parentElement` is the TipTap `.tiptap` wrapper (or ProseMirror's own host) — not the scroller. `scrollBy` on a non-scrolling element is a silent no-op.
2. **Arrow keys weren't bound.** The user expected `↓` / `↑` inside the find input to navigate matches (mirroring the visible ▼ / ▲ buttons in the bar). FindBar's `onKeyDown` handled only `Enter`, `Escape`, `⌘F/G/⇧F` — Arrow keys fell through and acted as default caret movement inside the input.

**Fix:**
1. Replace `scrollBy` with `el.scrollIntoView({ block: 'center', behavior: 'smooth' })` on the `.duo-find-match-current` decoration node directly. `scrollIntoView` walks up looking for the right scrollport itself, so the deeply-nested layout doesn't matter. Defer to `requestAnimationFrame` so the decoration has been painted by the time we look it up.
2. Add a closure-scoped `lastScrolledIndex` + `lastScrolledQuery` dedupe so the smooth scroll fires exactly once per setQuery / next / prev. Without this, every `view.update` (cursor moves, focus changes, unrelated transactions) re-reads `scrollTo` and re-scrolls — visible as jitter or no scroll at all when smooth animations stack.
3. Bind `ArrowDown` → `findNext()` and `ArrowUp` → `findPrev()` in `FindBar.tsx § onKeyDown` (Chrome's find bar behaves identically). `preventDefault` keeps the input from inserting a control character or moving the caret.

**Affected files:**
- `renderer/components/editor/extensions/FindHighlight.ts` — scroll mechanism + dedupe.
- `renderer/components/editor/FindBar.tsx` — Arrow key handlers.

**Filed:** 2026-04-30 (in-flight during v0.5.3 sprint).
**Priority:** High (find without scroll is unusable; arrow-key gap is a discoverability bug).
**Cross-ref:** ENH-023 (parent enhancement).

---

### BUG-044: Find-bar text contrast unreadable in dark mode

**Status:** ✅ Shipped 2026-04-30 (v0.5.3 sub-sprint). Root cause was broader than the find bar: `tailwind.config.mjs` never defined a `paper` color family, so `bg-paper`, `bg-paper-deep`, `bg-paper-edge`, `bg-paper-rule`, `border-paper-rule`, `border-paper-edge` (used across TabBar, WorkingTabStrip, FindBar) were silently inert. In light mode the fallthrough was unnoticed because browser-default white still contrasted with `text-ink` (dark in light mode). In dark mode, FindBar's input rendered as light-cream `text-ink` on browser-default white — exactly the user's "light brown on white" report. Fix: added a `paper` color family to the Tailwind config that mirrors `surface.*` (same CSS variables, new aliases). Also dropped FindBar's `focus:bg-white` since it forced a white bg even in dark mode once `bg-paper` started actually applying — `focus:border-accent` already provides enough emphasis. Smoke-walk verification owed.
**Priority:** Medium (paper-cut — find still works, just hard to read)
**Filed:** 2026-04-30 (smoke-walk OTHER NOTES from BUG-043 PASS)

**Owner observation:** "currently search string is light brown on white -- hard to read; not an issue on light mode."

**Today (traced):** The FindBar input in `renderer/components/editor/FindBar.tsx` uses Atelier tokens — `bg-paper border border-paper-rule text-ink placeholder-ink-ghost`. In dark mode, `--duo-paper` flips to a dark surface but `text-ink` evidently isn't matching the pair correctly (or some intermediate token is). Result: the typed query renders as light-brown-on-white instead of light-on-dark. Light mode's paper bg + ink text reads fine.

**Proposed fix:**
- Inspect via devtools in dark mode: which CSS token is the input's `color` actually resolving to?
- Likely culprit: a dark-mode override missed the find-bar input, OR the input's bg token (paper) is dark but its color token (ink) is being shadowed by browser default or a Tailwind reset.
- Fix in `renderer/styles/globals.css` or a scoped class on the input.

**Affected files:**
- `renderer/components/editor/FindBar.tsx` (input element).
- `renderer/styles/globals.css` (theme tokens / dark-mode overrides).

**Cross-ref:** BUG-043 (parent — find functionality), ENH-023 (find-bar v1).

---

### BUG-045: File:// browser tabs should expose file context menu (ENH-026 follow-up)

**Status:** ✅ **v2 fix shipped 2026-05-01 (v0.5.3 sub-sprint, post-rev2 walk).** WCV-overlay-mute via the new `browser.setOverlayMuted(boolean)` API: when the user right-clicks a browser tab in the WorkingTabStrip, the WebContentsView is collapsed to 1×1 for the duration of the menu, then restored on close (or outside-click / Escape). Closes the occlusion gap — full menu is now visible regardless of menu height. See BUG-047 for the broader class summary + the alternative paths considered.

**Was 🟡 (menu items render but are visually occluded — re-opened 2026-05-01 from v0.5.3-rev2 smoke walk):** User screenshot shows "Reveal in navigator" and a partial "Rename..." entry visible above the strip / address bar zone, with the rest of the menu cut off behind the WebContentsView. Same root cause family as BUG-006 (Send → Duo pill on browser pane): renderer-DOM overlays sit ABOVE the renderer's own DOM but BELOW the WebContentsView at the macOS compositor level. v1 (2026-04-30) shipped the data plumbing correctly; only the rendering surface was occluded.

**Was ✅ (v1 shipped 2026-04-30):** When a browser tab points at a local file (`file://` URL — e.g. smoke walk page, agent-generated dashboard, local HTML preview), the right-click context menu exposes Reveal in navigator / Rename… / Move to Trash… in addition to Pin/Unpin. Previously only "true" file tabs (path-bearing markdown, canvas, image previews) got the file menu. The data plumbing is correct; the rendering occlusion is the only remaining gap.

**Owner observation (from v0.5.3 smoke walk):** "for local html artifacts, these should be deletable, or (better yet) they should default open in canvas not in browser."

**Implementation:** `WorkingTabStrip.tsx § handleContextMenu` reads `tab.path ?? pathFromFileUrl(tab.url)` — the helper converts a `file://` URL back to a filesystem path via the URL constructor + decodeURIComponent. `App.tsx § onTrashTabFile` extended to handle both id encodings — `f:<uuid>` calls `closeFileTab`, `b:<numericId>` calls `browser.closeTab` (so trashing a local file via its browser tab also closes the tab cleanly).

**Cross-ref:** ENH-026 (parent — tab context menu). The "(better yet)" half of the user's observation is filed as **ENH-027** below (canvas-default routing for local HTML).

---

### ENH-027: Local HTML defaults to canvas, not browser (`<meta name="duo-open-in">` opt-out)

**Status:** 🆕 Filed · **held until Stage 17e** (cross-referenced in `docs/roadmap.html` + `docs/roadmap.html` Phase 17e bullet list).
**Priority:** Medium-High (user's "(better yet)" preference; design already exists in ROADMAP backlog).
**Filed:** 2026-04-30 (v0.5.3 smoke walk OTHER NOTES).

**Why held until 17e:** the same machinery 17e ships for the
script opt-in dialog (H8) reads the file's `<head>` at open time
and decides a sandbox/routing property based on what it finds.
ENH-027 piggybacks naturally — same `<head>` peek, same routing
gate, same sidecar persistence model. Doing ENH-027 first means
either (a) building a temporary single-purpose meta-reader that
17e then has to absorb, or (b) shipping ENH-027 without a path
for users to upgrade their browser-routed pages to scripts-allowed
canvases (the obvious progression). BUG-045 (file:// browser tabs
expose Reveal/Trash — ✅ shipped v0.5.3) closes the immediate
user pain so the wait costs nothing. See § BUG-045 above + the
17e roadmap entry for the bundling rationale.

**Owner observation:** "for local html artifacts, ... (better yet) they should default open in canvas not in browser."

**Today:**
- `duo edit foo.html` → routes via `fileClassifier.ts` → `html-canvas` type → opens in working pane as canvas. ✅ correct.
- Click `foo.html` in navigator → also via classifier → canvas. ✅ correct.
- `duo open foo.html` → resolves to `file://...` URL → calls `browser.openTab()` → opens in **browser pane**, NOT canvas. ❌ inconsistent.

The `duo open` verb was originally designed for URLs (web pages), and the file-path-resolution sugar (`resolveOpenTarget` converts a relative path to `file://`) was bolted on for convenience. But that means the same .html file routes to two different surfaces depending on which verb the agent chose, which leaks an internal distinction the user shouldn't have to know about.

**Design (already in docs/roadmap.html — Help/FAQ backlog):**
A per-file routing declaration via HTML meta tag. Agents/users add `<meta name="duo-open-in" content="browser">` to a file that explicitly needs browser semantics (scripts, full Chromium APIs, navigation, devtools). Default for HTML without the meta = canvas.

**Affected paths:**
- `core/socket-server.ts § case 'open'` — for `file://` URLs ending in `.html`/`.htm`, peek at the file's `<meta>` to decide canvas vs browser. If browser, current behavior. If canvas (or no meta), dispatch via NAV_EDIT-style IPC to the renderer to mount via fileClassifier.
- `renderer/components/fileClassifier.ts` — already returns `html-canvas` for `.html`. Optionally extend to read the meta tag and switch to a `browser` indicator when set, so the click-in-navigator path can also honor it.
- `.claude/skills/smoke-walk/generate.mjs` — add `<meta name="duo-open-in" content="browser">` to the generated HTML so smoke walks continue to land in browser (where their copy-button JS runs). Without this, ENH-027 would break the smoke-walk skill since canvas iframes have no `allow-scripts` (Stage 17e deferred).

**Sequencing decision:** ENH-027 should land before/alongside Stage 17e (per-file allow-scripts opt-in). Until 17e ships, the meta tag is the only escape valve for HTML that needs scripts — agent-generated dashboards, FAQ live-search, smoke walks, mini-tools.

**Cross-ref:**
- docs/roadmap.html § Help/FAQ — established the `duo-open-in` design.
- Stage 17e — allow-scripts opt-in dialog (still deferred). Once shipped, scripts can run in canvas, and `duo-open-in: browser` becomes a narrower escape valve (specifically for full-Chromium APIs, devtools, navigation history).
- BUG-045 — covers the deletable-from-browser case for files that explicitly chose browser semantics.
- `.claude/skills/smoke-walk/` — needs the meta tag once ENH-027 ships, OR a `--browser` CLI flag on `duo open`.

---

### BUG-048: ⌘\` (pane focus toggle) broken after `duo open` shifts focus to a new browser tab

**Status:** ✅ **Fixed v0.5.4 (v3) — root cause was xterm focus-listener race during ⌘\`'s focus reclaim.** Three rounds: v1 added `webContents.focus()` to `openTab`; v2 added explicit `BROWSER_FOCUS_GAINED` IPC push from socket-server. Both helped flip `focusedColumn = 'working'` after `duo open` but neither fixed the race. **v3 is the real fix:** main no longer reclaims OS focus on ⌘\` (it used to do that BEFORE sending PANE_TOGGLE_FOCUS, which fired the xterm helper-textarea's `focus` event in the renderer — that listener flipped `focusedColumn` to 'terminal' as a side effect, poisoning togglePaneFocus's `prev` read). v3: renderer reads its own state via a `focusedColumnRef` that's mirrored alongside React state but bypassed by the xterm focus listener (which now uses `setFocusedColumnSilent`). Renderer asks main to reclaim only AFTER deciding direction. New IPC `PANE_FOCUS_RECLAIM`. v0.5.3-rev3 walk PASS.
**Priority:** Medium (regression in the focus-toggle path; happy-path flow is "agent opens an artifact, user reads, ⌘\` back to terminal to chat")
**Filed:** 2026-05-01 (v0.5.3-rev2 walk #2 — DUO-RELOAD PASS note)

**Owner observation:** "on `duo open`, page opens correctly; and focus shifts to newly opened browser (good!) but then ⌘\` to shift focus back to terminal is broken."

**Hypothesis:** ⌘\` is wired through the app menu accelerator (which beats macOS's built-in "cycle windows" system shortcut) and dispatched via `IPC.PANE_TOGGLE_FOCUS` to the renderer. It's intentionally NOT in `wireKeyForwarding`'s allowlist — so when the WebContentsView has OS focus, the menu accelerator fires anyway. Possible breaks:
1. **OS focus didn't actually leave the renderer.** BUG-042 fix made `webContents.on('focus')` flip `focusedColumn = 'working'`, but maybe OS focus is split (renderer has it for keyboard purposes but the WCV thinks it has it for input-routing). togglePaneFocus's "focus the active xterm" branch runs but the xterm doesn't actually become the keyboard target.
2. **togglePaneFocus reads stale state.** togglePaneFocus is a useCallback in App.tsx; if its closure's `focusedColumn` is stale, the toggle direction could be wrong.
3. **The accelerator path is being preempted.** Some other listener is consuming ⌘\` before the menu fires.

**Diagnosis path (next sprint):**
- Add a `console.log('[togglePaneFocus]', { focusedColumn, activeTabId })` at the top of the handler.
- Reproduce: `duo open https://example.com` → press ⌘\`.
- Check what focusedColumn is at the moment of the toggle, and whether the toggle ran at all.
- Verify the menu accelerator still fires by adding a separate console.log in `electron/main.ts § app-menu`.

**Cross-ref:** BUG-002 (⌘T from browser focus reclaims focus correctly — same family). BUG-042 (browser-pane focus-gained signal — recent fix). DUO-RELOAD (parent walk PASS).

---

### ENH-031: Right-click context menu in markdown editor / browser pane (electron-context-menu)

**Status:** ✅ **Shipped v0.5.4.** Path A as recommended — installed `electron-context-menu` v4 (ESM, loaded via dynamic `await import()` because main bundles CJS). v1 attached only via `app.on('browser-window-created')` which missed WebContentsView's; v2 fix iterates `webContents.getAllWebContents()` at install time AND subscribes `app.on('web-contents-created')` so every WCV (browser tabs) AND the main BrowserWindow (canvas iframes ride on it) gets the menu. Default actions: Cut / Copy / Paste / Select All / Look Up / Spell-check / Inspect (dev only). v0.5.3-rev3 walk PASS.
**Priority:** Medium-High (pre-existing UX gap surfaced during v0.5.3-rev2 walk; users expect Cut / Copy / Paste / Spell-check / Inspect at right-click)
**Filed:** 2026-05-01 (v0.5.3-rev2 walk #2 — STAGE-15.3 FAIL note: "context clicking in markdown editor also does nothing — expected copy/paste/etc actions")

**Today:** Electron renderers don't show a default context menu unless one is explicitly wired up. We never have. Right-click in the markdown editor / canvas / browser pane does nothing — no Cut / Copy / Paste / Spell-check / Inspect. WorkingPane tabs DO show their context menu (BUG-045 / ENH-026 wiring); FileTree rows DO show theirs (BUG-041 / Stage 26 PR 1 wiring). The text-editing surfaces are the gap.

**Implementation paths:**
- **A. `electron-context-menu` npm package** — small dependency that wires `Cut / Copy / Paste / Select All / Spell check / Inspect element` based on what's clicked. Most common Electron pattern. ~5 lines in main.ts to install.
- **B. Custom `webContents.on('context-menu', ...)` handler** — build the menu ourselves with full control over items + ordering. More work but lets us add Atelier-styled items and integrate with `duo` verbs (e.g. "Send to Duo" as a context-menu entry alongside Copy / Paste).
- **C. Renderer-side React context menu** — same pattern as our existing FileTree / WorkingTabStrip context menus. Captures `onContextMenu` events on each editor surface; renders our `<ContextMenu>` component. Most aesthetic consistency, but loses access to Electron's Spell-check infrastructure.

**Recommend Path A for v1** — fastest path to "right-click does the right thing"; B/C as future iterations if we want custom items. Pairs well with **ENH-030** ("copy as plain text") which would slot in as one of B/C's custom items.

**Affected files:**
- `electron/main.ts` — install electron-context-menu OR wire `webContents.on('context-menu')`.
- (Optional) `package.json` if we add the dependency.

**Cross-ref:** STAGE-15.3 walk #2 fail (the symptom that surfaced this). ENH-030 ("copy as plain text" — natural sibling). BUG-045 (right-click on tabs already shipped — sets the design rhyme).

---

### ENH-030: "Copy as plain text" — context menu entry + keyboard shortcut

**Status:** ✅ **Shipped v0.5.4.** Two surfaces: (1) ⌘⌥C in the Edit menu — uses `webContents.getFocusedWebContents()` + `executeJavaScript('window.getSelection?.()?.toString() ?? ""')` to read the selection across markdown editor / canvas iframe / browser WCV, then `clipboard.writeText`; (2) "Copy as Plain Text" prepended to the right-click context menu (when text is selected) via `electron-context-menu`'s `prepend` hook — uses `parameters.selectionText` directly (always plain). v0.5.3-rev2 walk reported terminal-paste rendering issue (em-dash → `<0080><0094>` bytes); v0.5.3-rev3 confirmed root cause is **terminal locale** (LC_ALL/LANG = C/POSIX, often from conda's `(base)` activator), NOT the clipboard write. TextEdit paste round-trips correctly. **Carry-over: ENH-032** (file install/onboarding doc improvement).
**Priority:** Medium (real UX gap — agent and human both want plain-text export from rich content)
**Filed:** 2026-05-01 (v0.5.3-rev2 walk #2 — STAGE-15.3 FAIL note)

**Owner observation:** "new ENH, new action to 'copy as plain text' in menu and with keyboard shortcut" — surfaced while testing the markdown editor's pill / context menu.

**Today:** Default copy in the markdown editor includes formatting (rich HTML clipboard payload). Pasting into a terminal or another markdown editor preserves marks; pasting into a plain-text target requires the user to manually strip formatting (or use a downstream tool).

**Expected:**
- Context menu (right-click in the editor): new entry "Copy as plain text" between Copy and Paste.
- Keyboard: ⌘⌥C (Chrome's "Paste without formatting" is ⌘⇧V; we want a parallel for Copy).
- Behavior: `getSelection().toString()` of the current selection → `navigator.clipboard.writeText(...)`. No formatting marks, no `<>` tags, no markdown syntax — just the visible text.
- Should work in: markdown editor, HTML canvas, browser pane (the page might trap clipboard, but we can fall through to default).

**Implementation sketch:**
- Wire ⌘⌥C in `globalShortcuts.ts` → dispatcher → CustomEvent `duo-copy-plain` → each surface listens.
- For the markdown editor: TipTap's `editor.state.selection` has range; `editor.state.doc.textBetween(from, to, ' ')` returns plain text.
- For the canvas: iframe's `getSelection().toString()`.
- For the browser pane: same, via CDP `Runtime.evaluate('window.getSelection().toString()')` then write to renderer clipboard.
- Context menu: add an entry to whichever menu fires on right-click in editable surfaces. (In the markdown editor today, the BROWSER's native context menu fires; we'd need to override with a custom one OR rely on the keyboard shortcut alone.)

**Cross-ref:** STAGE-15.3 PASS-with-fail observation. Send → Duo (different verb but related semantic — "agent reads my selection plainly").

---

### BUG-046: Working-pane tab cycle has a visible render delay between markdown tabs

**Status:** ✅ **Shipped v0.5.4.** Restructured `WorkingPane` to keep every file-tab renderer mounted permanently and toggle visibility via `display:none` ↔ `display:flex` (mirrors the TerminalPane pattern). Eliminates the per-switch TipTap teardown + re-spin cost. `BrowserRenderer` stays mount/unmount because its singleton `setBounds(1×1)` cleanup is what hides the WCV — keeping it always-mounted would race the bounds push. CanvasTab's `focused` prop now gates on `focused && isActive` so hidden canvases don't fight for focus. v0.5.3-rev2 walk PASS (cycle is now instant).
**Priority:** Low (BUG-038 v4 cycle is functionally correct; this is perceived-performance)
**Filed:** 2026-05-01 (v0.5.3-rev2 smoke walk PASS note on BUG-038)

**Owner observation:** "when ctrl-tab from tab 1 (markdown) to tab 2 (markdown) there is a delay and it takes a second or two for the tab rendering to catch up, which makes it look like it is failing; but after the pause, the tab cycles."

**Hypothesis:** WorkingPane's `activeRenderer` swap dispatches based on `activeWorking.kind`/`id` change. For markdown tabs, the render pipeline is:
1. `setActiveWorking({kind:'file', id})` → React schedules render.
2. WorkingPane reads `activeWorking` → branches into `<MarkdownEditor key={path} ... />`.
3. MarkdownEditor mounts (or re-mounts, since `key={path}` changes), spins up a new TipTap instance, parses the markdown source, hydrates the editor view.
4. First paint happens after step 3 completes — TipTap's `useEditor` is async-ish.

The lag is most visible when both tabs are markdown editors because each tab gets a fresh TipTap instance per current `key={path}` semantics. Switching to a tab that's been rendered before means re-parsing the file from scratch.

**Proposed v1 fix:** Cache the TipTap instance per file id rather than tearing it down on tab switch — keep all open editors mounted but hide the inactive ones via `display:none` (mirror the TerminalPane pattern). Trade-off: more memory usage when many editors are open. Trade-off acceptable for v1 since most users have 2–3 editors open at a time.

**Affected files:** `renderer/components/WorkingPane.tsx` (activeRenderer dispatch), possibly `MarkdownEditor.tsx` (mount-time setup).

**Cross-ref:** BUG-038 (parent — cycle behavior). Same PASS in the v0.5.3-rev2 smoke walk.

---

### ENH-028: ⌘F find-in-page for the browser pane

**Status:** ✅ **Shipped v0.5.4.** Wraps Electron's `webContents.findInPage` API. Renderer-side find-bar lives in BrowserRenderer above the address row (NOT floating over the page — sidesteps BUG-047 occlusion). New IPCs `BROWSER_FIND_START`, `BROWSER_FIND_STOP`, `BROWSER_FIND_RESULT`. App.tsx's `openFind` / `findNext` / `findPrev` now branch by `activeWorking`: `'browser'` → `duo-browser-find-*` events; else → editor's `duo-editor-find-*`. Browser-side ⌘F now also forwards through `wireKeyForwarding` so it works when the page has OS focus (added `f` and `g` to the Duo-shortcut allowlist; `f` gets the focus-reclaim treatment so the find input takes focus). v0.5.3-rev2 walk PASS.
**Priority:** Medium (parity gap — markdown editor has find via ENH-023, browser doesn't)
**Filed:** 2026-05-01 (v0.5.3-rev2 smoke walk PASS note on BUG-044)

**Owner observation:** "'find' is either not present or not working in the browser — this is either a bug or an ENH."

**Today:** ENH-023 / BUG-043 / BUG-044 ship the find-bar for the markdown editor. The browser pane has no equivalent — pressing ⌘F dispatches to the markdown editor's find listener (when one is mounted) but does nothing visible from the browser pane.

**Proposed v1:** Wire ⌘F when the active surface is the browser pane to call `webContents.findInPage(query)` via Electron's built-in API. Add a small inline find-bar UI above the WebContentsView (which would also need to deal with BUG-047's occlusion problem — the find bar would have to live inside the renderer-DOM strip area, not float over the page).

**Affected files:**
- `renderer/keyboard/globalShortcuts.ts` — ⌘F already returns `'openFind'`; the dispatcher would need to branch by pane.
- `renderer/components/BrowserRenderer.tsx` — host the find-bar UI in the address-bar zone.
- `electron/browser-manager.ts` — `findInPage(query, options)` IPC + `webContents.on('found-in-page', ...)` for match-count signal.

**Cross-ref:** ENH-023 (markdown editor find), BUG-044 (paper-cut that surfaced this gap). BUG-047 (occlusion class — affects the find-bar UI placement decision).

---

### ENH-029: Navigator breadcrumb pans right (current folder visible) + bold last segment

**Status:** ✅ **Shipped v0.5.4.** Added a useRef + 2× rAF effect on the Breadcrumb's overflow container that sets `scrollLeft = scrollWidth` on every cwd change, so the active (rightmost) segment is flush with the right edge by default. Last segment renders `font-semibold text-zinc-100` (vs. `text-zinc-400` for earlier segments) — the eye lands on the active folder. Earlier segments still scroll into view via the user's pan gesture. v0.5.3-rev2 walk PASS.
**Priority:** Medium (current behavior shows the wrong end of the path)
**Filed:** 2026-05-01 (v0.5.3-rev2 smoke walk PASS note on ENH-015)

**Owner observation:** "in the current location strip, e.g. `~/Documents/Github/duo`, it defaults to be panned all the way to the left (I can see `~/Documents/`) and I often cannot see the folder that is active in the navigator without panning left. this space should default to be panned all the way to the right (so I can see `.../duo`), with the last element in the path (`/duo`) bolded, and including the CWD dot if that is the CWD."

**Today:** `Breadcrumb.tsx` renders the path segments left-to-right in an overflow-x-auto container. Default scroll position is left (browser default). For a deep path like `~/Documents/GitHub/duo/some/nested/file.md`, the user sees the start of the path (`~/Documents/...`), not the end where the CURRENT folder sits.

**Expected:** the active (rightmost) segment should be flush with the right edge by default; left segments scroll off into "..." truncation as needed. Last segment renders in a slightly heavier weight (bold or accent-tinted) so the eye lands on it. CWD-active marker (existing dot or new) sits beside the last segment when the active terminal's CWD matches.

**Implementation sketch:**
1. `Breadcrumb.tsx` — set the scroll container's `scrollLeft = scrollWidth - clientWidth` on mount and on every path change (a small `useEffect` keyed on the cwd).
2. Add a class to the last segment span so it picks up `font-weight: 600` and the CWD-dot affordance.
3. Apply `text-overflow: ellipsis` on the leading segments OR rely on horizontal scroll + a soft fade-mask on the left edge so users still know there's more path to the left.

**Affected files:** `renderer/components/Breadcrumb.tsx`.

**Cross-ref:** Stage 26 PR 3 item 8 (breadcrumb edit mode — already shipped). ENH-015 (parent — surfaced this during the same smoke walk pass).

---

### BUG-047: WebContentsView occludes renderer-DOM overlays (BUG-006 / BUG-045 class)

**Status:** ✅ **Class closed v0.5.5** — all three child symptoms now have their own fix paths:
- **BUG-045** (file:// browser tab context menu) → fixed via Path B (`setOverlayMuted` mute) in v0.5.4. Menu is brief; mute is acceptable UX.
- **ENH-028** (browser ⌘F find bar) → fixed via Path A (renderer-DOM placement above the WCV bounds) in v0.5.4. Find bar pushes the WCV's content area down via the existing ResizeObserver — no occlusion possible.
- **BUG-006** (Send → Duo pill) → fixed via Path D (CDP injection into the page DOM) in v0.5.5. Pill is part of the page; compositor stacking is moot.

The class summary stays useful as a "if you build a new renderer-DOM overlay over the browser pane, here's the menu of fix paths" reference — the four options (A/B/C/D) above are all still valid for whichever symptom matches.

**Was 🟡 (First fix landed 2026-05-01):** `BrowserManager.setOverlayMuted(boolean)` collapses the WCV to 1×1 while a renderer-DOM overlay is open. WorkingTabStrip uses it for browser-tab right-click (BUG-045 v2). BUG-006 (Send → Duo pill) and ENH-028 (find-bar) still need their own integrations of the same primitive. Filed for follow-up — keep open as a class summary until BUG-006 is closed.
**Priority:** Medium-High (blocks the FIX path for BUG-006 + ENH-028; structural)
**Filed:** 2026-05-01 (v0.5.3-rev2 smoke walk FAIL on BUG-045)

**Owner observation:** From the BUG-045 fail note + screenshot: "context menu is occluded — cannot fully test (renders over the url bar but under the browser content pane; same issue does not occur with the markdown tab context menu)."

**Today (class-summary):** Renderer-DOM overlays (context menus, tooltips, the Send → Duo pill, the eventual browser-pane find bar) are rendered in the renderer's DOM and obey z-index inside that DOM. But `BrowserWindow.contentView` mounts the WebContentsView as a NATIVE subview at the macOS compositor level, which paints OVER any renderer DOM that overlaps the WebContentsView's bounds. Z-index in the renderer is meaningless against a native subview — the OS composites the WCV on top.

**Affected today:**
- **BUG-006** (Send → Duo pill on browser pane): pill is portaled to body with `z-index:50`, invisible because it sits over the WCV bounds.
- **BUG-045** (file:// browser tab context menu): menu pops up over the right-clicked tab; the menu extends below the strip into the WCV bounds, so its lower half is hidden.
- **ENH-028** (browser-pane ⌘F find bar): same problem if the find bar floats over the page.

**Fix options (each is a v2 candidate; not all need to ship):**
- **A. Position-aware overlay placement.** Detect when the cursor / anchor is in the WCV-bounds and clamp the overlay so it stays inside the renderer-DOM area (above the WCV's top edge — the strip + address bar zone). Cheap; covers context menus that are short. Doesn't help long menus or pills that need to follow page-level coords.
- **B. Shrink WebContentsView while the overlay is open.** Temporarily resize the WCV bounds so the overlay area becomes renderer-DOM. Causes a visible content reflow / scrollbar flash on the page, which is bad UX.
- **C. Render overlays via a separate frameless BrowserWindow.** Each overlay (menu / pill / find bar) becomes its own tiny window positioned at the cursor / anchor. macOS composites windows over WCV. Heavy but most flexible.
- **D. CDP-injected DOM into the page.** Inject the overlay HTML directly into the WCV's page DOM via CDP. The page composites with itself, no occlusion. Most invasive (requires CDP write access + sanitization), but matches how the existing canvas-comments rail anchors content into the iframe.

**Recommend Path A as the v1 fix** — it's the smallest scope, addresses BUG-045's reported symptom directly (and BUG-006 partially), and doesn't preclude C/D as future upgrades for richer overlays. Filed alongside BUG-045 / BUG-006 / ENH-028 as the systemic carry-over.

**Affected files:**
- `renderer/components/ContextMenu.tsx` (clamp logic — already does some viewport-edge handling per BUG-029; extend to WCV-aware clamping).
- `renderer/components/editor/primitives/SendToDuoPill.tsx` (BUG-006 fix landing place).
- `renderer/components/BrowserRenderer.tsx` (find-bar host — ENH-028).
- New helper: a hook / utility that returns "is this y-coordinate inside the WCV?" so all three call sites share the same predicate.

**Cross-ref:** BUG-006 (Send → Duo pill — parent symptom), BUG-045 (context menu — recent symptom), ENH-028 (find bar — anticipated symptom).

---

### ENH-024: Tab strip pans/shifts to keep the active tab visible when overflowing

**Status:** ✅ Shipped 2026-04-30 (v0.5.3 sprint). Both strips (`TabBar.tsx` for terminal, `WorkingTabStrip.tsx` for working) now ref the active `<button>` and call `scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })` in a `useEffect` keyed on the active tab's id. `inline: 'nearest'` is the right primitive — clicking an already-visible tab is a no-op (no spurious horizontal jitter), and a programmatic switch to an off-screen tab smoothly pans it just enough to be visible. Active tab `<button>` accepts a `buttonRef?: React.Ref<HTMLButtonElement>` prop (typed as `Ref<>` not `RefObject<>` for React 19 compatibility); only the active row gets the ref so the assignment naturally rotates as the active id changes.
**Priority:** Medium (the smoke walk surfaced this clearly — the user has 10+ tabs across panes and can't always see the active one without manual scrolling)
**Filed:** 2026-04-30 (smoke-walk follow-up)

**Owner ask:** "Tab strip should pan/shift horizontally to reveal new active tab when more tabs are open than can be shown on screen."

**Today:** Both the terminal tab strip (`renderer/components/TabBar.tsx`) and the WorkingPane strip (`renderer/components/WorkingTabStrip.tsx`) use horizontal `overflow-x: auto` (with the new `scrollbar-none` from ENH-019). When tabs exceed the strip's visible width, the user has to scroll horizontally to find the active one. Selecting a tab via ⌃Tab / ⌘1–9 / programmatic spawn doesn't auto-scroll the strip.

**Expected:**
- When the active tab is not in the strip's visible range, scroll it into view smoothly (e.g. `element.scrollIntoView({ behavior: 'smooth', inline: 'nearest' })`).
- Trigger on every active-tab change AND on tab-strip resize (window resize, pane drag).
- For the very-many-tabs case (50+), the active tab should land at roughly 1/3 from the visible edge for context — not flush against the edge.

**Implementation sketch:**
- Each active tab `<button>` carries a ref or `data-active="true"` attribute; on `useEffect` that depends on `activeTabId`, find that element and `scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })`.
- Two strips, two implementations — small enough to inline in each component, OR extract a `useScrollActiveIntoView(activeId, getEl)` hook that both consume.
- Verify the scroll doesn't fight ⌃Tab cycle's keyboard timing — debounce or trigger after the React render flushes.

**Cross-ref:** ENH-019 (scrollbar suppression — pairs with this; once we suppress the scrollbar we MUST handle pan-to-active ourselves since users can't manually scroll). Stage 24 (pinned tabs — pinned tabs should always be visible regardless of pan; consider sticky-positioning them).

---

### ENH-025: `⌘[` / `⌘]` for outdent / indent in the markdown editor

**Status:** ✅ Shipped 2026-04-30 (v0.5.3 sprint). New `ListIndentShortcuts` TipTap extension at `renderer/components/editor/extensions/ListIndentShortcuts.ts` binds `Mod-]` → `sinkListItem` and `Mod-[` → `liftListItem`. Tries `taskItem` first (TaskList) then `listItem` (bullet/ordered). Outside a list, returns false → keystroke bubbles to the global matcher. Plain `⌘[` / `⌘]` aren't in the global registry (only `⌘⇧[` / `⌘⇧]` are claimed for prev/next terminal tab), so non-list strokes fall through harmlessly. Browser back/forward nav was already suppressed by `wireKeyForwarding`'s `[`/`]` allowlist, so we don't disturb other surfaces.
**Priority:** Medium-Low (Google-Docs-style muscle memory; missing today is a friction point for long-form list editing)
**Filed:** 2026-04-30 (post-sprint)

**Owner ask:** "Add handling for `⌘[` / `⌘]` for tab in/outdent."

**Today:** The markdown editor uses TipTap StarterKit which supports `Tab` / `Shift+Tab` to indent / outdent inside a list item. Outside a list, `Tab` types a literal tab character (or maybe nothing). `⌘[` and `⌘]` are unbound — they default to browser navigation (back / forward) which has no meaning inside an editor.

**Expected:**
- `⌘]` → indent (sinkListItem) when caret is in a list item.
- `⌘[` → outdent (liftListItem).
- For non-list paragraphs: probably no-op (or, optionally, indent/outdent via `blockquote`-wrap unwrap — defer to v2 and treat as scope creep).

**Implementation sketch:**
1. `renderer/keyboard/globalShortcuts.ts` — register the two chords. They're meaningful ONLY inside the markdown editor; we don't want global ⌘[ to swallow browser-pane back-nav.
   - Option A: register globally, dispatcher checks `activePaneFocus` and only fires inside markdown surface.
   - Option B (better): handle in the markdown editor's TipTap keymap directly via `addKeyboardShortcuts`. Doesn't need the global registry at all. Mirrors how StarterKit's Tab / Shift+Tab work.
2. Extend `MarkdownEditor.tsx`'s extension list with a small `Extension.create({ addKeyboardShortcuts })` that maps `Mod-]` and `Mod-[` to TipTap's `sinkListItem(listItem)` / `liftListItem(listItem)` commands (passing the `listItem` node type from the schema).

**Cross-ref:** Stage 11 (markdown editor home). ENH-005 (toolbar editor actions — consider exposing these on the toolbar too).

---

### ENH-026: Right-click on a WorkingPane tab → rename / delete / reveal in navigator

**Status:** ✅ **v1 verified working on real canvas tabs 2026-04-30 (v0.5.3 sub-sprint).** Closed by BUG-045's separate fix. Diagnosis: the user's "html canvas" failure during the v0.5.3 smoke walk was actually about the smoke walk page itself, which opens in the BROWSER pane (via `duo open`), not the canvas pane. Verified directly via computer-use: created a real canvas tab via `duo html new` + `duo edit`, right-clicked the tab, menu shows Reveal in navigator / Rename… / Pin tab / Move to Trash… correctly. ENH-026 v1 was always right for genuine canvas tabs; the user's grouping ("html canvas / browser showing local html") conflated two distinct surfaces. BUG-045 closed the browser-tab-with-file-URL case; the canvas case never broke.

**Was 🟡 (Partial ship — re-opened 2026-04-30 from v0.5.3 smoke walk):** User reported the menu fires correctly on markdown editor tabs, but didn't fire on HTML canvas tabs (and as expected, browser tabs viewing local HTML only show Pin/Unpin, which is correct).

Diagnosis hypothesis at filing time:
- `WorkingTabStrip.tsx § handleContextMenu` reads `tab.path ?? null`. The expectation: HTML canvas tabs are file tabs and have `path` populated.
- Most likely: the canvas tab's `WorkingTab` projection in `WorkingPane.tsx § mergedTabs` is dropping `path`, OR the FileTab type for canvases doesn't have `path` set, OR the canvas onContextMenu is being intercepted elsewhere (CanvasTab.tsx might preventDefault on right-click before it bubbles).
- Quick repro path: log `tab` inside `handleContextMenu` for a canvas tab; if `tab.path` is undefined, follow the chain back to where it should have been set.

**v1 (shipped, partial):** `WorkingTabStrip.tsx` extended with `buildTabContextMenuItems`. File-bearing tabs get **Reveal in navigator** (selects + scrolls + expands via `nav.actions.navigateTo` + `selectItem`), **Rename…** (reveal + dispatches a `duo-tree-start-rename` CustomEvent that `FileTree.tsx` listens to and transitions the row to rename mode — avoids lifting `renamingPath` state up to App.tsx), and **Move to Trash…** (dedicated confirm dialog `confirmTrash` separate from the pinned-close confirm; on confirm runs `files.trash` + `closeFileTab`). Browser tabs only see Pin/Unpin (existing behavior). Pin/Unpin remains for file tabs too — symmetry with Stage 26 PR 2.
**Priority:** Medium (Stage 26's right-click context model from the navigator should extend to the tab strip — paired affordance)
**Filed:** 2026-04-30 (post-sprint)

**Owner ask:** "Right click on tab — can rename, delete, or reveal file in navigator."

**Today:** The WorkingPane tab strip (`renderer/components/WorkingTabStrip.tsx`) renders tab chips with no right-click context menu. Stage 26 PR 1 (v0.5.0) shipped right-click context menus for the navigator's file rows (rename / move-to-trash); the tab strip was out of scope.

**Expected (v1):**
Right-click on any WorkingPane tab → context menu with:
- **Rename** → flips the tab's underlying file path via `files.rename(oldPath, newPath)`. Same UX as the navigator rename: inline `RenameInput` on the tab chip itself, OR (simpler) prompt-based rename (which we know is broken in renderer — see ENH-016 hotfix; reuse the create-default-name + auto-rename pattern... actually simplest is a single-shot dialog modal).
- **Move to Trash** → `shell.trashItem` via the existing `files.trash` IPC. Confirm via single-click ("Move to Trash…" with ellipsis + tip) since it's recoverable from Finder.
- **Reveal in navigator** → `actions.navigateTo(parentDir(path))` + `selectItem(path)` so the file lights up in the tree (and the navigator pane scrolls / expands as needed).

**Optional:** Pin/Unpin (already exists via the click-pin glyph; could add as a context-menu entry for symmetry with Stage 26 PR 2 nav pins).

**Implementation sketch:**
- New `onContextMenu` handler on the tab `<button>` in `WorkingTabStrip.tsx`.
- Reuse `ContextMenu` primitive from `renderer/components/ContextMenu.tsx`.
- `buildMenuItems` factored out of `FileTree.tsx` could become a shared utility — though the tab strip's menu has different items, so simpler to write a fresh `buildTabMenuItems` here.

**Cross-ref:** Stage 26 PR 1 (navigator right-click — established the pattern). ENH-016 (renderer prompt is broken; learn from that and use inline rename or modal).

---

### ENH-032: Document terminal-locale requirement in install / onboarding

**Status:** ✅ **Shipped v0.5.5** — two surfaces. (1) New FAQ entry "Why do special characters look broken when I paste into the terminal?" — diagnostic command + fix recipe (export LANG/LC_ALL after conda init). (2) `duo doctor` now includes a Locale section that probes `$LC_ALL`/`$LC_CTYPE`/`$LANG` and prints a fix recipe if none look UTF-8. Cross-references the FAQ entry. Walk-1 verified PASS — owner's `(base)` shell triggered the warning correctly (2026-05-01).
**Priority:** Medium (silent paper-cut for users with conda or non-UTF-8-default shells)
**Filed:** 2026-05-01 (v0.5.4-rev3 walk — ENH-030 PASS-with-question)

**Owner observation:** "should we add to the duo setup procedures/install?" — surfaced after the v0.5.4-rev3 walk confirmed that ENH-030's "Copy as Plain Text" feature works correctly (TextEdit paste round-trips), but pasting multi-byte UTF-8 (em-dash, ⌘⌥, etc.) into terminals shows raw bytes (`<0080><0094>`) when the shell's locale isn't UTF-8. Most common cause: conda's `(base)` activator inheriting `LC_ALL=C` or unset locale.

**Today:** Duo install / onboarding docs (the FAQ, the welcome banner, what-duo-does.html) don't mention terminal locale. A user paste-failing into their terminal can't tell whether the bug is in Duo's clipboard write or their shell — and Duo can't actually fix the shell.

**Expected:**
1. Add a short FAQ entry: "Why do special characters look broken when I paste into the terminal?" — points to `locale | grep LC_`, suggests `export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` in shell rc-file (after conda init), notes this affects ANY paste source on the user's machine, not just Duo.
2. Optional: have `duo doctor` warn if the running PTY's `LC_ALL` / `LC_CTYPE` looks non-UTF-8. Cheap detection — just check the env var.
3. Optional: install-time hint banner in `~/.claude/duo/install/install.md` (or wherever the welcome lives) noting the conda gotcha.

**Affected files:**
- `help/faq.html` — new question.
- `cli/duo.ts` § doctor case — env-var check.
- `~/.claude/duo/welcome` (if such a file exists) — banner copy.

**Cross-ref:** ENH-030 (parent — Copy as Plain Text). The fix isn't in Duo's clipboard write; it's environmental documentation.

---

### ENH-033: Build-version badge in titlebar

**Status:** ✅ **Shipped v0.5.4** (filed-as-shipped — landed during the v0.5.4 sprint as a smoke-walk-prep enhancement).
**Filed:** 2026-05-01 (v0.5.4 walk #2 — owner observation: "need to show current build number somewhere in app so I can be sure I am smoke walking the right build")

**What shipped:** Glanceable badge at the top-right of the titlebar (left of the theme toggle) showing `<version>` with a `·dev` suffix in accent color when `!app.isPackaged`. Reads from `app.getVersion()` in main → passed to renderer via `webPreferences.additionalArguments` (`--duo-app-version=…`, `--duo-is-dev=…`) which the preload parses out of `process.argv` and exposes as `window.electron.env.appVersion` / `.isDev`. Hover tooltip shows the full label (e.g. `Duo 0.5.4 (dev)`).

**Cross-ref:** Smoke-walk skill SKILL.md § Step 2 precondition (verify package.json matches manifest version). Cut-version skill § Step 7 (post-cut bump, added in same sprint to keep the badge and walk filenames aligned).

---

### BUG-050: ContextMenu occluded by editor canvas (renderer-DOM stacking)

**Status:** ✅ **Shipped v0.5.5** — `ContextMenu` now portals to `document.body` (was rendered inline at the call site, which inherited any ancestor stacking context — `overflow-x-auto` strip, TipTap editor's own context, etc.). z-index bumped to 1000 for safety. Different root cause from BUG-047 (WCV native subview): this one is renderer-DOM-only and would have shown on any element that creates a local stacking context above the menu's call site. Walk-2 verified PASS (2026-05-01).
**Priority:** Medium (visible UX bug — context menu was unusable on markdown editor tabs)
**Filed:** 2026-05-01 (v0.5.5 smoke walk — BUG-049 PASS note)

**Repro:** Right-click a markdown editor tab in the working pane strip. Context menu items render in the strip area but the lower portion drops behind the editor canvas. Same visual symptom as BUG-045 / BUG-047 (browser pane right-click) but a totally different root cause — no WCV is involved here, just renderer-DOM z-index / stacking-context layering.

**Why this slipped past v0.5.4 BUG-045 fix:** BUG-045's fix was the `setOverlayMuted` WCV-collapse trick, which only addresses native-subview occlusion. The markdown editor isn't a WCV — it's TipTap, renderer-DOM. So the BUG-045 fix didn't cover this case, and the smoke walks for v0.5.4 / earlier didn't exercise right-click on markdown tabs (we tested browser tab right-click but not editor tab).

**Cross-ref:** BUG-047 (class summary — closed v0.5.5 for browser-pane occlusions; BUG-050 is the renderer-DOM analog and stays separate).

---

### ENH-034: Canvas edit-mode toggle + `<meta name="duo-default-editable">` convention

**Status:** ✅ Shipped v0.6.0 (Stage 27). `<meta name="duo-default-editable" content="true|false">` parsed in `files-service.ts § getHtmlMeta`; `CanvasTab` reads the meta hint to seed initial `readOnly` state; per-tab toolbar pencil/eye toggle persists locally via localStorage per file path; skill docs updated alongside the routing meta. Walk-2 V11 + V12 PASSed against `~/.claude/duo/stage-27-walk.html` which sets the meta to `false`.
**Priority:** Medium (UX gap — canvas is currently always-editable, which traps button clicks as cursor placements on interactive HTML)
**Filed:** 2026-05-01 (v0.5.5 walk-2 — smoke walk page Copy-results button trapped by contenteditable)

**Two distinct conventions in flight, neither sufficient on its own:**

1. **`<meta name="duo-open-in" content="browser|canvas">`** (already shipped) — routing-only: which surface should render this file. Used by `App.tsx § openFileSmart` and `files-service.ts § getHtmlMeta`. Solves the smoke walk problem (force browser routing for any HTML page that has interactive buttons but isn't meant to be edited).

2. **`<meta name="duo-default-editable" content="true|false">`** (this ENH) — within-canvas mode: should the canvas open in edit mode or read-only mode? Default: `true` (matches today's behavior for backward compat).

**Why both are needed:**
- `duo-open-in` is binary routing — browser pane (no rich Duo affordances, just a webview) vs canvas pane (rich rendering + comment rail + Send → Duo + agent ops + autosave on edit).
- `default_editable` is internal canvas state — you might *want* a file in canvas (for the rich affordances) but *not want* it editable on first load (read-only review of a peer's HTML draft, agent-generated dashboard you want to interact with click-wise but not accidentally type into, templates / reference docs).

**Scope (this ENH):**
1. Read `<meta name="duo-default-editable">` in `getHtmlMeta` → extend `HtmlFileMeta` shape with the field.
2. CanvasTab: extend `readOnly` state to take initial value from the meta hint (today: only path-untrusted files are read-only).
3. Toolbar button: edit-mode toggle (pencil icon → eye icon when locked). Persists locally via `localStorage` per file path so the user's choice sticks across sessions but doesn't write back to disk.
4. Skill update (`skill/SKILL.md` + `agents/duo.md` cheat-sheet): document both conventions side-by-side so agents know which to emit:
   - `duo-open-in` for routing
   - `duo-default-editable` for canvas-mode

**Out of scope (smoke-walk piece — solved by `duo-open-in`):**
The smoke walk page now emits `<meta name="duo-open-in" content="browser">` (v0.5.5 generator patch) so the Copy-results button works regardless of how the user opens the file. ENH-034 is no longer needed for that workflow.

**Cross-ref:** `duo-open-in` (already shipped — see `files-service.ts § getHtmlMeta`); FEATURE_AUTO_INJECT_IDS in `shared/feature-flags.ts` (related — both are about gating canvas-mode auto-behaviors that don't fit every file).

---

### ENH-035: "Copy path" on working-pane tab right-click context menu

**Status:** ✅ Closed as duplicate of ENH-074 — shipped v0.6.3 (commit during walk-2 polish in `fb51b46`). The "Copy path" menu item landed via ENH-074's tab-context-menu addition; this earlier ENH-035 tracker stayed open by accident. Any future iteration on the gesture (e.g. "Copy URL" branch for http(s) browser tabs) gets a fresh entry.
**Priority:** Medium (small UX paper-cut, but compounds: the agent + the user both regularly need the path of the active tab to drop into a CLI command, a chat, a file reference)
**Filed:** 2026-05-02 (Stage 27 smoke walk — owner asked for it after right-clicking a tab and not finding "Copy path")

**Repro:** Right-click any working-pane tab (file or browser) → no "Copy path" option appears. The current right-click menu has Pin / Unpin / Reveal / Rename / Trash for file tabs and Pin / Unpin / Reveal / Trash for `file://` browser tabs. To get the absolute path today the user has to either (a) read it from the navigator after Reveal-In-Navigator, (b) copy from the browser's URL bar (browser tabs only), or (c) hover the tab and read the tooltip — all friction.

**Scope:**
1. Add a "Copy path" menu item to the right-click context menu for ALL working-pane tabs (file tabs + browser tabs whose URL is `file://...`).
2. For browser tabs whose URL is `http(s)://...`, the entry reads "Copy URL" instead.
3. Click writes to the system clipboard via `clipboard.writeText` — same path as ENH-030 ("Copy as Plain Text").
4. Optional: a one-shot toast confirmation ("Path copied"). Defer if the menu's silent-on-success pattern matches everything else.

**Why both files + URLs:** unifies the "tab → identifier on clipboard" gesture. Any tab right-click → top-of-menu "Copy <thing>" works.

**Files:** `renderer/components/WorkingTabStrip.tsx` (where the per-tab menu is built — see existing Pin / Reveal / Trash entries).

**Cross-ref:** ENH-030 (Copy as Plain Text in browser context menu — same `clipboard.writeText` pattern); the file-tab Reveal entry already gives access to the underlying path so the data is already known per-tab.

---

### BUG-051: Read-only toggle stuck — toggle off → on → off leaves canvas editable

**Status:** ✅ **Shipped v0.6.0.** Fix in `renderer/components/HtmlCanvas/RenderedCanvas.tsx § wire()` — added an explicit `else` branch that clears `contenteditable` / `spellcheck` / `data-duo-canvas-runtime` attributes from `doc.body` and blurs the active element on re-mount under `readOnly: true`. Without this branch, the effect's `wired` flag was reset every effect-run but `wire()` only ADDED edit-mode attributes; it never removed them when `readOnly` flipped back to true.
**Priority:** **High — interferes with smoke walk + any read-only canvas the user tries to interact with after temporarily editing**
**Filed:** 2026-05-02 (Stage 27 smoke-walk in flight; user reported the toggle ratchets the wrong way)

**Repro (pre-fix):**
1. Open a canvas with `<meta name="duo-default-editable" content="false">` (e.g. `~/.claude/duo/stage-27-walk.html`). Mounts read-only as expected.
2. Click "Edit" in the toolbar strip → flips into editable mode (toolbar appears, cursor lands on click). Correct.
3. Click "Back to read-only" → label goes away (UI says read-only), BUT the canvas body remained editable. Click anywhere → cursor landed. **Bug.**

**Expected:** flipping to "read-only" should fully revert the canvas to read-only state — no cursor placement, no contentEditable, identical to first-mount behavior.

**Root cause:** `RenderedCanvas`'s wiring effect has `readOnly` in its dep array, so it re-fires on every toggle. Cleanup correctly disconnects the MutationObserver and removes keydown/mousedown listeners. But `wire()` ONLY sets edit-mode attributes (`contenteditable="true"`, `spellcheck="true"`, `data-duo-canvas-runtime="1"`) inside the `if (!readOnly)` branch — it never removes them. So a `false → true → false → true` cycle:
- First mount under `readOnly: false` → attributes set on body. Body is editable.
- Toggle `false → true` → effect re-runs. Cleanup removes listeners. New `wire()` skips the `!readOnly` block. **Body stays `contenteditable="true"`.** UI says read-only; reality says editable.
- Toggle `true → false` → re-runs `wire()`'s `!readOnly` block, no-ops because attributes are already set. Looks fine, but the canvas was never actually read-only in step 2.

**Fix:** explicit `else` branch in `wire()` removes the three runtime attributes from body and blurs the active element so any leftover cursor placement clears. The runtime `<style data-duo-canvas-runtime>` (containing the goto-flash keyframes) stays — it's needed in both modes for `duo doc goto --anchor X` to flash on read-only canvases.

**Smoke walk impact:** owner hit this mid-walk; the canvas they were trying to drive (smoke-walk page itself, in canvas mode) became uneditable-but-not-actually after a flip cycle. Can interfere with click handlers when contentEditable traps clicks as cursor placement.

---

### ENH-037: `⌘W` should NEVER close the parent window — only the focused tab

**Status:** ✅ **Shipped v0.6.0 (this ENH).** Window menu's `{role: 'close'}` had its default `CmdOrCtrl+W` accelerator overridden to `CmdOrCtrl+Shift+W` (matching Chrome's convention). Plain `⌘W` is now reserved entirely for the renderer's `closeTab` action in `renderer/keyboard/globalShortcuts.ts § 'closeTab'`.
**Priority:** **High — data loss bug.** Owner lost ~20 minutes of smoke-walk notes typed into the smoke-walk page's textareas when ⌘W on a tab triggered window close instead of tab close. Form data was DOM state, never persisted; browser-tab close took it with it.
**Filed + shipped:** 2026-05-02 (mid-Stage 27 smoke walk)

**Repro (pre-fix):**
1. Open Duo, get into a state with multiple working-pane tabs
2. Click into a focused tab (say a browser tab with form data typed in)
3. Press `⌘W`
4. **Expected:** the focused tab closes; the window stays
5. **Actual:** Both Electron's `BrowserWindow.close()` (auto-bound to ⌘W via `Window > Close` menu role) AND the renderer's `closeTab` shortcut fire. Result: window closes, all working-pane tabs gone, all form data lost.

**Root cause:** Electron's `{role: 'close'}` menu item has a default accelerator of `CmdOrCtrl+W`. When the renderer's keydown handler matches and runs `closeTab`, it doesn't preventDefault all the way to the OS-menu accelerator path — both fire.

**Fix:** explicit accelerator override in `electron/main.ts § installAppMenu`:

```ts
{ role: 'close', label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W' }
```

Three things this earns us:
- ⌘W is now exclusive to tab-close (renderer-handled).
- ⌘⇧W matches Chrome's "close window" convention (familiar muscle memory).
- Users who want to close the whole window still can — just on the new key combo.

**Edge cases verified:**
- ⌘W with no tabs: renderer's closeTab is a no-op; window stays.
- ⌘W on a pinned tab: renderer's PinnedCloseConfirm dialog still fires (its existing logic).
- ⌘Q for "Quit Duo" remains unchanged in App menu.
- Multiple windows: ⌘⇧W closes the currently-focused window only (Electron `role: 'close'` semantics).

**Why we got bitten by this:** the bug was always present — the renderer's closeTab handler was added in Stage 24 (pin gating) on the assumption that it was the only ⌘W binding. Nobody hit it during dev because nobody ⌘W'd a tab while having unsaved form state in another tab. The smoke-walk page (with its textareas full of pasted-back walk notes) was the first surface where the data loss became visible.

**Cross-ref:** Stage 24 (pin gating + tab-close confirm); `renderer/keyboard/globalShortcuts.ts § 'closeTab'` (where ⌘W is matched on the renderer side); `electron/main.ts § installAppMenu` (where the menu accelerator override lives now).

---

### ENH-036: `duo open <url>` should bring the working pane to focus on the new tab

**Status:** ✅ **Shipped v0.6.4** (Sprint 3 sweep wave 2, 2026-05-03). One-line fix in `renderer/App.tsx`: the existing `BROWSER_FOCUS_GAINED` IPC handler (which fires when `duo open` lands on a browser-routed URL OR when the user clicks into the browser pane) was only flipping `setFocusedColumn('working')` — the column flag — but NOT the `activeWorking` slot. So if the working pane was showing a canvas/editor tab, the new browser tab landed in the strip but the working pane kept rendering the previous kind. Added `setActiveWorking({ kind: 'browser' })` alongside the focus flip; idempotent on click-into-browser (BUG-042 source — already 'browser' there). Mirrors Stage 23 canvas-action `browser:open`'s effect (lines 827-828, 804-805) which already does the right thing.
**Priority:** Medium (functional: `duo open` is broken-by-default for the most common "show the user this URL" intent; user has to manually click the new browser tab to actually see it)
**Filed:** 2026-05-02 (Stage 27 smoke walk — `duo open` of the smoke-walk HTML created the browser tab but the working pane stayed on the canvas surface; user couldn't see the page until they manually clicked the new tab in the strip)

**Repro:**
1. Have a canvas / file tab active in the working pane (any non-browser working-pane state).
2. Run `duo open <some-url>` from a terminal.
3. **Expected:** the new browser tab is immediately visible — the working pane flips to browser mode AND the new tab is the active browser tab.
4. **Actual:** the browser tab is added (visible in `duo tabs`, `isActive: true`) but the working pane stays on whatever it was. User has to scroll the tab strip and click the browser tab to see the page they just opened.

**Why this matters:** `duo open` is the canonical CLI verb for "show the user this URL." Every other interpretation (just queue it without showing it) is a footgun. An agent helping a PM saying "open this thing" expects Duo to actually display it.

**Same root cause might apply to:**
- `duo edit <path>` for file tabs (does it auto-switch the working pane to file mode if a browser was active?) — needs verification.
- `duo navigate <url>` against a hidden browser pane — does it surface the URL change?

**Scope:**
1. `duo open` (browser.addTab path): main process should trigger the same `setActiveWorking({kind:'browser'})` + activate-tab side effect that the canvas-action `browser:open` verb does in App.tsx's handleCanvasAction.
2. `duo edit` (file open path): symmetric check — if the working pane is currently on browser, the new file tab should bring the working pane to file mode.
3. Audit `duo open --background` style flag for callers who explicitly want to queue without focus (rare; defer to a v2 follow-up if it surfaces).

**Files:** `core/socket-server.ts` § `case 'open'`, `electron/browser-manager.ts § addTab`, `renderer/App.tsx` (whichever surface flips activeWorking).

**Cross-ref:** Stage 23 canvas-action `browser:open` already does the right thing (App.tsx handleCanvasAction sets activeWorking + setFocusedColumn). That's the model — extend the same effect to the CLI path.

---

### ENH-038: Smoke-walk page should localStorage-persist textarea contents while walk is in progress

**Status:** ✅ Shipped v0.6.3
**Priority:** **High — data-loss-defense.** Owner just lost ~20 min of typed walk notes when ⌘W collapsed the window (root cause was ENH-037; THIS ENH is the defense-in-depth so the next mishap doesn't lose data either).
**Filed:** 2026-05-02 (mid-Stage 27 walk-2)
**Shipped:** 2026-05-02 — `.claude/skills/smoke-walk/generate.mjs` now injects per-version localStorage persistence (`smoke-walk:${version}` key). `captureState()` serializes per-item radio + notes textarea + the misc-notes block; debounced `saveSoon()` (250ms) writes on every input/change anywhere in the page. `applyState()` restores on load — silently no-ops on corrupt JSON. New "Clear saved walk" `btn-ghost` button next to "Copy results" wipes the storage key + resets the form (with confirm to prevent accidental nuke). Storage key is per-version so different walks don't restore each other's state. Cross-Duo-restart-safe because Electron persists localStorage in browser tabs by default. Verified by generating a test manifest — 13 references to STORAGE_KEY/btn-ghost/saveSoon/applyState/clear-saved present in output.

**Why both ENH-037 + this:** ENH-037 plugs the specific cmd+W bug. But the smoke-walk page is the surface where the user types many minutes of structured feedback into many textareas. Any unanticipated mishap — accidental refresh, dev-server crash, OS sleep + lid-close interruption, the page being closed and reopened to test something — will lose that work. The page is meant to ferry walk results; losing them mid-walk is the failure mode.

**Scope:**
1. Each textarea (per-item notes + the misc-notes block at the bottom) writes its current value to `localStorage` on every input event (debounced ~250ms to avoid storage churn).
2. Pass/Fail/Skip toggle state for each item also persists.
3. On page load, restore from `localStorage` if present (the page's URL plus the manifest version is the storage key — so stage-27-rev1 walk doesn't restore stage-28-rev1's state).
4. "Copy results" button has a sibling "Clear saved walk" affordance (small, less-prominent button next to it) the user clicks AFTER pasting back to me, to reset state for the next walk.
5. After a successful copy, the page can show a toast: "Saved walk persisted in localStorage. Click 'Clear saved walk' when you've pasted into your agent's chat."

**Where this lands:** `.claude/skills/smoke-walk/generate.mjs` — embed the persistence JS into the generated HTML. Self-contained; no Duo wiring needed (browser-tab JS works).

**Edge cases:**
- localStorage quota: a single smoke-walk page's textareas easily fit under 5MB. Don't need eviction logic.
- Multiple smoke walks in flight (different versions): per-version storage keys keep them isolated.
- Cross-Duo-restart: localStorage in browser tabs IS persisted by Electron's session, so a Duo restart preserves the state — exactly the property we want.

**Cross-ref:** ENH-037 (root cause of THIS instance of data loss); the smoke-walk skill at `.claude/skills/smoke-walk/SKILL.md` (where we should add a "warning: in-flight notes are localStorage-persisted; click Clear after copy" line once this ships).

---

### ENH-039: Smoke-walk page paths should be clickable links — open the file in editor or reveal in navigator

**Status:** ✅ **Shipped v0.6.4** (Sprint 3 Phase 1, commits `4baba8b` for tilde expansion and `f7ff1fe` for per-page split-routing meta). Picked **Option 3 (CDP injection)** — the `BrowserManager`'s CDP bridge installs a `PATH_LINK_FORWARDER_IIFE` that gates on `location.protocol === 'file:'`, dispatches `[data-duo-path]` clicks via a `duoOpenPath` / `duoOpenPathSplit` binding back to main, and main routes through `sendEdit` / `splitViewOpen` (the same destinations the navigator double-click and `duo open` use). Tilde paths (`~/.claude/duo/...`) are expanded in main before the routing call. Smoke-walk pages opt into split-pane routing via `<meta name="duo-path-target" content="split">` (or per-link `data-duo-target="split"` override) so walk steps' link clicks land in the aux pane while the walk itself stays in the main pane. Live-verified PASS in Sprint 3 walk (2026-05-03). Generator updated in `.claude/skills/smoke-walk/generate.mjs` to emit the meta + wrap paths in path-links.
**Priority:** Medium (UX paper-cut — paths in walk steps are currently `<code>` decorative; the user has to retype them into a terminal to actually use them)
**Filed:** 2026-05-02 (Stage 27 walk-2 owner request)

**What's wanted:** any `~/.claude/duo/whatever.md`, `~/notes/...`, or absolute path that appears in a walk step's text should render as a clickable link. Click → either opens the file in Duo's working pane (preferred default for files the user wants to inspect / edit), or reveals it in the navigator (alternative when the user wants to see WHERE it is, not the contents).

**Discovery — the implementation can't be obvious:**
The smoke-walk page renders in BROWSER mode (`<meta duo-open-in="browser">` so the Copy button's `navigator.clipboard.writeText` works). Browser tabs do NOT carry the canvas-action `data-duo-action` delegation. So a click on a `<a data-duo-action="editor:open" data-path="...">` is inert in browser mode.

**Three implementation options to choose from when this is fleshed out:**

1. **`duo://` URL scheme handler.** Register a custom protocol in Electron main (`protocol.handle('duo', ...)`) that parses `duo://open?path=...` / `duo://reveal?path=...` and dispatches via existing `sendEdit` / `sendReveal` helpers. Cleanest semantically; requires careful permission scoping (any browser tab — including arbitrary websites the user has open in Duo's browser pane — could in theory click a `duo://...` link, so the protocol handler MUST validate origin or restrict to file:// pages). Highest setup cost.

2. **Local HTTP endpoint.** Main process opens a localhost HTTP server bound to 127.0.0.1 + per-launch token (mirrors the existing TCP fallback for the CLI). Smoke-walk page does `fetch('http://localhost:<port>/duo-cli', { body: { cmd: 'edit', path: '...' } })`. Reuses existing socket-server protocol. Adds a 4th bound port to the app — manageable but real.

3. **Browser-pane CDP injection.** The renderer's `BrowserManager` already attaches CDP. It could inject a small `window.duo` JS object into pages that match a Duo-trusted origin (e.g. file:// paths under `~/.claude/duo/`). Smoke-walk page calls `window.duo.openPath('...')`. Like the canvas-action trust gate but for browser-pane pages. Most consistent with Duo's existing trust model.

**Lean toward Option 3 (CDP injection)** — it parallels Stage 15.2's existing `Runtime.addBinding` selection-observer injection and Stage 27's BUG-006 in-page pill. Same tooling, same trust gate, same domain. New `window.duo.openPath(path)` / `window.duo.revealPath(path)` API.

**Generator change:** `.claude/skills/smoke-walk/generate.mjs` — when emitting a step's text, regex-match `~/...` or `/Users/...` style paths and wrap each in `<a class="duo-path-link" data-path="...">`. The injected `window.duo` object listens for clicks on `[data-path]` elements and dispatches.

**Cross-ref:** ENH-038 (the other smoke-walk-page enhancement queued); Stage 23 trust gate (model for the in-page injection's trust scope); BUG-006 in-page pill (existing pattern of CDP-side JS injection into trusted pages).

---

### ENH-040: Collapse-pane button — quick toggle to hide terminal column or canvas (right pane)

**Status:** ✅ Shipped v0.6.3
**Priority:** Medium (workflow leverage — when you're in deep on either side, you want the other side fully collapsed for screen real estate)
**Filed:** 2026-05-02 (Stage 27 walk-2 owner request)
**Shipped:** 2026-05-02 — two titlebar buttons next to ThemeToggle, each a toggle for one pane. Click "Hide terminal" → splitPct snaps to 0 (canvas takes full width); click again → restores to `prevSplitPct` (the last drag-set value, or 55% on first launch). Same toggle pattern for "Hide canvas" → 100. Active state inverts to a filled accent-bg pill so it's obvious which pane is currently hidden. New `prevSplitPct` state caches the last in-range value (20–80) via a useEffect that watches splitPct; on collapse we don't write through, so the cache survives to power restore. Programmatic toggle bypasses the drag handler's 20–80 clamp; the divider stays draggable at the edge for users who'd rather drag back. Keyboard chord left for a follow-up — owner's task notes mentioned graduating ⌘⌥0/9 from 20/80 to 0/100 OR adding a new ⌘⌥⇧0/9; either is a one-liner once the chord question is settled.

**Terminology note (per owner clarification 2026-05-02):** the right column of Duo's main split is called **"the canvas"** in user vocabulary, REGARDLESS of which tab kind is currently rendering inside it (markdown editor, HTML canvas tab, browser tab, image viewer, PDF viewer, future modalities like a JSON viewer or table view). "The canvas" is the SLOT, not the rendering surface. Internally we call it `WorkingPane` / `activeWorking`; user-facing copy and ENH discussions use "canvas" as shorthand for the right pane. Documented in CLAUDE.md.

**What's wanted:** a one-click affordance to collapse either the terminal column OR the canvas (right pane) all the way, giving the other full window width. A second click restores the previous split.

**Why ENH-014 (split set) isn't sufficient:** `duo split <pct>` and the View → Pane size menu can drive the split percentage, including the existing presets `terminal` (80) and `canvas` (20). But:
- Those presets aren't full-collapse — the other pane stays visible in a thin strip.
- They're keyboard-accelerator-driven, no visual button. Users don't reach for menu commands at the rate they reach for a click.
- The user's mental model is "hide the other pane while I focus" — a binary collapse, not a continuum.

**Scope (rough — flesh out when this is picked up):**
1. Two buttons in the titlebar (or in each pane's chrome): "Collapse terminal" / "Collapse canvas". Or one toggle that flips based on which pane has focus.
2. Click → animate split to 100/0 (or 0/100) with a smooth transition.
3. Click again → restore to last user-set split percentage (cache previous value).
4. Keyboard parity: ⌘⌥0 collapses to canvas-only (terminal hidden); ⌘⌥9 collapses to terminal-only. (Currently those bindings drive ENH-014 presets to 20 and 80; this ENH would extend to 0 / 100 OR remap to a new chord.)
5. While collapsed: a thin "expand" handle along the edge so the user can drag the divider back manually if they don't remember the keyboard shortcut.

**Cross-ref:** ENH-014 (split-pane percentage — this is the binary-collapse variant); WorkingPane terminology in CLAUDE.md (`canvas` = right pane in user vocabulary).

---

### ENH-041: Split the canvas (right pane) into side-by-side panels

**Status:** 🚧 v1 (Slack-style single aux slot) actively building in Sprint 3 (v0.6.3 → v0.6.4 arc). Locked spec: `docs/prd/canvas-split-view-research.html`. As of 2026-05-03:
- ✅ **Phase 3a-i** (`40c9951`): plumbing end-to-end — types, IPC channels, NavBridge methods, CLI `duo split-view {state, open, close, promote, resize}`, App.tsx state hook + IPC subscribers. Verified via CLI.
- ✅ **Phase 3a-ii** (`a0c144c`): visible UI — WorkingPane horizontal split, AuxHeader, SplitViewDivider. Verified live.
- ✅ **Phase 3a polish** (`f7ff1fe`): per-page `<meta duo-path-target="split">` so pages can default their `[data-duo-path]` clicks to Split View; smoke-walk generator opts in; agent docs document trigger language ("in split / alongside / side by side / as a companion / in the side panel").
- ⏳ **Phase 3a styling** (`5506f06` canvas drafted): 5 options (A current/shipped, B recommended, C–E alternatives) at `docs/prd/canvas-split-view-styling.html`. **Owner pick pending.**
- ⏳ **Phase 3b** (queued): right-click "Move to Split View" on tabs / file-tree / pinned / page-link; `⌘\` open + `⌘⇧\` close keyboard chords.
- ⏳ **Phase 3c** (queued): session-state persistence (aux + splitPct survive launch); empty-main → promote (already wired; needs integration test); dirty-replace native dialog; browser-tabs-in-aux.
- 🔵 **Deferred non-blocker:** FTUX default split content (auto-split welcome on first launch?) — pick after dogfooding.

**Locked spec deltas from the original "side-by-side panels" framing:**
- v1 is single-slot (one aux tab); Option B (multi-tab aux) kept on table for v2 with B-ready internals (`tabs[]` shape) from day one.
- Aux is right-side-only; no top/bottom/left aux; no recursive splits (Option C explicitly rejected).
- Capability deltas main↔aux: NONE in v1 (same TipTap/canvas surfaces, dirty/save/Send→Duo all work the same; three things deferred: browser-tabs-in-aux, pinning, multi-tab).
- Move semantics on tab right-click; Open semantics on file/link right-click. Single source of truth: never two tabs for the same path across panes.
- `⌘\`` cycle is 2-way (terminal ↔ working pane, last-focused side); `⌃Tab` is focused-pane only.
- User-facing label "Split View" (CLI verb `duo split-view`).

**Priority:** Low-medium (long-tail leverage; not blocking any current sprint but enables compelling workflows)
**Filed:** 2026-05-02 (Stage 27 walk-2 owner request)

**Terminology:** see ENH-040 — "canvas" = right pane in user vocabulary (the slot that hosts a markdown editor, HTML canvas, browser tab, etc.).

**What's wanted:** the ability to split the canvas (right pane) into two side-by-side sub-panels, so the user can have e.g. a markdown editor on the left of the canvas + a browser tab on the right of the canvas, viewable simultaneously. Each sub-panel has its own active tab + tab strip.

**Why this is interesting:**
- Compare-and-edit: open the source markdown in the left sub-panel + a generated HTML preview in the right sub-panel; edits on left, watch right repaint.
- Reference-while-authoring: docs in left, code editor in right.
- Multi-canvas lessons: a Stage 28 lesson canvas in left + the HTML the user is creating in right.

**Existing precedent:** the main split (terminal | canvas) is already a horizontal divider. This ENH extends the model to a SUB-divider inside the canvas. The same `react-split-pane` / equivalent primitive should drive both.

**Scope (rough — for later flesh-out):**
1. New "Split canvas" menu item / right-click on the canvas's empty space.
2. Two sub-panels, each owning its own `activeWorking` state independently. Tab strip is per-sub-panel.
3. Drag-to-move-tab-between-sub-panels (UX detail; bound up with ENH-042 reorder).
4. The terminal column stays unchanged — split is purely within the right pane.
5. Persistence: layout state (one or two panels) is part of session-restore.

**Sequencing concern:** depends on us having stable session-restore semantics for multi-pane state (Stage 21c Phase 2 covers single-canvas restore today; multi-sub-panel needs schema extension).

**Cross-ref:** ENH-040 (collapse — a related but orthogonal pane-management feature); session-state-service (where restore schema would extend).

---

### ENH-042: Tab reordering — move a working-pane tab left / right

**Status:** ✅ Shipped v0.6.3 (drag + menu; keyboard chord follow-up)
**Priority:** Medium (small but high-frequency UX paper-cut — users reach for "put this tab next to that one" at workflow-level rates)
**Filed:** 2026-05-02 (Stage 27 walk-2 owner request)
**Shipped:** 2026-05-02 — `WorkingPane.tsx` adds a session-local `tabOrder: string[]` of strip-ids, reconciled with the live tab set via useEffect (append unknowns, drop missing). `mergedTabs` now sorts within pinned/unpinned zones independently using `tabOrder` indices. `reorderTab(sourceId, targetId)` callback handles both menu + drag — when source was originally to target's LEFT in tabOrder, insert AFTER target (drag-rightward intent); when RIGHT, insert BEFORE target (leftward). Cross-zone moves are gated in `WorkingTabStrip.tryReorderDrop` (we have pin info on tabs there) before reaching the parent. `WorkingTabItem` is now `draggable` with HTML5 drag handlers (custom `application/x-duo-tab-id` MIME type); dropTargetId paints an accent ring on the hovered tab. New context-menu items "Move tab left" / "Move tab right" — disabled at zone edges. Not persisted across launches: file-tab ids are uuids generated at creation, so cross-launch state would have no anchor. Keyboard chord (⌘⌥← / →) deferred — not blocking for v1; may collide with browser-history nav, needs decision.

**What's wanted:** a way to reorder working-pane tabs. Two interaction patterns to choose from (or both):
1. **Drag-to-reorder** — pointer-down on a tab, drag horizontally, tab moves between siblings, drop commits.
2. **Keyboard / context-menu reorder** — right-click → "Move tab left" / "Move tab right". Or a chord like ⌘⌥← / ⌘⌥→ when a tab has focus.

**Why this matters:** today, tab order is creation order. A user who opens a reference file 10 minutes ago and a working file just now finds them in opposite ends of a long strip. Reordering lets the user co-locate related tabs.

**Existing context:**
- Pinned tabs (Stage 24) sort to leftmost automatically. So pinning is one workaround for "I want this tab near the start."
- `WorkingTabStrip.tsx` is where the strip rendering + per-tab right-click menu live; the tabs[] array is owned by App.tsx and ordered by insertion.

**Scope (rough — for later flesh-out):**
1. Drag-and-drop on `WorkingTabStrip.tsx` — `react-dnd` or HTML5 native drag events. Within-strip only for v1; cross-pane drag (when ENH-041 lands) is a v2 concern.
2. New right-click entries: "Move left" / "Move right" (gated when the tab is already at start / end).
3. Keyboard: ⌘⌥← / ⌘⌥→ on a focused tab.
4. Order persists across sessions via session-state-service (existing schema extension).
5. Pinned tabs stay pinned-leftmost; reorder applies within their respective sort-zones (pinned-zone | unpinned-zone).

**Cross-ref:** Stage 24 (pinning, which today is the only way to influence tab order); ENH-041 (split canvas — drag-between-sub-panels would extend this primitive).

---

### BUG-049: "Move to Trash" confirm dialog renders pinned-close copy

**Status:** ✅ **Shipped v0.5.5** — `PinnedCloseConfirm` parameterized to take explicit title/body/confirmLabel; trash branch in `WorkingTabStrip.tsx` now passes its own copy ("Move to Trash?" / "<file> will be moved to the Trash. The tab will close." / "Move to Trash" button). Walk-1 verified PASS (2026-05-01).
**Priority:** Medium (visible UX bug — text is incoherent)
**Filed:** 2026-05-01 (post-v0.5.4 owner report)

**Repro:** Right-click an unpinned local-HTML browser tab → choose **Move to Trash…** → the confirm dialog reads:

> **Close pinned tab?**
> Move "Smoke walk v0.5.4-rev3" to the Trash? The tab will close and the file will be moved. is pinned. Close it anyway?

**Root cause:** `WorkingTabStrip.tsx` reuses the `PinnedCloseConfirm` component for the trash flow (lines 211-220), passing the trash copy as `label`. But `PinnedCloseConfirm` hardcodes:
- Title: `"Close pinned tab?"`
- Body: `<span>{label}</span> is pinned. Close it anyway?`

So the trash copy gets sandwiched between the pinned-close title and the "is pinned" suffix. The two flows share a UI primitive but only the pinned-close copy lives inside it.

**Fix path:** Parameterize `PinnedCloseConfirm` to accept `title` + `body` props (defaulting to today's pinned-close copy for backward compat), and pass explicit strings from the trash branch. Alternative: split into a generic `ConfirmModal` primitive and have the pinned-close + trash flows compose their own copy. Going with the simpler title/body parameterization — it's a confirm modal in two places, doesn't justify a base primitive yet.

---

### SKILL-001: Skill troubleshooting — `duo: command not found` + sandbox PATH gaps

**Status:** ✅ **Shipped v0.5.4** (filed-as-shipped).
**Filed:** 2026-05-01 (v0.5.4-rev3 walk — enterprise-sandboxed user feedback verbatim)

**What shipped:** `skill/SKILL.md` now has:
1. Expanded "Sanity check" section enumerating the `duo: command not found` failure mode with concrete diagnostic commands (`ls ~/.claude/bin/duo ~/.local/bin/duo /usr/local/bin/duo`) and explicit env-var probe (`DUO_SESSION`, `DUO_SOCKET`).
2. New top-level "Troubleshooting: `duo: command not found`" section. Investigation order, install-location list, "don't fall back to `open <path>`" rule, "don't ask the user to run it for you" rule (skill exists so the agent acts on their behalf).
3. Behavior rule in Sanity check: **for one-shot ops (`duo open`, `duo nav-state`), invoke the CLI directly via Bash — don't delegate to the `duo` subagent for one-liners.** The subagent is for multi-step browser workflows where its observe-act-observe loop pays off; spawning it for `duo open <path>` is pure overhead.

**User repro that surfaced this:** enterprise sandboxed shell where `$PATH` didn't include the Duo install dir, the model gave up on `duo` entirely after a single `command not found`, fell back to native macOS `open` (which doesn't route through Duo), then asked the user to do it themselves — directly violating the "Act, Don't Ask" rule. Root cause was investigative-laziness; mitigation is encoding "check these install paths before declaring `duo` unavailable" in the skill so future agents don't reinvent the failure.

**Synced via `npm run sync:claude` so the live `~/.claude/skills/duo/SKILL.md` is current.**

**Cross-ref:** ENH-017 (PATH-mod for shell rc — partial overlap; that lands the export, this catches the case where the user hasn't run that yet). The `Act, Don't Ask` rule lives in Geoff's `~/.claude/CLAUDE.md` and is unchanged.

---

### BUG-052: Stage 27 V2 — `editor:open` with `data-mode="canvas"` opens but toolbar / read-only strip missing

**Status:** ✅ **Shipped post-v0.5.6 (commit `c010ef9`).**
**Priority:** **High — regression in Stage 27 verb. v0.6.0 release-blocker.**
**Filed:** 2026-05-02 (walk-2 result)

**Repro (from V2 row of `~/.claude/duo/stage-27-walk.html`):**
1. Click 'Open faq.html (canvas)'.
2. faq.html opens. No URL bar (good — proves canvas routing won).
3. **No "Read-only / Edit" strip and no editor toolbar visible at top of the canvas.** The body just renders.

**Expected:** Either the read-only strip (when `<meta duo-default-editable="false">` would have been present in faq.html — it isn't) OR the full editor toolbar (Heading 1, B, I, etc.) at top.

**Likely cause:** faq.html doesn't have `<meta duo-default-editable="false">`, so it should mount in EDIT mode by default. CanvasTab's toolbar visibility logic (`{!readOnly && (` on line ~1290 of CanvasTab.tsx) gates the toolbar on `!readOnly`. With `readOnly=false`, the toolbar block should render. Two possible failure modes to check:
- Some recent refactor wrapped the toolbar in a condition that excludes faq.html's path or canvas kind.
- The data-mode='canvas' code path in `editor:open` lands the file as a canvas tab but somehow forces readOnly without the strip — race between mount and the localStorage override read.

**Where to look:**
- `renderer/components/HtmlCanvas/CanvasTab.tsx` lines 1280-1340 (toolbar render branches)
- `renderer/App.tsx` `case 'editor:open'` with data-mode handling — does it set initial readOnly state correctly?
- `renderer/components/fileClassifier.ts` — does faq.html classify as something different from a canvas?

**Cross-ref:** Stage 27 walk-2 (2026-05-02). The smoke walk PRD (`docs/prd/stage-27-canvas-authoring.md`) must regress-test this verb during v0.6.0 cut verification. Add a smoke item to walk that the toolbar IS visible after a `data-mode="canvas"` open.

---

### BUG-053: Stage 27 V3 — `nav:reveal` opens parent folder but doesn't highlight the file

**Status:** ✅ **Shipped post-v0.5.6 — v1 fix `660f092` (atomic revealAndSelect), v2 fix `354ca2e` (route to user-claude pane for ~/.claude paths). Walk-3 surfaced that v1 set selected on the wrong navigator instance — the path lived in the USER-CLAUDE pane's subtree but `nav.actions.revealAndSelect` targets the PROJECT pane. v2 prefix-matches against ~/.claude/ and dispatches to userClaudeNav for those paths. Walk-4 re-test queued.**
**Priority:** **High — regression in Stage 27 verb. v0.6.0 release-blocker.**
**Filed:** 2026-05-02 (walk-2 result)

**Repro:**
1. From the stage-27-walk canvas, click 'Reveal priming.md' on the V3 row.
2. **Observed:** The navigator switches to ~/.claude/duo/ (correct). But priming.md is NOT highlighted / selected.

**Expected:** priming.md is selected (visible highlight) and scrolled into view (if needed), matching the file-tab context-menu's "Reveal in Navigator" entry behavior.

**Suspected cause:** in `renderer/App.tsx § 'nav:reveal'` (lines 721-730), three calls fire:
```ts
nav.actions.navigateTo(dir)
nav.actions.selectItem(absPath, 'file')
setFocusedColumn('files')
```
The likely bug: `navigateTo(dir)` is async (loads the directory listing). `selectItem(absPath, 'file')` runs immediately AFTER, but the FileTree may only highlight items that are CURRENTLY rendered. If the new directory's contents haven't been fetched + rendered yet, selectItem on a path that's not in the rendered tree silently no-ops (or sets a selection state that the FileTree never reconciles to).

The file-tab context-menu's "Reveal in Navigator" presumably has the same plumbing or works around the async ordering somehow. Check whichever path it uses — the `nav:reveal` verb should mirror it exactly.

**Where to look:**
- `renderer/hooks/useNavigator.ts` (or wherever `nav.actions.navigateTo` lives)
- `renderer/components/FileTree.tsx` — how does selection render? Is it driven by the path matching, or by an item-id that may not exist yet for a not-yet-loaded directory?
- The file-tab context-menu's 'Reveal in Navigator' entry (likely in WorkingTabStrip.tsx or ContextMenu callback) — what does it actually call?

**Likely fix:** await navigateTo (or chain selectItem on the next tick / via an effect), OR pass the path to a single combined action that ensures selection is applied AFTER the directory load finishes.

**Cross-ref:** Stage 27 walk-2.

---

### BUG-054: Stage 27 V7 — `terminal:focus` flips visual focus indicator but cursor is not active in the terminal

**Status:** ✅ **Shipped post-v0.5.6 (commit `9d4bc5e`).**
**Priority:** **High — regression. v0.6.0 release-blocker.**
**Filed:** 2026-05-02 (walk-2 result)

**Repro:**
1. From the stage-27-walk canvas, click 'Focus terminal' on the V7 row.
2. **Observed:** The terminal pane gets the orange focus glow (the focusedColumn='terminal' state flipped). But typing a key does NOT land in the terminal — the user has to manually click into the terminal first.

**Expected:** After the verb fires, keystrokes go straight to the active xterm. No re-click needed.

**Why this matters:** the whole point of `terminal:focus` is that the agent can "hand off keyboard focus to the terminal" so a user-driven flow can continue with typing. If the user has to click anyway, the verb has no value over a UI nudge.

**Suspected cause:** `setFocusedColumn('terminal')` updates the React state for the focus INDICATOR, but doesn't actually call `term.focus()` on the xterm instance. The cursor in xterm requires a `term.focus()` call (or the underlying textarea to be focused) — the focus column state is a separate concept.

**Where to look:**
- `renderer/App.tsx § case 'terminal:focus'` (lines 750-760)
- `renderer/components/TerminalPane.tsx` (or wherever xterm is mounted) — does it react to focusedColumn changing AND call term.focus()?
- The ⌘\` "go to terminal" handler — same surface; check whether it ALSO has this bug or whether it's a more direct path.

**Likely fix:** in the `case 'terminal:focus'` branch, after `setFocusedColumn('terminal')`, also dispatch a CustomEvent or call into the terminal pane's imperative API to actually focus the xterm. Alternative: the TerminalPane component's effect on focusedColumn change should call `term.focus()` directly when transitioning to 'terminal'.

**Cross-ref:** Stage 27 walk-2; ⌘\` toggle behavior (which may have the same latent bug — verify).

---

### BUG-055: HTML canvas click should focus the working pane (BUG-037 regression / sibling)

**Status:** ✅ **Shipped post-v0.5.6 (commit `11b3417`).**
**Priority:** **High — release-blocker for v0.6.0.** Breaks the basic "click into the canvas to begin typing" flow that BUG-037 fixed.
**Filed:** 2026-05-02 (walk-2 owner observation)

**Repro:**
1. `duo edit ~/.claude/duo/packs/intro-to-duo/canvases/welcome.html` (or any html canvas).
2. Click anywhere inside the canvas body.
3. **Observed:** Focus does NOT move to the working pane. The focus indicator (orange glow) stays on whichever pane was focused before.

**Expected:** Clicking anywhere in the canvas brings focus to the working pane (focusedColumn='working') — exactly what BUG-037 fixed.

**Why this is a regression:** BUG-037 added a `mousedown` capture-phase listener to the iframe document in `RenderedCanvas.tsx § wire()` (the `mouseHandler`). That handler calls `onUserInteractRef.current?.()` which is wired to flip `focusedColumn` to 'working'. The fix is gated INSIDE the `if (!readOnly)` branch — meaning a read-only canvas wouldn't have it. But the welcome.html canvas mounts in edit mode (no `duo-default-editable="false"`), so it SHOULD have the listener. Possible regressions:

1. The BUG-051 fix (commit `28b6eca`) added an `else` branch that explicitly does NOT install the mousedown listener. That's the new path on read-only re-mount but on the FIRST mount of an edit-mode canvas, the `!readOnly` branch should still install. Double-check that fix didn't accidentally relocate the listener install.
2. The mousedown handler installs `onUserInteractRef.current?.()` but the ref may not be wired in the welcome.html mounting path — check the host setup in CanvasTab.
3. CanvasTab's `handleReady` may have changed the order of installs and the mousedown forwarder is in `RenderedCanvas` while the focus-flip is in CanvasTab — race or wiring break.

**Where to look:**
- `renderer/components/HtmlCanvas/RenderedCanvas.tsx` lines 196-207 (the mousedown handler)
- `renderer/components/HtmlCanvas/CanvasTab.tsx` (where onUserInteract is wired)
- The recent BUG-051 fix (`28b6eca`) — verify the else branch didn't disrupt the mousedown install path

**Cross-ref:** BUG-037 (original mousedown forwarder fix), BUG-051 (read-only toggle fix — possible regression vector).

---

### BUG-056: Send → Duo pill on browser pane fires without an active Claude session

**Status:** ✅ **Shipped post-v0.5.6 (commit `70fd53a`); Sprint 9 walk-1 added automated regression coverage so this stops being a manual smoke item (owner-flagged 2026-05-07: "why do I need to walk this every session? please include in YOUR regression testing").** Test at [electron/cdp-bridge.test.ts](electron/cdp-bridge.test.ts) — exports `SELECTION_OBSERVER_IIFE` and asserts: (1) the IIFE source contains the literal `if (!window.__duoClaudeLive)` guard text, (2) the guard is positioned BEFORE the `ensurePill()` call (so the pill never mounts before the gate fires), (3) exactly one active code-site references `window.__duoClaudeLive` (excluding documentation comments — extra refs would force a fresh look at gating semantics). Three tests, all green; the guard's removal in any future refactor will fail CI before the bug ships.

If a future refactor needs to rename `window.__duoClaudeLive` (e.g. `window.duoState.claudeLive`), update the test's literal expectation in the SAME PR — the guard string is the contract between main and the page-side IIFE.

**Priority:** **High — recurring regression. Owner has called it out repeatedly: "we have discussed before; please update the docs and regression tests to ensure this does not happen again."**
**Filed:** 2026-05-02 (walk-2; user explicit "STILL getting" feedback)

**Repro:**
1. Open Duo with no Claude session running (no `claude` process in any terminal tab).
2. Open any browser tab, e.g. file:///Users/.../v0.6.0-stage-27-rev1.html.
3. Select text in the page body.
4. **Observed:** the in-page Send → Duo pill (BUG-006 v2 fix) appears.

**Expected:** the pill should NOT render unless there's an active Claude session to send TO. Without a Claude tab, clicking "Send → Duo" has no destination — the action is dead, and the pill becomes UI noise that the user has to ignore.

**Why this is recurring:** the original Send → Duo pill design assumed at least one Claude session was always running (the FTUX flow). When that became optional, the pill's presence-gate was supposed to become "any active Claude session in the terminal pane". The check was never wired, OR was wired and got removed in a refactor. Either way, the user has reported this multiple times.

**Mandatory: regression test.** Owner explicitly requested: "please update the docs and regression tests to ensure this does not happen again." Add either:
1. A vitest/playwright test that mounts the browser pane with no active Claude session, simulates a text selection, and asserts the pill isn't injected.
2. A smoke-walk item in EVERY future release walk: "browser pane with no Claude session — selecting text should NOT show the Send → Duo pill."

**Suggested fix (renderer side first):**
- `renderer/components/BrowserRenderer.tsx` — guard the `handleSendToDuoClick` subscription on `activeClaudeSessionExists` (or similar from the terminal-pane state).
- `electron/cdp-bridge.ts § SELECTION_OBSERVER_IIFE` — alternative: gate the in-page pill creation on a flag pushed from main when a Claude session is detected. Heavier (page-side state push) but more correct since the renderer-side guard could miss timing-edge cases on selection during a tab navigation.

**Where to look:**
- `renderer/components/BrowserRenderer.tsx` § handleSendToDuoClick + its useEffect subscribe block (lines 90-110)
- The terminal pane's "is there an active claude process" detector (used for tab strip badging)
- The original Send → Duo design doc (if any) — was the gate ever specified?

**Cross-ref:** BUG-006 (Send → Duo pill render path); ENH-006 / sponsor doc for FTUX flow assumptions.

---

### BUG-057: Pinned working-pane tabs lost across sessions / app upgrades

**Status:** ✅ **Shipped post-v0.5.6 (commit `21b8c35`).**
**Priority:** **High — release-blocker for v0.6.0.** Owner's framing: "pinned files should stay pinned and NEVER be lost between sessions or after app updates/upgrades; that's the whole point of the feature."
**Filed:** 2026-05-02 (walk-2 owner report)

**Repro:**
1. Pin three tabs in the working pane (Stage 24 pin gating — right-click → Pin, or pin button if any).
2. Quit Duo (⌘Q) or restart.
3. Reopen Duo.
4. **Observed:** the pinned tabs are gone.

**Expected:** pinned tabs survive every session boundary AND every app upgrade. The pin metadata must persist, AND the file paths the pins reference must reopen as their original tab kinds.

**Suspected cause:** session-state-service (Stage 21c Phase 2) restores OPEN tabs but may not persist the PINNED flag separately. OR: pin state is stored in localStorage which gets cleared on Electron upgrade if the user-data dir is migrated. OR: the install-service migration step on app upgrade (Stage 18) wipes the relevant config.

**Where to look:**
- `renderer/services/session-state-service.ts` (or similar) — does it serialize pinned[]?
- `electron/install-service.ts` — does the upgrade path touch pin storage?
- `renderer/hooks/useTabsState.ts` (or wherever WorkingTabStrip tabs[] state is persisted)
- localStorage keys related to pinning — are they cleared on app version bump?

**Mandatory in this fix:**
1. Schema-version the pin storage so future upgrades migrate cleanly.
2. Add a smoke-walk item EVERY release: pin three tabs, quit, reopen — confirm all three return.
3. Add a regression test (jsdom or e2e) that exercises the pin → quit → restore flow.

**Cross-ref:** Stage 24 (pin gating PRD); Stage 21c Phase 2 (session restore).

---

### BUG-058: Browser pane (WebContentsView) still occludes the working-pane tab context menu (BUG-050 partial fix)

**Status:** ✅ **Shipped post-v0.5.6 (commit `d9cd6c0`).** **Mute pattern superseded 2026-05-02 — see ENH-050 for the locked replacement direction (native NSMenu, retires `setOverlayMuted` for menus entirely).**
**Priority:** **🚨 URGENT — release-blocking for v0.6.0.** Owner explicit: "STILL getting issue where browser occludes tab context menu, see screenshot — this is an urgent, release-blocking bug."
**Filed:** 2026-05-02 (walk-2)
**Direction superseded 2026-05-02:** Walk-3 + walk-1 owner feedback ("I don't like that the browser contents disappear" / "the flicker is too obtrusive") drove a re-architecture. ENH-050's locked decision (`docs/DECISIONS.md § WCV-occlusion remediation`) replaces the WCV-mute pattern with native `Menu.popup()` for context menus and `dialog.showMessageBox` for destructive confirms. When ENH-050 lands, this BUG's fix in `WorkingTabStrip.tsx § handleContextMenu` (the `setOverlayMuted(true)` call that mutes-on-open) reverts; the menu becomes native instead. The mute pattern itself stays alive for BUG-006's in-page pill suppression (different problem class, native composition isn't applicable there).

**Repro:**
1. Have a browser working tab active in the working pane (so the WebContentsView is visible below the tab strip).
2. Right-click any working-pane tab.
3. **Observed:** the context menu opens BUT extends down into the browser pane area, where the WebContentsView (a native subview composited above all renderer DOM) is rendered. The menu items at the top are visible; items lower in the menu show browser content peeking through.

**Expected:** the context menu fully renders above all surrounding chrome regardless of which working tab kind is active.

**Why BUG-050 didn't close this fully:** the BUG-050 fix portaled `ContextMenu` to `document.body` with z-index:1000. That escapes RENDERER-DOM stacking contexts (the original symptom: ContextMenu inheriting the strip's overflow:auto stacking). But the WebContentsView is a NATIVE subview rendered ABOVE the entire renderer DOM at the macOS compositor level — z-index can't reach it. Same root cause as BUG-006 / BUG-047 (the in-page Send → Duo pill needed to be injected INTO the page, not painted on top via renderer DOM, for exactly this reason).

**Fix paths (rank in implementation order):**

1. **WCV-mute pattern** (proven, used elsewhere in BUG-045/047 family). When the context menu opens, set the WebContentsView's bounds to `{x:0,y:0,width:0,height:0}` for the duration. Restore on close. The menu still renders in renderer DOM; the WCV is gone for that moment so the menu has clear airspace. Implementation cost: low; performance impact: imperceptible (closing/reopening WCV is instant). Risk: any in-progress browser playback (audio, video) cuts out for the menu's lifetime.

2. **Native popup menu** via Electron's `Menu.popup()`. Instead of rendering the context menu in renderer DOM, build a native menu and pop it. Pros: native menu always paints above WCV (it's a real OS menu). Cons: loses the styled appearance + Tailwind look that the renderer-DOM ContextMenu has; would need to match macOS/Windows look. Larger refactor.

3. **Position-aware avoidance.** Detect WCV bounds and render the menu only in the strip-row Y range (above the WCV). Works only if the menu fits in the strip height (~28px), which it doesn't — most menus are 4+ items.

**Recommended:** path 1 (WCV-mute) — it's the proven pattern, fastest to ship, and the audio/video tradeoff is acceptable for the brief menu lifetime.

**Mandatory in this fix:**
- Add a smoke-walk item EVERY release: with a browser working tab active, right-click any working-pane tab — confirm the entire context menu (all rows) renders above the browser pane.
- Document the WCV-mute pattern in `docs/DECISIONS.md` if not already there — this class of bug has now hit Send → Duo pill, file-tab context menu, browser ⌘F, AND WorkingTabStrip context menu.

**Cross-ref:** BUG-050 (renderer-DOM portal fix — necessary but insufficient), BUG-047 (parent class), BUG-006 (in-page injection alternative), BUG-045 (file context menu sibling).

---

### BUG-059: Multiple working-pane tabs can open for the same local file path (should de-dupe)

**Status:** ✅ Shipped v0.6.3 (renderer-side + CLI-side carryover both fixed)
**Priority:** Medium (UX paper-cut + memory waste). Owner observation 2026-05-02.
**Filed:** 2026-05-02 (idle-thoughts.md item)
**Shipped (rev1):** 2026-05-02 — fix scoped to `renderer/App.tsx § openFileSmart` for browser-routed local files. The canvas-side `openFile` was already de-duping correctly (existing `prev.find(t => t.path === path)` check). The leak was on the browser-route path: when a file with `<meta duo-open-in="browser">` was opened twice (FAQ, What Duo Does, user-authored HTML routed via meta), `browser.addTab(fileUrl)` was called unconditionally. Fix: before adding, scan `browser.getTabs()` for an existing tab whose URL matches the constructed `file://` URL; switch to it via `browser.switchTab(id)` if found.
**Shipped (rev2 — walk-1 carryover):** 2026-05-02 — walk-1 surfaced that `duo open` from the CLI was STILL stacking duplicates (owner saw two smoke-walk tabs and two FAQ tabs after repeated opens across Duo restarts). Root cause: rev1 only deduped at `renderer/App.tsx § openFileSmart`, which handles user-initiated opens (clicking a file in the navigator). The CLI verb `duo open <path>` routes through `core/socket-server.ts § case 'open'` → `BrowserManager.openTab`, which never sees the renderer-side dedup. Rev2 ports the same dedup into `BrowserManager.openTab`: before `addTab`, scan `this.tabs` for an existing entry with matching `file://` URL; if found, `switchTab` + `webContents.focus()` instead of stacking. http(s):// URLs stay duplicate-allowed.
**Note (separate concern from this BUG):** walk-1 also surfaced "two FAQs" — `~/.claude/duo/help/faq.html` (installed copy) and `~/Documents/GitHub/duo/help/faq.html` (source repo). These are two DIFFERENT files at two different paths; the dedup fix is per-path so they correctly count as distinct. The "we should not be maintaining two FAQs" complaint is a structural issue (install service writing source duplicates instead of symlinks) — filed separately as ENH-070 below.

**Repro:**
1. Open `~/some/file.md` via `duo edit`.
2. Open it again (via the navigator click or another `duo edit`).
3. **Observed:** Two tabs in the strip, both pointing at the same path.

**Expected:** for LOCAL FILES, opening a path that already has an open tab should activate the existing tab (and bring focus to it). For BROWSER URLs (web), allow duplicates — multiple tabs for the same site is a legitimate browser pattern.

**Owner framing:** "there should never be multiple tabs open for the same local file (same not true for websites)."

**Suggested fix:**
- `renderer/App.tsx § openFileSmart` (or wherever `duo edit` / nav-click routes through) — before creating a new tab, scan tabs[] for one with the same `path`. If found, set it as active.
- Distinct tab kinds for the same path (e.g. opening `foo.html` once as canvas and once as browser via `data-mode`) is acceptable — only de-dupe within the same kind.
- Browser tabs (kind='browser') are exempt — multiple browser tabs for the same URL stays allowed.

**Mandatory in this fix:** smoke-walk item every release: open the same file twice, confirm only one tab opens (and the existing tab gets focus).

---

### BUG-060: Markdown editor does not parse \`\`\`fenced\`\`\` code blocks (should AskUser if ambiguous)

**Status:** ✅ Shipped v0.6.3
**Priority:** Medium (fundamental markdown feature missing).
**Filed:** 2026-05-02 (idle-thoughts.md item)
**Shipped:** 2026-05-02 — root cause was TipTap's built-in `textblockTypeInputRule` for code blocks fires on trailing SPACE (regex `^```([a-z]+)?[\s\n]$`), not on Enter. PM input rules don't run on Enter — Enter is consumed by `splitBlock` in the keymap layer before input rules see it. Users typing ` ```javascript` + Enter (the natural pattern) saw nothing happen and assumed fenced code blocks weren't supported. Fix: new `FencedCodeBlockEnter` extension at `renderer/components/editor/extensions/FencedCodeBlockEnter.ts` hooks the Enter keymap, scans the cursor's paragraph for `^(```|~~~)([a-z0-9-]*)$`, and replaces with a codeBlock node carrying the matched language. Returns true (consumes Enter) on match; returns false on miss so default `splitBlock` runs unchanged. Tilde fences (rare but valid in markdown) covered too. Markdown ↔ TipTap round-trip already worked correctly via `tiptap-markdown`'s `Markdown` extension; only the live-typing path needed the fix.

**Repro:**
1. In a markdown editor tab, type:
   ```
   ​```javascript
   console.log('hi')
   ​```
   ```
2. **Observed:** the editor renders the triple-backticks as literal text, not a code block.

**Expected:** the editor recognizes \`\`\`lang ... \`\`\` as a code block on Enter (when the closing fence is typed) AND on paste (when pasted markdown contains a fenced code block).

**Owner note:** "should AUQ if ambiguous how to handle" — i.e. for cases the parser can't disambiguate (e.g. a trailing line without a closing fence), the editor could surface a prompt.

**Where to look:**
- `renderer/components/editor/MarkdownEditor.tsx` (TipTap config)
- TipTap CodeBlockLowlight extension or similar — is it configured for the editor's schema?
- The Markdown ↔ TipTap serialization round-trip — does `serializeToMarkdown` emit \`\`\`fences\`\`\` correctly when reading back?

**Cross-ref:** BUG-061 (sibling bug in HTML canvas — both surfaces have markdown-parsing gaps; the components aren't fully harmonized).

---

### BUG-061: Markdown parsing broken in HTML canvas — bullets, indent / outdent missing (canvas vs. md editor parity gap)

**Smoke-walk note (2026-05-03):** v3 trigger-detection fix (regex + nbsp-tolerance) verified via 33 Vitest tests + smoke-walk PASS for `# `, `* `, `+ `, `1. `, `> `. **However**, two related gaps surfaced as separate items: **BUG-073** — `-` should produce a *dashed* bullet style (visually marker-aware), not the default round bullet; **BUG-072** — blockquote double-Enter should exit the blockquote (parity with bullet/ordered-list double-Enter exit). Neither blocks BUG-061's v3 fix; both are filed for v0.6.5.


**Status:** ✅ Shipped v0.6.4 — bullet/ordered triggers now fire correctly. Three iterations in the v0.6.3 → v0.6.4 arc:
- v1 (`1b3b132`, 2026-05-02): hand-rolled `convertEmptyBlockToList` replacing the failing `execCommand('insertUnorderedList')`. Walk-3 reported FAIL.
- v2 (`4baba8b`, 2026-05-02): start-match regex `/^[-*+] $/` + added `+` for CommonMark parity. Walk-3 still FAIL.
- **v3 (`56e986b`, 2026-05-03):** root cause found via DOM inspection: Chromium converts trailing literal space (U+0020) to `&nbsp;` (U+00A0), so `^[-*+] $` never matched. Switched all space-trigger regexes from literal ` ` to `\s` (per ECMAScript spec, `\s` matches both U+0020 and U+00A0). Applied to heading, bullet, ordered, blockquote triggers. Verified PASS in live smoke (typed `- bullet trigger v3` → rendered as `• bullet trigger v3`; `1. ordered` → numbered list). Tab/Shift-Tab indent (v0.6.3) still works.

**Priority:** Medium-high (parity gap; HTML canvas was meant to be a "lighter" markdown surface but missing bullet handling makes it materially worse).
**Filed:** 2026-05-02 (idle-thoughts.md item)

**What's IN this fix:**
- **Tab / Shift-Tab indent / outdent inside `<li>`** — new `handleListIndent(doc, shift)` in `renderer/components/HtmlCanvas/markdownShortcuts.ts` hooks the keydown handler. Inside any `<li>` (climbed via `closest('li')`), Tab fires `execCommand('indent', false)` and Shift-Tab fires `execCommand('outdent', false)`. Outside a list, the keystroke falls through. Mirrors the markdown editor's ⌘[ / ⌘] indent/outdent (ENH-025).

**What's NOT yet in this fix (filed as BUG-069 sibling — known limitation):**
Self-walk during v0.6.3 surfaced that the **bullet TRIGGER itself** (typing `- ` to convert a `<p>` to `<ul><li>`) has a Chromium-specific failure inside the canvas iframe: `clearBlockText(block)` DOES run (the `- ` literal text disappears from the block), but `execCommand('insertUnorderedList')` doesn't produce the expected `<ul><li>` structure — the paragraph stays empty and no list materializes. The trigger fires, the conversion silently fails halfway. This is a pre-existing canvas limitation, not a regression from my BUG-061 patch.

**Workaround until the trigger is fixed:** use the toolbar's bullet button to create a list, then Tab/Shift-Tab works correctly inside the resulting `<li>`. The toolbar path uses the same `execCommand('insertUnorderedList')` but with selected text (not an empty paragraph), which Chromium handles correctly.

**Path forward:** v0.6.4 should hand-roll the bullet conversion in `markdownShortcuts.ts` instead of trusting `execCommand('insertUnorderedList')` on empty blocks. Pattern: explicitly create a `<ul>` element, move the cleared block's parent reference, append a fresh `<li>` with caret inside, replace the original block. Roughly 20 lines following the `toggleTaskList` pattern in `blockOps.ts` (which is already hand-rolled for the same reason).

**Repro:** open an html canvas in edit mode. Type `- bullet` and press Enter. The canvas renders the literal `-` character; no list element forms. Tab does not indent; Shift-Tab does not outdent.

**Expected:** parity with the markdown editor's bullet handling — `- ` or `* ` at line start triggers a `<ul><li>`. Tab inside a `<li>` indents (nests under the previous `<li>`). Shift-Tab outdents.

**Owner framing:** "have we failed to merge the components between md vs html canvases?"

**Architecture question that this surfaces:** the markdown editor (TipTap-backed, Stage 11) and the HTML canvas (contentEditable iframe, Stage 17) currently have separate input-handling code. Markdown-shortcut behavior (autocomplete patterns like `- ` → `<ul>`) lives in `renderer/components/HtmlCanvas/markdownShortcuts.ts` for the canvas surface. The md editor uses TipTap's built-in input rules. Drift between the two is inevitable as long as they're separate codebases.

**Two paths forward:**
1. **Bring HTML canvas up to parity** — extend `markdownShortcuts.ts` with bullet input rules, Tab/Shift-Tab indent handling, and any other md-editor features that the canvas currently lacks. Cheaper to ship; doesn't unify the codebases.
2. **Unify** — embed TipTap inside the HTML canvas iframe (or use the canvas's contentEditable as a TipTap mount point). Heavier; architectural decision required (the canvas's "the canvas IS the page" PRD-H1 principle says we DON'T want a wrapping editor framework).

**Recommended:** path 1 for v0.6.x — bring `markdownShortcuts.ts` to bullet/indent parity. Decision on path 2 (unify) goes to an ADR before any larger refactor.

**Where to look:**
- `renderer/components/HtmlCanvas/markdownShortcuts.ts` — current shortcut catalogue
- `renderer/components/editor/MarkdownEditor.tsx` — TipTap input-rule config (for parity reference)

**Cross-ref:** BUG-060 (md editor's own parsing gap on fenced code blocks); Stage 11 (md editor PRD); Stage 17 (HTML canvas PRD H1 — "the canvas IS the page").

---

### ENH-043: The smoke-walk skill should be re-buildable via playground primitives [REFRAMED — narrowed scope]

**Status:** 🚧 **Reframed twice in Sprint 5.** First reframe (2026-05-04 morning) decomposed into ENH-092/093/094 + a worksheet refactor. Second reframe (2026-05-04 evening) — owner pushback on the "framework" direction: future-Claude is a capable coder; primitives that pre-chew its meal just get bypassed. Final scope: **ship ENH-094 (browser-pane runtime injection) so the smoke walk can fire `duo:event` live as the user interacts; close ENH-092/093 won't-do.** The smoke walk's existing inline JS (state/tally/composition) stays — it's appropriate page-specific code. The DELTA after ENH-094 is that the worksheet adds `data-duo-action="duo:event"` decorators on radio changes, and Claude subscribed via `duo events --follow` sees walk progress live instead of waiting for copy/paste. Net change to the worksheet generator: ~5 lines of decorator injection. ENH-043 closes when ENH-094 ships + the worksheet generator emits the event decorators.
**Priority:** High (architectural — this is what the playground is *for*).
**Filed:** 2026-05-02 (idle-thoughts.md). Reframed 2026-05-04 (post-Phase-5 cut readiness check).

**What the smoke walk actually does today (custom inline JS in `worksheet/generate.mjs`).** The 958-line generator emits a self-contained HTML page with NO playground primitives — every behavior is custom `addEventListener`:
1. Per-item radios → CSS class on parent card (color tinting per PASS/FAIL/SKIP)
2. Live tally (counts at top, recompute on every change)
3. localStorage persistence (every input/change → save; on load → restore)
4. "Mark all PASS" bulk button
5. "Clear saved" wipe button
6. "Copy results" — gather form state, format as text, write to clipboard
7. "Send to Claude" — same composition, route to `window.duoSendResult` with clipboard fallback (FOLLOWUP-007 plumbing)
8. Per-step `<pre>` copy buttons + backtick-parsing logic for runnable-command detection

**What playground primitives have today.** Seven one-shot action verbs (`claude:spawn`/`terminal:send`/`editor:open`/`nav:reveal`/`selection:set`/`theme:set`/`terminal:focus`/`duo:event` + `browser:open`) + `data-payload-from` for single-input form-state binding. The vocabulary is "click → fire one structured action to host." Smoke walks need state, DOM reactivity, composition, clipboard — none of which today's verbs cover.

**Plus a runtime-injection gap.** The playground action runtime (`installPlaygroundActions(doc, opts)`) lives in the canvas iframe's `contentDocument` — it doesn't reach browser-pane pages. Even with new verbs, a smoke walk hosted in a browser tab couldn't use them today. Same precedent already exists for partial cases though (Send→Duo pill `SELECTION_OBSERVER_IIFE`, `data-duo-path` `PATH_LINK_FORWARDER_IIFE`); we extend it to a full `PLAYGROUND_RUNTIME_IIFE` that injects the vocabulary into browser-pane pages too.

**Decomposition (3 sub-ENHs):**
1. **ENH-092** — Playground state + DOM-reactivity primitives (`state:save`/`state:set`/`state:get`/`state:wipe`, `dom:set-class`/`dom:toggle-class`/`dom:bind`).
2. **ENH-093** — Playground composition + clipboard (`compose:result` walks form state into a structured payload; `clipboard:copy` writes literal or composed payload).
3. **ENH-094** — Inject the playground runtime into browser-pane pages via CDP (`PLAYGROUND_RUNTIME_IIFE`). Now playground primitives work in EITHER pane.

After 092 + 093 + 094 ship, ENH-043 = refactor `worksheet/generate.mjs` to emit pure declarative HTML using the new vocabulary. No inline JS. Manifests stay JSON; output becomes a thin recipe of playground verbs.

**Why this matters (the original framing was right; the implementation didn't catch up):** the same primitive set will power lesson canvases, agent-generated dashboards, smoke walks, sprint-plan worksheets, future retros / triage forms. Today each is a separate generator. After ENH-092/093/094 + 043, they share one runtime contract.

**Cross-ref:** ENH-092 / ENH-093 / ENH-094 (the dependencies). Stage 27 (the canvas-authoring vocabulary this extends). FOLLOWUP-007 (`duoSendResult` binding — the partial-case CDP injection precedent).

**Cross-ref:** Stage 27 PRD (canvas-authoring); `skill/canvas-authoring.md`; ENH-046 (code-block + copy-button primitive — a sub-component this ENH would need).

---

### ENH-044: New-claude-terminal button needs a custom icon — `clawd.svg` available

**Status:** ✅ Shipped v0.6.2
**Priority:** Low (cosmetic).
**Filed:** 2026-05-02 (idle-thoughts.md item)
**Shipped:** 2026-05-02 — copied owner's `clawd.svg` into `renderer/assets/icons/clawd.svg` (with provenance comment + cropped viewBox from the original 210mm × 297mm A4 canvas) and replaced the generic `+` glyph in TabBar.tsx's new-Claude split-button half with an inline `ClawdGlyph` React component. The `#c15f3c` body color (Atelier accent family) is preserved as the icon's visual identity — this matches `ClaudeIcon` / `TerminalIcon` already living inline in the same file. The eye-pixels stay pure white. Deleted the source file from `~/Desktop/clawd.svg`.

**What's wanted:** the "New Claude terminal" button in the terminal-tab strip's `+` affordance currently uses a generic terminal icon (or no icon — owner observation pending). Owner has provided a custom icon: `/Users/geoffreydudgeon/Desktop/clawd.svg`.

**Action:**
1. Move `clawd.svg` into the repo (e.g. `renderer/assets/icons/clawd.svg`).
2. Update the new-claude-terminal button to use it as its icon.
3. Sanity-check sizing / contrast in both light + dark themes.

**Cross-ref:** `renderer/components/TerminalTabStrip.tsx` (or wherever the `+` affordance lives).

---

### ENH-045: Navigator — "Project Claude Context" improvements (collapsible, dynamic name, project detection, gh integration)

**Status:** 🚧 ENH-045a shipped v0.6.3 — sub-stages b/c/d still queued
**Priority:** Medium (meaningful UX upgrade with downstream ENH branches).
**Filed:** 2026-05-02 (idle-thoughts.md item — multi-bullet)
**ENH-045a shipped 2026-05-02** — `renderer/components/ProjectClaudeContext.tsx`:
- Collapsible header (default collapsed per owner direction). Toggle persists across sessions in localStorage at `duo:project-claude-context:collapsed`.
- Dynamic title: `{projectName} Claude context` where projectName resolves to `package.json` `name` field if present at cwd, otherwise the last segment of cwd. Async package.json read happens once per cwd change; folder-name shows immediately, package name upgrades when read lands.
- Auto-detection: the existing `candidates` check (renders nothing when no `CLAUDE.md` / `.claude/` / `tasks.md` / `AGENTS.md` exist) already matched the owner's "any folder containing a `.claude/` OR being the root of a git/github repo IS a project" framing — projects with no Claude context still don't render the section.
- Disclosure caret rotates 90° on expand; click anywhere on the header toggles.

**Still queued:**
- **ENH-045b** — gh status visibility (depends on a `git`/`gh` background prober; deferred — needs Stage 21d socket auth).
- **ENH-045c** — promote-to-project + sync-to-github actions (downstream of 045b).
- **ENH-045d** — new-project skill (interview flow + templates).

**Owner's full feature set:**
1. **"Project Claude Context" should be collapsible**, default to collapsed.
2. Renamed to **"{project-name} Claude Context"** where `{project-name}` is the current project's name (folder name, repo name, or `name` from package.json — define precedence).
3. **Auto-detect projects:** any folder containing a `.claude/` OR being the root of a git/github repo IS a project.
4. **Github status visible** (per project — pull state, branch, etc.).
5. **Easy github actions** from the navigator (later — this is downstream).
6. **Promote a file to be a project** via CLI or context-click.
7. **Sync a folder to github** even if not yet linked.
8. **Project assets / new-project skill:** explore creating default per-project assets (project overview HTML, lesson skill that interviews the user about goals, etc.).
9. **Project templates** for the enterprise-distro story (ties to Stage 18b).

**Sequencing:** this ENH is a parent of multiple sub-ENHs. Items 1-3 are the v1 (collapsible, naming, auto-detect) and unblock most of the experience. Items 4-5 are gh-integration (Stage 21d-ish — depends on socket-auth + agent-driven-nav-notifications). Items 6-9 are subsequent expansions.

**Recommended carve-up:**
- ENH-045a — collapsible + dynamic naming + .claude/ detection (cheap; v1)
- ENH-045b — gh status visibility (depends on a `git`/`gh` background prober)
- ENH-045c — promote-to-project + sync-to-github actions
- ENH-045d — new-project skill (interview flow + templates)

**Cross-ref:** Stage 18b (pack distribution — project templates fold here); existing `useNavigator` hook + `FileTree.tsx` for the rendering.

---

### ENH-046: Smoke-walk page + canvas templates — code blocks with copy buttons for any user-runnable code

**Status:** ✅ Shipped v0.6.3 (final piece — docs)
**Priority:** **High — owner explicit ask: "this smoke walk included a few places where I needed to copy and run code -- please update the user smoke walk prep to place these in code blocks with a copy button; and generally, when duo makes canvases for users (eg via the templates we are working on) that include code/text to copy, it should do the same."**
**Filed:** 2026-05-02 (walk-2 owner request)
**Shipped:** Items 1 + 2 already shipped earlier (smoke-walk `generate.mjs § renderStepHtml` pulls trailing cmds into `<pre><code>` Copy blocks; renderer-side `injectCodeBlockCopyButtons` auto-injects on every `<pre>` inside a canvas via `CanvasTab.tsx`). Item 3 (the docs piece) shipped 2026-05-02 in `skill/make-page.md § Copy buttons on <pre> blocks (auto-injected)` — documents the auto-mode contract: any `<pre>` in a canvas gets a Copy button, no opt-in needed; inline as `<code>` instead of `<pre>` to skip. The same convention applies in the smoke-walk page (auto-injected by generator), in canvas templates, and in any agent-emitted page using `<pre>`.

**What's wanted:**
1. **Smoke-walk skill (`.claude/skills/smoke-walk/generate.mjs`):** for any V-step that includes a copy-paste command, render the command in a `<pre>` / `<code>` block with a Copy button alongside (similar to the ENH-005 pattern that already injects copy buttons into canvas `<pre>` blocks via `injectCodeBlockCopyButtons`).
2. **General Duo canvas templates** (`skill/examples/canvas-templates/*.html` and any agent-generated canvas via `canvas-authoring`): any code block that contains user-runnable content should use the same Copy-button affordance. This becomes a primitive in `canvas-authoring.md` — e.g. a `<pre data-copy="true">` opt-in convention.
3. **Documented contract** in `canvas-authoring.md` section: "When your canvas includes code the user is expected to run, mark the `<pre>` block with `data-copy='true'` (or use the helper script). The host injects a Copy-to-clipboard button."

**Implementation paths:**
- The renderer already has `injectCodeBlockCopyButtons(doc)` in `renderer/components/HtmlCanvas/codeBlockCopy.ts` (or similar — ENH-005 lineage). Today it injects into EVERY `<pre>` in a canvas. Two options:
  - **Auto-mode (current):** all `<pre>` blocks get a copy button. Simplest — just need to ensure the smoke-walk page's commands ARE in `<pre>` blocks (currently they're not).
  - **Opt-in mode (richer):** `data-copy='true'` opt-in attribute, with sane defaults (terminal-style code blocks default true, prose code defaults false).

**Recommended:** keep the current auto-mode; UPDATE `generate.mjs` to wrap V8/V14/V17/etc commands in `<pre>` blocks. That alone fixes the user's smoke-walk pain. Document in `canvas-authoring.md` as part of the convention.

**Cross-ref:** ENH-005 (initial code-block copy-button injection); ENH-043 (smoke-walk skill rebuilt on canvas primitives — this is one such primitive); the V8 / V14 walk-2 instructions specifically (the cases the user hit).

---

### ENH-047: Smoke walk V8 / "duo events" listener should auto-spawn — don't ask user to copy/paste a command

**Status:** 🆕 Filed
**Priority:** Medium (process improvement to smoke-walk skill).
**Filed:** 2026-05-02 (walk-2 owner feedback on V8)

**Owner observation:** "this is a fine smoke test, but we cannot rely on the user to copy/paste commands into the terminal to put duo in listening mode; you will need to figure out how to automate this."

**What's wanted:** when a smoke-walk step requires a background process (currently `duo events --follow` for V8/V13), the skill should spawn that process FOR the user — either by:
1. Using `duo new-tab --cmd "duo events --follow"` to open a new terminal tab with the command pre-running, OR
2. Capturing events programmatically in main and surfacing them via a renderer-side panel within the smoke-walk page itself, OR
3. Spawning a hidden background process and writing its stream into a localStorage-backed log that the smoke-walk page polls + displays.

**Recommended:** path 1 (auto-spawn via `duo new-tab`) — simplest, lowest delta from today, keeps the user in control of the process.

**Sequencing:** depends on ENH-046 (the walk page emitting code blocks with copy buttons) — this ENH is the "now also auto-launch where possible" upgrade.

**Cross-ref:** ENH-046; smoke-walk skill PRD (`docs/dev/smoke-walks/`); V8 / V13 walk items.

---

### ENH-048: Smoke walk V14 — clearer instructions for "use a new terminal session?"

**Status:** 🆕 Filed
**Priority:** Low (smoke-walk usability).
**Filed:** 2026-05-02 (walk-2 owner feedback on V14)

**Owner feedback (verbatim):** "no idea how to follow this instruction; please be clearer. is this in a new terminal session?"

**What's wanted:** V14 instructions ("Run `duo events --limit 10` and copy the cursor of an OLDER event...") need explicit context:
- Which terminal? A new one, or the same one as V8's `--follow`?
- Should the V8 `--follow` listener still be running, or stopped?
- "Cursor format `<unix-ms>-<seq>`" — what's the exact copy-paste shape?

**Action:** rewrite the V14 step list with:
1. Explicit terminal hand-off ("In a SECOND terminal, separate from V8's listener").
2. A worked example with sample output ("you should see lines like `{cursor: '1777725725181-0', ...}` — copy the `cursor` value verbatim including quotes").
3. The `duo events --since '<cursor>'` invocation in a code block with a Copy button (ties to ENH-046).

**Cross-ref:** ENH-046; ENH-047; V14 walk item.

---

### ENH-049: 28-Pack-A "Start lesson" button should gate on / spawn a Claude session (and be unclickable otherwise)

**Status:** ✅ **Shipped v0.6.1 (option b — fix `claude:spawn` semantics).** `dispatchPostSpawnWrite` now sends `claude\n${cmd}\n` when kind='claude' AND a cmd is supplied — claude launches first; cmd lands in the PTY input buffer; claude reads it as the first user message once it takes over stdin. Previously the cmd was sent DIRECTLY (no claude\n prefix), so it typed into zsh as a shell command and errored because the cmd was prose ("Read ~/.claude/duo/.../SKILL.md and walk me through..."). Owner picked option b ("make claude:spawn always create a terminal if none exists, and have the cmd land in claude not the shell") over option a (gate the button), correctly: the verb's contract is "ensure a Claude tab exists with these args."
**Priority:** Medium (UX correctness for FTUX).
**Filed:** 2026-05-02 (walk-2 owner observation on 28-Pack-A)

**Owner framing:** "Click 'Start lesson' >> this should either: start a new claude session, or not be clickable without an active claude session."

**Repro:**
1. Open `~/.claude/duo/packs/intro-to-duo/canvases/welcome.html`.
2. Click "Start lesson".
3. **Observed:** the canvas fires the `claude:spawn` action but if there's no active terminal pane / claude tab, the spawn lands silently with nothing visible to the user.

**Expected (two valid behaviors):**
- (a) Button is gated: disabled when no terminal is active; enabled when a terminal is open. Tooltip explains why.
- (b) Button fires unconditionally and Duo creates a new terminal tab with `claude` running in it (which is what `claude:spawn` is supposed to do, but the user observation suggests this didn't happen visibly — investigate).

**Recommended:** option (b). The whole point of `claude:spawn` is to create a terminal+claude session if one doesn't exist. If it's failing silently, that's a bug in the action handler, not a UX issue with the button.

**Action:**
1. Verify `claude:spawn` actually creates a terminal tab when none exists (or when the claude tab is closed). If it's missing this fallback, fix the handler.
2. Add a smoke-walk item: "with no Claude tab open, click 'Start lesson' on welcome.html — confirm a new terminal tab opens AND `claude` is launched inside it."

**Cross-ref:** Stage 27 (claude:spawn verb); Stage 28 Pack A (welcome.html); `renderer/App.tsx § case 'claude:spawn'`.


### ENH-050: Replace WCV-mute pattern with native NSMenu (b) + system sheet dialogs (d)

**Status:** ✅ Shipped v0.6.3 (full migration in single sprint — all 5 implementation steps landed)
**Priority:** Medium-high — fixes BUG-058 jankiness + BUG-064 modal occlusion; retires the entire WCV-mute pattern for menus + modals.
**Filed:** 2026-05-02 (walk-3 W3-V8 PASS notes; **superseded** the original "snapshot overlay" direction on 2026-05-02 per walk-1 owner review of mockups)
**Shipped:** 2026-05-02 — all 5 steps of the locked implementation order completed in one sprint:
1. **IPC plumbing** — `MENU_POPUP` + `DIALOG_CONFIRM` channels in `shared/types.ts`; `MenuTemplateItem` / `MenuPopupRequest` / `MenuPopupResult` / `DialogConfirmRequest` / `DialogConfirmResult` types. Preload exposes `window.electron.menu.popup({ items, x?, y? })` and `window.electron.dialog.confirm({ title, message, buttons, defaultId, cancelId, type })`. Main handlers in `electron/main.ts` build `Menu.buildFromTemplate([...])` + `menu.popup({ window, x, y, callback })` for menus and `dialog.showMessageBox(window, opts)` for sheets.
2. **WorkingTabStrip migration** — right-click → `window.electron.menu.popup`; trash + pinned-close confirms → `window.electron.dialog.confirm`. Removed BUG-058's `setOverlayMuted(true/false)` calls from `handleContextMenu` (no longer needed). Pure-data menu template (`buildTabMenuTemplate`) with stable `id`s; `handleMenuChoice(id, ctx)` maps ids to actions.
3. **App.tsx pinned-close confirm migration** — the ⌘W close-pinned-tab path now fires `window.electron.dialog.confirm` inline and acts on the response. `pendingClosePinned` state retired.
4. **FileTree migration** — file-row + whitespace right-clicks → `window.electron.menu.popup` via shared `popupMenu(e, target, whitespaceMode)`. `buildTreeMenuTemplate` returns pure data; `handleMenuChoice(id, target)` dispatches actions. `onTrashEntry` migrated from `window.confirm` → `window.electron.dialog.confirm`.
5. **PinnedNav migration** — pinned-row right-click → native menu via `popupMenu(e, target)`. Local handler in same component.

**Components retired:** `renderer/components/ContextMenu.tsx` and `renderer/components/PinnedCloseConfirm.tsx` deleted (no remaining imports). The `setOverlayMuted` BrowserManager API is preserved — BUG-006's in-page pill still uses it (different problem class).

**Decision locked.** See `docs/DECISIONS.md § WCV-occlusion remediation: native NSMenu + system sheets, not WCV-mute` for the full rationale + trade-offs. Two surfaces, two native primitives:

1. **Right-click context menus** (BUG-058 family) → `Menu.popup()` from main process. Renderer fires `menu:popup-tab` (or `menu:popup-tree-row`) with item template + click coords; main builds + pops + IPCs the chosen id back. Covers WorkingTabStrip's tab menu, navigator's right-click menu, future right-click surfaces.
2. **Destructive confirmation modals** (BUG-064 family) → `dialog.showMessageBox` (window-modal sheet). Sheets drop from below the titlebar, dim the window body uniformly, composite natively above the WCV. Covers the trash confirm modal, pinned-close confirm, ⌘W close-unsaved confirm, future "are you sure?" tier interactions.

**Atelier styling stays for everything else** — canvas-action verbs, comment threads, info popovers, the Send → Duo pill, banners, tab strips. Dichotomy: "OS-tier surfaces use OS chrome; in-pane surfaces use Atelier chrome."

**Why this superseded the prior `capturePage()` snapshot-overlay direction:**
- Owner review of mockups 2026-05-02 — snapshot-overlay read as "architecturally weird" ("we take a picture and then hold it up?"). Native primitives (b)+(d) align with macOS HIG conventions AND the WCV's compositing rules instead of fighting them.
- Eliminates the WCV-mute pattern entirely (no `setOverlayMuted` calls for menus/modals). The mute API stays for BUG-006's pill suppression, but stops firing on menu/modal interactions.
- Free affordances — keyboard shortcuts in menus, arrow-key navigation, Esc-to-dismiss, dark-mode adaptation, sheet-drop animation — without code.

**Implementation order (per the locked decision):**
1. Renderer-side IPC plumbing: add `menu:popup-tab` + `menu:popup-tree-row` verbs; preload exposes `window.electron.menu.popup({ x, y, items })` returning chosen `id`.
2. Migrate `WorkingTabStrip.tsx`'s right-click first (BUG-058 trigger; highest-frequency case).
3. Migrate trash + pinned-close + ⌘W-unsaved confirms to `dialog.showMessageBox`.
4. Migrate navigator's right-click menu (`FileTree.tsx`) — same plumbing, different items.
5. Retire `<ContextMenu>` and `<PinnedCloseConfirm>` components; revert BUG-058's `setOverlayMuted` mute pattern in `WorkingTabStrip.tsx § handleContextMenu`.

**Trade-offs accepted:** Atelier styling lost on menus + destructive sheets specifically (translucent system gray, system blue hover, system font). Light/dark follows OS theme not Duo's. Custom decorations on menu items (bold rows, colored dots) not possible. Custom keybinding display strings constrained to Electron's accelerator format.

**Mockup artifacts (decision evidence):** `/tmp/wcv-mute-option-b-mockup.html` (native menu) + `/tmp/wcv-mute-option-d-mockup.html` (system sheet) — owner-reviewed 2026-05-02; not committed to repo (decision-time artifacts only).

**Cross-ref:** `docs/DECISIONS.md § WCV-occlusion remediation` (locked); BUG-058 (item 5 above retires its mute pattern); BUG-064 (item 3 above fixes the modal-occlusion sibling); BUG-006 (pill suppression — mute API stays for this case); BUG-045/047 (related WCV-occlusion family that informs the architecture).

---

### BUG-062: Update banner shows wrong "currently from vX.Y.Z" version

**Status:** ✅ Shipped v0.6.2
**Priority:** Medium (visible UX confusion)
**Filed:** 2026-05-02 (walk-3 screenshot)
**Shipped:** 2026-05-02 — `renderer/components/FirstLaunchBanner.tsx` rewrote the banner copy. The old phrasing "(currently from v{X})" was ambiguous — it sounded like Duo itself was at v{X}. The new copy is explicit about which version is which: "Agent files in `~/.claude/` are from Duo v{installedVersion}. You're running v{appVersion}. Refresh to update." Both versions are now visible in the same sentence so the user can see "the files I have are from version A, but I'm running version B" at a glance. The receipt-vs-running-version data was already correct — only the rendering needed the fix.

**Repro (visible in walk-3 screenshot 2026-05-02):**
1. Running dev build at v0.5.7 (titlebar reads `0.5.7 ·dev`).
2. Update banner reads: "Duo update available. Refresh the agent files in `~/.claude/` (currently from **v0.6.0**)."
3. The banner is offering an update FROM v0.6.0 — but the running build is v0.5.7 (post-cut bump from v0.6.0 → v0.5.6 → v0.5.7-dev).

**Expected:** the banner should read "currently from v0.5.7" (or the actual installed version), OR "an updated version is available" without a wrong version string.

**Suspected cause:** the install service tracks the version of the agent files installed in `~/.claude/duo/` (or similar) — likely from a JSON receipt file. That receipt was written when v0.6.0's package.json was active, and the receipt isn't being refreshed when the user re-installs. The dev build's version label (from `app.getVersion()`) shows 0.5.7, but the install receipt is stale at 0.6.0.

**Where to look:**
- `electron/install-service.ts` — the receipt-write path; check whether it reads from `app.getVersion()` or from a captured-at-install-time snapshot
- `~/.claude/duo/installed.json` (or whatever receipt file) — verify its version field vs. running app version
- The "Refresh the agent files" banner UI — its source of the "currently from" string

**Mandatory in this fix:** confirm the banner refreshes its source-of-truth on every dev launch, OR is suppressed entirely when the dev build's version is OLDER than the installed receipt (going backwards on dev is fine; the banner shouldn't suggest "update" in that direction).

**Cross-ref:** Stage 18 install service; the v0.6.0 → v0.5.6 → v0.5.7 version bump that surfaced this.

---

### BUG-063: Walk-3 manifest renders escaped HTML attribute incorrectly (`<meta ...>` vanishes from step text)

**Status:** ✅ Shipped v0.6.2
**Priority:** Low (smoke-walk doc rendering bug only)
**Filed:** 2026-05-02 (walk-3 owner notes — "Other notes: missing characters/span?")
**Shipped:** 2026-05-02 — `.claude/skills/smoke-walk/generate.mjs § renderStepHtml` adopted recommended path 3 (mid-sentence cmds stay inline). Added `isTrailingCmd(idx)` helper that scans forward from a `cmd` part: if every subsequent part is either trivial trailing prose (whitespace + `.,;:!?)]"`) or another part, it counts as trailing and gets pulled into the Copy block; otherwise the cmd is reclassified to `inline-code` and renders inline as `<code>` in the prose flow. End-of-sentence runnable commands still get the Copy treatment (original intent preserved); mid-sentence literals like `` `<meta name="duo-default-editable" content="false">` `` now render in flow without leaving prose gaps.

**Owner observation (verbatim):** "'Open the stage-27-walk canvas (which has so it mounts read-only with a toggle)' missing characters/span?"

**Repro:** in the walk-3 page (`docs/dev/smoke-walks/v0.5.7-walk-3.html`), the W3-V5 step text shows: "Open the stage-27-walk canvas (which has  so it mounts read-only with a toggle)." — there's a visible gap where `<meta name="duo-default-editable" content="false">` should appear.

**Source (manifest JSON):** `"Open the stage-27-walk canvas (which has \`<meta name=\"duo-default-editable\" content=\"false\">\` so it mounts read-only with a toggle)."` — the backtick-wrapped `<meta>` literal.

**Suspected cause:** in `generate.mjs § renderStepHtml`, the backtick-parsing splits the step into prose / inline-code / cmd parts. The `<meta>` literal IS classified as cmd (has whitespace + > 25 chars). It gets pulled into a separate `<pre>` block AFTER the step text — leaving the prose portion with a gap. The cmd block IS rendered (with a Copy button). But:

1. The `<pre>` content is escaped via `esc()` so the angle brackets become `&lt;` / `&gt;` — that part works.
2. **HOWEVER**, the prose-side flow shows a gap because the CMD was originally inline in the prose (between "has" and "so it mounts"). When pulled out, no replacement marker is left in the prose — it just becomes `"...has  so it mounts..."` with a double-space.

**Fix paths:**
1. Leave the CMD inline as a small code-styled inline element AND show the pulled-out copy block below — the user sees the command in two places (inline for context, copyable below). Slightly redundant but unambiguous.
2. Replace the inline backticks with a placeholder like `[cmd 1 ↓]` or just `(see below)` linking to the pull-out block. Cleaner but adds a click for context.
3. Don't pull out cmds that appear MID-SENTENCE — only pull out ones that appear at the END of a sentence ("...run: `cmd`"). Mid-sentence cmds stay inline.

**Recommended:** path 3 — preserves prose readability for mid-sentence cmd literals (like `<meta>` tags being referenced as documentation, not as runnable commands), and still pulls out end-of-sentence runnable commands (the original intent).

**Cross-ref:** ENH-046 (smoke-walk Copy buttons); the W3-V5 step that surfaced this.

---

### BUG-064: Trash + pinned-close confirmation modals occluded by WCV when a browser tab is active

**Status:** ✅ Shipped v0.6.3 (resolved by ENH-050's full migration)
**Priority:** Medium-high (visible during v0.6.3 walk-1; blocks completing the "delete a tab" path while smoke-walk page is up)
**Filed:** 2026-05-02 (Sprint 1 walk-1 owner observation)
**Shipped:** 2026-05-02 — fixed automatically when ENH-050 retired the in-renderer `<PinnedCloseConfirm>` modal in favor of `dialog.showMessageBox` (system sheets compose natively above the WCV; backdrop dimming is uniform across the viewport). The trash confirm modal in `WorkingTabStrip.tsx`, the pinned-close confirm in `App.tsx`'s ⌘W keymap, and the FileTree's `onTrashEntry` (was `window.confirm`) all now fire as native sheets. No clipping, no occluded buttons, no janky mute-and-restore.

**Owner observation (verbatim):** "tried to context click delete a markdown editor tab while smoke walk html was active; strange confirmation occlusion and inconsistent viewport dimming"

**Repro (from walk-1 screenshot):**
1. Open the smoke-walk page (or any browser-pane tab) and have it as the active working tab.
2. Right-click any file tab → "Move to Trash…".
3. **Observed:** the confirmation dialog appears centered, but the right portion is clipped. The visible text reads "Move to T" and "delete-me / will close." with no Cancel / Trash buttons reachable. The viewport dimming is also patchy — fully present on parts of the screen, missing where the WCV is visible.

**Expected:** the confirmation dialog renders fully on top of all panes (terminal, navigator, working pane regardless of kind) with consistent dimming behind it.

**Root cause:** same WCV-occlusion family as BUG-058 (WorkingTabStrip context menu), BUG-047 (right-click context menu), BUG-006 (Send → Duo pill). The macOS native subview compositor paints `WebContentsView` above all renderer DOM regardless of z-index, so any portal-rendered modal that intersects the WCV's bounds gets clipped where they overlap.

**Where it lives:**
- `WorkingTabStrip.tsx § confirmTrash` state — opens `<PinnedCloseConfirm>`-style modal (or the nearby trash-confirm component) via portal. Need to verify which component file actually renders the trash confirm modal — there are two: `PinnedCloseConfirm.tsx` (for ⌘W on a pinned tab) and likely a similar one for `Move to Trash…`.
- `BrowserManager.setOverlayMuted(muted)` — already exists, used by BUG-058's context-menu fix.

**Fix path (per locked direction in `docs/DECISIONS.md § WCV-occlusion remediation`):**
- Migrate the trash + pinned-close + ⌘W-unsaved confirmation modals to `dialog.showMessageBox` (window-modal sheets that composite natively above the WCV). No `setOverlayMuted` call needed; the OS handles the occlusion correctly via window-server-level rendering.
- Tracked as item 3 of ENH-050's implementation order. When ENH-050 lands, this BUG resolves automatically along with BUG-058's underlying mute jankiness.

**Why NOT extend the mute pattern (the prior direction):** ENH-050's locked decision retires the entire `setOverlayMuted` path for menus/modals — it's the wrong tool for this problem class. Adding more mute logic here would be technical debt that we'd then have to unwind once ENH-050 ships. Hold this BUG for ENH-050's implementation.

**Cross-ref:** ENH-050 (locked direction — replaces this with system sheets); BUG-058 (sibling — same WCV-occlusion family, fixed by the SAME migration); BUG-006 (in-page pill — keeps the `setOverlayMuted` API for itself, not affected); `docs/DECISIONS.md § WCV-occlusion remediation` (full rationale).

---

### BUG-065: ⌘⇧G in navigator triggers blank screen (Rules-of-Hooks violation in Breadcrumb)

**Status:** ✅ Shipped v0.6.3 (root cause identified + fixed; ErrorBoundary stays as defense-in-depth)
**Priority:** **High — blank screen was a hard stop; user couldn't continue any task.**
**Filed:** 2026-05-02 (Sprint 1 walk-1, mid-walk; recurred after the dual-instance blank earlier)
**Shipped:** 2026-05-02 — root cause: classic Rules-of-Hooks violation in `renderer/components/Breadcrumb.tsx`. Two hooks (`scrollerRef = useRef(...)` and the `useEffect([cwd])` that pans the breadcrumb on cwd change) lived BELOW the `if (editing) return <input>...` early-return guard. When `editing` flipped false → true (via ⌘⇧G or clicking the empty area of the breadcrumb), those two hooks stopped being called and React threw "Rendered fewer hooks than expected. This may be caused by an accidental early return statement." The thrown error collapsed the entire React tree to its root — manifested as a blank window because there was no ErrorBoundary anywhere in the renderer until earlier in this same sprint. Fix: lifted both hooks to the top of the component above the conditional return; the useEffect's existing `if (!el) return` guard handles the case where the editing-branch JSX doesn't render the ref'd `<div>`. **Latent since v0.5.4** — every prior ⌘⇧G press has been silently blanking the app; users likely just relaunched without noting the cause. The ErrorBoundary (also shipped v0.6.3) made it visible by surfacing the actual error message instead of a blank window, which is what unblocked the diagnosis.

**Owner observation (verbatim):** "new blanking issue: entered navigator, hit cmd-shift-g, and triggered blank screen (same as prior)" / [after ErrorBoundary made it visible] "cmd shift g cause another crash -- you need to figure this out; cmd-shift-g is a normal, instinctive way to get to a file path, especially when my smoke walks contain paths that are not clickable"

**Captured error from the boundary** (the diagnostic that unblocked the fix):
```
Error: Rendered fewer hooks than expected. This may be caused by an accidental early return statement.
  at Breadcrumb (http://localhost:5173/components/Breadcrumb.tsx:21:28)
  at FilesPane (http://localhost:5173/components/FilesPane.tsx:25:3)
  at App (http://localhost:5173/App.tsx:142:15)
  at ErrorBoundary (http://localhost:5173/components/ErrorBoundary.tsx:7:5)
```

**Mitigation kept as defense-in-depth:** the new `ErrorBoundary` component at `renderer/components/ErrorBoundary.tsx` wraps the React root in `main.tsx`. Future render errors of any class will surface as visible fallback panels (with message + stack + Reload button) instead of blanking the window. The window-level `error` / `unhandledrejection` listeners stay too. This is the new floor — any future "blank screen" report should now have a captured error message instead of being a black box.

**Cross-ref:** dual-instance blank earlier in the same walk (different cause, same symptom — both surfaced the vulnerability that the boundary now plugs).

---

### ENH-051: Enterprise distro setting to toggle which packs auto-install + auto-open

**Status:** ✅ Shipped v0.6.1 — `fork.config.json § packs.disabled` array filters at PackLoader scan + install-service copy via Vite-injected `__DUO_PACKS_DISABLED__`. Status was stale ("🆕 Filed") in tasks.md until the v0.6.4 sprint triage caught it; the implementation matched the v1 plan below.
**Priority:** Medium (unblocks "many demo lessons in the repo" — the user's framing).
**Filed:** 2026-05-02 (post-v0.6.0 owner request)

**Owner framing (verbatim):** "I think we are going to build a bunch of demo lessons, which is fine to include in the repo as the file sizes are small, but it would be good to be able to toggle them on / off in the enterprise distro settings."

**Context:** Today, Stage 18b's `PackLoader` scans `~/.claude/duo/packs/` at boot. Every directory there is a pack; every pack's `PACK.json § defaults[].openOnFirstLaunch:true` triggers an auto-open on first launch. There's no per-fork mechanism to opt OUT of a pack: shipping `intro-to-duo` in the upstream repo means every fork installs it, and every fork's first-launch FTUX shows it. An enterprise fork that has its own onboarding flow gets the upstream `intro-to-duo` whether they want it or not.

**What's wanted:** a `packs` section in `fork.config.json` that controls per-pack enable/disable + (later) extra-pack-dir paths. Per-fork, gitignored — so upstream Duo ships the full set and forks pick.

**Proposed schema (v1):**

```json
{
  "$comment": "fork.config.json — copy from fork.config.default.json and edit.",
  "appId": "com.example.duo",
  "productName": "Example Duo",
  "publish": { ... },
  "bootstrap": { ... },
  "packs": {
    "$comment": "Per-pack toggle. Packs not listed here use their PACK.json defaults (auto-open on first launch). Listed-as-false packs are SKIPPED entirely — the install service does NOT copy them into ~/.claude/duo/packs/, the PackLoader does NOT scan them, and the first-launch hook does NOT fire NAV_EDIT for their defaults. Listed-as-true is the same as not-listing (sane default).",
    "disabled": [
      "intro-to-duo",
      "lesson-cap-one-aip"
    ],
    "extraDirs": [
      "$comment": "v2 — fork-private packs that ship outside the upstream repo (e.g. an internal lesson set in a separate enterprise repo or a network share). v1 ignores this; v2 adds rsync support.",
      "/path/to/internal/packs"
    ]
  }
}
```

**Implementation v1 (core):**
1. `fork.config.default.json` → add empty `packs: { disabled: [] }` section as the canonical schema.
2. `core/pack-loader.ts § scan` → consult fork-config's `packs.disabled` list before classifying a directory as a pack. Skipped packs aren't even loaded — `errors[]` doesn't get an entry, the directory just isn't seen.
3. `electron/install-service.ts` → when copying upstream `packs/*` into `~/.claude/duo/packs/`, skip any pack on the disabled list. Forks that disable `intro-to-duo` don't even get its files copied.
4. CLI: `duo packs --include-disabled` to list what's there + what's filtered out (without this flag, only enabled packs show).

**Implementation v2 (queued):**
- `extraDirs` — let forks point at additional pack source dirs (network share, separate enterprise repo). PackLoader scans them too. install-service copies on first launch.
- A per-pack `enabled` flag that's a boolean (vs. opt-out via list) — slightly more verbose but symmetric with future per-pack overrides (e.g. `enabled: false`, `forceFirstLaunchOpen: false`).

**Why pack on/off is the right primitive (vs. "demo mode" flag):**
The user's framing — "many demo lessons in the repo, toggle them on/off in enterprise distro settings" — implies they want SOME packs available + others disabled. A single "demo mode" boolean would force the full set on/off; per-pack control is what enterprise customization actually needs.

**Cross-ref:** Stage 18b (pack format + loader); ENH-045 (Project Claude Context navigator improvements — its v1d "new project skill" might want to use this same mechanism for project-template packs); fork.config.default.json (the schema).


### ENH-052: Mechanical rename of internal "canvas" → "page"/"playground" identifiers

**Status:** ✅ **Shipped v0.6.5** (Sprint 4 Phase 1, single self-contained commit). 177 edits across 32 files. Renamed:
- `WorkingTab.kind === 'html-canvas'` → `'page'` (type-system level)
- `renderer/components/HtmlCanvas/` → `renderer/components/Page/` (directory)
- `CanvasTab` → `PageTab`, `RenderedCanvas` → `RenderedPage` (components)
- `installCanvasActions` → `installPlaygroundActions`, `installCanvasSelection` → `installPageSelection`, `installCanvasPasteHandlers` → `installPagePasteHandlers` (listeners — `Playground` for action verbs, `Page` for surface-level features that apply to both pages and playgrounds)
- `CanvasAction` → `PlaygroundAction` (in `shared/host-api.ts`)
- `HtmlCanvasSelectionSnapshot` → `PageSelectionSnapshot`
- `IPC.CANVAS_*` → `IPC.PAGE_*` and channel strings `'canvas:*'` → `'page:*'`
- File names: `canvasActions.ts` → `playgroundActions.ts`, `canvasSelection.ts` → `pageSelection.ts`, `canvasPaste.ts` → `pagePaste.ts`, `canvasEditorActions.ts` → `pageEditorActions.ts`, `justAddedCanvas.ts` → `justAddedPage.ts`
- CSS keyframe `duo-canvas-action-flash` → `duo-playground-flash`; console prefix `[duo-canvas-action]` → `[duo-playground]`
- Active-surface markdown updated: `skill/SKILL.md`, `agents/duo.md`, `docs/CLI-COVERAGE.md`, `skill/playground-interaction.md`, `docs/dev/smoke-checklist.md`, `CLAUDE.md` glossary

**Intentionally deferred (separate follow-up):**
- `skill/examples/canvas-templates/` rename → external API surface; users may have authored skills referencing this path
- `skill/examples/canvas-actions.md` → same reason
- `skill/examples/html-canvas-authoring.md` → same reason
- `~/.claude/duo/packs/<name>/canvases/` subdirectory rename → would break installed user packs without migration logic
- Historical references in `tasks.md`, `docs/roadmap.html` (Stage 17 cards), `docs/DECISIONS.md`, `CHANGELOG.md`, `RELEASES.md`, `docs/research/` — leave as historical record per task entry

**Verification:** typecheck clean, Vitest 104/104 pass, `npm run build` succeeds.

---

**Original spec (preserved for context):**

**Priority:** Low (UX-neutral; internal hygiene). Defer until other v0.6.x work settles.
**Filed:** 2026-05-02 (post-v0.6.0 — terminology lock)

**Owner clarification (2026-05-02):** "canvas is the right pane work area, type agnostic; page is an html canvas tab — basic; as you add interactivity, esp between page and agent, it is a playground; playgrounds are a good way to build a lesson—but they are also good start tabs as people start to customize their duo"

**Context:** The CLAUDE.md glossary now distinguishes:
- **canvas** — the right pane (slot, type-agnostic) — UNCHANGED meaning
- **page** — a basic HTML tab inside the canvas (no actions/events) — NEW
- **playground** — a page with interactivity (data-duo-action, data-payload-from, duo:event) — NEW
- **lesson** — playground + paired guide skill — NEW
- **start tab** — a playground that auto-opens on first launch — NEW

The v0.6.1 vocabulary lock renamed the EXTERNAL surface:
- `skill/canvas-authoring.md` → `skill/playground-authoring.md`
- `skill/canvas-interaction.md` → `skill/playground-interaction.md`

The INTERNAL surface still uses "canvas":
- `WorkingTabType: 'html-canvas'` (should rename to `'page'`)
- `renderer/components/HtmlCanvas/` directory + ~20 files inside
- `skill/examples/canvas-templates/` directory
- `~/.claude/duo/packs/<name>/canvases/` (per-pack subdirectory naming convention)
- `CanvasTab` / `RenderedCanvas` component names
- `canvasActions.ts` / `canvasSelection.ts` / `canvasPaste.ts` / etc.
- `'CANVAS_*'` IPC channel names
- `installCanvasSelection` / `installCanvasActions` / `installCanvasPasteHandlers` exports
- ENH-022's `duo doc goto --anchor` → `duo html *` verbs (these stay since "html" is correct, but tasks.md docs say "canvas" in many places)

**What's wanted:** a focused mechanical rename PR that touches every internal "canvas" identifier and renames to either "page" (basic) or "playground" (interactive) per context. Most things are pages → playgrounds, so default to "playground" for interactive surfaces and "page" only when the basic-no-interactivity tier is meaningful.

**Risk profile:** mechanical, but high blast-radius (touches 50+ files). Best done as ONE focused PR that's never merged piecemeal — a half-renamed codebase is worse than the current state. Prefer a worktree branch for the rename so the diff is reviewable in one go.

**Suggested order (per file group, atomic):**
1. `WorkingTabType` enum rename `'html-canvas'` → `'page'`. Touch: shared/types.ts, fileClassifier.ts, every consumer doing `kind === 'html-canvas'` (~15 files).
2. Component dir rename: `renderer/components/HtmlCanvas/` → `renderer/components/Page/`. Update imports.
3. File rename inside: `CanvasTab.tsx` → `PageTab.tsx`, `RenderedCanvas.tsx` → `RenderedPage.tsx`, `canvasActions.ts` → `pageActions.ts`, etc.
4. IPC channel renames: `CANVAS_*` → `PAGE_*` (or keep CANVAS_ as the wire-format constant; user-facing names stay aligned with the new vocab).
5. Per-pack subdirectory: `canvases/` → `pages/` in PACK.json defaults references + the existing two packs (`intro-to-duo`, `claude-code-basics`).
6. `skill/examples/canvas-templates/` → `skill/examples/playground-templates/` (these ARE playgrounds — they have action verbs).
7. `tasks.md` historical references — leave as-is for closed entries; the rename only applies to new entries going forward.

**Cross-ref:** v0.6.1 vocabulary lock commit (the external rename — skill files + glossary); ENH-053 (lesson template/runtime — wants the new vocabulary); ENH-054 (user entry point — same).

---

### ENH-053: Canonical lesson template + runtime helper skill (closes meta-goal gaps 2 + 3)

**Status:** ✅ **Shipped v0.6.1.** Three new artifacts:
- `skill/examples/lesson-template/` — paired playground.html + lesson-skill/SKILL.md skeleton + README. Copy-and-customize entry point for new lessons. Three stable paint regions (`step-counter` / `step-body` / `step-controls`); canonical event names (`lesson:step-N-done` / `lesson:restart` / `lesson:done`); TODO markers throughout.
- `skill/lesson-runtime.md` — the canonical event-loop pattern. Documents the playground↔skill conversation contract, sidecar state schema (`~/.claude/duo/lesson-state/<pack>.json` with cursor for resume), the foreground-polling vs. subagent-watch patterns, anti-patterns. Read this BEFORE writing a lesson skill.
- `skill/playground-authoring.md § Lessons specifically` — new section that points authoring agents at the template + runtime, with explicit "don't invent a new structure each time" framing.

The existing intro-to-duo and claude-code-basics packs are NOT yet refactored to use the canonical pattern — they were authored before this template existed. Refactoring them is queued (when ENH-054 / ENH-055 land they'll need the canonical shape too).

**Priority:** **High — load-bearing for the meta-goal.** Without this, every lesson is a snowflake.
**Filed:** 2026-05-02 (post-v0.6.0 meta-goal gap analysis)

**Meta-goal context (owner framing):** "Users, who don't yet understand what a canvas (is this more of a playground?) really is need to be able to give Claude/duo high level instructions (I want to make a training/guide) and Claude/duo need to understand the patterns and primitives, both for the interface and the accompanying lesson skill."

**Gap 2 — no canonical lesson-skill template.** The two example packs (`intro-to-duo`, `claude-code-basics`) each invented their own SKILL.md structure:
- `intro-to-duo/lesson-skill/SKILL.md` — single-step, single-canvas. Walks the user through the lesson via direct Claude conversation.
- `claude-code-basics/lesson-skill/SKILL.md` — multi-step, multi-canvas. Different structure entirely.

A third lesson would invent a third structure. We need a **canonical template** that says: "here's how a lesson skill is laid out — frontmatter, step-state machine, event-loop reference, how to paint into `data-duo-pane` regions." Future lessons extend this rather than starting from scratch.

**Gap 3 — no runtime helper for the page↔skill conversation.** The current pattern: playground emits `duo:event step-complete`, skill listens via `duo events --follow`, parses, then writes content via `duo doc write` or `duo html update`. Every lesson skill re-implements this loop manually. The boilerplate is substantial — error handling, cursor resumption on reconnect, distinguishing this-lesson's events from other events on the bus, gracefully stopping when the user closes the lesson tab.

**What's wanted (v1):**
1. **Lesson template at `skill/examples/lesson-template/`** — a paired `playground.html` + `lesson-skill/SKILL.md` skeleton. Comments call out the points where authors customize (step content, transition conditions, completion check). The template uses canonical step-state, canonical event names (`lesson:step-start`, `lesson:step-complete`, `lesson:done`), and canonical `data-duo-pane` regions (`step-content`, `step-feedback`, `step-controls`).
2. **`skill/lesson-runtime.md` skill** — explains the canonical event-loop. When Claude reads this skill, it knows how to: subscribe to `duo events --follow --since <cursor>` filtered to the current lesson, react to step-complete by paint-into-pane, react to step-skip by branch, react to lesson-done by celebrate + close. Also describes the cursor-persistence pattern (write cursor to a sidecar JSON so reconnects resume).
3. **Update `playground-authoring.md`** — add a "Lessons specifically" section that points at the template + runtime + canonical events.

**v2 (queued):**
- A `duo lesson scaffold <name>` CLI verb that copies the template into `~/.claude/duo/packs/<name>/` with the directory structure pre-populated.
- A `duo lesson preview <name>` CLI verb that opens the playground + auto-spawns Claude with the lesson skill, so the author can fly through the lesson to test it.

**Cross-ref:** ENH-054 (user entry point — the "I want to build a training" surface uses this template); ENH-049 (the `claude:spawn` data-cmd semantic that lessons rely on); Stage 28 lesson packs (today's snowflakes — both refactored to use the new template once it lands).

---

### ENH-054: User entry point for "I want to make a training/guide" (closes meta-goal gap 1)

**Status:** ✅ **Resolved v0.6.1 via skill-description tuning, NOT a CLI verb.** Owner pushed back on the proposed `duo lesson new <name>` CLI: "A cli verb for lesson seems like overkill" — and the FTUX user (the meta-goal target) doesn't yet know `duo` is a CLI, so a CLI entry point is hostile to the audience. The right primitive is **skill recognition**: when a user says "build me a training" / "make a guide" / "create a lesson" / "teach my team X" / "interactive demo" / etc., Claude's harness auto-loads the right skill from its YAML frontmatter `description` matcher. The skill (currently `make-playground.md`) then walks the agent through copying `examples/lesson-template/` and customizing.

The v0.6.1 commits that close this:
- `04cd9b5` (terminology lock) — defines what a "lesson" IS so skill descriptions can describe it precisely
- `f01559b` (canonical lesson template + lesson-runtime skill)
- `3a90c7b` (skill split: `make-playground.md` frontmatter description deliberately broad — fires on any "interactivity" trigger phrase per owner's "Playground front matter should be pretty open" direction)

What's NOT shipping with this entry: a discoverable button surface (e.g. "Build a new lesson" CTA on the welcome page). Filed as a v0.6.x candidate if user-side trigger discovery proves insufficient — but the natural-language trigger is the cleaner primitive: users already know how to ask Claude for things; the CLI is overhead.

**Priority:** Resolved.
**Filed:** 2026-05-02 (post-v0.6.0 meta-goal gap analysis)

**Meta-goal:** A user with no understanding of canvas/page/playground/lesson terminology says "I want to build a training" and gets there. Today there's no canonical entry point — a Claude session would need to invoke the playground-authoring skill manually + improvise scaffolding.

**What's wanted:** a discoverable invocation that scaffolds a new lesson from a brief description. Two candidate shapes:

**Option A — CLI:** `duo lesson new <name>` — interactive prompt asks "what topic" / "how many steps" / "single playground or multi-playground", scaffolds `~/.claude/duo/packs/<name>/` from the ENH-053 template, opens the new playground in the canvas, optionally `claude:spawn`s a Claude tab with the lesson skill pre-loaded.

**Option B — Canvas action:** a "build a lesson" button on a meta-playground (perhaps `intro-to-duo`'s welcome page gets a "build your own lesson" button next to "start the demo lesson"). Click → fires `claude:spawn` with a data-cmd that points the agent at `lesson-runtime.md` + the canonical template, with the user's intent as the first message ("I want to build a lesson on X").

**Recommended: both.** A is for power users + agents that already know to reach for it; B is for the FTUX user who doesn't yet know `duo` is a CLI.

**Sequencing:** ENH-053 first (template + runtime); this ENH builds on top of that.

**Cross-ref:** ENH-053 (template the entry point copies from); ENH-049 (claude:spawn data-cmd is the mechanism Option B uses).

---

### ENH-055: Lesson preview / fly-through harness (closes meta-goal gap 5)

**Status:** ✅ **Shipped v0.6.2 — primitive + procedure doc.** Two artifacts:
- New CLI verb `duo html click --id <duo-id>` / `--selector <css>` (the missing primitive). Resolves the target, calls `element.click()` on the matched HTMLElement. Triggers the canvas-action delegated dispatcher just like a user click — `data-duo-action` verbs fire, events emit, downstream paint ops execute. Wired through `HtmlOpRequest` discriminated union, `htmlOps.ts § runClick`, CLI parser, help text, and the `agents/duo.md` cheat-sheet. CanvasTab.tsx skips the recentEdit log path for clicks (clicks don't mutate the canvas DOM directly; downstream mutations are caught by the existing MutationObserver).
- New skill `skill/lesson-flythrough.md`. Frontmatter description deliberately broad — fires on "fly through this lesson", "test my new lesson", "preview the lesson", "validate the lesson runs", "smoke-test this playground", "step through the lesson automatically", "make sure the lesson works end-to-end". Documents the canonical harness loop: open playground → start `duo events --follow` in a separate terminal → enumerate buttons → `duo html click` each in canonical step order → wait for matching events → verify paint regions advanced → report pass/fail per step. Includes edge cases (form-gated steps, multiple buttons matching, paint-without-event, browser blocking the playground) and anti-patterns ("don't substitute manual clicking").

Closes meta-goal gap 5 from the v0.6.0 zoom-out. Combined with ENH-053 (canonical lesson template) + ENH-054 (skill-recognition entry point), the meta-goal arc is complete: a non-expert user can ask Claude for a training, get one built from canonical conventions, and have Claude fly-through-test it before shipping.

**No `duo lesson preview <pack>` CLI wrapper** — same reasoning as ENH-054 ("A cli verb for lesson seems like overkill"). The skill description is the entry point; users say "fly through my lesson" and Claude loads the harness.
**Priority:** Medium (downstream of ENH-053). Without it, lesson authors can't reliably test what they built.
**Filed:** 2026-05-02 (post-v0.6.0 meta-goal gap analysis)

**Context:** A user (or Claude on the user's behalf) authors a new lesson via ENH-053's template + ENH-054's entry point. They want to TEST it before shipping. Today there's no harness — they'd manually click each button, watch events, eyeball the state transitions. Bugs surface at smoke-walk time rather than authoring time.

**What's wanted:** a harness that fires every action verb in the playground's HTML, observes the resulting events, validates the lesson runs end-to-end without manual intervention. Output: a pass/fail report that says which steps the lesson advanced through cleanly + which got stuck.

**Implementation sketch (v1):**
1. `duo lesson preview <pack-name>` CLI verb. Opens the playground + auto-spawns Claude with the lesson skill.
2. Agent-side: read the playground's HTML, enumerate action buttons in document order, simulate clicks via `duo html click <selector>`, observe event stream via `duo events --follow`, advance step-by-step.
3. After each click: assert the expected event fires + the expected `data-duo-pane` repaints.
4. Report at end: "Step 1 → 2 → 3 → done" or "Step 2 stuck; expected event 'lesson:step-complete' but got 'lesson:step-error'."

**v2 (queued):**
- Snapshot-based regression: capture a "golden" event stream on first preview pass; subsequent runs assert the stream matches (plus tolerance for non-deterministic content).
- Coverage report — which buttons fired, which paths through the lesson got walked, which branches are unreachable.

**Cross-ref:** ENH-053 (template — defines the canonical events the harness asserts on); ENH-054 (entry point — preview is the natural next step after authoring).


### ENH-056: Multi-canvas curriculum template (sibling of lesson-template)

**Status:** ✅ **Shipped v0.6.2.** Three artifacts at `skill/examples/curriculum-template/`:
- `canvases/orientation.html` — the launcher. Lists modules with status (locked / available / completed); each module card has a "Start module" CTA emitting `lesson:module-<id>-launch`. Stable paint regions: `[data-duo-pane="curriculum-progress"]` (overall), `[data-duo-pane="module-<id>"]` (per module).
- `canvases/module-template.html` — copy per-module (rename to `module-A.html`, `module-B.html`, ...). Same canonical step regions as `lesson-template/playground.html` (`step-counter` / `step-body` / `step-controls`); final step's CTA fires `lesson:module-<id>-done` instead of `lesson:step-N-done`.
- `lesson-skill/SKILL.md` — orchestrator skeleton. Documents the cross-canvas event flow (launch → editor:open switch → in-module steps → done → editor:open back to orientation), prerequisite checks, sidecar state extension (per-module completion tracking + `currentModule`).
- `README.md` — how to use the template + the linear-vs-curriculum decision matrix.

`lesson-runtime.md § Curriculum case` extended to cover the multi-canvas case alongside the linear case (event names, sidecar schema, orchestrator flow). `make-playground.md § Lessons specifically` updated with the two-shapes table pointing at both templates.

The existing `claude-code-basics` pack (which prompted filing this ENH) is NOT yet refactored to the canonical curriculum template — its event names were updated to `lesson:` prefix in v0.6.1 but its structure stays as authored. Refactoring is queued for the next time someone touches that pack content.

**Priority:** Medium (downstream of ENH-053; needed when the next multi-canvas pack lands).
**Filed:** 2026-05-02 (post-v0.6.1 — surfaced while refactoring claude-code-basics)

**Context:** ENH-053 shipped a canonical `lesson-template/` for SINGLE-CANVAS LINEAR LESSONS — one playground.html with N steps, three stable paint regions (`step-counter` / `step-body` / `step-controls`), event names like `lesson:step-N-done`. Works for `intro-to-duo` (now refactored to canonical event names + paint regions in v0.6.1).

**The gap:** `claude-code-basics` is a MULTI-CANVAS curriculum — an orientation launcher (`00-orientation.html`) plus 7 family canvases (`01-mental-model.html` through `07-authoring.html`). User picks a family from orientation; the family canvas loads; user finishes; emits `lesson:family-A-done`; orientation refreshes to mark the family complete; user picks next. This shape doesn't fit `lesson-template`'s single-playground assumption — and shouldn't: it's a different lesson topology (curriculum vs. linear walk).

**What's wanted:** a sibling template at `skill/examples/curriculum-template/` for multi-canvas curricula. Canonical structure:

- `orientation.html` — the launcher; lists modules; shows progress per module.
  - Stable panes: `[data-duo-pane="curriculum-progress"]` (overall %), one paint region per module (`[data-duo-pane="module-A"]`, `module-B`, etc.) showing locked / available / completed state.
  - Buttons emit `lesson:module-<id>-launch` to open a module canvas (the skill responds via `editor:open` to switch the working tab).
- `module-<id>.html` per module — content + a final "Done with this module" button that emits `lesson:module-<id>-done`.
- `lesson-skill/SKILL.md` — orchestrates the cross-canvas state. Reads sidecar at `~/.claude/duo/lesson-state/<pack-name>.json`; updates orientation when modules complete.

**Sidecar state schema (curriculum):**

```json
{
  "schemaVersion": 1,
  "kind": "curriculum",
  "packName": "claude-code-basics",
  "modules": {
    "A": { "completed": true, "completedAt": "..." },
    "B": { "completed": true, "completedAt": "..." },
    "C": { "completed": false }
  },
  "completed": false,
  "lastEventCursor": "..."
}
```

**v1 scope:** template + runtime helper section in `lesson-runtime.md` describing the curriculum case alongside the linear case. Update `make-playground.md § Lessons specifically` to mention "two shapes — linear (use lesson-template) or curriculum (use curriculum-template)."

**Cross-ref:** ENH-053 (linear lesson template that this extends); `packs/claude-code-basics/` (the existing multi-canvas pack that prompted this — its events are now `lesson:`-prefixed in v0.6.1, but its structure should migrate to this template once it exists).

---

### BUG-066: Clawd glyph clipped on top edge + uses fixed orange instead of currentColor

**Status:** ✅ Shipped v0.6.3
**Priority:** Low (cosmetic; visible in walk-1)
**Filed:** 2026-05-02 (Sprint 1 walk-1 owner notes)
**Shipped:** 2026-05-02 — two issues in `renderer/components/TabBar.tsx § ClawdGlyph` from ENH-044's initial pass:
1. **Top clipping** — the original SVG path's MIN y is 1122.52 (transformed: 35.05), not 1218 as I'd misread when computing the cropped viewBox. The viewBox `27.4 38.2 38.3 22.4` cut off ~3 units at the top of the creature. Corrected to `27 35 39 26` so the full silhouette renders.
2. **Fixed orange** — the body fill was hardcoded `#c15f3c`, ignoring the button's text color. Owner: "should not be orange — should match rest of atelier buttons." Fix: switched body to `fill="currentColor"`. The button now has the standard `text-ink-mute hover:text-ink` class so the glyph follows that pattern (matches Plus, Right Caret, ClaudeIcon, TerminalIcon all in the same strip). Eyes stay `#ffffff` as visual cutouts that read against any body color.

---

### BUG-067: `duo open <path.md>` opens in browser instead of editor

**Status:** ✅ Shipped v0.6.3
**Priority:** Medium (UX mismatch — verb name doesn't match expectation)
**Filed:** 2026-05-02 (Sprint 1 walk-1 owner notes)
**Shipped:** 2026-05-02 — fix scoped to `core/socket-server.ts § case 'open'`. `duo open` now detects `file://` URLs (the form `cli/duo.ts § resolveOpenTarget` produces for local paths), decodes them to a local path, confirms the file exists on disk, and routes through `NavBridge.edit` — the same path `duo edit` uses, which fans out to the renderer's `openFileSmart`. That smart router already has the per-kind logic: .md / non-HTML → markdown editor (canvas tab), .html WITHOUT `<meta duo-open-in="browser">` → editor, .html WITH the meta → browser pane (BUG-059's dedup applies). Web URLs (http / https / chrome / data / etc.) and unresolvable file:// paths fall through to the original `BrowserManager.openTab` behavior. The `browser:focus-gained` event sink push (BUG-048 v2) is now gated on the browser path only — editor-routed opens get their own focus push via `NAV_EDIT` in the renderer. No CLI-surface change; `duo open` semantics now match user expectation ("do the right thing for the kind of thing I'm pointing at").

**Owner observation (verbatim):** "attempted to open a markdown file via CLI -- failed to perform as expected: `duo open ~/.claude/skills/duo/make-page.md` --> opened in browser; expected behavior -- command would have opened in duo editor"

**Repro:**
1. Run `duo open ~/.claude/skills/duo/make-page.md` from a terminal.
2. **Observed:** the .md file opens as a browser tab (file:// URL).
3. **Expected:** opens in the markdown editor (a canvas tab on the working pane), the way clicking the file in the navigator would.

**Root cause:** `core/socket-server.ts § case 'open'` routes unconditionally to `BrowserManager.openTab(url)`, which always lands the URL in the browser pane. The CLI verb `duo open` is currently semantically "open URL in browser pane." There's a separate `duo edit <path>` verb that opens in the editor — but the user's mental model is "open does the right thing for the file kind."

**Three fix paths:**
1. **Make `duo open` smart** — for local file paths, route through the same logic as `openFileSmart` (HTML files honor `<meta duo-open-in>`, .md files open in editor, etc.). For URLs (http/https), keep the browser-pane semantics. **Recommended.** Matches the renderer-side UX one-to-one.
2. **Add a new `duo show <path>` verb** that's the smart one; keep `duo open` as browser-only. Makes the semantics explicit but adds another verb to learn.
3. **Document `duo edit <path>` as the editor-routing verb.** No code change. Fragile — relies on muscle memory of two verbs.

**Cross-ref:** BUG-059 (renderer + CLI dedup; same path-handling family); `core/socket-server.ts § case 'open'`; `App.tsx § openFileSmart` (the renderer-side smart routing).

---

### BUG-068: New-tab buttons in working-pane tab strip get hidden when panned far / many tabs (terminal strip is sticky)

**Status:** ✅ Shipped v0.6.3
**Priority:** Medium (workflow paper-cut — when you have many tabs you most need the new-tab button, but it scrolls off)
**Filed:** 2026-05-02 (Sprint 1 walk-1 owner notes)
**Shipped:** 2026-05-02 — `WorkingTabStrip.tsx` restructured to mirror `TabBar.tsx`'s sticky pattern. Tabs now render inside a `flex-1 overflow-x-auto` scroller; the new-tab split-button cluster (`+` for new file + globe for new browser tab) sits as a sibling OUTSIDE that scroller. Pre-fix the cluster was inside the scroller and would scroll off-screen with the tabs. Now the new-tab cluster stays pinned to the right edge regardless of how many tabs / how far the user pans. Folded in as part of the ENH-050 WorkingTabStrip rewrite.

**Owner observation (verbatim):** "current handling of new tab buttons is inconsistent -- for terminal pane, buttons for new claude session/new vanilla terminal are sticky/always visible; for new canvas tab, they are not and can be hidden when we are panned too far left/have many tabs; prefer sticky"

**Where it lives:**
- `renderer/components/TabBar.tsx` (terminal strip) — split-button (`[clawd]` + `[>]`) sits OUTSIDE the `overflow-x-auto` scroller, so it's pinned to the right edge of the strip regardless of how many tabs / how far the user pans. ✓ Correct behavior.
- `renderer/components/WorkingTabStrip.tsx` (working pane strip) — the new-tab split button (`[+]` + `[>]`) is INSIDE the `overflow-x-auto` scroller, so when there are enough tabs to overflow horizontally, the buttons disappear off-screen as the user scrolls.

**Fix:** restructure `WorkingTabStrip.tsx` to mirror TabBar's pattern — separate the scrolling tab list from the right-edge new-tab cluster. Wrap the tab map in a `flex-1 overflow-x-auto` div, then place the new-tab cluster as a sibling outside that overflow container. The cluster stays pinned regardless of scroll position.

**Cross-ref:** TabBar.tsx (the reference implementation that does this correctly); ENH-024 (active-tab scroll-into-view, which already handles the "active tab visible" half of strip ergonomics).

---

### ENH-066: Collapsed-pane vertical bar with icon (discovery affordance for ENH-040)

**Status:** ✅ Shipped v0.6.3
**Priority:** Medium (extends ENH-040 with discovery; owner specifically asked for this in walk-1)
**Filed:** 2026-05-02 (Sprint 1 walk-1 owner notes)
**Shipped:** 2026-05-02 — `renderer/components/CollapsedPaneRail.tsx` is the new shared rail component (mirrors `FilesPane.tsx § CollapsedRail`'s pattern). When `splitPct === 0` (terminal collapsed) or `splitPct === 100` (canvas collapsed), the corresponding pane wrapper renders a fixed-width 36px clickable rail INSTEAD of the regular content. The rail shows a kind-appropriate glyph (terminal mark for terminal, document-like mark for canvas) plus a vertical Atelier-italic "terminal" / "canvas" label rotated to read bottom-to-top. Click → fires the existing `toggleCollapseTerminal` / `toggleCollapseCanvas` (ENH-040) which restores `prevSplitPct`. The titlebar collapse buttons stay too — owner framing: titlebar = "I want to collapse this deliberately"; rail = "I'd forgotten this pane existed and want it back."

**Owner observation (verbatim):** "I don't love those buttons or where they are placed, so we should add that as a polish item for the future / collapsed state should include a vertical bar with icon, like the navigator's collapsed state, allowing easier discovery and expansion"

**What's wanted:** when a pane is fully collapsed (terminal at 0% or canvas at 0%), the seam should NOT be a 0-width nothing — it should be a thin vertical bar (~24-44px) with an icon hint indicating the collapsed pane. Click the bar OR drag it to restore. Mirrors the `CollapsedRail` pattern that the file navigator already uses for its collapsed state (see `FilesPane.tsx § CollapsedRail`).

**Scope (rough):**
1. When `splitPct === 0` OR `splitPct === 100`, render a `CollapsedRail`-style vertical bar in the collapsed pane's slot instead of an actual 0-width column.
2. Bar contains a small icon (terminal mark for the collapsed terminal; canvas mark for the collapsed canvas) and acts as a click target → calls `toggleCollapseTerminal` / `toggleCollapseCanvas`.
3. The titlebar buttons from ENH-040 stay (different mental model: "I want to deliberately collapse this" vs. the bar's "I'd forgotten this pane existed; let me get it back"). Owner's framing: "I don't love those buttons or where they are placed" — when the bar lands, we may also rethink the titlebar buttons (drop or move them — separate decision).

**Cross-ref:** ENH-040 (the parent collapse mechanism this extends); `FilesPane.tsx § CollapsedRail` (the visual / interaction pattern to mirror).

---

### ENH-067: "Your Claude settings" section should include `~/.claude/duo/`

**Status:** ✅ Shipped v0.6.3
**Shipped:** 2026-05-02 — added `'duo'` to the curated entries list in `renderer/components/UserClaudePane.tsx`. Existing render logic already handles missing entries gracefully (the entry hides when `~/.claude/duo/` doesn't exist). One-file change.
**Priority:** Medium (closes the "Duo's own files are user-Claude context too" framing)
**Filed:** 2026-05-02 (Sprint 1 walk-1 owner notes)

**Owner observation (verbatim):** "your claude settings section should include duo/"

**Context:** `UserClaudePane.tsx` (top of the navigator) curates `~/.claude/` showing CLAUDE.md, skills/, agents/. Today it does NOT show `~/.claude/duo/` — but Duo's pack files, external-domains config, priming.md, lesson state, install receipts, and help HTMLs all live under `~/.claude/duo/`. Surfacing it makes the "Duo is part of your user-level Claude context" story complete and gives the user a navigator-side path to the help files / packs / priming customization.

**Implementation:** add `'duo'` to the curated entry list in `UserClaudePane.tsx` (alongside `CLAUDE.md`, `skills`, `agents`). Same tree-row interaction model. Test: opens at `~/.claude/duo/` if it exists; hidden if absent (e.g. for users who haven't run the install).

**Cross-ref:** Stage 22 (UserClaudePane initial implementation); `~/.claude/duo/` ownership (Stage 18 install service); ENH-045a (sibling navigator polish — the "Project Claude context" section).

---

### ENH-068: Browser-tab `>` glyph should be a globe (or browser-like icon)

**Status:** ✅ Shipped v0.6.3
**Priority:** Low (cosmetic)
**Filed:** 2026-05-02 (Sprint 1 walk-1 owner notes)
**Shipped:** 2026-05-02 — `WorkingTabStrip.tsx`'s `BrowserGlobeGlyph` component replaces the prior `>` chevron in the new-browser-tab split-button half. Globe (circle + meridians via two SVG paths) at viewBox `0 0 11 11`, currentColor for theming. Mirrors the visual language of TerminalIcon's globe-line treatment. The `>` chevron stays in `TabBar.tsx` (terminal strip) where its semantic — "secondary, lesser-used shell-tab option" — is correct.

**Owner observation (verbatim):** "current button for new browser tab is `>`, should be something more obviously browser like -- like a globe image or something"

**Context:** `WorkingTabStrip.tsx` and `TabBar.tsx` both have a `>` chevron as the secondary half of their split-button. In TabBar the `>` opens a vanilla shell tab — meaning is "secondary, less-default." In WorkingTabStrip the `>` opens a NEW BROWSER TAB — but `>` doesn't suggest "browser." A globe / world icon would be clearer.

**Scope:**
1. New `BrowserGlyph` component (sibling of `ClawdGlyph`) — small globe SVG.
2. Replace the `>` in `WorkingTabStrip.tsx`'s secondary half. Keep `>` in TabBar.tsx (semantically correct there: "the lesser-used shell-tab option").
3. Sizing + currentColor + Atelier convention same as the rest.

**Cross-ref:** ENH-044 (clawd glyph for the Claude side); BUG-066 (clawd glyph corrections — same convention).

---

### ENH-069: Toggle-able line numbers in markdown editor

**Status:** ✅ Shipped v0.6.3 (v1 — block-level numbering; v2 visual-line numbering still queued)
**Priority:** Low-medium (handy for code-heavy docs; not blocking)
**Filed:** 2026-05-02 (Sprint 1 walk-1 owner notes)
**Shipped:** 2026-05-02 — v1 implementation in `renderer/components/editor/MarkdownEditor.tsx` + a CSS rule in `renderer/styles/globals.css`. State `lineNumbers: boolean` initialized from `localStorage['duo:editor-line-numbers']` (`'1'` / `'0'`); persists on every change. The data attribute `data-line-numbers="true"` lands on the inner editor wrapper when enabled; CSS counter (`counter-reset: duo-line` / `counter-increment: duo-line`) on every direct child of `.ProseMirror` produces a `::before` gutter number rendered in monospace at 0.72rem in `--duo-ink-ghost`. A small "Lines" toggle button sits sticky at the bottom-left of the editor scroll-host (low-contrast when off, accent-bg when on). Counts BLOCKS (paragraphs, headings, list items, blockquotes), not visual wrapped lines — wrapped paragraphs count as one. v2 (true visual-line numbering) requires a ProseMirror plugin with `view.posAtCoords` reflow detection; queued for if v1 doesn't solve the user's need.

**Owner observation (verbatim):** "toggle-able line numbers in .md editor"

**Context:** TipTap-backed markdown editor doesn't show line numbers today. For docs that lean code-heavy (or just for orientation while editing long files), a toggleable line-number gutter would be useful. Some users prefer it on, others off — a per-tab or global toggle (View menu? Editor settings?) lets users pick.

**Scope (rough):**
1. Decide global vs per-tab toggle. Lean global (consistent across tabs).
2. Persistence: localStorage, key like `duo:editor-line-numbers`.
3. Implementation: TipTap doesn't have a built-in line-number plugin; need to either author a ProseMirror plugin (similar to `FindHighlight`) that paints decorations with line numbers in the gutter, OR use a CSS pseudo-element approach.
4. UI: View menu item "Show line numbers" with a checkmark when on. Keyboard chord (e.g. ⌘⇧L) optional v2.

**Cross-ref:** Stage 11 (markdown editor PRD); existing TipTap extensions in `renderer/components/editor/extensions/`.

---

### ENH-070: Avoid maintaining two FAQs — symlink or single-source the install copy

**Status:** ✅ **Shipped v0.6.4** (Sprint 3 sweep wave 5, 2026-05-03). Owner picked **Path 1** (dev-only symlink). New private method `InstallService.maintainHelpSymlinksInDev(sourceHelpDir)` walks the source's `help/` flat dir, and for each `.html` file:
- If dest is a symlink to the right path → no-op.
- If dest is a stale symlink → unlink + recreate.
- If dest is a regular file byte-identical to source → unlink + create symlink (safe; not customized).
- If dest is a regular file with different bytes → leave alone (preserves user customization).
- If dest doesn't exist → create symlink.

Integration: in `run()`, the existing `safeOverwriteDirContents(sourceRoot/help, HELP_DEST_DIR, ...)` call is now gated on `app.isPackaged`. When packaged, real copies (with prevShas tracking) like before. In dev, calls `maintainHelpSymlinksInDev` instead. Production path entirely unchanged. Help dir today is 3 flat `.html` files (faq.html, what-duo-does.html, canvas-actions-demo.html) — no recursion needed; comment notes the helper would need extending if subdirs are ever added.

**Smoke-walk verification (2026-05-03, post-walk filesystem inspection):**
```
~/.claude/duo/help/
  canvas-actions-demo.html -> /Users/geoffreydudgeon/Documents/GitHub/duo/help/canvas-actions-demo.html  ✅ symlink
  faq.html                  (regular file, byte-divergent from source)                                   🟡 preserved
  what-duo-does.html        (regular file, byte-divergent from source)                                   🟡 preserved
```
The mechanism works correctly — `canvas-actions-demo.html` had byte-identical content in both places and got swapped to a symlink. `faq.html` and `what-duo-does.html` differed (the source repo got v0.6.4-content edits earlier in the day; the installed copies were the older v0.6.3-era cuts), so the helper preserved them as designed (don't trample user customizations). **Edge case worth a follow-up:** in the dev workflow, when an agent edits the source repo's help/*.html, the installed copy doesn't auto-update via this helper. The user must either (a) `rm` the diverged file and click Refresh (drops customizations + creates the symlink), or (b) manually re-sync via a different mechanism. **Filed**: a small fix would be a `duo dev resync-help` CLI verb that force-symlinks (with confirmation prompt about lost customizations). Out of scope for v0.6.4 cut; queued for v0.6.5.
**Priority:** Medium (drift risk — the source-repo and installed-copy FAQs WILL diverge over time)
**Filed:** 2026-05-02 (Sprint 1 walk-1 owner notes)

**Owner observation (verbatim):** "we should not be maintaining two FAQs"

**Context:** Walk-1 surfaced that the user has TWO FAQ files visible:
- `~/Documents/GitHub/duo/help/faq.html` (source repo, edited during dev)
- `~/.claude/duo/help/faq.html` (installed copy, written by `electron/install-service.ts` on first launch / Refresh)

These are two distinct files at two distinct paths. The cut-version skill's Step 4 lists `help/faq.html (in repo, NOT the ~/.claude/duo/help/ copy)` as the canonical edit target; the install service then copies it to the user's `~/.claude/duo/help/` on next launch. So the "two files" pattern is intentional — but easy to forget mid-edit (edit the installed copy, lose changes on next install) and confusing to see both in the navigator.

**Three fix paths:**
1. **Symlink** `~/.claude/duo/help/faq.html` → source repo's `help/faq.html` IN DEV ONLY. Production users still get a real copy from the install bundle. Cleanest dev story; production unchanged.
2. **Hide the installed copy from the navigator** when running in dev mode (when both paths exist and are byte-identical). Doesn't fix the divergence risk, just hides the symptom.
3. **Reverse the source-of-truth direction** — ship the FAQ as a build artifact (write it to `~/.claude/duo/help/` only) and have dev mode `npm run dev` open it from the user's home. Removes the in-repo copy entirely. Pure but requires more lifecycle wiring.

**Recommended:** path 1 — dev-only symlink during install. The user's two-FAQ visibility goes away in dev (they edit one file, the symlink reflects it everywhere); production users still get a packaged copy. `electron/install-service.ts` § install path: when `app.isPackaged === false` AND the source repo is detectable, symlink instead of copy.

**Cross-ref:** Stage 18 install service; `cut-version` skill Step 4 (the manual edit-the-source-not-the-copy convention this would obviate); BUG-059 (the symptom that exposed this — dedup is per-path, so two-files-same-content reads as two distinct things).

---

### ENH-071: Replace "Lines" text in line-numbers toggle with `#`

**Status:** ✅ Shipped v0.6.3
**Priority:** Low (cosmetic)
**Filed:** 2026-05-02 (v0.6.3 walk-2 W2-V10 owner notes)
**Shipped:** 2026-05-02 — `renderer/components/editor/MarkdownEditor.tsx` toggle button text changed from `<span>Lines</span>` to `<span className="font-mono">#</span>`. SVG glyph kept.

**Owner observation (verbatim):** "please replace the word 'numbers' with the character `#`; keep the line number icon"

**Where it lives:** `renderer/components/editor/MarkdownEditor.tsx` — the sticky toggle button at the bottom-left of the editor scroll-host. Currently renders: `<svg>...</svg> <span>Lines</span>`. Replace `Lines` with `#` and keep the SVG glyph.

---

### ENH-072: Larger label text on collapsed-pane rails

**Status:** ✅ Shipped v0.6.3
**Priority:** Low (visual polish)
**Filed:** 2026-05-02 (v0.6.3 walk-2 W2-V6 owner notes)
**Shipped:** 2026-05-02 — `renderer/components/CollapsedPaneRail.tsx` label bumped from `text-[11px]` → `text-[13px]` plus `tracking-wide` and lifted color from `--ink-ghost` to `--ink-mute` for better legibility. Stays serif italic to match the active-tab style.

**Owner observation (verbatim):** "the text label on the terminal and canvas collapse rails should be larger"

**Where it lives:** `renderer/components/CollapsedPaneRail.tsx` — currently the vertical "terminal" / "canvas" label is `text-[11px]`. Bump to a larger size (e.g. `text-[13px]` or `text-sm`) and re-evaluate weight / contrast.

---

### ENH-073: Visible separator between working-tab strip and new-tab cluster

**Status:** ✅ Shipped v0.6.3
**Priority:** Low-medium (visual hierarchy)
**Filed:** 2026-05-02 (v0.6.3 walk-2 W2-V8 owner notes)
**Shipped:** 2026-05-02 — added a paper-rule vertical divider between the `flex-1 overflow-x-auto` tab scroller and the sticky new-tab cluster in BOTH `renderer/components/WorkingTabStrip.tsx` and `renderer/components/TabBar.tsx`. The divider is `w-px h-5 bg-paper-rule mb-1 mx-1.5` — taller (h-5 vs h-3 used between the two split-button halves) so it reads as a section seam rather than an intra-cluster separator.

**Owner observation (verbatim):** "for both the terminal and canvas tab rail buttons, there should be a more visible line that separates the buttons from the tab section"

**Context:** the new-tab cluster (clawd-glyph + globe in WorkingTabStrip; clawd-glyph + chevron in TabBar) sits immediately adjacent to the rightmost tab without any visual divider. Owner wants a clearer visual seam — a small vertical paper-rule divider between the scrolling tab list and the sticky new-tab buttons.

**Where it lives:** `renderer/components/WorkingTabStrip.tsx` and `renderer/components/TabBar.tsx`. Add a `<span aria-hidden="true" className="w-px h-3 bg-paper-rule mx-1" />` between the `flex-1 overflow-x-auto` scroller and the new-tab cluster. Same pattern as the existing intra-cluster divider (between clawd and chevron) but slightly more prominent.

---

### ENH-074: Tab context menu — add "Copy path" item

**Status:** ✅ Shipped v0.6.3
**Priority:** Medium (workflow paper-cut — Copy path exists in FileTree's right-click menu but not the tab context menu)
**Filed:** 2026-05-02 (v0.6.3 walk-2 owner notes — "did we log the ENH to add an action to tab context click: copy file path?")
**Shipped:** 2026-05-02 — `renderer/components/WorkingTabStrip.tsx § buildTabMenuTemplate` adds `{ id: 'copy-path', label: 'Copy path' }` after `Rename…` (gated on `path != null`); `handleMenuChoice` adds `case 'copy-path'` that writes the path to `navigator.clipboard.writeText`. Visible for file tabs and for browser tabs whose URL is a `file://` pointing at a local artifact.

**What's wanted:** the WorkingTabStrip's right-click menu already has Reveal in navigator / Rename / Move tab left/right / Pin / Move to Trash. Add `Copy path` for tabs that have a `path` (file tabs + browser tabs that point at a `file://` URL). Mirrors the FileTree's Copy path entry.

**Where it lives:** `renderer/components/WorkingTabStrip.tsx § buildTabMenuTemplate`. Add `{ id: 'copy-path', label: 'Copy path' }` (gated on `path != null`); add `case 'copy-path'` to `handleMenuChoice` that writes path to `navigator.clipboard.writeText(path)`.

---

### ENH-075: Canvas glyph alternative options (collapse rail + canvas-tab type icon)

**Status:** ❌ Won't do — closed 2026-05-04 (v0.6.6 sprint open). Owner walked the alternatives worksheet (`docs/dev/worksheets/enh-075-glyph-options.html`); none of the candidate options improved on the current rectangle-with-lines stand-in. Keeping the existing glyph; revisit only if a stronger directional concept emerges.
**Priority:** Low (design exploration)
**Filed:** 2026-05-02 (v0.6.3 walk-2 W2-V6 owner notes)

**Owner observation (verbatim):** "I want to see some different icon options for the canvas"

**Context:** the canvas glyph used by the collapse rail (`renderer/components/CollapsedPaneRail.tsx § CanvasGlyph`) is a generic rectangle-with-lines stand-in. The same family includes the per-tab TypeIcon for `html-canvas` kind in `WorkingTabStrip.tsx`. Owner wants design exploration — possibly something more distinctive to the "playground / page" hierarchy (per the v0.6.1 vocabulary lock).

**Out of scope today:** design itself. Filed as a discovery task — when picked up, sketch 3-5 candidates and let owner choose.

---

### BUG-070: Cursor doesn't land in fresh HTML canvas until tab-away-and-back

**Status:** ✅ Shipped v0.6.4 — three iterations:
- v1 (`1b3b132`, 2026-05-02): added a RAF poll around `wire()` to retry until body exists. Walk-3 reported FAIL.
- v2 (`4baba8b`, 2026-05-02): added `if (doc.readyState === 'loading') return` guard inside `wire()`. Walk-3 still FAIL.
- **v3 (`56e986b`, 2026-05-03):** root cause found — srcdoc iframes pass through an `about:blank` document phase BEFORE the parser swaps in the real srcdoc doc. about:blank's readyState is 'complete' immediately, so v2's readyState guard didn't catch it. The RAF poll wired against the disposable about:blank body, set contenteditable on it, locked `wired=true`, and never re-ran when the parser swapped in the real srcdoc body. Fix: bail in `wire()` when `doc.URL === 'about:blank'`. The poll keeps retrying until URL becomes 'about:srcdoc'; wire() runs against the real body. Verified PASS in live smoke (fresh `duo html new` canvas; first click in body landed cursor immediately).

**Priority:** Medium (UX paper-cut — workaround exists but unintuitive)
**Filed:** 2026-05-02 (v0.6.3 walk-2 W2-V11 owner observation)

**Owner observation (verbatim):** "duo created new html page with heading.... could not edit file / clicked in many places, incl on the text itself, but no cursor landed / tabbed away from tab, came back / then was able to get cursor to land / made bullets"

**Repro:**
1. Run `duo html new /tmp/test.html`.
2. Click the new tab in the WorkingTabStrip to make it active.
3. Click ANYWHERE inside the canvas body — heading text, paragraph, whitespace.
4. **Observed:** no cursor lands. The canvas doesn't focus.
5. Switch to a different working tab.
6. Switch back to the canvas tab.
7. Click again — cursor lands correctly.

**Suspected cause:** the canvas iframe's contentEditable focus chain isn't firing on first mount. The BUG-037 mousedown forwarder lives in `RenderedCanvas.tsx` (out-of-iframe → flips focusedColumn). For the iframe's contentEditable focus, `installCanvasFocusForwarder` may not yet have been wired by the time the user clicks — or the focus call to body races with the iframe's own ready-state initialization.

**Where to look:** `renderer/components/HtmlCanvas/CanvasTab.tsx` (canvas mount); `RenderedCanvas.tsx` (iframe wiring); the BUG-055 mousedown forwarder pattern (already moved out of `if (!readOnly)` gate). Possible: `BUG-037 mousedown forwarder` registers on iframe load; if the user clicks BEFORE load completes, the listener isn't attached yet.

**Workaround until fixed:** tab away + back forces a re-mount or a fresh focus pass.

---

### ENH-076: ⌘[ / ⌘] indent/outdent in HTML canvas (parity with markdown editor's ENH-025)

**Status:** ✅ Shipped v0.6.4 (2026-05-03)
**Priority:** Medium (parity gap — Tab/Shift-Tab now work after BUG-061's v0.6.3 partial fix; ⌘[ / ⌘] are owner muscle memory from the markdown editor)
**Filed:** 2026-05-02 (v0.6.3 walk-2 W2-V11 owner notes)

**Owner observation (verbatim):** "still need cmd [ / ] to indent/outdent"

**What changed:** `renderer/components/HtmlCanvas/markdownShortcuts.ts § installMarkdownShortcuts → onKeyDown` — added a `⌘[` / `⌘]` branch above the existing Tab branch. Same `handleListIndent(doc, shift)` helper, with `shift = (e.key === '[')` so `⌘]` indents (sink) and `⌘[` outdents (lift). Modifier guard rejects ⌘⇧[ / ⌘⇧] (those are global-shortcut territory per `ListIndentShortcuts.ts` comment). Tab / Shift-Tab behavior unchanged.

**Editor-canvas parity disposition (per CLAUDE.md § 4 rule):** **(a) Mirrored** — the canvas behavior matches `renderer/components/editor/extensions/ListIndentShortcuts.ts`'s TipTap chord registration for the markdown editor. Both surfaces respond to ⌘[ / ⌘] when the caret is in a list item; both no-op outside a list.

---

### ENH-077: System dialog icon — verify production behavior, file polish if dev-only

**Status:** 🟡 Code-path verified clean (2026-05-03 — Sprint 3 sweep). DMG smoke-verify owed in v0.6.4 cut to formally close.
**Priority:** Low (cosmetic; only visible in dev)
**Filed:** 2026-05-02 (v0.6.3 walk-2 W2-V4 owner notes)

**Owner observation (verbatim):** "can we update the icon that displays in system dialogs?"

**Context:** `dialog.showMessageBox` on macOS uses the parent BrowserWindow's app icon by default. In a packaged + signed Duo build, that icon is Duo's clawd glyph (Stage 21b). In dev (`npm run dev`), the parent is Electron's default app icon — which is what owner saw. So the dev display is "wrong-looking" but production should already be correct.

**Code-path verification (2026-05-03):**
- `electron-builder.yml § mac.icon: build/icon.icns` ✅ correct (Stage 21b multi-resolution icon, generated from `build/icon.png`).
- `electron/main.ts § new BrowserWindow({ ... })` constructor ✅ does NOT override `icon:` — the bundle's Info.plist icon governs.
- `build/icon.icns` ✅ exists in the repo.
- No `dialog.showMessageBox` call in the codebase passes a custom `icon:` argument that would short-circuit the bundle icon.

**Conclusion:** production behavior should be correct without any code change. The dev-mode "wrong icon" is an artifact of running in unpackaged Electron and is not a defect worth shipping a dev-only override for (would add complexity for cosmetic-only polish).

**v0.6.4 DMG verify step:** open a packaged + signed Duo, trigger any `dialog.confirm` (e.g. right-click a navigator entry → Move to Trash), confirm the dialog shows Duo's clawd glyph. If yes → close ENH as no-op. If no → re-open and look at `electron-builder.yml § mac.icon` resolution + the .app bundle's `Resources/icon.icns` path.

---

### BUG-071: Focus left in limbo after smoke-walk path-link click — ⌃Tab unresponsive until canvas re-clicked

**Status:** ✅ **Shipped v0.6.4** (Sprint 3 idle-thoughts sweep, commit `4ec0742`, 2026-05-03). One-line fix in `electron/main.ts § cdpBridge.onBrowserOpenPath` (and the symmetric `onBrowserOpenPathSplit`): after `void sendEdit(expanded)` / `void splitViewOpen(expanded)`, call `mainWindow?.webContents.focus()` to pull keyboard focus off the WebContentsView and back onto the renderer's content view. This is the inverse of BUG-042's wireKeyForwarding focus-pushed-to-renderer pattern, applied at the CDP listener level. After the fix, `⌃Tab` is responsive immediately after the canvas opens; no canvas-body re-click required. Smoke-walk verification owed in the v0.6.4 walk.
**Priority:** Medium (sibling of BUG-038 / BUG-042 family — wrong-pane-focus → wrong-shortcut-routing).
**Filed:** 2026-05-02 (v0.6.3-walk-3 ENH-039 notes)

**Owner observation (verbatim):** "for `/tmp/bug070-test.html` pass, but other issue, could not ctrl-tab away initially; had to click into canvas to make ctrl-tab responsive"

**Repro:**
1. Open the smoke-walk page in Duo (browser pane).
2. Click a `data-duo-path` link that resolves to a canvas-routed file (e.g. `/tmp/bug070-test.html`).
3. The path opens in the working pane as a new canvas tab. Focus appears to land in the canvas.
4. Try `⌃Tab` to cycle working-pane tabs.
5. **Observed:** `⌃Tab` is unresponsive. Must first click into the canvas body, THEN `⌃Tab` cycles correctly.

**Suspected cause:** ENH-039's path-link click runs INSIDE the smoke-walk browser tab's WebContentsView. The page-side click handler calls `e.preventDefault()` then `window.duoOpenPath(...)` which routes through CDP → main → `sendEdit(path)` → renderer's `openFileSmart` → adds a canvas tab + activates it. But the keyboard focus likely stays on the WebContentsView (browser pane) at the macOS native-subview level, even though the renderer's `focusedColumn` may have flipped to 'working'. The native-subview keyboard focus is what determines where keystrokes route — not React state. Same family as BUG-038 / BUG-042 (browser pane click doesn't update focus), this time triggered by an in-page path click rather than a direct mousedown.

**Where to look:**
- `electron/main.ts` — the `cdpBridge.onBrowserOpenPath` listener that calls `sendEdit(path)`. Could potentially also call `mainWindow.webContents.focus()` to pull keyboard focus off the WebContentsView and back to the renderer.
- `renderer/App.tsx § onNavEdit` (or wherever the IPC handler lives) — does it call `setFocusedColumn('working')` AND focus the working pane's container?
- BUG-042's fix in `BrowserManager.wireKeyForwarding` — `webContents.on('focus', ...)` flips focusedColumn TO 'working' when the browser GAINS focus. The inverse is what's needed here: when navigating AWAY from the browser, transfer keyboard focus to the working pane's React tree.

**Workaround until fixed:** click into the canvas body after the path-link nav, before using `⌃Tab`.

**Cross-ref:** ENH-039 (the new path-link surface that triggered this); BUG-038 (working-pane focus ⌃Tab cycle); BUG-042 (browser focus push); BUG-055 (canvas mousedown forwarder — addresses iframe-side, not WebContentsView-side).

**Status update (2026-05-03):** Status flipped to ✅ Shipped — see top of entry. Implementation detail moved into the Status block to keep the entry self-contained.

---

### Discussion-only: location of `agents/duo.md` (project root vs `.claude/agents/`)

**Owner observation (verbatim):** "why is the duo agent definition here `/Users/geoffreydudgeon/Documents/GitHub/duo/agents/duo.md` and not in here `/Users/geoffreydudgeon/Documents/GitHub/duo/.claude` ?"

**Answer:** `agents/duo.md` at the project root is the SOURCE-OF-TRUTH that the install service ships. On `npm run sync:claude` (dev) and on the Stage 18 install banner (production), it's copied to `~/.claude/agents/duo.md` — which IS where Claude Code reads agent definitions from. So the user-Claude-side "where Claude reads it" is `.claude/agents/`, but the in-repo source is `agents/`.

**Could it move to `.claude/agents/duo.md` in the repo?** Yes — `.claude/` at the project root is itself a valid Claude-Code-recognized location, and the install service could pick it up from there. Pros: consistency with the user-level layout. Cons: project-root `.claude/` is currently for project-specific Claude config (settings, hooks, etc.), and mixing distributable agent-definitions with project-config is conceptually muddled. The repo's current layout (`agents/`, `skill/`, `packs/` all at root) treats those as "things Duo ships TO users" — a clean ship-source layout.

Filed as a discussion item, not a task. No code change unless the owner picks a direction.

---

### ENH-078: Navigator selection state too subtle + needs easier deselection

**Status:** ✅ **Shipped v0.6.5** (Sprint 4 Phase 2). Dark mode shipped in v0.6.4. Light-mode contrast regression (BUG-074) fixed by replacing `text-zinc-50` with the theme-aware `text-ink` token in `FileTree.tsx`. Selected row now reads `bg-accent/30 text-ink font-medium` — dark text on cream paper in light mode, light text on dark surface in dark mode.
**Priority:** Medium (everyday navigator UX paper-cut).
**Filed:** 2026-05-03 (idle-thoughts.md → processed in this sprint).

**Owner observation (verbatim):** "'selection' status in file navigator is too subtle; hard to see which item is selected; needs to be more prominent, eg name background fill, like in finder; still atelier, but more obvious; AND it needs to be easier to deselect something/bring selection state back to the navigator parent folder, eg by clicking on navigator whitespace (currently ignored), clicking on selected item a second time, and other methods"

**What changed:**
1. **Selection prominence (`renderer/components/FileTree.tsx § TreeNode`):** the selected row className stepped up from `bg-accent/15 text-zinc-100` to `bg-accent/30 text-zinc-50 font-medium`. Still atelier — same `accent` token, no new color — just a stronger fill + heavier weight so the row reads like Finder's selection at a glance.
2. **Click-on-selected-row to deselect (`onSingleClickRow`):** when the row clicked is already `isSelected`, the handler routes to `actions.clearSelection()` instead of re-running `actions.selectItem()`. Re-clicking the same row twice toggles selection off.
3. **Click-on-whitespace to deselect (`FileTree`'s overflow wrapper):** added `onClick` matching the existing `onContextMenu` whitespace guard (`e.target !== e.currentTarget` returns early). Whitespace click clears selection without opening a menu.
4. **Escape already worked (line ~497).** No change there.

**Cross-ref:** Stage 26 item 1 (single-click selects, double-click opens — same code path); BUG-025 (chevron is a separate hit target from the row — unaffected); ENH-016 (whitespace right-click for New file / New folder — same wrapper, both handlers coexist).

---

### ENH-079: Collapsed Navigator should display "Navigator: {project_name}" label

**Status:** ✅ Shipped v0.6.4 (this sprint — 2026-05-03).
**Priority:** Low (parity / discoverability).
**Filed:** 2026-05-03 (idle-thoughts.md → processed in this sprint).

**Owner observation (verbatim):** "when navigator is collapsed, it should say 'Navigator: {project_name}', in the same style as the text on the terminal and canvas collapse rails."

**What changed:**
- `renderer/components/FilesPane.tsx § CollapsedRail`: added a vertical-rl serif italic label below the folder glyph, mirroring `CollapsedPaneRail.tsx`'s pattern. Label reads `Navigator: {project_name}` where `project_name` is the basename of `state.cwd` (matching `rootEntry.name` synthesis at line ~175 — `state.cwd.split('/').filter(Boolean).pop() ?? '/'`). Threaded through as a new `projectName` prop.
- Style matches the existing terminal/canvas rail labels: `font-serif italic text-[13px] text-ink-mute mt-1 tracking-wide` + `writing-mode: vertical-rl; transform: rotate(180deg)`.
- The terminal/canvas rails (`CollapsedPaneRail.tsx`) stay unchanged — they don't have a project-context analog so no label change there.

**Cross-ref:** ENH-066 (CollapsedPaneRail introduction); ENH-072 (font-size bump on the rail labels — kept consistent here).

---

### ENH-080: ⌘⇧A — search open tabs (working pane + browser tab strip)

**Status:** ✅ **FIXED** in v0.6.8 (Sprint 8 Phase 3b, 2026-05-06). v1 ships per [docs/prd/canvas-tab-search-research.md § Option B](docs/prd/canvas-tab-search-research.md) — renderer-only React overlay. New components + wiring:
- `renderer/components/TabSearchPalette.tsx` — overlay UI (z-50 modal centered at top 15% of viewport; backdrop-click + Esc dismiss; ↑↓ navigate; Enter pick; mousedown-not-click selection so the input doesn't blur-dismiss before pick fires). Atelier-styled (bg-surface-1, accent on active row); kind-glyph icons per tab type.
- `scoreEntry()` — substring + prefix ranking with kind-aware boosts: exact title (1000), title prefix (500), title contains (200 - position), subtitle contains (50 - position), no match (-1). 9 vitest fixtures lock the ranking boundary.
- `globalShortcuts.ts` § matcher — `⌘⇧A` (`e.code === 'KeyA'` to defend against keyboard-layout shifts) → `'openTabSearchPalette'` ShortcutId.
- `useKeyboardShortcuts.ts` dispatches `'duo-open-tab-search'` window CustomEvent; `App.tsx` toggles `tabSearchOpen` state on event.
- `App.tsx` derives `tabSearchEntries` from `fileTabs` + non-aux `browserTabs`; `onPick` dispatches `setActiveWorking` to the chosen tab.
- 248/248 tests green; typecheck clean.

**Trade-offs accepted in v1:** the overlay is a renderer-only React modal — it CAN be occluded by the WebContentsView when the active tab is a browser tab. The research doc's Option A (native child window pre-created at boot) would solve that but is queued for v2. v1 ships fast; if WCV occlusion becomes a real friction, the WCV-mute pattern (set-aux-bounds-1×1 while open) is a tiny enhancement layered on top.

**Priority:** Medium (the user has many tabs open across the working pane and browser pane; opening a "where is X tab?" picker is a real gap).
**Filed:** 2026-05-03 (idle-thoughts.md → processed in this sprint).

**Owner observation (verbatim):** "need cmd+shift+a to search open tabs"

**Owner constraint flagged for v0.6.5 (2026-05-03 evening):** *"think hard about the menu occlusion issues we've had to make sure we get this one right."* This palette is renderer DOM and would have the SAME WebContentsView-occlusion class as BUG-006 (in-page Send → Duo pill), BUG-045 (file:// browser tabs context menu), BUG-047 (the broader class summary), BUG-050 (ContextMenu occluded by editor canvas), BUG-058 (context menu occluded by browser), BUG-064 (trash + pinned-close modal occlusion). ENH-050's resolution was "native NSMenu + system sheets, NOT WCV-mute" — but a tab-search palette is interactive (typeahead-filterable list, arrow-key navigation, Enter to activate) which an NSMenu doesn't fit cleanly.

**Required before code: research doc** at `docs/prd/canvas-tab-search-research.html` (mirror of `canvas-split-view-research.html`'s structure) enumerating:

1. **Native child window** — Electron child `BrowserWindow` with transparent borderless chrome, dismiss on blur, parent = main window. Composes above WCV at the window-server level (same as `dialog.showMessageBox`). Cleanest option if the visual styling can match Atelier; tradeoff is the IPC wire between parent and child for the tabs list + activate callback.
2. **WCV mute pattern (BUG-058 v2 lineage)** — `browser.setOverlayMuted(true)` collapses every WCV to 1×1 while the palette is open; restores on close. Already retired for menus + sheets per ENH-050 ADR; resurrecting for the palette is acceptable IF (1) is impractical. Visual flicker risk on open/close.
3. **Renderer-DOM palette + dynamic WCV bounds** — palette is React, but the renderer dynamically shrinks the active WCV bounds while the palette is visible. Trickier than mute (animation, re-layout, restore edge cases, layout-during-resize).
4. **Extension-style CDP overlay** — render the palette into the active WCV via CDP injection (mirror BUG-006's in-page Send → Duo pill pattern). Unifies behavior across browser and renderer surfaces but introduces a CDP dependency for a feature that should work even when no browser is active. Probably wrong fit.

**Recommendation seed** (research doc to verify): option (1) is the cleanest if `BrowserWindow` can hit the right visual styling — transparent + borderless + dismiss-on-blur is well-trodden Electron territory. Option (2) is the safe fallback if (1) doesn't compose. Research doc should prototype (1) first and document why if it doesn't work.

**Implementation sketch (rough — research doc finalizes the architecture):**
1. New chord row in `renderer/keyboard/globalShortcuts.ts`: `Mod-Shift-A` → `openTabSearch`.
2. Wire through `useKeyboardShortcuts` in App.tsx → flips a `tabSearchOpen` state OR opens the child window (per research-doc decision).
3. New component `renderer/components/TabSearch.tsx` (or a separate child-window renderer entry — research-doc decision) — floating panel (similar to `Breadcrumb`'s edit interstitial), gathers all open tabs from:
   - `App.tsx`'s `fileTabs[]` (working pane file tabs)
   - `useBrowserState`'s `browserTabs[]` (browser pane)
   - `auxState.paths[]` if Split View is open
4. Activate by:
   - Working pane tab → `setActiveWorking({kind:'file', id})` (same path the tab strip click uses).
   - Browser tab → `browserManager.activateTab(tabId)`.
   - Aux tab → bring focus to aux + setActiveIndex (Phase 3c follow-up).
5. Visual: cream paper bg + accent border (Atelier), lives center-screen, dimmed backdrop. Type-as-filter against `title` + `path` + `url`. Group by surface (working / browser / aux). Arrow keys to navigate; Enter to activate; Escape to dismiss.
6. CLI parity: `duo tab-search [--query <q>]` returns the filtered tab list as JSON for agent inspection. Even if the agent doesn't actively pick from the palette, having the CLI verb means agents have the same "where is X tab?" lookup the user does.

**Cross-ref:** Phase 3b (`⌘\` open/move chord — same family of "tab navigation chords"); ENH-024 (tab strip pans/shifts — partial overlap, but ENH-024 is about visual access, not jump-by-name); ENH-050 ADR (`docs/DECISIONS.md § WCV-occlusion remediation`); BUG-006 / BUG-045 / BUG-047 / BUG-050 / BUG-058 / BUG-064 (the WCV-occlusion class this design must navigate).

**Out of scope for v0.6.4.** Filed for v0.6.5 with research-doc as the entry gate.

---

### ENH-081: Register Duo as a macOS Open-With candidate for `.md` and `.html`

**Status:** ✅ Shipped v0.6.4 (this sprint — 2026-05-03; verification pending v0.6.4 DMG).
**Priority:** Medium (Finder is most users' file-discovery surface; Duo currently doesn't appear in Open With → choices).
**Filed:** 2026-05-03 (in-session ask).

**Owner observation (verbatim):** "can we set duo as eligible/compatible to open md, html from the finder?"

**What changed:**
1. **`electron-builder.yml`** — added top-level `fileAssociations` block with `ext: md` (Markdown) + `ext: html` (HTML), both `role: Editor`. electron-builder generates the `CFBundleDocumentTypes` Info.plist entries automatically; macOS picks them up on next install / `lsregister` re-scan.
2. **`electron/main.ts`** — added an `app.on('open-file', (event, path) => { event.preventDefault(); … })` handler. If the main window already exists, route through `sendEdit(path)` (same path `duo open` and the navigator double-click use, which goes through `openFileSmart` → file-classifier → editor-or-canvas-or-browser routing). If the window doesn't exist yet (cold-start "double-click an .md to launch Duo"), stash the path in a `pendingOpenFilePath` variable and flush after `app.whenReady()` resolves and the window is created.

**Verification:** the registration only takes effect in a packaged + installed build (macOS won't notice an Info.plist change in dev). Smoke at v0.6.4 cut: install the DMG, right-click an `.md` file in Finder → Open With, confirm Duo appears in the list. If it doesn't auto-appear, run `lsregister -kill -r -domain local -domain user` and re-check. (`role: Editor` means Duo CAN be picked but isn't the OS-default unless the user manually sets it via Get Info → Open With → Change All.)

**Same constraint family as ENH-077** (system dialog icon — verifiable only post-package). Both fold into the v0.6.4 cut smoke walk.

**Cross-ref:** ENH-077 (other post-package-only verification); BUG-067 (`duo open <path.md>` smart routing — `openFileSmart` is the shared destination for Finder + CLI opens, so the routing matches what users get from Duo internally).

---

### Discussion: Enterprise distro is a downloaded ZIP that becomes a submodule, NOT a fork

**Filed:** 2026-05-03 (idle-thoughts.md → processed in this sprint).

**Owner observation (verbatim):** "when we ship the enterprise distribution module or whatever it's called, should anticipate that the bundle (at the client site) will be a GH repo that is submoduled, or similar, into whatever version of the duo app is pulled down from github.com/dudgeon/duo; duo will not be cloned/forked, it will be literally downloaded as a zip file and then uploaded to the enterprise GH"

**Why this matters:** the prior Stage 21e "fork-friendly architecture" work assumed enterprise instances would clone or fork `dudgeon/duo`, edit `fork.config.json` + add their own packs, and run their own `dist-signed.sh`. The owner is clarifying that the ACTUAL enterprise pattern is:

1. Enterprise downloads `dudgeon/duo` as a ZIP (not via git).
2. Uploads the unzipped tree to their internal GitHub.
3. Adds their own enterprise pack(s) — likely as a **git submodule** under (e.g.) `packs/enterprise-name/` — pointing at a separate enterprise-only repo.
4. Builds Duo locally on enterprise infra. The submodule's pack ships in the resulting DMG.

**Implications for the architecture (v0.6.5+ / Stage 18b+):**

- **`packs/` directory must tolerate submodules.** electron-builder's `extraResources` glob already covers `packs/**/*`, but submodule contents are pulled in at `git submodule update`, not at clone time. The build script needs to ensure submodules are checked out before `electron-builder` runs. Add `git submodule update --init --recursive` to `scripts/dist.sh` and `scripts/dist-signed.sh` (already done? check).
- **`PACK.json` discovery** must continue to work for submodule-shaped packs (path-walk, not git-aware).
- **`fork.config.json`** — the existing layered identity overrides (productName / appId / publish coordinates) are still the right pattern; nothing about ZIP-download breaks them.
- **Update channel** — enterprise builds set `publish.provider` to their internal release host (GHEC, S3, internal Sparkle feed). The fork-config injection at CLI override time already supports this.
- **Doc work owed:** `docs/HOW-TO-FORK.md` should add an "Enterprise distro" section spelling out the ZIP+submodule pattern explicitly. Currently the doc implies `git clone fork`, which doesn't match the realized enterprise workflow.

**Filed as a discussion item.** No code change required RIGHT NOW — the existing Stage 21e architecture supports this pattern fine. The work owed is documentation + a sanity check that `dist-signed.sh` runs `git submodule update --init` before `electron-builder` (small addition if missing). Pull into a Stage 18b enterprise-distro sprint when that work surfaces.

**Cross-ref:** Stage 21e (fork-friendly architecture, shipped v0.5.0); `docs/HOW-TO-FORK.md`; `fork.config.default.json`; `electron-builder.yml § extraResources`.

---

### BUG-072: Blockquote double-Enter doesn't exit blockquote (parity gap with bullet/ordered-list behavior)

**Status:** ✅ **Shipped v0.6.5 Phase 5** (v3 final, 2026-05-04 re-walk #3 PASS). Three iterations: v1 added the exit handler but the trigger produced a malformed structure (text directly in blockquote, no `<p>` wrapper). v2 hand-rolled `<blockquote><p></p></blockquote>` but Chromium's caret-snap quirk bumped the caret out of the empty `<p>` to the parent. v3 added a `<br>` filler — `<blockquote><p><br></p></blockquote>` — giving the inner `<p>` measurable height + an anchorable caret position. Owner verified: *"it works!"*.
**Priority:** Medium (small UX inconsistency; bullets exit on double-Enter, blockquote should match).
**Filed:** 2026-05-03 (owner smoke walk note). v2 cause + fix logged 2026-05-04 after re-walk.

**v2 root cause (uncovered in re-walk).** The v1 trigger called `blockOps.toggleBlockquote(doc)` which uses `execCommand('formatBlock', false, '<blockquote>')`. Chromium's `formatBlock` CHANGES the current block's tag to `<blockquote>` rather than WRAPPING it — so an empty `<p>` becomes an empty `<blockquote>` with no `<p>` child. The user's caret + typed text then sit DIRECTLY inside the blockquote. Pressing Enter on that structure splits the BLOCKQUOTE itself (because the blockquote IS the current "block" from Chromium's contentEditable perspective) — producing TWO sibling blockquotes. Each subsequent Enter splits the empty trailing blockquote yet again. Owner re-walk 2026-05-04 showed five stacked blockquote-bars after Enter Enter Enter Enter, which was the diagnostic signal.

**v2 fix.** Added `convertEmptyBlockToBlockquote` in `renderer/components/Page/markdownShortcuts.ts` — hand-rolls `<blockquote><p></p></blockquote>` and parks the caret inside the inner `<p>` (same pattern as `convertEmptyBlockToList` for ul/ol). Now the inner `<p>` is the current block; Enter splits it (creating a new `<p>` sibling within the blockquote — Chromium's normal `defaultParagraphSeparator='p'` behavior), and `isEmptyTrailingBlockquoteChild` correctly detects the empty trailing `<p>` for double-Enter exit. Replaces the call to `blockOps.toggleBlockquote(doc)` in `handleInput` § blockquote branch.

**Owner observation (verbatim):** *"small issue with block quote: double line break continues block quote, unlike bullet handling; in bullets, you can enter twice to stop creating new bullets; blockquote should do the same"*

**Repro:**
1. In a fresh HTML canvas (or markdown editor — verify both surfaces), type `> something` then Enter.
2. Caret stays inside the blockquote on a new blank line. Type Enter again.
3. **Expected:** caret exits the blockquote; new line is a regular `<p>` paragraph (matches bullet/ordered-list "double Enter to escape").
4. **Actual:** the second Enter inserts another blank line *inside* the blockquote.

**Where to look:**
- `renderer/components/HtmlCanvas/markdownShortcuts.ts` — currently has Enter-key conversions for `---` / `***` (hr) and ```` ``` ```` (code), but no "Enter on empty blockquote child = exit blockquote" handler.
- TipTap markdown editor: should already have this for `<ul>` / `<ol>` via StarterKit; verify whether the same StarterKit extension does the right thing for `<blockquote>`. If not, this is a parallel fix on both surfaces.

**Editor-canvas parity disposition (per CLAUDE.md § 4):** **(a) Mirrored** when implemented — both surfaces should behave the same on double-Enter-in-blockquote.

**Cross-ref:** BUG-061 (the markdown-trigger family this lives in); ENH-076 (the indent/outdent parity chord that spawned the surface-parity discussion).

---

### BUG-073: HTML canvas bullet rendering — `-` should produce a dashed bullet style, not the default round bullet

**Status:** 🆕 Filed (surfaced in v0.6.4 smoke walk, BUG-061 row).
**Priority:** Low-Medium (cosmetic; functionality is fine — list creation triggers correctly. The marker character should hint at the visual style the way Markdown previewers (GitHub, Bear, Notion) do.)
**Filed:** 2026-05-03 (owner smoke walk note).

**Owner observation (verbatim):** *"partial pass; '-' should render as dashed bullet, not round bullet; all other cases pass"*

**Today:** All three unordered-list markers (`-`, `*`, `+`) trigger an `<ul>` with default browser styling — the default `list-style-type: disc` (round bullet). Functionally correct (BUG-061 v3 ships); cosmetically the marker character is lost on conversion.

**What's wanted:** preserve the visual hint of the typed marker character.
- `- ` → `list-style-type: '–  '` or similar (dashed marker)
- `* ` → asterisk or default disc (round)
- `+ ` → plus marker

**Implementation candidates:**
1. **Per-item `data-list-marker` attr.** When `convertEmptyBlockToList` fires, stamp the `<li>` (or its parent `<ul>`) with `data-list-marker="dash"` / `"asterisk"` / `"plus"`. CSS (in the canvas's `<head>` boilerplate or via the renderer's atelier overlay) maps to the right `list-style-type`. Survives a save → reopen round-trip cleanly.
2. **Inline `style="list-style-type: ..."`.** Simpler but pollutes the saved HTML with style attributes; inconsistent with the rest of the canvas's class-based styling pattern.
3. **CSS class.** `<ul class="duo-list-dash">` etc.; pretty-printer needs to whitelist them.

**Recommended:** option (1) — `data-` attrs are cheap, pretty-printer-stable, and easy to read in saved HTML.

**Editor-canvas parity disposition (per CLAUDE.md § 4):** **(c) Deferred** — markdown editor has this concept too (TipTap's BulletList extension supports per-item marker), but a separate ENH should carry that parity once this canvas-side ENH ships.

**Cross-ref:** BUG-061 (parent — markdown-trigger family); `markdownShortcuts.ts § convertEmptyBlockToList` (the function that needs to know which marker character was typed).

---

### BUG-074: ENH-078 navigator selection prominence — white text on light-mode paper background is illegible

**Status:** ✅ **Fixed v0.6.5** (Sprint 4 Phase 2 — took THREE attempts and a polish-revert before it stuck). Final fix in `renderer/components/FileTree.tsx` § TreeNode selected branch: `bg-accent text-white font-medium` (Finder-style: SOLID accent fill, white text, medium weight). No `rounded` on the row wrapper so the fill is square and edge-to-edge.

**The journey** (preserved as a lesson):
1. v1 (commit 440d876) — Tried `bg-accent/30 text-ink font-medium`. The `text-zinc-50 → text-ink` was correct; the `/30` was supposed to read as Finder-tinted. Looked right in the worksheet mockup against pure paper but washed out on the live navigator's `paper-deep` surface.
2. v2 (commit 3e4b796) — Reorder + dot glyph (separate items); didn't touch BUG-074.
3. v3 (commit b9a4c69) — Owner pushed back: "use a background color for the selected item, like Finder does." Switched to solid `bg-accent text-white font-medium`. Owner: "good; we're there. you can make the orange slightly less obtrusive and remove the corner radii."
4. v4 (commit 9a27845) — Added `bg-accent/85` for the "less obtrusive" polish + removed `rounded`. Looked fine to me in the diff, but the live render showed NO bg fill — just illegible white text on cream paper. Owner: "selection indicator regression still present in reloaded duo."
5. v5 (this commit) — Reverted to solid `bg-accent text-white font-medium` (same as v3). The `/85` opacity modifier silently produced broken CSS because the tailwind config defines accent as a raw `var(--duo-accent)` without an `<alpha-value>` placeholder. Filed FOLLOWUP-008 to migrate the accent token to RGB-triplets + `<alpha-value>` so opacity modifiers work — the "slightly less obtrusive" polish is queued behind that migration.

**Lessons for future Claude instances reading this entry:**
- When the owner says "like Finder does" — Finder does **solid** accent fill with light text on top, not a translucent tint.
- `bg-accent/N` opacity modifiers DON'T currently work in this codebase (silent failure → no fill). FOLLOWUP-008 has the fix path. Until then, use solid accent for any selection / strong-state treatment.
- Mockups validating selection state must render against the SAME surface the live render sits on (`paper-deep`, not `paper`) — opacity-on-paper can register fine while opacity-on-paper-deep washes out.
- If a polish attempt regresses the original fix, the owner's frustration is not just "I'm bothered" — it's signal that the test loop is broken. Don't ship visual polish without checking the live render.
**Priority:** **High** — light-mode users see the selected file row's name as nearly-invisible white text on the cream paper background. ENH-078 was filed as "shipped v0.6.4" but the smoke walk surfaced the contrast issue.
**Filed:** 2026-05-03 (owner smoke walk note).

**Owner observation (verbatim):** *"somehow worse than before; on system/light, the white text (see screenshot) is super illegible; item is more prominent in dark mode, but you ignored the very specific direction I gave you: use a background color for the selected item to indicate selection, like how finder treats it"*

**Today (the regression):** v0.6.4's ENH-078 changed the selected file row's class from `bg-accent/15 text-zinc-100` to `bg-accent/30 text-zinc-50 font-medium`. The intent was Finder-style stronger fill + heavier weight. But:
- `bg-accent/30` = ochre overlay at 30% opacity → in light mode this is a faint warm tint over cream paper.
- `text-zinc-50` = near-white. On a faint warm tint over cream paper, near-white text has near-zero contrast in light mode.
- In dark mode: the dark surface + light text + ochre overlay reads correctly (and was the only mode tested before shipping).

**What's wanted:** keep the Finder-style background-fill direction (prominent, heavier), but theme-aware text color.
- Light mode: dark text on accent-tinted background. Probably `text-ink` (the project's dark-on-paper token) or even keep it near-black for max contrast.
- Dark mode: light text. `text-zinc-50` or `text-ink` (which inverts in dark mode if Atelier tokens are wired correctly).
- Background fill: keep `bg-accent/30` or bump to a fully-opaque accent for Finder-true behavior. Worth experimenting with `bg-accent/40` light mode + `bg-accent/30` dark mode to keep contrast equivalent.

**Affected files:**
- `renderer/components/FileTree.tsx § TreeNode` row className (the `isSelected` branch).
- Possibly the Atelier token definitions if a new "selected text" token is introduced.

**Cross-ref:** ENH-078 (the parent enhancement — needs to be re-flagged from "shipped" to "🟡 partial: dark mode shipped, light mode owed"); BUG-016 (canvas dark-mode pasted-bold contrast — same family of "dark-mode-only-tested theme-aware contrast bug").

---

### BUG-075: Phase 3b Split View keyboard chords are ignored (regression — right-click + CLI paths still work)

**Status:** ✅ **Fixed v0.6.5** (Sprint 4 Phase 3+4 — TWO root causes, two fixes). The chord that ships in v0.6.5 is **⌘/ open + ⌘⇧/ promote**, NOT the original ⌘\ pair.

**Root cause 1: e.key vs e.code on shift-modified keys.** The matcher checked `e.key === '\\'` AND `shift === true` — physically impossible on US keyboards because Shift+\ produces `e.key === '|'`. Both Split View branches now use `e.code === 'Slash'` (and previously `'Backslash'`) — modifier-independent physical-key API.

**Root cause 2: 1Password's system-level Cmd+\ grab.** Even after the e.code fix landed, the chord still didn't fire on the owner's machine because 1Password intercepts Cmd+\ for password autofill at the OS level — Chromium / Duo never see the keystroke. Owner picked ⌘/ as the replacement chord (free in Duo's registry, no system-level conflict, mnemonic preserved).

**Fix scope (v3):**
- `renderer/keyboard/globalShortcuts.ts § matchGlobalShortcut` — both branches use `e.code === 'Slash'`.
- `electron/browser-manager.ts § wireKeyForwarding` — duo-shortcut allowlist now matches `input.code === 'Slash'` (was `'Backslash'`).
- `renderer/keyboard/globalShortcuts.test.ts` — 6 regression tests covering ⌘/ unshifted, ⌘⇧/ shifted (with `e.key === '?'`), specificity ordering, modifier exclusion, AND a negative test that ⌘\ no longer matches (so a regression back to the old chord surfaces as a test failure, not a silent breakage).

**Lessons saved to memory:**
- Use `e.code` (physical-key API), not `e.key`, for chord checks involving shift-modified characters.
- macOS users with 1Password installed lose Cmd+\ to autofill at the OS level. Don't pick chord pairs that conflict with common system-level grabs without verifying.
**Status (original):** 🆕 Filed · **regression in Phase 3b**.
**Priority:** **High** — keyboard chords are a load-bearing entry point per the v0.6.4 PRD; right-click and CLI work, but the keyboard parity gap is a feature regression.
**Filed:** 2026-05-03 (owner smoke walk note).

**Owner observation (verbatim):** *"kb shortcut just ignored"* (on both ⌘\\ and ⌘⇧\\ smoke items)

**Repro:**
1. Have an active main file tab in the working pane.
2. Press `⌘\\`.
3. **Expected:** the active tab moves into the Split View aux slot.
4. **Actual:** nothing happens.

Symmetric for `⌘⇧\\` (expected: promote aux back to main; actual: nothing).

**What still works:** the right-click "Move to Split View" / "Open in Split View" entries on tabs / FileTree / PinnedNav all PASS (per the smoke walk). CLI `duo split-view open` was not explicitly tested but its plumbing is identical and there's no reason to suspect a regression there.

**Suspected diagnostic threads to pull:**
1. **Did the chord registration actually wire?** Check `globalShortcuts.ts § matchGlobalShortcut` — confirm `Mod-\\` and `Mod-Shift-\\` branches return `splitViewToggle` / `splitViewPromote` IDs respectively.
2. **Did the dispatch wire?** Check `useKeyboardShortcuts.ts § dispatch` — confirm `case 'splitViewToggle'` and `case 'splitViewPromote'` invoke the corresponding opts callbacks.
3. **Did the App.tsx callback wire?** Check the `useKeyboardShortcuts({ splitViewToggle, splitViewPromote, ... })` call — confirm both are in the opts object.
4. **Renderer-side surface eats the chord?** TipTap, canvas iframe, xterm — any of these may consume `\\` before the global matcher sees it. Capture-phase document listener should fire FIRST, but check (BUG-012/013/014 family lessons).
5. **WCV before-input-event forwarder includes `\\`?** Confirmed in commit `ed4d097` — `electron/browser-manager.ts` adds `key === '\\'` to the `isDuoShortcut` list. But is it being forwarded correctly when browser pane has focus?
6. **Owner-clarification refinement** (`511d8b8`) renamed `splitViewClose` → `splitViewPromote`. Check that ALL references were updated (was the rename complete?). Specifically: `useKeyboardShortcuts.ts` opts type, dispatch case, deps array, and App.tsx wiring all need to use the new name. Suspected source of the regression.

**Cross-ref:** Phase 3b (commit `ed4d097` introduced the chords); commit `511d8b8` (the close → promote rename — most likely culprit if a callback ref dropped); BUG-001 / BUG-021 / BUG-038 lineage (closure-staleness in the keyboard dispatcher — though chord-was-never-seen is a different failure mode).

---

### BUG-078: FAQ tab opens on every app launch despite being closed last session (boot-default + default-pin double-up)

**Status:** ✅ **Fixed v0.6.5** (Sprint 4 Phase 5 — owner observation during BUG-072 walk).
**Priority:** Medium (recurring user-visible annoyance — close FAQ, relaunch, FAQ comes back).
**Filed:** 2026-05-04 (owner smoke walk note: *"why does a new tab of duo faq open on every app launch?"*).

**Owner-stated rule (verbatim, after agent-proposed fix):** *"if an faq is already open (it is, pinned) don't open another one"* and *"yours is better: boot load only on fresh app; skip if prev tabs persisted."*

**Root cause.** Two mechanisms re-opened the FAQ on every launch, even when the user closed it last session:

1. **Constructor boot-default.** `BrowserManager` constructor unconditionally called `this.addTab()` (FAQ-as-default-landing) before session restore had a chance to run. With session restore, `restoreFromSession` repurposed tab[0] by `loadURL`-ing the first saved URL — so the FAQ briefly flashed before being navigated away. Functionally OK, but a visible flicker.
2. **BUG-057 default-pin auto-restore.** [main.ts](electron/main.ts) post-restore loop iterated pinned entries and called `browserManager.addTab(pin.ref)` for any pin not already in `currentUrls`. Because the FAQ + What Duo Does are *default-pinned* per ENH-003 (and the user can't easily unpin them — pin chrome is for indication), closing the FAQ never stuck: it came back as a freshly-added tab.

**Fix (this commit, v0.6.5 Phase 5).** Both mechanisms gated on `hasPersistedSession`, peeked at boot via `sessionStateService.load()` BEFORE `BrowserManager` construction:

- **`BrowserManager` constructor** — new options arg `{ bootDefaultTab?: boolean }` (default `true` for back-compat). [main.ts](electron/main.ts) passes `bootDefaultTab: !hasPersistedSession`. With persisted session, the constructor doesn't auto-add the FAQ; `restoreFromSession` populates from saved state.
- **`restoreFromSession`** — handles the new "tabs[] is empty at call time" case by `addTab()`-ing the first saved URL fresh (instead of `loadURL`-ing onto a non-existent tab[0]).
- **BUG-057 default-pin restore** — gated on `!hasPersistedSession`. Original BUG-057 design predates working session restore; with session restore in place, the persisted session is the authoritative source of "what tabs were open." Fresh-app launches still get default-pinned tabs (FAQ + What Duo Does); session-restore launches don't get them re-introduced.

**Test plan / acceptance:**
1. Open FAQ. Close it. Quit Duo. Relaunch → FAQ stays closed.
2. Open FAQ + smoke-walk page. Quit. Relaunch → both come back, no duplicate FAQ.
3. Fresh install (no persisted session): FAQ opens as the boot landing tab.
4. Test all three on a packaged DMG before v0.6.5 cut (smoke walk row).

**Cross-ref:** ENH-003 (FAQ + What Duo Does default-pinned — pin chrome is preserved; the auto-restore behavior is what changed). BUG-057 (the auto-restore mechanism this fix scopes down). Stage 21c Phase 2 (session restore — the mechanism we're now treating as authoritative).

---

### BUG-079: ⌃⇧\` tab-cycle has multi-second latency + requires re-presses (recurring observation)

**Status:** 🆕 Filed — surfaced again in v0.6.5 Phase 5 re-walk (2026-05-04).
**Priority:** Medium (UX friction on a heavily-used chord; recurring class — owner has flagged variants of this multiple sprints).
**Filed:** 2026-05-04 (owner re-walk verbatim: *"ctrl-shift~ real latency (>2 seconds)/reattempts required before tabs cycled back"*).

**Symptom.** ⌃⇧\` (the reverse-direction tab cycle, mirror of ⌃Tab) takes >2 seconds to react and frequently requires re-pressing before any tab switch occurs. ⌃Tab forward-cycle is acceptably responsive.

**Recurring-class.** Tab-cycle responsiveness has surfaced multiple times: BUG-001 (first cycle), BUG-021 (post-session-restore stale closure), BUG-038 (focusedColumn drift), BUG-042 (browser pane focus), BUG-076 (faq.html unreachable post-`duo open`). Each has shipped a fix; the cumulative cycle code has acquired enough complexity that a new latency mode emerged. ENH-084 also filed a related observation in the v0.6.5 smoke walk arc.

**Hypotheses (not yet probed):**
1. **IPC round-trip on focus change.** Each cycle keystroke goes renderer → main → focus the WCV → main → renderer. If the WCV `webContents.focus()` call is synchronous + slow on certain tab kinds (browser tabs in particular), the cycle is gated by that.
2. **`activeIdRef` race after BUG-076 fix.** Phase 4's BUG-076 fix added `view.webContents.focus()` inside `BrowserManager.switchTab()`. If that call is now blocking the IPC return for ~2s on some tab kinds, the cycle handler waits before processing the next keystroke.
3. **Reverse-direction wraparound calc.** `cycleNext(direction: -1)` may have a different code path than `+1` that's not memoized / cached. Worth checking `tabCycle.ts`.
4. **Modifier-key release window.** The chord requires holding ⌃ + ⇧ while pressing \`. If the renderer's focus-change handler bumps focus mid-cycle, the OS may briefly drop the modifier state.

**Where to look:**
- `renderer/keyboard/tabCycle.ts` — the cycle algorithm.
- `renderer/keyboard/useKeyboardShortcuts.ts` — the chord dispatcher.
- `electron/browser-manager.ts § switchTab` — the focus call added in Phase 4.
- `cli/duo.ts` is NOT in the path (chord goes purely through renderer + main IPC).

**Next step:** add a console.log timing trace at the cycle entry + exit + IPC boundary to isolate which segment swallows the 2 seconds. Defer to v0.6.6 Sprint 5 — not a v0.6.5 cut blocker (the cycle still works eventually; this is latency polish).

**Cross-ref:** BUG-001, BUG-021, BUG-038, BUG-042, BUG-076 (recurring tab-cycle class — same family). ENH-084 (aux pane focus indicator — related focus-tracking).

---

### BUG-080: Bold text in markdown editor is unreadable in dark mode

**Status:** ✅ Shipped v0.6.6 (Sprint 5 close-out 2026-05-04). One-line CSS fix in `renderer/styles/globals.css`.
**Priority:** Medium (UX paper-cut — bold emphasis in any markdown doc viewed in dark mode renders as near-black text on dark paper).
**Filed:** 2026-05-04 (owner observation: viewing own `~/.claude/CLAUDE.md` in dark mode; bold "Primary obligation" / "Session awareness" / etc. were illegible).

**Root cause.** `.duo-editor-prose` applies Tailwind's `prose` class from `@tailwindcss/typography`. The plugin's default styling for `<strong>` is `theme(colors.gray.900)` (~`#111`). On the dark paper background `#1A1611` that's invisible. No explicit override existed; light-mode worked because gray-900 on light paper is readable, masking the gap.

**Fix.** Added `.duo-editor-prose :where(strong, b) { color: var(--duo-ink); }` so bold inherits the same theme-aware ink color as body text. Reads as dark in light mode, cream in dark mode.

**Verified:** opened `~/.claude/CLAUDE.md` in dark mode after the CSS landed; owner confirmed bold emphasis renders correctly.

**Cross-ref:** Stage 12 (Atelier palette / dark-mode rollout). Same class of issue as BUG-044 (paper-* classes silently falling through).

---

### BUG-081: HTML canvas Comment button gated on Claude session — and the entire hover-pill UX is wrong

**Status:** ✅ **FIXED** in v0.6.7 (Sprint 6 Phase 2, 2026-05-04). Replaced the hover Comment pill with three discoverable affordances:
- **Toolbar 💬 Comment button** in the EditorToolbar — always present when the host wires `actions.startComment` (canvas today; markdown editor Phase 4). Enabled state driven by `actions.canStartComment()` reading the live selection ref.
- **⌘⌥M global shortcut** — Google Docs parity. Routed through `renderer/keyboard/globalShortcuts.ts` (key id `'startComment'`) → `useKeyboardShortcuts` dispatches `'duo-start-comment'` window event → PageTab listens and runs `handleStartNewComment`. Uses `e.code === 'KeyM'` (not `e.key === 'm'`) because Option on macOS yields 'µ' — same gotcha as BUG-075 v2 and Slash.
- **Right-click "Comment" entry** in the canvas iframe context menu — gated on `parameters.frameURL.startsWith('about:srcdoc')` so the entry only appears in canvas iframes (not the markdown editor or the browser pane). Click → `wc.send(IPC.PAGE_COMMENT_REQUEST)` → renderer-side bridge in App.tsx re-dispatches as `'duo-start-comment'` → same PageTab handler.

The hover `<CommentButton>` primitive was deleted with the fix (no remaining callers). Send → Duo pill kept as-is. Verified all three affordances live + a comment posted via right-click landed correctly in the rail.

**Priority:** **High** — root cause identified + the planned fix is a UX redesign (drop the hover-pill model entirely; replace with kb shortcut + right-click + toolbar button).
**Filed:** 2026-05-04 (v0.6.6 pre-cut investigation). Reframed same day after owner found the gate + told us the hover-pill UX was never the right approach.

**Root cause (identified).** [`renderer/components/Page/PageTab.tsx:1437`](renderer/components/Page/PageTab.tsx:1437):
```tsx
{onSendToDuo && pillRect && !newCommentAt && (
  <>
    <SendToDuoPill ... />
    {!readOnly && lastCanvasSelectionRef.current?.anchorId && (
      <CommentButton rect={pillRect} onClick={handleStartNewComment} />
    )}
  </>
)}
```
The Comment button is rendered inside the same gate as the Send → Duo pill — and that outer gate is `onSendToDuo`, which is nullified when no Claude session is live. So when no Claude tab is open, BOTH pills hide. **Owner-confirmed**: the Comment button reappears as soon as a Claude session is active.

That's wrong on two levels: (a) the Comment button has no business being gated on Claude presence — comments don't require a Claude session, (b) the hover-pill UX itself is the wrong shape for "add a comment to selected text" anyway.

**Owner direction (UX redesign).** Drop the hover-pill model for Comment entirely. Replace with three discoverable affordances, mirroring Google Docs:

1. **Keyboard shortcut.** Use what Google Docs uses — **⌘⌥M** (`Cmd+Option+M`) on Mac. Adds a comment anchored to the current selection; opens the composer immediately.
2. **Context-click on text.** Right-click any selection → "Comment" entry in the context menu. Same composer flow.
3. **Toolbar button.** Permanent affordance in the canvas toolbar (next to the existing chrome). Click → comment on current selection. If no selection, no-op or hint.

The hover Comment pill goes away entirely. Send → Duo pill stays as-is (it's the right shape for that action — a quote-and-send gesture is more rare and benefits from being explicit).

**What to build:**
1. **Wire the kb shortcut.** Add `⌘⌥M` to `renderer/keyboard/globalShortcuts.ts` (the central registry). Forwarder pattern from `useKeyboardShortcuts` should reach inside the canvas iframe via the existing forwarder primitive (canvas keystrokes are already shipped through `installGlobalShortcutForwarder`). Handler calls `handleStartNewComment` if there's a selection with an anchor; no-ops otherwise.
2. **Add the context menu entry.** Canvas already has a right-click menu via `electron-context-menu`. Add a "Comment" entry that's enabled when there's a selection with a live `data-duo-id` anchor. Same handler as kb path.
3. **Add the toolbar button.** Look at where the canvas toolbar lives (probably `PageTab.tsx`'s sidecar / chrome row). New "💬 Comment" button — enabled-state mirrors selection presence. No floating pill.
4. **Remove the hover Comment pill.** Delete the `<CommentButton rect={pillRect} ...>` render at PageTab.tsx:1444 and the `CommentButton` primitive if nothing else uses it. Send → Duo pill stays.

**Editor-canvas parity disposition (per CLAUDE.md § 4 rule):** **(c) Deferred** — markdown-editor side blocks on MISSING-001 / Stage 14a (the entire comment data plane is unbuilt for TipTap). Once MISSING-001 lands, the same three affordances (kb / right-click / toolbar) wire to the markdown editor's comment handler. Pair the canvas redesign with the markdown bring-up so they ship together with consistent UX.

**Cross-ref:** MISSING-001 (markdown editor comments never shipped — pair). BUG-082 (comment rail doesn't restore on canvas reopen — separate persistence bug, same sprint). BUG-083 (rail visual association — separate visual gap, same sprint). BUG-024 (Send→Duo pill / Comment pill stacking — moot once the Comment pill is gone). ENH-052 (mechanical rename — innocent; not the regression source).

---

### BUG-082: Comment rail does not restore existing comments on canvas reopen

**Status:** ✅ **FIXED** in v0.6.7 (Sprint 6 Phase 1, 2026-05-04). Root cause: `builtThreads` useMemo had deps `[threadsTick, getDoc]`, but `threadsTick` was only bumped by `persistSidecarMutation` — neither the async `readSidecar` resolution nor the `handleReady` iframe-ready callback bumped it, so a fresh open with an existing sidecar never recomputed the rail. Fix: bump `setThreadsTick(v => v + 1)` after `readSidecar` resolves AND at the end of `handleReady`, so whichever async path finishes second triggers the recompute. [PageTab.tsx:467](renderer/components/Page/PageTab.tsx:467) and [PageTab.tsx:734](renderer/components/Page/PageTab.tsx:734). Verified via fresh-open repro (CLI-driven canvas creation + sidecar pre-write).
**Priority:** **High** (data-loss UX — the comment is preserved on disk in the sidecar, but the rail doesn't pick it up on reopen, so the user assumes it's gone).
**Filed:** 2026-05-04 evening (owner repro: added comment to `/tmp/p5-rewalk.html`, closed the canvas tab, reopened — comment rail was gone. Adding a new comment revealed the rail again).

**Regression-test gap.** Per the recurring-regressions feedback memory, this class of bug (comments-on-canvas regressing) wants durable test coverage, not just a smoke-walk line. The project doesn't currently have `@testing-library/react` (per `vitest.config.ts` — React component rendering is excluded from the test scope). Adding it for this one path is more infra than the fix warranted; queued as **FOLLOWUP-009: introduce @testing-library/react and write a regression test for the readSidecar / handleReady → rail-recompute orchestration**.

**Symptom.** Add a comment to a canvas. Close the canvas tab (or close + reopen Duo). Reopen the same file. The CommentRail should mount with the existing comment(s) visible. **It doesn't** — the rail is hidden. Adding a NEW comment causes the rail to appear with both old and new comments.

**Likely cause.** [`renderer/components/Page/PageTab.tsx:1422`](renderer/components/Page/PageTab.tsx:1422) gates the rail on `railThreads.length > 0` (BUG-015 fix from v0.3.1). The threads list has to be initialized from sidecar storage on mount. Two suspects:

1. **Sidecar load is async, but the gate is checked before it resolves.** On first mount, `sidecarRef.current.comments` is empty; the rail render-gate evaluates `false`; the rail doesn't mount. Even when the sidecar load completes and populates `sidecarRef.current.comments`, the render is using `railThreads` derived state — if that's not re-evaluating off the loaded sidecar, the rail stays hidden until something forces a re-render (like... adding a new comment, which mutates the threads list and triggers re-render).
2. **`railThreads` is computed from `sidecarRef.current` at mount time only.** The pattern `useMemo(() => deriveThreads(sidecarRef.current), [])` (or similar with a stale dependency array) would lock in an empty list at first mount and never recompute. Need to verify the actual derivation path.

**Where to look:**
- `renderer/components/Page/PageTab.tsx` — find `railThreads` definition and its dependencies.
- `renderer/components/Page/sidecar.ts` — the sidecar load path; when does it resolve relative to the rail render?
- `renderer/components/Page/commentAnchors.ts` — the anchor-resolution path that may also need to fire on load.

**Smoke verification (post-fix):** add 2 comments, close tab, reopen — both should be in the rail without any further action.

**Cross-ref:** BUG-081 (sibling — discovered in same investigation). BUG-083 (rail visual association). BUG-015 (the original "hide rail when empty" fix that may have over-correlated rail visibility with thread count).

---

### BUG-083: Comments in rail have no visual association with the text they comment on

**Status:** 🟡 **PARTIAL** in v0.6.7 (Sprint 6 Phase 3, 2026-05-04). Heading-level + paragraph-level anchors work; smoke walk surfaced three follow-up issues filed as BUG-088 / BUG-089 / BUG-090. Decision: hold the v0.6.7 cut until these land. Original three concerns:
- **Anchor decoration in canvas body.** New `data-duo-has-comment` attribute stamped on the anchor element (separate from the existing badge sibling) by `paintAnchors`. CSS rule (in the iframe-side stylesheet — see below) applies a subtle accent-soft background tint + bottom border so the user sees which text the comment attaches to. Resolved threads don't decorate (the visual would be noise).
- **Bidirectional click-to-focus.** Rail → anchor was already wired via `handleJumpToThread → scrollToAnchor`. New `installAnchorClickListener` adds the reverse: a delegated click on the iframe body catches clicks on `[data-duo-has-comment]` (or any descendant) and calls `setActiveThreadId(threadId)`. Walks up via `closest()` so clicking inline text inside a commented `<p>` still focuses the thread.
- **Active-thread emphasis.** New `data-duo-comment-active` attribute stamped on the active anchor (same pass as `data-duo-has-comment`). Stronger background — Google Docs' "this is the one we're looking at" affordance. Rail-side active styling was already wired in `CommentRail` via `duo-comment-thread--active`.

**Bonus fix (related miss).** The existing `.duo-comment-anchor` badge styles lived ONLY in `renderer/styles/globals.css` which doesn't reach the iframe (srcdoc documents are isolated). Badges rendered as plain text "1" inside canvases. New `installCommentAnchorStyles(doc)` installs the iframe-side stylesheet (idempotent, sentinel-tagged for serializer strip) at handleReady time, mirroring the `installJustAddedStyles` pattern. Light + dark mode honored via `@media (prefers-color-scheme: dark)`.

**Serializer strip.** Both new attributes added to `RUNTIME_ATTRS_TO_ALWAYS_STRIP` (parallel to the existing `RUNTIME_CLASSES_TO_STRIP`) so saved HTML never carries them — strips on every element regardless of the runtime sentinel since these live on user-authored elements.

**Priority:** **High** (UX cohesion — a comment that doesn't visibly attach to its anchor is barely a comment; doc readers don't know what's being commented on without clicking each thread).
**Filed:** 2026-05-04 evening (owner observation: "comments in the rail land with no association with the text that they are a comment _for_").

**Symptom.** Comments in the rail show their body + metadata, but nothing in the canvas body indicates *which text* the comment anchors to. Compare with Google Docs: an anchored comment highlights the source text (yellow underline / shaded background) and clicking the comment scrolls the document to the anchor (and vice versa — clicking the highlighted text focuses the matching comment thread).

**What's missing:**
1. **Anchor decoration in the canvas body.** The text spanned by the comment's `data-duo-comment-id` anchor should render with a visual indicator (subtle highlight / underline / left-rail tick — pick one). Today there's no decoration; comments float disembodied in the rail.
2. **Bidirectional click-to-locate.** Clicking a thread in the rail should scroll the canvas to its anchor (probably already wired via `onJumpTo`). Clicking the anchor's highlighted text should focus the corresponding thread in the rail (probably not wired — same `onJumpTo` callback in reverse).
3. **Active-thread indication.** When a thread is focused (rail-side or canvas-side), the linked anchor should highlight more strongly — Google Docs' "this is the one we're looking at" affordance.

**Where to look:**
- `renderer/components/Page/commentAnchors.ts` — anchor-resolution; does it stamp a visible class on the anchor element today?
- `renderer/components/Page/PageTab.tsx` — `handleJumpToThread`; wire the click-anchor → focus-thread direction too.
- `renderer/styles/globals.css` — comment-anchor styling. Should probably be a small CSS rule using `[data-duo-comment-id]` attribute selector.
- `renderer/components/editor/primitives/CommentRail.tsx` — passing through the active-thread highlight to thread cards.

**Editor-canvas parity disposition:** **(c) Deferred** — markdown-editor side blocks on MISSING-001 / Stage 14a; same visual contract should apply once it lands.

**Cross-ref:** BUG-081 (sibling). BUG-082 (sibling — persistence). MISSING-001 (markdown side — apply same visual contract there).

---

### BUG-085: Markdown editor doesn't pick up external writes — and autosave can squash agent edits

**Status:** 🔴 **IMMEDIATE PRIORITY for v0.6.7** (Sprint 6 mid-flight insertion). Owner repro 2026-05-04: wrote some MD; asked Duo to rewrite a section via Send → Duo (chord worked); Claude claimed to have rewritten it; the editor did not present the update. Actual root cause is multi-layered.
**Priority:** **High** (silent data loss / silent staleness — user trusts what the editor shows; reality on disk diverges; autosave can then overwrite the agent's edits).
**Filed:** 2026-05-04 (owner repro: see status line above).

**What's actually broken (three layers).**

1. **No file watcher in `MarkdownEditor`.** [`renderer/components/editor/MarkdownEditor.tsx`](renderer/components/editor/MarkdownEditor.tsx) loads the file once on mount (line ~360) and never subscribes to filesystem-change events for the loaded path. The `window.electron.files.watch(paths, cb)` API exists (Stage 10 / BUG-007) and the navigator already uses it; the editor doesn't. So an `fs.write` against the open file (Claude's `Write` tool, an external editor save, a `git checkout`, etc.) never reaches the editor — the in-memory buffer stays at the pre-write content, and the user sees stale content while the file on disk has moved on.

2. **Autosave squashes external writes when the buffer is dirty.** When the local buffer is dirty (user typed since last save), the autosave debounce eventually fires and writes the editor's serialized content. It does NOT compare against the on-disk file — it just blindly overwrites. So the sequence "user types → Claude `fs.write`s the agent-rewritten section → user pauses → autosave fires" produces a save that reverts Claude's edits without warning.

3. **Skill / agent docs don't direct Claude to `duo doc write`.** The right path for "rewrite a section in the active markdown editor" is `duo doc write --replace-selection` (or similar), which goes through the EDITOR_DOC_WRITE IPC pair → MarkdownEditor's `onDocWrite` handler at line 1064 → in-place TipTap mutation + just-added wash + clean integration with the autosave pipeline. Claude used `Write` (raw fs) instead, which bypasses all that. The skill should make this distinction explicit so future "rewrite this section" prompts route through the agent-aware path.

**Fix scope (this sprint).**

a. **File watcher in `MarkdownEditor`.** Subscribe via `window.electron.files.watch([path], handler)` after file load completes. On change: read disk; compare to `lastSavedBodyRef.current`. If equal → ignore (it's our own save echoing back). If different → branch on `dirty`:
   - **Clean buffer:** silently reload — `editor.commands.setContent(diskBody, false)` + advance `lastSavedBodyRef` + a brief "Updated from disk" toast.
   - **Dirty buffer:** show a non-modal conflict banner. Two actions: "Reload from disk (loses my edits)" and "Keep mine (will overwrite on save)". The third future action — "Save my changes as a new file" — deferred.

b. **Skill / agent docs.** Add a one-line nudge to `agents/duo.md` (verb cheat-sheet) and `skill/SKILL.md` directing agents toward `duo doc write` for "rewrite / replace / edit a section" of the active markdown editor's buffer, with a note that `Write` to disk works but loses the editor's just-added wash and risks autosave conflicts.

c. **PageTab parity (deferred per CLAUDE.md § 4).** Same gap exists for the HTML canvas's PageTab — its file load is also one-shot. Mirror the watcher fix to PageTab in a follow-up; not blocking v0.6.7 (the user hit the markdown-editor variant).

**Cross-ref:** Stage 16 (the broader "external-write reconciliation" spec — this BUG is the v1 implementation). BUG-033 v2 (the harder OT-merge case for `duo doc write` against a dirty buffer — separate from the fs-write reconciliation here, deferred). FOLLOWUP-NN: PageTab mirror.

**Editor-canvas parity disposition (per CLAUDE.md § 4):** **(c) Deferred** — markdown editor ships v1; PageTab's canvas surface gets the same watcher pattern in a follow-up.

---

### BUG-086: Smoke-walk skill should re-verify the page rendered as a browser tab (not as a canvas)

**Status:** 🔴 **IMMEDIATE PRIORITY for v0.6.7** (Sprint 6 mid-flight, 2026-05-04 smoke-walk procedural failure)
**Priority:** **Medium** (smoke-walk is sprint infrastructure; if it can route to the wrong surface, the cut process gets jammed and the walk has to be re-done by hand).
**Filed:** 2026-05-04 (smoke walk v0.6.7 — owner reported "smoke walk non functional — opened as editable in html canvas so I could not click the 'copy results' button").

**Symptom.** The smoke-walk page (`docs/dev/smoke-walks/v0.6.7.html`) was generated correctly with `<meta name="duo-open-in" content="browser">`. The skill ran `duo open <path>` which returned `{ ok: true, routedTo: "browser" }` — the bridge confirmed routing to the browser pane. AND `duo url` immediately after confirmed the URL + title matched the smoke-walk page in the browser tab list. Despite all that, the user saw the page render as an editable HTML CANVAS and couldn't click the Copy results / Send to Claude buttons (the canvas's contentEditable swallows interactions). The user fell back to copying the page text by hand.

**Likely cause.** Investigation deferred. Two hypotheses:
1. The user's last-active working tab was a canvas, and `duo open` opened the smoke walk into a NEW browser tab BUT the working pane stayed on the previous canvas — the user saw the canvas and assumed it was the smoke walk.
2. There's a path where the meta tag's routing intent is honored at the bridge level (return path returns `routedTo: "browser"`) but the renderer-side WorkingPane still mounted it as a canvas. Either way, post-`duo open` checks (which the skill DOES run via `duo url`/`duo title`) would NOT have caught hypothesis 1 — they only verify the BROWSER tab's URL/title.

**What to fix on the skill side:**
1. After `duo open`, ALSO run `duo selection --pane canvas` and `duo selection --pane editor` — confirm neither returns the smoke-walk path. If either does, the page rendered into the wrong surface.
2. Pre-handoff, check `activeWorking.kind === 'browser'` via `duo nav-state` (or equivalent). If the working pane is showing a canvas/editor, the user's eye lands there — not on the new browser tab.
3. If detection fails, instruct the user to click the smoke-walk tab in the browser-tab strip explicitly before walking.

**Cross-ref:** smoke-walk SKILL.md § Step 5 (the existing focus-verification step doesn't catch this case).

---

### BUG-087: Markdown editor — clicking a rail thread beyond #1 doesn't activate the corresponding anchor's stronger background

**Status:** ✅ **FIXED** in v0.6.7 (Sprint 7 rev6 follow-up, 2026-05-05). Root cause was BUG-088/090's duplicate-id-on-clone bug: when the user pressed Enter to make a second / third bullet, contentEditable cloned the source `<li>` and the new sibling kept the parent's `data-duo-id`. Three bullets sharing one id meant `[data-duo-id="X"]` selected MULTIPLE elements; setting `data-duo-comment-active` walked all matches but the second match's repaint visually got lost behind the first. Once `installAutoStampIds` re-stamps duplicates on insertion ([idInjector.ts](renderer/components/Page/idInjector.ts)), every bullet gets a unique id and the active-attribute lands on exactly one element. Verified live 2026-05-05: rail-click on a comment anchored to the middle bullet activates only the middle bullet's strong-tint emphasis.
**Priority:** **Medium-High** (visual association partly broken; the rail-side active state still works but the body-side strong-tint transfer fails for everything past thread #1).
**Filed:** 2026-05-04 (smoke walk).

**Symptom.** Markdown editor with multiple comments. Clicking the FIRST rail thread correctly activates the first paragraph's anchor (stronger orange background appears). Clicking the SECOND rail thread updates the rail's active state (border + box-shadow) BUT the second paragraph's anchor stays at the inactive tint — `data-duo-comment-active` doesn't transfer.

**Likely cause.** The useEffect at MarkdownEditor.tsx that sets `data-duo-comment-active` runs on `[activeThreadId, builtThreads, editor]`. Sidecar + ranges look correct on disk (verified — three distinct `anchorId`s, three distinct `excerpt`s). Hypotheses:
1. ProseMirror re-renders the doc in some path between rail-click and DOM read, wiping the manual `setAttribute`.
2. A stale closure inside the effect captures an outdated `activeThreadId`.
3. The `querySelectorAll` finds the wrong span when multiple distinct comment marks coexist (the browser may be returning the LAST match instead of the matching one for some attribute selector).

**Fix path.** Set the active attribute via a ProseMirror Decoration instead of a direct DOM mutation — Decorations are part of PM's render pipeline so they survive re-renders. Or render the active state via a SECOND mark attribute (`active: boolean`) — but PM marks aren't great for transient state, so Decoration is cleaner.

**Cross-ref:** MISSING-001 (parent feature). PageTab uses the same direct-setAttribute pattern for canvas — needs cross-check that BUG-087 doesn't also apply to canvas (BUG-083 walked OK for the FIRST canvas comment but multi-comment behavior wasn't smoke-tested).

---

### BUG-088: Canvas — anchor decoration missing on bullet `<li>` text

**Status:** ✅ **FIXED** in v0.6.7 (Sprint 7 rev6 follow-up, 2026-05-05). Root cause was NOT the originally hypothesized "injectIds doesn't stamp `<li>`" — `<li>` was already in the stamped-tag walk. The actual bug: when contentEditable splits a list item on Enter, the new sibling `<li>` is created as a clone of the source and inherits its `data-duo-id`. The MutationObserver in `installAutoStampIds` saw the new node had an "existing" id and skipped it, so all sibling bullets ended up sharing one id. Comments on any of them anchored to the same element via `[data-duo-id="X"]`. **Fix.** [idInjector.ts § stampElement](renderer/components/Page/idInjector.ts) now detects duplicates: if any other element in the body already owns the id, the new element is a clone and gets a fresh ULID. First-in-document keeps its id (so existing comments still resolve); later siblings get unique ids. Verified live 2026-05-05: typed three bullets in a fresh canvas, file on disk shows 3 distinct `data-duo-id`s on the `<li>`s; commenting on the middle bullet decorates only the middle bullet.
**Priority:** **Medium-High** (canvas comment scope appears block-only; bullet items + nested children are silent commenters).
**Filed:** 2026-05-04 (smoke walk).

**Symptom.** Canvas. User selects text inside a bullet `<li>` and adds a comment via the toolbar. Comment lands in the rail correctly (sidecar persists, thread visible). But the bullet text gets NO orange decoration in the body — the visual association is missing for `<li>` content.

**Likely cause.** The canvas's anchor model is per-element via `data-duo-id`. `injectIds` (renderer/components/Page/idInjection.ts? or similar) probably stamps `data-duo-id` on a specific list of block-level tags — `H1-H6, P, BLOCKQUOTE, etc.` — and DOESN'T include `LI`. When the user comments on bullet text, the closest ancestor with a `data-duo-id` is the parent `<ul>` or even further up the body. paintAnchors then stamps `data-duo-has-comment` on that ancestor — but the `<ul>`'s text content is just whitespace + child `<li>`s, so the visual decoration applies to nothing visible.

**Fix path.** Extend `injectIds`'s stamped-tag list to include `LI` (and maybe `TD`/`TH` for table cells, `DT`/`DD` for definition lists). This is also the proximate cause of BUG-090 — when multiple `<li>`s share a parent `<ul>`, comments on different bullets currently both anchor to the same `<ul>` data-duo-id and grouped together.

**Cross-ref:** BUG-090 (same root cause), BUG-083 (parent visual-association feature).

---

### BUG-089: Canvas — anchor decoration "flickers" while typing inside a commented heading

**Status:** 🔴 **IMMEDIATE PRIORITY for v0.6.7** (BUG-083 smoke-walk follow-up)
**Priority:** **Medium** (cosmetic; users notice and worry the comment is breaking).
**Filed:** 2026-05-04 (smoke walk).

**Symptom.** Canvas. User adds a comment to an H1, then types inside that H1 to edit it. The orange anchor decoration on the H1 visibly flickers (briefly disappears + reappears) on each keystroke.

**Likely cause.** paintAnchors is called from the builtThreads useMemo / useEffect chain. On every typing transaction, MutationObserver fires → handleChange → … some path that re-runs paintAnchors. paintAnchors removes + re-stamps `data-duo-has-comment` (instead of leaving it in place when the anchor element is still present). The remove-then-stamp window is one paint frame and is visible as a flicker.

**Fix path.** In paintAnchors's loop, only update attributes that have CHANGED. If the anchor element already has `data-duo-has-comment="1"`, don't strip + re-set. Same for `data-duo-comment-active`.

**Cross-ref:** BUG-083 (parent feature). commentAnchors.ts § paintAnchors.

---

### BUG-090: Canvas — comments on non-adjacent text get concatenated into a single rail thread

**Status:** ✅ **FIXED** in v0.6.7 (Sprint 7 rev6 follow-up, 2026-05-05). Same root cause as BUG-088: contentEditable cloned `<li>`s shared one `data-duo-id`, so `buildThreads`'s anchor-key bucketing collapsed multiple comments under a single thread. With the duplicate-detect fix in [idInjector.ts](renderer/components/Page/idInjector.ts), each bullet has a unique id, comments anchor on distinct elements, and threads stay distinct. Verified live 2026-05-05.
**Priority:** **High** (data-correctness — comments meant for different content show as one thread; user can't tell what each comment refers to without expanding the rail card).
**Filed:** 2026-05-04 (smoke walk).

**Symptom.** Canvas. User adds two comments on two different non-adjacent elements (e.g. a bullet `<li>` and a paragraph elsewhere). Both comments end up grouped under a SINGLE rail thread as if they were replies to the same parent comment.

**Likely cause.** Almost certainly the same root cause as BUG-088: when `injectIds` doesn't stamp `data-duo-id` on `<li>`, comments on bullet text fall back to the closest ancestor with a `data-duo-id` — the parent `<ul>` or `<body>`. Two distinct comments on different bullets both get the same `anchorId`. The thread builder groups by `anchorId`, so they look like a single thread with multiple replies.

**Fix path.** Same as BUG-088 — extend `injectIds`'s stamped-tag list. After the fix, each `<li>` gets its own data-duo-id; comments anchor on the correct element; threads stay distinct.

**Cross-ref:** BUG-088 (same root cause). Confirms there are NO comment-add paths that should ever attribute to a non-stamped element — if needed, harden `handleStartNewComment` to refuse if the closest ancestor's stamped `data-duo-id` belongs to a container element (`<ul>`, `<ol>`, `<body>`, `<main>`) rather than a leaf-content element.

---

### BUG-091: WorkingPane tab right-click menu missing "Move to split view" entry

**Status:** 🟡 **LIKELY FIXED — Sprint 7 Phase 3c plumbing landed the entry; verification owed in Sprint 11 walk-2 (2026-05-07).** Code reading confirms the menu IS built correctly today: `WorkingTabStrip § buildContextMenu` line 611 pushes 'Move to Split View' when `onMoveToSplit` (or `onMoveBrowserTabToSplit` for browser tabs) is wired; App.tsx mounts WorkingPane with `onMoveTabToSplit={splitViewMoveTabByPath}` (line 2858) which threads through to WorkingTabStrip as `onMoveToSplit`. The bug as filed (2026-05-04, pre-Phase-3c) was true at that point in the code's history but resolved silently when Phase 3c added the browser-tab branch. Walk verification step: right-click a markdown / canvas tab in the working strip → confirm "Move to Split View" appears.
**Priority:** **Low** (workaround exists: navigator right-click works).
**Filed:** 2026-05-04 (smoke walk other-notes).

**Symptom.** User right-clicks a WorkingPane tab in the strip (not in the navigator) and looks for "Move to split view" — entry not present. Same gesture against the same file via the navigator's right-click menu does have the entry.

**Likely cause.** The two right-click menus (`WorkingPane.tsx` for tab-strip clicks, `FileTree.tsx` for navigator) were built independently; the split-view action was added to FileTree but not back-ported to the tab strip.

**Fix.** Add the entry to WorkingTabStrip's right-click menu, mirroring FileTree's wiring.

**Cross-ref:** Sprint 3 Phase 3b split-view feature.

---

### BUG-092: "Move to Split View" promotes scripted browser pages to a script-blocked canvas

**Status:** ✅ **FIXED in v0.6.7 (Sprint 7 Phase 3c, 2026-05-04 evening session).** Browser tabs can now live natively in the Split View aux slot via a new `auxBrowserTab` renderer state + `BrowserManager.moveTabToAux/releaseAuxTab` + new `<AuxBrowserSlot>` component that mirrors `BrowserRenderer`'s bounds-push pattern over a separate `BROWSER_AUX_BOUNDS` IPC channel. The pinned tab stays a real Chromium tab, NOT a canvas iframe — scripts run normally, Copy buttons work, worksheet / smoke-walk / dashboard pages function end-to-end in split view. CLI parity via `duo split-view open-browser <id>` (id from `duo tab` listing). File-aux and browser-aux are mutually exclusive (pinning one releases the other). Right-click "Move to Split View" on a browser tab in the WorkingTabStrip routes through the new browser-aware path automatically.
**Priority:** **High** for the workflow.
**Filed:** 2026-05-04 (rev3 walk PROCEDURAL-SPLITVIEW-READONLY FAIL — "Copy results button disabled").

**Symptom.** User has a worksheet / smoke-walk / dashboard page open in the browser pane (e.g. via `duo open <path>`). Right-clicks the tab → "Move to Split View." Page promotes to aux as a file tab and renders in the canvas. Page is read-only (good — `<meta name="duo-editable" content="false">` works). BUT: every interactive button (Copy results, Send to Claude, Clear saved, mark-all, per-step Copy buttons, the live-tally script, localStorage persistence, ENH-094 `duoPlaygroundAction` event emission) is inert. Worksheet is unusable in the canvas surface.

**Root cause.** Stage 17a's iframe sandbox is `allow-same-origin allow-popups allow-forms` — explicitly NO `allow-scripts` (PRD H4/H8). All worksheet behavior lives in one inline `<script>` block (see `.claude/skills/worksheet/generate.mjs` lines 649–963); none of it runs in a sandboxed iframe. Buttons render and look enabled, but no event handlers were ever attached. `<meta name="duo-editable" content="false">` (added in [99826fa](https://github.com/dudgeon/duo/commit/99826fa)) was the wrong-layer fix — it stopped contentEditable from swallowing clicks as cursor placement, but didn't restore script execution. BUG-091's right-click lift was structurally over-broad: file-URL browser tabs CAN be promoted to aux, but the resulting canvas mount is a meaningfully different surface than the source browser tab.

**Fix (real — Phase 3c, queued for next sprint).** Browser-tabs-in-aux. Aux pane learns to host a `WorkingTab` of `kind: 'browser'` rendered through BrowserManager rather than promoting to file. Worksheet stays a real Chromium tab on either side of the split; scripts run; user gets the smoke walk side-by-side with the canvas being tested. Touches: `App.tsx auxState` shape (path-only → `{ kind, path?, browserTabId? }`), `WorkingPane.tsx` aux render branch, `BrowserManager` aux-slot bounds tracking, `splitViewMoveTabByPath` swap semantics for the cross-kind case.

**Mitigation (short-term, can land before Phase 3c).** In `WorkingTabStrip § buildContextMenu`, when `tab.type === 'browser'` AND the resolved page declares `duo-open-in: browser`, drop the "Move to Split View" entry (it's a footgun). The path is reachable via the page meta (already parsed in `playgroundActions.ts` for the `duo-editable` lock). Or: pre-flight the navigation — if the source browser tab's URL is `file://` AND the file's `<meta name="duo-open-in">` is `"browser"`, refuse the move with a one-line toast. Doesn't unblock the rev3 PROCEDURAL goal but stops silent-fail. Recommended only if Phase 3c slips.

**Why this matters.** The whole worksheet primitive is built around the smoke-walk → reading the canvas concurrently flow. The user's natural gesture ("split view, walk on left, canvas on right") was being silently broken. Cut blockers for any sprint that ships smoke walks, dashboards, or scripted pages until either Phase 3c lands or the mitigation lands.

**Cross-ref:** [99826fa](https://github.com/dudgeon/duo/commit/99826fa) (the over-broad BUG-091 lift); BUG-091 (the right-click entry that BUG-092 says is conditionally wrong); Sprint 3 Phase 3a/3b/3c (split-view, deferred phase); PRD H4/H8 (canvas no-scripts sandbox); ENH-094 (browser-pane scripted-page action surface — works *because* browser pane is a real Chromium tab, the exact thing canvas isn't).

---

### BUG-093: Right-click tab → Move to Split View can crash the renderer

**Status:** 🟡 **Filed + INSTRUMENTED in v0.6.7** (smoke walk v0.6.7-rev3 OTHER-NOTES, 2026-05-04). Awaits a clean repro against the instrumented build.
**Priority:** **High** (when the bug fires, the canvas / editor crashes; pre-instrumentation the entire renderer dropped to the app-level error page; post-instrumentation the WorkingPane drops to a localized error panel and the rest of the app — terminal column, file tree, banners — keeps running).
**Filed:** 2026-05-04 (rev3 walk BUG-088/090 step 3 — "tried to move that canvas to split view (right click tab) and it caused a render error that forced reload of the whole app").

**Symptom.** With a fresh canvas active in the working pane (rev3 step was a `/tmp/v067r3-bullets.html` canvas with a few bullets typed and one comment thread), user right-clicks the tab → "Move to Split View." The renderer crashes (React error overlay or main-process error message). Pre-v0.6.7-instrumentation, the app-level boundary caught it but the user lost their entire working session on Reload.

**Suspected causes (still need a clean repro + the new traces to confirm).**
- Dirty-replace swap path in `App.tsx § splitViewMoveTabByPath` — the aux slot's existing content gets promoted back to main as a fresh file tab; if the canvas was mid-mount (autosave debouncer pending, comment-rail mounting, auto-stamp observer attached, user-typed mutations not yet flushed), the unmount/remount cycle could trip a stale-ref or unmount-after-setState pattern.
- Auto-stamp observer cleanup race (recent: [99826fa](https://github.com/dudgeon/duo/commit/99826fa) dropped the install sentinel and now relies on idempotent stamping; cleanup function returned by `installAutoStampIds` may not run before the iframe's `srcdoc` swap on remount).
- Comment data-plane (Sprint 6 Phase 4 — [ea1e828](https://github.com/dudgeon/duo/commit/ea1e828)) — the rail / TipTap data plane assumes a stable surface; an iframe re-srcdoc during a swap may leave dangling subscriptions.

**Instrumentation landed (v0.6.7).**
- **Inline `ErrorBoundary` wraps `<WorkingPane>` in `App.tsx`.** A render error inside WorkingPane no longer drops the entire renderer to the app-level error page — it shows a localized "WorkingPane hit a render error" panel inside the working column with a "Try again" button (remounts via the boundary's `retryKey` bump) and a "Reload renderer" fallback. Terminal column, file tree, banners, menu all keep running. Captured `[ErrorBoundary:WorkingPane]` console error survives the remount / persists in devtools.
- **Structured `[BUG-093]` console traces in `App.tsx § splitViewMoveTabByPath`.** Logs at every decision point: ENTRY (with auxState / dirty count / fileTabs count), no-op-already-in-aux, dirty-replace gate firing, dirty-replace gate CANCELLED, beginning swap, COMMITTED. Cheap when no crash happens; if the next move-to-split crashes, the last `[BUG-093]` line in the console names which step preceded the throw.

**Repro plan (now armed).** Open Duo dev. Type some bullets in a fresh canvas. Add a comment on one bullet. Open devtools console (filter on `[BUG-093]` and `[ErrorBoundary:WorkingPane]`). Right-click the canvas tab → "Move to Split View." If it crashes:
1. Read the last `[BUG-093]` log — the step it printed identifies WHICH phase of the swap was running.
2. Read the `[ErrorBoundary:WorkingPane]` log — the error message + component stack identifies WHICH component threw.
3. Cross-reference the two. The combination is usually enough to name the bug without further digging.

**Code-side analysis (Sprint 8 Phase 4, 2026-05-06).** Without a clean live repro yet, I audited the suspect code paths against the v0.6.7 instrumentation. Three structural issues stand out as likely contributors when the bug fires:

1. **Multi-setState cascade across `await` boundary** ([App.tsx § splitViewMoveTabByPath:1564-1647](renderer/App.tsx)). After `await window.electron.browser.releaseAuxTab()` (line 1566) and `await window.electron.dialog.confirm(...)` (line 1591), React's automatic batching is broken. The subsequent block fires four separate setStates in sequence: `setFileTabs(filter)` (1619), `setFileTabs(append)` (1627), `setActiveWorking(...)` (1634), `setAuxState(...)` (1643). Each triggers a render. WorkingPane's intermediate-render states are mid-swap — fileTabs may already not include the moving-in path while activeWorking still references it, OR the new aux path is set before fileTabs has stabilized. A child component (PageTab → RenderedPage's iframe wire) reading inconsistent state during one of those intermediate renders is a plausible throw point.

2. **Stale `fileTabs` closure in setActiveWorking** (line 1636). `const wasMoved = fileTabs.find(t => t.id === prev.id && t.path === path)` reads `fileTabs` from the useCallback closure rather than React's latest state. Once line 1619's `setFileTabs(prev => prev.filter(t => t.path !== path))` queues, the closure-captured `fileTabs` is stale by the time line 1636 runs. The find still works (we want pre-removal data), but a similar pattern elsewhere could miss updates and cause an inconsistent state read.

3. **PageTab unmount/remount during swap** — when auxState.paths changes, WorkingPane decides which tab kind=`'page'` mounts in main vs aux. The path move triggers a `key={tab.id}` change on the PageTab, forcing unmount + remount. handleReady's wireCleanupRef cleanup chains (selectionchange listener, MutationObserver from installAutoStampIds, comment-anchor click delegate, just-added repaint scheduler) all return cleanup functions that must run BEFORE the new wire fires. If a previous wire's cleanup races with the new wire's setup, the new doc could observe leaked listeners or torn-down state. The recent BUG-088 fix (commit `e203b7c`'s ENH-091 caret-seed change uses the same wire path) doesn't add a new failure mode but does reaffirm the wire-path's complexity.

**Defensive fix candidates (deferred — low confidence without repro):**
- (a) Wrap the post-await setState block in `flushSync` from `react-dom` so all four setStates apply synchronously as one render batch. Trade: flushSync has its own caveats (forbidden during render; can de-optimize React's scheduling).
- (b) Restructure the swap: compute the desired state shape first (one object), then call setStates in dependency order with a single useReducer-style update. Bigger refactor but eliminates the intermediate-render risk class.
- (c) Add explicit unmount-stabilization in PageTab — guard handleReady against stale doc references via a per-mount epoch counter that handleReady checks before each side-effect install.

**Filed FOLLOWUP-013** (next sprint) to drive the clean-repro investigation: open Duo dev with devtools open + filtered on `[BUG-093]` + `[ErrorBoundary:WorkingPane]`, exercise the rev3 repro shape (fresh canvas + bullets + one comment + right-click → Move to Split View), capture the trace + ErrorBoundary log + component stack. With those three lines the fix usually names itself; without them any code change is speculation.

**Cross-ref:** BUG-092 (companion — even when the move *succeeds*, the resulting canvas is broken because the iframe sandbox blocks scripts); BUG-091 (the over-broad lift that gated this); BUG-065 (the original v0.6.3 ErrorBoundary that this extends with `inline` + `label` + `Try again`); Sprint 6 Phase 1/3/4 (comment-system work that may have introduced the unmount race).

---

### BUG-095: Click into aux-pinned browser tab steals main pane focus and switches main to a different tab

**Status:** ✅ **FIXED** in v0.6.7 (Sprint 7 Phase 3c follow-up, 2026-05-05). `BrowserManager.wireEvents` now forwards `{ tabId, slot }` with `BROWSER_FOCUS_GAINED`; renderer's [App.tsx:1782](renderer/App.tsx:1782) handler only flips `activeWorking` to `'browser'` when `slot === 'main'`. `focusedColumn` still flips to `'working'` either way. Type signature in [host-api.ts:275](shared/host-api.ts:275) updated; preload bridge in [preload.ts:492](electron/preload.ts:492) carries the payload.
**Priority:** **High** (broke the primary Phase 3c use case — split-view smoke walks were unusable because clicking a pass/fail radio in the aux'd worksheet kicked the canvas under test out of the main pane).
**Filed:** 2026-05-05 (rev4 walk OTHER NOTES — "click on smoke walk browser in split view, main pane focus stolen by different browser").

**Symptom.** With a browser tab pinned in Split View aux and a markdown editor / canvas active in main, clicking anywhere inside the aux'd browser tab caused the main pane to switch from the editor / canvas to a different (random non-aux) browser tab. If only one non-aux browser tab existed, that one took main; if multiple, whichever `BrowserManager.activeIndex` happened to point at. The user lost their work-in-progress visibility every time they interacted with the aux pane.

**Root cause.** `BrowserManager.wireEvents` fires `BROWSER_FOCUS_GAINED` from `view.webContents.on('focus', …)` for ANY view, including the aux-pinned one. The renderer's handler unconditionally set `activeWorking = { kind: 'browser' }`, which caused WorkingPane to render `<BrowserRenderer>` in the main pane — and `BrowserRenderer` shows whatever `BrowserManager.getState()` returns, which uses `this.activeIndex`, which is the FIRST NON-AUX tab. So clicking the aux tab caused main to switch to whichever other tab happened to be the main-strip's active index.

**Fix.** Two-line change at the focus listener (forward `{ tabId, slot }` payload) plus a one-line guard at the renderer subscriber (`if (payload.slot === 'main') setActiveWorking({ kind: 'browser' })`). `slot` is computed `tab.id === this.auxTabId ? 'aux' : 'main'` at fire time. Aux focus events still flip `focusedColumn` to `'working'` so the focus glow tracks correctly.

**Cross-ref:** BUG-092 (parent — Phase 3c shipped browser-in-aux); BUG-096 (sibling — closeTab activated the aux tab as next-active and blanked aux bounds; same Phase 3c follow-up session).

---

### BUG-096: Closing the last main-strip browser tab while another is in aux blanks the aux pane

**Status:** ✅ **FIXED** in v0.6.7 (Sprint 7 Phase 3c follow-up, 2026-05-05). `BrowserManager.closeTab` next-active picker now skips the aux tab; spawns a fresh `about:blank` in main if only the aux tab would remain. Mirrors the existing "closing the last tab → open blank tab" pattern (BUG-020 family).
**Priority:** **High** (Phase 3c integration bug; aux pane blanks during normal multi-tab cleanup).
**Filed:** 2026-05-05 (rev4 walk OTHER NOTES — "when closed faq.html from main tab, it blanked (dark brown) the split view where I was looking at/working with the smoke walk").

**Symptom.** With a browser tab pinned in Split View aux (e.g. a smoke walk page) and one or more other browser tabs in main (e.g. faq.html), closing one of the main tabs caused the aux pane to go blank/dark-brown. The pinned aux tab's content disappeared from view; the WCV repositioned to overlay the main slot but main had nothing to render either.

**Root cause.** `closeTab`'s next-active picker did `this.activeIndex = Math.max(0, idx - 1)` without checking whether the resulting index pointed at the aux-pinned tab. When the aux tab became the new "main active", `setBounds(this.currentBounds)` overwrote its `auxBounds` with main bounds. The aux pane's React DOM was still mounted (the renderer didn't know about the bounds shift), but the WebContentsView was now positioned over the main pane area.

**Fix.** Replace the bare `Math.max(0, idx - 1)` with a `findNonAux(start)` helper that walks left first then right, skipping `auxTabId`. Returns `-1` when only the aux tab remains; in that case `closeTab` spawns a fresh `about:blank` (mirrors the existing BUG-020 last-tab pattern), takes the new tab as main-active, and leaves the aux tab's bounds untouched.

**Cross-ref:** BUG-092 (parent), BUG-095 (sibling), BUG-020 (last-tab spawn pattern this fix mirrors).

---

### BUG-103: Markdown editor blockquotes render with literal curly quotation marks instead of left-border style

**Status:** 🟡 Open (filed from idle-thoughts sweep).
**Priority:** Medium (visible cosmetic bug; affects every blockquote a user types in the markdown editor; blockquotes are a common markdown primitive).
**Filed:** 2026-05-08 (idle-thoughts sweep).

**Repro.** In the markdown editor (TipTap), type:
```markdown
> some block quote text
```

**Expected.** Blockquote renders with a left accent border + softened text color + non-italic, per the `.duo-editor-prose blockquote` rules at `renderer/styles/globals.css` lines 194-197 and 327-331. Pattern matches Obsidian / Notion / GitHub.

**Observed.** Each line of the blockquote is wrapped with visible Unicode curly quotation marks (`"…"`). E.g., `"some block quote text"` renders literally with the smart-quote glyphs, not as a left-border block.

**Root cause.** `renderer/styles/globals.css` line 291 applies `@apply prose max-w-none` to `.duo-editor-prose` (Tailwind Typography plugin enabled in `tailwind.config.ts` line 89). The `prose` defaults include:

```css
.prose blockquote { quotes: "\201C""\201D""\2018""\2019"; }
.prose blockquote p:first-of-type::before { content: open-quote; }
.prose blockquote p:last-of-type::after { content: close-quote; }
```

The Duo overrides at lines 194-197 and 327-331 only customize `border-left`, `color`, and `font-style` — they do NOT reset the `::before` / `::after` `content` rules from the prose plugin. Result: every blockquote paragraph picks up the curly-quote pseudo-elements.

**Fix.** Add to the `.duo-editor-prose blockquote` rules:

```css
.duo-editor-prose blockquote {
  quotes: none;
}
.duo-editor-prose blockquote p:first-of-type::before,
.duo-editor-prose blockquote p:last-of-type::after {
  content: none;
}
```

Probably 5-line CSS change. Verify in both light and dark themes — Tailwind Typography ships dark variants too.

**Affected files.** `renderer/styles/globals.css` only (no JS/TS change needed).

**Smoke after fix.**
1. Type `> hello world` in the markdown editor → should render with left accent border, no curly quotes.
2. Multi-line blockquote (`> line one` Enter `> line two`) → still left-border, no quotes.
3. Empty blockquote (just `>` and Enter) → no stray quote glyphs.
4. Switch theme light↔dark → border + text color swap, still no quotes.

**Cross-ref.** Pairs with BUG-061 (markdown parsing broken in HTML canvas — bullets, indent/outdent missing). Both surfaces drift from the markdown-source convention; this one is a CSS-reset miss, BUG-061 is missing extension config. Same theme: the editor's prose styling has gaps where Tailwind Typography defaults leak through.

---

### BUG-106: `duo edit <non-existent-path>` opens the tab + editor errors with ENOENT

**Status:** ✅ **Shipped Sprint 10 (2026-05-07).** Pre-flight existence check in [renderer/App.tsx § nav.onEdit handler](renderer/App.tsx) — when the path doesn't exist, the renderer pre-creates an empty file (or HTML boilerplate for `.html` / `.htm` paths via `classifyFile` + `htmlBoilerplate`) BEFORE calling `openFileSmart`. `files.write` mkdir-p's the parent so `duo edit /new/dir/Foo.md` lands `new/dir/` automatically. Symmetric with `⌘N`'s `onCommitNewFile` pre-write convention.
**Priority:** **Medium** — affects automation flows and the `touch + duo edit` scaffolding pattern. The file-doesn't-exist case isn't rare.
**Filed:** 2026-05-07.

**Symptom.** Run `duo edit /tmp/foo.md` against a path that doesn't exist on disk. The tab opens (the BUG-101 walk-2 fix correctly activates it), but the editor's mount-time `files:read` IPC fails with `Error invoking remote method 'files:read': Error: ENOENT: no such file or directory, stat '/tmp/foo.md'`. Error surfaces in DevTools console (and possibly as a banner in some flows).

**What ought to happen instead — design call.**
1. **Auto-create on open** (most user-friendly): renderer detects the ENOENT on the read attempt, creates an empty file at the path, retries the read, mounts the editor against the new empty file. Same shape as `⌘N` new-markdown-file flow but path-supplied.
2. **Refuse upfront** (most explicit): socket-server's `case 'edit'` checks existence before forwarding NAV_EDIT; returns `{ok: false, error: 'no such file'}` to the CLI. Doesn't add a tab.
3. **Mount empty + flag as new** (current `⌘N` shape): editor mounts with empty buffer, dirty flag implicitly set; first save creates the file. Easiest path; makes `duo edit` symmetric with `⌘N` for non-existent paths.

**Recommended (3) — symmetric with `⌘N`.** The editor already handles "new file" state for `⌘N`; extend that path to also fire when ENOENT lands during initial read. Keeps the open-then-write semantic agents and humans both expect.

**Affected files (estimated).** `renderer/components/editor/MarkdownEditor.tsx § initial read effect` (catch ENOENT and treat as new-file); possibly `core/socket-server.ts § case 'edit'` (no change if renderer handles it; pre-flight existence check if owner prefers option 2).

**Cross-ref:** Surfaced during BUG-101 walk-3. Independent of BUG-101's React-anti-pattern fix (which IS verified working — caret landed).

---

### BUG-105: Right-click → Copy path on a tab is a no-op

**Status:** ✅ **Shipped Sprint 10 (2026-05-07; walk-1 surfaced + walk-2 hardened).** Root cause: `navigator.clipboard.writeText` silently rejects when called from a native NSMenu's `click` handler — the user-gesture context closed when the menu opened, and Chromium's clipboard API requires either user gesture OR explicit permission. Fixed by adding a main-process clipboard IPC (`clipboard:write-text`) using Electron's `clipboard` module (no gesture requirement). Updated all three context-menu Copy-path call sites: [renderer/components/WorkingTabStrip.tsx](renderer/components/WorkingTabStrip.tsx) (working-pane tab right-click), [renderer/components/WorkingPane.tsx](renderer/components/WorkingPane.tsx) (aux-pane file tab), [renderer/components/FileTree.tsx](renderer/components/FileTree.tsx) (navigator).

**Walk-1 surfaced fourth call site** — the `<AuxBrowserSlot>` at [renderer/components/AuxBrowserSlot.tsx](renderer/components/AuxBrowserSlot.tsx) (the aux-pane chrome for a BROWSER tab pinned to split view) had no `onContextMenu` handler at all, so right-clicking it showed nothing. Walk-1 fix added the same NSMenu-via-IPC pattern: "Copy path" (when the URL is a `file://`, extracted via `pathFromFileUrl`) or "Copy URL" otherwise + "Move back to main." All four call sites now route through `window.electron.clipboard.writeText`, the canonical path for any future context-menu copy affordance.
**Priority:** **Low–Medium** — discoverable feature that's silently broken; affects "share this file's path with another tool" workflows.
**Filed:** 2026-05-07.

**Symptom.** Right-click on a working-pane tab → "Copy path" (the menu entry exists). Action does nothing visible. Clipboard is unchanged.

**Hypotheses.** The right-click menu in `WorkingTabStrip § handleContextMenu` likely has the menu item registered but the dispatcher branch isn't wired (or it's wired but `clipboard.writeText` fails silently in the WCV-context path the menu fires in). Could also be a missing IPC bridge between the menu's id and the actual copy action.

**Diagnostic plan.** Add a `console.log` at the right-click handler's `case 'copy-path'` (or whatever the menu id is) + at the `clipboard.writeText` call site. Right-click → Copy path; observe which traces fire.

**Cross-ref:** Surfaced during ENH-098 walk-3 (owner: "Second bug, tried to context click the index.md tab to copy path; copy path action was no op").

---

### BUG-104: ⌘⇧; chord triggered "file changed on disk" reload dialog

**Status:** ✅ **Shipped Sprint 11 walk-3 (2026-05-08).** Same root cause as BUG-107 — tiptap-markdown's serializer normalizes trailing whitespace on round-trip; pre-fix, save's pre-save reconciliation check (line 681) compared raw strings and false-positived. The ⌘⇧;-then-typing case fired autosave which fired the false conflict. Closed by BUG-107's whitespace-normalization fix.
**Priority:** **Low** — chord works but a spurious file-watcher reload prompt fires unexpectedly.
**Filed:** 2026-05-07.

**Symptom.** With Index.md open in the editor, owner pressed `⌘⇧;` (focus main pane chord), focus correctly moved to the editor + caret landed. But typing the first character triggered the BUG-085 file-changed-on-disk reload dialog: *"This file changed on disk while you were editing. Reload (loses your edits) or keep yours (next save will overwrite the new disk version)."*

**Hypotheses.**
1. **External-write reconciliation race** — chokidar may have observed a change to Index.md from the test-vault setup (the wikilink walk earlier touched files in that vault). The watcher's debounce window may have caught the post-walk write. Possible if the timestamps are stale and the watcher reconciles on the next focus.
2. **Owner's own actions** — possible but unlikely; owner reported the chord caused it.
3. **focusPane / openFile interaction with the file watcher's reconciliation logic** — less likely; focus changes shouldn't fire the file-watcher.

**Diagnostic plan.** Reproduce: open the test vault Index.md, press ⌘⇧;, type. Check whether the dialog fires. If yes, repeat with watcher disabled (toggle `chokidar.unwatch`). If reproducible without watcher, the dialog is firing from a different code path. Add a `console.log` at the BUG-085 dialog mount point with a trace of which event triggered it.

**Cross-ref:** Surfaced during ENH-098 walk-3 (owner: "May be unrelated, but after cmd-shift-; started typing in index.md and received...").

---

### ENH-110: JSON viewer/editor as a new canvas tab kind (PM persona — API responses, configs, webhook payloads)

**Status:** 🟢 **Code shipped 2026-05-10 (Sprint 14 — pulled forward from v0.6.13).** Decision gate closed walk-3; build landed same-day.

**v0.6.12 build summary:**
- New `kind: 'json'` `WorkingTabType` (shared/types.ts). Single tab kind for JSON + YAML; format implicit from path extension via `formatFromPath()` in [renderer/components/Json/jsonFormat.ts](renderer/components/Json/jsonFormat.ts).
- `fileClassifier` maps `.json` / `.jsonl` / `.har` / `.webmanifest` → JSON; `.yml` / `.yaml` → YAML. Both route to the same JsonView.
- [renderer/components/Json/JsonView.tsx](renderer/components/Json/JsonView.tsx) — Tier 3 `@uiw/react-json-view/editor` for tree + click-to-edit values; CodeMirror raw-text mode for source editing (`@uiw/react-codemirror` + `@codemirror/lang-json` + `@codemirror/lang-yaml`); toolbar toggle button between tree and source.
- Autosave on debounce (800ms — matches MarkdownEditor + PageTab pattern). Source-mode save runs `parseSource()` first and refuses to save invalid input (closes the §3a "missing closed quotes or brackets" AUQ).
- Tier 1+2 fallback: files >1 MB skip the tree (render cost prohibitive) and drop to read-only source view with a "Read-only (large file)" toolbar chip.
- ⌘N seeds parseable empties: `{}\n` for JSON, `# YAML document\n` for YAML.
- 26 vitest cases lock the contracts (6 classifier extensions + 20 jsonFormat parse/serialize/seed/round-trip).
- Docs: CLAUDE.md glossary row, skill/SKILL.md "Show the user a local file" section. `npm run sync:claude` ran.

**Walk-4 verification owed:** open .json + .yml fixtures, edit a value via tree, autosave fires, reopen → persistence; toggle to source view, edit raw text, save with valid input succeeds, save with invalid input shows error banner + refuses; >1 MB file drops to read-only source mode.

**Earlier history (kept for context).** Decision gate closed 2026-05-10 walk-3:

- **Q1 JSON tier:** Tier 3 (interactive collapsible tree)
- **Q2 Edit semantics:** Autosave on blur, with a follow-on question for the build sprint: *"should we do some level of linting/format checking on save, eg missing closed quotes or brackets? in the sprint when we build (just log the task for now) please think through options and AUQ to lock in the intent"*
- **Q3 YAML cohabitation:** Single tab kind with format discriminator
- **Q4 Library pick:** `@uiw/react-json-view`

**v0.6.13 P0 build scope** (locked from these picks):

1. New `kind: 'json'` WorkingTabType with format discriminator (`'json' | 'yaml'`).
2. `@uiw/react-json-view` integration — Tier 3 interactive tree, hover-to-copy, click-to-edit values.
3. File classifier maps `.json` / `.jsonl` / `.har` / `.yml` / `.yaml` to the new kind.
4. Tier 1+2 fallback for files >~1 MB (configurable threshold) where tree render cost is prohibitive.
5. Edit semantics — autosave on blur, matching markdown editor's pattern via existing SaveControl.
6. **Linting/format-check open question** (AUQ at start of v0.6.13): scope of save-time validation. Options: (a) basic JSON.parse sanity check + show inline error markers, (b) full linting via a shared lib (e.g. `jsonlint`), (c) no validation — trust user input + only error if save fails to round-trip. Pick before code work starts.

**Earlier history (kept for context).** Refactored to interactive playground 2026-05-10 to surface the gate after it had been lost across 3 sprints (filed 2026-05-07, never raised in any walk). Owner observation: *"we lost sight of this because it was never raised in a smoke walk—our primary interaction surface."* That observation triggered the new memory rule "research reports must file a tracked review task."
**Priority:** **Medium** — high pedagogical value for the PM persona who opens API responses / Slack JSON / webhook payloads daily. Today these fall through to the unknown-file preview.
**Filed:** 2026-05-07. **Refactored to interactive playground:** 2026-05-10.

**Research playground.** [`docs/research/data-primitives-canvas.html`](docs/research/data-primitives-canvas.html) — rich HTML page with mockups, library matrix, hand-roll-vs-library tradeoff, and an interactive § 5 (4 multiple-choice decision questions, each with visual mockup-per-option, comment fields, and a Copy-decisions button that produces a structured payload for paste-back to Claude). Covers four tiers (plain text → syntax highlight → collapsible tree → full IDE), six libraries evaluated (`@uiw/react-json-view`, `json-edit-react`, `react-json-view`, `react-json-tree`, `@codemirror/lang-json`, `monaco-editor`), and the new-tab-kind architectural recommendation.

**Recommendation (carried from research doc).** Tier 3 (collapsible interactive tree) via [`@uiw/react-json-view`](https://github.com/uiwjs/react-json-view) (~7 KB gz, MIT, active, zero deps, React 18 native). New tab kind `kind: 'json'` (NOT inside the canvas iframe — script-block contract would defeat the interactive tree). File classifier maps `.json` / `.jsonl` / `.har` to this tab type. Tier 1+2 fallback for files over a configurable threshold (~1 MB) where the tree's render cost is prohibitive.

**Live decision questions in § 5 of the playground (4 gates):**
1. Tier 3 (interactive tree) vs Tier 2 (syntax highlight only)?
2. Edit semantics — autosave on blur vs ⌘S only? (Tier 3 only)
3. YAML cohabitation — single kind with format discriminator vs distinct kinds?
4. Library pick — `@uiw/react-json-view` (recommended) vs alternatives vs hand-roll?

**Pairs with.** ENH-111 (data primitives umbrella).

**Process note (2026-05-10).** The original Open Questions section was a static `<ul>` — owner-decision items that never surfaced in a smoke walk. Refactored 2026-05-10 to an interactive Copy-round-trip playground after owner directive. Going forward, all research docs ship as playgrounds with the same pattern (saved as a memory rule: "Research reports must file a tracked review task").

---

### ENH-111: Data primitives umbrella — image v2, CSV table, YAML, Mermaid (PM persona cluster)

**Status:** ⬜ DRAFT — clustered roadmap doc landed; **image v2 promoted to Sprint 12 P0 anchor (owner directive 2026-05-08, pre-cut)** alongside BUG-108 (table-cell-copy).
**Priority:** **Medium** — most items in the cluster are S/M effort; the cluster is what earns the win for the PM persona.

**Research doc.** [`docs/research/data-primitives-canvas.html`](docs/research/data-primitives-canvas.html) §3 — primitive × use-case × effort matrix.

**Cluster sequencing (revised 2026-05-08 per owner pull):**
- **Image v2** (Sprint 12 P0 — promoted from Sprint 13 by owner): toolbar chrome around existing `<img>` base — zoom / pan / fit-to-window / 1:1 actual-size / dimensions readout / copy-to-clipboard. ~1d. PM persona benefit: dragging a screenshot from Slack into Duo currently shows a small image; with proper chrome, users can zoom into UI mockups without leaving Duo. Image tab type already exists (`renderer/components/fileClassifier.ts` § `'image'` case); this is renderer-side polish.
- **BUG-108 table-cell-copy** (Sprint 12 P0 — newly discovered 2026-05-08): clipboard gets literal `"[table]"` string instead of selected cell text. See BUG-108 entry below for symptom + reproduction. Pairs with image v2 because both are "fix what users actually do daily" Sprint 12 work.
- **JSON tier-3 viewer (ENH-110)** (Sprint 12 P1 — was P0 anchor in earlier sprint plan): `@uiw/react-json-view` as new `kind: 'json'` tab type. ~3d.
- **CSV / TSV** (Sprint 12 P2 — defer if Sprint 12 fills with image + BUG-108 + JSON): sortable table, column-type inference, summary stats. `papaparse` + TanStack Table. ~5d.
- **YAML** (Sprint 13 P1): reuse the JSON tab kind with a `format` discriminator. ~1d.
- **Mermaid** (Sprint 13 P0, paired with Obsidian content fidelity): TipTap node extension inside the markdown editor. ~2d.

**Cluster non-contents (skip / defer):**
- **SQLite explorer** — real users for this are devs not PMs; DB Browser for SQLite is great + native + free. Skip unless complaint surfaces.
- **xlsx (Excel)** — Numbers/Excel are 30-second OS-level open. Don't compete.
- **Log viewer** — pairs with ENH-082 (Terminal Context Bar) once that ships; defer to Sprint 14+.

---

### ENH-109: Show `.obsidian/` directory in the navigator when working in a vault

**Status:** ✅ **Shipped Sprint 11 (2026-05-07).** Added `.obsidian` to the always-visible list in [renderer/components/FileTree.tsx § shouldShow](renderer/components/FileTree.tsx) — same pattern as `.claude` (the existing dotdir exception). Decision: simpler than the originally-filed "context-aware" approach (only show inside a vault). Vault config files (workspace.json, plugin state) are universally useful when present; users without `.obsidian/` see no change. The "Show hidden files" global toggle already covers the broader case.
**Priority:** **Medium** — Obsidian-parity affordance; vault config / theme / plugin authors need access to `.obsidian/` to actually edit those files.

**What's wanted.** The navigator currently hides ALL dotfile/dotdir entries (including `.obsidian/`). When the user is working inside an Obsidian vault, the `.obsidian/` directory holds vault-specific config (`workspace.json`, `app.json`, theme/plugin folders) that some users edit by hand. Because it's hidden from the navigator, those files are unreachable except via terminal.

**Proposed behavior.** When the navigator's CWD is inside an Obsidian vault (i.e. `findVaultRoot` would return a non-null path from somewhere up the tree), un-hide `.obsidian/` specifically. Other dotdirs (`.git/`, `.vscode/`, etc.) stay hidden by default. A future generalization could honor the existing "Show hidden files" toggle if it gets a `~/.claude/duo/show-dotdirs.json` override; this v1 unhides only `.obsidian/`.

**Affected code (estimated).**
- `renderer/components/FileTree.tsx § filter` (or wherever the dotfile filter lives) — branch the filter so `.obsidian/` is allowed when the tree shows a vault subtree.
- `renderer/components/useNavigator.ts` (if listing happens there) — same.
- The vault detection should reuse the existing `findVaultRoot` helper from App.tsx (extract to a shared module or pass context down).

**Cross-ref:** Pairs with ENH-096 (wikilinks tier A) + ENH-114 (wikilink-create-on-cmd+click). Filed during Sprint 10 walk-1 OTHER NOTES.

---

### BUG-108: Copying cell text from a markdown-editor table copies "[table]" instead

**Status:** ✅ **Shipped Sprint 12 (2026-05-09).** Root cause confirmed: tiptap-markdown's `transformCopiedText` plugin runs `MarkdownSerializer.serialize(slice.content)`. ProseMirror's `Selection.content()` returns slices with `includeParents=true` — so an intra-cell text selection arrives wrapped in `<table><tr><td>…</td></tr></table>`. tiptap-markdown's table serializer rejects that wrapped slice in `isMarkdownSerializable` (the function requires the first row to be all `tableHeader`; a body-cell-only slice always fails), and the fallback path is `state.write("[" + node.type.name + "]")` — which writes the literal `[table]` because Duo runs tiptap-markdown with `html: false` for round-trip fidelity. Fix lives in [renderer/components/editor/extensions/TableCellCopy.ts](renderer/components/editor/extensions/TableCellCopy.ts) — a higher-priority extension whose `clipboardTextSerializer` detects "slice begins with a table node" and returns the slice's plain-text content via `Fragment.textBetween(0, size, '\n', '\t')` (newline between rows, tab between cells — matches every spreadsheet/word-processor convention). Whole-table selections that include the header row fall through (`return null`) so tiptap-markdown's existing markdown-table serializer continues to render the proper `| key | value |` form for full-table copies.
**Priority:** **High** — silently destructive: user expects "copy this cell value", clipboard ends up with the literal string `[table]`. Trips up the "select cell text → paste into terminal" workflow that's a primary use of vault tables.

**Symptom.** Open a markdown file containing a table in the TipTap editor. Click into a cell (e.g. the value column). Select text within the cell with the mouse. ⌘C. Paste anywhere — the clipboard contains the string `[table]` (literally that 7-character string), not the selected cell text.

**Reproduction (use to validate the fix).** Open any md file with a table in the TipTap editor. Add or use:
```
| key  | value |
|------|-------|
| foo  | hello |
```
Click into "hello", select with double-click or shift-arrow, ⌘C, paste somewhere. Expected (post-fix): "hello". Pre-fix: "[table]".

**Validation cases owed in the smoke walk.**
- Intra-cell partial text selection → exact selected substring.
- Whole-cell selection (triple-click) → cell text.
- Multi-cell same-row selection → cells joined by `\t`.
- Multi-row selection → rows joined by `\n`, cells by `\t`.
- Whole-table selection (⌘A or click outside, drag through table) → markdown table form (existing tiptap-markdown serializer).

**Cross-ref.** Discovered 2026-05-08 pre-cut. Pairs with the broader markdown editor polish backlog (BUG-073 dash bullets, etc.).

---

### BUG-107: "File changed on disk" dialog fires on first edit (walk-1 surfaced)

**Status:** ✅ **Shipped Sprint 11 walk-3 (2026-05-08).** Root cause: tiptap-markdown's serializer normalizes trailing whitespace on round-trip — `# Index\n\n` from disk parses then re-serializes as `# Index\n`. After file load, `lastSavedBodyRef` held the serializer's view; on first save attempt, the pre-save read brought back the original disk version. Strict string compare → diff → false external-conflict banner. Fix: normalize trailing whitespace before comparing in BOTH the pre-save check (`MarkdownEditor.tsx` save() line 681) AND the watcher reconciliation (line 580). Real conflicts (substantive content drift) still surface the banner — normalize() only ignores trailing whitespace, which is exactly what the serializer mutates. Walk-3 user reported "no [BUG-085] trace in console" which was the diagnostic clue — dialog was firing from the save's pre-save check, NOT the watcher path. Diagnostic log `[BUG-107 save-pre-conflict]` added at the catch line for any future regressions.
**Priority:** **Medium** — interrupts the autosave UX that ENH-103+ENH-104 just shipped. May be a pre-existing BUG-085 family flake (see BUG-104) or a Sprint 10 regression — needs reproduction with explicit instrumentation.

**Symptom.** Owner: "AS SOON as I edited the markdown file (added a space after the title) I received the following error: 'This file changed on disk while you were editing. Reload (loses your edits) or keep yours (next save will overwrite the new disk version).'"

**What we know.**
- Dialog fires from the watcher path, not the save path (no save can have run before first edit).
- Pre-fix [renderer/components/editor/MarkdownEditor.tsx § watcher effect](renderer/components/editor/MarkdownEditor.tsx) only fires `setExternalConflict` when chokidar reports a change AND the disk body diverges from BOTH `lastSavedBodyRef.current` AND `recentlyWrittenBodiesRef.current`.
- Sprint 10 changes that touched MarkdownEditor: added `useAutosavePreference()` hook + `saveError` state + autosave-gating ref. None directly touch the watcher or the recently-written set.
- Cross-ref BUG-104 (Sprint 9 walk-3) reported the same dialog firing after ⌘⇧;-then-typing on a vault file. Owner suspected "may be unrelated."

**Hypotheses.**
1. **BUG-085 family flake** — pre-existing race between chokidar's debounce + the recently-written set's eviction window (2s post-write). If the user's specific file had a frontmatter peculiarity the editor's markdown round-trip changes the byte-for-byte representation slightly, the disk body wouldn't match the cached body. Pre-Sprint-10 cause.
2. **Sprint 10 regression** — `useAutosavePreference` mounts a window-event listener; if some sequence of state updates causes the load effect to re-fire, lastSavedBodyRef could be reset to a stale value while disk holds the post-save body. Possible if the load effect's deps subtly include autosaveOn or saveError; needs verification.
3. **Owner's terminal echo** — if the owner had a terminal open with `tail -f` or similar on the file path, that could trigger chokidar mtime-only updates that cascade through the read path. Unlikely but worth ruling out.

**Diagnostic plan.**
- Add a `console.log('[BUG-107] watcher.fire', {path, reason})` at the top of the watcher's chokidar handler in MarkdownEditor.tsx. Log on every fire.
- Add a `console.log('[BUG-107] watcher.skip-echo', {...lengths})` when the silent-return branches hit.
- Add a `console.log('[BUG-107] watcher.surfaceConflict', {...})` when `setExternalConflict` fires (replacement for the existing `console.debug` so it's visible in the default Console view).
- Repro: open a fresh markdown file, type one character, observe the console traces. Compare timestamps + body lengths.

**Affected code (estimated).** [renderer/components/editor/MarkdownEditor.tsx § watcher effect](renderer/components/editor/MarkdownEditor.tsx) lines 555–634.

**Cross-ref:** Walk-1 walk-blocked ENH-103-SAVE-CONTROL. Pairs with BUG-104 (Sprint 9 walk-3 — same dialog after ⌘⇧;).

---

### ENH-114: Cmd+click on `[[Does Not Exist]]` wikilink should create the file (Obsidian parity)

**Status:** ✅ **Shipped Sprint 10 (2026-05-07).** When `resolveWikilinkInVault` returns null in [renderer/App.tsx § duo-wikilink-open handler](renderer/App.tsx), the handler now computes a vault-relative create path via [renderer/wikilinkCreate.ts § buildWikilinkCreatePath](renderer/wikilinkCreate.ts) and writes empty bytes via `files.write` (mkdir-p's the parent for path-bearing targets like `[[notes/Foo]]`). Existing extension recognition (`.md` / `.html` / `.htm` / `.txt`) prevents the double-up case `[[Foo.md]]` → `Foo.md.md`. Path-traversal defense — strips leading slashes and drops `..` / `.` segments so `[[../secret]]` and `[[/etc/passwd]]` cannot escape the vault root. 17 unit tests at [renderer/wikilinkCreate.test.ts](renderer/wikilinkCreate.test.ts) lock down the contract.
**Priority:** **Medium** — Obsidian parity affordance; matches how vault users actually work.
**Filed:** 2026-05-07.

**What's wanted.** When the user cmd+clicks a `[[Page Name]]` wikilink whose target doesn't resolve to any existing file in the vault, Duo should:
1. Create a new `.md` file at `<vault-root>/<Page Name>.md` with default body (just the H1 title).
2. Open the new file in the working pane.
3. Surface a brief banner / toast: "Created `<Page Name>.md` in vault."

This is how Obsidian works by default — many users use cmd+click as the primary "create new note" gesture. Owner asked the question during ENH-096 walk-2 and explicitly requested filing as an ENH.

**Affected code (estimated).**
- `renderer/App.tsx § resolveWikilinkInVault` — currently returns null when no match. Either change to return a sentinel value indicating "create new at root/<target>.md", OR add a new branch in the caller.
- `renderer/App.tsx § duo-wikilink-open handler` — when resolver returns the create-sentinel, fire `files.write(path, defaultBody)` then `openFileSmart`.
- Default body shape: just `# <target>\n` per Obsidian. (If the target is path-bearing, ensure parent directories exist via `files.mkdir`.)

**Open questions.**
- Path-bearing wikilinks (`[[subdir/New Note]]`) — recursive mkdir on the parent before write?
- File-extension policy — always `.md`? What if the user wants `.html`? (Probably out of scope for v1; Obsidian only handles `.md` here.)
- Confirmation dialog — silent create (Obsidian default) or "Create `<Page Name>.md`?" prompt? Recommend silent + a toast/banner, matching Obsidian.

**Cross-ref:** Filed alongside ENH-096 (the wikilink rendering + cmd+click resolver). The two pair naturally — this is the "no match" branch.

---

### ENH-115: Right-click terminal tab → "Reveal in navigator" (focus nav on tab's CWD)

**Status:** 🆕 Filed 2026-05-09 (Sprint 12 P1 — landing alongside image v2 + BUG-108).
**Priority:** **Medium** — small QoL bridge between the terminal column and the navigator. The terminal tab already knows its `cwd`; the navigator already knows how to navigate-to a path; today there's no gesture to connect them.
**Filed:** 2026-05-09.

**What's wanted.** Right-click any tab in the terminal tab strip → context menu with at least one entry: **"Reveal in navigator"** (working name). Clicking it calls `nav.actions.navigateTo(tab.cwd)` — same code path that `duo reveal` already uses — and surfaces the existing reveal chip so the user sees what just changed.

The pattern matches macOS's "Reveal in Finder" affordance and Duo's existing `nav.onReveal` plumbing — this is the in-app sibling to the CLI's `duo reveal` verb.

**Naming TBD.** Owner explicitly flagged the label as uncertain. Candidates:
- **"Reveal in navigator"** — matches the existing "Reveal in Finder" verb pattern; concise. **Recommended.**
- "Reveal project in navigator" — owner's first instinct; accurate when CWD is a project root, but verbose and "project" is overloaded.
- "Show CWD in navigator" — explicit but jargon-y.
- "Focus navigator here" — readable but doesn't reuse the established "Reveal" verb.

Recommend "Reveal in navigator" for the v1 label; revisit during the smoke walk if it reads wrong in context.

**Affected code (estimated, ~30min).**
- `renderer/components/TabBar.tsx § Tab` — add `onContextMenu` to the tab button. Calls `window.electron.menu.popup({ items: [...], x, y })` with a single entry today, leaving room for additional verbs later (e.g. "Duplicate tab in this CWD", "Close all other tabs").
- `renderer/components/TabBar.tsx § TabBarProps` — add `onRevealCwd?: (cwd: string) => void` callback so the wiring stays in App.tsx.
- `renderer/App.tsx` — wire the prop to `nav.actions.navigateTo(cwd)` + `setRevealChip(cwd)` (mirrors the existing `nav.onReveal` handler at line ~1257).

**No new IPC surface needed** — `window.electron.menu.popup` (BUG-105 / ENH-050) and `nav.actions.navigateTo` already exist.

**Open questions for the smoke walk.**
- Should the menu also offer "Open new terminal here" / "Duplicate tab"? **Defer** — v1 ships the single verb; expand only if the right-click gesture feels under-utilized.
- Should the reveal chip differentiate "from CLI" vs "from terminal context-menu"? **No** — same source-of-truth, same chip.

**Cross-ref:** Pairs with the existing `duo reveal <path>` CLI verb (Stage 10) and the `nav.onReveal` listener at [renderer/App.tsx:1257](renderer/App.tsx).

---

### ENH-121: Forward main-renderer `console.*` to dev stdout (Sprint 12 walk-rev3 retro fix)

**Status:** ✅ **Shipped 2026-05-09** as part of Sprint 12 walk-rev3 retro. [electron/main.ts](electron/main.ts) installs `mainWindow.webContents.on('console-message', ...)` in dev (`!app.isPackaged`) — every renderer `console.log/warn/error` call prints to dev stdout prefixed with `[renderer:log/warn/error]` and the source location. Filters `[vite]` HMR + `Electron Security Warning` noise.
**Priority:** **High** (was) — single highest-leverage missing tool exposed by today's image-render diagnosis. Before this, `console.log` in any renderer component (MarkdownEditor, ImageView, App.tsx, etc.) was invisible to a CLI-only debugging workflow; agent had to invent in-DOM debug overlays + colored boxes to surface state. Today's 90 minutes of futile work would've been ~5 minutes with this in place.
**Filed:** 2026-05-09 (same-day fix, no separate filing).

**Verified live:** opening an image triggered `[renderer:warn] (App.tsx:466) [BUG-101 openFile] [object Object]` to reach dev stdout. Existing console-log statements in renderer code now flow up automatically.

**What it doesn't cover (separate ENHs):**
- DOM-state queries from CLI: see ENH-122.
- DevTools open from CLI: see ENH-123.
- Layout-state snapshot (split view? active tab? pane dims?): see ENH-124.

---

### ENH-122: `duo dom <selector>` — query the renderer's DOM from CLI (Sprint 12 walk-rev3 retro)

**Status:** ✅ **Shipped v0.6.12 (Sprint 14, 2026-05-09).** End-to-end verified via the verb itself: `duo dom <selector>` returns outerHTML / `--attr` / `--text` / `--computed <props>` / `--all`; `duo dom --js "<expr>"` evaluates an arbitrary expression in the main renderer's scope (used during this sprint to verify FOLLOWUP-015's panel-fill mounts). Bare `duo dom` keeps the legacy browser-pane HTML dump (CDP) — disambiguation key is "any args at all → renderer." Implementation routes through a new `queryRendererDom` NavBridge method that calls `mainWindow.webContents.executeJavaScript` with a server-built JSON-stringified expression (selectors / attrs are safe against injection; `--js` mode passes through verbatim so multi-statement blobs work). No `app.isPackaged` gate — the CLI is already trusted via socket auth, and restricting renderer-DOM inspection in production would gimp the agent's ability to help with bug reports.

**Walk-2 + walk-3 step-text fixes (2026-05-10):** Walk-1 used `.tab-strip` which doesn't match (no class with that name). Walk-2 used `[role="tab"]` which ALSO doesn't match (no ARIA role on tabs — surfaces gap filed as ENH-132). Walk-3 uses `button.group` which is reliably attached to every tab in the working / terminal strips. Walk-2 also caught BUG-114 (CLI EPIPE on `duo X | head/grep/awk` pipes); fixed via `process.stdout.on('error', EPIPE → exit 0)` in cli/duo.ts.
**Priority:** **High** — second-highest-leverage missing tool. Today's blind diagnosis ate ~30 min trying to figure out whether ImageView's `<img>` element was rendered, what its `src` attribute was, and what its computed CSS dimensions were. `duo eval` only sees BROWSER-pane tabs (CDP-attached), not the renderer; the renderer's DOM is locked behind manual DevTools.
**Filed:** 2026-05-09. **Shipped:** 2026-05-09.

**What's wanted.** A CLI verb that takes a CSS selector (or arbitrary JS expression scoped to the renderer's window) and returns the result. Mirrors `duo eval` but targets the renderer instead of the browser pane.

**Examples:**
```
duo dom 'img'                                    # outerHTML of first img
duo dom 'section.item[data-id=BUG-108]' --html   # outerHTML
duo dom '.ProseMirror img' --attr src            # specific attribute
duo dom '.ProseMirror img' --computed width,height,display  # computed styles
duo dom --js 'document.querySelector("img").naturalWidth'   # arbitrary expr
```

**Implementation sketch:**
1. New `EDITOR_RENDERER_EVAL` IPC channel (renderer-side handler does the eval, returns serialized result).
2. CLI parses args → wraps in JS → calls `socket-server` → main forwards to renderer's webContents → renderer's preload exposes a sandboxed eval helper → returns string/JSON.
3. Safety: only enabled in dev (`!app.isPackaged`) per the same gate as ENH-121.

**Cross-ref:** [ENH-121](tasks.md:somewhere) (renderer console forwarder), [ENH-123](tasks.md:somewhere) (devtools verb).

---

### ENH-123: `duo devtools` — open the renderer's DevTools from CLI (Sprint 12 walk-rev3 retro)

**Status:** 🆕 Filed 2026-05-09 from same-day retro.
**Priority:** Medium — backstop for the 5% of cases where ENH-122's targeted query isn't enough and you need the full DevTools UI (Network tab, full Elements tree, breakpoints).
**Filed:** 2026-05-09.

**What's wanted.** `duo devtools` opens DevTools on the main renderer (default). `duo devtools --browser-pane` opens DevTools on the active browser pane's WebContentsView. `duo devtools --close` closes any open DevTools. One-line implementation: `mainWindow.webContents.openDevTools({ mode: 'right' })`.

---

### ENH-124: `duo layout` — structured snapshot of working pane state (Sprint 12 walk-rev3 retro)

**Status:** 🆕 Filed 2026-05-09 from same-day retro.
**Priority:** Medium — third missing tool exposed by today's diagnosis. ~20 min wasted on misreading the layout from screenshot pixels: I assumed the working pane was a single full-width slot when it was actually a split view with the image-viewer squished to ~80px wide. A structured layout snapshot would have made this immediately obvious.
**Filed:** 2026-05-09.

**What's wanted.** `duo layout` returns JSON describing the WorkingPane's current state:

```json
{
  "split": true,
  "main": { "tab": { "kind": "image", "path": "/tmp/foo.png", "id": "tab-3" }, "width": 80, "height": 540 },
  "aux":  { "tab": { "kind": "editor", "path": "/tmp/note.md", "id": "tab-2" }, "width": 760, "height": 540 },
  "focused": "main",
  "terminal": { "expanded": true, "width": 480 },
  "navigator": { "expanded": true, "width": 220 }
}
```

Reuses existing state via `nav-state` + new IPC for working-pane state. Removes ambiguity about WHAT THE USER IS LOOKING AT — every "is the image viewer the small slot or the big one?" question becomes a 100ms call.

**Cross-ref:** Existing `duo nav-state` covers the FILE TREE. This is the missing parallel for the WORKING PANE.

---

### ENH-119: Selection tint should cover images — visual feedback when an image is in the selected range

**Status:** ✅ **Shipped Sprint 14 walk-3 prep (2026-05-10).** Both surfaces (markdown editor + HTML canvas) per editor-canvas parity rule. **Markdown editor:** new ProseMirror plugin in [DuoImage.ts](renderer/components/editor/extensions/DuoImage.ts) that walks every node in `selection.from..selection.to` and decorates image nodes with a `duo-image-in-range` class via `Decoration.node`. NodeSelection (click-to-select-image) already gets `ProseMirror-selectednode` from TipTap stock; both classes share the same CSS rule (orange outline + 2px offset + slight border-radius). **Canvas:** new helper [imageSelectionTint.ts](renderer/components/Page/imageSelectionTint.ts) that listens to `selectionchange` on the iframe document, walks all `<img>` elements, and toggles a `data-duo-image-in-range` attribute based on `range.intersectsNode(img)`. CSS injected into the iframe head (style block with `data-duo-style="duo-image-selection-tint"`). The runtime attribute is added to `RUNTIME_ATTRS_TO_ALWAYS_STRIP` in [serialize.ts](renderer/components/Page/serialize.ts) so it never persists to saved HTML. **Markdown side verified live:** selected all → confirmed exactly 1 image with `duo-image-in-range` in the active editor (out of 27 ProseMirror images across 20+ open editors). Canvas side wired live (style injected + image found in iframe); owner walks the visual drag-select test.
**Priority:** Medium — owner ask: "include in next sprint."
**Filed:** 2026-05-09. **Shipped:** 2026-05-10.

**What's wanted.** Inside the markdown editor (and the HTML canvas, per editor-canvas parity rule), when a Selection range covers an `<img>` node, the image should render with a visible selection tint (e.g. a colored overlay or border) so it's obvious the image is in the range. This affects copy / cut / delete operations downstream — without the visual cue, users might cut text expecting the image to come with it (or stay).

**Implementation sketch:**
- TipTap's Image extension renders `<img>` directly. Add a CSS rule scoped to the editor: when an `<img>` is inside a `::selection`-containing range, apply a `box-shadow: inset 0 0 0 9999px var(--accent-soft)` or similar tint.
- ProseMirror's selection model uses NodeSelection / TextSelection. For NodeSelection on an image (click-to-select-the-image), TipTap's stock behavior IS to add a `ProseMirror-selectednode` class. Verify that styling is wired in Duo's CSS.
- For TextSelection that SPANS the image (text on both sides), the image isn't selected per-se but is "in the range." Need a custom decoration to paint a tint on the image node when its position is within `selection.from..selection.to`.

**Cross-ref:** [ENH-108](tasks.md:276) (the underlying paste-image feature). [ENH-120](tasks.md:somewhere) (the copy-with-image limitation, sibling).

---

### ENH-120: Copying a markdown range that includes an image should put the image on the clipboard too

**Status:** 🆕 Filed 2026-05-09 from owner OTHER NOTES on Sprint 12 walk-rev4. Owner: "less urgent but still important to note on the image handling section(s) of the roadmap as a known limitation."
**Priority:** Low-Medium — known limitation, document for now, schedule for image-handling-cluster sprint.
**Filed:** 2026-05-09.

**What's wanted.** When the user selects a range in the markdown editor that includes an image, then ⌘C and pastes into another app (Notes, Mail, Slack, etc.), the image should appear in the destination — not just the surrounding text without it. Today: only the text portion arrives at the destination.

**Why this happens (current state).** The markdown editor uses tiptap-markdown's `transformCopiedText` to serialize the selected slice as markdown text. Markdown text is `![](blob:...)` for v1 paste-image inserts (per FOLLOWUP-014 — abs path is the v2 plan). Even with a real path, the destination app receives PLAIN TEXT — not the image bytes. To put the image bytes on the clipboard alongside, the copy handler needs to ALSO write image data to the clipboard via `navigator.clipboard.write([new ClipboardItem({ 'image/png': blob, 'text/plain': text })])`.

**Scope considerations:**
- Single-image selection (just the image, no surrounding text): straightforward — write image + text to clipboard.
- Multi-image selection: most other apps only accept ONE image per clipboard write. Pick the first? Refuse? Concat into a montage? Document the limitation.
- Mixed text + image: the text portion travels as-is; the image portion converts to image bytes.

**Cross-ref:** [ENH-108](tasks.md:276), [FOLLOWUP-014](tasks.md:somewhere) (relative-path portability), [ENH-118](tasks.md:somewhere) (image-type handling discussion). All belong in the image-handling cluster on the roadmap.

---

### ENH-125: Canvas-side `duo image insert <path>` — CLI parity with the markdown-editor verb

**Status:** ✅ Shipped v0.6.11 (Sprint 13, 2026-05-09 — walk-2 functional PASS; visual verification owed only because the test image was 1×1 pixel and invisible). PageTab subscribes to `EDITOR_IMAGE_INSERT`; on receive (gated on `isActive`), calls `files.saveImageBeside` against the canvas's docPath, then `doc.execCommand('insertHTML', ...)` with `<img src="${blobUrl}" data-duo-original-src="${relPath}">`. Save-time serializer (FOLLOWUP-014) restores the relative path. CLI verb takes the same args; canvas tab now responds when active. Walk-1 reported FAIL because (a) the IPC race wasn't gated — older session-restored canvases won the response and the image landed in the wrong dir, AND (b) the autosave was silently no-op'ing because the dirty-detection baseline was getting corrupted (FOLLOWUP-014 walk-2 entry has the full diagnosis). Both fixed walk-2: race-fix via the `isActive` gate (threaded from WorkingPane § renderFileTab), autosave-fix via PageTab's `baselinedRef`. Walk-2 owner reported steps 1-6 + 8 PASS; step 7 (visual confirm of inline render) was a false-fail — Claude's test fixture (`/tmp/v2-image-test/red.png`) is a 1×1 PNG so the inserted image is one transparent-against-cream pixel, not visually verifiable. Functional contract (file written with relative `src`, alt round-trips, file lands in active canvas's parent dir) confirmed PASS. Use a real-size PNG for any future visual smoke. Editor-canvas parity disposition closed for the image-insert capability.
**Priority:** Medium — markdown editor + canvas surface should expose the same agent-driven capability per CLAUDE.md § 4 (CLI parity with UI). v1 ENH-108 ships markdown only; canvas surface only supports paste / drag-drop today.
**Filed:** 2026-05-09.

**What's wanted.** Extend `duo image insert <path>` to dispatch to the canvas (PageTab) when it's the active working tab, not just the markdown editor. v1 explicit asymmetry per the editor-canvas parity disposition rule (see Sprint 12 commit message); v2 closes it.

**Implementation sketch:**
1. Add `EDITOR_IMAGE_INSERT` listener to `PageTab.tsx` — mirror the MarkdownEditor's handler at [renderer/components/editor/MarkdownEditor.tsx](renderer/components/editor/MarkdownEditor.tsx) (calls `files.saveImageBeside`, builds blob URL, inserts via `doc.execCommand('insertHTML', false, '<img src="…">')`).
2. App.tsx-level dispatch: when an `image-insert` request arrives, route to whichever editor is active (markdown OR page), error if neither.
3. Reply contract stays the same (`ImageInsertResult { absPath }`).

**Why deferred from v0.6.10:** Sprint 12's velocity. Markdown-side covered the immediate need; canvas-side is symmetric polish. Owner concurred ("ship it").

**Cross-ref:** [ENH-108](tasks.md:276), CLAUDE.md § 4 (editor-canvas parity rule).

---

### ENH-126: Opening a split pane should auto-redistribute the other panes for even width

**Status:** ✅ Shipped v0.6.11 (Sprint 13, 2026-05-09). Pulled into the current sprint after owner pushback on Sprint-14 deferral. [App.tsx § splitViewMoveTabByPath](renderer/App.tsx) and [splitViewMoveBrowserTab](renderer/App.tsx) now redistribute on every aux-open trigger:
- `setAuxState({ ..., splitPct: 0.5 })` — inner main/aux always snaps to 50/50 (was preserving prior aux split, which surprised users).
- `if (splitPct !== 0 && splitPct !== 100) setSplitPct(33)` — outer terminal/working snaps to 33/67 when terminal is visible. When terminal is collapsed (splitPct === 0), leave it collapsed and rely on the inner 50/50 — net visual is main + aux 50/50 inside the working column.

Both code paths (file-aux open via right-click "Move to Split View" / `⌘/` chord / `duo split-view open`, and browser-aux open via right-click "Move to Split View" on a browser tab / `duo split-view open-browser`) trigger the redistribute. Re-opening the same path is still a no-op (early-return preserved). Owner spec verbatim: *"if all three (minus terminal) are open, then it should be 33/33/33; if terminal is collapsed, then the main pane and the split view should be 50/50."*

**Priority:** **High — owner-directed P0 for v0.6.11** (verbal directive carried across multiple sessions; ledger gap closed 2026-05-09 + escalation prompted same-day implementation).
**Filed:** 2026-05-09. Spec clarified by owner same-day. Shipped same-day after escalation.

**What's wanted.** When the user opens a file in split view (via any existing entry point: `⌘/` chord, `duo split-view open <path>`, right-click "Open in Split View" on tab/file/page-link, "Move to Split View" on existing tab), Duo redistributes the visible columns to even widths automatically. **Owner spec (verbatim 2026-05-09):**

> "when I open a file in split view, the panes should redistribute; if all three (minus terminal) are open, then it should be 33/33/33; if terminal is collapsed, then the main pane and the split view should be 50/50"

**Behavior matrix.**
| State at split-open | Resulting widths |
|---|---|
| Terminal visible + main + (new) split  | terminal 33% / main 33% / split 33% |
| Terminal collapsed + main + (new) split | main 50% / split 50% (terminal stays collapsed) |

(Wording note: owner's "all three (minus terminal)" parses as "all three columns including terminal, even though terminal isn't strictly inside the working pane" — i.e. the 3-up case. Confirmed by the second clause naming terminal-collapsed → 50/50 which only makes sense if "all three" was the terminal-visible case.)

**Implementation sketch.**
- Hook into the split-open code path in `core/socket-server.ts § 'split-view'` + the renderer's split-open dispatcher (App.tsx). Single helper that runs after the new aux file lands.
- Helper reads `terminalCollapsed` state. If false: set outer terminal/working ratio to 33/67 + inner main/aux ratio to 50/50 (yields ~33/33/33 of total width). If true: set inner main/aux to 50/50 only (terminal column stays its collapsed-rail width).
- Persist the new ratios via the existing pane-size persistence path so a refresh keeps the redistributed layout.
- Idempotent: re-opening a split when already in the canonical layout is a no-op.

**Open scope questions for the implementer (smaller now that owner pinned the spec).**
1. **Does it also fire on "move existing tab to split"?** Owner spec said "open a file in split view" — most natural reading is yes (tab-move-to-split = opening the tab in the split). Treat the same.
2. **Does it overwrite a user-manually-dragged ratio?** Recommend yes (simpler; the user just opened a NEW pane — they expect the layout to readjust). If owner wants "respect prior drag," that's a v2.
3. **Terminal-collapse state tracking.** Need to read this from existing collapse state — verify there's a renderer-side accessor; if not, plumb one.

**Cross-refs.**
- **ENH-099** — `⌘⌥4` 33/33/33 chord. Same end-state target (terminal/main/aux 33/33/33), different trigger (chord vs. auto). Implementation shares a "snap to canonical layout" helper. **Land them together** — ENH-126 supplies the auto-trigger; ENH-099 supplies the on-demand chord; both call the same helper.
- **Layout architecture note:** ENH-099's filed concern was "aux is INSIDE the working pane, not a third sibling, so 33/33/33 may need a layout refactor." Owner's spec sidesteps the refactor question — the 33/33/33 reads as outer (terminal:working = 33:67) + inner (main:aux = 50:50). No layout change needed; just a coordinated double-set of two existing percentages.

**Sprint 14 P0** per owner verbal directive. Pair with ENH-099.

---

### BUG-115: External-conflict dialog fires on first edit after open (re-surface of BUG-107 family OR fixture-write race)

**Status:** ✅ **Closed 2026-05-10 (expected behavior; agent-behavior fix only).** Hypothesis 1 (fixture-write race) confirmed. Diagnostic evidence:
1. `MarkdownEditor.tsx:864` (watcher) and `:986` (save pre-conflict) both still apply BUG-107's `normalize = (s) => s.replace(/\s+$/, '')` — **the BUG-107 fix is intact**.
2. Console showed `[BUG-107 save-pre-conflict] real diff` AFTER normalization — meaning the 3-byte delta is non-trailing-whitespace **content**, not the kind of drift normalize() ignores.
3. `/tmp/v2-viewsrc-smoke.md` mtime (May 10 11:38) is LATER than walk-3 — confirming the fixture was rewritten while the editor held its baseline.
4. The same path appears in walk-rev2 / walk-rev3 / base v0.6.12 manifests, all of which prepare it during walk setup.

**Conclusion.** The dialog fired correctly. The walk-prep pipeline rewrote the fixture while the editor still had the rev2 version open from the previous walk. First edit triggered a real conflict — exactly what BUG-107's design intends.

**Resolution.** Two layered fixes (no code change to MarkdownEditor):
1. **Walk-rev fixture path uniqueness** — every smoke-walk rev gets a unique fixture path (e.g. `/tmp/walk-{version}-{rev}-{slug}.md` instead of reusing `/tmp/v2-viewsrc-smoke.md` across rev1/rev2/rev3). The smoke-walk skill's manifest authoring convention now mandates this pattern. Removes the race by construction.
2. **CLAUDE.md § 7c addendum** — agent must not rewrite a fixture file the editor has already opened in the running dev session. Either close the corresponding tab first (`duo tabs` → `duo close <n>`) or use a fresh path. Lifted to a memory rule for cross-session durability.

**Cross-ref:** [BUG-107](tasks.md:5910) (the original Sprint 11 walk-3 normalize fix; intact).
**Filed:** 2026-05-10. **Closed:** 2026-05-10.

**Owner observation:** *"caught the 'This file changed on disk while you were editing. Reload (loses your edits) or keep yours (next save will overwrite the new disk version).' error on loading the [file] and typing 'return' in it"* — fired during walk-3 testing of ENH-128 on `/tmp/v2-viewsrc-smoke.md`.

**Console diagnostic (verbatim from owner walk-3):**
```
MarkdownEditor.tsx:988 [BUG-107 save-pre-conflict] real diff
  baselineHead: "# View-source v2 panel-fill smoke\n\nThis is a markdown body t"
  baselineLength: 323
  diskBodyLength: 326
  diskHead:     "# View-source v2 panel-fill smoke\n\nThis is a markdown body t"
  path: "/tmp/v2-viewsrc-smoke.md"
```

Disk has 3 bytes MORE than the editor's baseline. Same first-60-char head — the divergence is somewhere later in the file (likely trailing whitespace OR the last paragraph).

**Two competing hypotheses:**

1. **Fixture-write race (NOT a code regression).** During walk-3 prep, Claude's Bash calls rewrote `/tmp/v2-viewsrc-smoke.md` while the editor had it open from earlier in the session. Editor baseline captured OLD content; disk now has NEW content. First edit triggers conflict — which is CORRECT behavior. If this is the cause, no code fix needed; the right action is for Claude to STOP rewriting fixture files that are already open in the running editor.
2. **BUG-107 family regression.** Sprint 11 walk-3 fixed BUG-107 by normalizing trailing whitespace in the conflict comparison. If today's edits to MarkdownEditor.tsx (DuoImage plugin / image-in-range / handleAssetPaste / etc.) accidentally broke that normalization, the false-positive returns. Possible culprit: any change that shifted the save() pre-conflict check's baseline-vs-disk comparison.

**Diagnostic plan (post-compact):**
1. Check git log + bash history for fixture-write commands that touched `/tmp/v2-viewsrc-smoke.md` after the editor first opened it. If found → hypothesis 1; close as "expected behavior; agent should avoid this pattern."
2. If no fixture-write race: read MarkdownEditor.tsx's save-pre-conflict code (around line 988 per the console) + verify the trailing-whitespace normalization from BUG-107 still applies. If broken → fix + add a vitest fixture.
3. Reproduce with a fresh file the agent did NOT pre-write — open + immediately type a character + see if the dialog fires.

**Why filed as BUG-115 not as a BUG-107 follow-on entry:** the symptoms are identical to BUG-107 but the trigger / cause may be different. Filing as a sibling lets us close BUG-107 if hypothesis 1 wins, and re-open it if hypothesis 2 does.

**Cross-ref:** [BUG-107](tasks.md:5910) (the original Sprint 11 walk-3 fix).

---

### ENH-128: HEIC / RAW image paste / drop — convert to PNG/JPEG via Electron nativeImage

**Status:** 🟢 **Walk-4 fix landed 2026-05-10** — added macOS `sips` fallback in `convertImageBytes` for the HEIC/HEIF/RAW family when `nativeImage.createFromBuffer` returns empty. Verified `sips` present at `/usr/bin/sips` on owner's Mac. Awaiting walk-4 owner verification with the same iPhone HEIC source that failed walk-3.

**Walk-4 fix details (electron/files-service.ts § convertImageBytes + transcodeViaSips):**
- Layered fallback: nativeImage decode (fast path) → if empty AND macOS AND HEIC/HEIF/RAW MIME → write bytes to `os.tmpdir()/duo-convert-in-<stamp>.<ext>`, run `sips -s format jpeg <in> --out <out>`, read converted bytes back, clean up both temps. JPEG @ default quality (sips' own; matches Apple Photos export behavior).
- Skipped Step 1 from the original diagnostic plan (`createFromPath` swap) — same NSImage decoder under the hood as `createFromBuffer`; bytes-vs-path distinction unlikely to matter for HEIC. Went straight to Step 2 (sips) which uses ImageIO directly.
- Step 3 (scope-downgrade — accept HEIC verbatim) **not needed** if sips works as expected. Kept in pocket if walk-4 surfaces a sips failure mode (e.g. iPhone HEIC variant ImageIO also rejects).

**Walk-1/2/3 history (kept for context).** Walk-1 attempt added MIME map + nativeImage transcode helper but missed two issues: (a) `file.type` is empty for HEIC in Electron's File API, so MIME-based filter rejected the file before transcode could fire — fixed walk-2 with `inferMimeFromName` extension fallback; (b) walk-2 still failed because `handleDrop` used `dt.files` which is empty for native macOS drags from Finder/Photos.app — drags populate `dt.items` instead. Walk-3 switched `handleDrop` to `dt.items` (matches `handlePaste`'s pattern). HEIC drops NOW reach the convert path; walk-4 sips fallback closes the convert step.

**Walk-1/2/3 history (kept for context).** Walk-1 attempt added MIME map + nativeImage transcode helper but missed two issues: (a) `file.type` is empty for HEIC in Electron's File API, so MIME-based filter rejected the file before transcode could fire — fixed walk-2 with `inferMimeFromName` extension fallback; (b) walk-2 still failed because `handleDrop` used `dt.files` which is empty for native macOS drags from Finder/Photos.app — drags populate `dt.items` instead. Walk-3 switched `handleDrop` to `dt.items` (matches `handlePaste`'s pattern). HEIC drops NOW reach the convert path; the convert path itself is broken.
**Priority:** Medium — closes a real workflow (macOS Photos.app drag-drop = HEIC by default).
**Filed:** 2026-05-10.

**What's wanted.** When the user pastes / drops a HEIC (or RAW camera image), Duo converts it to PNG (or JPEG) before saving alongside the active doc. Today's MIME map doesn't include HEIC/RAW so they fall through to `.png` with the wrong extension — should be a clean transcode instead.

**Implementation sketch.**
- Detect `image/heic`, `image/heif`, `image/x-canon-cr2`, `image/x-nikon-nef` etc. on clipboard / drag.
- Pipe bytes through Electron's `nativeImage.createFromBuffer(bytes)` then `.toJPEG(quality)` or `.toPNG()`.
- Save the converted bytes via `files.saveImageBeside` with the right extension.
- Insert with the converted path. Markdown source stays portable.
- Default: convert to JPEG @ quality 90 for HEIC (matches Apple's typical export). PNG for lossless.

**Open scope question.** Resize cap? HEIC from a modern iPhone is ~4032×3024 — a 5MB JPEG. Acceptable to insert at full resolution? Or cap at e.g. 2048px max dimension? Recommend full resolution v1; revisit if perf complaint surfaces.

**Cross-ref:** [ENH-108](tasks.md:280) (paste-image v1), [ENH-118](tasks.md:6245) (the conversation that filed this).

---

### ENH-132: ARIA tab roles — tabs need `role="tab"` + `role="tablist"` for accessibility

**Status:** ✅ **Shipped Sprint 14 walk-3 prep (2026-05-10).** Owner pulled in alongside ENH-119 after ENH-122 walk-2 surfaced the gap. Added `role="tablist"` + `aria-label` to the parent `<div>` of each tab strip in [WorkingTabStrip.tsx](renderer/components/WorkingTabStrip.tsx) (working + browser tabs share this strip) and [TabBar.tsx](renderer/components/TabBar.tsx) (terminal tabs). Added `role="tab"` + `aria-selected={isActive}` to each per-tab `<button>`. **Agent-verified live:** `duo dom '[role=tab]'` returns 84 elements (every tab across all open editors / terminal panes), `[role=tablist]` returns 2 containers, `[aria-selected=true]` returns 2 (one active per strip). Screen readers (VoiceOver) will now announce "Smoke walk, tab 6 of 12, selected" instead of "Smoke walk, button". **Sister win:** ENH-122-SELECTOR step 5's original `[role="tab"]` selector now matches non-empty too (the walk-2 fail that surfaced this gap).
**Priority:** Low — accessibility hygiene; not user-blocking.
**Filed:** 2026-05-10. **Shipped:** 2026-05-10.

**What's wanted.** Add `role="tab"` to every tab `<button>` element in `WorkingTabStrip.tsx`, `TabBar.tsx` (terminal strip), and any browser-pane tab strip rendering. Add `role="tablist"` to the parent `<div>` wrapping each strip. Add `aria-selected="true|false"` per tab based on the existing `tab.isActive` flag. Optional follow-on: `aria-controls` / `aria-labelledby` if there's an obvious panel target per tab.

**Why this surfaced.** Walk-2 test step `duo dom '[role="tab"]' --all | head -1` returned `[]`. Tabs are plain `<button>` today — no ARIA. The smoke walk caught a real accessibility gap as a side effect of debugging visibility tooling.

**Scope.** Three strip components × ~5 lines each (role on the row, role on the wrapper, aria-selected on the active row). ~30-60 min total. Tests: probably none needed; a vitest / RTL test could lock the role assignment per active state if there's appetite.

**Cross-ref.** ENH-122 (the smoke-walk verb that caught this). NOT a Sprint 14 pull — file as a future-sprint item; pulling in this sprint is scope creep.

---

### ENH-133: Shift+Return remap to Option+Return in active Claude tabs

**Status:** 🟢 **Code shipped 2026-05-10** — relaxed the existing ENH-127 v2 entry condition in `TerminalPane.tsx § attachCustomKeyEventHandler` to admit Shift+Enter alongside plain Enter. The existing `e.metaKey ? '\r' : '\x1b\r'` byte logic routes Shift+Enter to ESC+CR (newline) since metaKey is false. ⌘⇧Enter falls into the submit branch (matches "Cmd held = submit"). Awaiting walk-4 owner verification.
**Priority:** Medium — paper-cut polish; muscle-memory miss every time the user types shift+enter expecting a soft newline.
**Filed:** 2026-05-10.

**Owner directive (verbatim 2026-05-10):** *"please also add shift+return remapped to option+return in active claude session"*

**Why.** Most apps (Slack, Discord, GitHub comments, gmail, claude.ai web) treat `shift+enter` as "newline within composition." Claude Code's terminal input loop only recognizes plain Enter (pre-ENH-127 default = submit) / `option+enter` (newline) / `⌘+enter` (post-ENH-127 v2 submit). Today, `shift+enter` does nothing useful in a Claude tab — it's a muscle-memory miss for users coming from any modern messaging surface.

**Scope.** Sibling branch in [TerminalPane.tsx](renderer/components/TerminalPane.tsx)'s existing `attachCustomKeyEventHandler` (the ENH-127 v2 surface). Detect `e.key === 'Enter' && e.shiftKey && !e.metaKey && !e.altKey && tab.kind === 'claude'` and forward the same byte sequence Option+Enter sends to the PTY. Active in `claude` tabs only — shell tabs unchanged so existing shell users (e.g. `bash` heredoc with shift+enter expectations) aren't surprised.

**Implementation note.** First step is determining what bytes Option+Enter actually emits in our xterm config — log a control test from `attachCustomKeyEventHandler`'s alt+Enter branch, then mirror those bytes in the new shift+Enter branch. Avoid hard-coding `\x1b\r` without verification.

**Smoke walk item.** `ENH-133-SHIFT-RETURN` — open a claude tab; type "line one"; shift+enter; type "line two"; verify a soft newline lands without submitting; ⌘Enter submits both lines.

**Cross-ref.** ENH-127 (the original Return-key remap; this is a sister handler).

---

### ENH-138: Move FTUX-loadable HTML/markdown content into a built-in default pack — establish the "FTUX content → packs / plumbing → install-service" boundary

**Status:** ✅ **Shipped 2026-05-10 (Sprint 15 commits 3 + 6).** NOW-SKELETON migration + upgrade-path fix landed:
- `packs/duo-default/` created with `PACK.json` (`builtIn: true`, `name: "duo-default"`, `version: "1.0.0"`).
- `git mv help/what-duo-does.html packs/duo-default/canvases/what-duo-does.html`. The pack-mirror op in `install-service.ts:457-463` picks up the new pack automatically; no install-service changes needed for the mirror.
- `PackManifest` schema extended with `builtIn?: boolean` ([`shared/types.ts:213`](shared/types.ts)). `PackLoader.validateManifest` accepts + surfaces the field ([`core/pack-loader.ts`](core/pack-loader.ts)).
- Op #8 in install-service ([`electron/install-service.ts:509-540`](electron/install-service.ts)) pivoted: dropped FAQ pin (ENH-135), repointed WDD URL to `${PACKS_DEST_DIR}/duo-default/canvases/what-duo-does.html`. The hardcoded literal stays as a transitional shape — a future commit will iterate `packs/*/PACK.json` for `defaults[].pin: true` entries and seed pins.json from them, removing the hardcoded URL entirely. (Filed as FOLLOWUP in `docs/dev/active-sprint.md` § "Sprint 15 carry-over".)
- **Commit 6 (upgrade-path fix; owner-raised during smoke walk):** `openOnFirstLaunch: true` for the duo-default WDD canvas + idempotency check added to the first-launch hook in [`electron/main.ts § 521-571`](electron/main.ts). The hook now reads pins.json and skips NAV_EDIT for any pack default whose URL is already pinned — pin-restore (BUG-057) owns those opens. Net: fresh installs see ONE WDD tab pinned (no dupe); v0.6.12 → v0.6.13 upgraders see TWO WDD tabs (stale pinned at v0.6.12 location + fresh new at pack location). Pack-version bumps re-fire for everyone. Full design recorded as ADR in [`docs/DECISIONS.md § "Pack canvas / pinned tab idempotency contract"`](docs/DECISIONS.md).

**Owner picks (verbatim 2026-05-10):**
- **Q1 ADOPT** — partition install-service vs packs along the FTUX-content boundary (full adoption).
- **Q2 NOW-SKELETON** — Sprint 15 creates `packs/duo-default/` skeleton + migrates `what-duo-does.html` immediately; ENH-137 Beginner's Guide drops into the same pack later.
- **Q3 FLAG-IN-PACK-JSON** — extend PackManifest schema with `builtIn: true` flag.

**Architectural note on `builtIn` enforcement:** The existing `duo pack uninstall <name>` CLI verb operates on **Stage 21d distro packs** (under `~/.claude/duo/extra-packs/`), NOT on **Stage 28 lesson packs** (under `~/.claude/duo/packs/`, where `duo-default` lives). There is no current code path that would attempt to uninstall a Stage 28 lesson pack via Duo's CLI; the pack folder must be deleted manually. The `builtIn: true` flag is therefore **forward-compat only** — it's a declarative marker any future Stage 28 uninstall tooling will honor. Adding a refusal handler today would be wired to a code path that doesn't exist.

**Owner general-comment (verbatim 2026-05-10):** *"Confirm that pack-delivered FTUX/default open, persist til closed content can be ANY OF: a markdown file in editable state, a markdown file in locked state, an html canvas, a playground."*

**Confirmation answer (sub-task scope clarification):**
- **Q1 ADOPT** — partition install-service vs packs along the FTUX-content boundary (full adoption, not narrower)
- **Q2 NOW-SKELETON** — Sprint 15 creates `packs/duo-default/` skeleton + migrates `what-duo-does.html` immediately; ENH-137 Beginner's Guide drops into the same pack later
- **Q3 FLAG-IN-PACK-JSON** — extend PackManifest schema with `builtIn: true` flag; CLI `duo pack uninstall <name>` refuses (or requires `--force`) when the flag is set

**Owner general-comment (verbatim 2026-05-10):** *"Confirm that pack-delivered FTUX/default open, persist til closed content can be ANY OF: a markdown file in editable state, a markdown file in locked state, an html canvas, a playground."*

**Confirmation answer (sub-task scope clarification):**

| Content kind | v1 schema support | How |
|---|---|---|
| HTML canvas (canvas mode — editable raw HTML) | ✅ supported today | `PackDefault.kind: 'canvas'` + plain `.html` file → first-launch hook sends `NAV_EDIT` → `openFileSmart` routes to canvas tab |
| HTML playground (browser mode — scripts run, buttons fire) | ✅ supported today | `PackDefault.kind: 'canvas'` + `.html` file with `<meta name="duo-open-in" content="browser">` in the head → `openFileSmart` honors the meta hint and routes to browser pane |
| Markdown editable (TipTap rich editor) | ❌ NOT yet — needs schema extension | `PackDefault.kind` would expand to `'editor'`; `electron/main.ts:535` hardcodes a filter that drops non-canvas kinds (`if (def.kind !== 'canvas') continue   // editor/browser are v2`) |
| Markdown locked (read-only preview) | ❌ NOT yet — needs schema extension | `PackDefault.kind` would expand to `'markdown-preview'` (the existing read-only TabType per shared/types.ts:347); first-launch dispatch needs a kind-aware route to force preview mode |

**Resulting Sprint 15 scope (NOW-SKELETON migration):**

- **WDD migration uses v1 schema as-is.** `what-duo-does.html` is already an HTML file; opens via `kind: 'canvas'` (or `kind: 'canvas'` + `duo-open-in=browser` if we want browser-mode rendering — owner's call).
- **Schema extension is OUT OF SCOPE for the NOW-SKELETON migration.** The pack works for HTML; markdown support is a follow-on.
- **The schema extension lands** when a pack default needs to deliver markdown — most likely at ENH-137 (Beginner's Guide) IF the owner chooses to author it as markdown rather than HTML. **Filed as ENH-139 below.**

**Sprint 15 sub-tasks (per Q1+Q2+Q3 picks):**

1. Create `packs/duo-default/` with `PACK.json` (name: `duo-default`, version: matches Duo's `package.json`, `builtIn: true`, `defaults[]` with one entry for `what-duo-does.html` set to `openOnFirstLaunch: true, pin: true`).
2. `git mv help/what-duo-does.html packs/duo-default/canvases/what-duo-does.html`. Update any cross-references (the asar `files: help/**/*` glob still includes `help/`; `help/canvas-actions-demo.html` remains).
3. Extend PackManifest schema (shared/types.ts) with `builtIn?: boolean` field.
4. Update PackLoader (`core/pack-loader.ts`) to surface the `builtIn` flag.
5. Update CLI `pack uninstall` (likely in `cli/duo.ts` + `core/socket-server.ts` + the `electron/distro-pack-service.ts` uninstaller) to refuse uninstall when `builtIn: true`, OR require `--force`.
6. Remove the hardcoded default-pins JSON literal at `install-service.ts:520-528` (op #8). The pack's `defaults[].pin: true` handles default-pinning now.
7. Update `browser-manager.ts:49` (`defaultLandingUrl`) — currently `helpUrl('faq.html')`; pivot to either `null` (blank canvas on new tab — recommended) or the pack canvas URL.
8. Update `electron/main.ts:305-310` — drop the FAQ-as-boot-default-tab logic (no longer relevant).
9. Smoke walk: fresh install → WDD opens via the pack, gets pinned. Bump pack version + reinstall → first-launch open re-fires. `duo pack uninstall duo-default` is refused without `--force`.

**Implications cascading from these decisions:**

- **ENH-135 (FAQ removal) collapses into ENH-138's sub-task #6 + #7.** The default-pins literal goes away entirely; FAQ archive to `docs/legacy/` is a single `git mv`.
- **ENH-137 (Beginner's Guide) gets simpler.** Its surface decision (pack vs help vs both) dissolves — the pack IS the surface. Owner-authored draft drops into `packs/duo-default/canvases/beginners-guide.html` (HTML) or triggers ENH-139 schema extension if owner authors as markdown.

**Cross-ref:** ENH-134 (the planning playground that surfaced this question; can be closed as ✅ resolved once Sprint 15 ships ENH-138). ENH-135 (folds into ENH-138 sub-tasks). ENH-137 (content drops into the pack ENH-138 creates). ENH-139 (the schema extension if/when needed).

---

### ENH-139: Extend PackManifest schema to support markdown editable / markdown locked / playground (browser-mode) defaults

**Status:** 🟡 **Open / deferred until needed.** Surfaced 2026-05-10 by ENH-138's owner general-comment confirming the v1 PackDefault.kind union (just `'canvas'`) doesn't cover all four content kinds owner asked about. Defer until a real pack default needs markdown OR explicit playground routing.
**Priority:** Medium — gates pack-delivered markdown content. Not urgent because today's known FTUX content (`what-duo-does.html`, `beginners-guide.html` likely) is HTML.
**Filed:** 2026-05-10.

**What's wanted.** Expand the union from `kind: 'canvas'` to `kind: 'canvas' | 'editor' | 'markdown-preview' | 'browser'` to express:
- `'canvas'` — HTML in canvas mode (editable raw HTML; today's behavior)
- `'editor'` — `.md` file in TipTap rich editor (full editable markdown experience)
- `'markdown-preview'` — `.md` file in read-only preview pane (locked markdown — user reads, doesn't type)
- `'browser'` — explicit playground routing (today implicit via the file's `<meta duo-open-in>` meta — making this explicit at the pack-default level lets a single HTML file be routed differently per pack default if needed)

**Implementation sketch:**

1. `shared/types.ts § PackDefault.kind` — expand the union.
2. `core/pack-loader.ts § validateManifest` — accept the new kinds.
3. `electron/main.ts § first-launch defaults hook` — remove the line 535 `if (def.kind !== 'canvas') continue` filter; route each kind:
   - `'canvas'` → `NAV_EDIT` (current; openFileSmart handles routing)
   - `'editor'` → `NAV_EDIT` (same call; openFileSmart routes `.md` to editor by default)
   - `'markdown-preview'` → some new IPC that forces preview mode (need to add — `openFileSmart` doesn't currently have a "force preview" override; might need a new `mode: 'preview'` argument similar to ENH-097's `mode: 'canvas'`)
   - `'browser'` → `openFileSmart(path, name, 'browser')` (the explicit override path; bypasses the file's own `duo-open-in` meta)
4. Update PackManifest validation tests + smoke-walk fixture packs covering each kind.

**Trigger to land:** when ENH-137 (Beginner's Guide) author chooses markdown OR when a future content pack needs explicit browser-mode default-open without depending on the file's meta hint.

**Cross-ref:** ENH-138 (the principle that surfaced this gap). ENH-137 (the most likely trigger).

---

### BUG-121: Closing the last browser tab respawns about:blank in a loop

**Status:** 🟢 Shipped 2026-05-10 in Sprint 16 commit 2 (cut target v0.6.14).
**Priority:** P0 — user-visible regression of the v0.6.13 FAQ retirement; surfaced concurrently with the enterprise ENH-141 report.
**Filed:** 2026-05-10.

**The problem.** Closing a browser tab when (a) it was the only tab, or (b) the only other tab was pinned in Split View aux, immediately spawned a fresh `about:blank` at the rightmost position. User closed it → spawn → close → spawn → ad infinitum. Originally observed in v0.6.14-source on an enterprise machine; reproducible on any install where the user closes the last main-strip tab.

**Root cause.** Two intentional guards in `electron/browser-manager.ts § closeTab`:

- **BUG-020 fix (line 389-410, dating to Stage 10)** — refused to drop below `tabs.length === 1` and spawned `newTabUrl()` to keep the strip non-empty. Original motivation: the boot-time FAQ tab was non-closeable; users had no way to dismiss it on first launch.
- **BUG-096 fix (line 437-454, Phase 3c)** — refused to leave the main strip without an active tab when an aux tab was pinned; spawned a fresh `about:blank` to fill the main slot.

The BUG-020 motivation evaporated in **v0.6.13 (ENH-135)** when the FAQ retired to `docs/legacy/faq.html` and the boot path stopped auto-opening hard-coded tabs. The replacement is pin-restore + the pack-canvas first-launch hook, which open whatever the install service seeded into `pins.json` (currently the duo-default pack's WDD canvas) — a tab that's fully closeable. The BUG-020 guard kept firing anyway, now without justification.

**The fix.** Drop both spawn-replacement paths. Make `tabs.length === 0` (or `activeIndex === -1` because the only remaining tab is aux-pinned) a first-class supported state:

- `closeTab` — simple splice + non-aux neighbor pick. If `findNonAux` returns -1, set `activeIndex = -1` and emit an empty `BrowserState` (`url: '', title: '', canGoBack/Forward: false, isLoading: false`). The aux tab (if any) keeps its bounds untouched.
- `activeView()` — now returns `WebContentsView | null`. Pre-fix it threw on the impossible empty state; post-fix every caller (`navigate`, `goBack`, `goForward`, `reload`, `findInPage`, `stopFindInPage`, `getActiveUrl`, `getActiveTitle`, `openDevTools`, `closeDevTools`, `isDevToolsOpened`, `focusActive`, `getState`) guards the null case.
- `navigate(url)` — when called in the empty state (no active view), self-heals by `addTab(url) + switchTab` instead of throwing. The address bar is the user's primary path out of the empty state.
- `addTab(url)` — when `activeIndex === -1`, auto-activate the newly-added tab (setBounds + emitState). Mirrors switchTab's bounds + emit path. Lets the renderer's `+` button (which doesn't call switchTab after addTab) work from the empty state.
- `switchTab` — guard the "shrink current view" line against the empty state.
- `setBounds()` — already guarded with `tabs.length > 0 && activeId !== auxTabId`; the empty state is a benign no-op.

**Files touched.**

| File | Change |
|---|---|
| `electron/browser-manager.ts` | drop both spawn-replacement blocks; nullable `activeView()`; null-guards on all callers; `navigate` self-heal; `addTab` auto-activate from empty state; `switchTab` empty-state guard |

**Verification done (2026-05-10 dev session).**

1. `npm run typecheck` clean — all activeView() consumers retyped via `?.` or explicit null-guards.
2. End-to-end CLI walk via `duo close`:
   - Initial state: 2 tabs (WDD + smoke-walk page).
   - `duo close 2` → 1 tab remains, WDD active. ✅
   - `duo close 1` → **0 tabs**, no respawn (this is the critical assertion). ✅
   - `duo open <path>` from empty state → 1 tab, active, url + title correct via `duo url` / `duo title`. ✅
3. No regressions in CDP attach, off-host routing, or aux-pin flows (no code paths altered for those — only the spawn-replacement blocks + the null guards).

**What this changes for users.**

Closing the last browser tab now leaves the browser pane in an empty state — address bar shows empty URL, the main slot is collapsed (1×1 WCV), the working-pane tab strip shows only file tabs. Typing a URL in the address bar self-heals back to a populated state. Clicking the `+` button from the empty state opens a fresh about:blank and activates it.

**Stale stuck-state recovery.** Users who upgraded into a session-state that already had a stuck about:blank can now close it — the new closeTab path doesn't respawn. No data migration needed; the empty state is reached on next close.

---

### ENH-141: Drop `duo` CLI into SHIM_DIR so it works inside Duo PTYs and Claude Code sandboxes without `.zshrc` edits

**Status:** 🟢 Shipped 2026-05-10 in Sprint 16 commit 1 (cut target v0.6.14).
**Priority:** P0 — load-bearing for enterprise users running Duo inside a Claude Code sandbox that blocks `.zshrc` writes.
**Filed:** 2026-05-10 from an enterprise user report (Darwin 25.4.0, zsh, Duo v0.6.13).

**The problem.** Both install paths placed the CLI somewhere that's NOT on PATH inside Duo PTYs:

- `duo install` (CLI self-install) wrote to `~/.claude/bin/duo` — sandbox-writable, but `~/.claude/bin/` was never prepended to any shell's $PATH. Net: symlink existed, `duo: command not found`.
- `electron/install-service.ts § installCli()` wrote to `~/.local/bin/duo` — needs the user to add `~/.local/bin/` to their shell rc, which Claude Code's sandbox blocks (write-deny on dotfiles outside cwd).

Result: inside a Duo PTY, with Claude Code running under a sandbox, the agent could call `duo` only by absolute path. The whole "agent-driven Duo" premise breaks.

**The fix.** `core/pty-manager.ts:42` already prepends `~/.claude/duo/bin/` (SHIM_DIR) to PATH at every PTY spawn — that's how the `claude` shim works. We piggyback on that:

1. **`cli/duo.ts § runInstall()`** — change tier-1 target from `~/.claude/bin/duo` → `~/.claude/duo/bin/duo`. Now `duo install` from inside a sandboxed PTY drops the CLI somewhere PTY $PATH already finds.
2. **`electron/install-service.ts § installCli()`** — after the existing `~/.local/bin/duo` copy, ALSO create a symlink at `~/.claude/duo/bin/duo` pointing to it. The FirstLaunchBanner [Install] action now wires BOTH placements in one click.
3. **Updated PATH-hint messaging** — `duo install` now distinguishes "inside Duo PTYs this dir is already on PATH" vs "external Terminal/iTerm needs this `export PATH=...`".

**Companion change (same commit).** Folded `addToShellPath()` into `install-service.run()` so the FirstLaunchBanner's [Install] click also auto-appends the `~/.local/bin` PATH fence to the user's `.zshrc` (was previously a separate dismissible button row that users skipped). Eliminates the click-trap for non-sandboxed users who also want `duo` from external terminals. New field `InstallResult.pathWiringResult` surfaces the outcome in the success banner; the standalone `install.addToShellPath()` IPC stays for the rare retry case.

**Backward compatibility.** Pre-ENH-141 installs that placed `~/.claude/bin/duo` are not auto-cleaned — the file's harmless (just unused). `duo doctor`'s known-targets list now includes both old and new paths so the diagnostic surfaces stale state.

**Files touched.**

| File | Change |
|---|---|
| `cli/duo.ts` | tier-1 target → SHIM_DIR; updated PATH-hint copy; `doctor` lists both old and new targets |
| `cli/duo` | regenerated via `npm run build:cli` |
| `electron/install-service.ts` | `installCli()` drops SHIM_DIR symlink; `run()` auto-invokes `addToShellPath()`; top-block docs updated |
| `shared/host-api.ts` | `InstallResult.pathWiringResult?: AddToShellPathResult` added |
| `renderer/components/FirstLaunchBanner.tsx` | dropped separate [Add to PATH] button; success row surfaces `pathWiringResult` inline; welcome copy mentions both placements |
| `docs/CLI-COVERAGE.md` | `duo install` row updated with SHIM_DIR rationale |
| `docs/DECISIONS.md` | sandbox-tolerant-transport ADR § 3 revised with the ENH-141 amendment |

**Verification done (2026-05-10 owner machine).**

1. `npm run typecheck` clean.
2. `npm run build:cli` regenerated the binary; committed alongside source.
3. CLI install path tested end-to-end: deleted SHIM_DIR/duo → ran `./cli/duo install` → symlink created at `~/.claude/duo/bin/duo`; PATH-hint messaging correct.
4. PTY-PATH simulation: `env -i PATH=$HOME/.claude/duo/bin /bin/bash -c 'command -v duo'` resolves correctly — confirming `duo` is callable by name with only SHIM_DIR on PATH.
5. Electron-side install path verified via code review + typecheck; full end-to-end smoke (banner [Update] click → SHIM_DIR symlink appears + zshrc fence appended) deferred to v0.6.14 smoke walk (screenshot capture was failing at OS level during dev verification; the work-machine install will be the production check).

**Out of scope for this commit.**

- Cleanup of stale `~/.claude/bin/duo` symlinks on upgrade. (Filed as FOLLOWUP-013.)
- `duo doctor` version-reporting bug (the CLI/app both report 0.1.0 instead of the actual version in some environments). Separate issue, surfaced during ENH-141 work; filed as BUG-120.

---

### ENH-140: install-service should track + cleanup orphan files on upgrade

**Status:** 🟡 Open. Filed 2026-05-10 from Sprint 15 close-out — surfaced when ENH-135 retired `help/faq.html` and ENH-136 retired `packs/claude-code-basics/` but install-service's mirror op kept the v0.6.12 copies on every existing user's disk.
**Priority:** Low — graceful degradation works today (orphan files are inert; stale pins still resolve). But the longer-term install hygiene story is "upgrade should leave the user's `~/.claude/duo/` in the shape the current bundle defines, not as the union of every version ever installed."
**Filed:** 2026-05-10.

**Today's behavior (post-v0.6.13).** `electron/install-service.ts § safeOverwriteDirContents` recurses into source directories and copies / overwrites files at destination. It does NOT delete destination files that aren't present in source. Net: every retired file from any prior cut accumulates in the user's `~/.claude/duo/` forever:

- `~/.claude/duo/help/faq.html` — retired in v0.6.13, still on disk for every v0.6.12 upgrade user.
- `~/.claude/duo/help/what-duo-does.html` — moved into the pack in v0.6.13; old copy still on disk.
- `~/.claude/duo/packs/claude-code-basics/` — retired in v0.6.13, full pack folder still on disk.
- Any future retirements: same story.

**Why this matters.**

1. **Stale pin URLs keep resolving** — v0.6.12 users' `pins.json` entries pointing at the OLD `help/...` URLs still work (file exists), so they see stale v0.6.12 content forever unless they manually re-pin. Sprint 15's first-launch hook + idempotency contract mitigates this for the WDD case (delivers new content as a fresh tab alongside the stale-pinned old one), but the stale pin itself never gets cleaned up.
2. **Disk usage drift** — minor today, but every retired bundle adds inert bytes. Multiple years of cuts compound.
3. **User confusion** — `ls ~/.claude/duo/packs/` shows `claude-code-basics/` on upgrade users despite the pack no longer being part of Duo. Same for `~/.claude/duo/help/faq.html` on a fresh user-mirror inspection.

**Proposed design — provenance manifest at `~/.claude/duo/installed-files.json`:**

Mirror the Stage 21d distro-pack-service pattern ([`electron/distro-pack-service.ts § InstalledFilesManifest`](electron/distro-pack-service.ts)):

```jsonc
// ~/.claude/duo/installed-files.json
{
  "version": "0.6.13",
  "installedAt": "2026-05-10T...",
  "files": [
    "help/canvas-actions-demo.html",
    "packs/duo-default/PACK.json",
    "packs/duo-default/canvases/what-duo-does.html",
    "packs/intro-to-duo/...",
    // ...every file install-service writes
  ]
}
```

On each install / upgrade:

1. Read the prior manifest (if any). Diff against the bundle's current file set.
2. **Deleted-from-bundle files** (in prior manifest, not in current bundle): delete from `~/.claude/duo/` IFF the on-disk SHA matches the prior manifest's recorded SHA (i.e. user didn't customize). User-modified copies are preserved at `~/.claude/duo/.retired/<original-path>` with a session-log entry pointing at them.
3. **Pin-cleanup pass**: walk `pins.json` for entries pointing at now-deleted files. Either (a) auto-rewrite to the new location if a successor file is present (the WDD case: `help/what-duo-does.html` → `packs/duo-default/canvases/what-duo-does.html`), OR (b) drop the pin entirely with a session-log entry the user can review.
4. Write the new manifest.

**Migration path (this is the hard part).** v0.6.13 ships without the manifest. v0.6.14's first install creates the manifest from scratch (treats the v0.6.13 install as the new baseline). v0.6.14 → v0.6.15 upgrades start using the diff-based delete. So the first "retirement" caught by this mechanism is whatever the v0.6.14 cut retires, NOT FAQ / claude-code-basics. Those v0.6.13-retired-but-still-on-disk-orphans need a one-time migration in v0.6.14 — a hardcoded list of "known orphans" to opportunistically delete (with the same SHA-match safety net) on first launch.

**Smoke-test plan for the eventual fix.**

1. Fresh v0.6.13 install: `~/.claude/duo/installed-files.json` doesn't exist yet (this is the migration baseline cut).
2. Upgrade to v0.6.14: manifest gets created from v0.6.14's bundle. Hardcoded one-time migration deletes `help/faq.html`, `help/what-duo-does.html`, and `packs/claude-code-basics/` IFF unchanged from their v0.6.12 SHAs (preserves any user edits to `~/.claude/duo/.retired/`). Pin-cleanup rewrites WDD pin URL.
3. Cut v0.6.15 that retires a new file. Upgrade. Manifest diff catches it. Orphan deleted. Pin (if any) cleaned up.

**Cross-ref:** ENH-138 (Sprint 15 — the install-pipeline reshape that surfaced this gap). ENH-135 (FAQ retirement — first concrete orphan). ENH-136 (claude-code-basics retirement — second concrete orphan). `docs/dev/active-sprint.md § Sprint 15 carry-over` (where the pin-migration follow-up was first noted). `electron/distro-pack-service.ts § InstalledFilesManifest` (existing pattern to model after — Stage 21d distro packs already do this).

---

### BUG-119: fsevents native-module shutdown race — SIGABRT every time Duo quits

**Status:** 🟡 Open. Filed 2026-05-10 from Sprint 15 close-out (post-v0.6.13 cut). Owner reports the macOS crash dialog appears every time Duo quits.
**Priority:** Medium — cosmetic (crash happens AFTER app shutdown; no data loss; sessions/pins persist correctly), but the macOS crash dialog is annoying and looks bad. Not user-facing on a daily basis but unprofessional.
**Filed:** 2026-05-10.

**Symptom.** Every quit (Cmd+Q, SIGTERM, or normal close) produces a macOS crash report:

```
Process:               Duo [...]
Identifier:            com.geoffdudgeon.duo
Version:               0.6.12 (and presumably 0.6.13+)
Crashed Thread:        0  CrBrowserMain  Dispatch queue: com.apple.main-thread
Exception Type:        EXC_CRASH (SIGABRT)
Termination Reason:    Namespace SIGNAL, Code 6 Abort trap: 6

Thread 0 stack:
  __pthread_kill → pthread_kill → abort
    → uv_mutex_lock → napi_release_threadsafe_function
    → fse_instance_destroy   ← in fsevents.node
```

**Root cause.** `fse_instance_destroy` = the macOS `fsevents` native Node addon used by chokidar (which `FilesService` uses for navigator file-watching). On process termination, the addon's threadsafe N-API function teardown races with the Node env shutdown.

The shutdown sequence in `electron/main.ts`:

- `before-quit` (line 801) — flushes session-state + browser history. Does NOT dispose watchers.
- `window-all-closed` (line 809) — `ptyManager.dispose()` + `filesService.dispose()`.

On macOS the `window-all-closed` hook DOES NOT FIRE on Cmd+Q or SIGTERM by default (it's gated on platform — line 816 only calls `app.quit()` on non-darwin). Net: watchers stay alive while the env tears down. fsevents' threadsafe function tries to release after the mutex it depends on is already destroyed → abort.

**Fix.** Move `filesService.dispose()` (and `ptyManager.dispose()`) into the `before-quit` hook so watchers close BEFORE the Node env starts tearing down native modules:

```typescript
// in electron/main.ts:
app.on('before-quit', async () => {
  // ENH-013 — stop polling first (lightweight).
  claudePresence.stop()
  // BUG-119 — dispose watchers BEFORE the env teardown so the fsevents
  // native module can release its threadsafe function while the mutex
  // is still alive. Without this, `fse_instance_destroy` races against
  // Node env shutdown and aborts.
  ptyManager.dispose()
  await filesService.dispose()
  // Final flushes.
  await sessionStateService.flush()
  await browserHistory.flush()
})

app.on('window-all-closed', () => {
  // Disposes already happened in before-quit; this hook is now just for
  // platform-quit semantics on non-darwin.
  if (process.platform !== 'darwin') app.quit()
})
```

**Smoke walk item.** After the fix lands: launch Duo → Cmd+Q → confirm NO crash report appears. Repeat for SIGTERM (`kill <pid>`) and force-quit.

**Cross-ref.** Discovered post-v0.6.13 cut during Sprint 15 close-out (owner walked the cut + saw the recurring crash dialog). `chokidar` + `fsevents` are listed in `scripts/validate-dmg-launch.sh § REQUIRED_RUNTIME_MODULES`. Class of bug: Electron native-module shutdown race; well-documented in the chokidar / fsevents issue trackers (search "fsevents abort shutdown").

---

### BUG-118: `cut-version` skill should sanity-check cli/duo binary against a fresh rebuild — caught after v0.6.12 shipped stale

**Status:** ✅ **Shipped 2026-05-10 (Sprint 15 commit 2).** Added `git diff --quiet cli/duo` post-`npm run build:cli` guard in [`.claude/skills/cut-version/SKILL.md`](.claude/skills/cut-version/SKILL.md) at Step 4. If the freshly-rebuilt binary differs from HEAD, the cut aborts with a helpful message: "Run: git add cli/duo (then re-attempt the cut)." Future cuts can no longer silently ship a stale binary.
**Priority:** High — silently shipped a stale CLI binary in v0.6.12; only caught during ENH-134 cleanup work because `git status` showed a 225-line cli/duo diff post-cut. Without that catch the regression would have lived on `main` until the next cut.
**Filed:** 2026-05-10. **Shipped:** 2026-05-10.

**What happened.** v0.6.12's cut commit (18725c7) included `cli/duo` at SHA `025a57b` (1269 lines, missing the ENH-130 `--reveal` flag handling for `duo open / edit / view`). The freshly-rebuilt binary at SHA `34dd176` (1476 lines) wires the flag correctly. The dist-signed.sh + DMG-bundled binary IS correct (built post-`npm run build:cli`); this regression only affects dev users (npm run dev install path).

**Theory on the trigger.** Most likely a misordered shell invocation in the cut workflow Step 4: `npm run build:cli` ran fresh; then a typecheck failure on JsonView (onAdd/onDelete props) caused me to edit + re-typecheck; somewhere between the rebuild and the `git add cli/duo` the binary got reverted on disk OR the build was overwritten. cli/duo.ts source was unchanged — only the binary drifted.

**Mitigation for users.** v0.6.12 DMG users are unaffected (the bundled cli/duo in the .app was packaged post-`npm run build:cli`; install-service op #12 copies the bundled one). v0.6.12 dev-install users (`npm run dev` path) had the stale binary at `~/.local/bin/duo`; landing 8d1f96e in v0.6.13 fixes them on next install-banner click.

**Cross-ref.** Commit 18725c7 (the cut that committed the stale binary). Commit 8d1f96e (the fix). ENH-134 (cleanup work that surfaced the regression).

---

### BUG-117: install-service SessionStart hook write must fail gracefully for enterprise-locked `~/.claude/settings.json`

**Status:** ✅ **Shipped 2026-05-10** — wrapped `installSessionStartHook()` call site in try/catch ([electron/install-service.ts:538-553](electron/install-service.ts)). On failure (read-only settings.json, restrictive enterprise policy, JSON write reject), the catch logs a warn and continues — the rest of the install still completes. Mirrors the existing CLAUDE.md merge graceful-failure pattern at lines 547-553.
**Priority:** Medium — surfaced by owner during ENH-134 review: *"it is likely that editing ~/.claude/settings.json will fail for many enterprise clients, so ensure this fails gracefully/is treated as optional."*
**Filed:** 2026-05-10. **Shipped:** 2026-05-10.

**Why this is safe** — the SessionStart hook is the **redundant** priming path. The PATH shim at `~/.claude/bin/claude` (op #11 in install-service) is load-bearing; if Claude Code resolves through the shim, the priming context lands without hooks. The hook just gives Claude Code a second chance to discover the priming when (a) hooks are enabled, (b) the user has Claude Code installed elsewhere AND it's discovered by Claude Code's own boot. So an enterprise install with locked settings.json still gets working Duo + priming as long as the PATH shim install (op #11) succeeds.

**Cross-ref:** ENH-134 (distro-packs planning playground that surfaced this gap). FOLLOWUP-018 (broader sweep of "what other ops should fail gracefully?" — see playground § 4 maintenance recipes).

---

### BUG-116: `scripts/dist-signed.sh` validates the wrong DMG via glob

**Status:** ✅ **Shipped 2026-05-10 (Sprint 15 commit 5).** [`scripts/dist-signed.sh:154`](scripts/dist-signed.sh) now reads the version from `package.json` and passes the explicit `dist/Duo-${DUO_VERSION}-arm64.dmg` path to `validate-dmg-launch.sh`. The script's existing `DMG_PATTERN="${1:-dist/Duo-*-arm64.dmg}"` glob (line 29) plus `ls | tail -1` was picking the alphabetically-last match — between v0.6.8 and v0.6.12 that's v0.6.8 (because "1" < "8" character-wise), so cuts could pass validation against the OLD DMG. The fix sidesteps the glob entirely.
**Priority:** Low — non-user-facing; affects build-pipeline confidence only. The new DMG is signed + notarized + stapled correctly; only the launch-smoke validate step was picking the wrong file.
**Filed:** 2026-05-10. **Shipped:** 2026-05-10.

**Symptom (preserved for cross-reference).** During the v0.6.12 cut, `bash scripts/dist-signed.sh` ran successfully end-to-end, but the embedded `scripts/validate-dmg-launch.sh` step printed `[validate-launch] DMG: dist/Duo-0.6.8-arm64.dmg` — it picked an OLD DMG, not the freshly-built `Duo-0.6.12-arm64.dmg`. Static + dynamic launch checks PASSED but were against `0.6.8`, not `0.6.12`. Owner caught it; cut paused; ran `bash scripts/validate-dmg-launch.sh dist/Duo-0.6.12-arm64.dmg` explicitly, which passed.

**Cross-ref:** v0.6.12 cut session.

---

### ENH-137: Beginner's Guide to Duo — owner-authored draft + Claude polish + ship as content

**Status:** 🟡 **Open / awaiting owner draft.** Owner directive 2026-05-10 (paraphrased from ENH-134 review): *"we do need a more useful beginners guide to duo; add as a task for me to write the initial version and for you to augment, package for distribution."*
**Priority:** High — the in-app FAQ is being removed (ENH-135); the welcome banner + first-launch experience needs a friendlier on-ramp than just "click Install."
**Filed:** 2026-05-10.

**What's wanted.** A beginner's guide to Duo aimed at the primary persona (PMs and other non-engineering knowledge workers). Probably explains:
- What Duo IS (the workspace + agent pair model)
- The first 30 seconds (Install banner → click Install → terminal tab → `claude` → ask it about something on your screen)
- The three-column layout (files / terminal / right-pane polymorphic tabs) and what each is for
- The flagship Google Docs read/edit success test
- Where to go from here (link to in-app help / GitHub Issues)

**Two open AUQs:**

1. **Q1 — content surface.** Should it be:
   - **(a)** A new file in `help/` (e.g. `help/beginners-guide.html`) — direct replacement for the FAQ
   - **(b)** A new lesson pack at `packs/beginners-guide/` (auto-opens on first launch via PackLoader)
   - **(c)** Both — pack for the first-launch open + help/ file for the always-on Help-menu surface
   - Owner-recommended option per ENH-134 review surfaces: probably **(b)** ("perhaps the new beginners guide should ship as a pack?"). But (c) hedges if discoverability matters.

2. **Q2 — process.** Owner writes draft v1; Claude polishes, formats per Atelier voice, paginates if needed, builds the pack/help-file artifact. Each iteration is owner-reviewed.

**Owner action:** write a draft (any format — markdown, prose dump, even a transcript of an explanation). File at `~/.claude/duo/beginners-guide-draft.md` or paste back to a Claude session.

**Claude action (after owner draft lands):** polish the draft, render as HTML matching the Atelier styling (`help/` aesthetic), pick the surface per Q1, ship in the appropriate location, update install-service if needed (e.g., add to default pins.json if (c) is picked).

**Cross-ref:** ENH-138 (the default-pack mechanism this content lives in once both lands). ENH-135 (FAQ removal — creates the discoverability gap this fills). ENH-134 (planning playground that surfaced this).

**Pack-shape clarification (added 2026-05-10 after owner principle discussion):** with ENH-138's "FTUX content → packs" boundary, the surface decision (Q1 in the original ENH-137 filing — pack vs help file vs both) collapses to *"the pack IS the surface."* The Beginner's Guide content lives at `packs/duo-default/canvases/beginners-guide.html` once both ENHs land. ENH-137's remaining work: owner-authored draft + Claude polish + paste into the pack canvas.

---

### ENH-136: Treat `packs/claude-code-basics/` as a template (never fleshed out — empty curriculum skeleton)

**Status:** ✅ **Shipped 2026-05-10 (Sprint 15 commit 1).** Owner picked option **(a)** — `git mv packs/claude-code-basics/ examples/lesson-pack-template/`. PACK.json's `name` renamed to `lesson-pack-template` to match the directory; description rewritten as "TEMPLATE — copy this directory ... ." Internal `claude-code-basics` references inside the moved pack (canvas-to-canvas navigation paths, breadcrumb links, SKILL.md cross-refs) bulk-renamed to `lesson-pack-template`. Skill cross-refs in `skill/lesson-runtime.md`, `skill/lesson-flythrough.md`, `skill/make-playground.md`, `skill/examples/curriculum-template/README.md`, and `skill/examples/canvas-templates/lesson-scaffold.html` updated — `claude-code-basics` is no longer "in the wild" so the narrative shifted to "intro-to-duo is the only Stage 28 lesson pack that ships." A new `examples/lesson-pack-template/README.md` walks pack authors through copy-and-customize.

**Why:** the pack's content was never developed past skeletons. Bundling unfinished content per-user-install is worse than not shipping at all. Existing users on v0.6.12 keep the leftover `~/.claude/duo/packs/claude-code-basics/` directory (install-service mirror op only adds; doesn't delete); fresh installs from v0.6.13 onward see only `intro-to-duo/` + the new `duo-default/` (ENH-138).

**Cross-ref:** ENH-134 (planning playground). ENH-137 (the beginner's guide that will replace the FTUX content gap).

---

### ENH-135: Remove FAQ from default install — move `help/faq.html` somewhere harmless in the repo

**Status:** ✅ **Shipped 2026-05-10 (Sprint 15 commit 3, folded into ENH-138).** Implementation:
- `git mv help/faq.html docs/legacy/faq.html` — file preserved for code reference; no longer ships in DMG.
- Op #8 default-pin literal in install-service.ts pivoted to drop the FAQ entry (now seeds `pins.json` with WDD-only, pointing at the duo-default pack canvas).
- `defaultLandingUrl()` + `helpUrl()` deleted from `electron/browser-manager.ts` (vestigial after FAQ retired). `addTab()` default param flipped to `'about:blank'` via `newTabUrl()`.
- `bootDefaultTab` constructor option dropped from `BrowserManager`. Cold-start with no persisted session = empty browser pane; the `BUG-057` pin-restore loop opens the WDD pin pinned (single pinned WDD tab vs. previous "FAQ + WDD pinned"). With persisted session, `restoreFromSession` populates from saved state.
- BUG-078 comment block in `electron/main.ts:303-310` collapsed (the conditional it explained no longer exists). The `hasPersistedSession` peek stays — BUG-057's pin-restore at line 491 still uses it.
- `fork.config.default.json:26` `helpPinnedFiles`: dropped `"faq.html"` (the constant `__DUO_BOOTSTRAP_HELP_PINNED__` declared in `shared/fork-config.d.ts` is currently unread, so this is hygiene only).
- `cli/duo.ts § printDoctor` dropped the "See FAQ → ..." pointer in the locale-warning text (FAQ no longer exists; the inline fix commands stay).
- Comment refs throughout (`README.md`, `docs/HOW-TO-FORK.md`, `.claude/skills/cut-version/SKILL.md`, `electron/install-service.ts` JSDoc, `electron/main.ts` example paths, `electron/browser-manager.ts` history blocks) updated to reflect the new layout.

**Owner picks (verbatim 2026-05-10):**
- **Q1 new-tab landing:** `(a) about:blank` — `defaultLandingUrl()` retired entirely (function deleted; sole caller `addTab()` default param now `'about:blank'`).
- **Q2 boot-default first tab:** `(a) Remove entirely` — no boot tab. WDD opens via the existing pins.json + BUG-057 pin-restore mechanism on first launch.
- **(implicit Q3 default-pin):** Drop FAQ from default pins; keep WDD pinned via the pivoted op #8 seed. Future direction: replace op #8 with iteration over `packs/*/PACK.json` `defaults[].pin: true`.

**Cross-ref:** ENH-138 (the pack mechanism that replaces FAQ as the FTUX surface). FOLLOWUP filed in active-sprint.md § "Sprint 15 carry-over" — "wire pack `defaults[].pin: true` → pins.json seeding so future packs auto-pin without install-service edits."

**Original spec (preserved for cross-reference):**
**Priority:** Medium — current FAQ content is stale and the in-app surface gives users a misleading impression of Duo's polish. Scope larger than a single delete because FAQ is woven into multiple surfaces.
**Filed:** 2026-05-10.

**Today.** `help/faq.html` ships in the .app bundle (`files: help/**/*` in electron-builder.yml) and is copied to `~/.claude/duo/help/faq.html` on first launch. It's woven into:

1. **Default pins.json** ([electron/install-service.ts:520-528](electron/install-service.ts)) — bootstrapped with FAQ + What Duo Does as the two default pinned tabs.
2. **Browser default landing URL** ([electron/browser-manager.ts § helpUrl line 49](electron/browser-manager.ts)) — `helpUrl('faq.html')` is the default for new browser tabs (⌘T on the browser pane).
3. **Boot-default first tab** ([electron/main.ts § 305-310](electron/main.ts)) — opens FAQ unconditionally on cold start when no session exists.
4. **Smoke-walk skill render path** ([electron/main.ts § 332](electron/main.ts)) — smoke-walk pages render `~/.claude/duo/help/faq.html` verbatim.

**The full removal is non-trivial** because of these surfaces. Three sub-questions for owner:

1. **What replaces FAQ as the new-tab landing?**
   - (a) `what-duo-does.html` (already shipped)
   - (b) Blank canvas (no default landing — user types a URL)
   - (c) The new beginner's guide once ENH-137 lands
   - Recommended: **(b)** for now; switch to (c) when ENH-137 lands. New browser tabs landing on a help page is itself somewhat nag-y.

2. **What replaces FAQ as the boot-default first tab?**
   - (a) `what-duo-does.html`
   - (b) Nothing — let session-restore handle it; cold start with no session = empty browser pane
   - (c) The beginner's guide (ENH-137)
   - Recommended: **(b)** — first launch already opens the lesson canvas (intro-to-duo); a duplicate help tab is redundant.

3. **What about the default pin?**
   - (a) Keep pinning What Duo Does (drop FAQ from default pins)
   - (b) Drop both default pins; user pins what they want
   - (c) Pin the beginner's guide (ENH-137) instead
   - Recommended: **(a)** for now — single pin keeps the "Duo has shipped some content" impression on first launch.

**Where to move FAQ in the repo.** Recommended: `docs/legacy/faq.html` — clearly archived; not exported in any way; available for code reference if anyone needs to remember what we used to ship.

**Implementation steps once scope is locked:**
1. `git mv help/faq.html docs/legacy/faq.html`
2. Update [electron/install-service.ts:520-528](electron/install-service.ts) to drop FAQ from default pins.json (per Q3-(a))
3. Update [electron/browser-manager.ts:49](electron/browser-manager.ts) to return `helpUrl('what-duo-does.html')` or `null`/blank per Q1
4. Update [electron/main.ts:305-310](electron/main.ts) to drop the FAQ-as-first-tab logic per Q2
5. Update smoke-walk skill template if it cites FAQ directly
6. Smoke walk: fresh install → verify no FAQ tab opens, no FAQ in default pins, ⌘T new tab lands on the picked replacement.

**Cross-ref:** ENH-138 (default-pack migration — once it lands, the default-pins JSON literal at op #8 goes away entirely; FAQ removal becomes simpler because there's no "what replaces FAQ as default pin?" question — the pack's `defaults[].pin: true` is the new mechanism). ENH-134 (planning playground — surgical "modify the install" recipe demonstration). ENH-137 (the beginner's guide that may eventually take FAQ's discovery slot, via the same pack).

---

### ENH-134: Dogfood the distro-packs pattern for Duo's own defaults — planning artifact (CLOSED — decisions captured 2026-05-10)

**Status:** ✅ **CLOSED 2026-05-10.** Refocused mid-flight from "should we converge?" to "how to modify the install + the surgical FTUX-content question." Owner walked the playground and Copy-decisions-back came back as: principle ADOPTED, NOW-SKELETON timing, FLAG-IN-PACK-JSON uninstall guard. Captured + filed as ENH-138 + ENH-139 (Sprint 15 P0 + deferred follow-on respectively). Playground stays in repo at [docs/research/dogfood-distro-packs-plan.html](docs/research/dogfood-distro-packs-plan.html) for reference (the install-pipeline inventory in §§ 1–4 is canonical maintenance documentation; § 5 closed but kept for context).

**Final decisions (verbatim Copy-decisions-back payload):**
```
ENH-134 INSTALL-MAINTENANCE — DECISIONS (2026-05-10)
============================================================
[ADOPT] Q1 · Adopt the FTUX-content-→-packs principle?
[NOW-SKELETON] Q2 · Migration timing relative to ENH-137
[FLAG-IN-PACK-JSON] Q3 · Built-in pack uninstall guard
GENERAL COMMENTS
----------------
Confirm that pack-delivered FTUX/default open, persist til closed
content can be ANY OF: a markdown file in editable state, a
markdown file in locked state, an html canvas, a playground
```

**General-comment confirmation answer captured in ENH-138 entry above.** Two of four kinds work in v1 schema (HTML canvas + playground via meta); markdown editable + markdown locked need schema extension filed as ENH-139.

**Original filing (kept below for context — supersedes by the closed status above):**

**Status:** 🟡 **Open / planning.** Interactive playground at [docs/research/dogfood-distro-packs-plan.html](docs/research/dogfood-distro-packs-plan.html) — open in Duo's browser pane via `duo open docs/research/dogfood-distro-packs-plan.html`, walk through § 1–3 (inventory, problem, four options compared via `.option-card` blocks), then answer the 5 inline decisions in § 4 (Q0 option pick + Q1–Q4 AUQs that gate Step 2), hit Copy decisions, paste back to Claude. Surfaces in every smoke walk until owner closes it (per the "research reports must file a tracked review task" memory rule).
**Priority:** Medium — architectural cleanup; not user-blocking but unblocks several adjacent improvements (single install pipeline, smaller install-service.ts, no PACK.json vs DISTRO.json schema duplication).
**Filed:** 2026-05-10.

**Owner directive (verbatim 2026-05-10):** *"I am not clear what markdowns ship with the actual packaged app, which load as pinned in FTUX, etc. We built a `packs` pattern for future enterprise devs to change this type of content (plus default skills, etc). Please write a planning artifact that describe the current default install strategy for docs and actions (skills, agent) vs the pack approach. Propose options for how to refactor the main app distro to eat our own dogfood and use the packs pattern to manage the apps own default distro for docs, skills, agents."*

**The playground covers:**
1. **What ships in the packaged app** (`extraResources` skill/, cli/, agents/ + asar-packed help/, packs/, out/, node_modules/).
2. **What the install service does on first launch** — 13 numbered operations rendered as a color-tagged inventory table (ops 1–5 CONTENT, ops 6–13 PLUMBING).
3. **The two pack patterns we already have** rendered as side-by-side comparison cards — Pattern A "Lesson packs" (`packs/<name>/PACK.json`, Stage 28) vs Pattern B "Distro packs" (`.claude-plugin/plugin.json + duo-extras/DISTRO.json`, Stage 21d). Semantically overlapping, mechanically distinct.
4. **Four options for the refactor** rendered as `.option-card` blocks (the recommended option — D: phased — gets a highlighted border):
   - **A: Full dogfood** (kill PACK.json, refactor install-service; ~3–5 days)
   - **B: Documentary mirror** (publish `examples/duo-default-distro/`; install-service unchanged; ~1 day; drift risk)
   - **C: Schema unification** (unify PACK.json + DISTRO.json; ~2 days)
   - **D: Phased — C in Sprint 15, A in Sprint 16+** ← recommended
5. **Five interactive decisions** — Q0 (pick the option) + Q1–Q4 (the AUQs that gate Step 2: pack location, install-service simplification scope, version-coupling, PACK.json BC). Each is a `.decision-card` with radio options, recommendation tags, and a per-question notes textarea. Sticky footer assembles the picks into a structured `[VALUE] Q-title\n    notes…` payload + Copy-to-clipboard.

**Owner action:** read the planning artifact; confirm the recommended Option D phased approach (or pick a different option); answer the 4 AUQs at Sprint 15 close-out OR defer to Sprint 16 plan.

**Sprint 15 commit (gated on owner approval):** ENH-134a — Option C (schema unification, port lesson packs to canonical shape, retire `core/pack-loader.ts` per Q4-(a)). ~2 days.

**Sprint 16+ commit (gated on owner Q1-Q4 answers + Sprint 15 success):** ENH-134b — Step 2 (build a `duo-default` distro pack; refactor install-service to consume it; preserve hand-rolled plumbing per Q2 answer). ~3–5 days.

**Cross-refs.** Stage 18 ([docs/prd/stage-18b-distro-packs.md](docs/prd/stage-18b-distro-packs.md)), Stage 21d ([docs/prd/stage-21d-distro-packs.md](docs/prd/stage-21d-distro-packs.md)), Stage 28 ([docs/prd/stage-28-lesson-packs.md](docs/prd/stage-28-lesson-packs.md)). Pairs with FOLLOWUP-011 (cross-machine substrate validation — a real enterprise pack walked end-to-end).

---

### ENH-131: Tab right-click — "Open in browser" (inverse of "Edit in canvas")

**Status:** ✅ **Shipped Sprint 14 (2026-05-10).** Inverse of ENH-097's "Edit in canvas." Right-click on a canvas tab (`tab.type === 'page'`) backed by an HTML file → "Open in browser" entry. Click closes the canvas tab and re-opens the same path as a browser tab so scripts run / buttons fire (the playground modality). Mirrors the existing `onEditBrowserTabInCanvas` flow exactly: WorkingTabStrip menu builder gates on the appropriate tab kind, App.tsx-side handler does `closeFileTab(id)` then `openFileSmart(path, name, 'browser')`.

**Owner directive (verbatim 2026-05-10):** *"I think we have a pattern today to right click on a browser tab (eg playground) and edit in canvas — but i don't think we have the opposite: open/use in a browser tab—we should; AUQ if there are open design/intent decisions; otherwise just build it."*

**Implementation (no AUQ needed — clean mirror of existing pattern):**
- `WorkingTabStrip.tsx § buildTabContextMenuItems` — new `view-source` entry visibility check + `case 'open-in-browser'` handler. Gate: `tab.type === 'page' && path && /\.html?$/i.test(path)`.
- `WorkingTabStrip.tsx` component — new `onOpenInBrowser` prop threaded through.
- `WorkingPane.tsx` — new `onOpenCanvasTabInBrowser` prop threaded through.
- `App.tsx` — handler closes the file tab + calls `openFileSmart(path, name, 'browser')`.

**Why no design AUQ.** All four reasonable design questions had clean defaults:
- Naming: "Open in browser" (clean mirror of "Edit in canvas")
- Tab kinds: gate on `kind: 'page'` only — markdown editor tabs don't get this (markdown isn't a web format)
- Close behavior: close the canvas tab + reopen as browser (mirror; existing autosave catches recent edits)
- Meta tag respect: ignore the file's `<meta duo-open-in>` — the user explicitly asked for browser via right-click; honor that

**Cross-refs.** ENH-097 (the inverse direction). Pairs with ENH-130 (`--reveal` flag) — both are "make sure the user sees this artifact" capabilities.

---

### ENH-130: Agent-built-artifact auto-reveal + default playground chrome

**Status:** 🆕 Filed 2026-05-10 from owner directive (Sprint 14 expansion).
**Priority:** **High** — workflow-defining. When the agent says "I made you X", the user shouldn't have to hunt for it.
**Filed:** 2026-05-10.

**Owner directive (verbatim):** *"when user says 'make me a playground/html file/markdown doc that does x', even if canvas pane is collapsed, default behavior should be for duo, when complete, to expand the canvas, open the work product in the main pane (browser tab if playground) and bring focus to it. By default, playgrounds should include a 'send to Claude' and copy results/output button. Pull in work to enable this and encode the behavior."*

**Two parts:**

**Part A — Agent reveal verb / flag.** When the agent creates an artifact for the user (via `duo edit` for markdown, `duo open` for HTML/playground, `duo edit --canvas` for HTML in canvas mode), Duo should:

1. Check if the working pane is collapsed (terminal at full width / `splitPct >= 75`). If yes, expand it (e.g. `duo split even` → 50).
2. Open the file in the main pane (existing `duo edit` / `duo open` behavior).
3. Focus the pane (existing `duo focus-pane main`).

**Implementation (chosen): new `--reveal` flag on `duo edit` and `duo open`.** Back-compat (default false). Skill mandates `--reveal` when creating artifacts for the user. Server-side: a `revealAfterAction` helper in main.ts that runs the layout check + setSplit + focusPane sequence when the flag is present.

**Part B — Playground default chrome.** Every new playground (HTML file with `<meta name="duo-open-in" content="browser">`) created via `duo html new --playground` (or scaffolded by the agent following make-playground.md) defaults to including:

- **"Send to Claude" button** — uses `data-duo-action="terminal:send"` to push selected text / output / a default payload back to the agent.
- **"Copy output" button** — uses `navigator.clipboard.writeText` (or the worksheet primitive's pattern) to hand the user a structured payload they can paste back to the agent.

**Implementation (chosen): update `skill/make-playground.md` + canvas templates** to require both buttons in the boilerplate. Update `skill/examples/canvas-templates/playground.html` (or equivalent) to include the chrome.

**Cross-refs.** ENH-122 (`duo dom`) + ENH-124 (`duo layout`) — used by the agent to inspect state before/after `--reveal`. ENH-098 (`duo focus-pane`) — the focus mechanism. ENH-014 (`duo split`) — the expand mechanism.

---

### ENH-129: Accept PDFs on paste / drop — insert as a link to the saved file

**Status:** ✅ **Shipped Sprint 14 walk-3 prep (2026-05-10).** Walk-1 baseline shipped MIME-based PDF detection + saveImageBeside with prefix='pdf'. Walk-2 surfaced two issues: (a) PDF paste worked but the on-disk filename was `pdf-<stamp>-<hash>.pdf` losing the original — fixed walk-2 with `<safe-original-base>-<stamp>-<hash>.pdf` (markdown link label uses original filename verbatim); (b) PDF drag-drop appended to END of doc instead of at the drop point. Walk-3 fix: extracted drop coordinates via ProseMirror's `view.posAtCoords({left: event.clientX, top: event.clientY})` and threaded the resulting position into `handleAssetPaste` as a new `insertPos` param; the insert chain uses `editor.chain().focus(insertPos ?? undefined)` to set caret at the drop point before insertion. Copy-paste path unchanged (passes null insertPos; clipboard inserts naturally at active selection). Same fix applies to image drops as well — net win across all three asset classes.
**Priority:** Low-medium — narrower workflow than HEIC convert, but trivial implementation.
**Filed:** 2026-05-10.

**What's wanted.** When the user pastes / drops a PDF (clipboard `application/pdf`), Duo saves the bytes alongside the active doc and inserts a markdown link `[filename.pdf](relative-path.pdf)`. Click opens externally (or in Duo's own PDF viewer if the tab kind exists). Today the paste handler only accepts `image/*` so PDFs are silently dropped.

**Implementation sketch.**
- Extend the clipboard / drag MIME filter to accept `application/pdf` alongside `image/*`.
- `files.savePdfBeside` (or generalize `saveImageBeside` to `saveAssetBeside`) writes the bytes with a generated filename (`pdf-<YYYYMMDD-HHMMSS>-<hash>.pdf`).
- Insert markdown source as `[<original-filename or generated>](relative-path.pdf)`.
- Render: stock markdown link rendering (already works).

**NOT in scope (per owner pick).** Inline `<embed>` viewer — that was rejected in favor of standard markdown semantics. Could revisit as a separate ENH if owner wants in-line PDF figures later.

**Cross-ref:** [ENH-108](tasks.md:280), [ENH-118](tasks.md:6245).

---

### ENH-127: Terminal Return-key semantic — per-Claude-tab Return = newline; ⌘Return = submit

**Status:** ✅ **v2 SHIPPED + verified live via computer-use (2026-05-10).** v1 (Sprint 13 walk-3) was a renderer-side `\n` vs `\r` byte intercept; failed because Claude Code treats both bytes identically. v2 takes a different approach: in Claude tabs only, plain Enter writes `\x1b\r` (ESC + CR — the byte sequence ⌥Enter natively sends, which Claude reads as a multi-line newline in its input buffer); ⌘Enter writes `\r` (Claude's submit byte). Shell tabs pass through unchanged.

**Two earlier walk-3-prep attempts both failed before the v3 fix landed:**

1. **First attempt (wrong byte):** Wrote `\n` on plain Enter, mirroring v1. Claude submitted (same root cause as v1 — `\n` and `\r` identical to Claude's input loop).
2. **Second attempt (right byte, wrong event scope):** Switched to `\x1b\r` on plain Enter, but filtered the `attachCustomKeyEventHandler` to `e.type === 'keydown'` only. xterm's KeyDown processing also triggers a `keypress` dispatch which the custom handler also receives — by returning `true` for non-keydown events, I let xterm's default Enter handler fire on keypress and write `\r` via `onData` AFTER my pty.write of `\x1b\r`. Net result: Claude received `\x1b\r\r` and submitted on the trailing `\r`. Diagnosed via temporary `term.onData` debug logging.
3. **v3 fix (working):** Return `false` for ALL event types (keydown, keypress, keyup) on the intercept condition; only WRITE the byte on keydown so we don't fire 3× per keystroke. xterm's default `\r` write is now suppressed. Verified live: typed `line one` + plain Enter + `line two` + ⌘Enter — Claude received both lines as one prompt, named the conversation "Work on multi-...".

**Discovery enabling Path 3b:** Claude Code natively accepts ⌥Enter (Option+Return) as a multi-line newline in its input buffer. ⌥Enter sends `\x1b\r` (ESC + CR) on macOS — found by adding a temporary `term.onData` debug log and pressing ⌥Enter in a shell tab. Writing the SAME bytes from a custom intercept on plain Enter gives users the multi-line UX without making them remember the ⌥ modifier.

**Owner directive (2026-05-10, walk-2 OTHER NOTES):** *"what ever happened to the `in claude session in terminal, enter >> line break` intent? this was never shipped/does not work and you appear to have just dropped it."*

**Owner Path 3b pick (2026-05-10 plan-mode AUQ):** *"⌘Enter to submit; plain Enter ALWAYS = newline (no timing)"* — predictable, no heuristic latency. Trade-off accepted: every Claude prompt requires ⌘Enter to submit; plain Enter only inserts a newline.

**v1 historical context (kept for the record):** Pre-v1 was implemented + reverted same day after live-test confirmed Claude Code's input loop treats `\n` and `\r` identically at the line-discipline level. The Duo-side intercept fired correctly at the renderer (verified via TerminalPane's `attachCustomKeyEventHandler` — wrote `\n` to the PTY on plain Enter), but Claude Code received `\n` and submitted the prompt the same as it would for `\r`. No way for Duo alone to differentiate Enter-as-newline from Enter-as-submit by byte alone without Claude Code itself honoring the distinction. v2 sidesteps this by NOT writing any submit-triggering byte on plain Enter — the user sees a newline; nothing submits.

**What this means.** A renderer-side keystroke intercept can't deliver the desired UX. The accidental-submit problem is real, but solving it requires one of:

1. **Claude Code adds a "raw newline" mode** that interprets `\n` as buffer continuation, `\r` as submit. Out of Duo's control; could file a request upstream.
2. **A confirmation gate at submit time** — Duo intercepts the byte BEFORE writing to the PTY, surfaces a tiny inline confirm ("Submit to Claude?"), proceeds only on user-confirm. Adds friction to every prompt; wrong shape.
3. **Slack-style anti-accidental-submit** — submit only when the user has paused typing for ≥ N ms AND pressed Enter, OR an explicit ⌘+Enter chord. Soft heuristic; still requires a layer above xterm to inspect input cadence.
4. **Composer-window pattern** — separate Duo chrome (text area outside the terminal) where the user composes multi-line prompts; ⌘+Enter (or button click) sends the buffered text to the PTY as one shot. Bigger refactor; doesn't reuse Claude's TUI input box.

**Priority:** Medium-low (declined v1 — owner can re-prioritize once one of the above paths becomes attractive). The accidental-submit problem remains; the v1 fix doesn't work; future work should pick from the four shapes above based on owner intent.

**Code state.** TerminalPane.tsx's `attachCustomKeyEventHandler` is back to the pre-ENH-127 shape (just `matchGlobalShortcut` gate, no Enter-key special case). Comment block in the same file documents the failed-live-test outcome so the next attempt doesn't re-walk this path without reading prior context.

**Filed:** 2026-05-09. **Implemented + reverted:** same day. Owner verbally OK'd the per-Claude-tab approach pre-implementation; live-test result invalidates the design.

**What's wanted (verbatim).** *"ENH: Can we override the return key in terminal to avoid accidentally initiating a command, and instead require cmd-return? return just works as a line break. I don't want to do anything super janky to accomplish this — you can tell me if this is risky."*

**The risk profile (the "tell me if it's risky" answer).** This is meaningfully risky for the kind of terminal Duo runs.

The terminal is xterm.js connected to a real PTY (per [PtyManager](electron/pty-manager.ts)) running the user's shell (zsh today, but Claude Code, REPLs, Vim, less, ssh, sudo, htop — anything that takes input). Return = `\r` (CR) at the byte-stream level. The shell's line-discipline interprets CR as "submit the current line" and the agent / sub-process ALSO interprets CR for its own input (Claude Code's prompt, a Python REPL, less's "next line", Vim's command-mode-execute, etc.). Re-mapping Return → "insert a literal newline character" only without submitting would mean:

- **Shell prompts** become hostile. zsh expects CR to submit. Holding the user's Return-press = newline-not-submit changes how every command runs. Multi-line shell input (`for i in ...; do` block) already uses CR for line-continuation when the shell knows the syntax is incomplete; the user typing `ls` then expecting "newline-not-execute" then ⌘+Return-to-execute is a fundamentally different shell contract.
- **Agents like Claude Code, REPLs, less, Vim, sudo password prompts** all read raw line discipline. Some treat CR as "submit," some treat it as "newline." If we intercept CR and translate to LF (\n) only, every program becomes inconsistent with the user's expectation outside Duo.
- **ssh sessions** would break worst — the remote side's terminal handler doesn't know about Duo's intercept; the user's local Return-press might never reach the remote.
- **Bracketed-paste mode** complicates: when bracketed paste is on, multi-line paste already ships as a single block ending with one CR. Our intercept logic would have to distinguish "user typed Return" from "paste ended."

**What COULD be done less-risky:**

1. **xterm.js-side multi-line input mode** — treat Return as `\n` (LF) ONLY when the user has explicitly toggled a "multi-line mode" via a chord or chrome button. Default = today's behavior (CR submits). Useful for "I want to paste / type a multi-line Claude prompt without auto-submit between paragraphs." Requires a visible affordance so users know their Return key just changed semantics.
2. **Shift+Return vs Return** — many terminal apps (modern Slack, Discord, ChatGPT web) use Shift+Return = newline, plain Return = submit. If the goal is "I want a way to insert a newline mid-prompt to Claude without submitting," ⇧Return is closer to user expectations than ⌘Return. But xterm.js still needs to know to send `\n` only on ⇧Return — application-side shell still needs to handle multi-line input correctly.
3. **Per-app gate** — only intercept Return in Claude Code tabs (kind === 'claude'); leave shell tabs alone. xterm.js doesn't know what's running in the PTY though, so this requires the renderer to track tab kind + pass through claude tabs differently. Doable but adds per-tab keybinding state.

**Recommendation.** Don't do the universal Return → newline override. The shell/REPL/agent contract is too fragile. If the actual workflow problem is "I want to insert a newline mid-Claude-prompt," option (2) or (3) — Shift+Return in Claude tabs only — is much safer and matches existing chat-app conventions. Owner confirm direction before any code work.

**Cross-ref:** BUG-094 (terminal paste with trailing newline auto-executes — same family of "Return-as-execute" friction; fixed by stripping trailing newlines from clipboard pastes only). [TerminalPane.tsx](renderer/components/TerminalPane.tsx) is where the keystroke intercept would live. Stage 19c (claude vs shell tab kind) — the per-tab gate would key on `TabSession.kind`.

---

### ENH-117: Markdown / HTML "view source" — inspect raw markdown / HTML for the active doc

**Status:** ✅ **Shipped v0.6.12 (Sprint 14, 2026-05-09).** v1 modal closed by FOLLOWUP-015's v2 panel-fill — read-only source view now replaces the editor's prose area / canvas iframe in-place (same dimensions, same column). Triggers: ⌘⌥V chord (owned by globalShortcuts.ts; WCV-forward path stays working), View → View source menu (no accelerator on the menu so it doesn't conflict with the chord), tab strip right-click → View source (with display-only `⌘⌥V` accelerator label for muscle-memory training). Toggle UX: same chord toggles the panel in/out; Done button or Esc dismisses. Source content is a snapshot at open time — for markdown, `editor.storage.markdown.getMarkdown()` + frontmatter; for canvas, `canvasRef.current.serialize()` (the same pretty-printed HTML the next save would write). Editable view-source (CodeMirror integration with bidi sync) intentionally deferred — explicit owner pick on scope before any code work. Walk-3 owner direction (verbatim 2026-05-09): *"this works, but view source should occupy the full panel (ie the space where text editing normally happens), not a modal; this is a low priority to fully resolve, but view source should have a menu and tab context command to trigger -- not just rely on kb shortcut … same comments [for canvas]; works but not what I want; you should have asked more questions about the intent vs making this modal approach; not urgent to fix but this is bad."*

**v1 (shipped 2026-05-09 walk-3) — modal overlay.** `⌘⌥V` opens a centered modal overlay rendering the active surface's raw source in a monospaced block. Both [MarkdownEditor.tsx](renderer/components/editor/MarkdownEditor.tsx) (markdown body + frontmatter via `editor.storage.markdown.getMarkdown()` + `joinFrontmatter`) and [PageTab.tsx](renderer/components/Page/PageTab.tsx) (pretty-printed HTML via `canvasRef.current.serialize()`) listen for the `duo-view-source` window event dispatched by [useKeyboardShortcuts.ts](renderer/hooks/useKeyboardShortcuts.ts); each gates on `isActive`. Overlay has Copy + Close buttons; Esc / backdrop click dismisses. Atelier-styled. Capability lands; surface is wrong.

**v2 (queued — FOLLOWUP-015 below).** Per owner direction:

1. **Panel-fill, not modal.** View-source replaces the active editor / canvas content area in-place — same dimensions, same column. Toggling out returns to the live editor / canvas.
2. **Menu + tab right-click trigger** — not chord-only. View → "View source" menu item + Tab strip right-click → "View source." Chord stays as the power-user accelerator.
3. **Toggle UX, not "open + close."** Same chord toggles in/out (or a Done button in the source view).
4. **Editable view-source — defer or no?** v1 explicitly said deferred (CodeMirror integration is a much bigger surface). Owner confirms before any v2 work.

**Why this slipped.** I picked "modal overlay" as the shape because (a) it composed cleanly with the existing surface architecture (no per-tab refactor needed) and (b) it matched my mental model of "view-source" from browsers (separate window). I should have asked the owner whether the intent was "browser-style separate view" or "in-place toggle." Saved memory: ask about surface choice before implementing on display-shape decisions, especially for read/write inversions.

**Priority:** Medium for v1 (shipped). v2 panel-fill: low-medium per owner ("not urgent to fix but this is bad"). Tracked as **FOLLOWUP-015** below.

**Filed:** 2026-05-09 from owner OTHER NOTES on Sprint 12 walk-rev2. v1 shipped + walk-3 surfaced the surface miss same day.
**Priority:** Medium — paired with ENH-108's testing; without it, the user has to `cat` the file in a terminal to see what got serialized after a paste / edit.
**Filed:** 2026-05-09.

**What's wanted.** A "view source" toggle for both the markdown editor and the HTML canvas — flips between the rendered/edited view and a read-only (or read-write?) raw-source view of the underlying markdown / HTML. Owner trigger: while testing ENH-108 paste-image, no in-app way to verify what tiptap-markdown serialized to disk for the inserted `<img>` node. Today: switch to terminal, `cat <path>`.

**Open scope questions:**
- Read-only or editable raw view? Read-only is the v1 ask; editable is a much bigger lift (need a CodeMirror integration with bidi sync to TipTap).
- Surface as a tab toggle, a split (source on right), or a chord? `⌘⌥V` (view-source convention) is a reasonable chord.
- Markdown-editor side: pull from `editor.storage.markdown.getMarkdown()` (already used by save). HTML canvas: read from PageTab's iframe document and pretty-print.

**Cross-ref:** Pairs with the editor-canvas parity rule (CLAUDE.md § 4) — both surfaces ship together OR explicit asymmetry declaration.

---

### ENH-118: Image-type handling discussion — beyond PNG (esp. GIF, SVG)

**Status:** ✅ **CONVERSATION COMPLETE 2026-05-10.** Owner answers (Sprint 14 expansion AUQ):

1. **GIFs** — **animate by default** (today's behavior). Matches user expectation from web / Slack / Discord. No code change needed; document the perf caveat (giant GIFs hammer the renderer compositor) as a known limitation.
2. **SVG** — **keep `<img src="...svg">`** (today's inert rendering, scripts blocked, no external refs). Document the limitation that SVGs with embedded CSS / fonts may render slightly differently from source intent. No code change needed.
3. **HEIC / RAW** — **convert to PNG / JPEG via Electron's nativeImage**. Filed as **ENH-128** below (~half-day). macOS Photos.app drag-drop is the workflow this enables.
4. **PDF** (clipboard `application/pdf` on paste / drop) — **accept + insert as a link** (`[filename.pdf](path)`) rather than `<embed>`. Standard markdown; click opens externally. Filed as **ENH-129** below (~small).

Two picks (1, 2) ship as documentation only — known limitations live in [skill/SKILL.md § image handling](skill/SKILL.md) (and the FAQ once a question lands). Two picks (3, 4) generate new tracked items below; landed in Sprint 14 if scope allows, else Sprint 15.

**Priority:** Medium — owner ask: "after you fix PNG, discuss with owner how to handle other image types, esp GIF and SVG."
**Filed:** 2026-05-09. **Conversation complete:** 2026-05-10.

**What's wanted.** ENH-108 v1 handles all common image types via the same path (clipboard → save → insert with `<img>`). The `MIME_TO_EXT` map in [MarkdownEditor.tsx](renderer/components/editor/MarkdownEditor.tsx) covers PNG / JPEG / GIF / WEBP / SVG / BMP / TIFF, and the duo-asset:// protocol handler returns the right MIME for each (so SVG renders as SVG, GIF animates, etc.). But there are open product / safety questions per type:

**Per-type considerations:**
- **PNG / JPEG / WEBP** — straightforward. Bytes saved as-is, `<img>` displays. No special concerns.
- **GIF** — animates by default in `<img>`. Owner question: should there be a "freeze first-frame" toggle (Slack-style) or is animate-by-default fine? Performance concern: a giant GIF can hammer the renderer.
- **SVG** — `<img src="...svg">` renders the SVG inert (no script execution, no external refs). That's the safe default. But: SVG with embedded CSS / fonts may render differently than the source intends. Also: pasting SVG markup as TEXT (rather than a clipboard image) currently inserts as raw `<svg>...` markup which TipTap may strip — separate code path worth confirming.
- **HEIC / RAW** — not in the MIME map. Unlikely to come from clipboard but possible from drag-drop. Falls through to .png in the current code (wrong extension) — should reject or convert.
- **PDF as "image"** — pasted PDFs from some apps come through as `application/pdf` clipboard items. Currently filtered out (only `image/*` MIMEs). Owner confirms whether to add a `<embed>` insert path for PDFs.

**Recommendation for next conversation:**
1. Animate vs. freeze GIFs — owner pick.
2. SVG safety review — current `<img>` embed is safe; document the limitation that scripts in SVG are blocked.
3. HEIC / RAW — out-of-scope for v1; reject with a console warn.
4. PDF — separate ENH if owner wants in-line PDF embeds.

**Cross-ref:** [ENH-108](tasks.md:276), the underlying paste-image feature.

---

### FOLLOWUP-015: ENH-117 v2 — view-source as panel-fill, not modal; menu + tab-context entries

**Status:** ✅ **Shipped v0.6.12 (Sprint 14, 2026-05-09).** Owner picked **read-only panel-fill** (~half-day) over the read+write CodeMirror integration (~multi-day) on entry-gate AUQ. v2 reshape: `ViewSourceOverlay.tsx` (fixed-inset modal) replaced by `ViewSourcePanel.tsx` (flex-1 fills its container). Both [MarkdownEditor.tsx](renderer/components/editor/MarkdownEditor.tsx) and [PageTab.tsx](renderer/components/Page/PageTab.tsx) now swap the prose area / canvas iframe area for the panel when `viewSource !== null`; toggling out returns to the live editor / canvas. Toggle UX: same `'duo-view-source'` window-event funnel; chord with the panel already open closes it (returns the previous content). Three triggers all funnel into the same window event:

1. **⌘⌥V chord** — owned by globalShortcuts.ts (WCV-forward path stays working). Unchanged from v1.
2. **View → View source menu** — new menu entry in `electron/main.ts § View submenu`, no accelerator on the menu (avoids conflict with globalShortcuts ownership). Click sends `IPC.VIEW_SOURCE_REQUEST` (new channel); App.tsx listener re-dispatches the window event.
3. **Tab strip right-click → View source** — new entry in `WorkingTabStrip.tsx § buildTabContextMenuItems`, gated on `tab.type === 'editor' || 'page'` (browser tabs use DevTools). Display-only `CmdOrCtrl+Alt+V` accelerator label for muscle-memory training (right-click context menu accelerators don't bind globally). Right-click activates the tab first via `onSelect(tab.id)` then `setTimeout(0)`-defers the dispatch so the listener's `isActiveRef` reflects the activated tab.

End-to-end verified via ENH-122 (sister sprint feature): opened a markdown file, dispatched the event, confirmed `[role=region][aria-label^=Source]` mounts; toggled twice, confirmed off→on→off; clicked Done, confirmed close; opened a canvas surface, repeated. Header reads `Source · <filename>`; source body matches the editor's serialization. All 356 vitest tests still green; typecheck clean.

Code-side delete path: `ViewSourceOverlay.tsx` removed entirely (no need for a fallback — panel-fill works on every surface).

**Priority:** Low-medium per owner direction (*"not urgent to fix but this is bad"*).
**Filed:** 2026-05-09. **Shipped:** 2026-05-09.

**What's wanted (per owner walk-3 verbatim):**

1. **Panel-fill, not modal.** View-source replaces the active editor / canvas content area in-place — same dimensions, same column. Toggling out returns to the live editor / canvas. Mental model: VS Code's "View Source" command.
2. **Menu + tab-context entries** — not chord-only. View → "View source" menu item + Tab strip right-click → "View source." Chord stays as the power-user accelerator.
3. **Toggle UX, not "open + close."** Same chord toggles in/out (or a Done button in the source view).

**Open scope question for owner.** Editable view-source (live two-way sync between source-view and rendered-view) would require CodeMirror integration with bidi sync to TipTap — a substantially bigger surface (multi-day work, not a half-day polish). Confirm whether v2 is read-only-panel-fill (~half-day) or read+write panel-fill (~multi-day) before code work.

**Implementation sketch (read-only v2):**

- New per-tab state `viewSourceActive: boolean` on MarkdownEditor + PageTab.
- When true: render the source `<pre>` block in the same content area where `<EditorContent>` / `<RenderedPage>` would normally render.
- Toolbar gets a "Done" / "Edit" button to toggle back.
- View menu: "View source" (toggle, gated on active surface being editor or canvas).
- Tab right-click menu: "View source" entry.
- Chord ⌘⌥V remains; toggles instead of opening modal.

**Code-side delete path.** The v1 modal in `renderer/components/ViewSourceOverlay.tsx` becomes either (a) deleted if v2 replaces it entirely, or (b) kept as a fallback for surfaces where panel-fill is awkward (e.g. browser-pane "view page source" if that ever surfaces).

**Cross-ref:** ENH-117 (parent).

---

### FOLLOWUP-014: ENH-108 paste-image inserts ABSOLUTE duo-asset:// URLs in markdown source (non-portable)

**Status:** ✅ Shipped v0.6.11 (Sprint 13, 2026-05-09 — walk-2 close-out). Markdown source NOW carries relative filenames (`![](image-<stamp>-<hash>.png)`); on render, [DuoImage NodeView](renderer/components/editor/extensions/DuoImage.ts) resolves against the doc's parent dir via `files.read` and hydrates a per-tab blob URL into the rendered `<img>` element. Canvas surface mirrored via [imageHydrate.ts](renderer/components/Page/imageHydrate.ts) (MutationObserver pattern) + serializer hook in [serialize.ts](renderer/components/Page/serialize.ts) that swaps `src` ↔ `data-duo-original-src` at save time so HTML stays portable. 4 vitest fixtures green for the serializer swap.

**Walk-2 fix (2026-05-09).** Owner walk-1 reported canvas FAIL — paste / CLI insert produced no on-disk change. Diagnosis traced to [PageTab.tsx](renderer/components/Page/PageTab.tsx)'s `lastSavedRef` re-baseline path: RenderedPage's wire effect has deps `[onChange, onShortcut, onReady, readOnly]`. `handleShortcut` re-creates whenever `save` does, which re-creates whenever `dirty` flips. So inserting any content via execCommand (paste OR CLI verb path) caused: setDirty(true) → save callback re-creates → handleShortcut re-creates → wire effect re-fires → handleReady re-runs → re-baseline captured the POST-insert DOM as `lastSavedRef`. Subsequent save() saw `htmlChanged === false` and skipped the write — silent data loss. Fix: gate the re-baseline behind a `baselinedRef` flag so it only fires the FIRST time handleReady runs per path-mount; reset on path change. Verified end-to-end: `duo edit --canvas /tmp/foo.html` + `duo image insert <png>` now writes `<img src="image-<stamp>.png">` to the canvas's HTML source (via PageTab's autosave path), file survives reload + portable across machines.

**Walk-2 sibling race fixes (same session):** PageTab + MarkdownEditor's `onImageInsert` IPC subscriptions previously race-responded — every mounted instance subscribed; first reply won; image landed in the wrong file when multiple tabs were open. Walk-1 silently passed the markdown side because no other markdown editor was open at smoke-walk time; walk-2 surfaced the canvas-side race because session-restored canvases were active. Fix: thread `isActive` prop through [WorkingPane § renderFileTab](renderer/components/WorkingPane.tsx) and gate the IPC handlers via a ref-mirrored `isActive` check (same pattern as the existing `focused` gate but specifically for IPC routing rather than focus-stealing).

Backward-compat: legacy v0.6.10 docs with `<img src="blob:...">` continue to render the same way (broken on reload — same as before; v2 doesn't migrate them).
**Priority:** Medium — markdown content is non-portable across machines (links break when the doc + images are copied to a different filesystem path or different user). Acceptable for v1; owner trigger to escalate.
**Filed:** 2026-05-09.

**What's broken.** [ENH-108 v1](renderer/components/editor/MarkdownEditor.tsx) inserts pasted images as `![](duo-asset://local/abs/path/image-...png)` — absolute path under a custom protocol. Saves to disk fine, renders inline fine (after rev3 protocol fix). But the markdown source is NOT portable:
- Move the doc to a different folder → link breaks (abs path no longer matches).
- Sync the doc to a different machine → link breaks (different home dir, different absolute layout).
- Share the doc + image folder as a zip → link STILL breaks unless the recipient places them at the same abs path.

**What v1 SHOULD have done (and v2 needs to fix).** Markdown source contains the RELATIVE path (`![](image-stamp-hash.png)`). Custom TipTap Image extension's `renderHTML` resolves the relative src against the active doc's directory and rewrites to `duo-asset://local<absParent>/<filename>` at render time. tiptap-markdown serializes the original `src` attribute (the relative form), so save / round-trip stays portable. The runtime resolution makes it render correctly in the editor.

**Why v1 didn't do this.** Time pressure during Sprint 12 walk-rev3. The relative-rendering Image extension is ~30-50 lines of TipTap extension code (override `addAttributes` to store both `src` and `resolvedSrc`, override `renderHTML` to use `resolvedSrc`); shipping the absolute form unblocked the user immediately. v2 polish.

**v2 plan:**
1. New `DuoImage` extension (`renderer/components/editor/extensions/DuoImage.ts`) extending `@tiptap/extension-image`.
2. `addOptions()` adds a `getDocPath: () => string | null` callback.
3. `renderHTML(node)` resolves `node.attrs.src` — if it's relative, prepend `duo-asset://local${dirname(getDocPath())}/`; if absolute (file:// or duo-asset://), use as-is.
4. `parseHTML` reads back the `src` attribute as-given (no resolution).
5. Replace stock `Image` import in [MarkdownEditor.tsx](renderer/components/editor/MarkdownEditor.tsx).
6. Update handlePaste/handleDrop to insert with `result.relPath` again.

**Cross-ref:** [ENH-108](tasks.md:276), [BUG-111](tasks.md:somewhere-below).

---

### BUG-112: `duo doc read` (no path) returns wrong editor's content when multiple markdown editors are open

**Status:** ✅ Shipped v0.6.11 (Sprint 13 walk-2, 2026-05-09). Renderer's `onDocRead` handler in [MarkdownEditor.tsx](renderer/components/editor/MarkdownEditor.tsx) now gates on `isActive` when `req.path` is absent — only the visible editor responds. Pre-fix every mounted MarkdownEditor responded to the IPC; first reply won; `duo doc read` returned an arbitrary tab's content (often whichever was opened first this session). Fix uses the same `isActive` prop threading + ref-mirror pattern as ENH-125's image-insert race fix (one prop, threaded from WorkingPane § renderFileTab, gates both handlers). With `req.path` supplied, the existing path-filter routes to the right editor — no change there. Verified live: opened `/tmp/bug112-test.md` after several other markdown tabs were active; `duo doc read` returned the new file's content immediately. **Priority:** **High** — silent data return mismatch breaks any agent flow that does "open a file with `duo edit`, then `duo doc read` to confirm" or "iteratively `duo doc read` while watching". **Filed:** 2026-05-09 (surfaced during BUG-101-V2 walk-2 — owner reported the wrong content for step 3).

**Symptom (pre-fix).** With multiple markdown tabs open (typical via session restore), `duo doc read` (no path argument) returned content from a non-active editor. Reproducible by: open file A → open file B → `duo doc read` returns content for whichever editor's IPC subscription happened to fire first in the renderer (often A, the older tab, because subscription order tracks mount order under React's effect resolution).

**Root cause.** `onDocRead`'s default behavior (when `req.path === undefined`) was "any editor can respond." Multiple editors all responded; main.ts's `docReadPending` Map resolves the IPC promise on FIRST reply — so the first responder wins. Same race shape as ENH-125's `image-insert` race (and the canvas's `html-op` race, filed for follow-up — different code path, same pattern).

**Fix.** Renderer-side gate on `isActive`. The IPC handler returns silently when `!req.path && !isActive` — inactive editors never reply. Only the active editor's reply reaches main → CLI. With `req.path` set, the existing path-filter handles routing (each editor either matches and responds, or returns an error reply that loses the race to the matching editor's success reply — current behavior preserved).

**Cross-ref:** ENH-125 (sibling race fix); FOLLOWUP-014 walk-2 (same `isActive` prop plumbing in PageTab + MarkdownEditor); the canvas `html-op` race (separate but same pattern — filed for follow-up if it bites).

---

### BUG-111: Sprint 12 shipped ENH-111 (image VIEWER chrome) instead of ENH-108 (paste-image), the actually-asked-for feature

**Status:** ✅ **CLOSED 2026-05-09** — both features now ship in Sprint 12. ENH-108 paste-image landed mid-sprint after the wrong-feature catch (markdown editor + canvas + CLI verb `duo image insert`). ENH-111 image viewer chrome remains as a useful sibling feature; both items in the v0.6.10 cut. Owner directive's "image handling" ambiguity resolved by shipping both.
**Original status:** 🟡 Open — ENH-111 (the wrong feature) is in main as of 20798ac. ENH-108 (the right feature) was never started. Owner directive misread by the prior cloud agent.
**Priority:** **High** — owner explicitly flagged, mid-Sprint-12 review: *"shipped broken feature I did not ask for, not the one I did."*
**Filed:** 2026-05-09 by local Claude during Sprint 12 close-out.

**What was asked for.** [ENH-108: Paste-image handling — markdown editor + HTML canvas](tasks.md:276) — owner-directed P0 for Sprint 9, filed 2026-05-08 from idle-thoughts sweep. Spec: `⌘V` (or drag-drop) an image into either editor surface → Duo saves to active file's parent dir (`image-<YYYYMMDD-HHMMSS>-<hash>.<ext>`) + inserts the link inline (`![](path)` markdown / `<img>` canvas). Closes a workflow-defining gap: today = save-to-Desktop → drag-to-Finder → markdown-link-by-hand. Mirror requirement per editor-canvas parity rule.

**What got shipped.** [ENH-111: image viewer v2 chrome](renderer/components/ImageView.tsx) — toolbar with zoom/pan/copy/dimensions readout for the image-VIEWER tab type. Promoted from Sprint 13 by the cloud agent. Different feature, different surface (viewer vs editor), different user benefit.

**How the misread happened.** Active-sprint.md captured the owner directive verbatim — *"address image handling (should be in the roadmap now)"*. ENH-108 had been filed as P0 the same day (2026-05-08) per the idle-thoughts sweep — that's the only "image handling" item with active P0 status. The cloud agent went sprint-13's image VIEWER work instead, presumably anchored on the literal token "image" in the most-recently-touched roadmap item.

**Owner's "broken" complaint.** Owner reported ENH-111 is broken in addition to being the wrong feature. Specific failure modes not yet identified by the local agent — needs a walk of the image viewer to confirm (toolbar buttons fire? files.stat IPC wired? clipboard.writeImage works? context menu items execute? wheel-zoom + drag-pan?). Pre-existing ENH-111 walk items in the smoke-walk manifest cover the basics; need to actually exercise them.

**Recovery options (NOT executed — owner picks):**

1. **Revert ENH-111 + ship ENH-108 this sprint, re-cut.** Most destructive but cleanest narrative — Sprint 12 actually does what owner asked. The 20798ac commit batched ENH-111 with ENH-115 (terminal-tab Reveal in navigator); a clean revert needs to preserve ENH-115. Manual cherry-revert: `git restore --source=461b63f^ -- renderer/components/ImageView.tsx renderer/components/FileRenderers.tsx renderer/components/WorkingPane.tsx electron/files-service.ts electron/main.ts electron/preload.ts shared/host-api.ts shared/types.ts`, then re-introduce only the ENH-115 deltas in TabBar.tsx + App.tsx (already in main).
2. **Keep ENH-111 (it works, just isn't what was asked) + ship ENH-108 next sprint with explicit P0 slot.** Least destructive. Sprint 12 cut goes out as-is; ENH-108 leads Sprint 13.
3. **Keep ENH-111 + ship ENH-108 this sprint, both.** Delays the cut by ~1d (ENH-108 spec covers ~10 sub-steps + CLI parity). Sprint 12 grows from 3 commits to 4-5.
4. **Fix ENH-111's bugs first**, then decide on (1)/(2)/(3) — rules out option (1) if the bugs are minor (since the code is salvageable).

**Recommendation:** owner picks. Local agent's lean (without seeing what's broken about ENH-111): **(2)** — Sprint 12 ships as-is plus a release-note line acknowledging "image viewer chrome landed; paste-image (the actual ask) is Sprint 13 P0." Trades narrative cleanness for ship velocity. Inverts to **(1)** if ENH-111 is broken in a way that wastes user time (e.g. crashes the renderer or the toolbar buttons no-op).

**Cross-ref:** [ENH-108 (the actual ask)](tasks.md:276), [ENH-111 (what shipped)](tasks.md:5840), [active-sprint.md](docs/dev/active-sprint.md), idle-thoughts.md "Image handling" entry → ENH-108 sub-bullet.

---

### ENH-116: Trim `.claude/skills/smoke-walk/SKILL.md` — verbosity will get truncated at runtime

**Status:** ✅ Shipped v0.6.11 (Sprint 13, 2026-05-09). SKILL.md trimmed from 604 lines → 241 lines (60% reduction). Detail moved to four companion reference docs at `.claude/skills/smoke-walk/references/`: `restart-and-preflight.md` (dev-process rules + violation history + socket-cleanup gotcha), `clean-state-checks.md` (pre-handoff verification + error-overlay catalog), `result-format-and-parsing.md` (exact result-block shape + per-status actions), `manifest-authoring.md` (writing patterns + regression-coverage drop-rule + backtick-Copy convention). SKILL.md now keeps the active-verb procedure in-context with one-line refs to the detail docs. No content lost.
**Priority:** **High** — runtime skill truncation means HARD RULES at the bottom of the file (e.g. § 5b checks 3-6, § 7 result-parsing) silently drop out of Claude's working context. Skill becomes advisory not authoritative.
**Filed:** 2026-05-09 (Geoff, after Sprint 12 walk-1 broken-page incident).

**Symptom.** SKILL.md is **603 lines** as of 2026-05-09. Claude's skill-loading budget cuts long skills; rules near the end of the file get truncated. The smoke-walk skill encodes critical procedures (§ 4 dev-process probe + warn-then-ask, § 5b error-overlay scan + worksheet-primitive exercise, § 7 result parsing, § Manifest authoring tips backtick conventions) that all need to be in-context for the agent to execute correctly. Pre-trim the file is too long to reliably load.

**What needs to happen.**
1. **Audit which sections are read-only-once-then-cite-forever** (e.g. detailed result-format spec, manifest authoring tips, error-overlay catalog) and move them to `.claude/skills/smoke-walk/references/<topic>.md` files. Keep only the procedure-active-verbs in SKILL.md proper.
2. **Collapse all the violation callouts** ("Violated 2026-05-04…", "Violated 2026-05-08…") into a single "incidents that motivated each rule" reference sub-doc. The narrative provenance is valuable for understanding WHY but isn't load-on-demand-needed for executing the skill.
3. **Tighten redundant prose** — every blockquote-callout duplicates the rule above it in different words. Pick the shortest formulation; cut the others.
4. **Tighten Step 4 hard-rule on warn-then-ask** — currently in a blockquote that visually de-emphasizes (the format does the opposite of what's intended); promote to numbered step inside the procedure body.
5. **Fold (a) worksheet-primitive verification (landed 2026-05-09 as § 5b step 3) into the trim pass** so it doesn't bloat the file further.

**Cross-ref:** Same audit applies to `.claude/skills/duo/SKILL.md` (ships globally to every machine running Duo's agent stack); should be an audit pass across `.claude/skills/*/SKILL.md` to keep all skills under a runtime-safe ceiling.

**Open questions.**
- What IS the runtime truncation threshold? Probably depends on harness (Claude Code vs other surfaces) and total context loaded. Empirical answer: if a smoke-walk hard-rule from the bottom of the file fails to fire, it's truncated. Hard to test deterministically.
- Should the trim be one PR per skill, or a sweep PR across all? Probably per-skill — easier review.

---

### BUG-110: smoke-walk localStorage key collides across walks of the same version

**Status:** ✅ **Shipped 2026-05-09 (Sprint 12 close-out).** Patched `.claude/skills/smoke-walk/generate.mjs` to derive the worksheet `name` from the manifest filename (`basename(manifestPath, '.json')`) instead of the bare version. Sprint 12 walk now keys at `worksheet:smoke-walk-v0.6.10-sprint12` instead of `worksheet:smoke-walk-v0.6.10`.
**Priority:** **High** — every smoke walk pre-fix was at risk; happened to bite Sprint 12 because Sprint 11's wikilink walk ran against the same v0.6.10 base.
**Filed:** 2026-05-09.

**Symptom (owner-side, Sprint 12 walk-1).** Owner reported "the copy button for the smoke walk did not work and that my edits were lost because local storage was broken." Page rendered (3 items, footer shows "3 to go"), script bound (tally() ran), but radio-toggle + notes edits appeared to vanish, and the Copy results button felt unresponsive.

**Root cause.** `.claude/skills/smoke-walk/generate.mjs` set `name: \`smoke-walk-v\${version}\`` — the worksheet primitive uses that as `STORAGE_KEY = 'worksheet:' + NAME`. Sprint 11's wikilink walk-3 manifest also declared `version: "0.6.10"` (post-bump for Sprint 12 work), so its results saved to `worksheet:smoke-walk-v0.6.10`. When Sprint 12's page loaded, `applyState()` read that prior state, found item IDs (`WIKILINK-AUTOCOMPLETE-V3`, `AT-MENTION-V3`, etc.) that didn't match the Sprint 12 items (`BUG-108`, `ENH-111`, `ENH-115`) — silently ignored everything. Owner's fresh edits then wrote into the same colliding key on top of the wikilink ghosts; on any reload `applyState()` couldn't reconcile.

**Why "Copy didn't work" too.** Copy itself worked (`navigator.clipboard.writeText` succeeds in the `file://` HTML page's secure context — verified). But owner had lost confidence in the page after the apparent edit-loss; "didn't work" was downstream confusion, not a separate bug.

**Fix.** [.claude/skills/smoke-walk/generate.mjs:24-50](.claude/skills/smoke-walk/generate.mjs:24): added `walkSlug = basename(manifestPath, '.json')` and changed `name: \`smoke-walk-v\${version}\`` → `name: \`smoke-walk-\${walkSlug}\``. Verified end-to-end (radio toggle → save → reload → restore round-trip + Copy button → clipboard) before re-handing off the Sprint 12 walk.

**Cross-ref / lessons:**
1. The worksheet primitive's docs already said `name: "v0.6.4-walk-1"` — unique-per-walk was the documented contract. The smoke-walk wrapper drifted from it. Add a smoke-walk SKILL.md note + the worksheet generate.mjs validator could check for a collision against existing localStorage keys, but that requires reading from the page context which the build step can't.
2. Pre-flight verification of the smoke walk page should include "set/get a localStorage round-trip with the worksheet key" — not just "duo doctor + nav-state + first-step exercise" per CLAUDE.md § 7c. Worth adding to the smoke-walk skill's pre-handoff checklist.

---

### BUG-109: ⌘T new browser tab — caret not in URL bar (regression, surfaced 2026-05-07 walk-1)

**Status:** ✅ **Shipped Sprint 9 (2026-05-07).** Walk-3 user-verified PASS. Walk-1 fix landed `window.electron.keyboard.reclaimFocus()` BEFORE the rAF chain in newBrowserTab — pulls OS focus from the WCV to the renderer so by the time the URL input's `.focus()` fires, the renderer owns OS focus and the caret renders blue/active. Owner walk-3: "[PASS]."
**Priority:** **Medium** — every fresh ⌘T forces a click into the URL bar before typing. Pre-regression behavior was that the address bar held caret immediately.
**Filed:** 2026-05-07.

**Symptom.** Press ⌘T → new browser tab opens (correct), tab strip flips to it (correct), but the address-bar input does NOT have keyboard focus. User has to click into the URL bar manually before they can type a URL.

**What looked correct on inspection.** [renderer/App.tsx § newBrowserTab handler](renderer/App.tsx) already has the focus dance: `setActiveWorking({ kind: 'browser' })` + `setFocusedColumn('working')` + `await window.electron.browser.addTab().then(() => requestAnimationFrame(...rAF...→ document.querySelector('[data-duo-addressbar]').focus().select()))`. Two nested rAFs to wait past React commit + paint. So the code intends to focus.

**Hypotheses for next sprint.**
1. **Selector mismatch** — `data-duo-addressbar` may have been renamed or removed during a recent refactor. Check that the AddressBar component still exposes the attribute.
2. **WCV occlusion** — when the new browser tab's WCV mounts, it may steal OS focus from the renderer (the .focus() on the input runs but the WCV becomes the keyboard target immediately after).
3. **Race with my Sprint 9 ENH-098 / ENH-102 changes** — none of those touched newBrowserTab directly, but the focus-pane refactor did add new focus paths. Worth checking whether `focusPane` or `pendingActivationRef` is firing on the new browser tab and stealing focus.

**Cross-ref:** Surfaced during ENH-102 walk-1 in v0.6.9 smoke. Owner-flagged "BUG: unrelated to intent but discovered regression during testing."

---

### BUG-102: Split view goes blank while ⌘⇧A tab-search palette is open

**Status:** 🟡 Open (filed during smoke walk v0.6.8-rev3, 2026-05-06). Owner: *"non urgent."*
**Priority:** **Low** — small visual annoyance. The user opens the palette over a split-view layout, the aux pane goes blank for the duration, the user picks a tab + dismisses, the aux pane returns. No data lost; just a UI flash that competes with the user's mental model of the palette as a transient overlay.
**Filed:** 2026-05-06 (Smoke walk v0.6.8-rev3 ENH-080-MULTI-PANE PASS notes — *"split view goes blank when search is active; this is a small annoyance and I want to fix in a future sprint -- non urgent"*).

**Symptom.** With split view active, press ⌘⇧A. The palette opens (correct), but the aux pane's WCV blanks instead of compositing behind the palette. When the palette dismisses, the aux pane's WCV restores.

**Root cause (educated guess from the ENH-080 walk-1 fix path).** The walk-1 fix wired `setOverlayMuted(true)` on palette-open and extended the helper to also mute the aux WCV (`tabs[auxTabId].view.setBounds({ x: 0, y: 0, width: 1, height: 1 })`). Mute = WCV shrunk to 1×1, leaving the renderer's overlay free to composite. But "blanking" the aux pane during a palette-open is too aggressive: the user can SEE the palette body anyway (the overlay is correctly above the WCV), so the aux mute isn't needed for the no-occlusion case. We mute the aux WCV but the aux PANE BACKGROUND inside the renderer still renders — the user sees the renderer's empty placeholder area where the WCV used to be.

**Fix candidates (deferred):**
1. **Don't mute the aux WCV during palette overlay** — only mute the main WCV (the one most likely to occlude). If aux ends up occluding (depends on layout), revisit case-by-case.
2. **Render a snapshot of the aux WCV behind the palette** while muted — visually preserves the layout but adds complexity.
3. **Resize the aux pane's renderer placeholder to fill the slot** — keep the aux pane visually present (just with a brief flash).

**Sprint 9 investigation (2026-05-07).** Confirmed root cause via code reading: `setOverlayMuted(true)` in [browser-manager.ts:801](electron/browser-manager.ts:801) shrinks BOTH the main WCV and the aux WCV (when present) to 1×1 to prevent WCV-over-overlay compositing. This is correct for the main WCV (palette body is centered, sits over main). It's over-aggressive for the aux WCV in typical layouts: the palette body (`max-w-2xl` ~672px, centered) sits in the screen's center; the aux pane is on the right. Backdrop (`bg-black/30 fixed inset-0`) covers everywhere but is 30% transparent — an un-muted aux WCV would composite over the backdrop, dimming aux content but keeping it visible (the desired UX). HOWEVER: in narrow-split layouts (~1280px window with 50/50 split), the palette body overlaps the aux bounds by ~200px, so the un-muted aux WCV would occlude the palette body (regression).

**Recommended fix when this gets prioritized.** Compute the palette body's runtime bounding box (renderer-side known, can be IPC'd to main) and pass it to `setOverlayMuted` as an optional argument. Mute aux only if its bounds intersect the palette body's bounds. Mute main unconditionally (palette always sits over main). Falls back to current behavior when bounds aren't passed. Estimated half-day work; needs careful smoke against varying split-view widths.

(1) is cheapest. Worth checking whether the original BUG-058 context-menu use case ALSO blanked the aux WCV — if so, this is a pre-existing behavior the palette inherited, and (1) might regress that. Defer the choice to walk + repro time.

**Naming note.** Owner asked: should the tab-search palette have a proper user-facing name beyond "⌘⇧A"? Current docs call it "tab-search palette" / "tab search". Possible: "Quick Switcher" (Obsidian/VS Code parity), "Go to Tab" (more verbose), "⌘⇧A palette" (chord-named). Defer naming decision until next user-docs pass.

**Cross-ref:** ENH-080 (the palette itself); BUG-058 (the original setOverlayMuted use case for context menus).

---

### BUG-101: `duo open` / `duo edit` sometimes return `{ok: true}` without producing a visible tab

**Status:** ✅ Sprint 9 + 10 + 13 (editor v1 2026-05-07, browser 2026-05-07, editor v2 2026-05-09 — pending walk).

**Sprint 13 v2 fix (2026-05-09).** Sprint 9's "scratchpad ref" pattern (stash activation in `pendingActivationRef` inside the setFileTabs updater, flush on the next line) was based on a wrong React semantics assumption: the updater function passed to setState DOES NOT run synchronously during dispatch — it runs at commit time. So when the post-setFileTabs `if (pendingActivationRef.current)` check ran, the updater hadn't fired yet and the ref was still `null`. setActiveWorking never got called → the new tab opened but never activated. v2 fix: replaced the ref pattern with a simpler "read latest committed `fileTabs` via `fileTabsRef`, decide activation id synchronously OUTSIDE the updater, then call setFileTabs + setActiveWorking + setFocusedColumn in the same React batch." `fileTabsRef.current = fileTabs` runs on every render. Verified live via `duo selection --pane editor` (which checks the active pane state) returning the new tab's path immediately after `duo edit`. Independent doc-read race remains (multiple MarkdownEditor instances respond to `duo doc read` without a path filter — first reply wins; filed as a separate concern).

**Sprint 10 browser-routed fix (2026-05-07):** Root cause was a payload-shape mismatch. `core/socket-server.ts § case 'open'` fired a defensive supplemental `browser:focus-gained` event (added in BUG-048 v2 to handle the "Duo not foregrounded" case where Electron's programmatic `webContents.focus()` may queue or no-op). The defensive payload was `null`, but Phase 3c BUG-095 had switched the renderer's `onBrowserFocusGained` handler to dereference `payload.slot` — so the supplemental event threw and `setActiveWorking({kind:'browser'})` never fired. The genuine `webContents.on('focus')` event from `browser-manager.ts` already sent `{tabId, slot}`, so the bug only surfaced when programmatic focus was queued (running `duo open` from iTerm or another non-Duo terminal). Two-layer fix: (1) socket-server now sends `{tabId: openedTabId, slot: 'main'}` matching the canonical contract — `duo open` always lands a NEW main-strip tab (BrowserManager appends to `this.tabs`, never to the aux-pinned slot); (2) renderer handler is null-safe via `(payload as ...)?.slot ?? 'main'` so a future regression of this same shape cannot reproduce.

**Sprint 9 editor-routed fix (2026-05-07).** Walk-3 user-verified PASS for the caret-lands-in-editor case ("carat landed!"). Three walks of fixes:
1. Walk-0: React anti-pattern fix (setActiveWorking lifted out of setFileTabs updater).
2. Walk-1: rAF chain to focus the editor's contentEditable + `console.debug` → `console.log` for trace visibility.
3. Walk-2: routed through `findVisibleWorkingPaneCE('main')` — filters by `offsetParent !== null` so the focus call lands on the VISIBLE editor (not whichever display-toggled invisible tab was first in DOM order; BUG-046's mount-all-then-display-toggle pattern was producing the stale selector). Same helper used by ENH-098 chord set.

**Walk-3 surfaced BUG-106** (`duo edit <non-existent-path>` opens tab + editor errors with ENOENT). Independent of this fix; filed separately.

**Sprint 9 fix (2026-05-07).** Refactored `openFile` in [renderer/App.tsx:858](renderer/App.tsx:858) to lift `setActiveWorking` OUT of the `setFileTabs` updater. The pre-fix shape called `setActiveWorking({ kind: 'file', id })` from INSIDE the `setFileTabs(prev => …)` updater body — a React anti-pattern. Inner state updates schedule separately from the outer commit, and React 18+'s automatic batching can land them in a different render than the tab addition itself, leaving fileTabs grown but `activeWorking` stuck (or vice versa). The new shape stashes the activation target on a `pendingActivationRef` from inside the updater, then flushes both `setActiveWorking` and `setFocusedColumn` AFTER the updater returns — both setters now run as direct top-level state writes that React batches normally. Added `console.debug('[BUG-101 openFile]', { path, title })` for future repro diagnosis.

**Priority:** **Medium** — affects automation flows that rely on `duo open <url>` / `duo edit <path>` to land a usable tab. CLI claims success but the user (or agent) sees no new tab. Also bit the Sprint 9 planning session itself — `duo open` fired ok but the worksheet tab didn't surface for the owner.
**Filed:** 2026-05-06 (pre-walk surfaced — `duo open /tmp/walk-rev2-playground.html` and `duo edit /tmp/bug097-prewalk.md` both reported `{ok: true}`, but the ⌘⇧A palette enumerated only the pre-existing 10 tabs; neither new file appeared. `duo url` / `duo title` did report the playground as the live browser tab, so the BrowserManager has it — but the renderer's `browserTabs` state didn't include it).

**Symptom.** `duo open <path>` returns `{ok: true, url, routedTo: "browser"}` and `duo title` / `duo url` confirm the page is the live browser tab. But the working-pane / browser-pane tab strip doesn't grow a new entry, and the ⌘⇧A palette doesn't enumerate the new tab. Same shape for `duo edit <path>` against fresh `.md` files.

**Hypotheses (status update 2026-05-07):**
1. ~~**Renderer state drift** — BrowserManager added the tab + emitted `onTabsChange`, but the renderer's `setBrowserTabs` callback didn't fire (subscription dropped after a HMR re-mount? race against an effect cleanup?).~~ — STILL OPEN for the browser-pane (`duo open` to a URL) path. The Sprint 9 fix only addressed the editor-pane (`duo edit` / `duo open` of a local file) path.
2. **Tab-strip overflow** — the working-pane tab strip may have a fixed visible width; new tabs are added but composite off-screen and aren't horizontally-scrollable. Less likely for the palette case (palette enumerates from state, not DOM).
3. ~~**`duo open` IPC routing** — when the active browser tab is already a `file://` URL with similar path semantics, BrowserManager may REUSE the slot rather than create a new one.~~ — Less likely after re-reading openTab; the BrowserManager creates a new tab unless `--switch-existing` is set.
4. **(NEW) Editor-routing setActiveWorking nesting bug** — fixed Sprint 9; was the most likely root cause for the editor-routed half of the symptom. Visual verification pending.

**Verification owed.**
- UI smoke: `duo edit /tmp/<fresh-md-file>` should now reliably open AND surface the tab. Walk this when owner returns.
- Browser-pane half: `duo open https://example.com` should reliably surface a new browser tab. If this still fails after the editor-side fix, hypothesis #1 needs separate work — likely instrumentation around `onTabsChange` subscription lifecycle.

**Cross-ref:** ENH-080 (the just-shipped tab-search palette is what surfaced this — the palette listed everything *but* the new tabs).

---

### BUG-100: Send → Duo pill missing on text selections inside the split-view (aux) browser pane

**Status:** 🟡 Open (Sprint 11 evaluated 2026-05-07; deferred). Owner originally flagged "non blocking, add to backlog" v0.6.8; Sprint 11 architectural assessment confirms cost: a CdpBridge multi-attach refactor (~3–4 hours of careful debugger plumbing) is the right shape for this. The bridge today holds a single `wc: WebContents` field; attaching to a second tab requires either (a) a parallel `auxWc` slot with mirrored Runtime.addBinding setup + a separate session-events listener (option 1 below), (b) a tab-id-keyed Map of bridges (option 2 — cleaner architecture but more code), or (c) executeJavaScript-based one-shot injection without CDP bindings (option 3 — sidesteps the binding plumbing; selection data has to round-trip via window CustomEvent + IPC instead). Owner pull pending — deferred to a future sprint when the workflow surfaces. Workaround: promote the aux browser tab back to main (⌘⇧/) before selecting.
**Priority:** **Medium** — affects users who park a reference page in the split-view + select text from it for chat. Workaround: promote the aux browser tab back to main (⌘⇧/) before selecting.
**Filed:** 2026-05-06 (Smoke walk v0.6.8 step 5 — *"opened claude session: pill DOES appear for selected text in main pane, but not in split view"*).

**Symptom.** With at least one Claude tab live in the terminal pane and a browser tab pinned to the split-view (aux), selecting text inside the aux pane's WebContentsView does NOT render the in-page Send → Duo pill. Selection in the MAIN browser pane behaves correctly under the same conditions.

**Hypothesis (untested).** The Send→Duo pill is rendered via CDP injection into the active browser tab's webContents (`cdp-bridge.ts § showPillFor`). The CDP connection is attached to `tabs[activeIndex]` only. Aux tabs have a separate webContents that the CDP bridge has no awareness of — any `selectionchange` events fired by the aux pane's WebContentsView don't reach the pill code. Fix candidates:
1. Attach a parallel CDP bridge to the aux webContents when one is pinned, mirroring the main bridge's selection→pill flow.
2. Hoist the CDP bridge to be tab-id-keyed (one bridge per webContents) and attach on aux pin / detach on aux clear.
3. Forward selectionchange via a minimal `before-input-event`-style preload script in the aux pane only.

(2) is the cleanest but the heaviest refactor. (1) is the most localized; (3) sidesteps CDP entirely. Defer the choice until the bug is prioritized.

**Cross-ref:** Stage 15.3 Send → Duo pill (origin); Sprint 7 Phase 3c (aux browser pinning).

---

### BUG-099: Markdown editor — autosave race triggers spurious "file changed on disk" banner during normal typing

**Status:** ✅ **FIXED** in v0.6.8 (Sprint 8 walk-1 follow-up, 2026-05-06). Added a `recentlyWrittenBodiesRef` Map<string, number> in [MarkdownEditor.tsx](renderer/components/editor/MarkdownEditor.tsx) tracking every body string we write with a 2-second TTL. Watcher's echo detection now consults the set as a secondary check after the existing `lastSavedBodyRef.current` exact match, so a chokidar event whose body has already been superseded by a newer save is still recognized as our own. `trackRecentlyWritten(body)` fires BEFORE the `files.write` IPC; the set clears on path change. Diagnostic `console.debug('[BUG-085 conflict]', {…})` lines added on both the silent-reload and conflict-surface paths so any future repro leaves a paper trail (length + head excerpts; no full body content for privacy).
**Priority:** **High** (was — eroded user trust in the editor's autosave; conflict banner appearing during normal typing felt like data was at risk).
**Filed:** 2026-05-06 (Smoke walk v0.6.8, ENH-096-WIKILINKS step 3 — *"received race condition on editing in the middle of step 3; clicked 'keep mine' -- you need to investigate the save loop"*).

**Symptom (pre-fix).** While typing in the markdown editor — particularly during rapid consecutive edits that triggered multiple debounced autosaves in quick succession — the "This file changed on disk while you were editing" banner appeared mid-session. User had not modified the file from any other tool. Clicking "keep mine" triggered another save, which sometimes re-fired the banner, looping until typing slowed.

**Root cause.** The BUG-085 watcher echo-check compared the just-read disk body against a single `lastSavedBodyRef.current`. The save flow updates `lastSavedBodyRef.current = body` AFTER `await window.electron.files.write(path, bytes)` resolves. Chokidar's `awaitWriteFinish: { stabilityThreshold: 150ms }` typically delays the event past that line, but two close-together saves race the window: save#1 writes body "A" (sets baseline = A), save#2 writes body "B" (sets baseline = B), chokidar fires for save#1 with disk body "A" — but baseline is now "B" — false conflict surfaces. The "keep mine" loop happens because resolveConflictKeepMine triggers another save, which triggers another watcher event for a stale body.

**Why "keep mine" looped.** `resolveConflictKeepMine` calls `void saveRef.current()`. That save fires another write → chokidar fires again → the new write may also be racing against a still-pending older event. With the recently-written set, both events resolve as echoes.

**Cross-ref:** [Sprint 6 BUG-085 (markdown editor reconciles external file writes)](tasks.md). This bug is the BUG-085 family's escape hatch — the original BUG-085 fix solved "external writes are visible," this fix solves "internal writes don't masquerade as external."

---

### BUG-098: Right-click tab → Move to Trash on a missing file shows error popup instead of closing tab

**Status:** ✅ **FIXED** in v0.6.7 (Sprint 7 rev6 follow-up, 2026-05-05). [App.tsx § onTrashTabFile](renderer/App.tsx) now catches the "doesn't exist" / `ENOENT` / "no such file" error class from `files.trash`, treats it as a no-op success, and proceeds to close the tab. Other error classes still surface via `window.alert`. Regex matches both ASCII (`'`) and Unicode (`'`) apostrophes — Apple's native error strings use the curly quote.
**Priority:** **Medium** (UX paper cut — every other path closes the tab when the user's intent is "this file shouldn't be here anymore"; trash-on-missing-file shouldn't be an exception).
**Filed:** 2026-05-05 (rev6 walk OTHER NOTES — "tried to delete file by right clicking tab and selecting 'move to trash'; received 'file does not exist' error; if true, that file does not exist, we should simply confirm the action and close the tab").

**Symptom.** User has a file tab open. The underlying file gets removed from disk (deleted by another tool, vanished due to a `git clean`, never written to disk in the first place, etc.). User right-clicks the tab → "Move to Trash…" → confirms in the system sheet. macOS rejects the trash call with "The file 'foo' doesn't exist." The renderer surfaces it as a `window.alert` and the tab stays open — the user has to close the tab manually.

**Fix.** Pattern-match the error message (`/doesn['']?t exist|ENOENT|no such file/i`); on match, skip the alert and proceed to the existing close-tab branch. The user already saw the confirm dialog, said "Move to Trash" — closing the tab on a missing target matches their intent. If the trash IPC fails for some other reason (permission denied, locked file, exotic filesystem), the alert path still fires.

**Cross-ref:** None — clean fix, no related bugs.

---

### BUG-097: Markdown editor empty-doc placeholder wraps at ~3 characters per line on first load

**Status:** ✅ **FIXED** in v0.6.8 (Sprint 8 Phase 0, 2026-05-06). Defensive CSS hardening on the placeholder rule at [globals.css:371](renderer/styles/globals.css). Suspected root cause: Tailwind Typography's `@apply prose` (line 276 of the same file) brings its own first-child / first-of-type pseudo-element rules that interact with the floated placeholder pseudo-element and squeeze it into a vertical one-character-per-line column on first load. The fix locks horizontal layout: `white-space: nowrap` forbids mid-text wrap; `word-break: normal` defends against any inherited `break-all`; `max-width: 100%` + `overflow: hidden` + `text-overflow: ellipsis` keep overflow in check on narrow editors (the text clips with `…` rather than vertical-wraps — far more readable). The fix is defensive rather than precision-targeted because the exact Tailwind interaction surface drift between Typography versions and the cost of a precision fix exceeds the cost of locking the placeholder's inline behavior.
**Priority:** **Medium** — visual ugliness, not data-loss. Workaround: type any character; placeholder disappears.
**Filed:** 2026-05-05 (rev5 walk MUTUAL note — "strange page formatting when I first load the markdown file").

**Symptom.** When opening a freshly-touched empty `.md` file via `duo edit /tmp/foo.md`, the editor's placeholder text "Start typing — markdown shortcuts work (`#`, `_`, `>`, `**bold**`)…" renders in a narrow column on the left, wrapping at ~3-4 characters per line. A small orange chip with "1=" and "#" appears beside it, also narrow. The toolbar above renders normally. Typing any character clears the placeholder and the editor renders correctly thereafter — so the bug is empty-state-only.

**Suspected cause (needs repro).** The placeholder rule at `globals.css:371` uses `float: left; height: 0`. Some other floated element (the orange chip — currently unidentified in source; possibly a TipTap-inserted node or a CSS pseudo-element) may be displacing the placeholder around itself, forcing the placeholder column to the right of an unbreakable left-floated chip. Could also be a `column-count` / `writing-mode` interaction or a TipTap empty-line affordance I haven't grepped out yet.

**Where to look.** `renderer/styles/globals.css § .duo-editor-prose .is-editor-empty` plus any sibling styles. `renderer/components/editor/MarkdownEditor.tsx` extension list — particularly `Placeholder.configure` and any custom node views. `renderer/components/editor/extensions/` for anything that adds inline DOM to empty lines.

**Cross-ref:** Sprint 7 Phase 3c rev5 walk (surfaced this).

---

### BUG-094: Terminal paste with trailing newline auto-executes the command

**Status:** ✅ **FIXED** in v0.6.7 (Sprint 6 mid-flight insertion, 2026-05-04). `TerminalPane.tsx` installs a capture-phase `paste` listener on the xterm host. When the clipboard payload ends with one or more `\r` / `\n`, the listener intercepts before xterm's textarea handler, drops only the trailing newline run, and hands the cleaned string to `term.paste()` (which still wraps in bracketed-paste markers if the shell enabled `?2004h`). Pastes without trailing newlines fast-path to xterm's default. Internal `\n`s are preserved so legitimate multi-line content (Claude Code multi-line prompts, heredocs, REPL blocks, scripts) still works.
**Priority:** **High** (the user's primary copy-paste-from-chat workflow auto-executed the command before they could read it).
**Filed:** 2026-05-04 (rev3 walk OTHER-NOTES — "I copied your text and pasted it to terminal; I need to be able to do this").

**Symptom.** User copies a command from chat / a doc / any source whose copy ships with a trailing `\n` (most sources do). Pastes into terminal. Shell sees `<command>\n` and treats the `\n` as Enter — the command auto-executes before the user has a chance to read or edit it. If the source ALSO injected a wrap-induced `\n` mid-command (e.g. Ink-rendered TUI hard-wraps long lines), that `\n` ALSO executed as Enter, splitting one command across multiple Returns and leaving the shell at a continuation prompt or running partial commands. Resizing the terminal to try to recover triggered an xterm reflow that re-wrapped the polluted scrollback into duplicate-looking rows (rev3 screenshot showed four stacked attempts).

**Root cause.** xterm.js v5 only wraps pastes in bracketed-paste markers (`\e[200~ … \e[201~`) when the host shell has explicitly enabled the mode via `\e[?2004h`. zsh's default config (no `bracketed-paste-magic` widget bound) does not enable it; the user's `(base)` Anaconda zsh ships without the opt-in. Without renderer-side normalization, every `\r` / `\n` in the paste hits the PTY as a Return key.

**Fix (trailing-only, conservative).** `TerminalPane.tsx`'s mount effect installs a capture-phase `paste` listener on the host before `term.open(host)`'s internal listeners can handle it. When the clipboard text matches `/[\r\n]+$/`, preventDefault + stopPropagation, then `term.paste(data.replace(/[\r\n]+$/, ''))`. The cleaned string runs through `term.paste()`, which respects bracketed-paste mode if it happens to be on. Cleanup removes the listener on tab dispose. Behavior matches Terminal.app's default paste; deliberately scoped to trailing newlines so legitimate multi-line paste still works.

**Trade-off accepted.** A paste with `\n` *internal* to a single intended command (e.g. a chat-copy where Ink hard-wrapped the source line) will still execute the partial command before the wrap. That case is harder to detect without false positives against legitimate multi-line paste, and the principled fix (heuristic, or shell-mode-aware bypass when `?2004h` is on) belongs in a follow-up. The trailing-only fix solves the broadest class of the BUG-094 symptom (auto-execute on paste of any source-with-trailing-newline) without breaking multi-line use.

**Open follow-up if internal-`\n` case bites.** If chat-copy paths still break in practice, the next iteration is one of: (a) detect bracketed-paste mode state on the PTY (track `\e[?2004h` / `\e[?2004l` in the data stream from main → renderer; only strip when mode is OFF), (b) add a soft-wrap heuristic (lines that end mid-word + uniform line lengths → likely wrap-injected `\n`s, collapse them; lines with consistent indentation or blank lines → intentional multi-line, preserve), or (c) provide an opt-out modifier (Shift+Paste preserves newlines).

**Why this couldn't wait.** The user's primary "talk to Claude, copy a command, run it" loop is the most common interaction in the Duo workflow. A copy-paste path that auto-executes commands before the user can read them is a daily friction point. Filed and fixed same session.

**Cross-ref:** Sprint 6 close-out (was supposed to be smoke-walk + cut, but the rev3 walk surfaced this); BUG-001 family (xterm consuming user input wrong) — different class but adjacent surface.

---

### BUG-084: ⌘R reloads the entire app and kills running terminal sessions

**Status:** ✅ **FIXED** in v0.6.7 (Sprint 6 mid-flight insertion, 2026-05-04). Removed the default `{ role: 'reload' }` and `{ role: 'forceReload' }` items from the View menu in `electron/main.ts` — those Electron-default roles auto-bind ⌘R / ⇧⌘R to `webContents.reload()`, which destroys the renderer (every terminal tab, every working tab, every iframe canvas) without warning. The dev workflow keeps `toggleDevTools` (still in the menu); explicit reload is still possible by killing + restarting `npm run dev`. Production users have no reason to reload — the data they care about (tabs, sessions, files) is in the renderer state that the reload would wipe.
**Priority:** **High** (data-loss UX — a single accidental ⌘R kills every terminal session and unsaved working-tab state. There's no confirmation prompt and the reload is silent).
**Filed:** 2026-05-04 (owner repro: "cmd r appears to refresh the whole app, killing existing terminal sessions; this is terrible").

**Symptom.** User presses ⌘R (probably reflexively from a browser-pane focus or just muscle memory). The entire main BrowserWindow's webContents reloads. Every terminal tab gets a fresh xterm + the PTY's renderer-side connection drops; every working tab unmounts; every iframe canvas with unsaved edits loses them. PtyManager keeps the underlying processes alive in main, but the renderer-side wiring (xterm instances, focus state, scroll position) is gone.

**Root cause.** Electron's default View menu, when built via `Menu.buildFromTemplate`, includes `{ role: 'reload' }` and `{ role: 'forceReload' }` which Chromium auto-binds to ⌘R / ⇧⌘R. Those accelerators fire `webContents.reload()` regardless of focus or app state. Duo isn't a web app — there's no concept of "reload to get fresh content" — but the chord still has its Chromium-default behavior because we left the menu items in.

**Fix.** Remove both items from the View menu. ⌘R / ⇧⌘R now do nothing. `toggleDevTools` stays for dev. If a future need arises (e.g. ⌘R on a focused browser tab → reload that tab), wire it through `useKeyboardShortcuts` and gate it on the active pane being `working` AND the active tab being `kind: 'browser'` — never let it reach the main BrowserWindow.

**Cross-ref:** Stage 21c (auto-update / session restore — the safety net WHEN a reload does happen, e.g. via toggleDevTools). The fix here is preventative: don't let ⌘R reach the main window in the first place.

---

### BUG-076: ⌃⇧\` tab-cycle doesn't reach faq.html after `duo open` switches focus to a new browser tab

**Status:** ✅ **Fixed v0.6.5** (Sprint 4 Phase 4). Root cause: `BrowserManager.switchTab()` activated the new view's bounds + emitted state but never called `webContents.focus()` on it. OS-level keyboard focus stayed on the PREVIOUS (now-shrunk-to-1×1) view. The first cycle press worked because the focused-but-shrunk view's `before-input-event` handler still forwarded ⌃Tab; subsequent keystrokes drifted because every other call site of switchTab (addTab / openExisting / etc.) had been calling `webContents.focus()` manually — but the bare `switchTab(n)` API path that the renderer cycle uses didn't. Fix: centralize the focus call inside `switchTab` itself in `electron/browser-manager.ts § switchTab` after activating the new view. Existing inline `webContents.focus()` calls at sibling call sites become redundant but harmless.
**Status (original):** 🆕 Filed (surfaced in v0.6.4 smoke walk, ENH-036 row).
**Priority:** Medium (sibling of the BUG-038 / BUG-042 / BUG-071 wrong-pane-focus family).
**Filed:** 2026-05-03 (owner smoke walk note).

**Owner observation (verbatim):** *"worked -- but something strange happened: when I want to ctrl+shift+~ back to the smoke walk tab (from [..., smoke walk, faq.html, new:anthropic.com,...]), the faq.html did not respond to the ctrl+shift+~"*

**Repro:**
1. Open the smoke walk page (browser pane).
2. Run `duo open https://anthropic.com` from a terminal (ENH-036 — the new browser tab becomes visible immediately).
3. Tab strip now reads: smoke walk · faq.html · anthropic.com (right-most active).
4. Press `⌃⇧\`` to cycle backwards.
5. **Expected:** focus moves to the previous tab. Repeat to reach the smoke walk.
6. **Actual:** the cycle hits faq.html but seems to stop responding there — pressing ⌃⇧\` again doesn't move further to the smoke walk tab.

**Suspected cause:** ENH-036's `BROWSER_FOCUS_GAINED` handler now flips both `focusedColumn = 'working'` AND `activeWorking = { kind: 'browser' }`. There may be a race or a stale state somewhere that leaves `faq.html` in a "selected but not focus-receiving" state when ⌃⇧\` lands on it. Same family as BUG-038 (cycle skips tabs after session restore), BUG-042 (browser pane click doesn't update focus), BUG-071 (focus limbo after path-link click).

**Where to look:**
- `useKeyboardShortcuts.ts § cycleTabsForward / cycleTabsBackward` — does the cycle correctly enumerate `browserTabs[]`?
- `useBrowserState` — does `switchTab` correctly fire on the cycle hit, and does the resulting `webContents.focus()` happen reliably on the just-activated tab?
- The faq.html WCV specifically — does it have any state (e.g. lingering from a previous load) that swallows the activation IPC?

**Workaround until fixed:** click the smoke walk tab directly to bypass the cycle.

**Cross-ref:** BUG-038 (parent family — wrong-pane-focus → wrong-shortcut-routing); BUG-042 (browser focus push); BUG-071 (focus transfer after path-link click — fix from this morning); ENH-036 (the activeWorking flip that may have introduced this).

---

### ENH-082: Terminal Context Bar — collapsible UI surface below terminal tabs for job + docs + skills shared between user and agent

**Status:** 🆕 Filed · **research-doc owed before code (medium-sized feature)**.
**Priority:** Medium-High (closes a real coordination gap between user and agent — today neither can express "what is THIS terminal focused on?" except via in-band conversation; a structured surface would make terminal context inspectable, persistent, and clickable).
**Filed:** 2026-05-03 (owner ask — flagged "want to think hard about this one").

**Owner ask (verbatim):** *"a terminal context bar: a collapsable ui element below the terminal tabs, where both user and duo can indicate the job that a given terminal is focused, the documents it is working with (with links to focus them in canvas), skills being used, etc -- will want to think hard about this one"*

**Problem this closes.** Today, terminal context is invisible:

- The user has multiple terminals (one per task) and forgets which is which after an hour. Tab titles are just `claude · <basename>` or `shell · <cwd>` — no semantic info.
- The agent in a given terminal has working memory about the current job, files in scope, skills in use — but none of that is surfaced to the user.
- When the user moves between terminals or comes back after lunch, they have to ask the agent "what was I doing here?" — a recurring re-orientation tax.
- Files the agent has been editing in this terminal don't have a linked surface; the user can't click to focus them in canvas without remembering paths.

**What's wanted (v1 sketch):**

A collapsible UI element rendered below the terminal tab strip (above the active terminal pane). Per-terminal-tab; collapsed by default; click the strip to expand. Shows:

1. **Job statement** — one-line plain text describing what this terminal is focused on. Both user-editable (text input) and agent-writable (`duo terminal job <text>` or canvas-action `terminal:set-job`). e.g. "v0.6.5 markdown CommentRail (MISSING-001)" or "writing this week's stakeholder update."
2. **Documents in scope** — list of file paths the terminal is working with. Each path is a clickable link that focuses it in the canvas (via `sendEdit` / `openFileSmart`). Both user-editable (right-click "Add to terminal context" on file/tab) and agent-writable (`duo terminal docs add <path>`). Auto-population candidates: files the agent has read or written via `duo` verbs in this terminal session.
3. **Skills in use** — list of Claude Code skill names active in this terminal session (from `~/.claude/skills/` discovery). Possibly auto-populated from skill-discovery output; user can pin / unpin.
4. **(Optional v2) Recent activity** — last 5 `duo` verbs invoked from this terminal (read from `duo events` ring buffer scoped to `DUO_SESSION`). Read-only; mostly for the agent to summarize "what did we just do here?"

Bar visual:

- Collapsed = a thin (~24px) strip with a chevron + the job statement (truncated). Click anywhere on it to expand.
- Expanded = ~120-180px tall section with three sub-sections (Job / Docs / Skills), each with inline-edit affordances + an agent-emit indicator (a small clawd glyph next to fields the agent recently wrote, fading like the just-added wash on edits).
- Theme: same Atelier paper-cream / ochre palette; serif italic for the job statement (matches the active-tab serif).

**Architecture sketch (research doc finalizes):**

- **State location:** per-terminal-tab metadata, persisted in `~/.claude/duo/session-state.json` alongside the terminal's `cwd` + `kind` (extend `SessionStateTerminal` shape — additive field, same pattern as Phase 3c-i `aux`).
- **Per-tab state shape:**
  ```ts
  interface TerminalContext {
    job: string                  // user/agent-writable one-liner
    docs: { path: string; addedBy: 'user' | 'agent' }[]
    skills: string[]             // skill names; reserved for v2 auto-discovery
    expanded: boolean            // collapsed/expanded UI state
    recentEdits?: { field: 'job' | 'docs' | 'skills'; ts: number; author: 'user' | 'agent' }[]
                                 // for the just-added wash (max 10)
  }
  ```
- **CLI surface (new verbs, full plumbing checklist per CLAUDE.md § 4):**
  - `duo terminal job [<text>]` — read or set the active terminal's job statement.
  - `duo terminal docs [add|remove|list] [<path>]` — manage the docs list.
  - `duo terminal skills [add|remove|list] [<name>]` — manage the skills list (v2 may auto-populate from skill discovery).
  - `duo terminal expand|collapse` — UI state.
  - `duo terminal context [--json]` — read everything for the active terminal.
  - All scoped by `DUO_SESSION` env so verbs run from inside a terminal target THAT terminal automatically; `--terminal <id>` flag for cross-terminal writes from outside (rare).
- **Skill update:** new entry in `skill/SKILL.md` documenting the convention — agents should set the job statement at session start and update the docs list as they touch files. Eventually this becomes part of the priming flow (Stage 19b).
- **UI components:** new `renderer/components/TerminalContextBar.tsx` that consumes per-tab context state from `useTerminalContext` hook (mirror of `useNavigator` shape).

**Edge cases the research doc should resolve:**

1. **Initial state.** When a new terminal spawns, what's the default? Probably empty context, collapsed. But if the spawn was via `duo new-tab --claude --cmd "work on X"`, can the spawn pre-populate the job statement?
2. **Multi-tab ↔ single context.** What if the same skill or doc is referenced from multiple terminals? Probably each terminal has its own list (terminal-scoped); a separate "global" context surface (Stage 22's "Project Claude Context" panel) is the global view.
3. **Doc click → canvas focus.** Clicking a doc link should focus it via `sendEdit` (markdown → editor; HTML → canvas; etc.) but should NOT clear the user's current canvas selection or scroll position. Pattern reuses ENH-039's path-link click flow.
4. **Agent-write rate limiting.** If the agent updates the docs list on every file touch, the bar churns visually. Recommend: debounce the agent-write side; only flash the just-added wash on first-write-in-N-seconds.
5. **Persistence vs. ephemerality.** Should the context survive across launches (like other session state)? Probably yes — the user wants to come back and remember what they were doing. But should it persist across `duo doctor` clean restart? Probably yes (it's user data, not transient state).
6. **Privacy / sensitivity.** If the agent writes free-text job statements, what guardrails prevent it from accidentally writing user-private text into a context bar that gets stored on disk? Probably none needed (the user IS the audience), but worth a sentence in the research doc.
7. **Discoverability.** First-time users won't know the bar exists if it's collapsed by default. Pattern: expanded by default for the first terminal of a fresh install (FTUX); collapsed by default after that.

**Required before code: research doc** at `docs/prd/terminal-context-bar-research.html` (mirror of `canvas-split-view-research.html`'s structure) covering:

- The seven edge cases above
- Visual mockups (Atelier-styled, paper-cream + ochre, two states — collapsed + expanded)
- Per-state prop contracts and IPC channel shape
- CLI verb signatures + plumbing-checklist file list
- A locked decision on default-collapsed vs. default-expanded for FTUX
- Sequencing / phase plan (probably 17a/17b style — first the data plane + CLI + persistence, then the UI surface, then the agent-side conventions)

**Why this matters strategically.** Today Duo's user-agent-pair surface is rich on the canvas side (Stage 17 family) and rich on the navigator side (Stage 22's "Your Claude settings" + "Project Claude context"). The terminal is the third leg of the pair surface and currently has zero structured shared context. Closing this gap makes the terminal a first-class participant: the user can SEE what the agent is working on, the agent can SAY what it's working on, and both can drop into the same docs in canvas with one click.

**Sequencing:** medium-sized feature. Doesn't gate anything in v0.6.5 directly. Reasonable home is post-MISSING-001 (markdown CommentRail) once Stage 14a closes — the markdown editor's annotation work is conceptually adjacent (both are "structured shared surface for user-agent communication"). Owner-driven priority, not architectural.

**Cross-ref:** Stage 22 (Your Claude settings + Project Claude context — global-scope shared context, this is its terminal-scope sibling); Stage 19b (priming — terminal context bar's job statement is a natural fit for the priming text); ENH-013 (Send → Duo enabled-only-when-active-Claude — uses the same per-terminal Claude-presence signal that this bar's "is the agent live?" affordance would use); Stage 27 canvas-action verbs (`terminal:focus`, `terminal:send` — same plumbing layer the new `terminal:set-job` etc. would extend).

---

### ENH-083: Move collapse-pane buttons from titlebar into the new-tab clusters

**Status:** ✅ **Shipped v0.6.5** (Sprint 4 Phase 3). Collapse-terminal button now lives next to TabBar's claude/shell new-tab cluster; collapse-canvas button lives next to WorkingTabStrip's new-file/new-browser cluster. Glyphs unchanged (the two-rectangle box-icons from ENH-040). Active-state inversion unchanged (accent fill when the pane is collapsed). Titlebar now hosts only version badge + Claude presence dot + theme toggle.
**Status (original):** 🆕 Filed (v0.6.4 smoke walk owner note).
**Priority:** Medium (UX coherence — controls cluster with the surface they affect).
**Filed:** 2026-05-03.

**Owner observation (verbatim):** *"we need to move the collapse terminal, collapse canvas buttons -- they should be with the new terminal button cluster and the new canvas tab cluster respectively"*

**Today (ENH-040 v1):** the two collapse-pane buttons live in the titlebar next to the theme toggle. Far from the surfaces they affect.

**What's wanted:** relocate each collapse button next to the new-tab cluster of its owning surface.
- Collapse-terminal button → next to TabBar's `+` (new shell) / clawd (new claude) cluster on the terminal tab strip.
- Collapse-canvas button → next to WorkingTabStrip's `+` / globe cluster.

Visual benefit: the control sits with the surface; users find it intuitively when they're focused on that surface. Titlebar declutters back to just the theme toggle.

**Affected files:**
- `renderer/components/Titlebar.tsx` (or wherever the buttons live today) — remove the two collapse buttons.
- `renderer/components/TabBar.tsx` — add a collapse-pane button to the new-tab cluster.
- `renderer/components/WorkingTabStrip.tsx` — same for the working-pane new-tab cluster.
- Symbol design — pick a glyph that reads as "collapse this column" without competing with the existing `+` / globe glyphs.

**Cross-ref:** ENH-040 (collapse-pane v1 — buttons in titlebar); ENH-066 (vertical rail when collapsed — the rail is the EXPAND affordance; this ENH adjusts the COLLAPSE affordance's location).

---

### ENH-084: Aux pane focus indicator — orange glow when active in side pane (parity with main)

**Status:** 🔴 **DEFECT — three attempts in v0.6.5 all failed; deferred to v0.6.6 Sprint 5.** Owner direction (2026-05-04, Phase 3 re-walk #2): *"glow never moves to split view -- please log the defect, incl failed attempts to fix it, then move on; this has wasted too much time this sprint."* Logging here as the canonical reference for the next attempt; do NOT ship a v4 without first studying these failures.

**Failed attempts:**

1. **v1 — `onMouseDownCapture` on column wrappers (commit 8ac1507).** Tracked `focusedSubpane: 'main' | 'aux'` in WorkingPane state. Each column wrapper got an `onMouseDownCapture` that set the subpane on click. Gated WorkingTabStrip's `focused` on `focused && focusedSubpane === 'main'`, AuxHeader on `focused && focusedSubpane === 'aux'`.
   - **Result:** PASSED on aux side (clicking aux glows the aux header). FAILED on main: "canvas main pane (left) does not glow when you click in to it, type in it, etc (regression)."
   - **Why:** clicks INSIDE iframes (PageTab) don't bubble out to the parent doc, so the `onMouseDownCapture` never fires when the user clicks inside a page tab. focusedSubpane stays at whatever the last non-iframe click set it to. Once aux had been clicked, main never won focus back unless the user clicked on the strip chrome.

2. **v2 — Remove the gate (commit f089048).** Backed out the gate from WorkingTabStrip entirely, leaving only the AuxHeader gate. Main strip ALWAYS glowed on column focus.
   - **Result:** Fixed v1's main-pane regression. FAILED for the actual semantic intent: "inactive canvas pane still glow; whole point is for glow to show focus; when I click back from split view to main pane, split view should lose focus; and vice versa."
   - **Why:** removing the gate sacrificed exclusivity. Both surfaces glowed simultaneously when aux had focus, defeating the purpose of glow as a focus indicator.

3. **v3 — Document-level `focusin` listener (commit 48d4cbd).** Replaced `onMouseDownCapture` with a capture-phase `document.addEventListener('focusin', ...)` listener registered when `auxState` is non-null. Used `mainColRef` / `auxColRef` and `Element.contains(target)` to determine which subpane gained focus. Reasoning: parent doc DOES see `focusin` with target=iframe element when an iframe gains focus.
   - **Result:** owner verdict — "glow never moves to split view." Glow stays on main; clicking aux doesn't flip it.
   - **Why (hypotheses — NOT yet verified, would need diagnostic logging in the live app):** several plausible culprits, any combo:
     - PageTab uses sandboxed iframes; on macOS, sandboxed iframe focus events may not propagate as expected to the parent doc's `focusin` listener.
     - The `mainColRef`/`auxColRef` containment check might be wrong if column wrappers re-mount on auxState changes (refs briefly null).
     - The `auxState` dep on the useEffect may have a stale-closure issue — when `auxState` mutates, the listener re-registers against potentially-stale refs.
     - There may be a different focus-related WorkingPane mechanism (BUG-037, BUG-042 lineage) that's already fighting our subpane signal.

**Why the next attempt should NOT just iterate on these patterns:**

The three fixes all assumed a single "subpane focus signal" architecture would suffice. The repeated failures suggest the underlying surface model is more complex than that — there are at least three distinct focus-event sources (parent-doc click, iframe-internal focus, programmatic focus from CDP / IPC) and they don't all reliably reach a single listener. **A v4 should start by INSTRUMENTING the live app** before writing any fix: add `console.log` in EVERY event source (mousedown on column, mousedown on body, focusin, blur, click, mouseup, the BUG-037 `onPageFocusGained` callback, the iframe `contentDocument`'s own listeners) and have the owner click around for 60 seconds while we capture the actual event stream. Design the fix from data, not theory.

**Workaround until v4:** the AuxHeader has a ⇤ "to main" button + ✕ close button + right-click menu (ENH-085). Aux files are trivially manageable; only the visual focus indicator is missing.

**Cross-ref:** BUG-037 (canvas iframe click → focusedColumn flip — same iframe-events-don't-propagate family); BUG-042 (browser pane click doesn't update focus); BUG-071 (focus limbo after path-link click). The next attempt should first confirm whether the existing `onPageFocusGained` signal could be repurposed to ALSO carry subpane info, since it's known to fire correctly for iframe focus events (unlike our `focusin` listener).

**Status (original):** 🆕 Filed (v0.6.4 smoke walk owner note).
**Priority:** Medium (a11y / discoverability — focus state should always be visually obvious).
**Filed:** 2026-05-03.

**Owner observation (verbatim):** *"canvas sub pan focus needs to be improved; if I am active in the side pane, the sidepane should have the orange glow"*

**Today:** when the user clicks into the aux pane (Phase 3a Split View), the renderer's `focusedColumn` may not flip correctly — or even if it does, the visual indicator (the column's accent-tinted left-edge stripe + tinted header) may be tied to the main pane only.

**What's wanted:** when keyboard or mouse focus is on the aux pane, the aux header + left-edge stripe paint with the same accent treatment the main pane uses today (BUG-003 v2 + Stage 26 PR 3 item 11 lineage).

**Affected files:**
- `renderer/components/WorkingPane.tsx § AuxHeader` — add focused-state accent treatment.
- `renderer/App.tsx` — extend `focusedColumn` to differentiate `working-main` vs `working-aux` (or add a separate `auxFocused: boolean` signal).
- Possibly the existing `focusedColumn` semantics need refinement — today it's `'files' | 'terminal' | 'working'`; the working surface is now bipartite.

**Cross-ref:** BUG-003 (focus indicator visual lineage); Phase 3a Split View; ENH-085 (the aux header right-click parity ENH — same surface, different concern).

---

### ENH-085: Split View aux header right-click menu parity with main canvas tab

**Status:** ✅ **Shipped v0.6.5** (Sprint 4 Phase 3). AuxHeader gains `onContextMenu` handler that mirrors WorkingTabStrip § handleContextMenu (ENH-050 NSMenu-via-IPC pattern). Menu items: Reveal in navigator / Rename… / Copy path / Move back to main / Move to Trash… Trash uses the same system-sheet confirm pattern as the main strip; on confirm, App.tsx runs `files.trash(path) + setAuxState(null)`.
**Status (original):** 🆕 Filed (v0.6.4 smoke walk owner note).
**Priority:** Medium (right-click parity between main and aux closes a real gap — without it, an aux file is harder to act on).
**Filed:** 2026-05-03.

**Owner observation (verbatim):** *"split plane title bar should have same context click verbs as main canvas tab; eg I should be able to move the file in split view to trash via context click"*

**Today:** the aux header (Phase 3a `AuxHeader` component in `WorkingPane.tsx`) has only the SPLIT label, filename, ⇤ promote button, and ✕ close button. No right-click context menu. To trash an aux file, the user has to:
1. Promote aux → main.
2. Right-click the resulting main tab → Move to Trash.

That's two steps for what should be one.

**What's wanted:** right-click on the aux header (or the aux's filename text) → same context menu the main `WorkingTabStrip` shows for file tabs:
- Reveal in navigator
- Rename…
- Copy path
- Move to Trash…
- (Skip "Move to Split View" — already there; instead show "Move back to main" which mirrors the ⇤ button.)

**Implementation sketch:**
- Extract `WorkingTabStrip.tsx`'s `buildTabMenuTemplate` / `handleMenuChoice` into a shared helper, or duplicate the relevant items into a `buildAuxMenuTemplate` in `WorkingPane.tsx`.
- Hook `onContextMenu` on the aux header.
- Plumbing: pass `onTrashTabFile` / `onRevealInNavigator` / `onStartRenameFromTab` props (already exist) down to the AuxHeader.

**Cross-ref:** Phase 3a (AuxHeader component); ENH-074 (Copy path in tab right-click — the parity reference); BUG-024 / ENH-050 (the right-click menu plumbing pattern).

---

### ENH-086: Increase visual separation between "Your Claude Settings" and project files in the navigator

**Status:** ✅ **Shipped v0.6.5** (Sprint 4 Phase 2 — direction pivot mid-walk). Original v1: stronger separation of stacked panes (top: user-claude, bottom: project). Owner smoke-walk feedback: *"new plan: move 'user claude settings' to the bottom of the navigator (pinned files will appear above it)"*. v2 fix:
- `renderer/components/FilesPane.tsx` — UserClaudePane reordered to render AFTER PinnedNav, at the bottom of the navigator column. Project tree + breadcrumb are now the top of the navigator (the everyday work surface).
- `renderer/components/UserClaudePane.tsx` — divider flipped from `border-b-2` (was below) to `border-t-2` (now above the pane, separating it from PinnedNav / project tree). Surface tint `bg-paper-edge` retained — anchors the "different scope: global, not project-local" cue.

**Priority:** Low-Medium (UX clarity — Stage 22's two navigator panes need a stronger boundary).
**Filed:** 2026-05-03.

**Owner observation (verbatim):** *"we need to increase the visual separation in the navigator between user settings section and project files/settings section"*

**Today (Stage 22):** the navigator has two stacked panes — `UserClaudePane` (`~/.claude/`) at the top, and the project tree (cwd) below. They're visually adjacent with a thin border between them. From the smoke-walk screenshots, the boundary is too subtle — the user has to read carefully to know which file lives where.

**What's wanted:** more deliberate visual separation. Candidates:
- Thicker / more contrasted border between the two panes.
- Different bg tint for the user-claude pane (e.g. `bg-paper-deep` on top, `bg-surface-1` below) so they read as distinct surfaces.
- A small inset shadow or vertical bar to imply "this is a different scope."
- A clearer collapsible header (already exists, but maybe larger / more emphasized).

**Affected files:**
- `renderer/components/FilesPane.tsx` — host of both panes.
- `renderer/components/UserClaudePane.tsx` — the top pane.
- Atelier tokens — possibly a new "scope-divider" token.

**Cross-ref:** Stage 22 (the dual-pane navigator that filed this gap); Atelier visual design system.

---

### ENH-087: Discoverability for "open file" bold-text styling in navigator

**Status:** ✅ **Shipped v0.6.5** (Sprint 4 Phase 2). Owner picked OPT-B (small filled-dot glyph) from the planning worksheet at `docs/dev/worksheets/enh-087-open-file-indicator.{json,html}`. Implementation in `renderer/components/FileTree.tsx`:
- Open-but-not-active files render a 6px ink-mute dot inline with the filename (`bg-ink-mute` Atelier token; theme-aware).
- Active-file rows keep their existing accent dot (priority — only one dot renders, never both).
- The bolder row text (Stage 26 PR 3 item 3) is preserved; the glyph reinforces the meaning so the owner's "what does this bold text mean?" observation has an explicit answer.

**Priority:** Low-Medium (one of the user's smoke-walk observations was "what does this bold text mean?" — the implicit signal isn't carrying its meaning).
**Filed:** 2026-05-03.

**Owner observation (verbatim):** *"in the file navigator (see second screenshot), multiple files show with bolder text (changelog, idle-thoughts, tasks); I don't know what this means; are they open? rendering error?"*

**Today (Stage 26 PR 3 item 3):** file rows whose path is open in any WorkingPane tab render with brighter / heavier text than unopened rows (`text-zinc-200` vs `text-zinc-400` in dark mode; weight difference in light mode). Active file gets an additional accent-dot glyph.

**The gap:** the styling exists but its meaning isn't discoverable. A user seeing "CHANGELOG, idle-thoughts, tasks" all bold can't infer "these are the three files I have open in the working pane."

**What's wanted:** make the meaning legible. Options:
- **Tooltip on hover** — bold rows get a `title="Open in working pane"` tooltip. Cheap; discoverable on hover.
- **Sidebar legend / help item** — small help link or `?` glyph in the navigator that opens a panel explaining the visual conventions (selected, open, active, pinned, dotfile-hidden, etc.). Bigger but better long-term.
- **Add a glyph next to the filename** — e.g. a small open-door or document icon when the file is open. More obvious at a glance, no hover needed. Risk: visual noise.
- **What-Duo-Does FAQ entry** — document the convention there. Doesn't help in-context.

**Recommended:** combine tooltip + a what-duo-does FAQ entry — discoverability without UI cost. A glyph could come later if the tooltip isn't enough.

**Cross-ref:** Stage 26 PR 3 item 3 (where the open-file bold styling shipped); ENH-079 (collapsed-nav label — same FTUX/discoverability theme); what-duo-does.html "Files & navigation" section (host of any FAQ entry).

---

### FOLLOWUP-006: Increase the autosave delay (or add a "test mode" knob) so the dirty-replace dialog can be smoke-tested

**Status:** ⏳ Open (low-priority test-tooling improvement).
**Filed:** 2026-05-03 (owner v0.6.4 smoke walk skipped Phase 3c-iii because saves are too fast).

**Owner observation (verbatim):** *"saving is too fast to test; please make a todo for a separate session (this is not urgent) to increase autosave delay to allow testing"*

**Today:** the canvas / markdown editor autosave debounce is ~800ms (`MarkdownEditor` and `CanvasTab`). When the smoke-walker types a few chars to dirty the buffer and immediately tries to swap split content, the autosave has already fired and the buffer is clean again — Phase 3c-iii's dirty-replace dialog never appears because the dirty signal cleared.

**What's wanted:** a deterministic way to keep a buffer dirty for the smoke walk window (a few seconds), so the dirty-replace flow can be exercised.

**Options:**
1. **Test-mode env var** — `DUO_AUTOSAVE_DELAY_MS=10000` env override (read by main.ts at boot, passed to renderer via `additionalArguments`). Production unchanged at 800ms; test runs bump to 10s.
2. **Per-buffer debounce knob via duo CLI** — `duo dev autosave-delay <ms>` agent-tunable runtime setting, persisted in localStorage. Useful beyond smoke walks (e.g. agents wanting to make multi-file edits without intermediate saves churning the disk).
3. **A "no-autosave" mode for smoke walks** — explicitly disable autosave; user has to ⌘S to save. Cleaner test isolation but riskier (forgetting to re-enable could surface as a v0.6.5 user-side regression).

**Recommended:** option (2) — `duo dev autosave-delay [<ms>]` (read or set). The `dev` namespace is for agent / tester ergonomics; production users never reach for it. v1: localStorage'd globally. Touches the new-CLI-verb plumbing checklist.

**Cross-ref:** Phase 3c-iii (the smoke walk skip that filed this); BUG-033 (autosave races with `duo doc-write` / `duo html *` mid-edit — same autosave-timing-is-relevant family).

---

### FOLLOWUP-007: Wire `window.duoSendResult(text, opts)` CDP binding so worksheet "Send to Claude" lands in the active terminal directly

**Status:** 🆕 Filed
**Filed:** 2026-05-03 (sprint-plan worksheet spike — primitive ships with the contract; binding plumbing comes next).

**What's needed.** The new `worksheet` skill (`.claude/skills/worksheet/`) generates pages with a "Send to Claude" footer button alongside "Copy results." The button calls `window.duoSendResult(text, { worksheet: NAME })` and falls back to clipboard.writeText when the binding isn't present. Today, every Duo build is in the fallback state — the binding doesn't exist. Worksheets work via copy-paste, but the high-leverage Send-to-Claude path is unwired.

**The contract worksheets commit to:**
```javascript
window.duoSendResult(text: string, opts?: { worksheet: string })
// Resolves when the text has been delivered to the active Claude terminal.
// Rejects if no Claude session is active (worksheet falls back to clipboard).
```

**Plumbing checklist** (touches CLAUDE.md item 4 plumbing rules):
1. **`electron/cdp-bridge.ts`** — new `DUO_SEND_RESULT_FORWARDER_IIFE` injected alongside the existing `PATH_LINK_FORWARDER_IIFE`. Exposes `window.duoSendResult` as a `Runtime.bindingCalled`-routed function. Page-side wrapper marshals `(text, opts)` → JSON, returns a Promise.
2. **`electron/main.ts`** — `cdpBridge.onSendResult(text, opts)` handler. Resolves: find the active Claude terminal tab (the same `claude-presence` signal `cdp-bridge.ts § showPillFor` already reads); if none, reject. If yes, call `terminalPane.sendText(activeClaudeTabId, text)` (or extend `socket-server.ts § terminal-send` if a new path is cleaner) and resolve.
3. **`electron/socket-server.ts`** — likely no change; the binding routes through main, not the CLI socket. But if we want a CLI parity verb (`duo worksheet send-result`), this is where the case lands.
4. **`shared/types.ts`** — minor: extend the IPC channel set if main needs to push a "delivered" signal back to the renderer for visualization (probably not v1).
5. **`cli/duo.ts`** — no new verb required v1; the binding is page-side, not CLI-side. Could add `duo worksheet send-result --text <...>` if we want symmetry. Defer until a use case demands it.
6. **No `skill/SKILL.md` change needed** — the existing Worksheets section already documents the contract and notes the fallback.
7. **Smoke-walk regression** — once shipped, the Send-to-Claude button on the next smoke walk worksheet should land directly in the Claude terminal. That's the validation.

**Open question — should we also send a confirmation event back?**
The page-side Promise resolves when `duoSendResult` returns. We could additionally fire a `duo:event` with `{ name: 'worksheet-sent', payload: { worksheet, text_length } }` for any agent listening with `duo events --follow`. Worth doing if we expect agent-side smoke walk auto-driving (Stage 28 lesson harness already follows this pattern).

**Why this is a follow-up rather than a blocker.** The worksheet primitive is shippable today via copy-paste; the Send button just provides a smoother path when the binding lands. Filing as 🆕 so it surfaces in the next sprint plan.

**Cross-ref:** ENH-039 (`duoOpenPath` / `duoOpenPathSplit` CDP binding — the parallel path); Stage 27 canvas-action vocabulary (`terminal:send` action verb is the same plumbing target on the canvas-pane side). The worksheet's HTML lives in the BROWSER pane, so the canvas-action verbs don't apply directly — this binding is a new injection target.

---

### FOLLOWUP-008: Migrate accent (and other CSS-var-backed Tailwind colors) to RGB-triplet + `<alpha-value>` placeholder

**Status:** ✅ **FIXED** in v0.6.8 (Sprint 8 Phase 0, 2026-05-06). Approach: additive — kept the existing `--duo-accent` / `--duo-accent-soft` / `--duo-accent-ink` hex tokens in [globals.css](renderer/styles/globals.css) for direct `var()` use in non-Tailwind CSS rules, and added sibling `--duo-accent-rgb` / `--duo-accent-soft-rgb` / `--duo-accent-ink-rgb` tokens carrying the same colors as space-separated RGB triplets (`198 106 46` etc., light + dark mode each). Tailwind config now binds the `accent` color family via `rgb(var(--duo-accent-rgb) / <alpha-value>)`, which is the canonical pattern for CSS-variable-backed Tailwind colors that need opacity modifier support. Result: `bg-accent/30`, `text-accent-ink/60`, etc. now actually render at the requested opacity. Existing `bg-accent` (no modifier) usages unchanged.
**Filed:** 2026-05-04 (BUG-074 v3 polish attempt — `bg-accent/85` produced zero fill, traced to this root cause)

**The problem.** The Tailwind config defines accent / surface / paper / ink tokens like:

```js
accent: {
  DEFAULT: 'var(--duo-accent)',
  ...
}
```

with the underlying CSS var holding a literal hex string:

```css
--duo-accent: #C66A2E;
```

When the consumer uses an opacity modifier like `bg-accent/85`, Tailwind 3 attempts to synthesize the alpha into the color expression, but with a raw `var(--duo-accent)` (no `<alpha-value>` placeholder + no RGB-triplet form) the synthesis silently produces broken / no-fill CSS. The class APPEARS in the DOM but renders as if no background was set.

**Symptom we hit (BUG-074 v3 polish):** `bg-accent/85 text-white font-medium` rendered with white text on the parent's surface (paper-deep cream in light mode), no visible fill — looked exactly like the original BUG-074 illegible-white-text regression. The fix was to revert to solid `bg-accent`. Geoff's "slightly less obtrusive" refinement is queued behind this migration.

**Likely also-broken usages already in the codebase** (silent — they fall back to no-tint or full-saturation):
- `renderer/components/WorkingPane.tsx:650` — `hover:bg-accent/40` on the SplitViewDivider hover state
- `renderer/components/FilesPane.tsx:264` — `bg-accent/15` on a modal/banner
- `renderer/components/PinnedNav.tsx:174` — `bg-accent/15` on selected pin row
- `renderer/components/FileRenderers.tsx:70` — `bg-accent/90` on a CTA button
- `renderer/components/Page/IdInjectionBanner.tsx:51` — `hover:bg-accent/85`
- `renderer/components/editor/MarkdownEditor.tsx:1354` — `hover:bg-accent/85`

These haven't surfaced as bugs because they're either hover-states (transient, less visually critical) or fallback-to-solid renders that look "OK" without the intended dimming. Worth a sweep once the migration lands.

**The fix (proper):**

1. **Update CSS vars to RGB-triplet form** — `globals.css`:
   ```css
   --duo-accent: 198 106 46;          /* was: #C66A2E */
   --duo-paper: 251 248 238;          /* was: #FBF8EE */
   /* ...etc for accent-soft, accent-ink, paper-deep, paper-edge, paper-rule, ink, ink-soft, ink-mute, ink-ghost, mark */
   ```

2. **Update Tailwind config to wrap in rgb() + `<alpha-value>`** — `tailwind.config.mjs`:
   ```js
   accent: {
     DEFAULT: 'rgb(var(--duo-accent) / <alpha-value>)',
     ...
   }
   ```

3. **Sweep all `var(--duo-*)` usage in CSS** to wrap in `rgb()`:
   ```css
   color: rgb(var(--duo-accent));    /* was: var(--duo-accent) */
   background: rgb(var(--duo-paper));
   ```

4. **Re-test all `bg-accent/N` usages** to confirm they now produce the intended dimming (not just `/85` for selection — every callsite listed above).

5. **Documentation note** in `docs/design/atelier/README.md` flagging the convention so future tokens follow the same pattern.

**Risk profile:** mechanical sweep across CSS files + tailwind config. Low logic risk; high blast radius if a `var()` reference is missed (renders as "string" — invalid color = no style applied). Smoke walk should validate every accented surface (selection, hover states, banners, dividers) in both light + dark mode.

**Why this is a follow-up rather than a Sprint 4 blocker.** The selection state works correctly with solid `bg-accent`. The "less obtrusive" polish is real but not blocking the v0.6.5 cut — it can land as a focused PR in v0.6.6. Filing now so the next sprint plan surfaces it.

**Cross-ref:** BUG-074 (the v3 polish attempt that surfaced this); Atelier token system (the wider design system this fix slots into); commit b9a4c69 (where the workaround — solid bg-accent + white text — landed).

---

### FOLLOWUP-013: BUG-093 clean-repro investigation (right-click → Move to Split View renderer crash)

**Status:** 🆕 Filed (Sprint 8 Phase 4, 2026-05-06).
**Priority:** **High** — BUG-093 fires from a real user gesture and crashes the WorkingPane.
**Filed:** 2026-05-06.

**What this follow-up does.** v0.6.7 shipped instrumentation around `splitViewMoveTabByPath` + an inline `ErrorBoundary` around `<WorkingPane>`. The crash hasn't been re-observed since the rev3 walk that surfaced it. This follow-up drives the clean-repro:
1. Open Duo dev with devtools console visible, filtered on `[BUG-093]` and `[ErrorBoundary:WorkingPane]`.
2. Reproduce the rev3 shape: fresh canvas → type bullets → add a comment on one bullet → right-click the canvas tab → "Move to Split View."
3. If it crashes: capture the last `[BUG-093]` line (names the swap phase that was running) + the `[ErrorBoundary:WorkingPane]` error message + component stack. The combination usually names the bug.
4. If it refuses to reproduce: try variants — multi-bullet canvas with multiple comments, mid-typing dirty buffer, swap-direction (canvas → split when split is empty vs occupied), the BUG-098 trash interaction.

**Code-side analysis already recorded** (see [BUG-093 entry](#BUG-093) for the three structural-issues audit + three deferred fix candidates). Don't ship a code change without a clean trace.

**Cross-ref:** BUG-093 (the bug being investigated), BUG-092 (companion — even when the move succeeds, scripts don't run in the canvas iframe), BUG-091 (the over-broad lift that gated the original surface).

---

### FOLLOWUP-009: Introduce `@testing-library/react` and write a regression test for sidecar-load → rail-recompute

**Status:** ✅ **PARTIALLY ADDRESSED** in v0.6.8 (Sprint 8 Phase 1, 2026-05-06). Pivoted from "introduce `@testing-library/react` infra" to "cover the recurring-regression bug class via jsdom-only DOM-manipulation tests" — turns out the highest-value coverage targets (BUG-088 duplicate-id-on-clone, BUG-082's reconciliation primitives) are pure functions or DOM manipulators that don't require React component rendering. Two new test files land 26 fixtures:
- [`renderer/components/Page/idInjector.test.ts`](renderer/components/Page/idInjector.test.ts) — 14 fixtures locking the BUG-088/090/087 root-cause fix: contentEditable Enter-clone re-stamping, multi-Enter clone chain, paste-of-stamped-fragment with + without collisions, BR/HR + opt-out skip, cleanup observer disconnect.
- [`renderer/components/editor/markdownComments.test.ts`](renderer/components/editor/markdownComments.test.ts) — 12 fixtures locking `findExcerptIndex` (the load-bearing primitive for re-anchoring markdown comments on file load via excerpt + context match). Covers unique-excerpt match, ambiguous-without-context fallback, contextBefore + contextAfter disambiguation, end-of-doc / start-of-doc edges, the v067r6-md.md rev6 regression shape (3 paragraphs same word).

Test suite 239/239 green (was 213; +14 idInjector + 12 markdownComments). Typecheck clean.

**Why scoped this way.** `@testing-library/react` adds devDep + tsconfig.test.json + .tsx test pattern + setup file complexity that doesn't earn its keep when the regression-class targets are testable without it. Deferred to a future sprint when there's a strong case (e.g. testing PageTab's async useMemo orchestration end-to-end, or the markdown editor's setContent-then-applyMarks race shape). The smoke-walk skill stays the cover for "PageTab + RenderedPage + sidecar all together."

**Filed:** 2026-05-04 (BUG-082 fix landed without a durable regression test — the recurring-regression memory says this class of bug should get test coverage, not just a smoke-walk line)

**Scope:**
1. Add `@testing-library/react` + `@testing-library/jest-dom` (or equivalent) to devDependencies.
2. Update `vitest.config.ts` to allow `*.test.tsx` files + the jsdom environment opt-in pattern.
3. Write `renderer/components/Page/PageTab.test.tsx` (or a more targeted unit on the recompute orchestration helper if one is extracted) that exercises both async-resolution orderings and asserts the rail mounts populated.
4. Update `vitest.config.ts` header comment to drop the "we don't test React rendering" disclaimer.

**Cross-ref:** BUG-082 (the fix this would have covered). MISSING-001 (Phase 4 — the next rail-population path that will benefit from the same infra). Recurring-regressions feedback memory (`feedback_recurring_regression_needs_test.md`).

---

### ENH-088: Install a managed Duo block in `~/.claude/CLAUDE.md` on first launch

**Status:** ✅ Shipped v0.6.6 (Sprint 5 close-out 2026-05-04). New `mergeUserClaudeMd` method in `electron/install-service.ts` runs alongside `installSessionStartHook`. Pure decision logic in exported `planClaudeMdMerge(input)` covers the four PRD scenarios (file-doesn't-exist / marker-present / no-marker-no-prior-flag / no-marker-flag-respects-removal). 13 unit tests in `electron/install-service.test.ts` against the pure helpers. `claudeMdManaged` flag persisted in `~/.claude/duo/installed.json` so a future install distinguishes "user removed our block" from "first-time install." Block is hook-independent: lands inside CLAUDE.md (read by Claude Code's core context loader), so it works in non-`DUO_SESSION` sessions and in enterprise managed installs where hooks are disabled. Block content is pointers only (skill, subagent, sandbox-troubleshooting reference, enterprise-deployments reference) — no inlined verb cheat-sheet (priming.md handles in-Duo sessions).
**Priority:** Medium-High (closes the "Claude Code outside Duo terminals has no Duo awareness" gap; complements existing PATH-shim + SessionStart-hook priming which fire only inside `DUO_SESSION=1` PTYs)
**Filed:** 2026-05-03

**Problem.** The installer (`electron/install-service.ts`) lands skill, agent, `priming.md`, PATH shim, and a SessionStart hook — but never touches the user's global `~/.claude/CLAUDE.md`. So a Claude Code session started from any non-Duo terminal (Terminal.app, iTerm, VS Code's integrated terminal, an agent worktree that wasn't spawned by Duo's `PtyManager`) has no signal that Duo exists at all. The skill description triggers on phrases like "the browser pane" or "what's selected," but the discovery problem stays open for prompts that don't match those keywords (e.g., "why does `duo selection` keep hanging?" — sandbox troubleshooting lore is gated behind a trigger that the broken state prevents from firing).

**Hook-independence (load-bearing design property).** This block must remain the primary mechanism for Duo awareness in non-`DUO_SESSION` Claude Code sessions. It must NOT depend on Claude Code's hook runtime or any `settings.json` configuration — those are commonly disabled by enterprise policy. CLAUDE.md is loaded by Claude Code's core context loader and works regardless of hook/permission policy. The existing SessionStart hook (Stage 19b) remains the redundant safety net for in-Duo sessions only; this block is the load-bearing path for everything else.

**Design.** Auto-insert a thin managed block. CLAUDE.md best-practice ceiling is hard — bloat = ignored — so the block stays ~5 lines and points at load-on-demand resources rather than inlining content.

Block contents (draft):

```markdown
<!-- duo:managed-vX.Y.Z — installed by Duo. Edit freely; remove this block to opt out. -->
## Duo workspace integration

Duo (https://duo.app) is installed on this machine — a desktop app pairing Claude Code terminals with an embedded browser, file tree, markdown editor, and HTML canvas. When the user references Duo's surfaces ("the browser pane", "the editor", "what's selected", a `duo` CLI verb), reach for the **`duo` skill** at `~/.claude/skills/duo/SKILL.md` or delegate multi-step CLI sequences to the **`duo` subagent**. If a `duo` command hangs or returns `ECONNREFUSED`, see `~/.claude/skills/duo/references/sandbox-troubleshooting.md`.
<!-- duo:end -->
```

**Mechanism.** Mirror `mergeSessionStartHook` in `electron/install-service.ts`:

1. If `~/.claude/CLAUDE.md` doesn't exist → create with block + trailing newline.
2. If file exists with `<!-- duo:managed-* -->` marker → version-aware replace (so version bump refreshes the block).
3. If file exists without marker AND `installed.json.claudeMdManaged !== true` → append (preceded by `\n\n` if file doesn't end with `\n`).
4. If file exists without marker AND `claudeMdManaged === true` → user removed it; **respect that**; never re-add. (Set the flag on every successful insert/replace.)

**Test plan.** Three install scenarios on a clean home dir:
- (a) no CLAUDE.md → file created with block.
- (b) CLAUDE.md exists with unrelated content → block appended; original content untouched.
- (c) CLAUDE.md has older `duo:managed-` block → block replaced in place; surrounding content untouched.

Plus one regression: user removes block manually, runs install again → block stays gone (`claudeMdManaged` flag in `installed.json` enforces).

**Affected files (estimated):**
- `electron/install-service.ts` (new `mergeUserClaudeMd` function; called alongside `mergeSessionStartHook`)
- `core/installed-packs-service.ts` or wherever `installed.json` is written (add `claudeMdManaged` boolean)
- New unit test for the merge function (covers the four scenarios)

**Cross-ref:** Stage 19b (priming.md mechanism — this is the cousin that covers non-DUO_SESSION terminals). PRD: `docs/prd/stage-19e-user-context-onboarding.md`. Pairs with ENH-089 (vocabulary lift) and ENH-090 (enterprise-deployments reference) under the same PRD.

---

### ENH-089: Lift user-facing glossary out of project CLAUDE.md into a shipped skill reference

**Status:** ✅ Shipped v0.6.6 (Sprint 5 close-out 2026-05-04). New `skill/references/vocabulary.md` ships with the user-facing terminology; `make-page.md` + `make-playground.md` pointer fix landed; CLAUDE.md § Glossary trimmed to contributor-facing internal-name table + pointer at the shipped reference. Sync verified via `npm run sync:claude` — `~/.claude/skills/duo/references/vocabulary.md` present in installed tree.
**Priority:** Medium (single-source-of-truth fix; closes a broken cross-reference)
**Filed:** 2026-05-03

**Problem.** The page/playground/lesson vocabulary is canonically sourced from project `CLAUDE.md § Glossary`. Both shipped skills point to it as the source of truth:

- `skill/make-page.md:9` — "Vocabulary lock (see CLAUDE.md § Glossary)"
- `skill/make-playground.md:9` — "Vocabulary lock (see CLAUDE.md § Glossary)"

End users don't have CLAUDE.md. The pointer goes to a doc that ships only with the source repo. Today this works because `make-page.md` and `make-playground.md` inline a short copy of the vocabulary, but those copies will drift from the canonical version over time.

**Design.** Lift the user-facing glossary into `skill/references/vocabulary.md` (synced to `~/.claude/skills/duo/references/vocabulary.md` via `sync:claude` and the installer):

- The "User says vs internal name" table (user-facing column only — internal names like `WorkingTab.kind === 'page'` stay in project CLAUDE.md, since they only matter to maintainers).
- The "page/playground distinction is content-level, not kind-level" paragraphs.
- The "When to reach for which" decision tree.

Update both shipped skills to reference `references/vocabulary.md` instead of `CLAUDE.md § Glossary`. Update project CLAUDE.md's glossary section to point at the shipped reference as canonical for user-facing terms, with a short note that the internal naming column lives here as contributor lore.

**Affected files:**
- `skill/references/vocabulary.md` (new — content lifted from CLAUDE.md)
- `skill/make-page.md` and `skill/make-playground.md` (update pointers)
- `CLAUDE.md` (replace user-facing glossary content with a pointer; keep internal-name notes)
- `package.json` `sync:claude` (already syncs `skill/references/*.md` — no change needed; verify on smoke walk)
- `electron/install-service.ts` — verify `references/` tree is copied (it is per `installed.json`)

**Cross-ref:** ENH-088 (the user CLAUDE.md block ALSO points at `references/sandbox-troubleshooting.md` — same single-source-of-truth pattern). PRD: `docs/prd/stage-19e-user-context-onboarding.md`.

---

### ENH-090: Enterprise-deployments reference for hook-disabled / permission-restricted Claude Code installs

**Status:** ✅ Shipped v0.6.6 (Sprint 5 close-out 2026-05-04). New `skill/references/enterprise-deployments.md` shipped via the skill installer. Four sections: mechanism dependency map, common enterprise restrictions (hooks disabled / restrictive Bash allowlist / locked-down ~/.claude/ / custom CLAUDE.md authority), what still works (hook-free path), reporting checklist. ENH-088's managed CLAUDE.md block now points at this reference for users hitting policy-restricted installs.
**Priority:** Medium (documentation; unblocks enterprise users hitting policy-driven failures)
**Filed:** 2026-05-03

**Problem.** Enterprise Claude Code installs commonly: disable hooks, lock down `settings.json` to managed templates, restrict `permissions.deny` policies (which can block `Bash(duo:*)` patterns), and occasionally manage `~/.claude/skills/` from a central location. Today, Duo has no consolidated reference explaining which Duo features work hook-free, what may be policy-restricted, and what to do about it. Users hitting a policy-driven block have to piece it together from `sandbox-troubleshooting.md`, the install banner output, and trial-and-error.

**Design.** New file `skill/references/enterprise-deployments.md`, ~150-200 lines, with four sections:

1. **Mechanism dependency map.** Table of Duo's user-context mechanisms classified by hook-dependence and settings.json-dependence. Pulled from Stage 19e PRD § 2.
2. **Common enterprise restrictions and impact.** Hooks disabled (SessionStart hook silently skipped → no impact on in-Duo priming because the PATH shim is load-bearing). Restrictive `permissions.deny` (e.g. `Bash(duo:*)` may need explicit allowlist additions in the org's settings — directs users to their admin if blocked). Managed `~/.claude/skills/` (rare; Duo's installer would fail at write time with a clear error message).
3. **What still works in restrictive environments.** PATH shim priming (no hook needed), skill discovery, subagent discovery, the user CLAUDE.md managed block from ENH-088.
4. **Reporting checklist.** What logs to capture, what to share with the user's IT/admin, what to send upstream as a Duo issue.

**Affected files:**
- `skill/references/enterprise-deployments.md` (new)
- `skill/references/sandbox-troubleshooting.md` (one-line cross-reference for users hitting policy-driven blockers)

**Cross-ref:** Stage 19b (the SessionStart hook explicitly designed as redundant safety net for this reason). ENH-088 (managed block points at `references/` directory; this doc joins that surface). PRD: `docs/prd/stage-19e-user-context-onboarding.md`.

---

### ENH-091: Place caret at end of body (after existing content) when opening a freshly-created canvas

**Status:** 🟡 **DEFERRED indefinitely per owner directive (Sprint 9 walk-2, 2026-05-07).** Walk-2 traces showed every `[ENH-091 seed] APPLIED` was followed by `[ENH-091 wire-exit] {startContainerName: 'P', startOffset: 0, ...}` AND `[ENH-091 seed] post-rAF check {stillInSeededP: true, ...}` — meaning the seed sticks across the next animation frame. But typing still landed in the H1 title, not the empty <p>. So the override fires AFTER rAF (after Chromium's internal layout pass) — unfixable without a different architectural approach (e.g. handling the first keystroke ourselves and re-routing it; or rebuilding the canvas DOM so there's no H1-first-focusable surface).

Owner directive (walk-2): *"this is a low priority bug and we should not revisit for a LONG time unless the console provides a smoking gun and obvious fix; please remove from this sprint."* Done — instrumentation stays in code (cheap to keep, helps a future investigator), tasks.md status flipped to deferred, no further sprint-9 work. Recommend: pick this up only when a Chromium update changes layout timing OR when someone has an architectural-rewrite proposal.

**Walk history (kept for reference):**
1. Walk-0 (v0.6.8): added `seedCaretInEmptyParagraph` helper; smoke showed caret moved from "offset 0 of body" to "end of title" — partial regression.
2. Walk-1 (Sprint 9): rebuilt detector to handle the `<br>` placeholder; added 12 vitest fixtures + diagnostic traces. Walk-1 owner: "no console output" — `console.debug` was hidden by DevTools default filter.
3. Walk-2 (Sprint 9 walk-1 fix): flipped traces to `console.log`; corrected manifest verb to `duo html new`. Walk-2 traces showed seed APPLIES + sticks across rAF, but override still wins — Chromium-internals timing.
4. Sprint 9 walk-2 outcome: deferred per owner directive.

**Verification owed when owner returns.** Open Duo's renderer DevTools, create a fresh canvas (`duo edit --canvas /tmp/foo.html` against a non-existent path — the renderer creates boilerplate). Type a single character. Read the console for the three trace lines. The output pinpoints the override.

  **Attempt 1 (e203b7c, walk-1).** New `seedCaretInEmptyParagraph` helper at [renderer/components/Page/caretSeed.ts](renderer/components/Page/caretSeed.ts) called from [RenderedPage.tsx](renderer/components/Page/RenderedPage.tsx)'s `wire()` after `body.focus()` fires. Detection: `<main>` or `<body>` root has `<h1>` first + single trailing empty `<p>` + no content between. On match, repositions caret inside the empty `<p>`. 11 vitest fixtures green. Walk-1: caret moved from offset-0-of-body to end-of-title (a regression, not a fix).

  **Attempt 2 (4f9f60c, walk-1 rev2).** Hypothesized Chromium auto-inserts `<br>` placeholder into empty contentEditable blocks → detector bailed because `<br>` is ELEMENT_NODE not TEXT_NODE. Fix: detector now accepts a single `<br>` child as the "empty" marker; switched range creation to `setStart(<p>, 0)` to sidestep Chromium's "round to nearest text position" behavior. 12 vitest fixtures (was 11). Walk-rev3: same symptom as walk-1 — caret on title line. Fix didn't help.

  **What's left to investigate.** The seedCaretInEmptyParagraph helper has correct unit-test coverage (12 fixtures pin the seed/no-op boundary in jsdom) but doesn't successfully reposition the caret in the live iframe. Hypotheses for next sprint:
  - **iframe focus race.** `body.focus()` runs synchronously, then seed runs, but Chromium's contentEditable focus logic may schedule a microtask that overrides our manual selection back to "first focusable text" (= start of H1).
  - **Selection isn't applied in time.** The seed runs inside the iframe's window, but the iframe may not yet have the OS-level focus chain Chromium needs to apply `getSelection().addRange()`.
  - **Detector firing on the wrong frame.** wire() fires on iframe load; maybe `doc.body` doesn't yet match the boilerplate when the seeder runs.
  - **A different code path is overriding.** Perhaps the "auto-stamp IDs" pass or some other wire() step moves the cursor after we set it.

  **Recommended next-sprint approach.** Add `console.debug('[ENH-091]', { detected, sel: doc.getSelection()?.toString(), focusNode: doc.getSelection()?.focusNode?.nodeName })` at the top of seedCaretInEmptyParagraph and at `wire()` exit. Reproduce live. The actual position the cursor ends up in (vs. where the seed sets it) will name the override.
**Priority:** Low (small QOL, not a blocker; current behavior is "caret at offset 0 of body" which sits BEFORE the boilerplate `<h1>` heading).
**Filed:** 2026-05-04.

**Owner observation (verbatim):** *"when I `duo html new /tmp/p5-v4.html`, in the resulting html canvas, the cursor is at the beginning of the empty doc; it would be nice if it was at the end"*

**Owner constraint:** *"I don't want you to design anything too rube goldberg to accomplish this, but it is an ENH I want you to file."*

**What's wanted.** When a new canvas opens (via `duo html new` OR ⌘N save-as `.html`), place the caret AT THE END of the existing body content — typically inside the empty `<p>` after the boilerplate's `<h1>title</h1>`. Today the caret lands at offset 0 of body, which puts it BEFORE the `<h1>` — typing immediately would prepend characters to the title, not start the body.

**Why this is QOL, not a paper cut.** The user can click into the empty `<p>` after the heading and start typing — same gesture they'd do anyway. But auto-placing the caret in the right spot is one less click on the most common new-canvas flow.

**Implementation sketch (keep it simple per owner direction).**

The caret-placement code likely lives in `renderer/components/Page/PageTab.tsx` or `renderer/components/Page/RenderedPage.tsx` — wherever the iframe gets its initial focus on first load. Look for where the iframe body's contentEditable is set and the first selection is established.

The cleanest implementation: detect "fresh canvas" (e.g., `data-duo-just-created` attribute set by the new-file commit handler, or the existing first-mount check) and on the iframe ready event, find the LAST block-level child of `<main>` (or `<body>` if no main) and place the caret at offset 0 of its content (or end if it has content).

For the boilerplate `<h1>title</h1><p></p>`, the last block is the empty `<p>`. Caret at offset 0 of that `<p>` = inside the empty paragraph below the heading. ✓

**Affected files (estimated):**
- `renderer/components/Page/PageTab.tsx` — likely where initial focus is wired (handleReady hook).
- `renderer/components/Page/RenderedPage.tsx` — possibly the iframe load handler.
- `shared/html-boilerplate.ts` — could optionally stamp a `data-duo-just-created` attr on the empty `<p>` for clean detection (or use position-based logic).

**Out of scope:** existing canvases (where the user opens a previously-saved .html) — they get whatever the prior saved cursor state was, OR offset 0 of body if no saved state. This ENH is specifically about the *fresh* canvas path.

**Cross-ref:** BUG-070 (cursor-doesn't-land-on-fresh-canvas — different bug, fixed v0.6.4 via about:blank guard; that fix made the caret LAND, this ENH refines WHERE it lands). `shared/html-boilerplate.ts` (the boilerplate shape this design assumes).

---

### ENH-092: Playground state + DOM-reactivity primitives (load-bearing for ENH-043 meta-initiative)

**Status:** ❌ Won't do — closed 2026-05-04 (Sprint 5 scoping). Owner direction post v0.6.5 cut: future-Claude is a capable coder authoring playgrounds collaboratively with the user; the existing `make-playground.md` skill (376 lines) already documents how to use the existing 9-verb action vocabulary + `data-payload-from` form-value capture. State save/restore + tally rendering + composition are trivially expressible as inline JS in a browser-pane page (where scripts are allowed) — they don't need new primitives. Building a binding-language / DSL / opinionated-shorthand layer would be "pre-chewing future-Claude's meal" and would just get bypassed when the ceiling proved too low. The actual missing piece is ENH-094 (extending the existing runtime to browser-pane pages so they can fire `duo:event` live), not new primitives. Closed without code changes.
**Priority:** High (load-bearing for ENH-043; without this, playground primitives can only fire one-shot host actions, not drive interactive pages).
**Filed:** 2026-05-04.

**Problem.** Playground vocabulary today is "click → fire one structured action to host." That covers `claude:spawn`/`terminal:send`/`browser:open`/etc. — but doesn't cover the DOM-side state + reactivity that any non-trivial interactive page needs (smoke walks, sprint-plan worksheets, retros, lesson progress trackers, agent dashboards). Today every such page reverts to custom inline JS, defeating the point of the primitive layer.

**New verbs (all run page-side, no host round-trip):**

**State (localStorage-backed, page-scoped key auto-derived from URL hash + path):**
- `state:save` — `data-key="..."` writes the current form state (or a single value via `data-value="..."`) to localStorage under the page-scoped key.
- `state:restore` — explicit restore (rare; usually auto-runs on page load via a `data-restore-on-load` directive).
- `state:set` — `data-key="..." data-value="..."` sets a named value.
- `state:get` — `data-key="..." data-target-attr="value"` reads a named value, writes to a target element's attr.
- `state:wipe` — clears all state under the page key. Used by "Clear saved" buttons.

**DOM reactivity (declarative bindings, no JS):**
- `data-bind-class="<input-name>:<class-template>"` on any element — the element's class is recomputed when the named input changes. Template syntax: `is-{value}` produces `is-pass` / `is-fail` / `is-skip` from radio values. Replaces the smoke walk's `tally()` per-card class swap.
- `data-bind-text="<expression>"` — element's text content is recomputed when referenced inputs change. Expression supports basic counts: `count(items, where=result==pass)`. Powers the live tally.
- `data-bulk-set="<input-name>:<value>"` on a button — clicking sets every input matching `<input-name>` to `<value>`. Replaces "Mark all PASS."

**Implementation surface (estimated):**
- `shared/host-api.ts` — extend `PlaygroundAction` discriminated union (or carve out a new `PlaygroundDomDirective` parallel — TBD per design pass).
- `renderer/components/Page/playgroundActions.ts` — extend the listener registry. State verbs go through localStorage directly (no host round-trip). DOM-bind directives are listener-installed at runtime.
- `shared/types.ts` — type updates if new IPC channels.
- `cli/duo.ts` — none (these are page-side, not CLI-driven).
- `skill/playground-interaction.md` (or new sibling) — document the new verbs.
- `agents/duo.md` cheat-sheet — entries for any agent-relevant new verbs.
- New unit tests if any pure-function shape (e.g. expression parser).

**Effort estimate:** 1–2 sprints. Real architectural work + careful API design (the verb names + payload shapes are user-facing once shipped).

**Cross-ref:** ENH-043 (the meta-initiative this enables). ENH-093 (composition + clipboard — the next layer up). ENH-094 (browser-pane runtime injection — the third leg). Stage 27 (the canvas-authoring vocabulary this extends).

---

### ENH-093: Playground composition + clipboard primitives (load-bearing for ENH-043)

**Status:** ❌ Won't do — closed 2026-05-04 (Sprint 5 scoping; same reasoning as ENH-092). Composition / clipboard / send-to-Claude are already expressible: clipboard via `navigator.clipboard.writeText` from inline JS; send-to-Claude via `window.duoSendResult` (FOLLOWUP-007 binding, separately tracked); JSON snapshot of state is a 5-line `JSON.stringify(captureState())`. No new primitives warranted. The reframe to event-driven flow (live `duo:event` emission from page-side, Claude subscribed via `duo events --follow`) makes the batch composition pathway secondary anyway — it stays as a fallback for "user wants the result as text outside Duo," which the existing smoke-walk inline JS already covers. Closed without code changes.
**Priority:** High (load-bearing for ENH-043).
**Filed:** 2026-05-04.

**Problem.** Even with state + DOM reactivity (ENH-092), playground pages have no way to gather form state into a structured result and copy it to clipboard or send it to Claude. Smoke walks are the canonical case — at the end of a walk, the user clicks "Copy results" and gets a formatted text payload (header + per-item PASS/FAIL with notes + summary + optional misc-notes block). Today this is custom JS inside `worksheet/generate.mjs`. After ENH-093 it becomes a declarative recipe.

**New verbs:**

**Composition:**
- `compose:result` — `data-format="..."` walks the page's form state into a structured payload using a format directive. Format directives reference named inputs via `{<name>}` and array iteration via `{#items}...{/items}`. Output is a single string (markdown-flavored by default). Reusable across smoke walks, sprint-plan worksheets, retros.
- `compose:json` — same walk, but output is JSON. For agent-driven downstream consumers.

**Clipboard + send:**
- `clipboard:copy` — `data-text="..."` (literal) or `data-from-compose="..."` (reference a `compose:*` directive id) writes payload to clipboard via `navigator.clipboard.writeText`. Page-side; no host round-trip.
- `host:send-to-claude` — `data-from-compose="..."` routes the payload through `window.duoSendResult` (FOLLOWUP-007 binding) with clipboard fallback. This IS a host round-trip but is page-initiated.

**Format-directive design questions (decide during implementation):**
- Templating syntax — `{name}` simple substitution + `{#section}…{/section}` block iteration is enough for smoke walks. No conditionals / arithmetic in v1. Slippery slope.
- How to reference a directive — `id="result"` on the `compose:result` element + `data-from-compose="result"` on the consumer. Or implicit chaining if there's only one composition per page.
- Serialization shape — markdown by default; JSON via `compose:json` opt-in.

**Implementation surface:**
- `renderer/components/Page/playgroundActions.ts` — extend handler registry. Composition runs page-side (walk DOM → format string). Clipboard hits browser API. `host:send-to-claude` calls the existing `window.duoSendResult` binding (or its CDP fallback).
- `shared/host-api.ts` — `PlaygroundAction` union extension.
- `skill/playground-interaction.md` — document the format directive syntax.
- Skill docs reference how to author each verb.

**Effort estimate:** 1 sprint after ENH-092 ships.

**Cross-ref:** ENH-043 (meta). ENH-092 (depends on state + DOM). FOLLOWUP-007 (the `duoSendResult` binding this consumes; FOLLOWUP-007 should ship before or with ENH-093).

---

### ENH-097: Playground/canvas modality lock — `duo edit --canvas` override + right-click "Edit in canvas"

**Status:** ✅ **FIXED** in v0.6.8 (Sprint 8 Phase 3 prelude, 2026-05-06). Doc-side codification + canvas-template/lesson-pack migration shipped earlier this session (commit `f4548ff`); code-side override path lands in this commit:
- **CLI:** `duo edit --canvas <path>` and `duo view --canvas <path>` parse the flag and forward `mode: 'canvas'` through the socket. Help text + skill cheat-sheets + agents/duo.md + CLI-COVERAGE.md updated. CLI binary rebuilt.
- **IPC:** `IPC.NAV_VIEW` / `IPC.NAV_EDIT` payloads accept either a bare path string (legacy) or `{ path, mode }` (new). Backwards-compat is preserved — preload.ts handler narrows on `typeof === 'string'`.
- **Renderer:** `openFileSmart(path, title, mode?)` — the explicit `'canvas'` override wins over `<meta duo-open-in>` and routes the file straight to canvas iframe (kind: 'page'). Subscribers in App.tsx (`nav.onView`, `nav.onEdit`) thread the `mode` through.
- **UI:** Right-click an `file://...html` browser tab → "Edit in canvas" entry appears (gated on path resolving to a local HTML file). Click closes the browser tab and re-opens the file in canvas mode.
- 239/239 tests green; typecheck clean.
**Priority:** **Medium**.
**Filed:** 2026-05-06.
**Priority:** Medium — codifies a vocabulary lock owner identified as a confusion source. Doc-side changes already committed; code-side changes are the override path that gives users a way to edit playground source after the modality default routes everything to browser mode.
**Filed:** 2026-05-06.

**Background.** Owner clarification 2026-05-06: a playground opens in the browser pane (interactive — scripts run, buttons fire). A canvas (HTML tab in canvas iframe) is editable but inert (scripts blocked, buttons render but click as cursor placement). The user can EDIT a playground by opening the same file in canvas mode — that's the override. Codifying both in docs and in code reduces the long-standing confusion where playgrounds without `duo-open-in: browser` opened in canvas mode and the data-duo-action runtime parent-side-delegation was faking interactivity.

**Doc changes already committed (this turn):**

- [`skill/references/vocabulary.md`](skill/references/vocabulary.md) — modality lock section; "browser mode" / "canvas mode" / playground-defaults-to-browser semantics.
- [`skill/make-playground.md`](skill/make-playground.md) — modality lock callout in the header; worked-example template adds `<meta name="duo-open-in" content="browser">`; "Browser-pane playgrounds" section reframed from "for script-needing playgrounds" to "the default for all playgrounds."
- [`CLAUDE.md`](CLAUDE.md) — glossary `kind: 'page'` / `kind: 'browser'` row split; modality-lock paragraph documenting the override paths.
- All 5 canvas-action templates at `skill/examples/canvas-templates/` (button-card, dashboard, form-input, lesson-scaffold, paint-target) — added `<meta name="duo-open-in" content="browser">` so they default to browser mode (where their `data-duo-action` buttons can actually fire).
- All 9 shipped lesson canvases (`packs/intro-to-duo/canvases/welcome.html` + 8 in `packs/claude-code-basics/canvases/`) — same meta tag added so the existing first-launch lesson packs migrate to the new modality lock without behavior surprise. Canvas-iframe parent-side click delegation still works via ENH-094, so the lessons are double-covered during the transition.

**Code changes (this sprint, scope of ENH-097 v1):**

1. **`duo edit --canvas <path>` CLI override.** Today `duo edit` and `duo open` both route through `openFileSmart` which honors `<meta duo-open-in>`. Add a `--canvas` flag to `duo edit` (and `duo view` for symmetry) that forces canvas-iframe mode regardless of the file's declared default. Routing precedence: explicit flag > meta tag > kind-default. Touch points:
   - [cli/duo.ts](cli/duo.ts) — flag parser.
   - [shared/types.ts](shared/types.ts) — extend the IPC for `nav.edit` / `nav.view` to carry an override.
   - [electron/main.ts § sendEdit / sendView](electron/main.ts) — propagate the override through `IPC.NAV_EDIT` / `IPC.NAV_VIEW`.
   - [renderer/App.tsx § openFileSmart](renderer/App.tsx) — when override === 'canvas', skip the meta-tag branch and route to the file editor (`openFile`) directly.

2. **Right-click "Edit in canvas" on `file://` browser tabs.** When the active browser tab's URL starts with `file://`, the right-click menu adds an "Edit in canvas" entry. Click → calls the same canvas override (open the file in canvas mode as a new working-pane tab). Touch points:
   - [renderer/components/BrowserPane.tsx](renderer/components/BrowserPane.tsx) (or wherever browser-pane right-click is wired) — menu item gated on `tab.url.startsWith('file://')`.
   - Reuses `openFileSmart(path, title, { mode: 'canvas' })` from item 1.

3. **Symmetric "Open in browser" for canvas tabs that have a file path.** When the active working tab is `kind: 'page'` and its source file has `duo-open-in: browser`, surface a right-click "Open in browser" entry that closes the canvas tab + opens the same file in the browser pane. Lower priority than items 1 + 2; can defer if scope tight.

**Acceptance:**
1. `duo edit --canvas ~/.claude/duo/help/faq.html` opens the FAQ in canvas mode (editable, scripts blocked) even though the file declares `duo-open-in: browser`.
2. With a smoke-walk page open in browser pane, right-click → "Edit in canvas" opens the same file as a `kind: 'page'` working tab; buttons render but clicks place cursors.
3. Existing `duo open` / `duo edit` (without flag) still routes per `duo-open-in` meta — no regression.
4. The 9 shipped lesson canvases + 5 canvas templates open in browser mode by default after the doc commits land; existing canvas-iframe parent-delegation paths still work as a fallback for any playground without the meta.
5. `make-playground` skill scaffolds new playgrounds with the meta tag in the template head.

**Cross-ref:** [`skill/references/vocabulary.md`](skill/references/vocabulary.md) modality lock; ENH-094 (browser-pane action runtime that this lock leans on); ENH-052 (canvas → page rename that established the kind names this clarifies).

---

### ENH-096: Obsidian-vault-friendly editor (wikilinks + vault quick switcher + sidecar convention)

**Status:** 🟡 **PARTIAL — Sprint 9 walk-1 surfaced second root cause; walk-1 fix landed.** Tier A + B1 wikilink rendering shipped in v0.6.8; cmd+click click-handler fix landed in Sprint 9 walk-0; vault-root walker fix landed in Sprint 9 walk-1. Awaiting walk-2 verification. B2 + B4 still deferred.

**Sprint 9 walk-1 user-verified failure 2026-05-07.** Owner ran the smoke walk; cmd+click was still no-op. Owner-provided console log (`/Users/geoffreydudgeon/Downloads/localhost-1778149539006.log`) showed the click handler IS firing AND the dispatch IS reaching the App.tsx listener — every cmd+click logged `[ENH-096] No vault root found; cannot resolve wikilink: <name>`. So the walk-0 click-handler fix was correct + working; the bug surfaced was downstream in `findVaultRoot`.

**Sprint 9 walk-1 fix (2026-05-07).** `findVaultRoot` was using `window.electron.files.exists` to detect `.obsidian/`. But `filesService.exists` is documented (BUG-039 semantic — used by session-restore to drop tabs whose FILES were deleted) to return true ONLY for regular files. `.obsidian/` is a DIRECTORY → exists returned false → walker climbed past every real vault root and reported "no vault." The pre-fix comment in App.tsx even said "exists returns true for either file or directory presence" — that assumption was wrong; the implementation strictly checks `st.isFile()`. Fix: added a sibling `filesService.dirExists(absPath)` (returns `st.isDirectory()`) + IPC channel `FILES_DIR_EXISTS` + preload bridge + host-api type. Switched `findVaultRoot` to call `dirExists` instead. Total plumbing: `electron/files-service.ts § dirExists`, `shared/types.ts § IPC.FILES_DIR_EXISTS`, `electron/main.ts § FILES_DIR_EXISTS handler`, `electron/preload.ts § files.dirExists`, `shared/host-api.ts § dirExists type`, `renderer/App.tsx § findVaultRoot`. Existing exists() left strictly file-only (BUG-039 semantic preserved).

**Sprint 9 walk-0 fix (2026-05-07, summary).** Click-handler fix — extracted `resolveWikilinkTargetAtClick` helper handling text-node targets via parentElement + pos-based decoration fallback. 7 vitest fixtures green. Owner walk-1 confirmed click handler now reaches the resolver.

**🔴 SPRINT 9 P0 — Owner directive at v0.6.8 cut (2026-05-06):** *"wikilinks is urgent for next sprint as we only have half a feature and it could confuse users."* Visual decoration without working navigation is a confusing half-state — the link styling implies clickable behavior that doesn't fire. Sprint 9 must close B1 to a fully-working state OR strip the decoration entirely (revert to plain `[[…]]` text) to avoid the false affordance.

**Verification owed (UI smoke).** Open a markdown file with `[[…]]` wikilinks inside an `.obsidian/`-marked folder. Cmd+click a wikilink. Expected: target file opens. Test vault available at `/tmp/wikilink-diag/test-vault/Index.md` (auto-generated during the Sprint 9 diagnostic).

**Walk-1 fix (66f9b09).** Hypothesized root cause was case-sensitive resolver — `'other-note' === 'Other Note'` → false → silent no-op. Added `normalizeWikilinkName(name)` helper (lowercase + `-`/`_`/whitespace → single space, more forgiving than Obsidian itself). Applied on both sides of the BFS comparison. 8 vitest fixtures green. **Walk-rev3 verdict:** symptom unchanged. The resolver fix didn't help — meaning the click handler isn't reaching the resolver at all. The dispatched `duo-wikilink-open` window event is either not firing or App.tsx's listener isn't picking it up.

**What's left to investigate.** [WikilinkDecorations.ts § handleClick](renderer/components/editor/extensions/WikilinkDecorations.ts) is supposed to fire on cmd/ctrl+click on a span with `[data-duo-wikilink-target]`. Hypotheses for next sprint:
  - **ProseMirror plugin order — another handleClick claims first.** TipTap's Link extension (`openOnClick: false` is set) shouldn't claim. But there are many extensions in MarkdownEditor.tsx; one of them may return `true` from handleClick before WikilinkDecorations gets a turn.
  - **`event.target.closest()` returns null.** If the click target is a text node (not the styled span), `closest` returns null → handler bails. Try walking up via `event.target.parentElement?.closest(...)` or use ProseMirror's `pos` parameter to look up the decoration directly.
  - **Decoration class isn't on the rendered DOM.** Verify with DevTools: is the `<span class="duo-wikilink" data-duo-wikilink-target="...">` actually present around the wikilink text in the live editor?
  - **window event isn't reaching App.tsx listener.** Add `console.debug('[ENH-096 click]', wikilinkTarget)` at dispatch + `console.debug('[ENH-096 receive]', e.detail)` at the App.tsx handler. The first one tells us the click handler fires; the second tells us the event reaches the listener.

**Recommended next-sprint approach.** Add the two `console.debug` lines, walk in DevTools, see which trace fires (or doesn't). 30-second diagnosis. The visual decoration renders fine (steps 1-2 PASSED in both walks); the issue is purely the click→navigation path.

**Original (pre-walk-1) fix description follows.**
- **A1 — sidecar convention doc.** Two new entries in [help/faq.html § Working with files](help/faq.html): "Can I open my Obsidian vault in Duo?" + "What are the .duo.json files next to my notes?" Covers what works, what doesn't, and the `*.duo.json` gitignore recommendation for git-tracked vaults.
- **A4 — `.obsidian/` watcher ignore.** [files-service.ts § watch](electron/files-service.ts) chokidar config now ignores `.obsidian/`, `.git/`, and `node_modules/` at the watcher level. Pre-emptive against Obsidian's frequent `workspace.json` writes if a user manually expands the navigator's hidden-files toggle. (`.obsidian/` was already hidden from the navigator by Stage 10's dotfile filter.)
- **A5 — wikilink no-op verify.** tiptap-markdown's default config (`html: false`, `breaks: false`, no Wikilink mark in StarterKit) round-trips `[[…]]` literals verbatim through save. Confirmed by inspection — the WikilinkDecorations plugin (B1) is purely a render-time decoration and never mutates the source.
- **B1 — wikilink rendering + cmd+click resolution.** New [renderer/components/editor/extensions/WikilinkDecorations.ts](renderer/components/editor/extensions/WikilinkDecorations.ts) ProseMirror plugin scans the doc on every transaction for `[[Page Name]]` patterns and decorates each match with `class="duo-wikilink"` + a `data-duo-wikilink-target` attribute. Atelier-styled (accent-soft tinted background, accent-ink text). cmd/ctrl+click fires `duo-wikilink-open` window CustomEvent. App.tsx resolver walks up from the active file's directory until it finds an `.obsidian/` (vault root, depth-cap 16), then BFS-searches the vault for the target file (name-first, dotdir-skipping, scan-cap 2000 entries). Path-bearing targets (e.g. `[[subdir/Page]]`) try `<root>/<target>.md` / `<root>/<target>` / `<root>/<target>.html` literal forms first. Plain click stays cursor-placement so source-edit isn't blocked.

**Sprint 11 — B2 + B4 + ENH-105 SHIPPED (2026-05-08, after walks 1-3):**
- **B.2 wikilink autocomplete** ✅ — `@tiptap/suggestion` + `@tiptap/extension-mention` deps + new `WikilinkSuggestion` extension with custom `findWikilinkMatch` (rejects mid-`[[Foo]]` text near caret). Custom popover lifecycle with `dismissed` flag for clean Enter dismissal. Verified live walk-3.
- **B.4 vault quick switcher (⌘O)** ✅ — `VaultQuickSwitcher` overlay sourcing the same vault index. Walk-3 fix added `keyboard.reclaimFocus()` after pick so the new tab actually receives keyboard focus.
- **ENH-105 `@` mention** ✅ — parallel `AtMention` extension with `findAtMentionMatch` (rejects mid-word `@` for email-address protection). Inserts canonical `[[wikilink]]` form so vault round-trip is unified.
- **Shared substrate**: `vaultIndex.ts` (useVaultIndex hook + scoreVaultFile + rankVaultFiles, 12 unit tests), `SuggestionPopover` primitive, `suggestionMatchers.ts` (17 unit tests).

**Original deferred list (now shipped):**
- ~~**B2 — wikilink autocomplete on `[[`.** Needs a popup overlay coordinated with TipTap's input handler — substantively more work than the decoration plugin. Filed as a future scope item under the same ENH-096 entry. **Recommended approach (Sprint 10 research, 2026-05-07):** use TipTap's first-party [`@tiptap/suggestion`](https://tiptap.dev/docs/editor/api/utilities/suggestion) utility (the same primitive that backs the `Mention` extension) rather than hand-building the popover. Pairs with B4 + ENH-105 (`@` autocomplete) on the same shared primitive. NPM-published, actively maintained — way better than the `aarkue/tiptap-wikilink-extension` GitHub repo (7 commits, no npm publish, no Obsidian-vault-aware features).~~ **Shipped Sprint 11.**
- ~~**B4 — `⌘O` vault quick switcher.** Logic shape is well-understood (TabSearchPalette UI + a vault-walking source). Defer until B2 lands so they can share the popup primitive. Owner can manually navigate via the existing FileTree until then. **Note:** B4 is closer to a renderer-level overlay than a TipTap suggestion (it's not text-position-anchored), so it shares the FUZZY MATCH source with B2 + ENH-105 but has its own UI shell (resembling ENH-080's `⌘⇧A` palette).~~ **Shipped Sprint 11.**
- **A3 — `@testing-library/react` infra + frontmatter round-trip fixtures.** Defer alongside FOLLOWUP-009's existing deferral note — the infra cost doesn't earn its keep until there's a concrete async-orchestration test the smoke walk can't cover.

**Library / framework research (Sprint 10, 2026-05-07).** Three candidate approaches for raising Obsidian fidelity were evaluated:
1. [`aarkue/tiptap-wikilink-extension`](https://github.com/aarkue/tiptap-wikilink-extension) — TipTap-native but stagnant (7 commits, no npm publish, no Obsidian-vault-aware resolution). NOT a worthwhile dependency.
2. [`erykwalder/lezer-markdown-obsidian`](https://github.com/erykwalder/lezer-markdown-obsidian) — high-fidelity Obsidian-flavored markdown PARSER, but for `@lezer/markdown` (CodeMirror 6's parser stack). Adopting requires migrating the editor framework from TipTap → CodeMirror 6. Not a small change.
3. **Stay with TipTap, lean on first-party `@tiptap/suggestion` for autocomplete features.** Recommended path. Hand-rolled wikilink rendering already shipped (B1 — see WikilinkDecorations.ts). The remaining Obsidian work is composable with TipTap primitives: callouts → custom Mark/Node, tag pills → Decoration plugin, math → KaTeX integration via existing CodeBlockLowlight pattern, mermaid → similar.

**Architectural note.** Obsidian itself uses CodeMirror 6 — every Obsidian editor primitive lives in the CodeMirror ecosystem. If Duo ever needs Obsidian-grade editing fidelity (e.g. live-preview of complex markdown trees, deep plugin compatibility), the architecturally honest answer is to migrate the editor surface. That's a multi-sprint shift; today's hand-rolled TipTap path is the right pragmatic call. Revisit if user research surfaces "I tried Duo for my vault and the editor feels weird compared to Obsidian" as a recurring complaint.

**Owner-locked design calls (resolved per AUQ on 2026-05-06):**
1. Vault root detection: walk up from active file's directory until `.obsidian/` is found (cap 16 levels). Fall back to no-op if no ancestor matches.
2. Wikilink resolution: name-first, vault-wide BFS. First-match wins on basename (without extension).
3. Sidecar location: same-folder. Documented in faq.html with `*.duo.json` gitignore guidance.
4. `⌘O` policy: deferred to B4. Existing chord behavior unchanged.

**Priority:** Medium.
**Filed:** 2026-05-06.
**Priority:** Medium — opens Duo to the Obsidian audience (a non-trivial slice of would-be Duo users maintain markdown vaults in Obsidian today). Defensive baseline (Tier A) is XS effort and prevents trust erosion; rendering-layer affordances (Tier B subset) ship the most-noticed gaps.
**Filed:** 2026-05-06.

**Background.** [Research doc at `docs/prd/obsidian-vault-research.md`](prd/obsidian-vault-research.md). The basic round-trip already works thanks to Stage 11 frontmatter pass-through, BUG-085 external-write reconciliation, and dotfile-hidden navigator. What breaks is the visual + invocation layer: wikilinks render as plain text, no vault-wide quick switcher, sidecars accumulate next to notes without user-facing documentation.

**Scope (Sprint 8 phase boundary):**

- **Tier A — defensive baseline.**
  - **A1** Sidecar convention doc — faq.html + what-duo-does.html addition explaining `<note>.md.duo.json` sidecars; recommend `*.duo.json` in `.gitignore` for git-tracked vaults.
  - **A3** Frontmatter round-trip vitest fixtures for Obsidian-style YAML (`tags: [...]`, `aliases: [...]`, `cssclasses: [...]`, custom properties); folds into FOLLOWUP-009's `@testing-library/react` infra.
  - **A4** File watcher ignore rule for `.obsidian/` (separate from navigator hide).
  - **A5** Wikilink no-op verification — confirm tiptap-markdown round-trips `[[…]]` cleanly; smoke walk item.
- **Tier B subset — distinctive Obsidian features.**
  - **B1** Wikilink rendering — custom TipTap node/mark recognizing `[[Page Name]]`, rendered as Atelier-styled clickable inline span; `cmd+click` opens the linked file from the resolved vault root.
  - **B2** Wikilink autocomplete on `[[` — fuzzy-search vault notes; Tab/Enter to insert; Esc dismisses. Shares a base palette implementation with ENH-080 + B4.
  - **B4** Vault quick switcher (`⌘O`) — fuzzy file search across the entire vault root; distinct from ENH-080's open-tab search; shares the palette base.

**Deferred to follow-up (filed separately if/when sprint scope warrants):**

- Tier B3 (inline tag rendering as clickable pills)
- Tier B5 (full-text vault search panel `⌘⇧F`)
- Tier C — backlinks panel, outline panel, daily notes shortcut, callout TipTap extension, properties panel (Stage 11 D15 already filed), math (KaTeX), mermaid
- Tier D — graph view, `.canvas` file support, reading-mode toggle, embed rendering, block references, plugin compatibility, theme compatibility (these are out of scope or indefinitely deferred)

**Pairs naturally with already-in-sprint:**

- ENH-080 (tab-search palette): same fuzzy-palette primitive; B2 + B4 reuse the base.
- FOLLOWUP-009 (testing-library/react infra): A3 fixtures land in the new test directory.
- Stage 21d (distro packs): an "obsidian-companion" distro pack (future sprint) ships Obsidian-tuned skills + canvas templates leveraging the editor affordances landing here.

**Open questions surfaced in the research doc (to settle before code):**

1. Vault root detection — walk up to `.obsidian/`? Use navigator CWD? Persisted "this is a vault root" mark?
2. Obsidian's "shortest path when possible" wikilink resolution — match it (name-first across vault, ambiguity warning) or use relative-path resolution?
3. Sidecar location for vaults — same folder as note (current) or centralized under `.obsidian/duo-comments/`?
4. Hotkey conflict policy — Obsidian's `⌘O` is the most likely contention; Duo's `⌘O` could be repurposed for vault quick switcher when a vault is detected.

**Acceptance (the smoke-walkable shape):**

1. Open an Obsidian vault folder via Duo's navigator.
2. Click any `.md` note — frontmatter intact (verified by save + reload).
3. `[[Other Note]]` wikilinks render as styled clickable spans; `cmd+click` opens the linked note in a new tab.
4. Typing `[[` opens autocomplete; Enter inserts.
5. `⌘O` opens vault-wide quick switcher; type to filter; Enter opens.
6. `.obsidian/` invisible in navigator (already-shipped).
7. Edit + save in Duo. Switch to Obsidian. Obsidian sees the changes. No frontmatter loss.
8. Smoke walk green; FOLLOWUP-009 tests cover frontmatter round-trip.

**Cross-ref:** `docs/prd/obsidian-vault-research.md` for the full surface map.

---

### ENH-095: Aux header — single ✕ button replaces ⇤ + ✕ pair

**Status:** ✅ **LANDED** in v0.6.7 (Sprint 7 rev6 follow-up, 2026-05-05). The aux header (file-aux in [WorkingPane.tsx § AuxHeader](renderer/components/WorkingPane.tsx) and browser-aux in [AuxBrowserSlot.tsx](renderer/components/AuxBrowserSlot.tsx)) now renders only the ✕ button. Tooltip / aria-label changed to "Move back to main". Both `onAuxClose` and `onAuxPromote` props in App.tsx now point at `splitViewPromote` so closing the split also promotes the aux'd content back to the main strip — the previous separate ⇤ button was redundant. Right-click "Move back to main" menu entry remains as a synonym in the file-aux header.
**Priority:** **Low** (UX paper cut — owner observed the two buttons were doing the same thing in browser-aux mode).
**Filed:** 2026-05-05 (rev6 walk PROCEDURAL-PHASE3C-PROMOTE notes — "in split view, the promote and 'X' buttons seem to do the same thing; let's get rid of promote, and ensure that 'X' functions like promote").

**Background.** Phase 3c shipped browser-tabs-in-aux. The browser-aux's onClose handler in App.tsx fired `releaseAuxTab` + `setAuxBrowserTab(null)` — the exact same effect as `splitViewPromote` for the browser case. Two visually distinct buttons doing the same thing. For the file-aux case the buttons differed (close cleared aux without re-opening; promote re-opened in main as a fresh tab) — owner directive was to make X always do the latter.

**Fix.** Wire both onClose + onPromote to `splitViewPromote`. Drop the ⇤ button render in both AuxHeader and AuxBrowserSlot. Tooltip on X now reads "Move back to main".

**Cross-ref:** Phase 3c (BUG-092 fix that introduced AuxBrowserSlot); BUG-095 / BUG-096 (sibling Phase 3c follow-ups).

---

### ENH-094: Inject the playground runtime into browser-pane pages via CDP

**Status:** 🆕 Filed (Sprint 4 close-out 2026-05-04 — playground architecture decomposition).
**Priority:** High (third leg of the ENH-043 meta-initiative — without this, playground primitives stay canvas-tab-only).
**Filed:** 2026-05-04.

**Problem.** The playground action runtime (`installPlaygroundActions(doc, opts)`) lives in the canvas iframe's `contentDocument` — it doesn't reach browser-pane pages. Smoke walks (and any worksheet that needs `<script>` execution privileges Chromium grants browser tabs but not canvas iframes) are hosted in browser tabs, so they can't access the playground vocabulary today. With ENH-092 + ENH-093 the verbs exist; this ENH puts them in scope for browser-pane pages.

**Mechanism.** Mirror the proven pattern of CDP-injected page-side runtimes:
- `SELECTION_OBSERVER_IIFE` (Send → Duo pill, Stage 15.2 — already shipped)
- `PATH_LINK_FORWARDER_IIFE` (`data-duo-path` clicks, ENH-039 — already shipped)
- `BROWSER_SEND_TO_DUO_BINDING` (Send → Duo pill click, BUG-006 v2 — already shipped)

New: `PLAYGROUND_RUNTIME_IIFE` injected on every CDP attach + on `Page.frameNavigated`. The IIFE installs the same delegated-click listener for `data-action="*"` that `installPlaygroundActions` does in the canvas runtime, and routes actions through a `Runtime.binding` (`duoPlaygroundAction(actionPayload)`) back to main, where `BrowserManager` forwards to the renderer over `IPC.PLAYGROUND_ACTION`. Renderer dispatches via `onPlaygroundAction` (the existing handler). Identical contract to the canvas-side runtime; only the delivery channel differs.

**Affected files (estimated):**
- `electron/cdp-bridge.ts` — new `PLAYGROUND_RUNTIME_IIFE` constant + `Runtime.addBinding('duoPlaygroundAction')` + `Runtime.bindingCalled` handler that emits to a single browser-side listener.
- `electron/browser-manager.ts` — wire the listener to `IPC.PLAYGROUND_ACTION`.
- `shared/types.ts` — IPC channel addition.
- `electron/preload.ts` — minimal pass-through if the renderer doesn't already subscribe via existing channels.
- `renderer/App.tsx` (or wherever browser-pane page hosts integrate) — connect the IPC channel to the existing `onPlaygroundAction` dispatcher used by canvas pages. ONE handler should serve both panes.

**Trust gate (cross-cuts ENH-094 + Stage 23 trust model):** Stage 23 limits canvas-action firing to files under `~/.claude/duo/` (path-restricted trust). For browser-pane pages, the same trust check needs to apply — only file:// URLs under trusted paths fire playground actions; arbitrary http(s) sites stay inert. Re-use the existing `isPathTrusted` check.

**Effort estimate:** ~1 sprint (CDP injection + IPC plumbing + trust check + browser-pane test surface).

**Cross-ref:** ENH-043 (meta). ENH-092 + ENH-093 (the verbs this exposes to browser pages). Stage 23 (canvas action vocabulary + trust model). Stage 15.2 / ENH-039 / BUG-006 (CDP injection precedents).

---

---

