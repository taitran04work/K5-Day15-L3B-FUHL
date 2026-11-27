import { useContext, useEffect, useLayoutEffect, useState, type ReactNode } from "react"
import { Moon, Sun } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Toaster } from "@/components/ui/sonner"
import { ThemeContext, type ThemeMode } from "@/lib/theme"
import { cn } from "@/lib/utils"

const STORAGE_KEY = "stayra.theme"
const DARK_MODE_QUERY = "(prefers-color-scheme: dark)"

export function SystemTheme({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [preference, setPreference] = useState<ThemeMode | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved === "light" || saved === "dark" ? saved : null
  })
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(DARK_MODE_QUERY).matches)
  const mode = preference ?? (systemDark ? "dark" : "light")

  useEffect(() => {
    const media = window.matchMedia(DARK_MODE_QUERY)
    const update = () => setSystemDark(media.matches)
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  function setMode(value: ThemeMode) {
    setPreference(value)
    localStorage.setItem(STORAGE_KEY, value)
  }

  return (
    <ThemeContext.Provider value={{ mode, setMode }}>
      {children}
      <Toaster theme={enabled ? mode : "light"} />
    </ThemeContext.Provider>
  )
}

export function SystemThemeScope({ enabled }: { enabled: boolean }) {
  const { mode } = useContext(ThemeContext)

  useLayoutEffect(() => {
    if (!enabled) return
    const root = document.documentElement
    root.dataset.stayraTheme = mode
    root.classList.toggle("dark", mode === "dark")
    return () => {
      delete root.dataset.stayraTheme
      root.classList.remove("dark")
    }
  }, [enabled, mode])

  return null
}

export function ThemeSwitch({ className, showLabel = false }: { className?: string; showLabel?: boolean }) {
  const { mode, setMode } = useContext(ThemeContext)
  const { t } = useTranslation()
  const next = mode === "dark" ? "light" : "dark"
  const label = t(`theme.switchTo.${next}`)
  const Icon = next === "dark" ? Moon : Sun

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setMode(next)}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-2.5 rounded-md border border-input bg-card text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
        showLabel ? "px-3" : "size-9 justify-center",
        className,
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {showLabel && label}
    </button>
  )
}
