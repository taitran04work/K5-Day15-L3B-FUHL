import { useId, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import { cn } from "@/lib/utils"

export interface BarPoint {
  key: string
  label: string
  axisLabel?: string
  value: number
}

export type SeriesChartMode = "line" | "bar"

const EASE_CHART = [0.22, 1, 0.36, 1] as const

function niceScale(rawMax: number) {
  const rough = Math.max(1, rawMax) / 3
  const mag = Math.pow(10, Math.floor(Math.log10(rough)))
  const norm = rough / mag
  const stepUnit = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10
  const step = stepUnit * mag
  return { max: step * 3, ticks: [step * 3, step * 2, step, 0] }
}

/**
 * Single-series revenue/activity chart supporting both line+area and bar views:
 * one hue (the tenant accent), clean scaled Y ticks, smooth entrance draw/grow animations,
 * interactive hover guide & tooltip, and a screen-reader table.
 */
export function BarSeries({
  data,
  format,
  formatTick,
  mode = "bar",
  height = 180,
  caption,
  className,
}: {
  data: BarPoint[]
  format: (v: number) => string
  formatTick?: (v: number) => string
  mode?: SeriesChartMode
  height?: number
  caption: string
  className?: string
}) {
  const reduce = useReducedMotion()
  const [hover, setHover] = useState<number | null>(null)
  const gradId = useId()
  const rawMax = Math.max(1, ...data.map((d) => d.value))
  const { max, ticks } = niceScale(rawMax)
  const h = hover !== null ? data[hover] : null
  const n = data.length
  const tickLabel = formatTick ?? ((v: number) => (v === 0 ? "0" : format(v)))

  // Compute percentage positions so line, area, dots, and hover columns align 1:1
  const points = data.map((d, i) => ({
    x: n === 1 ? 50 : ((i + 0.5) / n) * 100,
    y: 100 - (Math.max(0, d.value) / max) * 100,
  }))
  const linePts = points.map((p) => `${(p.x * 10).toFixed(2)},${(p.y * 2).toFixed(2)}`).join(" ")
  const areaPath =
    points.length > 0
      ? `M ${(points[0].x * 10).toFixed(2)},200 ` +
        points.map((p) => `L ${(p.x * 10).toFixed(2)},${(p.y * 2).toFixed(2)}`).join(" ") +
        ` L ${(points[points.length - 1].x * 10).toFixed(2)},200 Z`
      : ""

  // Evenly spaced X-axis ticks (always keeping first and last)
  const xTickIndices: number[] = []
  if (n <= 8) {
    for (let i = 0; i < n; i++) xTickIndices.push(i)
  } else {
    const step = Math.ceil((n - 1) / 6)
    for (let i = 0; i < n; i += step) xTickIndices.push(i)
    const last = xTickIndices[xTickIndices.length - 1]
    if (last !== n - 1) {
      if (n - 1 - last < Math.ceil(step / 2)) xTickIndices[xTickIndices.length - 1] = n - 1
      else xTickIndices.push(n - 1)
    }
  }

  return (
    <figure className={cn("relative select-none", className)}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
        {/* Y-axis labels */}
        <div className="relative flex flex-col justify-between text-right text-[11px] text-subtle tabular" style={{ height }}>
          {ticks.map((tv, i) => (
            <span key={i} className="-translate-y-1/2 leading-none first:translate-y-0 last:translate-y-1/2">
              {tickLabel(tv)}
            </span>
          ))}
        </div>

        {/* Plot area */}
        <div key={mode} className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
          {/* Gridlines */}
          {ticks.map((tv, i) => (
            <div
              key={i}
              className={cn("pointer-events-none absolute inset-x-0 border-t", tv === 0 ? "border-border" : "border-border/60")}
              style={{ top: `${(1 - tv / max) * 100}%` }}
            />
          ))}

          {mode === "line" ? (
            <>
              <motion.div
                className="pointer-events-none absolute inset-0"
                initial={reduce ? false : { clipPath: "inset(-16px 100% -16px 0px)", opacity: 0.4 }}
                whileInView={{ clipPath: "inset(-16px 0% -16px 0px)", opacity: 1 }}
                viewport={{ once: true, amount: 0.15 }}
                transition={{ duration: 1.15, ease: EASE_CHART }}
              >
                <svg viewBox="0 0 1000 200" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
                  <defs>
                    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {areaPath && <path d={areaPath} fill={`url(#${gradId})`} />}
                  {points.length > 1 && (
                    <polyline
                      fill="none"
                      stroke="var(--brand)"
                      strokeWidth="2.2"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                      points={linePts}
                    />
                  )}
                </svg>

                {/* Crisp circular data dots */}
                {points.map((p, i) => {
                  const active = hover === i
                  return (
                    <span
                      key={data[i].key}
                      className={cn(
                        "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-brand transition-[width,height,opacity,box-shadow] duration-150",
                        active ? "z-10 size-3 ring-4 ring-brand/20" : "size-2",
                        hover !== null && !active && "opacity-70",
                      )}
                      style={{ left: `${p.x}%`, top: `${p.y}%` }}
                    />
                  )
                })}
              </motion.div>

              {/* Vertical hover guide */}
              {hover !== null && points[hover] && (
                <div className="pointer-events-none absolute inset-y-0 w-px bg-border" style={{ left: `${points[hover].x}%` }} />
              )}

              {/* Full-height hover hit zones */}
              <div className="absolute inset-0 flex">
                {data.map((d, i) => (
                  <div
                    key={d.key}
                    className="h-full flex-1 cursor-crosshair"
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    tabIndex={-1}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="absolute inset-0 flex items-end gap-[2px]">
              {data.map((d, i) => (
                <div
                  key={d.key}
                  className="relative flex h-full flex-1 items-end justify-center"
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  tabIndex={-1}
                >
                  <motion.div
                    initial={reduce ? false : { scaleY: 0, opacity: 0.25 }}
                    whileInView={{ scaleY: 1, opacity: 1 }}
                    viewport={{ once: true, amount: 0.15 }}
                    transition={{ duration: 0.75, delay: reduce ? 0 : (i / Math.max(1, n)) * 0.45, ease: EASE_CHART }}
                    className={cn("w-full max-w-8 origin-bottom rounded-t-[4px] bg-brand", hover !== null && hover !== i && "opacity-40")}
                    style={{ height: d.value > 0 ? `max(${(d.value / max) * 100}%, 2px)` : 0 }}
                  />
                </div>
              ))}
            </div>
          )}

          {h && hover !== null && (
            <div
              className="pointer-events-none absolute -top-2 z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
              style={{ left: `${Math.min(92, Math.max(8, ((hover + 0.5) / n) * 100))}%` }}
            >
              <p className="text-muted-foreground">{h.label}</p>
              <p className="font-medium tabular">{format(h.value)}</p>
            </div>
          )}
        </div>

        {/* Spacer under Y-axis + X-axis labels */}
        <div />
        <div className="relative mt-2.5 h-4 text-[11px] text-subtle tabular" aria-hidden>
          {xTickIndices.map((idx, pos) => {
            const x = n === 1 ? 50 : ((idx + 0.5) / n) * 100
            const isFirst = pos === 0
            const isLast = pos === xTickIndices.length - 1
            return (
              <span
                key={data[idx].key}
                className={cn(
                  "absolute top-0 whitespace-nowrap",
                  isFirst ? "translate-x-0" : isLast ? "-translate-x-full" : "-translate-x-1/2",
                )}
                style={{ left: `${isFirst ? 0 : isLast ? 100 : x}%` }}
              >
                {data[idx].axisLabel ?? data[idx].label}
              </span>
            )
          })}
        </div>
      </div>

      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <tbody>
            {data.map((d) => (
              <tr key={d.key}>
                <th scope="row">{d.label}</th>
                <td>{format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}
