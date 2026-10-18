import { Menu } from "lucide-react"
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { haptic } from "./haptics"

const WIDE = "(min-width: 768px)"
const COLLAPSED_KEY = "dex.sidebarCollapsed"

interface Nav {
  /** Phones: the drawer is open. */
  readonly drawerOpen: boolean
  /** Tablets and up: the persistent sidebar is hidden. */
  readonly collapsed: boolean
  /** Shows navigation: opens the drawer on phones, expands the sidebar on wider screens. */
  readonly show: () => void
  readonly closeDrawer: () => void
  readonly toggleCollapsed: () => void
  /** Keeps the drawer open through the next page change, e.g. switching the sidebar to Settings. */
  readonly holdOpen: () => void
  /** Whether a hold was set since the last page change; clears it. */
  readonly takeHold: () => boolean
}

export const NavContext = createContext<Nav>({
  drawerOpen: false,
  collapsed: false,
  show: () => {},
  closeDrawer: () => {},
  toggleCollapsed: () => {},
  holdOpen: () => {},
  takeHold: () => false
})

export const useNav = () => useContext(NavContext)

/**
 * Navigation state for every screen size: a drawer on phones (swipe in from the left edge, swipe away to
 * close) and a collapsible sidebar on tablets, foldables, and desktop (⌘/Ctrl+B).
 */
export function useNavState(): Nav {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => typeof localStorage !== "undefined" && localStorage.getItem(COLLAPSED_KEY) === "1")

  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      localStorage.setItem(COLLAPSED_KEY, value ? "0" : "1")
      return !value
    })
  }, [])

  const show = useCallback(() => {
    if (matchMedia(WIDE).matches) {
      localStorage.setItem(COLLAPSED_KEY, "0")
      setCollapsed(false)
    } else {
      setDrawerOpen(true)
    }
  }, [])

  const closeDrawer = useCallback(() => setDrawerOpen(false), [])
  const hold = useRef(false)
  const holdOpen = useCallback(() => {
    hold.current = true
  }, [])
  const takeHold = useCallback(() => {
    const held = hold.current
    hold.current = false
    return held
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault()
        if (matchMedia(WIDE).matches) toggleCollapsed()
        else setDrawerOpen((open) => !open)
      }
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [toggleCollapsed])

  // Edge swipe, like a native drawer: start within EDGE px of the left edge and pull right to open;
  // swipe left anywhere while it is open to close it.
  //
  // iOS treats a swipe from the left edge as "back" (in Safari and in the Home Screen app), so the same gesture
  // used to open the drawer *and* leave the page. Touches that start in the edge strip are claimed
  // (preventDefault on a non-passive touchstart), which stops the system gesture; since that also cancels the
  // tap, a touch that doesn't move is replayed as a click (or focus) on whatever is under it.
  useEffect(() => {
    const EDGE = 24
    let start: { x: number; y: number; at: number; edge: boolean; moved: boolean } | null = null
    // The drawer moves during the swipe, but iOS plays a haptic only from the touch's end.
    let swiped = false
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch || event.touches.length > 1 || matchMedia(WIDE).matches) return
      const edge = touch.clientX < EDGE
      if (edge) event.preventDefault()
      start = { x: touch.clientX, y: touch.clientY, at: Date.now(), edge, moved: false }
    }
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!start || !touch) return
      const dx = touch.clientX - start.x
      const dy = Math.abs(touch.clientY - start.y)
      if (Math.abs(dx) > 10 || dy > 10) start.moved = true
      if (dy > 40 && !start.edge) {
        start = null
        return
      }
      if (start.edge && dx > 56) {
        setDrawerOpen(true)
        swiped = true
        start = null
      } else if (!start.edge && dx < -56) {
        setDrawerOpen((open) => {
          if (open) swiped = true
          return false
        })
        start = null
      }
    }
    const onEnd = (event: TouchEvent) => {
      if (swiped) {
        swiped = false
        haptic()
      }
      const tap = start?.edge && !start.moved && Date.now() - start.at < 600 ? start : null
      start = null
      if (!tap) return
      // The claimed touch never became a click: deliver it to what was tapped.
      const target = document.elementFromPoint(tap.x, tap.y)
      const control = target?.closest<HTMLElement>("input, textarea, select, [contenteditable='true']")
      if (control) return control.focus()
      const clickable = target?.closest<HTMLElement>("a, button, label, summary, [role='button']") ?? (target as HTMLElement | null)
      clickable?.click()
      event.preventDefault()
    }
    addEventListener("touchstart", onStart, { passive: false })
    addEventListener("touchmove", onMove, { passive: true })
    addEventListener("touchend", onEnd, { passive: false })
    return () => {
      removeEventListener("touchstart", onStart)
      removeEventListener("touchmove", onMove)
      removeEventListener("touchend", onEnd)
    }
  }, [])

  return { drawerOpen, collapsed, show, closeDrawer, toggleCollapsed, holdOpen, takeHold }
}

/**
 * Keeps `--app-height` equal to the visible viewport. On iOS the on-screen keyboard covers the page instead
 * of resizing it, so this is what keeps the composer above the keyboard (and undoes Safari's page shift).
 */
export function useVisualViewportHeight() {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const update = () => {
      document.documentElement.style.setProperty("--app-height", `${Math.round(viewport.height)}px`)
      if (viewport.offsetTop > 0 && document.documentElement.scrollTop !== 0) window.scrollTo(0, 0)
    }
    update()
    viewport.addEventListener("resize", update)
    viewport.addEventListener("scroll", update)
    return () => {
      viewport.removeEventListener("resize", update)
      viewport.removeEventListener("scroll", update)
    }
  }, [])
}

/** Opens navigation. Shown on phones, and on wider screens while the sidebar is collapsed. */
export function MenuButton() {
  const { show, collapsed } = useNav()
  return (
    <button
      type="button"
      onClick={show}
      title="Menu (⌘B)"
      aria-label="Menu"
      className={`-ml-1.5 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 ${collapsed ? "" : "md:hidden"}`}
    >
      <Menu className="size-5" />
    </button>
  )
}
