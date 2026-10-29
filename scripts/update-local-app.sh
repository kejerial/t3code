#!/usr/bin/env bash
# Build this fork's macOS app and install it as "Kode.app", replacing "T3 Code (Beta).app".
#
# Usage: scripts/update-local-app.sh [--upstream]
#   --upstream  also merge pingdotgg/t3code main before building (no push).
#
# Run it from Terminal.app, not from Kode's own terminal: the script quits Kode.
set -euo pipefail

APP_NAME="Kode"
APP_PATH="/Applications/${APP_NAME}.app"
# The bundle id survived the rename, so quitting by id also stops the old app.
APP_BUNDLE_ID="com.t3tools.t3code"
LEGACY_APP_PATH="/Applications/T3 Code (Beta).app"
UPDATE_REPOSITORY="kejerial/t3code"

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

command -v vp >/dev/null || export PATH="$HOME/.local/share/vite-plus/bin:$PATH"
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Commit or stash your changes first." >&2
  exit 1
fi

git pull --ff-only origin main
if [ "${1:-}" = "--upstream" ]; then
  git fetch upstream
  git merge --no-edit upstream/main
fi

vp install
rm -f release/T3-Code-*-arm64.*
T3CODE_DESKTOP_UPDATE_REPOSITORY="$UPDATE_REPOSITORY" vp run dist:desktop:dmg:arm64

zip="$(ls -t release/T3-Code-*-arm64.zip | head -1)"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
ditto -x -k "$zip" "$staging"

running() { [ "$(osascript -e "application id \"$APP_BUNDLE_ID\" is running")" = "true" ]; }
if running; then
  osascript -e "quit app id \"$APP_BUNDLE_ID\""
  while running; do sleep 1; done
fi

rm -rf "$APP_PATH"
ditto "$staging/${APP_NAME}.app" "$APP_PATH"
[ ! -d "$LEGACY_APP_PATH" ] || rm -rf "$LEGACY_APP_PATH"
open "$APP_PATH"
echo "Installed $(git rev-parse --short HEAD) to $APP_PATH from $zip"
