#!/bin/sh
# Builds a signed App Bundle and uploads it to Google Play's internal testing track, where testers get it from the
# Play Store (and its updates automatically) once it's processed: Android's TestFlight.
#   scripts/play-internal.sh                  # build, upload, release to internal testers
#   UPLOAD=0 scripts/play-internal.sh         # build app/build/outputs/bundle/release/app-release.aab only
#                                             # (the very first bundle has to be uploaded in Play Console by hand)
#
# Settings come from the environment or the gitignored apps/android/.deploy.vars (shell syntax):
#   PLAY_SERVICE_ACCOUNT=…/play-service-account.json
#                                   # required to upload: a Google Cloud service account's JSON key, invited in
#                                   # Play Console (Users and permissions) with permission to release to testing tracks
#   PLAY_TRACK=internal             # optional: internal (default), alpha (closed testing), beta (open testing)
#   RELEASE_NOTES="…"               # optional: what's new, shown to testers (en-US)
#   VERSION_CODE=…                  # optional: defaults to minutes since 2024, so every upload is newer
# Signing uses keystore.properties (see app/build.gradle.kts): the upload key; Play App Signing signs for phones.
set -eu
cd "$(dirname "$0")/.."

if [ -f .deploy.vars ]; then . ./.deploy.vars; fi
[ -f keystore.properties ] || { echo "keystore.properties is missing: Play only takes signed bundles" >&2; exit 1; }
UPLOAD="${UPLOAD:-1}"
VERSION_CODE="${VERSION_CODE:-$(( ($(date +%s) - 1704067200) / 60 ))}"
if [ "$UPLOAD" = 1 ]; then : "${PLAY_SERVICE_ACCOUNT:?Set PLAY_SERVICE_ACCOUNT (a service account JSON key) in apps/android/.deploy.vars}"; fi
if [ -z "${JAVA_HOME:-}" ]; then JAVA_HOME=$(find ~/.gradle/jdks -maxdepth 4 -type d -name Home -path "*21*" | head -1); export JAVA_HOME; fi

VERSION_NAME=$(sed -n 's/^ *versionName = "\(.*\)"/\1/p' app/build.gradle.kts)
echo "› Building Dex $VERSION_NAME ($VERSION_CODE)"
./gradlew -q :app:bundleRelease -PversionCode="$VERSION_CODE"
BUNDLE=app/build/outputs/bundle/release/app-release.aab
MAPPING=app/build/outputs/mapping/release/mapping.txt

if [ "$UPLOAD" != 1 ]; then
  echo "✓ Built $BUNDLE"
  exit 0
fi

echo "› Uploading to Google Play (${PLAY_TRACK:-internal})"
node scripts/play-upload.mjs \
  --service-account "$PLAY_SERVICE_ACCOUNT" --package dev.trydex.android --bundle "$BUNDLE" --mapping "$MAPPING" \
  --track "${PLAY_TRACK:-internal}" --name "$VERSION_NAME ($VERSION_CODE)" --notes "${RELEASE_NOTES:-}"
