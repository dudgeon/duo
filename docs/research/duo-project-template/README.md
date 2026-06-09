# Duo project template — feature exploration

> Status: **exploration.** Audience + marking scheme + trigger timing are
> decided (below). One architectural decision — *where* detection runs — is
> deliberately deferred until we have evidence about hook availability on a
> real managed machine. This folder holds the probe that gathers that
> evidence.

## The feature in one paragraph

Define a reusable template for a **duo project**: a folder that declares a
"start here" page. When you enter that folder in Duo, Duo automatically opens
the start-here page in the **browser pane** — a landing / onboarding page for
the human. A manifest file marks the folder as a duo project *and* names the
start-here file explicitly, so detection is a single file read with zero
false positives.

## Decided (from owner, 2026-06-09)

| Question | Decision |
|---|---|
| **Audience** of the auto-opened page | **The user** — it's a landing page (like auto-opening a README), not context for Claude. |
| **Marking scheme** | **Manifest file** — one sentinel (e.g. `.duo-project.json`) that both marks the folder *and* names the start-here file. No HTML globbing, no meta-tag scanning, no guessing. |
| **Trigger timing** | **Once per window, on first entry** to the project — does not reopen on every new terminal tab in the same folder. |
| **Where detection runs** | **DEFERRED** — decide on evidence. See below. |

### Why "manifest names the file" kills the false-positive problem

The owner's two original worries were (a) the trigger doesn't know what to look
for, and (b) it false-positives on an arbitrary HTML file. A manifest solves
both at once:

```jsonc
// .duo-project.json  (at the project root)
{
  "duoProject": 1,            // the marker — presence = "this is a duo project"
  "startHere": "welcome.html" // the exact file to open; no scanning, no globbing
}
```

