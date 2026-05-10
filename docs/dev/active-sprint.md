# Active sprint state — Sprint 13 (cut target v0.6.11)

**Theme:** Paste-image v1 → v2. The Sprint 12 cut shipped paste-image as
a workflow-unblock with a known trade-off: blob URLs in markdown source
that don't survive doc reload (`![](blob:http://localhost:5173/...)`).
Sprint 13 closes that debt by storing relative paths in source and
hydrating displayable URLs at mount time. Plus four carry-overs that
keep the editor-canvas parity story clean and remove daily friction.

**Owner directive (2026-05-09 post-cut, AUQ answers):** P0 = FOLLOWUP-014
paste-image v2 (custom Image NodeView). Carry-overs: ENH-125 canvas-CLI
parity for `duo image insert`, v0.6.10 walk-carryover (canvas paste +
drop + CLI verb walk), BUG-101 `duo edit` doesn't auto-focus tab,
ENH-116 trim SKILL.md verbosity.

---

## Status (2026-05-09 — sprint open)

- **FOLLOWUP-014 (P0 anchor — paste-image v2):** ⬜ Not started.
- **ENH-125 (canvas-CLI parity for `duo image insert`):** ⬜ Not started.
- **BUG-101 (`duo edit` doesn't auto-focus tab):** ⬜ Not started.
- **ENH-116 (trim SKILL.md):** ⬜ Not started.
- **v0.6.10 walk-carryover (canvas paste + drop + CLI verb walk):**
  ⬜ Walk owed before v0.6.11 cut. See [docs/dev/v0.6.10-walk-carryover.md](v0.6.10-walk-carryover.md).

---

## P0 anchor — FOLLOWUP-014 paste-image v2

**Pre-state (v0.6.10):** [renderer/components/editor/MarkdownEditor.tsx](../../renderer/components/editor/MarkdownEditor.tsx) `handlePaste` / `handleDrop` insert via `setImage({ src: blobUrl })`. tiptap-markdown serializes the src as-is, so disk source carries `![](blob:http://localhost:5173/<uuid>)` — renderer-process-scoped, dies on doc reload. Same trade-off in [renderer/components/Page/pagePaste.ts](../../renderer/components/Page/pagePaste.ts) for the canvas surface.

**v2 plan (custom Image extension):**
1. New extension at `renderer/components/editor/extensions/DuoImage.ts` — extends `@tiptap/extension-image`.
2. `addOptions()` adds a `getDocPath: () => string | null` callback the editor passes in.
3. `addAttributes()` keeps `src` (relative or abs as authored) AND adds a private `__resolvedSrc` (transient, not serialized).
4. `renderHTML(node)` resolves: if `node.attrs.src` is relative, prepend `dirname(getDocPath())/` + read bytes via `files.read` + create blob URL → use that as the rendered `<img>` src. If absolute (file://, duo-asset://, http(s)://), use as-is.
5. `parseHTML` reads `src` as-given (no resolution).
6. tiptap-markdown serializes the original `src` attribute (unchanged) → markdown stays portable.
7. Update handlePaste/handleDrop to insert with `result.relPath` (the bare filename) instead of the blob URL.
8. Mirror to the canvas surface (`pagePaste.ts`) — analogous resolution at insert time + a separate post-load pass to hydrate any existing `![](relative-path.png)` already in the doc.

**Open scope questions (decide during build):**
- NodeView (async-aware) vs. renderHTML (synchronous, must precompute) — NodeView lets the resolution happen async on mount; renderHTML can't await files.read. NodeView is the right architecture but bigger lift.
- Caching: read file once per src, hold blob URL in a per-doc cache so re-renders don't re-read. Memory implications for large docs with many images.
- Cleanup: revoke blob URLs on tab unmount to avoid leaks. (See ImageView's pattern.)

---

## Carry-overs

### ENH-125 — canvas CLI parity for `duo image insert`

Closes the explicit `(c)-Deferred` from v0.6.10's editor-canvas parity disposition. v1 ships markdown-editor target only; v2 adds canvas dispatch. Implementation:
1. Add `EDITOR_IMAGE_INSERT` listener to `PageTab.tsx` mirroring [MarkdownEditor.tsx](../../renderer/components/editor/MarkdownEditor.tsx)'s handler.
2. App.tsx-level dispatch: when an `image-insert` request arrives, route to whichever editor is active (markdown OR page); error if neither.
3. Reply contract unchanged (`ImageInsertResult { absPath }`).

### v0.6.10 walk carry-over

Items shipped without their own walk per [docs/dev/v0.6.10-walk-carryover.md](v0.6.10-walk-carryover.md): canvas paste-image, canvas drop-image, `duo image insert` CLI verb (markdown editor), ENH-121 console forwarder regression check. Walk these BEFORE v0.6.11 cut.

### BUG-101 — `duo edit` doesn't auto-focus the opened tab

Editor-half landed in v0.6.9 (React anti-pattern + visibility filter). The remaining symptom: `duo edit /path/to/file.md` opens the file as a tab but the active editor stays on whatever was active before. Forces "click the tab manually" in every walk script + every CLI flow. Polluting test patterns. Sprint 13 fix likely lives in App.tsx's `openFile` dispatcher: after the rAF chain, also flip `setActiveWorking({ kind: 'file', id: newTabId })`.

### ENH-116 — trim `.claude/skills/smoke-walk/SKILL.md`

File is 600+ lines as of 2026-05-09. Runtime skill-loading budget cuts long skills; rules near the bottom (§ 5b checks 4-6, § 7 result-parsing, manifest-authoring tips) get truncated and silently drop from Claude's working context. Audit:
1. Move detailed sections to `.claude/skills/smoke-walk/references/<topic>.md`.
2. Collapse violation callouts ("Violated 2026-05-04…") into a single incidents-reference sub-doc.
3. Tighten redundant prose (every blockquote-callout duplicates the rule above).
4. Keep procedure-active-verbs in SKILL.md proper.

---

## Sequencing

1. **Walk the v0.6.10 carry-over first** — confirms the v0.6.10 cut is functionally complete on canvas + CLI before piling new work on top.
2. **FOLLOWUP-014 paste-image v2** — the P0 anchor. Markdown editor first, then canvas mirror. ENH-125 may absorb naturally if the canvas paths get touched.
3. **BUG-101 + ENH-116** in parallel where convenient — small scopes, reduce daily friction independent of the P0.
4. **Cut v0.6.11** when all five items pass walk.

---

## Deferred to Sprint 14+

- ~~ENH-126 (was Sprint 14 P0)~~ ✅ Pulled into Sprint 13 + shipped v0.6.11 (2026-05-09) after owner escalation. Auto-redistribute on aux-open: terminal-visible → 33/33/33; terminal-collapsed → main+split 50/50. ENH-099 (`⌘⌥4` chord) is still queued for a future sprint as an on-demand trigger using the same canonical-layout target.
- ENH-110 JSON viewer (data-primitives canvas cluster — research doc landed at `docs/research/data-primitives-canvas.html`).
- ENH-118 image-type handling discussion (GIF freeze-on-first-frame? SVG safety? HEIC?).
- ENH-119 image-in-selection tint.
- ENH-120 clipboard preserves image bytes when copying out.
- ENH-117 view-source for markdown / HTML.
- ENH-122 `duo dom <selector>` (renderer DOM query CLI).
- ENH-123 `duo devtools` (open renderer DevTools from CLI).
- ENH-124 `duo layout` (working-pane state snapshot CLI).
- BUG-100 Send→Duo pill in aux browser pane.
- BUG-093 split-view crash (owner-blocked on live repro + console traces).
- Backlinks panel / graph view (Obsidian cluster continuation).
- Split-view feature-parity refactor scrutiny (per Geoff's 2026-05-09 ask — at file-tab render level there's NO disparity, real disparities are intentional v1 simplifications; revisit if multi-tab aux becomes a real workflow ask).
