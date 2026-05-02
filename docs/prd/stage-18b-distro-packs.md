# Stage 18b PRD — Distro skill packs (minimum viable)

> **Status:** spec drafted 2026-05-01. Sprint B of the FTUX-tutorial
> initiative. Filed in `ROADMAP.md` and `docs/roadmap.html#s18`.
>
> **Why this stage exists.** Stage 27 shipped the canvas-authoring
> primitives. Stage 28 (Sprint C) builds *content* on those
> primitives — two lesson packs (`intro-to-duo` and
> `claude-code-basics`) that the FTUX experience opens on first
> launch. Stage 18b is the *vehicle*: a `PACK.json` manifest format,
> a pack-discovery loader, and a first-launch defaults hook so a
> pack can declare "open these tabs on first boot."
>
> **Deliberately minimum.** The Stage 18b roadmap entry mentions
> `extra-skills/` merge logic, per-conflict consent UI, and a full
> provenance manifest at `~/.claude/duo/installed-packs.json`. None
> of those are required for Stage 28 to ship — the lesson skills can
> install via the existing `InstallService` path; conflict UI is a
> v2 concern; provenance can be filename-keyed for v1. Sprint B
> ships JUST what Stage 28 needs and leaves the rest to a Stage 18c
> follow-up.

---

## 1. What we're building

A pack is a directory under `~/.claude/duo/packs/<pack-name>/` with:

```
~/.claude/duo/packs/intro-to-duo/
  PACK.json                  ← manifest (REQUIRED)
  canvases/                  ← any HTML canvases the pack ships
    welcome.html
    step-1.html
  extra-skills/              ← optional lesson skills (v1 = ignored;
                               carve-out for Stage 18c)
    intro-to-duo-lesson/
      SKILL.md
```

The MINIMAL `PACK.json`:

```json
{
  "schemaVersion": 1,
  "name": "intro-to-duo",
  "version": "1.0.0",
  "title": "Introduction to Duo",
  "description": "A 5-minute interactive tour of the Duo desktop app.",
  "defaults": [
    {
      "kind": "canvas",
      "path": "canvases/welcome.html",
      "openOnFirstLaunch": true,
      "pin": false
    }
  ],
  "navPins": []
}
```

A pack with `defaults[].openOnFirstLaunch: true` opens that canvas as
a working-pane tab the FIRST time Duo boots after the pack lands on
disk. Subsequent launches do NOT reopen it — once dismissed, dismissed.
The "first-launch" flag is per-pack-version, so a pack version bump
re-fires the default-open.

---

## 2. Decisions (locked 2026-05-01)

| D# | Decision | Rationale |
|---|---|---|
| **D18b.1** | Pack location: `~/.claude/duo/packs/<name>/`. | Mirrors the existing skills convention (`~/.claude/skills/duo/`). One pack per directory. The dev's source tree may also live there for editing. |
| **D18b.2** | Manifest at `PACK.json` (NOT `pack.json`, NOT `manifest.json`). All-caps mirrors the existing `SKILL.md` convention and reduces case-sensitivity surprises on macOS. | Convention. |
| **D18b.3** | Schema version field (`schemaVersion: 1`) at the top of every manifest so future format changes don't break old packs silently. | Versioned schemas are the load-bearing v1 invariant. |
| **D18b.4** | Pack discovery is filesystem-scan based — no in-app registry. Loader walks `~/.claude/duo/packs/` once on app boot, parses every `PACK.json`, builds an in-memory `PackRegistry`. Hot-reload is out of scope for v1; restart Duo to pick up new packs. | Simplest possible; the directory IS the registry. Stage 18c can add a `duo pack install` CLI that copies into place + triggers re-scan. |
| **D18b.5** | First-launch tracking: per-pack-version flag in `~/.claude/duo/installed-packs.json`. Schema: `{"<pack-name>@<pack-version>": {firstLaunchedAt: <ISO ts>}}`. Bump pack version → flag misses → first-launch defaults re-fire. | Trivial state file. Survives upgrades. |
| **D18b.6** | `defaults[].kind` is one of `canvas` (today) or future `editor`/`browser` (deferred). Path is relative to the pack root. | Discriminated union; future-proof without committing to it now. |
| **D18b.7** | Pack registry exposed to renderer + CLI via existing IPC pattern. New `duo packs` CLI verb prints the registry as JSON. | Inventory verb is a low-cost authoring affordance. |
| **D18b.8** | `extra-skills/` directory inside a pack is **ignored in v1**. Per Stage 28's PRD note, lesson skills install via the existing `InstallService` path (`~/.claude/skills/<name>/SKILL.md`) for v1. Stage 18c folds skill merge + conflict UI in. | Carve-out: ship Stage 28 without the merge complexity. |
| **D18b.9** | First-launch defaults open via the SAME path canvas / file tabs use today (`openFileSmart`). No new mount surface. | Reuses Stage 23's trust gate (path under `~/.claude/duo/packs/<name>/` is implicitly trusted because it's under `~/.claude/duo/`). |

