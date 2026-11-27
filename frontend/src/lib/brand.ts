import { useEffect } from "react"

export const DEFAULT_BRAND = "#1F5F4A"

function luminance(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return 0
  const n = parseInt(m[1], 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

/** Applies the tenant's single accent colour, picking a foreground that keeps WCAG AA contrast. */
export function applyBrand(color?: string | null) {
  const c = color && /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_BRAND
  const root = document.documentElement
  root.style.setProperty("--brand", c)
  root.style.setProperty("--brand-foreground", luminance(c) > 0.45 ? "#111111" : "#ffffff")
}

export function useBrand(color?: string | null) {
  useEffect(() => {
    applyBrand(color)
  }, [color])
}
