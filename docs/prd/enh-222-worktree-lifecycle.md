# ENH-222 PRD — Worktree lifecycle UX: PM-friendly create + graceful removal

> **Status:** **IMPLEMENTED + live-pre-walked** on branch
> `claude/eloquent-albattani-7c44d4` (off `main` @ `df26ddf`, v0.11.2).
> Owner: Geoff · priority **Strategic** (agents-in-worktrees is Duo's reason
> to exist). **Owner `/smoke-walk` pending** before a cut (page generated at
> `docs/dev/smoke-walks/v0.11.2.html`; all items agent-pre-walked PASS). This
> PRD is the locked-scope writeup + the findings/deviations record — the
> *decisions* were made interactively in the playgrounds below.
>
> **This is the ENH-210 D5 "B → C" escalation.** ENH-210 shipped worktree
> *awareness* (detection, the navigator pill + switch dropdown, titlebar/
> terminal badges) and locked D5 as **read-only** — "Claude makes worktrees
> via git" — *"as long as Claude knows how to make worktrees."* The
> non-technical-PM persona is the gating evidence that unlocks **write/
> lifecycle verbs**: a PM can't drive `git worktree add`, so Duo needs a
> first-class **Create** affordance — and, once Duo creates worktrees, it owns
> the **teardown** story too.
>
> **References:**
> - Decision playgrounds (the decision record):
>   [`docs/research/worktree-lifecycle-ux.html`](../research/worktree-lifecycle-ux.html)
>   (4 create-flow options + the removal-recovery state, D1–D6) and the D1
>   form-UI follow-up [`docs/research/worktree-create-ui.html`](../research/worktree-create-ui.html)
>   (4 inline-form treatments → Variant A).
> - ENH-210 (parent): worktree-aware Duo — `core/git/worktree.ts`
>   (`resolveWorktreeIdentity` / `listWorktrees`), the navigator pill +
>   `WorktreeDropdownBody`, `duo worktree [list]`. Its D5 stress study:
>   [`docs/research/worktree-d5-stress.html`](../research/worktree-d5-stress.html);
>   D4 dropdown study: [`docs/research/worktree-d4-study.html`](../research/worktree-d4-study.html).
> - `tasks.md` → **ENH-222** (running ledger + commit-by-commit build log).
> - **Code (this change touches):** `shared/worktree-slug.ts` (new),
>   `core/git/worktree.ts`, `cli/duo.ts` (+ `cli/duo` binary),
>   `shared/types.ts`, `shared/host-api.ts`, `electron/preload.ts`,
>   `electron/main.ts`, `renderer/components/FileTree.tsx`,
>   `renderer/hooks/useNavigator.ts`, `renderer/hooks/pruneDeadPaths.ts`,
>   `renderer/App.tsx`. Tests: `core/git/worktree.test.ts`,
>   `renderer/hooks/pruneDeadPaths.test.ts`. 4-surface CLI docs:
>   `skill/references/cli-reference.md`, `agents/duo.md`,
>   `docs/CLI-COVERAGE.md`.

---

## Summary

Two enhancements to the worktree controller (the navigator pill + dropdown
shipped in ENH-210):

1. **Create a worktree from the dropdown.** Clicking the worktree pill opens a
   dropdown with a **"+ New worktree"** row. It expands in place into a
   one-line form (Variant A): type a name → a **live, path/ref-safe slug
   preview** → Enter/Create → `git worktree add` off main → the navigator
   **re-roots** into the new worktree → (default) a **Claude session boots**
   there. No git literacy required. The same capability ships on the CLI
   (`duo worktree new` / `remove`) per the CLI-parity rule.

2. **Survive removal under-foot.** When an agent merges + `git worktree
   remove`s the worktree the navigator is rooted in, Duo **reverts to the
   MAIN checkout** (not the `.claude/worktrees/` parent) and tells the user
   via a dismissible **"back on main" banner** — never a render crash.

The slug sanitization is the crash-prevention spine of (1); the
vanished-cwd-aware navigator self-heal is the spine of (2).

---

## A. Decisions (locked via the playgrounds, owner walk 2026-06-18)