---

## 3. Manifest schema (v1)

Strict TypeScript shape:

```ts
export interface PackManifest {
  /** Always 1 in v1. */
  schemaVersion: 1
  /** Stable identifier. Lowercase + kebab-case. Matches the directory
   *  name under packs/ — loader rejects packs whose name field
   *  doesn't match the directory. */
  name: string
  /** semver-style; bumping re-fires first-launch defaults. */
  version: string
  /** Human-readable title (shown in `duo packs` listing, future UI). */
  title: string
  /** One-line description. */
  description?: string
  /** Tabs to open on first launch after the pack lands. Empty array
   *  means "no default-open" (the pack ships skills only, or content
   *  the user opens manually). */
  defaults?: PackDefault[]
  /** Pre-pinned navigator entries. Same shape as the user's
   *  `~/.claude/duo/nav-pins.json` — paths resolve relative to the
   *  pack root. v1 stub: read but not enforced; full wire-up in
   *  Stage 18c. */
  navPins?: PackNavPin[]
}

export interface PackDefault {
  kind: 'canvas'         // editor / browser deferred to v2
  /** Path relative to the pack root. */
  path: string
  /** When false, the default is informational only — the loader
   *  catalogs it but doesn't auto-open. Useful for "manually
   *  installable" defaults the user opts into via a pack browser
   *  (Stage 18c). */
  openOnFirstLaunch: boolean
  /** When true, after auto-open the tab gets pinned via the
   *  existing pins service. Survives session restore + ⌘W confirm
   *  gate. */
  pin?: boolean
}

export interface PackNavPin {
  /** Path relative to the pack root. */
  path: string
  /** kind hint for the navigator — usually 'file' or 'folder'. */
  kind?: 'file' | 'folder'
}
```

---

## 4. Pack registry + first-launch state

### `core/pack-loader.ts` (new)

```ts
export class PackLoader {
  /** Scan ~/.claude/duo/packs/, parse each PACK.json, return registry. */
  async scan(): Promise<PackRegistry>
}

export interface PackRegistry {
  packs: LoadedPack[]
}

export interface LoadedPack {
  name: string
  version: string
  manifest: PackManifest
  /** Absolute path to the pack directory. */
  rootDir: string
  /** Errors encountered while parsing this pack (malformed JSON,
   *  schemaVersion mismatch, missing fields). Non-fatal — a pack
   *  with errors still appears in the registry but its `defaults`
   *  won't fire. */
  errors: string[]
}
```

### First-launch state file

Location: `~/.claude/duo/installed-packs.json`

```json
{
  "schemaVersion": 1,
  "packs": {
    "intro-to-duo@1.0.0": {
      "firstLaunchedAt": "2026-05-08T14:32:11Z"
    }
  }
}
```

Atomic tmp-rename writes (mirrors the pins service pattern). Missing
or corrupt file = treat all packs as not-yet-first-launched.

---

## 5. First-launch defaults hook

In `electron/main.ts`'s app-ready / window-ready path (after the
session-state restore completes):

```ts
const packRegistry = await packLoader.scan()
const installedPacksState = await loadInstalledPacksState()
for (const pack of packRegistry.packs) {
  const key = `${pack.name}@${pack.version}`
  if (installedPacksState.packs[key]) continue   // already first-launched
  for (const def of pack.manifest.defaults ?? []) {
    if (!def.openOnFirstLaunch) continue
    if (def.kind === 'canvas') {
      const absPath = path.join(pack.rootDir, def.path)
      // Use the existing renderer "open file" channel — same path the
      // navigator uses. Trust gate honors the pack's location under
      // ~/.claude/duo/.
      mainWindow!.webContents.send(IPC.NAV_EDIT, absPath)
      if (def.pin) {
        // Future: dispatch pin via existing pins service; for v1,
        // just open without pinning to avoid pin-state churn during
        // first launch.
      }
    }
  }
  installedPacksState.packs[key] = { firstLaunchedAt: new Date().toISOString() }
}
await saveInstalledPacksState(installedPacksState)
```

Race notes:
- The renderer must be ready to receive NAV_EDIT before the loop
  fires. Wire after `session-state restore` so tab state is
  hydrated.
- Multiple `defaults[]` from one pack = multiple NAV_EDIT events;
  they accumulate as separate file tabs.

