#!/bin/bash
set -euo pipefail

# Build macOS .app + .dmg with optional notarization.
# Notarizes automatically when APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID are set.

DMG_DIR="src-tauri/target/release/bundle/dmg"
APP_DIR="src-tauri/target/release/bundle/macos"

# Build (Tauri notarizes .app automatically if env vars are set)
APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-Developer ID Application: Hari Shekhar (3RPKRQ84N3)}" \
  tauri build --bundles dmg,app -- --features local-stt

# Copy DMG to release/
mkdir -p release
cp -f "$DMG_DIR"/*.dmg release/

# Strip provenance attrs so local .app works without notarization
xattr -cr "$APP_DIR/Linty.app"

# Notarize DMG if credentials are available
if [[ -n "${APPLE_ID:-}" && -n "${APPLE_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
  DMG_PATH=$(ls "$DMG_DIR"/*.dmg | head -1)
  echo "Notarizing DMG: $DMG_PATH"

  xcrun notarytool submit "$DMG_PATH" \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" \
    --wait

  xcrun stapler staple "$DMG_PATH"

  # Update release copy with stapled DMG
  cp -f "$DMG_PATH" release/

  echo "DMG notarized and stapled."
else
  echo "Skipping DMG notarization (no APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID)."
fi
