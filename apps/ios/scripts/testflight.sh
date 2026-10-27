#!/bin/sh
# Archives the app and uploads it to App Store Connect, where it shows up in TestFlight once processed.
#   scripts/testflight.sh                 # archive, sign for the App Store, upload
#   UPLOAD=0 scripts/testflight.sh        # archive and export build/testflight/Dex.ipa only
#
# Settings come from the environment or the gitignored apps/ios/.deploy.vars (shell syntax):
#   DEVELOPMENT_TEAM=ABCDE12345           # required: your Apple Developer team ID
#   ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_PATH=…/AuthKey_….p8
#                                         # optional: an App Store Connect API key; without one,
#                                         # signing and the upload use the account signed in to Xcode
#   BUILD_NUMBER=…                        # optional: defaults to the UTC time, so every upload is newer
set -eu
cd "$(dirname "$0")/.."

if [ -f .deploy.vars ]; then . ./.deploy.vars; fi
: "${DEVELOPMENT_TEAM:?Set DEVELOPMENT_TEAM (your team ID) in apps/ios/.deploy.vars or the environment}"
BUILD_NUMBER="${BUILD_NUMBER:-$(date -u +%Y%m%d%H%M)}"
UPLOAD="${UPLOAD:-1}"
OUT=build/testflight
ARCHIVE="$OUT/Dex.xcarchive"

AUTH=""
if [ -n "${ASC_KEY_ID:-}" ]; then
  : "${ASC_ISSUER_ID:?ASC_ISSUER_ID is needed with ASC_KEY_ID}"
  : "${ASC_KEY_PATH:?ASC_KEY_PATH is needed with ASC_KEY_ID}"
  AUTH="-authenticationKeyID $ASC_KEY_ID -authenticationKeyIssuerID $ASC_ISSUER_ID -authenticationKeyPath $ASC_KEY_PATH"
fi

rm -rf "$OUT"
mkdir -p "$OUT"

if [ "$UPLOAD" = 1 ]; then DESTINATION=upload; else DESTINATION=export; fi
cat > "$OUT/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>destination</key>
	<string>$DESTINATION</string>
	<key>teamID</key>
	<string>$DEVELOPMENT_TEAM</string>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>manageAppVersionAndBuildNumber</key>
	<false/>
	<key>uploadSymbols</key>
	<true/>
	<key>testFlightInternalTestingOnly</key>
	<false/>
</dict>
</plist>
EOF

MARKETING_VERSION=$(sed -n 's/^ *MARKETING_VERSION: "\(.*\)"/\1/p' project.yml)
echo "› Archiving Dex $MARKETING_VERSION ($BUILD_NUMBER) for team $DEVELOPMENT_TEAM"
# shellcheck disable=SC2086
xcodebuild archive -project Dex.xcodeproj -scheme Dex -configuration Release \
  -destination "generic/platform=iOS" -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates $AUTH \
  DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" CURRENT_PROJECT_VERSION="$BUILD_NUMBER"

if [ "$UPLOAD" = 1 ]; then echo "› Uploading to App Store Connect"; else echo "› Exporting the .ipa"; fi
# shellcheck disable=SC2086
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist "$OUT/ExportOptions.plist" \
  -exportPath "$OUT" -allowProvisioningUpdates $AUTH

if [ "$UPLOAD" = 1 ]; then
  echo "✓ Uploaded build $BUILD_NUMBER. It appears in App Store Connect → TestFlight after processing (usually 5–15 minutes)."
else
  echo "✓ Exported $OUT/Dex.ipa"
fi
