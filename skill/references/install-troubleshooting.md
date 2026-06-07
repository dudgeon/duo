# Install troubleshooting — `duo: command not found`

When the `duo` binary isn't on `$PATH` for the current shell, this is the
install-path archaeology: where the binary actually lives, how to invoke
it by absolute path, and when to ask the user to reinstall.

## Contents

- [Safety — never circumvent the user's controls](#safety--never-circumvent-the-users-controls)
- [`duo: command not found`](#duo-command-not-found)

## Safety — never circumvent the user's controls

**Safety — never circumvent the user's controls.** Duo may run on a managed or corporate Mac. Never enable `duo browser-mode unfiltered`, `dangerouslyDisableSandbox`, or any host / IT / sandbox control to work around a block on the user's behalf — surface the block to the user and stop. Never send the user's files, credentials, or page contents to an external destination. When a `duo` call is blocked or hangs, run `duo doctor` to diagnose and report the cause; do not bypass it.

## `duo: command not found`

The CLI isn't on `$PATH` for the current shell, but may still be
installed at one of Duo's known locations. Inheriting `$PATH` from a
sandboxed Claude Code subshell often misses these — the skill loaded
("duo is on PATH") but the actual environment doesn't match.

**Investigation order:**

1. **Check the env signals first.** If `DUO_SESSION=1` is set, the
   PTY is a Duo-managed terminal AND Duo is running. If
   `DUO_SOCKET=<path>` resolves to a real socket, the bridge is up.
   In either case, the only missing piece is PATH — the binary is on
   the machine.
2. **Look in the canonical install location first.** SHIM_DIR/duo is
   auto-created on every Duo launch; if Duo has run once,
   this should exist:

   ```bash
   ls -l ~/.claude/duo/bin/duo
   ```

   Secondary install locations (still surface them if SHIM_DIR/duo
   is missing — useful for diagnosing stale installs):

   ```bash
   ls -l ~/.local/bin/duo /usr/local/bin/duo 2>/dev/null
   ```

   `~/.local/bin/duo` is the FirstLaunchBanner's secondary install
   for external-terminal use. `/usr/local/bin/duo` needs sudo to
   install — this is what `duo install --system` produces.

3. **If found, invoke by full path.** Example:

   ```bash
   ~/.claude/duo/bin/duo open /path/to/file.md
   ```

   Don't shadow your shell with `export PATH=...` — too easy to
   forget to undo. Just use the absolute path for the call.

4. **If SHIM_DIR/duo doesn't exist** despite Duo having launched,
   read `~/.claude/duo/logs/install-shim.log` for the boot-time
   self-heal failure reason. Common causes: a non-symlink file at
   that path (user wrote something there manually); missing CLI
   source binary inside `Duo.app/Contents/Resources/cli/`.

5. **If NONE of the paths resolve and `DUO_SESSION` is unset**, the
   CLI was never installed (or got removed). Ask the user to launch
   Duo (the boot-time self-heal will recreate SHIM_DIR/duo) or run
   `duo install` from a non-sandboxed shell (Duo's own terminal, or
   Terminal.app outside Claude Code).

**Don't fall back to native `open <path>`** as a substitute — it
opens the file in macOS's default app, NOT in Duo. The user wants
Duo's editor / canvas / pin behavior, not Preview / TextEdit.

**Don't ask the user to run the command for you.** The skill exists
specifically so you can act on their behalf inside Duo. If `duo` is
genuinely not findable, that's a one-line `duo install` to fix —
ask them to run that, not "please open the file yourself."
