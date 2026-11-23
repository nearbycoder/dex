import { Link } from "@tanstack/react-router"
import { Check, Settings2, Shield, ShieldCheck } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { VpnInfo } from "~/shared/protocol"

/** Composer menu for the VPN a chat's VM browser goes through (or none). */
export function VpnPicker(props: { vpns: ReadonlyArray<VpnInfo>; selected: string | null; onChange: (id: string | null) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [upward, setUpward] = useState(true)
  const root = useRef<HTMLDivElement>(null)
  const current = props.vpns.find((vpn) => vpn.id === props.selected) ?? null

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", close)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("pointerdown", close)
      document.removeEventListener("keydown", escape)
    }
  }, [open])

  const toggleMenu = () => {
    const rect = root.current?.getBoundingClientRect()
    if (rect) setUpward(rect.top > window.innerHeight - rect.bottom)
    setOpen((value) => !value)
  }

  const pick = (id: string | null) => {
    setOpen(false)
    if (id !== props.selected) props.onChange(id)
  }

  const option = (id: string | null, label: string, detail: string) => {
    const selected = id === (current?.id ?? null)
    return (
      <li key={id ?? "off"}>
        <button type="button" role="menuitemradio" aria-checked={selected} onClick={() => pick(id)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-zinc-900">
          <span className="flex size-4 shrink-0 items-center justify-center text-emerald-400">{selected && <Check className="size-3.5" />}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-zinc-100">{label}</span>
            <span className="block truncate text-[11px] text-zinc-500">{detail}</span>
          </span>
        </button>
      </li>
    )
  }

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        disabled={props.disabled}
        onClick={toggleMenu}
        title={current ? `The VM's browser goes through ${current.name}` : "Put the VM's browser on a VPN"}
        aria-label={current ? `VPN: ${current.name}` : "VPN: off"}
        className={`flex items-center gap-1 rounded-md border px-1.5 py-1 text-xs disabled:opacity-50 sm:gap-1.5 sm:pr-2 ${
          current ? "border-sky-800/70 bg-sky-950/30 text-sky-300" : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700"
        }`}
      >
        {current ? <ShieldCheck className="size-3.5" /> : <Shield className="size-3.5" />}
        {/* Phones show just the shield, so the toolbar stays on one line. */}
        <span className="hidden sm:inline">{current ? <span className="inline-block max-w-24 truncate align-bottom">{current.name}</span> : "VPN"}</span>
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute left-0 z-50 w-72 max-w-[calc(100vw-2rem)] animate-pop overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/50 ${
            upward ? "bottom-full mb-1.5 origin-bottom-left" : "top-full mt-1.5 origin-top-left"
          }`}
        >
          <div className="px-3 pt-2.5 pb-1 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">VPN for this chat's browser</div>
          {props.vpns.length === 0 ? (
            <p className="px-3 py-2 text-xs leading-relaxed text-zinc-500">
              No VPNs yet. Add one (a WireGuard config from Surfshark, Mullvad, Proton…) and the VM's browser can go through it.
            </p>
          ) : (
            <ul className="scrollbar-thin max-h-72 overflow-y-auto py-1">
              {option(null, "Off", "The browser goes out directly")}
              {props.vpns.map((vpn) => option(vpn.id, vpn.name, vpn.endpoint))}
            </ul>
          )}
          <p className="border-t border-zinc-900 px-3 py-2 text-[11px] leading-relaxed text-zinc-500">Only the browser: commands on the VM go out directly.</p>
          <Link
            to="/secrets"
            hash="vpns"
            className="flex items-center gap-1.5 border-t border-zinc-900 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          >
            <Settings2 className="size-3.5" /> {props.vpns.length ? "Manage VPNs" : "Add a VPN"}
          </Link>
        </div>
      )}
    </div>
  )
}
