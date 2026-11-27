import { useLayoutEffect, type CSSProperties } from "react"

export const DEFAULT_BRAND = "#1F5F4A"

export function isBrandColor(value?: string | null): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
}

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

type BrandStyle = CSSProperties & { "--brand": string; "--brand-foreground": string }

export function brandStyle(color?: string | null): BrandStyle {
  const accent = isBrandColor(color) ? color : DEFAULT_BRAND
  const light = luminance(accent)
  const whiteContrast = 1.05 / (light + 0.05)
  const blackContrast = (light + 0.05) / 0.05
  return { "--brand": accent, "--brand-foreground": blackContrast > whiteContrast ? "#000000" : "#ffffff" }
}

/** Root variables also reach dialogs and chat panels rendered in portals. */
export function useBrand(color?: string | null) {
  useLayoutEffect(() => {
    if (!isBrandColor(color)) return
    const root = document.documentElement.style
    const style = brandStyle(color)
    root.setProperty("--guest-brand", style["--brand"])
    root.setProperty("--guest-brand-foreground", style["--brand-foreground"])
    return () => {
      root.removeProperty("--guest-brand")
      root.removeProperty("--guest-brand-foreground")
    }
  }, [color])
}
