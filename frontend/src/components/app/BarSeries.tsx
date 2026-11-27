import { useState } from "react"
import { cn } from "@/lib/utils"

export interface BarPoint {
  key: string
  label: string
  value: number
}

/**
 * Single-series bar chart: one hue (the tenant accent), thin bars with rounded data-ends anchored
 * to the baseline, recessive gridlines, per-bar hover tooltip, and a screen-reader table.
 */
export function BarSeries({ data, format, height = 160, caption, className }: { data: BarPoint[]; format: (v: number) => string; height?: number; caption: string; className?: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((d) => d.value))
  const ticks = [max, max / 2, 0]
  const h = hover !== null ? data[hover] : null
  return (
    <figure className={cn("relative", className)}>
      <div className="relative" style={{ height }}>
        {ticks.map((tv, i) => (
          <div key={i} className="absolute inset-x-0 flex items-center gap-2" style={{ top: `${(1 - tv / max) * 100}%` }}>
            <span className="h-px flex-1 bg-border/70" />
          </div>
        ))}
        <div className="absolute inset-0 flex items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
          {data.map((d, i) => (
            <div key={d.key} className="relative flex h-full flex-1 items-end justify-center" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1}>
              <div
                className={cn("w-full max-w-8 rounded-t-[4px] bg-brand transition-opacity", hover !== null && hover !== i && "opacity-40")}
                style={{ height: d.value > 0 ? `max(${(d.value / max) * 100}%, 2px)` : 0 }}
              />
            </div>
          ))}
        </div>
        {h && hover !== null && (
          <div
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: `${((hover + 0.5) / data.length) * 100}%` }}
          >
            <p className="text-muted-foreground">{h.label}</p>
            <p className="font-medium tabular">{format(h.value)}</p>
          </div>
        )}
      </div>
      <div className={cn("mt-2 flex text-[11px] text-subtle tabular", data.length === 1 ? "justify-center" : "justify-between")} aria-hidden>
        <span>{data[0]?.label}</span>
        {data.length > 1 && <span>{data.at(-1)?.label}</span>}
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
