# How to fork Duo

This doc lives at the intersection of "Duo is one person's side project today"
and "Duo could be the substrate for a Capital One Trailblazers distro tomorrow."
It exists to give would-be forkers — internal enterprise teams, individuals,
other organizations — a clear-eyed picture of *what's possible today*, *what's
coming*, and *how the layers compose*.

> **For context** see also [the roadmap](roadmap.html) for the canonical
> stage-by-stage tracking, [`docs/roadmap.html`](roadmap.html) for the
> read-friendly version, and [Stage 21e](roadmap.html#s21) for the work
> that lights up the fork-friendly architecture below.

---

## Two ways to get Duo running today

Both are first-class. The first is what you'll do as a downstream user; the
second is what you'll do if you want to modify or distribute Duo.

### A. Download the prebaked DMG (most users)

```
https://github.com/dudgeon/duo/releases/latest
```

- Download the `Duo-X.Y.Z-arm64.dmg` (Apple Silicon) or `Duo-X.Y.Z.dmg` (Intel).
- Mount, drag `Duo.app` to `/Applications`, double-click.
- v0.4.1 onwards is Apple-signed and notarized — Gatekeeper accepts cleanly,
  no right-click → Open dance.
- First launch shows a welcome banner that copies the bundled skill / agent
  / help files into `~/.claude/` and the `duo` CLI to `~/.claude/bin/`.

**What's in:** the canonical Duo experience as Geoff ships it. App icon,
bundled skill (`skill/SKILL.md`, agent, help files: faq.html,
what-duo-does.html, canvas-actions-demo.html), `*.capitalone.com` seeded into
the external-domains bootstrap (Cap One context — see § "What's hard-coded
today" below), `dudgeon/duo` as the auto-update upstream.

**What's out:** anything organization-specific that isn't in upstream. No way
to drop in your own pre-baked skills via this path; you'd add them to your
`~/.claude/` after install (which works, but isn't a first-launch experience).

### B. Self-compile from source

```bash
git clone https://github.com/dudgeon/duo.git
cd duo
npm install
npm run dev          # for dev iteration (HMR, no DMG)
npm run dist         # for an unsigned packaged DMG
bash scripts/dist-signed.sh   # for a signed + notarized DMG (requires cert pre-work)
```

- See `docs/dev/cert-procurement.md` for what the signed cut needs (Apple
  Developer Program membership, Developer ID Application cert, App Store
  Connect API key, Team ID).

**What's in:** full editorial control. Modify any file, reload, see the
result. Ship a DMG to a friend if you want.

**What's out:** if you change the `appId` (`com.geoffdudgeon.duo`) or the
update endpoint (`dudgeon/duo`) or the `*.capitalone.com` default, you have
to grep for those strings in **multiple files** and patch each — and every
upstream merge re-introduces them. There's no single config knob today. See
§ "What's hard-coded today" for the inventory.

---

## What's hard-coded today (the audit)

The following values are wired into Duo's source today. A forker has to patch
each one by hand:

| File | Value | What it controls |
|---|---|---|
| `electron-builder.yml` | `appId: com.geoffdudgeon.duo` | macOS bundle identifier; required to be unique per cert |
| `electron-builder.yml` | `publish: { provider: github, owner: dudgeon, repo: duo }` | Where electron-updater fetches updates from |
| `package.json` | `repository.url: https://github.com/dudgeon/duo.git` | Auto-detected by electron-builder if `publish:` is absent |
| `electron/update-checker.ts` | `RELEASES_LATEST_URL = 'https://api.github.com/repos/dudgeon/duo/releases/latest'` | The "v0.5.0 available" banner's source |
| `electron/install-service.ts` | `*.capitalone.com` seeded into `~/.claude/duo/external-domains.json` | Default off-host redirect list |
| `package.json` `sync:claude` | Same `*.capitalone.com` default in the dev-only sync script | Dev-side parity for the install-service default |
| `README.md` | `Duo-0.4.1-arm64.dmg` direct-download URLs | First-impression discoverability |

That's seven files for what should be one config flip. § Stage 21e fixes
this.

---

## The five layered fork modes (today + aspirational)

Duo's fork story is a layered cake: each layer composes with the ones above
it. Most users only ever use Layer 0 — that's fine. Layer 1 has been
implicitly available since v0.2.0. Layers 2–4 are the "coming soon" surface.

### Layer 0 — Use as-is (default)

```
Download the DMG. Run it. Done.
```

What you get is whatever upstream Duo ships. New versions arrive via
auto-update. Customizations live in your own copy of `~/.claude/duo/`
(see Layer 1).

**Available today.** No fork involved.

---

### Layer 1 — Per-user customization (your `~/.claude/duo/`)

```
~/.claude/
├── CLAUDE.md                      # your global Claude Code instructions
├── skills/                         # any skill — Claude Code reads from here
├── agents/                         # any subagent
└── duo/
    ├── external-domains.json      # which hosts route to system browser
    ├── pins.json                  # which tabs are pinned at first launch
    ├── priming.md                 # the prompt Duo prepends to claude sessions
    ├── help/                       # FAQ + What-Duo-Does (user-editable)
    └── installed.json             # provenance file (managed by Duo)
```

You can edit any of these. Add your own skills under `~/.claude/skills/`; add
your own agents under `~/.claude/agents/`. Duo reads them on next launch.

**Available today.** ✅ Works for `external-domains.json`, `pins.json`,
`priming.md`, user-added `~/.claude/skills/` files, user-added
`~/.claude/agents/` files.

**⚠️ Caveat (today):** edits to *Duo-installed* files inside
`~/.claude/duo/help/` and `~/.claude/skills/duo/` are silently overwritten on
the next Duo upgrade (the install service's "version-bump → reinstall" path
clobbers user changes; provenance tracking exists but doesn't gate on
content match). Stage 21e-iii closes this.

---

### Layer 2 — Drop-in org pack (runtime, no rebuild)

```
~/.claude/duo/extra-packs/
└── my-org-pack/
    ├── PACK.json                   # name, version, description, optional pins[]
    ├── skills/
    │   └── my-org-skill.md        # extra skills installed alongside Duo's
    ├── agents/
    │   └── my-org-agent.md         # extra agents
    └── help/
        ├── onboarding.html         # extra help files
        └── architecture-guide.html
```

A user (or an organization's IT) drops a pack folder into
`~/.claude/duo/extra-packs/`. On next launch, Duo discovers the pack via
`PACK.json`, copies its files into the relevant `~/.claude/` subdirs,
records each file in the provenance manifest, and (optionally) pins entries
listed in `PACK.json § pins[]`.

**Coming soon.** Stage 18b drafts the data plane; Stage 21e wires the
runtime discovery + provenance. Closes the "I want my org's onboarding
materials baked into every team-member's Duo without forcing them to
clone-and-rebuild" use case.

---

### Layer 3 — Build-time partial fork (your DMG, our upstream)

```
git clone https://github.com/dudgeon/duo.git
cd duo
mkdir extra-skills/
# drop your org's pack here — convention identical to Layer 2's PACK.json
bash scripts/dist-signed.sh
# → produces dist/Duo-X.Y.Z-arm64.dmg with your pack baked into the bundle
```

You ship a DMG with your starter skill pack pre-loaded. Users who install
your DMG see your pack on first launch; their `~/.claude/duo/extra-packs/`
gets your pack's files. They still receive binary updates from
`dudgeon/duo` (auto-update is on), and your pack's contents persist across
those updates (provenance manifest tracks them).

**Coming soon.** Stage 18b ships the `extra-skills/` convention folder +
the build-time bake-in step. Stage 21e-iii adds the provenance protection
so upstream binary updates don't clobber your pack's files.

The Cap One AIP starter pack is the motivating example — Trailblazers'
PMs install AIP's branded Duo DMG, which is upstream Duo plus AIP's
`extra-skills/cap-one-aip/PACK.json`. AIP doesn't run their own update
server.

---

### Layer 4 — Build-time full fork (your DMG, your upstream)

```
git clone https://github.com/dudgeon/duo.git my-org-duo
cd my-org-duo
# Edit ONE file:
cat > fork.config.json <<EOF
{
  "appId": "com.my-org.duo",
  "productName": "Duo (My Org Edition)",
  "publish": {
    "provider": "github",
    "owner": "my-org",
    "repo": "duo-internal"
  },
  "bootstrap": {
    "externalDomains": ["*.my-org.com"],
    "helpPinnedFiles": ["faq.html", "onboarding.html"]
  }
}
EOF
# (optional) drop your extra-skills/ pack in
bash scripts/dist-signed.sh   # uses your cert
```

You become the upstream. Your DMG identifies as `com.my-org.duo`, your
auto-update channel is `my-org/duo-internal`, your bootstrap defaults
include your domains. Future merges from upstream `dudgeon/duo` flow
in cleanly — your config stays yours because it's in one file the upstream
doesn't touch.

**Coming soon.** Stage 21e-i + 21e-ii ship the build-time + runtime config
indirection. Until then, full fork is technically achievable but ergonomic-
ally hostile (seven files to patch; every upstream merge re-introduces
them).

---

### Layer 5 — Build-time full fork + runtime user packs (composes 2 + 4)

The same way Layer 2 composes with Layer 0 (drop-in packs on top of vanilla
Duo), Layer 2 composes with Layer 4 (drop-in packs on top of My Org Duo).
End users of My Org Duo can still drop their own per-team or per-individual
packs into `~/.claude/duo/extra-packs/`, and those persist across My Org's
binary updates the same way they persist across upstream Duo's binary
updates.

**Coming soon — same Stage 21e dependencies as Layer 2 + Layer 4.**

---

## When to use which layer

| Use case | Layer |
|---|---|
| I just want to try Duo | 0 |
| I want to add my favorite skill, edit my priming, customize my pinned tabs | 1 |
| I'm a team lead and want my team's onboarding skills available without making everyone rebuild | 2 (when 18b ships) |
| I'm an internal AIP-style team distributing a curated DMG with our skill pack | 3 (when 18b ships) |
| I'm an enterprise team that wants Duo internal-only with my company's identity, my own update channel, my own internal release schedule | 4 (when 21e ships) |
| I'm an enterprise team that ships my own DMG AND want my users to have per-individual customization | 5 (when 21e + 18b ship) |

---

## What Stage 21e changes (mechanical inventory)

For the curious: when 21e lands, here's the diff from today's hard-coded
state.

### 21e-i — Build-time fork config

New file at repo root: `fork.config.json` (gitignored at the user-edit
layer; a `fork.config.default.json` ships with upstream's values).

Files that read from it (changed to read instead of hard-code):
- `electron-builder.yml` — uses `${env.DUO_APP_ID}` / `${env.DUO_PUBLISH_OWNER}`
  / `${env.DUO_PUBLISH_REPO}` substitution; a `prebuild` script exports
  the env vars from `fork.config.json` before `electron-builder` runs.
- `package.json` — same `prebuild` script syncs `repository.url` to match.

### 21e-ii — Runtime upstream-update endpoint

Vite injects values at compile time, no runtime config file needed.
- `electron/update-checker.ts` — `RELEASES_LATEST_URL` becomes computed
  from injected `__DUO_PUBLISH_OWNER__` + `__DUO_PUBLISH_REPO__`.
- `electron/auto-updater.ts` — already auto-detects from `package.json`
  `repository` field; works correctly once 21e-i syncs that field from
  `fork.config.json`.
- `electron/install-service.ts` — bootstrap defaults
  (`externalDomains`, `helpPinnedFiles`) read from injected values
  rather than hard-coded `*.capitalone.com`.

### 21e-iii — Provenance-aware install

Extends the existing `~/.claude/duo/installed.json` to track per-file
SHA-256 alongside the version stamp.

Behavior change in `electron/install-service.ts`:
- On install: record SHA-256 of every Duo-shipped file at write time.
- On version-bump install: for each Duo-owned file, recompute SHA at
  install time. If disk-SHA matches recorded-SHA → user didn't modify;
  safe to overwrite. If disk-SHA differs → user modified; surface a
  banner asking "Update `faq.html`? (your edits will be lost)" with
  *Use mine* / *Use new* / *Show diff* / *Defer*.

User-installed files (anything not in the manifest) are never touched
on install — already true today; 21e-iii makes it explicit and
documented.

### 21e-iv — Documentation

This file (`docs/HOW-TO-FORK.md`) lands now with "coming soon" markers
on Layers 2–5. When 21e-i/ii/iii ship, the markers come off and a
"Verified working" snapshot date goes on.

`README.md` gets a new section pointing here. the roadmap
references this doc from Stage 21e's card.

`docs/dev/cert-procurement.md` already covers cert work for full-fork
operators (the cert + bundle ID + signing flow is identical regardless
of which fork mode you're in).

---

## Why Stage 21e isn't ✅ today

The gap between "Duo runs on Geoff's laptop" and "Duo is the substrate for
the Cap One Trailblazers distro" is more than just a config knob — it's a
trust contract. **A forker has to be able to merge upstream without losing
their identity, AND a forker's users have to be able to customize their
install without losing those customizations on upstream binary updates.**
That's the design constraint that drives the layered architecture above:
config in one place (Layer 4), provenance tracking that respects user
intent (cross-cutting via 21e-iii), drop-in convention for per-user packs
(Layer 2 — composes orthogonally to either upstream or fork upstream).

The work is mostly mechanical at this point — the harder design work is
the layering above. 21e implements; the layers were the question.

---

## Cross-references

- [the roadmap](roadmap.html) — canonical stage tracking
- [`docs/roadmap.html#s21`](roadmap.html#s21) — Stage 21 stage card with 21e
  sub-stages
- [`docs/dev/cert-procurement.md`](dev/cert-procurement.md) — Apple
  Developer ID cert procurement (required for any signed-cut fork mode)
- [`docs/DECISIONS.md`](DECISIONS.md) — locked architectural decisions
- [`README.md`](../README.md) — user-facing install + build instructions
