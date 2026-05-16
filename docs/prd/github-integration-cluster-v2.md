# GitHub-integration cluster — v2 design (post-walk)

**Status:** 🆕 Filed 2026-05-16 after v0.7.0 smoke walk surfaced multiple GH-feature failures + an owner directive: *"make an html artifact that actually shows the planned github integration features, listed out with mockups of the planned experience, to that I can know what I'm looking for — it looks like you did nothing here."*

**Why this exists.** v0.7.0 cleanup-cut shipped ENH-151 (`duo clone` CLI), ENH-152a (Navigator git chip — clean-stays-invisible), FOLLOWUP-025 (Clone modal at ⌘⇧K). Owner walked all three and rejected the UX:

- **ENH-152a**: chip never appeared even on dirty repos; owner wants a **persistent repo-root indicator** that shows you're in a git repo even when clean (currently invisible-when-clean was the wrong directive).
- **FOLLOWUP-025**: modal rendering broken (translucent overlay bleeds through body — CSS regression); defaults to `~/Documents` instead of the current Navigator cwd; chord-only entry (⌘⇧K) is unacceptable — owner wants File menu + right-click in Navigator.
- **ENH-151 (CLI)**: untested but presumed working via agent walk.

The cluster also has 4 other features sketched / partially-spec'd:

- **ENH-154**: Link a local folder to GitHub (URL ← folder); playground exists at `docs/research/link-folder-to-repo.html`.
- **ENH-155**: Right-click "Open on GitHub" / "Copy GitHub URL" on FileTree.
- **ENH-150**: Doctor panel (integration framework); playground at `docs/research/integration-primitive-design.html` is **rendering blank** per walk (separate bug).
- **ENH-152b**: Per-file dirty dots (Slice 2 of ENH-152).

This PRD-v2 mocks up the planned UX for the whole cluster so owner can confirm shape before any v2 code lands.

---

## 1. Navigator repo-root indicator (ENH-152a v2)

**Today's broken behavior.** Navigator shows no visual difference between a git repo and a plain folder. The chip-when-dirty was supposed to surface signal, but: (a) it didn't appear during the walk, and (b) owner explicitly wants a clean-state indicator too ("no visual indication that duo/ is root of a github repo in the navigator view — very bad").

**Proposed v2 shape — TWO visual elements:**

### 1a. Repo-root row decoration (always visible)

A subtle indicator next to the root folder name when it's a git work-tree root. Distinguishes a repo from a vanilla folder at a glance.

```
Navigator tree (mockup, plain repo):

  📁 duo  [main]                           ← branch chip, monospace, muted
  ├─ docs/
  ├─ electron/
  ├─ renderer/
  └─ tasks.md

Navigator tree (mockup, dirty repo):

  📁 duo  [main · 3 modified]              ← chip changes when dirty
  ├─ docs/
  ├─ electron/
  ├─ renderer/
  │  └─ App.tsx ●                          ← per-file dirty dot (ENH-152b, Sprint 18)
  └─ tasks.md ●

Navigator tree (mockup, divergent):

  📁 duo  [main · 2 ahead, 1 behind]
  ├─ docs/
  └─ ...
```

**Decisions needed (owner):**

1. **Q1.1** — Always-visible chip text format. Options:
   - `[main]` — branch only when clean.
   - `[main ↑2 ↓1]` — symbols (Apple-style).
   - `[main · 2 ahead]` — verbose (current chip format for dirty state).
   - Hide branch entirely when clean (only show on dirty/diverged) — **current behavior owner rejected**.

2. **Q1.2** — Icon vs. text. Should the root row show a git-branch icon (alongside or instead of the text chip)?

3. **Q1.3** — Where exactly? Same line as the folder name (right-aligned) OR a small badge above the tree (current implementation)?

### 1b. Per-file dirty dots (ENH-152b, Sprint 18 deferred)

Already filed. Small `●` next to file names that are dirty (staged / unstaged / untracked). Same data source as the root chip (`git status --porcelain`).

---

## 2. Clone modal v2 (FOLLOWUP-025 v2)

**Three independent issues from the walk:**

### 2a. CSS rendering bug — modal body overlay bleeds through

**Symptom.** Owner attached screenshot showing the `bg-black/40` backdrop visually bleeding through the modal body — text from the underlying playground is partially visible. The modal's `bg-background` class either isn't applying or is being defeated by a parent rule.

**Suspected cause.** `bg-background` is a Tailwind CSS-variable-driven class. Either the variable isn't defined in the canvas iframe's context (modal mounted via React, but rendered in canvas mode? unlikely — modal lives in `renderer/components/CloneModal.tsx` and mounts in the main React shell), OR Tailwind's processing dropped the rule, OR the browser-pane-overlay style of the underlying playground is intercepting paint order.

**Action.** Investigate during fix work. Mock-up assumes correct rendering:

