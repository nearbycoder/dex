import { type ReactNode, useState } from "react"

/**
 * Opens and closes its content by animating its height (a 0fr → 1fr grid row, which every browser can
 * animate). The content mounts on first open and stays mounted, so closing animates too.
 */
export function Collapse({ open, children, className = "" }: { open: boolean; children: ReactNode; className?: string }) {
  const [mounted, setMounted] = useState(open)
  // Mount in the same render that opens, so the row animates from empty to full.
  if (open && !mounted) setMounted(true)
  return (
    <div
      aria-hidden={!open}
      className={`grid transition-[grid-template-rows,opacity] duration-250 ease-fluid ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"} ${className}`}
    >
      <div className="min-h-0 overflow-hidden">{mounted && children}</div>
    </div>
  )
}
