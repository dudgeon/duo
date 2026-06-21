# ENH-224 PRD — Unified Open & GitHub round-trip ("open a remote doc like it's local; Save → PR")

**Status:** **ALL 5 PHASES (0–4) BUILT** (2026-06-21). Phases 0–2 (the driving use case: open a remote doc → edit → Propose changes PR) are **LIVE-VERIFIED end-to-end** — walked against octocat/Spoon-Knife → real auto-fork cross-fork PR [#40238](https://github.com/octocat/Spoon-Knife/pull/40238). Phases 3 (already-local detection D6) + 4 (format breadth D8 + escape hatch D4) are **built + tested + bundle-compiling; owe a live walk**. · **Owner:** Geoff · **Tracker:** `tasks.md` § ENH-224 · **PR:** [#102](https://github.com/dudgeon/duo/pull/102) (rebased on `main`, MERGEABLE). · **Renumbered ENH-221 → ENH-224 (2026-06-21)** to avoid a collision with the *other* agent's ENH-221 (durable file version history) that landed on `main` first; see § 6b. · **Decisions captured via:** two AskUserQuestion rounds (2026-06-19) + the OQ-1 UI-study walk + the merged-UI walk (2026-06-20) + an owner chord/scope walk (2026-06-21, D18/D19), folded into § 3. · **Shipping constraint (owner, 2026-06-21):** *"we will not ship until the full plan is built"* — Phase-0 interim states (e.g. the D19 "Soon" tile) are scaffolding, not a shippable surface. · **Preview:** (renders as source on GitHub — read the markdown.)

---

## 1 · Problem & vision

Duo still *feels like an IDE*. Getting into a document is a verb-and-path
chore (`duo open ~/some/long/path.md`, or hunt through the navigator), and
anything that lives on GitHub is a multi-step manual dance: clone the repo
somewhere, find the file, edit it, then remember the whole `branch → commit →
push → open PR` ritual by hand. None of that feels like Google Docs or Word,
where "open a thing and start working" is a single, friendly motion.

The vision is **one familiar Open affordance that erases the difference between
local and remote.** You hit ⌘O, paste *either* a local path *or* a GitHub
link, and Duo does the right thing:

- **Local file / folder** → focus its folder in the navigator, open the asset
  in its natural viewer. (Modality 1 — "Duo already knows it's here.")
- **GitHub-hosted file** → Duo recognizes it as a Duo-supported format, pulls
  it down into an **opaque managed checkout** the user never has to think about,
  and opens it exactly like a local file. Edits save locally like any doc. The
  moment the working copy **diverges from what was fetched**, a **"Propose
  changes"** affordance appears (a footer bar — D10/D11). One tap (prefilled,
  editable, with an inline diff — D12) ships the change back as a pull request —
  **auto-forking** when the user has no push access, so the cross-person /
  cross-namespace collaboration case "just works."

The Open bar also keeps an **Open Recent** list (D14) of the last few targets —
local or GitHub — so re-opening a doc you were just in is one click, like any
familiar editor.

**Driving use case (owner).** Person A sends Person B a link to a markdown file
in a GitHub repo Person B does *not* own. Person B hits ⌘O, pastes the link,
the doc opens like it's local, B makes edits, and B ships a PR back to A's repo
— without ever consciously cloning, forking, branching, or pushing. **Open →
edit → save ≈ propose changes.** This is the feature that turns Duo from "an
IDE I drive" into "the easiest way to collaborate on a doc."

**Why this is differentiating.** Today `duo open <url>` only ever lands a URL in
the *browser pane* — read-only, no path back upstream. Git plumbing is
read-only (`clone`, `gh-auth`, `git-status`, `worktree`); there is **no
branch / commit / push / PR-create.** So the "Save → PR" half is net-new. The
payoff is large: effortless, low-ceremony collaboration on plain files in git,
intelligible to humans and agents that have no concept of this feature.

---

## 2 · Glossary

| Term | Meaning |
| --- | --- |
| **Open bar** | The unified ⌘O / File ▸ Open… affordance. Accepts a local path **or** a URL; the resolver figures out the modality. CLI twin: the extended `duo open`. |
| **resolver** | The pure brain that classifies an Open input → `local-path` \| `local-clone-of-remote` \| `github-file-url` \| `other-url`. Drives every downstream branch. |
| **managed checkout** | An opaque, Duo-owned working tree under `~/.claude/duo/checkouts/…` that the user never has to locate or manage. Created by a depth-1 clone (D5). |
| **baseline** | The exact upstream blob/ref Duo fetched. Divergence = working file ≠ baseline. The signal that flips the "Submit PR" affordance on (D2). |
| **share-back** | The explicit outward action behind "Submit PR": ensure a push target (write-check → **fork if needed**), branch, commit, push, open/update the PR. |
| **cross-fork PR** | A PR opened from Person B's fork into Person A's repo, used whenever B lacks push access (D3). Opaque to the user. |
| **real clone** | An existing local working copy of the same repo (matched by remote URL) the user already has. Modality-1 reuse target (D6). |
| **Propose changes** | The user-facing label for the share-back affordance (D11), surfaced as a **footer bar** on divergence (D10). "Pull request" jargon appears only inside the confirm sheet + the post-state ("View PR"). |
| **recents / Open Recent** | The last ~10 targets opened via the Open bar — local paths *and* GitHub URLs — persisted machine-global as **pointers**, surfaced in File ▸ Open Recent and inside the empty Open bar (D14). |

---

## 3 · Locked decisions (D-numbered; source = the two AUQ rounds, 2026-06-19)

