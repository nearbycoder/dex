import { useEffect } from "react"

/**
 * Haptic feedback when tapping anything you can act on, on a phone: buttons, links, menu items, tabs, options,
 * switches and checkboxes, disclosures, selects.
 *
 * - iPhone and iPad: Safari has no Vibration API, but toggling an `<input type="checkbox" switch>` plays the
 *   system tap, so a hidden switch is clicked from code during each tap. (Laying an invisible switch over each
 *   button, as ios-haptics does, broke scrolling: a drag that starts on a switch moves the switch, not the list,
 *   and Dex's pages and menus are mostly buttons inside scrolling lists.)
 * - Android: a short `navigator.vibrate` on the same taps.
 * - Desktop: nothing.
 *
 * Add `data-no-haptic` to a control (or a container) to keep it quiet.
 */

const STORAGE_KEY = "dex-haptics"
const CHANGE_EVENT = "dex-haptics-change"
const TAP_TARGETS = [
  "a[href]",
  "button",
  "summary",
  "label",
  "select",
  'input[type="checkbox"]',
  'input[type="radio"]',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="switch"]'
].join(", ")
const TAP_MS = 8
/** A label and its checkbox both fire a click for one tap; one haptic per tap. */
const DEBOUNCE_MS = 80

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)

export const hapticsEnabled = () => typeof localStorage === "undefined" || localStorage.getItem(STORAGE_KEY) !== "off"

export function setHapticsEnabled(enabled: boolean) {
  localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off")
  dispatchEvent(new Event(CHANGE_EVENT))
}

export const onHapticsChange = (listener: () => void) => {
  addEventListener(CHANGE_EVENT, listener)
  return () => removeEventListener(CHANGE_EVENT, listener)
}

/** Whether this device can give haptic feedback at all. */
export const hapticsSupported = () => typeof navigator !== "undefined" && (isIOS() || "vibrate" in navigator)

let iosSwitch: HTMLLabelElement | null = null
let lastTap = 0

/** iOS: plays the system tap by clicking a hidden switch's label. Works only during a user gesture. */
function iosTap() {
  if (!iosSwitch) {
    iosSwitch = document.createElement("label")
    iosSwitch.setAttribute("aria-hidden", "true")
    iosSwitch.dataset.dexHaptic = ""
    iosSwitch.style.display = "none"
    const input = document.createElement("input")
    input.type = "checkbox"
    input.setAttribute("switch", "")
    input.tabIndex = -1
    iosSwitch.appendChild(input)
    document.head.appendChild(iosSwitch)
  }
  iosSwitch.click()
}

/**
 * One haptic tap now, if haptics are on: for actions that aren't a tap on a control (a swipe that opened the
 * sidebar). Call it from a touch or click handler; iOS ignores it anywhere else.
 */
export function haptic() {
  if (typeof window === "undefined" || !hapticsEnabled() || Date.now() - lastTap < DEBOUNCE_MS) return
  lastTap = Date.now()
  if (isIOS()) iosTap()
  else if ("vibrate" in navigator) navigator.vibrate(TAP_MS)
}

/** A tap on any control. */
const onTap = (event: MouseEvent) => {
  const element = event.target instanceof Element ? event.target : null
  if (!element || element.closest("[data-dex-haptic], [data-no-haptic]")) return
  const target = element.closest(TAP_TARGETS)
  if (!target || target.matches(":disabled, [aria-disabled='true']")) return
  haptic()
}

/** Turns haptics on for the whole document; returns a function that turns them off again. */
export function installHaptics(): () => void {
  if (!isIOS() && !("vibrate" in navigator)) return () => undefined
  document.addEventListener("click", onTap, { capture: true, passive: true })
  return () => document.removeEventListener("click", onTap, { capture: true })
}

/** Keeps haptics installed while enabled; mounted once in the app layout. */
export function useHaptics() {
  useEffect(() => {
    let uninstall = hapticsEnabled() ? installHaptics() : () => undefined
    const off = onHapticsChange(() => {
      uninstall()
      uninstall = hapticsEnabled() ? installHaptics() : () => undefined
    })
    return () => {
      off()
      uninstall()
    }
  }, [])
}