Detection becomes: `stat .duo-project.json` → parse → open the one named file.
Nothing else in the folder can accidentally match. (We can *optionally* add a
belt-and-suspenders confirming `<meta name="duo-start-here">` tag in the named
file later, but it isn't needed to be safe.)

> Note: this is consistent with Duo's existing project-qualification logic
> (`shared/projects.ts`, keyed on `CLAUDE.md` / `.claude/` / git-root markers).
> `.duo-project.json` is an additional, explicit, opt-in marker layered on top.

## The one open decision: where does detect + auto-open run?

Auto-open is an **action** (`duo open <file>`), and Duo controls *both* the
terminal's working directory *and* the browser pane. So there are hook-free
places to put this that are immune to enterprise policy. The candidates, from
most to least enterprise-proof:

| Option | Hook-dependent? | Fires when | Note |
|---|---|---|---|
| **Duo-native** (Duo's own `PtyManager` detects the CWD it spawns into and opens the file) | **No** | Any Duo terminal entering the project | Most deterministic; touches zero Claude Code machinery |
| **PATH shim** (`~/.claude/duo/bin/claude` wrapper, which already runs on every in-Duo `claude` launch) | **No** | Only when `claude` launches in a Duo terminal | Hook-free, but misses bare shells |
| **Claude Code SessionStart hook** | **Yes** | Session start — *if hooks are permitted* | Lowest-complexity **iff** hooks fire here. The thing the probe tests. |

The owner's preference: **if the SessionStart hook reliably fires on the work
machine, use it** (least new code). If it's silenced by policy, fall back to
the Duo-native trigger. The probe below decides which world we're in.

> Background on why hooks are the only real unknown:
> `skill/references/enterprise-deployments.md` already maps Duo's four
> onboarding mechanisms. The managed CLAUDE.md block, the skill/agent
> registries, and the PATH shim are all hook-free and always work (given a
> writable `~/.claude`). The **SessionStart hook is the single
> policy-fragile mechanism** — so it's the only thing worth empirically
> testing.

## How enterprise machines actually disable hooks

(Confirmed against current Claude Code docs.) Admins set, in the **managed**
settings file — macOS `/Library/Application Support/ClaudeCode/managed-settings.json`,
Linux `/etc/claude-code/managed-settings.json` — one of:

- `"disableAllHooks": true` — every non-managed hook becomes a **silent no-op**.
- `"allowManagedHooksOnly": true` — only admin-managed/SDK hooks run; yours are blocked.
- a `permissions.deny` rule that blocks the Bash command a hook would run.

There is **no error** when this happens — the hook just never fires. That's
why the probe both *reads the policy file* and *empirically watches a real
hook*, and trusts the empirical result if they disagree.

---

## Test plan — run this on the work machine

### Step 1 — get the probe onto the machine

It's a single self-contained bash script (no repo clone, no deps beyond `bash`
+ the `claude` CLI). Either copy `duo-hook-probe.sh` from this folder, or fetch
it directly:

```bash
curl -fsSL \
  https://raw.githubusercontent.com/dudgeon/duo/claude/duo-project-template-feature-b3vlai/docs/research/duo-project-template/duo-hook-probe.sh \
  -o duo-hook-probe.sh
chmod +x duo-hook-probe.sh
```

> The script writes **only** under `~/duo-hook-probe/` (a throwaway folder) and
> only *reads* the managed policy file. It never edits your real `~/.claude`
> config. `./duo-hook-probe.sh clean` removes everything.

### Step 2 — inspect policy + build the test

```bash
./duo-hook-probe.sh setup
```

This prints a read-only **policy inspection** (managed-settings presence,
`disableAllHooks` / `allowManagedHooksOnly`, whether `~/.claude` is writable,
your `claude` version) and creates an isolated test project at
`~/duo-hook-probe/` with a project-scoped `.claude/settings.json` defining
three probe hooks: `SessionStart`, `UserPromptSubmit`, and `PreToolUse(Bash)`.

> Project scope is representative on purpose: `disableAllHooks` /
> `allowManagedHooksOnly` kill non-managed hooks at **every** scope, so if
> project hooks fire, user-level hooks (where Duo installs its real one) would
> fire too — and we never risk your real config.

### Step 3 — exercise the hooks

In a **new** terminal:

```bash
cd ~/duo-hook-probe
claude
```

- If prompted to **trust the folder**, accept.
- If prompted to **review/approve hooks**, approve. *Being unable to approve
  is itself a finding — note it.*
- `SessionStart` fires on launch automatically. To exercise the other two,
  type: `Run this bash command for me: echo probe-ok`
- **Context-injection check:** ask Claude `Did you receive a token starting
  with DUO_HOOK_PROBE? If so, repeat it.` If Claude echoes the sentinel, the
  SessionStart hook can hand Claude *instructions* (relevant if we ever want a
  hook to tell Claude to do something, not just run a command).

### Step 4 — read the verdict

Back in the first terminal:

```bash
./duo-hook-probe.sh check
```

It reports `[FIRED]` / `[silent]` per hook and a plain-English verdict.

### Step 5 — clean up

```bash
./duo-hook-probe.sh clean
```

## Decision tree (what the result means)

- **SessionStart `[FIRED]`** → hooks are available here. We can ship the
  detect+open as a SessionStart hook (lowest complexity), with the Duo-native
  trigger as an optional belt-and-suspenders. Paste the `check` output back
  and we'll proceed to design the manifest + hook.
- **SessionStart `[silent]`** → don't depend on Claude Code hooks. Build the
  **Duo-native** trigger: `PtyManager` already knows the CWD it spawns each
  terminal into (`electron/pty-manager.ts`); it reads `.duo-project.json` and
  drives Duo's existing `open` path directly. Immune to any hook/permission
  policy. The once-per-window dedup lives in in-memory window state (allowed
  per CLAUDE.md rule 12 — a Duo-owned concept, no sidecar).
- **Mixed / approval blocked** → note exactly what happened (trust prompt
  refused? `/hooks` empty?) and paste it back; that nuance changes the
  fallback.

## Not in scope for this probe

- Whether `duo open` itself works under the corporate Bash sandbox — that's a
  separate, already-documented concern
  (`skill/references/sandbox-troubleshooting.md`). The Duo-native trigger
  sidesteps it entirely since the open happens inside the Electron main
  process, not through the agent's Bash tool.
- The actual manifest schema finalization, the template scaffold (`duo project
  init`?), and the once-per-window implementation — those come *after* the
  where-it-runs decision.
