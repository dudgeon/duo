#!/bin/bash
# STUB — install.sh overwrites this with the user's local node path.
#
# Why this exists: Chrome's hardened-runtime sandbox refuses to honor
# `#!/usr/bin/env node` shebangs when spawning Native Messaging hosts
# on macOS. The committed launcher would fail unless run on a machine
# whose nvm/brew node path happened to match. install.sh resolves the
# user's `command -v node` at install time and writes a launcher with
# that absolute path, so the wrapper works on any machine.
#
# Run `./install.sh <extension-id>` first; this stub will be replaced.

echo "duo-helper-launcher.sh: not yet configured. Run ./install.sh <extension-id> first." >&2
exit 1
