# ENH-182 — Project-centric UX (the filter-layer model)

> **PRD + build plan.** Decisions locked **2026-05-25** (owner walk).
> This is the engineer-execution doc. **The design is already settled —
> build against the named assets in § 4, do not redesign from first
> principles.** Where this PRD and a design asset disagree, the asset (or
> the cited decision) wins; flag the conflict, don't silently re-invent.

## 0 · Cross-links (canonical sources)

| Artifact | Path | What it's authoritative for |
|---|---|---|
| Decision playground | [`docs/research/project-centric-ux.html`](../research/project-centric-ux.html) | D1–D12 outcomes + rationale; the live §5 filter demo |
| Rail-style deep-dive | [`docs/research/project-rail-style-study.html`](../research/project-rail-style-study.html) | R1 tile treatment, R2 color, R3 tile state; the project color system |
| Design assets dir | `docs/research/assets/project-filter/` | the rendered stills + GIFs referenced in § 4 |
| Atelier color tokens | [`skill/references/duo-atelier.css`](../../skill/references/duo-atelier.css) | the canonical `--project-*` hue tokens |
| Ledger | [`tasks.md` § ENH-182](../../tasks.md) | status + the locked-decision summary |

> The Notion mirror was **retired 2026-05-25** — the repo is the single
> source of truth.

## 1 · Goal

Make a **project** a first-class organizing primitive in Duo, modeled as a
**filter / lens** over a multi-project workspace — not a switcher. The
default stays today's behavior: one workspace holds files, terminals, and
canvas tabs from many projects at once. The new power is the ability to
**focus** one project: a thin left rail of project tiles; clicking a tile
hides the terminal + canvas tabs that don't belong to it and re-roots the
navigator; an always-present **All** tile releases the filter. Focus is a
non-destructive lens — nothing closes, it just hides.

This is **additive**: Duo has no `Project` object today, so there is nothing
to tear out (see § 5).

## 2 · Locked decisions (authoritative summary)

Full rationale + the rejected alternatives live in the playground. Binding
outcomes:

| # | Decision | Locked outcome |
|---|---|---|
| **D1** | The spine | **Projecthood gated, app open.** Work in any folder (a view-all state always exists); a folder becomes a *project* only if it's a git-repo root **or** has `CLAUDE.md`/`.claude/` **and** you're working in it. Not a front-door gate on the app. |
| **D2** | The primitive | Project = a folder you're **actively working in** (a terminal CWD set there, or one-or-more non-pinned tabs/browsers opened from it) **and** that is a git-repo root **or** contains `CLAUDE.md`/`.claude/`. Navigator right-click **"New project"** drops a `.claude/` (the declare action). |
| **D3** | Switcher surface | **Left filter rail only** for v1. ⌘P palette + title-bar breadcrumb **deferred**. |
| **D4** | Multi-project sessions | **Resolved by D8** — multi-project is the default; there is no single "active project" pointer, only the focus lens. |
| **D5** | Nesting | Active project = the **deepest** qualifying folder you're working in. |
| **D6** | Clone → project | **Automatic via D2** — a cloned repo's root qualifies the moment you work in it (git-root + working-in). No separate prompt. |
| **D7** | Workspaces | **Defer**; lean "workspace ⊃ projects" later. Don't build the container tier now. |
| **D8** | The reframe | **Filter / lens, not a switcher.** View-all default; click a tile to focus; click the active tile (or All) to release. While focused, **Ctrl-Tab cycles only the visible tabs**. |
| **D9** | The rail | **Left, auto-populated, Slack-style**; "quiet bloom" tile treatment. |
| **D10** | Filter scope | **Hide** unrelated terminal + canvas tabs (incl. browser-mode); **re-root** the navigator (NOT a hard tree filter — you can still navigate up/out). |
| **D11** | Corner case | Opening a file from another project while focused **auto-switches focus** to that file's project. |
| **D12** | Rail lifecycle | **Auto add/remove + user pin.** Tile appears when you start working in a qualifying folder, drops when its last tab closes; pin to keep. **Tile right-click menu:** Pin/Unpin + **"Close N terminals and M tabs"** (bulk-close with a live count; confirm when a terminal has a live process). |
| **R1** | Tile treatment | **Quiet bloom** — colored initials + underline on every tile; focused project blooms to full-hue fill + white notch. |
| **R2** | Color assignment | **Hash-stable** per project root (`hash(projectRoot) % 6`) + manual override. |
| **R3** | Tile state (v1) | **Minimal** — identity + selection only. Live-dot + open-count badge **deferred**. |

