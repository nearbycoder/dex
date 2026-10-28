#!/bin/bash
# Screenshot tour: runs ScreenTourUITests on several simulators, in light and/or dark mode, and saves every screen to
# apps/ios/artifacts/tour/<appearance>/Tour <device>-NN-<screen>.png for reviewing layout across device classes.
# Devices are simulator device types; each gets its own "Tour <type>" simulator (made on first use), so the tour
# never fights another test run for a simulator.
#   scripts/tour.sh                                        # every default device, light and dark
#   APPEARANCES=light scripts/tour.sh                      # light only
#   DEVICES="iPhone 18 Pro,iPad Pro 13-inch" scripts/tour.sh
#   SKIP_BUILD=1 scripts/tour.sh                           # reuse the last build
#   THEME=ocean TEST=testThemeGlance scripts/tour.sh       # the themed screens only, in Ocean (saved under <appearance>-ocean)
set -euo pipefail
cd "$(dirname "$0")/.."

DEVICES="${DEVICES:-iPhone SE (3rd generation),iPhone 17e,iPhone 18 Pro,iPhone 18 Pro Max,iPhone Air,iPhone Duo,iPad mini (A17 Pro),iPad Pro 13-inch (M5)}"
APPEARANCES="${APPEARANCES:-light dark}"
TEST="${TEST:-testTour}"
THEME="${THEME:-}"
CONCURRENCY="${CONCURRENCY:-4}"
DERIVED=build/tour
OUT="$PWD/artifacts/tour"

if [ -z "${SKIP_BUILD:-}" ]; then
  echo "› Building for testing"
  xcodebuild build-for-testing -project Dex.xcodeproj -scheme Dex -destination "generic/platform=iOS Simulator" \
    -derivedDataPath "$DERIVED" -quiet
fi

# The first available simulator with exactly this name (not "Dex …" copies).
udid_for() {
  xcrun simctl list devices available -j | python3 -c '
import json, sys
name = sys.argv[1]
for runtime, devices in json.load(sys.stdin)["devices"].items():
    for device in devices:
        if device["name"] == name and device["isAvailable"]:
            print(device["udid"]); sys.exit(0)
sys.exit(1)' "$1"
}

IFS=',' read -r -a NAMES <<< "$DEVICES"
UDIDS=()
# iOS runtimes, newest first: a device type may run only on some of them.
RUNTIMES=$(xcrun simctl list runtimes -j | python3 -c 'import json,sys; print(" ".join(reversed([r["identifier"] for r in json.load(sys.stdin)["runtimes"] if r["platform"]=="iOS" and r["isAvailable"]])))')
make_simulator() {
  for runtime in $RUNTIMES; do
    # simctl prints its errors on stdout too: keep only a UDID.
    udid=$(xcrun simctl create "Tour $1" "$1" "$runtime" 2>/dev/null | grep -E '^[0-9A-F-]{36}$') && { echo "$udid"; return 0; }
  done
  return 1
}
for name in "${NAMES[@]}"; do
  udid=$(udid_for "Tour $name") || udid=$(make_simulator "$name") || { echo "Can't make a \"$name\" simulator" >&2; exit 1; }
  UDIDS+=("$udid")
done

for appearance in $APPEARANCES; do
  folder="$appearance${THEME:+-$THEME}"
  echo "› $folder: ${DEVICES}"
  mkdir -p "$OUT/$folder"
  DESTINATIONS=()
  for udid in "${UDIDS[@]}"; do
    xcrun simctl boot "$udid" 2>/dev/null || true
    xcrun simctl bootstatus "$udid" -b >/dev/null
    xcrun simctl ui "$udid" appearance "$appearance"
    DESTINATIONS+=(-destination "id=$udid")
  done
  TEST_RUNNER_DEX_SCREENSHOTS="$OUT/$folder" TEST_RUNNER_DEX_THEME="$THEME" \
  xcodebuild test-without-building -project Dex.xcodeproj -scheme Dex -derivedDataPath "$DERIVED" \
    "${DESTINATIONS[@]}" -only-testing:"DexUITests/ScreenTourUITests/$TEST" \
    -parallel-testing-enabled NO -maximum-concurrent-test-device-destinations "$CONCURRENCY" \
    -resultBundlePath "$PWD/build/tour-$folder-$(date +%s).xcresult" -quiet || echo "  (some tour runs failed; screenshots so far are kept)"
done

# Screenshots come in the screen's native (portrait) orientation: turn the landscape ones upright.
for file in "$OUT"/*/*landscape*.png; do
  [ -f "$file" ] || continue
  width=$(sips -g pixelWidth "$file" | awk '/pixelWidth/ {print $2}')
  height=$(sips -g pixelHeight "$file" | awk '/pixelHeight/ {print $2}')
  if [ "$height" -gt "$width" ]; then sips -r 270 "$file" >/dev/null; fi
done

echo "✓ Screenshots in $OUT"
for appearance in $APPEARANCES; do
  folder="$appearance${THEME:+-$THEME}"
  for name in "${NAMES[@]}"; do
    echo "  $folder/$name: $(ls "$OUT/$folder" 2>/dev/null | grep -c "^Tour $name-" || true)"
  done
done
