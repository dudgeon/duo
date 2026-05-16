# BUG-125 v2 — canvas baseline tracking when Duo injects runtime decoration

**Status:** 🆕 Filed 2026-05-16 after v0.7.0 walk surfaced a real semantic problem in BUG-125's v1 fix.
**Parent:** BUG-125 (PR #49 merged today — symlink-resolved watcher path remap).

## What the walk caught

Step 5 of BUG-125 sub-test (a) — "Clean canvas reload via symlinked path":

1. Seed `/tmp/bug125-walk.html` with `<!DOCTYPE html><html><body><p>before</p></body></html>` (56 bytes).
2. `duo edit /tmp/bug125-walk.html` — opens in canvas mode. Buffer is CLEAN (no user edits).
3. Externally `printf '<!DOCTYPE html><html><body><p>after</p></body></html>' > /tmp/bug125-walk.html` (56 bytes).
4. **Expected:** silent reload — canvas now shows "after" (clean buffer + external write = no conflict, just reload).
5. **Actual:** canvas shows "after" AND a conflict banner appears.

## Root cause (visible in BUG-124's conflict log owner pasted)

```json
{
  "ts": "2026-05-16T20:45:59.774Z",
  "path": "/tmp/bug125-walk.html",
  "trigger": "save-pre-reconcile",
  "surface": "canvas",
  "diskLength": 56,
  "baselineLength": 415,           ← !!! baseline is 415, not 56
  "liveLength": null,
  "recentlyWrittenSize": 0,
  "diskHead": "<!DOCTYPE html><html><body><p>external</p></body></html>",
  "baselineHead": "<!doctype html>\n<html>\n  <head>\n    <style data-duo-style=\"duo-image-selection-t",
  "diskTail": "<!DOCTYPE html><html><body><p>external</p></body></html>",
  "baselineTail": "S\">\n    <p data-duo-id=\"01KRS7CE5ENZEEMFTDBVPSVVZE\">before</p>\n  </body>\n</html>",
  "firstDiffOffset": 2,
  "appVersion": "0.7.0"
}
```

**The canvas baseline includes Duo runtime injection that wasn't on disk.** Specifically:

1. `data-duo-id="01KRS7CE5..."` — stable-ID anchor injected automatically when the canvas mounts. ENH-001 (Stage 17b H12 ✅) — agent-managed canvases get stable IDs at first open.
2. `<style data-duo-style="duo-image-selection-tint">…</style>` — runtime CSS injected for ENH-119 (image-selection-tint plugin).
3. Pretty-printed formatting (`<!doctype html>` lowercased, line breaks added) — likely the parsed-and-serialized DOM round-trip.

So the canvas baseline is **the live serialized DOM after Duo's runtime modifications**, NOT the disk content. When the watcher fires for an external write, the pre-save reconciliation compares:
- `baseline` = canvas's tracked DOM (415 bytes with all the injections)
- `disk` = the external write (56 bytes, plain)

They differ → conflict banner fires, even though the user's *intent* (no buffer modifications) was clean.

The fix's mental model was "baseline = the last-known-clean state of the buffer". The actual baseline is "the last-saved serialized DOM". Those diverge for HTML canvas because Duo MUTATES the DOM after mounting (the data-duo-id is added programmatically, not loaded from disk).

This isn't unique to symlinked paths — it would happen for any external write to a canvas-mode HTML file. BUG-125 v1 fixed the symlink-resolution layer but didn't notice the baseline-divergence layer because the testing fixture in dev didn't include data-duo-id injection (smaller test cases).

## What "external write" should mean

Three semantic options:

### Option A — Always reload on external write (treat the canvas as a view of disk)

Conflict banner fires only when the buffer is dirty. Clean buffer + any external write = silent reload, no questions asked. Duo's runtime modifications get re-applied to the new DOM after reload.

**Pros:** matches owner mental model; canvas is "a view of the file"; external writes win.

**Cons:** what about the `data-duo-id` anchors that the user (or agent) has been linking comments / selectors against? If the external write doesn't preserve them, the anchors break. Bug class: comment/anchor data tied to data-duo-id that vanishes on every external write.

### Option B — Compare normalized disk contents (strip Duo injections from baseline before comparison)

Pre-save reconciliation strips known Duo runtime injection from the baseline (data-duo-id attributes, data-duo-style elements, pretty-print formatting differences) before comparing to disk. Conflict only fires when the *user-meaningful* content differs.

**Pros:** preserves data-duo-id anchors across external writes (Duo re-applies them on next mount); conflict banner only fires when external write actually changed user-meaningful content.

**Cons:** complex normalization logic; brittle when new runtime injection lands; needs `core/html/duo-normalize.ts` helper shared with the disk-read path.

### Option C — Track external writes as "echoes" if the disk content normalizes to match the baseline (extends the existing echo-guard)

The `recentlyWrittenSize: 0` field in the log shows the echo-guard didn't match. The echo-guard tracks BYTES of Duo's own writes. Extend it to also recognize: "if disk content normalized = baseline normalized, this is an echo of our own state."

**Pros:** unifies with the existing recently-written guard.

**Cons:** essentially the same as Option B but routed through a different code path.

## Recommendation

**Option B (normalized comparison)** + a small `core/html/duo-normalize.ts` helper that:

1. Parses the HTML (`DOMParser` or similar).
2. Strips attributes/elements with the `data-duo-*` prefix (data-duo-id, data-duo-style, data-duo-action — anything Duo owns).
3. Re-serializes with consistent formatting.

The pre-save reconciliation + the file-watcher reload branch both call `normalize(baseline) === normalize(disk)` instead of `baseline === disk`. Conflict only fires when the user-meaningful content differs.

This also closes a related bug class: ANY external `Write` of an open canvas would currently trigger the banner for the same reason (not just symlinked paths). BUG-125 v1 made the symlink case behave like the non-symlink case — but BOTH cases had the same underlying bug; the v1 just made it visible to the walk.

## Open decisions (owner)

1. **Q1 — Pick A, B, or C** above. Default recommendation: B.

2. **Q2 — If B: what about data-duo-id round-trip?** When the canvas autosave runs, the data-duo-id attributes WERE saved to disk (so the on-disk content matches the in-memory baseline). The next open will see the stable IDs persisted. Then an external `Write` that strips them is genuinely changing the file. Is that a conflict (data loss for agent who linked comments to those IDs) or a silent reload (overwrite)?

3. **Q3 — Scope of normalization.** Just `data-duo-*` attributes? Also pretty-print formatting (lowercase tag names, attribute ordering, whitespace)? The wider the normalization, the more permissive (fewer conflicts), but the more risk of missing a real change.

4. **Q4 — Markdown editor parity.** Does the TipTap editor have the same baseline-divergence pattern? Probably not for markdown source-of-truth (TipTap reads → renders → serializes back to markdown on save). But if any TipTap extension injects characters that survive round-trip, the same fix shape applies. Investigate as part of v2.

---

## Implementation outline (deferred)

Once decisions land:

- `core/html/duo-normalize.ts` (new) — HTML normalization helper. Pure function; vitest-testable with fixture HTML.
- `renderer/components/Page/PageTab.tsx` — pre-save reconciliation calls `normalize(disk) !== normalize(baseline)` instead of byte-equality. Same change in the file-watcher reload branch.
- `renderer/utils/conflictDiagnostic.ts` — diagnostic captures both raw + normalized lengths for forensic clarity.
- Vitest coverage — normalize() preserves user content, strips data-duo-id, idempotent on pre-normalized input.
- Smoke walk regression items — sub-tests covering: canvas open + external simple-write (clean → silent reload via normalize); canvas open + external different-content-write (clean → conflict banner or silent reload per Q1); canvas open + external write that strips data-duo-id (per Q2).

Estimate: 1 dev day for normalize + reconciliation hook + tests.

---

## Walk gate

Before code:

- Owner reviews this PRD.
- Decides Q1–Q4.

Then file as **BUG-125 v2** in tasks.md (the v1 entry stays ✅ shipped — symlink remap is correct; v2 is the baseline-tracking layer).