## 3 · The project model (from D1/D2/D5/D6)

- **Identity** = the absolute path of the project **root folder**. Everything
  else (git, CC dir, color) is a derived attribute, not identity.
- **Qualification (D2):** a folder is a project iff
  `(isGitRepoRoot(folder) || hasMarker(folder))` **and** the user is
  *working in* it, where `hasMarker` = presence of `CLAUDE.md` or `.claude/`,
  and *working in* = at least one terminal CWD, or one non-pinned working tab
  (editor/page/browser/image/pdf/json) whose path is under `folder`.
- **Membership:** a tab/terminal belongs to project `P` iff `P` is the
  **deepest** qualifying root that encloses the tab's path/cwd (D5). A tab
  under no qualifying root belongs to **no project** — it shows in All, and
  is hidden by every focus.
- **Color (R2):** one of the six **named** `--project-*` tokens
  (pine / harbor / iris / plum / rose / moss), chosen `hash(rootPath) % 6` in a
  fixed order; persisted override allowed. Defined in `duo-atelier.css`; **must
  be mirrored into the app's `globals.css`** before the rail can use them
  (§ 9 area 9).
- **Lifecycle (D12):** the set of rail tiles = the set of projects with ≥1
  open item, **plus** any pinned projects. Recomputed as tabs open/close.

## 4 · Design assets — build against THESE (do not redesign)

> This section exists because past builds have re-derived a look instead of
> using the agreed assets. **Each UI element below has exactly one source of
> truth. Use it.** Two assets are traps — read the "⚠️" notes.

