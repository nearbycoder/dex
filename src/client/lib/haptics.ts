import { hapticTrigger } from "ios-haptics"
import { useEffect } from "react"

/**
 * Haptic feedback when tapping controls on a phone.
 *
 * - iPhone and iPad: Safari has no Vibration API, but toggling an `<input type="checkbox" switch>` plays the
 *   system tap. ios-haptics puts an invisible switch inside each button; the tap toggles it (the haptic) and
 *   still bubbles to the button's click handler. Only `type="button"` buttons get one: inside a link or a
 *   submit button the switch would take the tap and the navigation or submit would never happen.
 * - Android: a short `navigator.vibrate` on taps of buttons and links.
 * - Desktop: nothing.
 */

const STORAGE_KEY = "dex-haptics"
const CHANGE_EVENT = "dex-haptics-change"
const IOS_TARGETS = 'button[type="button"]:not([data-no-haptic])'
const TAP_TARGETS = 'button:not([data-no-haptic]), a[href], [role="button"], [role="menuitemcheckbox"], label'
const TAP_MS = 8

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

/** Turns haptics on for the whole document; returns a function that turns them off again. */
export function installHaptics(): () => void {
  if (isIOS()) {
    const attach = (node: Node) => {
      if (!(node instanceof Element)) return
      if (node.matches(IOS_TARGETS)) hapticTrigger(node as HTMLElement)
      for (const element of node.querySelectorAll<HTMLElement>(IOS_TARGETS)) hapticTrigger(element)
    }
    attach(document.body)
    // New buttons, and buttons whose children React replaced (dropping the switch), get one too.
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach(attach)
        const button = record.target instanceof Element ? record.target.closest(IOS_TARGETS) : null
        if (button) hapticTrigger(button as HTMLElement)
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      for (const input of document.querySelectorAll("[data-haptic-trigger]")) input.remove()
    }
  }

  if ("vibrate" in navigator) {
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest(TAP_TARGETS) : null
      if (!target || target.matches(":disabled, [aria-disabled='true']")) return
      navigator.vibrate(TAP_MS)
    }
    document.addEventListener("click", onClick, { capture: true, passive: true })
    return () => document.removeEventListener("click", onClick, { capture: true })
  }

  return () => undefined
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
