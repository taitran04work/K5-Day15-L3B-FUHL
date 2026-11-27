import { useContext } from "react"
import { ThemeContext } from "@/lib/theme"
import { cn } from "@/lib/utils"

/**
 * Stayra brand logo (mark + wordmark), cut from public/Stayra_logo.png.
 * `tone="light"` is the cream wordmark for dark backgrounds.
 */
export function Logo({ tone = "dark", className }: { tone?: "dark" | "light" | "auto"; className?: string }) {
  const { mode } = useContext(ThemeContext)
  const lightWordmark = tone === "light" || (tone === "auto" && mode === "dark")
  return (
    <img
      src={lightWordmark ? "/brand/stayra-logo-light.png" : "/brand/stayra-logo.png"}
      alt="Stayra"
      width={349}
      height={160}
      draggable={false}
      className={cn("h-7 w-auto select-none", className)}
    />
  )
}

/** The orange arch on its own, for tight spots. */
export function LogoMark({ className }: { className?: string }) {
  return <img src="/brand/stayra-mark.png" alt="Stayra" width={102} height={128} draggable={false} className={cn("h-7 w-auto select-none", className)} />
}