| UI element | Authoritative asset | Notes / gotchas |
|---|---|---|
| **Rail placement** (left, ~54px, `All` on top then tiles) | `assets/project-filter/rail-left.png` + the live demo in playground **§5** | `rail-right.png` is the **rejected** option — left was chosen (D9). |
| **Tile treatment** (quiet bloom) | `project-rail-style-study.html` **R1**, option **B**; `assets/project-filter/rail-styles.png` (B is 2nd) | Unfocused = colored initials + thin underline on paper; focused = full-hue fill + white notch. Do NOT paint every tile (that's option A, rejected). |
| **Project color palette** (6 muted studio hues) | `assets/project-filter/palette-swatches.png` + `--project-*` tokens in `skill/references/duo-atelier.css` | Hues deliberately **skip the orange/amber band** so no project reads as the burnt-orange app accent. Assignment = hash-stable (R2). |
| **Tile state (v1)** | `assets/project-filter/tile-state.png`, **leftmost ("Minimal")** variant | ⚠️ The middle/right variants (Claude-live dot, open-count badge) are **deferred (R3)** — do **not** build them in v1. |
| **Focus transition** (All ↔ focus) | `assets/project-filter/filter-transition.gif` + playground §5 demo (`.chip.hide` collapse-&-reflow CSS is a working reference) | Collapse-&-reflow: non-member tabs shrink width to 0 + fade, navigator re-roots, focus chip appears in title bar. |
| **Out-of-project corner case** | **D11 card text** in the playground | ⚠️ `assets/project-filter/corner-case.gif` shows the **REJECTED** "pop back to All" behavior. The locked behavior is **auto-switch focus** to the opened file's project. Build auto-switch; the GIF is kept only as a record of the alternative. |
| **Tile right-click menu** | **D12 card text** | Items: Pin / Unpin · "Close N terminals and M tabs" (live counts). Reuse the existing renderer context-menu pattern (see § 6, area 10), don't hand-roll. |
| **All-projects default state** | playground §5 demo, `data-focus="all"` | Nav root shows the workspace root; every tab visible; no focus chip. |

The playground's §5 contains a **working CSS/JS implementation of the filter
interaction** (tile click → `setFocus()` → toggles `.hide` on non-member
chips, re-roots nav label, shows the focus chip). Treat it as the
interaction spec — port the behavior, restyled to the real components.

## 5 · Architecture (additive; current state → hook points)

Today "where am I" is three loosely-linked signals plus an orthogonal probe
(verbatim from the playground §1 grounding):

```
TabSession.cwd      per-terminal-tab launch dir
nav.state.cwd       navigator root, localStorage 'duo.nav.cwd'
   └─ follow-mode ─▸ moves to the active tab's cwd unless pinned
getGitStatus(cwd)   on-demand `git rev-parse --show-toplevel` → workTreeRoot
claudePresence      process-tree probe (no-pty | shell | claude)  ── orthogonal
```

There is **no `Project` type, no registry, no `~/.claude/projects` read, no
`CLAUDE.md` parsing** today (ENH-177's session-index read was reverted). So
the build introduces a new derived layer, it does not replace one:

- **New source of truth:** a `Project` derivation (a pure function over the
  open tabs/terminals + cheap fs probes) and a persisted slice for pins +
  color overrides (e.g. `~/.claude/duo/projects.json`, mirroring the
  existing duo-state store).
- The navigator root, new-tab cwd seed, and focus filter all **derive from**
  the focused project instead of free localStorage + follow-mode.
- Git work-tree-root detection + peer-repo scanning (BUG-135) already exist —
  reuse for `isGitRepoRoot`; add only a `hasMarker` fs check.
- ⚠️ **The one more-than-additive risk:** today's *workspace* switch is
  **destructive** (force-flush state, kill PTYs, tear down browser tabs,
  reload the renderer). A project **focus must be live + non-destructive** —
  it only toggles tab visibility + nav root. Do not route focus through the
  workspace-switch path.

> Exact files + line numbers for each hook point are appended in § 9 (filled
> from the code-map pass) — build steps below reference them by area number.

## 6 · Build plan (phased)

Each phase is independently shippable and smoke-walkable. Phases reference
code areas 1–10 (see § 9) and the § 4 design assets.

### Phase 0 — Project model + detection (no UI)
- Add `Project` shape to `shared/types.ts` (area 1): `{ root: string;
  name: string; isGitRoot: boolean; hasMarker: boolean; colorIndex: number;
  pinned: boolean }`. `name` defaults to root basename.
- Pure derivation `deriveProjects(tabs, terminals)` → membership map
  (deepest-root-wins, D5/§3) + the project set (D2 qualification).
- `hasMarker(dir)` fs check (`CLAUDE.md` | `.claude/`); `isGitRepoRoot` via
  the existing git detection (area 5).
- Persisted slice for pins + color overrides.
- **Acceptance:** unit tests for qualification + deepest-wins membership +
  hash-stable color. No visible change.

### Phase 1 — The rail, read-only (view-all + tiles)
- New `renderer/components/ProjectRail/` (sibling to the navigator). Left,
  ~54px, `All` tile on top, then one tile per derived project.
- **Design:** quiet-bloom tiles (§ 4 → R1/rail-styles.png), `--project-*`
  colors (§ 4 → duo-atelier.css), **minimal** state only (§ 4 →
  tile-state.png leftmost). No focus behavior yet — tiles render, `All` is
  selected.
- Mirror the six `--project-*` tokens into `renderer/styles/globals.css`
  (area 9 confirms they're skill-reference-only today — the app CSS has only
  `--accent`).
- **Acceptance:** rail shows correct tiles for the open set; colors stable
  across reloads; matches rail-left.png.

### Phase 2 — Focus filter (the payoff)
- Clicking a tile sets `focusedProject`; `All`/active-tile-again clears it
  (D8). Focus **hides** non-member terminal + canvas tabs (area 1) and
  **re-roots** the navigator (area 2) — not a hard tree filter (D10).
- Title-bar focus chip; collapse-&-reflow transition (§ 4 →
  filter-transition.gif + §5 demo CSS).
- **Ctrl-Tab cycles only visible tabs** while focused (area 1 / keyboard).
- **Acceptance:** smoke-walk the All↔focus round-trip; hidden tabs return on
  All; nav re-roots; Ctrl-Tab respects the filter.

### Phase 3 — Corner case + lifecycle + context menu
- **D11 auto-switch:** opening a file whose deepest root ≠ focused project
  switches focus to the new file's project. ⚠️ Build auto-switch, **not**
  the pop-to-All shown in corner-case.gif (§ 4).
- **D12 lifecycle:** tiles auto add on first open / auto remove when the last
  member tab closes; pinned tiles persist.
- **D12 tile right-click menu** (area 10 pattern): Pin/Unpin + "Close N
  terminals and M tabs" (live counts; confirm when a terminal has a live
  `claude`/process via `claudePresence`, area 4).
- **Acceptance:** smoke-walk auto-switch, pin survives close-all, close-all
  count is correct + confirms on live process.

### Phase 4 — CLI parity (CLAUDE.md § 4)
- `duo project` verb family mirroring the UI (full plumbing checklist:
  `shared/types.ts` `DuoCommandName`, `preload.ts`, `main.ts`,
  `socket-server.ts`, `cli/duo.ts` + `printHelp`, `skill/SKILL.md`,
  `agents/duo.md` cheat-sheet, `docs/CLI-COVERAGE.md`) — area 7:
  - `duo project list` — JSON of derived projects + which is focused.
  - `duo project focus <name|root>` / `duo project focus --all` — set/clear.
  - `duo project pin <name|root>` / `duo project unpin …`.
  - `duo project close <name|root>` — the bulk-close (D12).
- Rebuild the binary (`npm run build:cli`), `npm run sync:claude`.
- **Acceptance:** every rail action has a CLI counterpart; verbs in the
  agent cheat-sheet.

## 7 · Deferred / out of scope (do not build in v1)

- ⌘P quick-filter + title-bar project breadcrumb (D3).
- Workspace-contains-projects tier / any workspace migration (D7).
- Tile **Claude-live dot** + **open-count badge** + git-dirty indicator (R3).
- "Just browse / declare a folder with no marker" modal flows from the
  playground edges — declaration in v1 is only the navigator right-click
  "New project" → drop `.claude/` (D2). The richer scaffolding modal
  (add CLAUDE.md/agents.md/git checkboxes) is a later enrichment.

## 8 · Risks

- **Destructive switch path** (§ 5) — keep focus off it.
- **Membership ambiguity** for tabs under no qualifying root — spec'd as
  "no project, hidden by all focuses"; confirm that feels right in the walk.
- **Persistence + migration discipline** for the new pins/overrides slice.
- **Blast radius** — touches navigator root, new-tab cwd seed, the tab
  arrays, the title bar; all additive but central.

## 9 · Code map (hook points)

> Build steps in § 6 reference these by area number. Line numbers are
> approximate anchors (as of 2026-05-25) — confirm against the file.

**1 · Tab / terminal / working-tab state**
- `shared/types.ts:9–14` — `TabSession` (`id`, `title`, `cwd`, `kind: 'shell'|'claude'`). `cwd` is the per-terminal → project-root map key.
- `renderer/App.tsx` — live state: `tabs` (terminals) + `fileTabs` (working tabs) (~700–730); `pendingCwd` derived from navigator (`:265`). **These arrays are what Phase 2 filters** for focus mode.

**2 · Navigator + re-root**
- `renderer/hooks/useNavigator.ts:81–397`. localStorage key `duo.nav.cwd` (`:19`); `navigateTo(path)` (`:236`) is the re-root entry point (call `nav.actions.navigateTo(projectRoot)` on focus); persisted via effect (`:111`); follow-mode `pinned` (`:40`, toggled `:67`); `computePendingCwd` (`:386`).

**3 · Workspace switcher (the destructive path to AVOID)**
- `renderer/components/WorkspaceSwitcherDropdown.tsx:1–170` (ENH-171). Switch dispatches `window.electron.workspaceFile.openRecent(path)` (`:85`) → main does the destructive flush/kill-PTYs/reload. **Project focus must NOT go through this** — focus is a live visibility+nav-root toggle only.

**4 · claudePresence**
- `core/claude-presence.ts:1–150+` — `ClaudePresenceProbe`, `setTarget(pid, kind)` (`:46`), states `no-pty|shell|claude|starting`, 500ms poll (`:28`). Renderer: `renderer/hooks/useClaudePresence.ts:12–31` via `window.electron.terminal.onClaudePresenceChange()`; consumed in `TerminalPane.tsx:221`. Use for D12's "confirm before closing a terminal with a live process" (and the deferred R3 live-dot).

**5 · Git detection (for `isGitRepoRoot`)**
- `shared/host-api.ts:964–1089` — `GitStatusSnapshot` (`isRepo`, `workTreeRoot`, `branch`, `dirty`, …) (`:964`); `status(cwd)` (`:1071`); `scanReposIn()` peer-repo scan (`:1089`, BUG-135). **`isGitRepoRoot(dir) = status(dir).isRepo && status(dir).workTreeRoot === dir`.** Consumed in `FileTree.tsx:157–234` + `:630–660`.

**6 · Marker detection (for `hasMarker`)**
- `renderer/components/ProjectClaudeContext.tsx:1–180`. Candidate set at `:39` = `['CLAUDE.md', '.claude', 'tasks.md', 'AGENTS.md']`; detection at `:71–80` reads `nav.state.listings`. **For D2, `hasMarker` = presence of `CLAUDE.md` or `.claude/`** (a subset — `tasks.md`/`AGENTS.md` do NOT qualify a project on their own). Reuse the listing-read approach; currently cosmetic-only.

**7 · CLI plumbing (for the `duo project` family, Phase 4)**
- `cli/duo.ts` — verb dispatch `switch (cmd)` at `:337` (examples `:338–381`), `printHelp()` at `:1919`.
- `core/socket-server.ts:554–700+` — `handle(req)` case dispatch (e.g. `:569` navigate, `:591` open).
- `electron/main.ts:1000–1050+` — `ipcMain.handle(IPC.*)`.
- `shared/types.ts:31–200+` — `DuoCommandName` union (add the new verbs here).
- Full checklist also touches `electron/preload.ts`, `skill/SKILL.md`, `agents/duo.md`, `docs/CLI-COVERAGE.md` (CLAUDE.md § 4).

**8 · New-tab cwd seeding (re-seed to project root on focus)**
- `renderer/App.tsx` — `onNewTerminal` (`:869–881`) seeds from `pendingCwd` (`:876`, `makeTab(pendingCwd, kind, home)`); `onCommitNewFile` (`:1530`); CLI `--cwd` override at `:1186`. On project focus, set `pendingCwd` to the project root before spawn.

**9 · Atelier project color tokens**
- **Defined** in `skill/references/duo-atelier.css:45–61` — six **named** tokens: `--project-pine #2E7D74`, `--project-harbor #3C6E93`, `--project-iris #5B57A6`, `--project-plum #87508F`, `--project-rose #A4506A`, `--project-moss #69763A`.
- ⚠️ **NOT mirrored** into the app CSS (`renderer/styles/globals.css` only has `--accent`, `:43`). **Phase 1 must add these six tokens to `globals.css`** (or import the kernel) before the rail can use them. Hash maps `hash(rootPath) % 6` → one of the six in a fixed order (R2).

**10 · Context-menu pattern (for the tile right-click menu, D12)**
- `renderer/components/FileTree.tsx` — `popupMenu()` (`:630–670`) calls `window.electron.menu.popup({ items, x, y })` (`:663`) → `handleMenuChoice()` (`:669`); template via `buildTreeMenuTemplate()` (`:853`, items like `pin`/`unpin`, multi-select aware). Also `WorkingTabStrip.tsx:149` + `Breadcrumb.tsx:24`. **The tile menu (Pin/Unpin + "Close N terminals and M tabs") follows this `MenuTemplateItem[]` → IPC popup → `chosenId` shape — do not hand-roll a menu.**

---

## Requirements changed — BUG-267 (2026-07-17): D11 adjudicates activations, not focus changes

**Defect.** D11's effect re-ran its membership check on every `focusedProject`
change, not just on file/browser activations. Clicking a tile of project P
while the active working surface belonged to project Q made D11 (focus → Q)
and the keep-visible effect (active surface → member of P) correct the same
discrepancy in opposite directions — a non-converging P↔Q oscillation that
re-rendered on every commit (the "rail-click flicker loop"; app unusable
until an "All" click landed, since both effects gate on `null`). The repro
selector "a project with working tabs but no terminals" is simply a project
the user is not working in, guaranteeing a foreign active surface at click
time. The browser side (Phase 3c-browser vs the FOLLOWUP-030 redirect
machine) had the same fight through async `switchTab` IPC.

**Locked amendment.** D11 (file and browser alike) switches focus only on a
**genuine activation change** — the active file-tab id / browser-tab id
differs from the previous adjudication — and never during the focus-entry
settling window (`pendingBrowserRedirect !== null`) or on a programmatic
keep-visible/redirect move (those pre-seed the adjudication refs). Decision
logic is the pure `adjudicateActiveSurfaceFocusSwitch`
(`shared/project-lifecycle.ts`, unit-pinned). Behavioral deltas, all
deliberate:

- Tile clicks / CLI `duo project focus` never bounce: entering focus with a
  foreign active surface keeps the chosen focus while the keep-visible
  effect converges (≤2 passes).
- BUG-193-family "focus theft" via a *pinned* foreign tab on focus entry is
  gone — the pinned tab stays visible and active, focus stays put.
- A late membership-probe settle on an unchanged active surface no longer
  yanks focus.
- `duo edit` / `duo open` / user tab-clicks onto a foreign-project surface
  still auto-switch focus (those are activation changes — the original D11
  contract).
