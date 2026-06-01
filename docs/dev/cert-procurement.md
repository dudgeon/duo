# Apple Developer ID — cert procurement

Owner pre-work for **Stage 21** (signed + notarized DMG distribution).
None of this needs a coding agent — it's portal clicks and identity
verification. Multi-day lead time, so kick off in parallel with other
work. Stage 21 picks up once all five artifacts below are collected.

> **No secrets in this file.** This doc records *what* you collected
> and *where it lives* (Keychain / 1Password / `~/.appstoreconnect/`) —
> never the values themselves. Real values go in `.env` (gitignored),
> Keychain, or 1Password.

---

## Status

| Step | Artifact | Status | Storage location |
|---|---|---|---|
| 1 | Apple Developer Program membership | ✅ done (2026-04-25, individual, `dudgeon@gmail.com`) | Apple ID account |
| 2 | Registered bundle ID `com.geoffdudgeon.duo` | ✅ done (2026-04-25) | Apple Developer portal |
| 3 | Developer ID Application certificate | ✅ done (2026-04-25, paired w/ private key, `security find-identity -p codesigning -v` returns one valid identity) | macOS login keychain |
| 4 | App Store Connect API key (.p8) | ✅ done (2026-04-25, perms 600) | `~/Documents/duo-private/AuthKey_<KeyID>.p8` (Geoff's private staging dir) |
| 5 | Team ID captured | ✅ done (2026-04-25, captured from dev portal header) | 1Password + this doc's handoff packet |

Update the status column as you complete each step.

---

## Pre-reqs

- **Apple ID** with two-factor auth turned on. The "Sign in with Apple" account you'll
  enroll under. (If you have multiple, pick the one that will be the long-term
  owner of this developer identity.)
- **Mac with Xcode Command Line Tools.** `xcode-select -p` should print a path.
  If not: `xcode-select --install`. Needed for `notarytool`.
- **Keychain Access** app (built in to macOS).
- **A password manager** (1Password) — for backing up the .p8 key, which Apple
  won't let you re-download.

---

## Step 1 — Enroll in the Apple Developer Program

**Lead time:** 1–2 business days for individual verification; can be longer for
organizations. **Start matters more than completion** — kick this off first.

**Cost:** $99/year (individual) or $299/year (organization).

**Link:** <https://developer.apple.com/programs/enroll/>

### Decision: individual vs. organization

- **Individual** — enrollment is in your name. Cert reads
  `Developer ID Application: <Your Legal Name> (TEAMID)`. Simpler and faster.
  Best when this is a personal project / side-tool.
- **Organization** — requires a D-U-N-S number for your business entity, and
  Apple verifies the business exists and you're authorized to represent it.
  Cert reads `Developer ID Application: <Org Name> (TEAMID)`. Slower, but
  required if you want the company name on the cert (which is what users see in
  Gatekeeper warnings).

> ⚠️ Acme context — if there's any chance Duo eventually ships to Acme
> internal users under the company name, this should probably be an
> *organization* enrollment under an Acme-controlled Apple ID. That's a
> separate workstream from a personal Developer ID. **Confirm with Geoff which
> path Stage 21 is targeting before completing enrollment.**

### What to do

1. Sign in to <https://developer.apple.com/programs/enroll/> with your Apple ID.
2. Verify your phone and identity (Apple sometimes asks for a government ID
   photo for individual enrollment).
3. Pay the membership fee.
4. Wait for the activation email. **You can't generate certs until membership
   is active.**

### What to capture
- ☑ Apple ID used for enrollment → `dudgeon@gmail.com`
- ☑ Membership type chosen → individual
- ☑ Email confirmation that membership is active (2026-04-25)

---

## Step 2 — Register the bundle ID

**Where:** developer.apple.com → **Certificates, Identifiers & Profiles** →
**Identifiers** → **+** → **App IDs** → **App**.

> Note: bundle IDs are registered in **Certificates, Identifiers & Profiles**,
> not in App Store Connect. App Store Connect is only needed if you're shipping
> to the Mac App Store. Duo distributes outside MAS (notarized DMG), so this
> step lives in the developer portal. The original task brief says "App Store
> Connect" — that's a minor mis-label.

**Link:** <https://developer.apple.com/account/resources/identifiers/list>

### What to do

1. Go to Identifiers → click **+**.
2. Select **App IDs** → Continue.
3. Select **App** → Continue.
4. **Description:** `Duo` (free-text, shows up in dev portal lists).
5. **Bundle ID:** select **Explicit** and enter `com.geoffdudgeon.duo`.
   Must match `appId` in `electron-builder.yml` exactly.
6. **Capabilities:** none required for Duo. Leave defaults.
7. Continue → Register.

### What to capture
- ☑ Confirmation that `com.geoffdudgeon.duo` shows up in the Identifiers list (2026-04-25)

---

## Step 3 — Generate the Developer ID Application certificate

This is the cert that signs the .app bundle inside the DMG. Without it,
macOS Gatekeeper blocks Duo on first launch on any non-developer machine.

**Two-part process:** generate a CSR locally → upload CSR to Apple → download
the .cer → double-click to import the cert (which now contains the public key,
matched to your locally-stored private key).

### 3a. Generate a Certificate Signing Request locally

1. Open **Keychain Access** (`/System/Applications/Utilities/Keychain Access.app`).
2. Menu bar → **Keychain Access** → **Certificate Assistant** → **Request a
   Certificate from a Certificate Authority…**
3. Fill in:
   - **User Email Address:** the Apple ID email you enrolled with
   - **Common Name:** your legal name (or org name) — this will appear in the
     cert and in macOS Gatekeeper UI
   - **CA Email Address:** leave blank
   - **Request is:** select **Saved to disk**
4. Continue → save `CertificateSigningRequest.certSigningRequest` somewhere
   temporary (Desktop or `~/Downloads`). **Not in this repo.**

> 🔑 The matching private key is now in your **login keychain** under the name
> you set as Common Name. The cert you'll download in step 3c is useless
> without this private key — it lives only on this Mac.

### 3b. Upload the CSR to Apple

**Link:** <https://developer.apple.com/account/resources/certificates/list>

1. Click **+**.
2. Software section → select **Developer ID Application** → Continue.
3. **Profile Type:** "G2 Sub-CA (Xcode 11.4.1 or later)" is the modern default.
4. Upload the .certSigningRequest file from step 3a.
5. Continue → Download. Apple gives you a `.cer` file (e.g.
   `developerID_application.cer`).

### 3c. Import the cert into Keychain

1. Double-click the downloaded `.cer` file. It imports into your login keychain.
2. In Keychain Access, switch to the **login** keychain → **My Certificates**
   category. You should see an entry like:

       Developer ID Application: <Your Name> (TEAMID)

3. Expand it (▶) — confirm a private key is nested underneath. If not, the
   import lost its match to the private key from step 3a; regenerate the CSR
   and try again.

### What to capture
- ☑ Cert common name as it appears in Keychain → `CSC_NAME` value captured (in 1Password / `.env`)
- ☑ Cert + private key pairing verified via `security find-identity -p codesigning -v`
- ☐ *Optional:* delete `developerID_application.cer` and
  `CertificateSigningRequest.certSigningRequest` from `~/Documents/duo-private/`
  (not secrets, but tidy)
- ☐ *Optional but strongly recommended:* export cert + private key as a
  password-protected `.p12` and store in 1Password. Lets you restore signing
  capability if this Mac dies. (Keychain Access → My Certificates → right-click
  the cert → Export → format `.p12` → set a password → save outside the repo.)

---

## Step 4 — Generate the App Store Connect API key

This is the modern, preferred auth for `notarytool` (replaces the old
"app-specific password" approach). One key signs notarization requests for
all your apps.

**Link:** <https://appstoreconnect.apple.com/access/integrations/api>

> Going to App Store Connect (not the dev portal) is correct here — even
> though Duo doesn't ship to MAS, the API key infrastructure lives in ASC.

### What to do

1. Sign in to App Store Connect with the same Apple ID.
2. Go to **Users and Access** → **Integrations** tab → **App Store Connect API**.
3. Click **+** to generate a new key.
4. **Name:** `Duo notarization` (whatever — just so you can recognize it).
5. **Access:** **Developer** is enough for notarization. Don't grant Admin
   unless you have a reason.
6. Click **Generate**.
7. **Download the .p8 file immediately.** Apple **only lets you download it
   once.** If you lose it, you have to revoke and regenerate.

### Where to put the .p8 file

`notarytool` (and electron-builder) auto-detects keys placed at:

    ~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8

That's the canonical location. Create the directory if it doesn't exist:

    mkdir -p ~/.appstoreconnect/private_keys
    chmod 700 ~/.appstoreconnect
    mv ~/Downloads/AuthKey_*.p8 ~/.appstoreconnect/private_keys/
    chmod 600 ~/.appstoreconnect/private_keys/AuthKey_*.p8

### Back it up to 1Password

Apple won't re-issue the .p8. Store a copy as a 1Password "Document" attachment
on a "Duo notarization API key" item. Note the Key ID and Issuer ID on the
same item.

### What to capture
- ☑ **Key ID** captured (10-char value in 1Password / `.env` — not committed)
- ☑ **Issuer ID** captured (UUID in 1Password / `.env` — not committed)
- ☑ **Path to .p8** = `~/Documents/duo-private/AuthKey_<KeyID>.p8` (perms 600)
- ☐ Confirmed .p8 backed up in 1Password (recommended — Apple won't re-issue)

> **Note on .p8 location.** notarytool's auto-detect path is
> `~/.appstoreconnect/private_keys/`, but giving an explicit path via the
> `APPLE_API_KEY` env var works equally well. Geoff is using
> `~/Documents/duo-private/` to keep all Duo cert artifacts together.

---

## Step 5 — Capture the Team ID

The Team ID is a 10-character identifier Apple uses to scope your developer
identity. It appears inside the cert common name (`Developer ID Application:
Geoff Dudgeon (TEAMID)`) and is also wired into `electron-builder.yml` for
notarization (`notarize.teamId`).

**Link:** <https://developer.apple.com/account>

### What to do

1. Sign in to <https://developer.apple.com/account>.
2. Go to **Membership details** (sidebar).
3. The Team ID is in the right-hand column. 10 characters, alphanumeric.

### What to capture
- ☑ **Team ID** captured (2026-04-25). Stored in 1Password. Will become `APPLE_TEAM_ID`
  in `.env` at Stage 21.

> 📝 Account holder name on Apple's records: `Geoffrey Dudgeon` (full first name).
> The issued Developer ID Application cert will therefore read
> `Developer ID Application: Geoffrey Dudgeon (<TeamID>)` — this is what becomes
> `CSC_NAME` in `.env`.

---

## Stage 21 handoff packet

When all five steps are complete, the handoff to a coding agent is exactly
this set of values. Put them in `.env` (gitignored) — don't paste them into
chat or commit them anywhere.

```dotenv
# Copy `.env.example` → `.env` and fill these in:
CSC_NAME="Developer ID Application: Geoffrey Dudgeon (<teamid>)"
APPLE_API_KEY=/Users/geoffreydudgeon/Documents/duo-private/AuthKey_<keyid>.p8
APPLE_API_KEY_ID=<10-char Key ID>
APPLE_API_ISSUER=<Issuer UUID>
APPLE_TEAM_ID=<10-char Team ID>
```

The yml stays env-agnostic — `mac.identity` and `mac.notarize` remain
commented and `dmg.sign: false` stays as-is. electron-builder
auto-discovers the cert from `CSC_NAME` and the notarization flow from
the `APPLE_*` env vars without any yml flips. Keeping it env-agnostic
means today's unsigned `CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist`
flow keeps working unchanged.

Build the signed cut:

    bash scripts/dist-signed.sh

The script handles env loading, the `CSC_NAME` prefix-strip gotcha, the
iCloud File Provider workaround (see appendix), the
sign + notarize + staple, and the validation pass. End-to-end ~5–8 min
on M1.

---

## Appendix — macOS Sequoia compatibility notes

Hard-won from the Stage 21 cut on 2026-04-27. Future operators: read
this BEFORE re-discovering anything below.

### `com.apple.provenance` is a red herring

Sequoia 15.x adds `com.apple.provenance` to nearly every file as a
system-protected extended attribute. It's harmless on its own —
files in `/tmp/` carry it and codesign accepts them anyway. **The
v0.4.0-cut session wasted hours blaming it.** Don't.

### `~/Documents/` blocks codesign — the actual problem

If the repo lives under `~/Documents/`, macOS's iCloud Desktop &
Documents sync (or any iCloud File Provider integration) tags
directories inside Electron's helper bundles
(`Duo Helper (GPU).app`, etc.) with these xattrs within
milliseconds:

- `com.apple.FinderInfo`
- `com.apple.fileprovider.fpfs#P`
- `com.apple.fileprovider.dir#N`

`codesign` then rejects helpers with:

    resource fork, Finder information, or similar detritus not allowed

`xattr -cr` and `ditto --noextattr` strip the attrs successfully but
iCloud re-applies them faster than the next codesign call can read
the file.

**Fix.** Build outside `~/Documents/` entirely.
`scripts/dist-signed.sh` already does this — sets
`-c.directories.output=$HOME/.cache/duo-build` on the
electron-builder invocation and copies the resulting DMGs back to
`dist/` for the user. Empirical proof: the same fresh helper binary
fails to codesign in `~/Documents/GitHub/duo/dist/` but succeeds
when copied to `/tmp/`.

### FOLLOWUP-005 keychain prompt

First codesign call after a system reboot prompts:

    codesign wants to access key in keychain
    [Always Allow] [Deny]

If Terminal isn't focused, the dialog sits behind the build process
and the build hangs forever. Click **Always Allow**. Persists
across builds in the same session. Recurs on next reboot. There's
no programmatic way to pre-authorize without dropping the cert into
a non-default keychain (which has its own rabbit holes).

### Cert renewal

Developer ID Application certs are valid for ~5 years. When this
one expires:

1. Apple Developer portal → Certificates → Generate a new one
   (re-use the existing CSR or generate a new one).
2. Download `.cer`, double-click to import into login keychain.
3. `security find-identity -v -p codesigning` should show the new
   identity alongside (or replacing) the old.
4. If the cert common name changed (it shouldn't — Apple keeps the
   same CN if account-holder name is unchanged), update `CSC_NAME`
   in `.env`.
5. Test with `bash scripts/dist-signed.sh` end-to-end.

The `.p8` API key for notarization is separate and doesn't expire
the same way — but Apple Developer accounts can have their API
keys revoked through the portal. Keep the `.p8` backed up in 1Password.

---

## References

- Electron-builder code signing: <https://www.electron.build/code-signing>
- Apple — Notarizing macOS software before distribution: <https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution>
- Apple — Creating App Store Connect API keys: <https://developer.apple.com/help/app-store-connect/manage-your-team/create-app-store-connect-api-keys-for-your-team>
- the roadmap § Owner pre-work — cross-references this doc.
