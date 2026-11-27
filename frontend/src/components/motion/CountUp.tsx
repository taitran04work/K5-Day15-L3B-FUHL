import { useEffect, useRef, type ReactNode } from "react"
import { animate, useInView, useReducedMotion } from "motion/react"

const EASE_OUT = [0.16, 1, 0.3, 1] as const

/** Counts a number up from `from` to `to` the first time it scrolls into view. */
export function CountUp({
  to,
  from = 0,
  duration = 1.8,
  decimals = 0,
  delay = 0,
  locale = "vi-VN",
  className,
}: {
  to: number
  from?: number
  duration?: number
  decimals?: number
  delay?: number
  locale?: string
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.6 })
  const reduce = useReducedMotion()
  const fmt = (v: number) =>
    v.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

  useEffect(() => {
    const el = ref.current
    if (!el || !inView) return
    if (reduce) {
      el.textContent = fmt(to)
      return
    }
    const controls = animate(from, to, {
      duration,
      delay,
      ease: EASE_OUT,
      onUpdate: (v) => {
        el.textContent = fmt(v)
      },
    })
    return () => controls.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, to, from, duration, delay, reduce])

  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {fmt(from)}
    </span>
  )
}

const NUMBER_RE = /-?\d[\d.,\s]*\d|\d/

/**
 * Animates the first number found inside a display string ("83%", "₫24,850,000", "12 giờ"),
 * keeping its prefix, suffix and thousands separator. Non-string values render unchanged.
 */
export function AnimatedValue({ value }: { value: ReactNode }) {
  if (typeof value !== "string" && typeof value !== "number") return <>{value}</>
  const text = String(value)
  const match = NUMBER_RE.exec(text)
  if (!match) return <>{text}</>

  const raw = match[0]
  const sep = raw.includes(",") && !/,\d{1,2}$/.test(raw) ? "," : raw.includes(".") && !/\.\d{1,2}$/.test(raw) ? "." : ""
  const decimalMatch = /[.,](\d{1,2})$/.exec(raw)
  const decimals = decimalMatch && decimalMatch[0][0] !== sep ? decimalMatch[1].length : 0
  const normalized = raw
    .replace(/\s/g, "")
    .split(sep || "\u0000")
    .join("")
    .replace(",", ".")
  const target = Number(normalized)
  if (!Number.isFinite(target)) return <>{text}</>

  const commaDecimal = decimals > 0 && decimalMatch![0][0] === ","
  const locale = sep === "." || commaDecimal ? "de-DE" : "en-US"
  return (
    <>
      {text.slice(0, match.index)}
      <CountUp to={target} decimals={decimals} locale={locale} duration={1.4} />
      {text.slice(match.index + raw.length)}
    </>
  )
}