```
┌─────────────────────────────────────────────────────────┐
│  ⊙  CLONE GITHUB REPO                              ✕    │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Repository URL or owner/repo                            │
│  ┌────────────────────────────────────────────────────┐  │
│  │ https://github.com/owner/repo or owner/repo      │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  Parent directory (final path: ~/code/proj-name)         │
│  ┌────────────────────────────────────────────────────┐  │
│  │ ~/code                                            │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│                                          [Cancel] [Clone]│
└─────────────────────────────────────────────────────────┘
```

### 2b. Default parent directory

**Today.** Defaults to `~/Documents` regardless of context.

**Owner ask.** Default to the current Navigator location.

**Proposed.** Read `state.cwd` from the Navigator state and pre-populate the parent-dir input. Falls back to `~/Documents` if Navigator state isn't available (cold start before navigator hydrates).

### 2c. Entry points

**Today.** Only ⌘⇧K opens the modal.

**Owner directive.** *"chord as only entry to modal is unacceptable; preferred: File > Clone github repo, backup: rightclick in navigator >> clone github repo"*

**Proposed entry points (all three):**

1. **Native macOS File menu** → "Clone GitHub Repo…" entry. New menu item in `electron/main.ts`'s native menu builder; dispatches NAV_OPEN_CLONE_MODAL via the existing IPC channel.

2. **Right-click in Navigator** — context menu when right-clicking a folder OR whitespace adds **"Clone GitHub repo here…"** at the top of the menu. Pre-populates the modal's parent-dir input with the right-clicked path (overrides the cwd default).

3. **⌘⇧K** — keep as the keyboard chord (no change).

**Decisions needed (owner):**

4. **Q2.1** — Should right-click on a FILE (not folder/whitespace) also show "Clone GitHub repo here…", defaulting to the file's parent folder? Or only folder/whitespace?

5. **Q2.2** — Where in the File menu does "Clone GitHub Repo…" go? After "New file"? After "Open…"? Or its own section?

---

## 3. Right-click GitHub menu (ENH-155)

**What.** New section in Navigator's right-click context menu, only shown when the right-clicked path is inside a git repo with a GitHub remote:

```
Context menu (right-click on a file in a git repo with GitHub remote):

  Open in editor
  Open in canvas
  ─────────────
  Pin to navigator
  ─────────────
  Open on GitHub          ← NEW — opens https://github.com/<owner>/<repo>/blob/<branch>/<rel-path>
  Copy GitHub URL         ← NEW — copies the same URL to clipboard
  ─────────────
  Rename
  Move to Trash
```

**Implementation outline.** Reads `git remote get-url origin` + `git rev-parse --abbrev-ref HEAD` from the same `core/git/` helpers ENH-152a uses. Composes the URL via gh-shape (replace `git@github.com:` / `git://` prefixes with `https://github.com/`, strip `.git` suffix). Falls back gracefully (menu items hidden) when remote isn't github.com.

**Sub-feature for context-menu on a folder.** Adjust the URL shape to point at the folder's tree view (`/tree/<branch>/<rel-path>`) instead of `blob`.

**Decisions needed:**

6. **Q3.1** — Should this also work for **GitHub Enterprise** hosts (`github.<company>.com`)? Detect via the `gh auth status` host value vs. URL prefix?

7. **Q3.2** — Should the bounce-list (the gh auth probe failure case) handle this menu? Probably no — if you can't reach GitHub at all, the menu item still works (just opens the URL in the system browser; gh-auth not needed for read-only links).

---

## 4. Link folder to GitHub (ENH-154)

Already-filed playground at `docs/research/link-folder-to-repo.html` with 5 owner decisions. Per walk SKIP: *"you need to advance the other, more foundational gh features before we can consider this."*

**Defer.** Revisit after Sprint 18's GH-feature work lands the items in §1–§3 above. This v2 PRD acknowledges ENH-154 but doesn't re-spec it.

---

## 5. Doctor panel — ENH-150 (separate bug)

Existing playground at `docs/research/integration-primitive-design.html` renders **blank** per walk. Separate from this cluster — **filed as BUG-XXX (playground-renders-blank)** to investigate. Doctor panel architecture itself is unchanged from the prior playground; once the rendering bug is fixed, the 4 decisions in the existing playground stand.

---

## 6. Implementation order proposal (Sprint 18 candidate)

If owner approves this PRD-v2:

1. **Repo-root chip always-visible** (§1) — small CSS + FileTree update. Half-day.
2. **Clone modal CSS fix** (§2a) — investigate + repair. Half-day.
3. **Clone modal default-cwd** (§2b) — Read Navigator state. Half-day.
4. **Clone modal entry points** (§2c) — File menu + right-click. One day.
5. **Right-click GitHub menu** (§3) — context menu item + `core/git/remote-url.ts` helper. One day.
6. **Per-file dirty dots** (ENH-152b) — Slice 2 of ENH-152. One day.

Total: ~4 dev days for a polished GH cluster.

---

## Walk gate

Before any code:

- Owner reviews this PRD.
- Decides Q1.1–Q3.2.
- (Optional) Owner approves the implementation order in §6.

Then file the work as ENH-152a v2 + FOLLOWUP-025 v2 + ENH-155 implementation tickets in tasks.md.