| # | Decision | Pick | Rationale |
|---|---|---|---|
| **D1** | Create flow shape | **Inline form in the dropdown** (Variant **A** — one-line type-and-go) | Guided + in-context + architecturally safe (pure DOM in the sidebar — no `WebContentsView`-occlusion hazard a centered modal would hit). Owner walked 4 inline-UI treatments (one-line / progressive / roomy-widened / mad-libs sentence) and picked **A**. |
| **D2** | Naming model | **Describe → auto-slug**, **+ auto-name fallback** | You type a plain-language name; it's sanitized live to `claude/<slug>`. Owner add: a **"Name it for me"** (⚄) control fills an auto codename when you'd rather not type (or leave the field blank). |
| **D3** | Start a Claude session on create | **Toggle, default ON** | Duo is a pair-work tool; a PM making a worktree usually wants an agent in it. Opt-out lives under "options". |
| **D4** | Where it opens | **This window** (re-root) | Matches clicking an existing worktree row. New-window stays available via the existing per-row button / `worktree new --window`. |
| **D5** | Removal recovery UX | **Auto-revert to main + dismissible banner** | Non-blocking; explains why the files changed; nothing lost (the work merged to main). |
| **D6** | Detection trigger + live-terminal edge | **Watcher/focus re-probe + a vanished-cwd guard on every nav read** | Defense in depth: react fast on the fs-watcher, but also guard navigator reads so a vanished cwd can never crash-render. |

The **slug validation** (owner ask, D1-UI walk): type freely, and the field
sanitizes to a slug safe as **both** a directory name and a git ref —
lowercase · spaces/underscores → `-` · **allow-list `[a-z0-9-]`** (strip
everything else) · collapse/trim hyphens · cap 50 · collision-suffix `-2`/`-3`
· fall back to an auto-name if it sanitizes to empty. The allow-list is
deliberately stricter than either constraint alone (git refs also forbid
`~ ^ : ? * [ \ ..`, all excluded), so the result can't break a path or a ref.
Worked example: `Q3 Pricing: Copy & v2!` → `claude/q3-pricing-copy-v2`.

---

## B. Implementation (phased per owner, branch commit series)

| Commit | Layer | What |
|---|---|---|
| `fc9ea43` | **core** | `slugifyWorktreeName` / `nextAvailableSlug` / `createWorktree` / `removeWorktree` in `core/git/worktree.ts`. Duo's **first write** to git worktree state. 22 tests incl. live-git integration (temp repo: create, `-2` collision, remove, fail-outside-repo, all-illegal-name). |
| `87e3a31` | **CLI** | `duo worktree new "<desc>" [--from <ref>] [--window]` + `duo worktree remove <path> [--force]`. Runs git directly in the CLI bundle (no app needed; `--window` asks the app to open a window). 4-surface docs synced; `check:skill-currency` green; binary rebuilt. |
| `ad88dd7` | **IPC + shared** | Pure slug logic extracted to **`shared/worktree-slug.ts`** (node-free, so the renderer can import it for the live preview — single source of truth, no drift) + `generateWorktreeCodename`. `CreateWorktreeResult` moved to `shared/host-api.ts`. New IPC `GIT_CREATE_WORKTREE` (`electron/preload.ts` `git.createWorktree` → `electron/main.ts` handler → the same core `createWorktree` the CLI uses). |
| `ea79456` | **renderer** | The inline create form. The worktree pill is now an **always-on dropdown trigger** (`FileTree.tsx` — clickable even on a lone main checkout). New `WorktreeCreateRow` (Variant A): live slug preview (shared fn), "Name it for me", "options" → Start-Claude toggle (default on), Enter/Create → `git:createWorktree` → `navigateTo` re-root → `onOpenClaudeIn`. |
| `1431800` | **renderer** | Removal recovery. `useNavigator`'s vanished-cwd self-heal is **worktree-aware**: FileTree feeds the live worktree identity via `setWorktreeRevertTarget`; on cwd death the heal reverts to the captured `mainRoot` + raises the **`removedWorktree` banner** (`navigateTo` auto-clears it). `pathIsWithin` (`pruneDeadPaths.ts`, boundary-safe). `FilesPane` wrapped in a scoped `ErrorBoundary` (defense-in-depth). |
| `35f7c3a` | **renderer (fix)** | Two pre-walk findings (see § C): the lone-repo dropdown `· 0` and the focus-backstop. |

CLI verb shape (the CLI twin of the UI):

```
duo worktree new "<desc>" [--from <ref>] [--window]   → { ok, path, branch, slug }
duo worktree remove <path> [--force]                  → { ok, removed }
duo worktree [list] [<path>]                          → [{ path, branch, … }]  (ENH-210)
```

---

## C. Findings & deviations from plan

Documented per the "structural changes require a process audit" + "surface
discovered issues" rules. Items C-1/C-2 were found **during the live
pre-walk** and **fixed in `35f7c3a`**; C-3..C-6 are open/known.

- **C-1 (FIXED) — lone-repo dropdown showed an empty "Switch worktree · 0".**
  `FileTree` stored the worktree list only when `length > 1` (a pre-ENH-210
  optimization — the dropdown never opened on a lone checkout). The always-on
  pill (D1 substrate) exposed it: a single-checkout repo opened the dropdown
  with no rows. **Fix:** store the full list (`setWorktrees(list)`), so the
  current (main) row always shows. Not in the original plan — surfaced by the
  always-on-trigger requirement.

