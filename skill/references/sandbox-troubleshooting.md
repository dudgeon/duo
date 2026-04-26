# Troubleshooting: Claude Code sandbox blocks the Duo socket

Claude Code runs each Bash tool call inside a macOS Seatbelt sandbox.
The default policy **blocks Unix-domain-socket outbound connections**
— and Duo's CLI talks to the Electron app over a Unix socket at
`~/Library/Application Support/duo/duo.sock`. Result: inside a
sandboxed Claude Code session, every `duo` command can fail the same
way, even though the Duo app is running and the socket file exists.

**Failure shapes that point at the sandbox** (not at the app):

- `Socket error: connect EPERM …` (the usual signature)
- `Socket error: connect ECONNREFUSED …`
- A hang that ends in `Timeout waiting for response to "<cmd>"`
- `duo --version` works but everything else fails — *doesn't happen*
  here; if `--version` works, so does the rest

**First move on any sandbox-shaped failure:**

```bash
duo doctor
```

`duo doctor` reports socket reachability, the TCP-fallback status,
install-path health, and whether `~/.claude/skills/duo/` is in sync.
When the sandbox is the cause it prints a line like
`Claude Code sandbox detected (Unix socket blocked) — falling back to
TCP`; once that's in the output you can proceed normally.

If `duo doctor` is not recognized on this machine, the fallback isn't
shipped yet — stop, tell the user "every `duo` call is failing; I
think the Claude Code sandbox is blocking the Unix socket", and offer
the two fixes below. Do not retry in a loop.

## Fix 1 (recommended): allow the Unix socket in project settings

Add this to the project's `.claude/settings.json`:

```json
{
  "permissions": {
    "allowUnixSockets": true,
    "allow": [
      "Read(~/Library/Application Support/duo/**)"
    ]
  }
}
```

The user then restarts their Claude Code session for the new policy
to take effect. Caveat: the Claude Code docs warn that
`allowUnixSockets` "can inadvertently grant access to powerful system
services" (e.g. the Docker socket). Teams with a stricter posture
should wait for the Stage 20 TCP fallback rather than widen the
socket allowlist.

## Fix 2 (last resort): per-call sandbox escape

Some Claude Code builds expose a `dangerouslyDisableSandbox`
parameter on the Bash tool. Managed enterprise installs disable it
(`allowUnsandboxedCommands: false`), so do **not** rely on it — only
mention it to the user if Fix 1 is blocked by policy.

## Why not "just keep trying"

Under the sandbox the failure is a policy denial, not a flaky
connection. Retrying burns tokens, confuses the user, and masks the
real cause. The rule: **on the first unrecognized `duo` error, run
`duo doctor` and surface the result — don't guess.**