| # | Decision | Choice |
| --- | --- | --- |
| **D1** | Entry point | **Unified Open bar** — a Google-Docs-style ⌘O / File ▸ Open… that accepts a **local path OR a URL** and routes by the resolver. Mirrored as the extended `duo open` CLI verb (parity). One affordance, no "which command do I want." (r1 Q4) |
| **D2** | Save / publish model | **Save = local; "Submit PR" is explicit.** Save writes to the managed checkout like any doc. When the working file **diverges from the fetched baseline**, a **"Submit PR" affordance appears** (owner: *"save local, but when local differs from checkout, 'Submit PR' button appears"*). The outward GitHub step is always deliberate and reviewable. (r1 Q1) |
| **D3** | PR origin (no push access) | **Auto-fork, then cross-fork PR.** Duo detects no push access, forks the repo to the user's account (via `gh`), pushes the branch there, opens the PR cross-fork — fully opaque. When the user **does** have push access, branch on origin instead. (r1 Q2) |
| **D4** | Checkout home | **Managed temp, opaque by default** — `~/.claude/duo/checkouts/<owner>-<repo>@<ref>/`. The user never thinks about it. Offer an optional "save a real local copy here…" escape hatch. Never pollutes the user's working tree. (r1 Q3) |
| **D5** | Pull scope | **Shallow-clone the whole repo (depth-1), favoring the target file.** Full-fidelity: relative image/links in the doc resolve, the navigator can show sibling files ("bring focus to the folder"), and the PR diff is real. Heavier on first open is an accepted trade. (r2 Q1) |
| **D6** | Already-local case | **Detect + offer to use the real clone.** Match the pasted URL against known local clones (navigator roots / recents, by remote URL). If found → **offer** to open the file from there (modality 1 — focus the folder). Else → managed checkout. Offer (not silent reuse) so we never surprise-edit the user's real working tree / current branch. (r2 Q2) |
| **D7** | PR submit UX | **Prefill everything, one-tap, editable.** Auto-generate branch name, PR title (from the doc's first `#` heading), and a simple body; show a **compact confirm sheet pre-filled** so it's one tap to ship but still editable. Familiar "Share" feel. (r2 Q3) |
| **D8** | Format scope (v1) | **Markdown first; other text formats next.** Ship the full round-trip for `.md` first (the driving use case); build the machinery so it extends to other editable text (json / yaml / html canvas) without redesign. Binary (images / pdf) stays **view-only** when remote. (r2 Q4) |
| **D9** | Auth | **Lean on the `gh` credential helper** (the existing `gh-auth` probe + `core/git/auth.ts`). Unauthenticated → bounce to "Run `gh auth login`," the same pattern the Clone modal already uses. No in-app OAuth / token handling. (carried from existing clone design) |
| **D10** | Affordance location *(was OQ-1)* | **Footer "propose" bar.** Appears only on divergence, as a strip below the doc — the only treatment with *zero* impact on the editor toolbar (already full, ends in the Save pill, horizontal-scrolls when narrow), the Save pill, and the tab strip. Reads like Google Docs' bottom "Suggesting" bar; the natural home to morph into View/Update PR (D13). (UI-study walk 2026-06-20) |
| **D11** | Affordance label | **"Propose changes"** — friendly, no jargon. "Pull request" / "PR" appears only inside the confirm sheet and the post-state ("View PR"). Avoids "Suggest changes" (collides with Duo's existing CriticMarkup **Suggesting** mode). The CLI verb stays the precise `duo pr create`. (UI-study walk 2026-06-20) |
| **D12** | Confirm-sheet depth | **Full: title + branch + fork-note + inline diff.** The sheet shows exactly what's about to be proposed (the diff is the reviewable artifact) and makes the auto-fork (D3) honest with a visible fork-note. Still one tap if you don't read it. (UI-study walk 2026-06-20) |
| **D13** | Post-PR state | **Morph in place.** After a PR opens, the same footer affordance becomes "Proposed · View PR ↗"; on the next edit it shows "Update PR" (push to the same branch). One surface, full lifecycle — no new chrome. (UI-study walk 2026-06-20) |
| **D14** | Open Recent | **Persist the last ~10 Open-bar targets** (local paths + GitHub URLs), **machine-global**, surfaced in **File ▸ Open Recent** and inside the empty Open bar. Stored as **pointers** (target string + label + kind + last-opened) resolved live; missing targets self-heal (greyed/pruned) — no mirrored state (§12). CLI twin: `duo recent`. (owner 2026-06-20) |
| **D15** | Merged surface depth | **Full inline merge (DM1).** One ⌘O surface handles open-a-doc *and* clone-a-repo as one progressive flow (paste → resolve → for a repo: inline clone confirm → cloning → success) — no hand-off to a separate modal. The standalone `CloneModal` is folded into the Open surface over time; the success-screen redesign (D16) lands first against the existing modal so the win ships immediately. (merged-UI walk 2026-06-20) |
| **D16** | Clone success hero | **Context-aware Open / Done (DM2).** Replace the "Clone another" hero: from a file URL → hero **"Open &lt;file&gt;"**; from a bare repo URL → hero **"Done"** (navigator already focused). "Clone another" demoted to a quiet text link. Success body is one clean line, not a wall of next-steps text. **Independently shippable** against today's `CloneModal`. (merged-UI walk 2026-06-20) |
| **D17** | Native picker | **Single combined "Browse…" (DM3).** Paste stays primary; a **Browse…** button opens the native macOS open dialog with **both** `openFile` + `openDirectory` enabled. Picked file → opens in its viewer; picked folder → roots the navigator. Same resolver as a typed path. (Two-button File…/Folder… is the cross-platform fallback if Duo ever leaves macOS.) (merged-UI walk 2026-06-20) |
| **D18** | ⌘O = one merged surface | **The Open bar SUBSUMES the vault quick-switcher.** ⌘O was bound to `VaultQuickSwitcher` (vault fuzzy-find). Rather than relocate it to a second chord, ⌘O now opens **one** progressive surface: empty → Open Recent (D14) + Browse… (D17); typing a search term → vault fuzzy-find (the old switcher's `rankVaultFiles` behavior, preserved); typing/pasting a path or URL → resolver classification + Open. One "open anything" affordance, closest to the Google-Docs vision in § 1. The standalone `VaultQuickSwitcher` mount is retired (its index source + pick→`openFileSmart` path are reused by the new bar). (owner walk 2026-06-20) |
| **D19** | GitHub-*file* URL, this phase | **File-vs-repo choice; "just this doc" = Soon.** The full doc round-trip (sparse checkout → Propose changes → PR) is blocked on DR1–DR6, so a `…/blob/…/doc.md` URL shows the agreed fork-in-the-road (mock state 2): **"Open just this doc"** is present but **disabled ("Soon")**; **"Clone the whole repo"** is live — it routes to the clone flow with `openAfter` = the file, so after cloning Duo opens that file from the real clone. Interim scaffolding, not a shipped dead-end: **"we will not ship until the full plan is built"** (owner, 2026-06-20). When DR1–DR6 land, only the disabled action needs wiring. |

**Owner directive (carried from ENH-208 r2 walk).** Every shipped verb lands the
full **4-surface sync** (`cli/duo.ts` · `skill/SKILL.md` · `agents/duo.md` ·
`docs/CLI-COVERAGE.md`) **plus** a `what-duo-does.html` entry. Restated as
acceptance criteria in every phase below.

---

## 4 · The flow, as primitives

Each primitive: what the **user** does, what **Duo/CLI** does, the **files**
touched.

### P1 · The resolver (the Open brain)

- **User:** ⌘O → pastes a local path **or** a URL → Enter. Paste is primary, but
  a **Browse…** button opens the native macOS open dialog (file **or** folder
  selection enabled) for the mouse path — a picked file opens in its viewer, a
  picked folder roots the navigator (both feed the same resolver). Treatment:
  OQ-7 / DM3.
- **Duo:** classify the input:
  1. **Local path** (`~/…`, absolute, relative, `file://`) → P-local (focus
     folder + open in viewer; this is today's `resolveOpenTarget` + navigator
     focus, lightly extended).
  2. **GitHub file URL** (`github.com/<o>/<r>/blob/…`, `/raw/…`, permalink
     `…/blob/<sha>/…`, `raw.githubusercontent.com/…`) → check D6 (real clone?)
     → else P2/P3 (checkout) → P4 (open).
  3. **Other URL** (non-GitHub http(s)) → today's behavior: open in the browser
     pane (`duo navigate`). Unchanged.
- **Files:** `renderer/` Open-bar component; a new pure resolver module
  (e.g. `core/open/resolve.ts`) shared by UI + CLI; extends
  `cli/duo.ts resolveOpenTarget`.
- **Recents:** on a successful resolve, record the target to **recents** (P1b).

### P1b · Open Recent (D14)

- **User:** opens File ▸ Open Recent (or sees the list inside the empty ⌘O bar)
  → clicks a prior target → it reopens. A "Clear Recent" item resets the list.
- **Duo:** keep the last ~10 targets (local paths + GitHub URLs), machine-global.
  Each entry is a **pointer** — `{ target, label, kind: 'local' | 'github',
  lastOpenedAt }` — re-run through the resolver on click (so a GitHub entry
  reuses its managed checkout if still present, else re-checks-out; a local
  entry opens if it still exists). Missing targets self-heal: greyed, then
  pruned. No mirrored content (§12).
- **Files:** a small recents store in Duo storage (e.g. `~/.claude/duo/recents.json`
  or the session-state envelope), read live; File menu wiring; Open-bar empty-state list.

### P2 · GitHub URL recognition + normalization

- **Duo:** parse `<owner>/<repo>`, `<ref>` (branch | tag | sha), `<path>` from
  the supported GitHub URL shapes; normalize raw ↔ blob ↔ permalink. Pin the
  exact `<ref>` so the baseline (D2) is unambiguous.
- **Files:** extend `core/git/remote-url.ts` (already parses/rewrites remote
  URLs) with a `parseGithubFileUrl()`.

### P3 · Fetch / checkout (opaque)

- **Duo:** depth-1 clone (D5) the repo into the managed home (D4), checked out
  at the pinned ref. Reuse `core/git/clone.ts` (gh-preferred, git fallback).
  Record a **pointer** (no sidecar copy of GitHub state — per CLAUDE.md §12):
  `{ owner, repo, ref, path, checkoutDir, baselineSha }` in Duo session state,
  resolved live thereafter.
- **Files:** `core/git/clone.ts` (reuse), new `core/open/checkout.ts`, session
  state pointer.

### P4 · Open into the viewer

- **Duo:** hand the checked-out file path to the existing classify→open path
  (`fileClassifier.ts` → `.md` = `editor`). Focus the checkout folder in the
  navigator so siblings/assets are visible (D5). From here it is an ordinary
  local doc.
- **Files:** reuse `fileClassifier.ts`, `useNavigator`, WorkingPane.

### P5 · Divergence tracking → "Propose changes" affordance

- **Duo:** track working-file vs baseline (D2). On divergence, surface the
  **"Propose changes"** affordance as a **footer bar** below the doc
  (D10/D11 — OQ-1 resolved via the UI study). On convergence (revert / matches
  upstream), hide it. Note: this is orthogonal to the Save pill — "Save" means
  saved to the local checkout; the footer bar means the local file differs from
  the upstream baseline.
- **Files:** a divergence watcher (cheap content/hash diff against
  `baselineSha`); the renderer footer-bar affordance.

### P6 · Share-back (the net-new git write plumbing)

- **Duo:** on "Propose changes" → show the **prefilled, editable confirm sheet**
  first (D7) — title + branch + fork-note + **inline diff** (D12) — then on
  confirm: (a) write-check the origin; (b) if no push access, **auto-fork** to
  the user's account (D3); (c) create a branch; (d) commit the working changes;
  (e) push to the fork/origin; (f) open the PR (cross-fork when forked) via `gh`.
- **Files (net-new):** `core/git/{branch,commit,push,fork,pr}.ts`,
  socket handlers in `electron/main.ts`, CLI verb(s) (see § 5).

### P7 · Post-PR state

- **Duo:** the footer affordance **morphs in place** (D13) → "Proposed · View PR ↗".
  **Subsequent saves that re-diverge update the same PR** (push to the same
  branch) — the bar shows "Update PR." After upstream merge, a fresh divergence
  opens a new PR/branch.
- **Files:** session-state pointer gains `{ prNumber, prUrl, branch, forkOwner }`
  (live-resolved; still a pointer, not mirrored state).

---

## 5 · CLI surface (parity rule)

The CLI is the spec — the human Open bar + Submit-PR affordance each need a twin.

| Verb | Purpose | Notes |
| --- | --- | --- |
| `duo open <path-or-url>` | **Extend** the existing verb to recognize GitHub file URLs → checkout → open (P1–P4). Local + non-GitHub URL behavior unchanged. | The Open-bar twin. |
| `duo recent [--json]` | List the last ~10 Open-bar targets (the Open Recent menu's twin); reopen by re-passing the target to `duo open`. | Recents are pointers; missing ones self-heal (D14). |
| `duo pr create [<path>] [--title …] [--body …] [--branch …] [--draft] [--json]` | Share-back (P6): branch/commit/push/PR, auto-fork as needed. Defaults prefilled from the doc (D7); flags override. `--json` prints the structured `ShareBackResult`. | The "Submit PR" twin. |
| `duo pr status [<path>]` | Report the doc's checkout + divergence + PR state (JSON). | Visibility-cluster citizen. |
| `duo pr view [<path>]` | Print / open the PR URL (P7). | "View PR" twin. |

Supporting git verbs may also surface (`duo branch`, `duo push`) if the
share-back internals prove useful standalone — decide during build, keep the
4-surface sync. Every new verb → `cli/duo.ts` + `skill/SKILL.md` +
`agents/duo.md` + `docs/CLI-COVERAGE.md` + a `what-duo-does.html` entry.

---

## 6 · Phased build (each phase independently shippable)

**Phase 0 — The merged Open bar. ✅ code-complete (owes a live smoke-walk).**
The ⌘O surface SUBSUMES the vault quick-switcher (D18): one progressive overlay
that fuzzy-finds vault files (the old ⌘O behavior, preserved), OR resolves a
pasted path / URL via the unified resolver (P1), OR picks a file/folder via a
native **Browse…** dialog (D17), OR reopens from **Open Recent** (D14 / P1b).
Routing landed for every resolver branch: local file → viewer, folder →
navigator root, non-GitHub URL → browser pane, **github-repo → prefilled clone**,
**github-file → file-vs-repo choice (D19)** — "clone the whole repo, then open
this file" is LIVE (clone + local open + the D16 "Open `<file>`" success hero),
"just this doc" is the disabled **"Soon"** tile (its sparse round-trip is
DR-blocked, see Phase 1). File ▸ Open… (⌘O, display-only accel) + File ▸ Open
Recent menu added; `duo recent [--json]` + record-on-open (shared store) with
4-surface sync.
*Acceptance (met except the live walk):* ⌘O opens the merged bar; a bare token
fuzzy-finds; local path + http(s) URL + GitHub repo/file all route correctly;
Open Recent lists the last ~10 targets (local + GitHub), reopens them, persists
across restart, self-heals missing ones; `duo recent` added with 4-surface sync;
`what-duo-does.html` entry **(owed)**; **smoke-walked (owed — deferred, dev
Electron busy)**. Verified: typecheck clean · 1676 tests (resolver +
`deriveRecentEntry`, recents store, socket `recent`/record-on-open, the
search-vs-path heuristic) · currency 75/75.

**Phase 1 — GitHub *file* URL → open-as-local. ✅ DONE — UI live-verified
(2026-06-21); CLI twin code-complete + tested (2026-06-21), live-verify owed.**
The "just this doc" tile is live: a github-file URL → opaque managed checkout
(`core/open-checkout.ts`: depth-1 clone at the ref into
`~/.claude/duo/checkouts/<owner>-<repo>@<ref>/` via the extended `runClone`,
`rev-parse HEAD` baseline, idempotent reuse) → the doc opens like a local file +
the navigator focuses the checkout folder + the github-file recent is recorded.
The OpenBar shows a "Pulling ‹file›…" progress panel with an inline gh-auth
bounce on failure. **Live-verified (UI):** `octocat/Spoon-Knife/blob/main/README.md`
→ depth-1 checkout (1 commit, baseline `d0dd1f6`) → README opened in the editor +
folder focused + `duo recent` shows `🐙 octocat/Spoon-Knife › README.md`; dev log
clean. **CLI twin (rule #4) — DONE (2026-06-21):** the `duo open` socket handler
(`core/socket-server.ts` case `open`) now classifies its target and, on a
github-file URL, runs the SAME managed checkout via a new optional
`NavBridge.runManagedCheckout` (wired in `electron/main.ts` to
`core/open-checkout.runManagedCheckout` — one engine, shared with the
`OPEN_GITHUB_FILE` IPC) → `nav.edit(fileAbsPath)` + `nav.reveal(checkoutDir)` →
records the github-file recent (reusing the existing record-on-open path); auth-
missing bounces to `gh auth login`; a bare-repo / non-file GitHub URL still opens
in the browser pane. `cli/duo.ts resolveOpenTarget` now https-prefixes a scheme-
less github host so `duo open github.com/o/r/blob/…` classifies correctly. Verified:
typecheck clean · **1696 tests** (+4 socket: routing · auth-missing bounce · bare-
repo fallthrough · optional-dep fallthrough) · currency 75/75 · 5-surface doc sync
(SKILL.md · agents/duo.md · CLI-COVERAGE.md · cli-reference.md · the verb summary).
**Owed:** a real `duo open <github-url>` against the running app (needs Electron).
**Deliberate asymmetry (rule #4):** `duo open <github-file-url>` opens *just this
doc* via the managed checkout (PRD § 5) — matching the Open bar's explicit "just
this doc" card. The UI *recents-list / menu* reopen of a github-file instead
routes to the clone flow (`App.tsx openResolvedTarget` — the deliberate "clone
the whole repo" default for an ambiguous reopen). So the same github-file recent
lands in a checkout via `duo open` but offers a clone via the UI recents click.
Defensible (CLI `open` is an explicit single-target verb; the UI recents row is
an ambiguous reopen), but a future UI follow-up could route github-file recents
through `onOpenGithubDoc` for full UI/CLI symmetry.
**Deferred optimization (DR6):** sparse-folder narrowing (whole-repo depth-1
is the asset-complete v1). The "save local" path is inherited — the doc is now an
ordinary local file in the checkout.
*Acceptance:* a `github.com/.../blob/.../*.md` URL's "just this doc" action opens
like a local file from `~/.claude/duo/checkouts/`; relative assets resolve;
checkout is opaque; 4-surface sync for the extended `duo open`; smoke-walked.

**Phase 2 — Share-back (the core). 🚧 CORE PLUMBING BUILT + tested (2026-06-21);
CLI live-verify + UI affordance owed.** P5 + P6 + P7: divergence → "Propose
changes" → branch/commit/push/PR with **auto-fork** (D3) → "View PR" →
subsequent-save updates the PR. **Built (no Electron — the owner-scoped slice):**
the net-new git-WRITE core — `core/git/{divergence,proposal-meta,branch,commit,
push,fork,pr,failure-sniff,share-back}.ts` — plus the `duo pr create|status|view`
CLI verb (socket `case 'pr'` → `core/git/share-back`, dynamic-imported like
`clone`) + 5-surface doc sync. The orchestrator (`runShareBack`) sequences:
resolve context LIVE from the checkout's git (§12 — owner/repo from origin, base
from the current branch) → divergence gate (`git status --porcelain`) → D7
prefill (branch `duo/<slug>-<short>`, title from the doc's first heading) →
branch → commit (whatever diverged — OQ-3) → **push-access probe → AUTO-FORK
(D3)** when no push access → push (to origin or the fork URL) → **create-or-update**
the PR (D13; `findOpenPr` → update vs `gh pr create`). All PR/divergence state
read live via `gh`/git — no sidecar (§12). The path→checkout resolver refuses
any path outside `~/.claude/duo/checkouts/` (D4 — never the user's own tree).
42 pure unit tests (arg-builders, parsers, prefill, the D4 guard); the spawning
`run*` orchestrators are verified live (owed). **The UI footer affordance is now
also built (blind — no Electron):** `renderer/components/ProposeBar.tsx` mounts
under the markdown editor, polls `window.electron.pr.status` on save (INERT for
ordinary files — appears only on a diverged managed checkout), opens a prefilled
confirm sheet (D7/D12), and morphs to "Proposed · View PR" after `pr.create`
(D13); new SHARE_BACK_STATUS/DIFF/CREATE IPC → the same `core/git/share-back`
engine. typecheck clean · prod bundle compiles · 1741 tests. **Owed (needs
Electron):** a real `duo pr create` end-to-end against a test repo, AND a smoke
walk of the footer affordance (divergence → bar → sheet → PR → morph) — neither
is visually/behaviorally verified yet.
*Acceptance:* edit a remote `.md`, Propose changes, a real PR appears upstream
(cross-fork when no push access); unauthenticated bounces to `gh auth login`;
re-save updates the same PR; full 5-surface sync; smoke-walked.

**Phase 3 — Already-local detection (D6). 🚧 BUILT + tested (2026-06-21); live
walk owed.** Before a managed checkout, `matchLocalClone` (`core/git/local-clone-
match.ts`) checks whether the github-file's repo is already cloned in a navigator
git-root project (reads each root's `origin` remote + a file-exists check). If so,
open from THEIR clone (modality 1 — focus the folder); else managed checkout. We
only OPEN (never edit) their tree, and the share-back footer is gated to managed
checkouts, so no surprise PR. **UI** (D6 "offer"): the Open bar shows a third
choice "📁 Open from your local clone …" (`OPEN_MATCH_LOCAL_CLONE` IPC). **CLI**
(prefer-local + report, with a `--checkout` override): the socket `open`
github-file branch tries the clone first, opens from it + reports
`via:'local-clone'` + the path. Deliberate UI/CLI split (offer vs prefer-and-
report). 6 pure tests (`remoteMatchesRepo`).
*Acceptance:* pasting a URL for a repo already in a navigator root offers the
real clone; declining falls back to managed checkout; no silent edits to the
user's tree.

**Phase 4 — Format breadth + polish (D8 / D4). 🚧 BUILT + tested (2026-06-21);
live walk owed.** The share-back core was already format-agnostic; this extends
the UI + adds the escape hatch. **D8 breadth:** the "Propose changes" footer
(`ProposeBar`) now mounts in the JSON/YAML viewer (`JsonView`) and the HTML
canvas (`PageTab`) — each bumps a `shareBackTick` on save → re-poll — so a remote
`.json`/`.yaml`/`.html` round-trips via the same path as `.md` (the heading-title
prefill degrades to the filename for non-markdown). **D4 escape hatch:** `duo pr
export <path> <dest>` (`core/git/share-back.exportCheckoutFile`, guarded to the
managed home) copies the checkout doc to a real local path; the UI "Save a copy…"
affordance is **deferred** — its surface (menu vs button) is an owner UX choice.
**D8 binary view-only:** already the behavior — the footer mounts only in the
three text editors, never the image/pdf viewers, so a remote binary opens
view-only.
*Acceptance:* a remote `.json`/`.yaml` round-trips via the same path; escape
hatch works; smoke-walked.

---

## 6a · Build status (live — updated 2026-06-21)

Built on `claude/duo-file-open-flow-g3rpdx` (PR [#102](https://github.com/dudgeon/duo/pull/102),
rebased onto `main`). The Phase-0 *core* (resolver + recents store + the D16
clone-success redesign) landed first in a remote cloud session that couldn't
launch the Electron GUI; the **merged ⌘O Open bar** then landed + was
**agent-walked live (computer-use, 2026-06-21)** on the owner's machine. Every
core flow passed — File ▸ Open… + ⌘O open the bar; the github-file D19 choice,
github-repo→prefilled-clone, local-path→open, Browse… native picker, and
**record-on-open (UI write → `duo recent` reads the same store)** all verified;
dev log clean (no IPC-handler-gap errors). The walk surfaced **3 polish
follow-ups** (§ 6c). Still recommended before a cut: the **owner's own
smoke-walk** (subjective polish + the vault-fuzzy-find / clone-completion paths
that need a real vault / a live clone). (Build-passing + type-clean is NOT "done"
for UI — `CLAUDE.md` § 7.)

| Piece | Decision | State | Verification |
| --- | --- | --- | --- |
| `core/open-resolve.ts` — resolver (local-path / github-file / github-repo / url) + pure `deriveRecentEntry` | D1, D5/DR6, D14 | ✅ landed | **31 unit tests** |
| `core/open-recents-service.ts` — Open Recent store (`~/.claude/duo/open-recents.json`, pointers, self-healing, cap 10) | D14 | ✅ landed | **10 unit tests** |
| `CloneModal` — D16 success redesign (clean line + Done hero, "Clone another" demoted) **+ prefill URL + `openAfter` "Open `<file>`" hero** | D16, D15 | ✅ landed (code) | type-clean · **owes smoke-walk** |
| **Merged ⌘O Open bar** (`OpenBar.tsx`, subsumes VaultQuickSwitcher) + Browse… picker + Open Recent UI + File menu + record-on-open + `duo recent` | D14, D15, D17, **D18, D19** | ✅ code-complete · **agent-walked live 2026-06-21** · 3 follow-ups (§ 6c) | typecheck clean · **1676 tests** (incl. socket `recent`/record-on-open integration + the search-vs-path heuristic) · currency **75/75**. **Live (computer-use):** every core flow passed (see § 6a header); record-on-open round-trips UI↔`duo recent`↔disk; dev log clean. Owner formal smoke-walk still recommended. |
| **Phase 1 — "open just this doc"** (managed checkout `core/open-checkout.ts` + `OPEN_GITHUB_FILE` IPC + the live OpenBar tile w/ progress) | DR6, D5 | ✅ UI done · **live-verified** | typecheck clean · tests (managedCheckoutDir / isLikelySha / cloneExtraArgs). **Live:** Spoon-Knife/README.md → depth-1 checkout (1 commit) → opened + folder focused + recent recorded; dev log clean. |
| **Phase 1 CLI twin** — `duo open <github-file-url>` → same managed checkout (socket `open` branch + `NavBridge.runManagedCheckout` + bare-host CLI resolve) | DR6, D5, **rule #4** | ✅ DONE + **live-verified 2026-06-21** | typecheck clean · **1696 tests** (+4 socket: routing · auth-missing bounce · bare-repo fallthrough · optional-dep fallthrough) · currency 75/75 · 5-surface doc sync. Shares the checkout engine with the UI IPC. **Live:** `duo open` Spoon-Knife/README → checkout reused, README opened as the active editor tab, navigator cwd = the checkout folder, recent under the canonical URL. |
| **Phase 2 — share-back CORE plumbing** (`core/git/{divergence,proposal-meta,branch,commit,push,fork,pr,share-back}.ts` + `duo pr create\|status\|view` + socket `case 'pr'`) | D2, D3, D7–D13, OQ-3, §12 | ✅ built + **live-verified 2026-06-21** | typecheck clean · **1744 tests** (pure: arg-builders, parsers, D7 prefill, the D4 + `isShareBackBranch` guards) · currency 76/76 · 5-surface doc sync. `runShareBack` orchestrates context→divergence→branch→commit→push-access→**auto-fork (D3)**→push→create-or-update PR (D13), all live via gh/git (§12). **Live:** `duo pr create` Spoon-Knife → auto-fork + cross-fork PR [#40238](https://github.com/octocat/Spoon-Knife/pull/40238); `pr status`/`view` find it (status-gate fix `16a23b7`). |
| **Phase 2 — share-back UI affordance** (`renderer/components/ProposeBar.tsx` — footer bar + confirm sheet + morph-in-place) | D10–D13 | ✅ BUILT + **live-verified 2026-06-21** | `ProposeBar` mounts at the bottom of the markdown editor; polls `window.electron.pr.status` on save (D2 signal) — INERT for ordinary files, appears only on a diverged managed checkout. Click → confirm sheet (D7/D12: title/branch/body + fork-note + inline diff via `pr.diff`) → `pr.create` → morphs to "Proposed · View PR" (D13). New IPC SHARE_BACK_STATUS/DIFF/CREATE → `core/git/share-back` (one engine, shared with `duo pr`). typecheck clean · prod bundle compiles · git-subprocess fast-reject for non-checkout paths. **Live-walked (DOM-probed):** footer appears on divergence ("differs from octocat/Spoon-Knife") → confirm sheet (heading title + `duo/…-d0dd1f6` branch + real diff) → morphs to "Proposed · View PR ↗" after PR #40238. |
| **Phase 3 — already-local detection** (`core/git/local-clone-match.ts` + socket `open` branch + `OPEN_MATCH_LOCAL_CLONE` IPC + OpenBar third choice + `duo open --checkout`) | D6 | 🚧 BUILT + tested 2026-06-21 · **live walk owed** | typecheck clean · 6 pure tests (`remoteMatchesRepo`) · currency 76/76 · prod bundle compiles. Before a checkout, matches the repo against navigator git-root projects (by `origin` remote + file-exists); opens from the user's clone (modality 1) — UI offers it, CLI prefers-and-reports (`--checkout` overrides). Never edits the user's tree; footer gated to managed checkouts. The spawning `matchLocalClone` verified live (owed). |
| **Phase 4 — format breadth + escape hatch** (`ProposeBar` in `JsonView` + `PageTab`; `core/git/share-back.exportCheckoutFile` + `duo pr export`) | D8, D4 | 🚧 BUILT + tested 2026-06-21 · **live walk owed** | typecheck clean · 1750 tests · currency 76/76 · prod bundle compiles. The "Propose changes" footer now mounts in the JSON/YAML viewer + the HTML canvas (format-agnostic round-trip — D8); `duo pr export <path> <dest>` is the D4 "save a local copy" escape hatch; binary stays view-only (footer is text-editor-only). UI "Save a copy…" affordance deferred (surface = owner UX choice). |

**Sequencing note.** D16 landed against the standalone `CloneModal` so the
owner-requested success fix shipped immediately; the Open bar now *routes* a
GitHub repo/file into that (prefilled) modal (D15 "phased" depth — routing, not
the full-inline port). The resolver + recents store are the foundation the Open
bar consumes — landed + tested ahead of the UI so the surface build was
lower-risk.

## 6b · Plan deltas / change log

Newest first. Captures decisions + scope changes that diverge from the original
spec so the history is legible.

- **2026-06-21 — Phases 3 + 4 built (owner: "build all phases").** Phase 3 (D6
  already-local detection): `matchLocalClone` over the navigator's git-root
  projects, routed into both the socket `open` github-file branch (CLI
  prefers-local + reports the path; `--checkout` forces the opaque checkout) and
  the Open bar (a third "Open from your local clone" choice via
  `OPEN_MATCH_LOCAL_CLONE`). Deliberate UI/CLI split — the UI OFFERS (D6 "offer,
  not silent reuse"), the CLI prefers-and-reports (transparent, overridable). We
  only OPEN (never edit) the user's tree, and the footer is gated to managed
  checkouts, so no surprise PR. Phase 4 (D8 format breadth + D4 escape hatch):
  the `ProposeBar` footer now also mounts in the JSON/YAML viewer + the HTML
  canvas (the share-back core was already format-agnostic), so `.json`/`.yaml`/
  `.html` round-trip via the same path; `duo pr export <path> <dest>` saves a
  real local copy (the D4 escape hatch); binary stays view-only (footer is
  text-only). The UI "Save a copy…" affordance is deferred (surface = an owner UX
  choice). typecheck clean · 1750 tests (+6 `remoteMatchesRepo`) · currency 76/76
  · prod bundle compiles. **Owed:** a live walk of Phases 3–4 (re-request Electron).
- **2026-06-21 — Phases 1–2 LIVE-VERIFIED end-to-end (owner granted Electron).**
  Walked the full driving use case against `octocat/Spoon-Knife` on this
  worktree's dev build: (1) `duo open <github-file>` → checkout reused, README
  opened as the active editor tab, navigator cwd = the checkout folder, recent
  recorded under the canonical URL; (2) edited + saved → the **"Propose changes"
  footer appeared** (inert before the edit) reading "This doc differs from
  octocat/Spoon-Knife"; (3) the **confirm sheet** rendered with the title
  prefilled from the doc's heading, branch `duo/well-hello-there-…-d0dd1f6`, the
  fork-note, and the **real inline diff**; (4) `duo pr create` →
  **auto-fork + cross-fork PR** (D3) → real PR
  [#40238](https://github.com/octocat/Spoon-Knife/pull/40238) (`forked:true`,
  `pushedTo:dudgeon`, head `dudgeon:duo/…` → base `main`, author dudgeon —
  confirmed via `gh`); (5) the footer **morphed** to "Proposed · View PR ↗"
  (D13). **Bug found + fixed live (`16a23b7`):** on a fresh checkout
  `duo pr status` reported a *stranger's* `head:main` PR (#40234, LaxmanVLomate) —
  `gh pr list --head main` matches any fork's PR in a popular repo, and
  `probeShareBackStatus` queried with no owner; fix gates the PR-match to
  `duo/…` share-back branches (`isShareBackBranch`, +3 tests). The static review
  missed it; only live testing surfaced it. *v1 note:* the footer re-polls on
  save / tab-activation — a CLI-side `duo pr create` doesn't push the morph to an
  already-open editor until the next re-poll (the in-UI sheet-submit morphs
  immediately; acceptable surface split).
- **2026-06-21 — Phase 2 core share-back plumbing built (owner-scoped, no
  Electron).** Owner picked "start Phase 2, core git-write plumbing first". Built
  the net-new git-WRITE core under `core/git/`: `divergence.ts` (P5 —
  `git status --porcelain` → the "Propose changes" trigger), `proposal-meta.ts`
  (D7 prefill — pure heading→title/slug→branch), `branch/commit/push.ts` (thin
  execGit wrappers + pure arg-builders), `fork.ts` (D3 — `permissionAllowsPush` +
  `probePushAccess` + `runFork`), `pr.ts` (`gh pr create`/`gh pr list` + pure
  parsers), `failure-sniff.ts` (shared auth-stderr classifier), and the
  `share-back.ts` orchestrator (`runShareBack`, `probeShareBackStatus`,
  `resolveCheckoutDirForPath`). Plus `duo pr create|status|view` (socket
  `case 'pr'` → dynamic-imports share-back, mirroring `case 'clone'`) + the
  `'pr'` DuoCommandName + 5-surface doc sync. **§12-clean:** everything is read
  LIVE from the checkout's git + gh — owner/repo from origin, base from the
  current branch, PR state from `gh pr list`; nothing mirrored. **D4-guarded:**
  `isManagedCheckout` + `resolveCheckoutDirForPath` refuse any path outside
  `~/.claude/duo/checkouts/`, so share-back can never touch the user's own tree.
  **Tested:** 42 pure unit tests (the spawning `run*` orchestrators are verified
  live like `runClone`, owed). **Deferred (needs Electron):** the UI footer
  affordance (D10–D13) + a real `duo pr create` live walk. *An adversarial review
  pass (3 lenses → per-finding verification) hardened the update/cross-fork path
  before commit:* (1) `findOpenPr` is now owner-aware (`selectPr` filters by
  `headRepositoryOwner`) so a cross-fork PR is matched + a same-branch-name PR in
  someone else's fork can't be mistaken for ours — fixing the D13 "update vs
  duplicate-PR" bug; (2) a re-proposal **reuses** the existing `duo/…` branch
  rather than deriving a new name off the moved HEAD; (3) a `committed:false`
  (race / nothing staged) short-circuits to no-divergence instead of an empty PR;
  (4) `branch-failed` errorKind split from `commit-failed`. The review confirmed
  the D4 traversal guard, execFile (no-shell) injection-safety, and OQ-3 staging
  scope as correct.
- **2026-06-21 — Phase 1 CLI twin landed (rule #4 parity).** `duo open
  <github-file-url>` now does what the Open bar's "open just this doc" does: the
  socket `open` handler (`core/socket-server.ts`) classifies its target via the
  shared resolver and, for a github-file, runs the SAME managed checkout through
  a new optional `NavBridge.runManagedCheckout` (wired in `electron/main.ts` to
  `core/open-checkout.runManagedCheckout` — one engine, shared with the
  `OPEN_GITHUB_FILE` IPC the UI uses), then opens the checked-out file
  (`nav.edit`) + focuses the checkout folder (`nav.reveal`) + records the
  github-file recent. Auth-missing bounces to `gh auth login`; a bare-repo /
  non-file GitHub URL still opens in the browser pane (unchanged). The CLI's own
  `resolveOpenTarget` now https-prefixes a scheme-less github host (so
  `duo open github.com/o/r/blob/…` resolves correctly instead of file://-ifying).
  No new verb / IPC channel — the existing `open` verb already forwarded
  `url` + `origin`, so this is a behavior extension. +4 socket tests; 5-surface
  doc sync. **Live-verify owed** (a real `duo open <github-url>` against the
  running app needs Electron, which is currently unavailable to the agent).
  *An adversarial code-review pass (3 lenses → per-finding verification)
  hardened four points before commit:* (1) gate `result.ok` on `nav.edit()`
  actually mounting the doc (a failed edit no longer reports success); (2)
  record the recent under the **canonical** `github.com/blob` URL so a raw /
  permalink variant stores the SAME pointer the UI does; (3) reveal the **file**
  (not the dir) so the navigator lands *inside* the checkout folder (D5),
  matching the UI's `navigateTo(checkoutDir)` rather than its parent; (4) accept
  `www.raw.githubusercontent.com` in the core resolver (symmetric with the
  already-handled `www.github.com`). Left as-is by design: `--canvas`/`mode` is
  ignored for a github-file (matches the UI's `openFileSmart`-without-mode); the
  slashed-branch ref limitation stays a documented v1 resolver edge (both
  surfaces, unchanged).
- **2026-06-21 — DR1–DR6 resolved → Phase 1 unblocked.** DR1/DR3/DR4/DR5 were
  settled by the Phase-0 build (inline file-vs-repo choice · prefilled-CloneModal
  hand-off · open-file-after-clone hero · light convergence) and validated in the
  live walk — no re-walk needed. **DR2 = "always ask, never remember"** (owner):
  no per-repo memory; the file-vs-repo choice shows every time (drop the mock's
  "Remember for ‹repo›" checkbox). **DR6 = sparse-checkout the file's folder
  (shallow)** (agent rec, owner-delegated): the opaque managed checkout pulls
  just the doc's folder at depth-1, so "just this doc" stays light/instant — the
  real differentiator from Phase-0's visible whole-repo clone — while keeping
  real git for the PR diff. *v1 edge:* cross-folder relative assets (`../assets/`)
  may not resolve; documented, and **whole-repo depth-1 is the swappable fallback**
  if the sparse plumbing proves fragile. Phase 1 (P2+P3+P4: github-file → managed
  sparse checkout → open-as-local) is now decided + buildable.
- **2026-06-21 — Renumbered ENH-221 → ENH-224.** The *other* agent's ENH-221
  (durable file version history, `claude/enh-221-file-history`) merged to `main`
  first (#104), so per the multi-agent ticket-collision rule this (unmerged) work
  took the next free id. Mechanical rename across code/tests/docs + the PRD
  filename (`enh-221-file-open-flow.md` → `enh-224-…`); git history keeps the
  prior `ENH-221` commit messages. PR #102 + this branch rebased onto `main`
  (only conflict: a one-line import block in `electron/main.ts`); MERGEABLE.
- **2026-06-21 — D18 (⌘O = ONE merged surface).** ⌘O was already the vault
  quick-switcher. Rather than relocate it to a second chord, the owner chose to
  make ⌘O a single "open anything" surface that *subsumes* the switcher
  (fuzzy-find + paste/Browse/recents). `VaultQuickSwitcher.tsx` retired; the File
  ▸ Open… menu accel is display-only (`registerAccelerator:false`) so the
  renderer's existing global ⌘O stays the canonical handler.
- **2026-06-21 — D19 + Phase-1 scope refinement (github-file).** A GitHub *file*
  URL shows the file-vs-repo choice. Insight: **"clone the whole repo, then open
  the file" is fully buildable today** (clone + local open) — only the *sparse
  "just this doc"* round-trip is DR-blocked. So Phase 0 shipped the clone-and-open
  path (live) with "just this doc" as a disabled **"Soon"** tile, and Phase 1 was
  re-scoped to *just* the sparse-checkout path (§ 6). The mock's full-inline merge
  (D15/DM1) stays **phased** for this increment — the Open bar *routes* into the
  existing prefilled `CloneModal` rather than porting clone inline.
- **2026-06-21 — Shipping constraint.** Owner: *"we will not ship until the full
  plan is built."* Phase-0 interim states (the "Soon" tile, the modal hand-off)
  are scaffolding, not a shippable surface — so they don't need to be
  ship-quality in isolation; they need to be correct groundwork for the blocked
  phases. Recorded so a future "propose a cut" moment doesn't fire prematurely on
  the Open bar alone.
- **2026-06-20 — D14–D17 + the Phase-0 core** (resolver, recents store, D16
  success redesign) landed in the cloud session; see § 6a.

## 6c · Phase-0 follow-ups — live-walk punch list (2026-06-21)

Surfaced during the agent computer-use walk of the merged Open bar (every core
flow passed — § 6a). Polish/consistency items. **All three ✅ DONE + live-verified
(computer-use, 2026-06-21)** — owner greenlit execution after the plan-capture
(`bbe29cd`). typecheck clean · 1676 tests · currency 75/75 · dev log clean.

- **FU1 ✅ DONE — CloneModal: a "Choose…" button for the destination folder
  (owner-raised, 2026-06-21).** *Shipped:* new `OPEN_PICK_DIR` IPC
  (`window.electron.open.pickDirectory()`, openDirectory + createDirectory) +
  the "Choose…" button. Live-verified: folder-only picker (files greyed, "New
  Folder" enabled), message "Pick (or create) a folder to clone into". The clone-confirm's "Parent directory" field is
  type-only today. Add a button that opens the native folder picker
  (`dialog.showOpenDialog` with `properties: ['openDirectory','createDirectory']`)
  and writes the pick back to the field — the same native-picker pattern as the
  Open bar's Browse… (D17), and exactly what the merged-UI mock **state 3** shows
  ("Clone into … [Browse…]"). Reuse: model on the existing `VAULT_CREATE_PICK_DIR`
  folder-picker IPC, or add a folder-only mode to the new `OPEN_BROWSE` handler.
- **FU2 ✅ DONE (consistency pass; full merge deferred) — Modal width/placement
  consistency (owner-raised, 2026-06-21; refines D15/DM1).** *Shipped:* the
  CloneModal now matches the Open bar — `w-[640px]` + top-anchored `pt-24` (was
  `w-[480px]` + centered) — so the OpenBar→CloneModal hand-off reads as one
  surface morphing (live-verified: same width + top position). *Still deferred:*
  the full-inline merge (D15/DM1) + a `NewVaultModal` geometry audit. Original
  analysis kept below for the deferred work. The open flow showed **≥2 distinct
  Duo modals with mismatched geometry**: the **Open bar** (`.duo-qs-shell` —
  `min(640px, 92vw)`, **top-anchored** ~96px) and the **CloneModal** (was
  `w-[480px]`, **centered**) — the hand-off jumped in *both* width and position.
  - *Pragmatic recommendation — do now:* unify geometry. Give the CloneModal the
    Open bar's width (~640px) + top-anchor (~96px) so the hand-off reads as one
    surface morphing, no jump. Cheap; captures most of the win.
  - *Endpoint — defer:* the **full-inline merge** (D15/DM1) folds the clone
    fields *into* the Open-bar shell so there is literally one modal — heavier;
    reassess when the GitHub round-trip (Phase 1/2) lands. Owner: *"be pragmatic,
    don't merge if a bad idea."* → lean to the consistency pass; treat the full
    merge as optional.
  - *While here:* audit `NewVaultModal` (+ any other DOM modal in this flow) for
    the same geometry so all of Duo's modals read consistently.
- **FU3 ✅ DONE — ⌘O from terminal focus (agent live-walk finding, 2026-06-21).**
  ⌘O opened the bar from editor/browser focus + the menu, but **not from the
  terminal column** (xterm swallowed the key — pre-existing; the old quick-
  switcher had the identical gap). *Shipped:* the File ▸ Open… menu item now
  **registers** the ⌘O accelerator (dropped `registerAccelerator: false`) — a
  native menu accelerator fires regardless of which pane/WebContents has focus,
  making ⌘O *the* open affordance everywhere (D1/D18). Live-verified: focused
  the terminal, ⌘O opened the bar.

## 7 · Open questions (build-time / owner)

- **OQ-1 — RESOLVED (UI-study walk, 2026-06-20).** Affordance treatment decided
  via [`docs/research/file-open-submit-pr-ui.html`](../research/file-open-submit-pr-ui.html):
  **footer "propose" bar** (D10), labeled **"Propose changes"** (D11), **full
  confirm sheet with inline diff** (D12), **morph-in-place** post-PR (D13). Now
  locked in § 3.
- **OQ-2 — Baseline staleness / push rejection.** Upstream moves after checkout;
  push is rejected or the PR conflicts. **v1:** attempt the push; on rejection,
  surface the conflict plainly ("upstream changed — pull latest"). Richer
  auto-rebase/sync deferred.
- **OQ-3 — Multi-file edits in one checkout.** One checkout can accumulate edits
  to several files. **v1:** the branch/PR carries whatever diverged in that
  checkout (PR scoped to the checkout). Per-file PRs deferred.
- **OQ-4 — Private repos / SSO orgs.** Relies entirely on `gh` (D9). Document
  the dependency; no special handling in v1.
- **OQ-5 — Fork hygiene.** Reuse an existing fork if the user already has one;
  branch-naming convention (`duo/<doc-slug>-<short>`); fork cleanup is **not**
  Duo's job (leave the fork).
- **OQ-6 — Checkout GC.** Managed checkouts accumulate under
  `~/.claude/duo/checkouts/`. **v1:** leave them; add a prune later (size/age).
- **OQ-7 — File-vs-repo choice + clone convergence (owner-raised 2026-06-20).** A
  GitHub *file* URL is ambiguous: open just the doc (managed sparse checkout) or
  clone the whole repo (work in it). The Open flow should **present that choice**,
  and the "clone the repo" branch should **converge with Duo's already-shipped
  clone flow** (`duo clone` / `core/git/clone.ts runClone` / `CloneModal`) rather
  than grow a parallel one. **Flow map + refactor proposal:**
  [`docs/research/file-open-flow-map.html`](../research/file-open-flow-map.html)
  (DR1 presentation · DR2 default/memory · DR3 reuse CloneModal · DR4 open-file-after-clone
  · DR5 refactor-now-light · DR6 refines D5 to sparse-folder). Recommendation:
  converge **now, light** (parameterize `runClone({depth,openAfter})` + route the
  ⌘O "clone" choice through the prefilled CloneModal — routing, not a rewrite).
  Walk to lock; this slightly **reopens D5** (DR6). **Merged-UI study** (the
  single Open+Clone surface + the clone-success-screen redesign — Open/Done hero
  replacing "Clone another"):
  [`docs/research/file-open-clone-merged-ui.html`](../research/file-open-clone-merged-ui.html)
  (DM1 merge depth · DM2 success hero · DM3 native file/folder picker — a Browse…
  button alongside paste).

---

## 8 · Cross-refs

- **Reuse:** `core/git/clone.ts` (depth-1 clone, gh-preferred), `core/git/auth.ts`
  (`probeGhAuth`), `core/git/status.ts`, `core/git/remote-url.ts` (parse/rewrite),
  `cli/duo.ts` (`resolveOpenTarget`, `open`/`edit`/`view`),
  `renderer/components/fileClassifier.ts`, `renderer/hooks/useNavigator.ts`.
- **Net-new:** `core/open/{resolve,checkout}.ts`,
  `core/git/{branch,commit,push,fork,pr}.ts`, Open-bar component + Open Recent
  (recents store), "Propose changes" footer affordance, `duo pr …` + `duo recent`
  verbs.
- **Related tickets:** ENH-154 (`gh-link` — link local folder ↔ GitHub repo),
  ENH-155 (FileTree GitHub menu — "Open on GitHub" / "Copy GitHub URL"),
  ENH-152 (navigator git-status overlay), FOLLOWUP-025 (Clone modal),
  `docs/research/github-integration-cluster-v2.html` (prior GitHub-cluster
  research). This ENH is the "round-trip an external doc" complement to that
  cluster's "manage my own repo" focus.
- **Invariant (CLAUDE.md §12 — no sidecar).** The checkout pointer stores only
  IDs/paths that resolve live (`owner/repo/ref/path/checkoutDir/baselineSha`,
  `prNumber/prUrl/branch/forkOwner`). GitHub PR/branch state is read live via
  `gh`, never mirrored. **Recents (D14)** are a Duo-owned concept the external
  system doesn't track ("what you opened in Duo's Open bar") — acceptable per
  §12: stored as `{ target, label, kind, lastOpenedAt }` pointers, resolved
  live, missing entries self-healed.
