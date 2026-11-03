#!/bin/sh
# Builds a signed release and installs it on a phone over adb, keeping the app's data (sign-in, drafts).
#   scripts/install-phone.sh                          # the one phone adb sees (emulators are skipped)
#   scripts/install-phone.sh 192.168.1.20:37099       # a phone by serial or Wireless debugging address
#   PAIR=192.168.1.20:41235 CODE=123456 scripts/install-phone.sh
#                                                     # pair first (Wireless debugging → Pair device with pairing code)
#
# Needs keystore.properties (see app/build.gradle.kts) naming the key the phone's copy was signed with:
# Android refuses an update signed with another key.
# VERSION_CODE defaults to minutes since 2024, so every build installs over the last one.
set -eu
cd "$(dirname "$0")/.."

[ -f keystore.properties ] || { echo "keystore.properties is missing: release builds would be unsigned" >&2; exit 1; }
VERSION_CODE="${VERSION_CODE:-$(( ($(date +%s) - 1704067200) / 60 ))}"
if [ -z "${JAVA_HOME:-}" ]; then JAVA_HOME=$(find ~/.gradle/jdks -maxdepth 4 -type d -name Home -path "*21*" | head -1); export JAVA_HOME; fi

if [ -n "${PAIR:-}" ]; then adb pair "$PAIR" "${CODE:?CODE is the six-digit pairing code}"; sleep 3; fi
SERIAL="${1:-}"
if [ -n "$SERIAL" ]; then
  case "$SERIAL" in *:*) adb connect "$SERIAL" >/dev/null ;; esac
else
  SERIAL=$(adb devices | awk 'NR > 1 && $2 == "device" && $1 !~ /^emulator-/ { print $1 }' | head -1)
  [ -n "$SERIAL" ] || { echo "No phone found. Turn on Wireless debugging and pass its address, or PAIR and CODE." >&2; exit 1; }
fi

./gradlew -q :app:assembleRelease -PversionCode="$VERSION_CODE"
adb -s "$SERIAL" install -r app/build/outputs/apk/release/app-release.apk
adb -s "$SERIAL" shell am start -n dev.trydex.android/.MainActivity >/dev/null 2>&1 || true
echo "✓ Installed build $VERSION_CODE on $SERIAL"