---

## 6. CLI surface

### `duo packs` (new verb)

```bash
duo packs                       # list every loaded pack as JSON
duo packs --json                # same; --json is implicit but
                                # documented for shell symmetry
```

Output:
```json
{
  "packs": [
    {
      "name": "intro-to-duo",
      "version": "1.0.0",
      "title": "Introduction to Duo",
      "rootDir": "/Users/.../  .claude/duo/packs/intro-to-duo",
      "defaults": [
        {"kind": "canvas", "path": "canvases/welcome.html", "openOnFirstLaunch": true}
      ],
      "errors": []
    }
  ]
}
```

Plumbing checklist (CLAUDE.md item 4):
- `shared/types.ts` — `DuoCommandName` add `packs`
- `core/socket-server.ts` — new case wired to `nav.getPacks()`
- `core/pack-loader.ts` — registry source
- `electron/main.ts` — bridge `getPacks: () => packRegistry`
- `cli/duo.ts` — verb + help update + binary rebuild
- `skill/SKILL.md` + `agents/duo.md` cheat-sheet
- `docs/CLI-COVERAGE.md` inventory

---

## 7. Commit-by-commit sequence (Sprint B)

| # | Commit | Files touched | Verifies |
|---|---|---|---|
| 1 | `PackManifest` schema spec + this PRD | `docs/prd/stage-18b-distro-packs.md` (new), `shared/types.ts` (PackManifest interface), `ROADMAP.md` + `docs/roadmap.html` Stage 18b card flip to "Sprint B in flight" | typecheck clean |
| 2 | `core/pack-loader.ts` + scan/parse | `core/pack-loader.ts` (new), `electron/main.ts` (construct loader on app ready), `shared/types.ts` (LoadedPack / PackRegistry) | typecheck; loader handles missing dir gracefully |
| 3 | First-launch defaults hook + `installed-packs.json` | `core/installed-packs-service.ts` (new), `electron/main.ts` (hook after session restore) | hand-build a mock pack at `~/.claude/duo/packs/test-pack/`; first launch opens; second doesn't |
| 4 | `duo packs` CLI verb | `shared/types.ts`, `core/socket-server.ts`, `cli/duo.ts`, `cli/duo` rebuild, `skill/SKILL.md`, `agents/duo.md`, `docs/CLI-COVERAGE.md` | `duo packs` returns JSON array |
| 5 | End-of-sprint smoke walk page + manifest | `docs/dev/smoke-walks/v0.6.0-stage-18b-rev1.{html,json}` | hand-walk: install pack, restart, verify default tab opens, dismiss, restart, verify NOT reopened |

---

## 8. Out of scope for Stage 18b (carve-outs to Stage 18c)

- `duo pack install <path>` CLI. v1 packs install via `cp -r`.
- Per-conflict consent UI for skill merges.
- Skill provenance tracking with sha-keyed conflict detection.
- Hot-reload of packs without restart.
- Pack signing / verification.
- A pack browser UI in Duo.
- `extra-skills/` merge logic — v1 ignores the directory; lesson
  skills go through `InstallService` directly.

---

## 9. Cross-refs

- `ROADMAP.md` lines 138–139 — Stage 18b entry
- `docs/prd/stage-27-canvas-authoring.md` — primitive surface
- `docs/prd/stage-28-lesson-packs.md` — Sprint C consumer
- Stage 24 (pin convention; `defaults[].pin` reuses the pins service)
- Stage 23 (canvas-action trust gate; pack canvases under `~/.claude/duo/packs/` are trusted)

---

## 10. Verification (smoke-walk punch list at sprint end)

| V# | Item | How to verify |
|---|---|---|
| V1 | Pack scan finds packs at `~/.claude/duo/packs/` | `duo packs` returns array with the test pack |
| V2 | Malformed `PACK.json` doesn't crash boot | hand-mangle a manifest; restart; check the pack's `errors` array is populated; other packs still load |
| V3 | `schemaVersion: 999` (future schema) treated as error | similar to V2 |
| V4 | First-launch defaults fire | install pack, restart Duo, verify tabs open |
| V5 | Second launch does NOT re-fire defaults | restart again; defaults stay closed |
| V6 | Pack version bump re-fires defaults | bump version, restart; defaults fire again |
| V7 | Multiple packs each fire their own defaults | install two packs; both default tabs open |
| V8 | `duo packs` in cheat-sheet + skill | `duo --help` shows it; `agents/duo.md` has row |
| V9 | Pack canvas under `~/.claude/duo/packs/<name>/` clicks fire (trust gate) | open default canvas; click a `data-duo-action` button; verify dispatched |
