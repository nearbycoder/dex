#!/bin/sh
# Runs the iOS app's tests: DexCore's unit tests (macOS, fast), then the app's unit and UI tests on a simulator.
#   scripts/test.sh                      # DexCore + all app tests on "iPhone 18 Pro"
#   DEVICE="iPad Pro 13-inch (M5)" scripts/test.sh
#   ONLY=DexUITests/ChatUITests scripts/test.sh
#   DEX_LIVE_SERVER=http://localhost:5173 DEX_LIVE_TOKEN=… scripts/test.sh   # also the live-server tests
set -eu
cd "$(dirname "$0")/.."

echo "› DexCore (swift test)"
(cd DexKit && swift test)

DEVICE="${DEVICE:-iPhone 18 Pro}"
DESTINATION="platform=iOS Simulator,name=$DEVICE"
ARGS=""
if [ -n "${ONLY:-}" ]; then ARGS="-only-testing:$ONLY"; fi

echo "› App tests on $DEVICE"
TEST_RUNNER_DEX_LIVE_SERVER="${DEX_LIVE_SERVER:-}" \
TEST_RUNNER_DEX_SCREENSHOTS="${DEX_SCREENSHOTS:-$PWD/artifacts/screenshots}" \
xcodebuild test -project Dex.xcodeproj -scheme Dex -destination "$DESTINATION" -derivedDataPath build/dd $ARGS