- **C-2 (FIXED) — removal recovery initially fired off the fs-watcher only.**
  D6 specified "watcher/**focus** re-probe + guard"; the first implementation
  (`1431800`) wired the watcher path + the guard but **not** the focus
  re-probe. A busy dir or a whole-repo `rm` can starve the watcher, leaving
  the nav on a dead path (no crash — the guard holds — but no auto-revert).
  **Fix:** extracted the recovery into `recoverDeadCwd()` and added a
  **window-focus backstop** that re-probes the cwd and runs the same recovery.
  Closing the gap D6 had specified.

- **C-3 (DEFERRED) — D6 "live terminal in a dead folder" notice is NOT
  implemented.** D6's recommended option included: *"the terminal in the
  removed folder gets a one-line 'this worktree was removed' notice; stays
  open (history intact), no new commands."* Observed during the pre-walk: a
  terminal whose cwd is a removed worktree **does stay open** (history intact;
  `term close` even refuses a live claude session without `--force`) — so the
  no-data-loss part holds — **but it shows no in-terminal notice.** Tracked as
  a v1.1 follow-up (renderer terminal-pane banner keyed on the same
  removal signal the navigator uses).

- **C-4 (DEFERRED, by design) — UI v1 scope, with CLI parity.** The inline
  form has **no base-branch picker** (defaults to the main branch; agents pick
  via `duo worktree new --from <ref>`) and **opens in this window only** (D4;
  new-window via the existing per-row button / `--window`). Both are
  acceptable for the non-technical-PM default — called out as deliberate
  asymmetries, not omissions.

- **C-5 (FOLLOW-UP) — the dropdown doesn't refetch worktrees on open.** It
  fetches on cwd-change / window-focus (ENH-210 behavior). So a worktree an
  **agent** creates via `duo worktree new` doesn't appear in a PM's already-open
  dropdown until the next focus/cwd-change. Minor; a refetch-on-open would tidy
  the parallel-agent case. Tracked.

- **C-6 (PROCESS) — computer-use cannot drive the dev Electron.**
  `request_access` by display name ("Electron") returns *no match*; by bundle
  id (`com.github.Electron`) the dialog appears but the **access-grant hangs
  (two 300 s timeouts)**. So there are **no screenshots** of this feature; all
  UI verification was done by **driving the renderer directly** (`duo dom` /
  `duo eval` DOM probes + synthetic events that route through the real React
  handlers). Confirms the standing limitation; recorded so future UI sprints
  don't re-discover it. (Memory: `feedback_computer_use_cannot_reach_dev_electron`.)

- **C-7 (INCIDENT → evidence) — this session's own worktree was purged
  mid-work.** On 2026-06-18 a broad worktree cleanup deleted *this* session's
  worktree + branch while the dev app ran from it (socket died, renderer
  degraded). The uncommitted research playgrounds were recovered from
  conversation context and re-committed. This is **live, unplanned evidence
  for Enhancement 2** — and it implicated the **running app**, not just the
  navigator. Lesson captured: commit research artifacts immediately
  (memory: `feedback_commit_artifacts_before_risky_ops`).

---

## D. Test coverage

- **Unit (core/shared):** `core/git/worktree.test.ts` — `slugifyWorktreeName`
  (spaces/underscores → `-`, lowercase, allow-list strip incl. git-ref-hostile
  chars, collapse/trim, length cap + no trailing hyphen, empty→`''`),
  `nextAvailableSlug` (collision suffixing), **+ live-git integration** against
  a hermetic temp repo (create / `-2` collision / remove / fail-outside-repo /
  all-illegal-name). 22 cases.
- **Unit (renderer):** `pruneDeadPaths.test.ts` — `pathIsWithin` boundary cases
  (the worktree root + nested; **not** a sibling whose name prefixes it; empty
  ancestor). The regression spine of D6.
- **Suite:** full vitest green — **99 files / 1607 tests** — typecheck clean.
- **Live pre-walk (renderer-driven, no screenshots):** CREATE (pill → form →
  live slug → Enter **and** Create → re-root → `kind:claude` terminal booted),
  LONE-MAIN (lone repo shows "Switch worktree · 1" + main row + New row),
  REMOVAL (under-foot removal → revert to main + banner *"Worktree …
  was removed"* + dismiss; no crash/overlay), re-verified on a clean restart.

---

## E. Open follow-ups (not in v1)

1. **C-3** — in-terminal "this worktree was removed" notice (the terminal stays
   open today, but silently).
2. **C-5** — dropdown refetch-on-open (so agent-created worktrees show without a
   focus).
3. **C-4** — base-branch picker in the inline form (CLI `--from` covers agents);
   create-in-new-window option in the form (CLI `--window` + the per-row button
   cover it).
4. Keyboard model for the dropdown (still click-only per ENH-210 D4.3-A).

These are tracked in `tasks.md` under ENH-222; none gate the v0.11.2 cut.
