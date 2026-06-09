# Duo

A macOS workspace where a person and an agent pair on the same surfaces —
a terminal, an embedded browser, a file tree, and a markdown editor — all
exposed through a `duo` CLI so the agent can act on what you see, not just
watch it.

Today the supported agent is
[Claude Code](https://www.anthropic.com/claude-code). The architecture is
BYO-harness.

![status: flagship reading/writing pair in progress](https://img.shields.io/badge/status-flagship_in_progress-brightgreen)

> **Why a CLI?** If an agent can only watch but not act, you haven't built
> a pair — you've built a spectator. Every UI toggle, menu, and keystroke in
> Duo also has a `duo <verb>` counterpart. The product north star — persona,
> principles, and the flagship Google Docs bet — lives in
> [docs/VISION.md](docs/VISION.md).

For the longer narrative — the workflow problem that motivated this and a tour
of the four main features — see **[docs/about-duo.md](docs/about-duo.md)**.

---

## Who this is for

Primarily, **product managers and other non-engineering knowledge workers**
who want to work with an agent the way they already work in Google Docs or
Notion — beautifully, safely, and without learning the terminal or the
file system first. Duo smooths the rough edges of running an agent like
Claude Code so the people least equipped to adopt it are actually able to.

Duo is **not an agent.** It is a workspace for someone else's agent. The
terminal is still there — the agent lives in it — but everything around the
terminal is designed for someone who does not.

---

## What it is

A signed macOS app that bundles:

- **Three-column workspace** — files, terminal, and a polymorphic right
  pane that holds browser tabs, the markdown editor, an HTML canvas, and
  file previews under one tab strip. Each side collapsible; the right pane
  can split into two files side-by-side.
- **Multiple windows** — open a second window with **File → New Window**
  (⌥⌘N) or `duo window new`. Each window is its own workspace — browser,
  navigator, terminals, and geometry — restored across relaunches. Every
  terminal carries a `DUO_WINDOW` stamp, so `duo --window N <verb>` drives a
  specific window (`duo windows` lists them). Gated by an "Allow Multiple
  Windows" setting (on by default).
- **Real Chromium browser pane** with persistent Google SSO — sign in once,
  stay signed in across relaunches. Authenticated Google Docs read/edit is
  the flagship success test for the foundation layer.
- **Rich markdown editor** with Google-Docs-like typography, GFM + tables +
  syntax-highlighted code, autosave, find-in-document, and the standard
  Obsidian-style autocomplete (`[[`, `@`, ⌘O).
- **HTML canvas** for editing rendered HTML in-place; comment-rail
  annotations; per-file edit-mode toggle.
- **Lesson packs** — single-canvas FTUX tutorials and multi-canvas
  curricula that ship with the app.
- **A `duo` CLI** on your `PATH`. Any terminal process — including a Claude
  Code session running inside a Duo terminal tab — can call it. The agent
  sees what you see and does what you can do.
- **Drag a file into the terminal** — drop a navigator file or folder (or a
  multi-selection) onto the terminal to insert its absolute path at the
  cursor, POSIX-quoted as needed and with no trailing newline, so it never
  auto-runs. Works in a shell or a running Claude prompt.
- **Bundled Claude Code skill + subagent** so a fresh Claude session
  launched inside a Duo terminal auto-discovers them and can drive the
  browser + editor without priming.

Duo is also a personal daily driver for the maintainer: shippable quality
for a broader cohort, prototype speed in the MVP.

For the full capability inventory (every shipped feature with the CLI verb
that drives it), see
[packs/duo-default/canvases/what-duo-does.html](packs/duo-default/canvases/what-duo-does.html).

---

## Quick start

### Prerequisites

| Requirement | Check |
|---|---|
| macOS 13+ on Apple Silicon | `sw_vers` |
| Claude Code installed | `claude --version` ([install](https://docs.claude.com/claude-code)) |

Duo ships **arm64-only** as of v0.6.7. Intel users on macOS 13+ should stay
on the older v0.6.6 release.

### 1. Install Duo

Grab the latest signed + notarized DMG from
[**GitHub Releases**](https://github.com/dudgeon/duo/releases/latest), open
it, and drag `Duo.app` into `/Applications`. First launch is a clean
double-click — no Gatekeeper warning.

### 2. Click "Install" on the welcome banner

When Duo first launches, a banner appears at the top of the window:

> **Welcome to Duo.** Install the skill + subagent + help files into
> `~/.claude/` and the `duo` CLI to `~/.local/bin`. **[Install]**

Click **Install**. This is the rest of the setup. If `~/.local/bin` isn't
on your `$PATH` yet, the banner stays visible with a one-liner to add to
your shell rc:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Verify in any terminal:

```bash
duo help
```

### 3. Try it

From a Duo terminal tab, run `claude` and ask:

> summarize the page open in my browser

The Claude Code session inside Duo finds the bundled `duo` skill and drives
the browser for you. From there:

- Open a Google Doc; ask Claude to read or rewrite a section.
- Open a markdown file in the editor; select a paragraph; ask Claude to
  shorten it.
- Generate an HTML artifact (chart, dashboard, prototype); `duo open
  <file>.html` shows it live.

Help is inside Duo too — the **What Duo Does** canvas (opens automatically
on first launch, also via the "What Duo Does" tab in the right pane) lists
every shipped capability with the CLI verb that drives it.

---

## Getting help · reporting bugs

- **In-app capability reference** — open the **What Duo Does** tab in
  Duo's right pane (auto-pinned on install). Source at
  [packs/duo-default/canvases/what-duo-does.html](packs/duo-default/canvases/what-duo-does.html).
- **Bug reports + feature requests** — open an issue at
  [github.com/dudgeon/duo/issues](https://github.com/dudgeon/duo/issues).
- **What's new in each release** — inventory in
  [CHANGELOG.md](CHANGELOG.md), prose log in
  [docs/RELEASES.md](docs/RELEASES.md). The What Duo Does canvas's pack
  version bumps on each cut, re-firing the in-app "new capabilities"
  surface for existing users.

---

## Building Duo · contributing · forking

For build-from-source instructions, the architecture rundown, the repo
layout, and the full developer setup (custom npm registries, signed-DMG
builds, cert pre-work, the iCloud File Provider gotcha), see
**[docs/dev/CONTRIBUTING.md](docs/dev/CONTRIBUTING.md)**.

For an enterprise team or open-source community wanting their own
Duo-based distro, see **[docs/HOW-TO-FORK.md](docs/HOW-TO-FORK.md)** —
five layered fork modes covering everything from "use as-is" to
"build-time full fork."

---

## Status

The canonical roadmap is **[docs/roadmap.html](docs/roadmap.html)** —
status, build order, per-stage cards, owner-side comments. Versioned
releases land in **[CHANGELOG.md](CHANGELOG.md)** with prose context in
**[docs/RELEASES.md](docs/RELEASES.md)**.

---

## License

MIT — see [LICENSE](LICENSE).
