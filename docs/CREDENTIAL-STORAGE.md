# Groq credential storage

Groq API keys are stored as generic passwords in the macOS login Keychain,
using service `ai.linty.desktop.groq` and account `api-key`. macOS manages the
encrypted storage and access controls; Linty does not keep an encryption key in
its preferences. This build supports secure credential storage on macOS only.

On first settings load, Linty reads Keychain and migrates a legacy `groqApiKey`
from `linty-settings.json` if needed. Only after Keychain accepts the credential
does Linty delete the plaintext field from both the live settings store and disk.
An existing Keychain credential takes priority over a stale legacy value. Failure
to access Keychain or persist cleanup is shown as an error, with no plaintext
fallback. Migration can be retried. New settings and onboarding saves use the
same native credential commands and never write the API key into JSON.

In **Settings → Speech engine → Cloud**, **Remove API key** deletes the saved
credential and switches to Local. Cloud setup can still be opened, but Cloud
cannot activate until a new key is saved. Removal is disabled during dictation.
If deletion fails, Linty keeps its previous credential and engine state and shows
the error. **Reset all data** also removes the Keychain credential.

Keychain protects the credential at rest from ordinary preference-file scanning.
This is not a guarantee against malware running with sufficient privileges or a
compromised Linty process. The current app still loads the decrypted key into
Rust/JavaScript memory for requests and the settings field; the password dots
only conceal its display. Removing a key clears app state but cannot guarantee
that all old memory copies are overwritten. Keychain permissions may require a
macOS prompt, particularly when replacing a development binary.

Migration removes the current JSON value; it does not erase historical backups
or revoke the key at Groq. Removing it from Linty likewise does not revoke it.

References: [Apple Keychain data protection](https://support.apple.com/guide/security/keychain-data-protection-secb0694df1a/web)
and [Apple's macOS Keychain overview](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains).

Validation covers migration ordering, failed secure writes, retry after failed
plaintext cleanup, preservation of newer Keychain values, Cloud selection/save
gating, failed replacement/removal, deletion while idle, and removal followed by
Cloud setup with an empty field. Interface tests use synthetic keys and a fake
credential bridge; they do not delete the user's saved key.
