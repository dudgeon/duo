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
| 3 | Developer ID Application certificate | ☐ pending | macOS Keychain (login) |
| 4 | App Store Connect API key (.p8) | ☐ pending | `~/.appstoreconnect/private_keys/` + 1Password backup |
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

> ⚠️ Capital One context — if there's any chance Duo eventually ships to Capital
> One internal users under the company name, this should probably be an
> *organization* enrollment under a Capital One-controlled Apple ID. That's a
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
- ☐ Cert common name as it appears in Keychain (`Developer ID Application: …`)
  → this becomes `CSC_NAME` in `.env`
- ☐ Delete `developerID_application.cer` and `CertificateSigningRequest.certSigningRequest`
  from disk (they're not secrets, but no reason to leave them around)
- ☐ Optional: export cert + private key as a password-protected `.p12` and
  store in 1Password. Lets you restore signing capability if this Mac dies.

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
- ☐ **Key ID** (10 characters, shown in the ASC integrations table after
  generation) → `APPLE_API_KEY_ID` in `.env`
- ☐ **Issuer ID** (UUID, shown at the top of the API key page) →
  `APPLE_API_ISSUER` in `.env`
- ☐ **Path to .p8** (e.g. `~/.appstoreconnect/private_keys/AuthKey_ABC123.p8`)
  → `APPLE_API_KEY` in `.env`
- ☐ Confirmed .p8 backed up in 1Password

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
CSC_NAME="Developer ID Application: <name> (<teamid>)"
APPLE_API_KEY=/Users/geoffreydudgeon/.appstoreconnect/private_keys/AuthKey_<keyid>.p8
APPLE_API_KEY_ID=<10-char Key ID>
APPLE_API_ISSUER=<Issuer UUID>
APPLE_TEAM_ID=<10-char Team ID>
```

Then in `electron-builder.yml`:
1. Uncomment the `mac.identity` and `mac.notarize` block.
2. Flip `dmg.sign: false` → `dmg.sign: true`.

Verify with:

    npm run dist

The DMG should be code-signed and notarized. Check with:

    spctl -a -t open --context context:primary-signature dist/Duo-*.dmg
    stapler validate dist/Duo-*.dmg

---

## References

- Electron-builder code signing: <https://www.electron.build/code-signing>
- Apple — Notarizing macOS software before distribution: <https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution>
- Apple — Creating App Store Connect API keys: <https://developer.apple.com/help/app-store-connect/manage-your-team/create-app-store-connect-api-keys-for-your-team>
- ROADMAP.md § Owner pre-work — cross-references this doc.
