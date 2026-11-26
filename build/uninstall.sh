#!/usr/bin/env bash
# COMPLETE uninstall of LetHim Voice from this Mac: the app, every cache/state file
# it leaves in ~/Library, and its macOS permission (TCC) grants. Use this to test
# the install flow from a truly clean slate, exactly as a brand-new user would see it.
#
# It does NOT touch:
#   - the DMG installers in release/        (that's what you install FROM)
#   - the build signing certificate          (needed to build; a real user never has it)
#
#   bash build/uninstall.sh
set -eu

APP_NAME="LetHim Voice"
APP="/Applications/${APP_NAME}.app"
BUNDLE_ID="com.lethim.voice"
DATA_NAME="lethim-voice"   # Electron userData folder (from package.json "name")

echo "- Quitting ${APP_NAME} (if running)..."
osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
pkill -f "${APP}" >/dev/null 2>&1 || true
sleep 1

echo "- Removing the app bundle..."
rm -rf "${APP}"

echo "- Resetting TCC permission grants (Accessibility + Microphone)..."
tccutil reset Accessibility "${BUNDLE_ID}" || true
tccutil reset Microphone    "${BUNDLE_ID}" || true

echo "- Removing all Library data / caches / state..."
rm -rf "$HOME/Library/Application Support/${DATA_NAME}"
rm -rf "$HOME/Library/Caches/${DATA_NAME}"
rm -rf "$HOME/Library/Caches/${BUNDLE_ID}"
rm -rf "$HOME/Library/Preferences/${BUNDLE_ID}.plist"
rm -rf "$HOME/Library/Preferences/${BUNDLE_ID}.helper.plist"
rm -rf "$HOME/Library/Saved Application State/${BUNDLE_ID}.savedState"
rm -rf "$HOME/Library/Logs/${DATA_NAME}"
rm -rf "$HOME/Library/HTTPStorages/${BUNDLE_ID}"
rm -rf "$HOME/Library/HTTPStorages/${BUNDLE_ID}.binarycookies"
rm -rf "$HOME/Library/WebKit/${BUNDLE_ID}"

# Flush the preferences cache daemon so nothing lingers in memory.
killall cfprefsd >/dev/null 2>&1 || true

echo ""
echo "Done. LetHim Voice is fully removed (app + caches + permissions)."
echo "Installer kept: $(ls release/*.dmg 2>/dev/null | tr '\n' ' ')"
echo ""
echo "Now install like a fresh user:"
echo "  1) Open the latest DMG from release/ or the GitHub releases page."
echo "  2) Drag the app into Applications."
echo "  3) First launch is blocked by Gatekeeper (unidentified developer):"
echo "       right-click the app in /Applications -> Open -> Open,"
echo "       or run: xattr -cr \"${APP}\" && open \"${APP}\""
echo "  4) In the app: grant Accessibility + Microphone via the banner, then Restart."
