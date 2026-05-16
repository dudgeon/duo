# FOLLOWUP-025 v2 — Clone modal fix-list

**Status:** 🆕 Filed 2026-05-16 after v0.7.0 walk surfaced three Clone modal issues.
**Parent:** FOLLOWUP-025 (Clone modal v1 — shipped today via ⌘⇧K).

**Scope.** Three independent fixes, all small in code-size but each requires a tiny design call. Together they take the modal from "renders broken and only reachable via chord" to "renders correctly + reachable from File menu + right-click + chord".

This PRD is part of the broader **GitHub-integration cluster v2** (see [`github-integration-cluster-v2.md`](github-integration-cluster-v2.md) § 2 for the contextual mockup). This file is the focused fix-list for just the modal.

---

## Issue 1 — CSS rendering regression

**Symptom (from walk screenshot).** The `bg-black/40` backdrop bleeds through the modal body. Underlying playground text is visible through what should be a solid modal body. Modal body's intended `bg-background` (cream/paper color in light theme, dark in dark theme) is either not applying OR is being undone.

**Suspected causes (in order of likelihood).**

1. **Tailwind variable not resolving inside the modal's React subtree.** The modal lives in `renderer/components/CloneModal.tsx`. The smoke-walk page was open in the browser pane; the modal renders in the renderer's React shell (NOT inside the WCV). If the renderer's CSS-variable cascade is somehow broken for this modal's subtree (z-index parent? CSS-variable scope?), `bg-background` resolves to `transparent`.

2. **z-index / stacking-context issue.** Modal is `fixed inset-0 z-50 flex items-center justify-center bg-black/40`. The modal body is inside that container with `bg-background`. If the body's background has `opacity` somewhere up the chain or a `mix-blend-mode` interference, the visual effect would match the screenshot.

3. **The browser pane's overlap.** WCV occlusion semantics: the browser pane's WebContentsView paints on TOP of the renderer's React layer for most regions. The modal might be rendering BEHIND the browser pane visually. But the screenshot shows the modal as the front layer with TEXT bleeding through — so this is unlikely.

**Action.** Investigate with `duo dom .bg-background --computed background-color,opacity` on the modal element. Fix once root cause is identified. Probably a one-line CSS fix once diagnosed.

---

## Issue 2 — Default parent directory

**Today.** Hardcoded to `~/Documents`:

```tsx
const DEFAULT_PARENT = '~/Documents'
```

**Owner ask.** Default to the current Navigator cwd. Falls back to `~/Documents` if Navigator hasn't hydrated yet.

**Proposed fix.**

```tsx
// Read Navigator state from the host API or via a prop drilled from App.tsx.
const navCwd = useNavigatorCwd()  // or window.electron.nav.getState().cwd
const DEFAULT_PARENT = navCwd ?? '~/Documents'
```

**Decision needed:**

- **Q1** — If the user right-clicked a folder in the Navigator and chose "Clone GitHub repo here…", should the modal default to THAT folder (the right-clicked one), not the Navigator's cwd? Probably yes — explicit context wins over implicit. Implementation: pass the path through the IPC trigger.

---

## Issue 3 — Entry points beyond ⌘⇧K

**Owner directive.** *"chord as only entry to modal is unacceptable; preferred: File > Clone github repo, backup: rightclick in navigator >> clone github repo"*

**Proposed (do all three, not "preferred OR backup"):**

### 3a. Native File menu — "Clone GitHub Repo…"

```
File
├─ New File          ⌘N
├─ New Folder…
├─ ─────
├─ Open…             ⌘O
├─ Clone GitHub Repo… ⌘⇧K   ← NEW
├─ ─────
├─ Close Tab         ⌘W
└─ Quit              ⌘Q
```

**Implementation.** In `electron/main.ts`'s native menu builder (search for the existing File menu items — probably `Menu.buildFromTemplate`), add a new MenuItem with `accelerator: 'CommandOrControl+Shift+K'` and click handler that dispatches `NAV_OPEN_CLONE_MODAL`. The IPC channel + renderer subscriber are already wired (shipped in FOLLOWUP-025 v1).

### 3b. Right-click in Navigator → "Clone GitHub repo here…"

Add to the Navigator's context-menu template (built in `renderer/components/FileTree.tsx § buildTreeMenuTemplate`):

```
Right-click on a folder OR whitespace:

  Open in editor
  Open in canvas
  ─────────────
  Clone GitHub repo here…  ← NEW (only on folder/whitespace; NOT on individual files)
  ─────────────
  New folder…
  …
```

**Implementation.** Add MenuTemplateItem in the build function; on click, send a new IPC channel `NAV_OPEN_CLONE_MODAL_WITH_PATH` (or extend the existing `NAV_OPEN_CLONE_MODAL` with an optional path arg). Renderer subscriber pre-populates the modal's parent-dir input with the right-clicked path.

### 3c. ⌘⇧K keyboard chord (no change)

Already shipped. Stays as the keystroke entry.

---

## Decisions needed (owner)

Summarizing:

1. **Q1 — Right-click default-cwd override** — does the right-clicked folder win over Navigator's cwd? (Recommendation: yes.)

2. **Q2 — Should right-click on a FILE (not folder) also show the menu entry?** With the parent-folder of the file as the default parent? (Recommendation: no — only on folders/whitespace, simpler mental model.)

3. **Q3 — File menu placement** — where in the File menu does "Clone GitHub Repo…" go? After "Open…" (current proposal)? Or in its own section after a separator?

4. **Q4 — Menu label** — "Clone GitHub Repo…" (current) vs. "Clone from GitHub…" vs. "Git Clone…" (vague). (Recommendation: "Clone GitHub Repo…" — specific.)

---

## Implementation outline (deferred)

Once decisions land:

- `renderer/components/CloneModal.tsx` — fix the CSS bleed (Issue 1), accept a `defaultParent` prop (Issue 2).
- `renderer/App.tsx` — wire the `defaultParent` from Navigator state OR the right-click IPC payload.
- `electron/main.ts` — add File menu MenuItem; extend `NAV_OPEN_CLONE_MODAL` channel to carry an optional path.
- `renderer/components/FileTree.tsx § buildTreeMenuTemplate` — add the "Clone GitHub repo here…" context menu item.
- `electron/preload.ts` — extend `onOpenCloneModal` callback signature to receive optional path.
- Smoke walk regression items.

Estimate: half-day.

---

## Walk gate

Before code:

- Owner reviews this PRD + decides Q1–Q4.
- (Optional) Owner walks the rendering-bug repro (visit the smoke walk page → ⌘⇧K → see the bleed-through).

Then file as **FOLLOWUP-025 v2** in tasks.md (v1 stays ✅ shipped — the IPC plumbing + CLI parity are correct; v2 is the modal-quality layer).
