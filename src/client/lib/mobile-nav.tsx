import { Menu } from "lucide-react"
import { createContext, useContext } from "react"

/** Opens the sidebar drawer on small screens. */
export const MobileNavContext = createContext<() => void>(() => {})

export function MenuButton() {
  const open = useContext(MobileNavContext)
  return (
    <button
      type="button"
      onClick={open}
      title="Menu"
      className="-ml-1.5 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 md:hidden"
    >
      <Menu className="size-5" />
    </button>
  )
}
