import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { cn } from "@/lib/utils"

export interface DeckSlide {
  id: string
  label: string
  tone: "dark" | "light"
  /** @deprecated kept for call-site compatibility */
  motion?: "zoom"
  content: ReactNode
}

const EASE_SLIDE = [0.76, 0, 0.24, 1] as const
const EASE_COPY = [0.22, 1, 0.36, 1] as const
/** Camera flight duration per single slide transition (ms). */
const STEP_MS = 1050
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

/**
 * Fixed-viewport, gesture-driven slide deck. The page itself never scrolls vertically:
 * wheel ticks, touch swipes, arrow keys, or header jumps switch the active slide
 * immediately while easing `progress` continuously for the 3D background camera.
 * Jump with `window.dispatchEvent(new CustomEvent("deck:goto", { detail: id }))`.
 */
export function SlideDeck({
  slides,
  progress,
  onSceneVisible,
  header,
  background,
  overlay,
}: {
  slides: DeckSlide[]
  progress: RefObject<number>
  onSceneVisible?: (visible: boolean) => void
  header?: (ctx: { index: number; slide: DeckSlide; go: (target: number | string) => void }) => ReactNode
  background?: ReactNode
  overlay?: (ctx: { index: number; slide: DeckSlide; go: (target: number | string) => void }) => ReactNode
}) {
  const reduce = useReducedMotion()
  const root = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const initialIndex = (() => {
    if (typeof window === "undefined") return 0
    const hash = window.location.hash.slice(1)
    const found = hash ? slides.findIndex((s) => s.id === hash) : -1
    return found >= 0 ? found : 0
  })()
  const [[index, dir], setIndex] = useState<[number, number]>([initialIndex, 1])
  const indexRef = useRef(initialIndex)
  const sceneVisible = useRef(true)
  const anim = useRef(0)

  const syncProgress = useCallback(
    (p: number) => {
      progress.current = p
      if (bar.current) {
        bar.current.style.transform = `scaleX(${(p + 1) / slides.length})`
      }
      const lo = Math.max(0, Math.floor(p))
      const hi = Math.min(slides.length - 1, Math.ceil(p))
      const vis = slides[lo]?.tone === "dark" || slides[hi]?.tone === "dark"
      if (vis !== sceneVisible.current) {
        sceneVisible.current = vis
        onSceneVisible?.(vis)
      }
    },
    [onSceneVisible, progress, slides],
  )

  const animateProgressTo = useCallback(
    (target: number, ms: number) => {
      cancelAnimationFrame(anim.current)
      const from = progress.current
      const dist = target - from
      if (Math.abs(dist) < 0.001 || reduce) {
        syncProgress(target)
        return
      }
      const t0 = performance.now()
      const tick = (now: number) => {
        const k = Math.min(1, (now - t0) / ms)
        syncProgress(from + dist * easeOutCubic(k))
        if (k < 1) anim.current = requestAnimationFrame(tick)
      }
      anim.current = requestAnimationFrame(tick)
    },
    [progress, reduce, syncProgress],
  )

  const go = useCallback(
    (target: number | string) => {
      const next =
        typeof target === "number"
          ? Math.max(0, Math.min(slides.length - 1, target))
          : slides.findIndex((s) => s.id === target)
      if (next < 0) return
      const prev = indexRef.current
      if (next === prev && Math.abs(progress.current - next) < 0.01) return
      indexRef.current = next
      setIndex([next, next >= prev ? 1 : -1])
      history.replaceState(history.state, "", next === 0 ? window.location.pathname : `#${slides[next].id}`)
      const hops = Math.abs(next - progress.current)
      animateProgressTo(next, Math.min(1900, STEP_MS + Math.max(0, hops - 1) * 180))
    },
    [animateProgressTo, progress, slides],
  )

  useEffect(() => {
    syncProgress(indexRef.current)
    return () => cancelAnimationFrame(anim.current)
  }, [syncProgress])

  // Lock document scroll completely so the landing deck stays fixed in the viewport
  useEffect(() => {
    const html = document.documentElement
    const prev = [html.style.overflow, document.body.style.overflow]
    html.style.overflow = "hidden"
    document.body.style.overflow = "hidden"
    return () => {
      ;[html.style.overflow, document.body.style.overflow] = prev
    }
  }, [])

  useEffect(() => {
    const target = root.current
    if (!target) return

    let lastWheel = 0
    let lastStep = 0
    let touchY = 0
    let touchInner: HTMLElement | null = null

    const step = (delta: number) => {
      const next = Math.max(0, Math.min(slides.length - 1, indexRef.current + delta))
      if (next !== indexRef.current) go(next)
    }

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) < 4 || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return
      const d = Math.sign(e.deltaY)
      const inner = (e.target as Element | null)?.closest?.("[data-deck-scroll]") as HTMLElement | null
      if (inner && (d > 0 ? inner.scrollTop + inner.clientHeight < inner.scrollHeight - 2 : inner.scrollTop > 2)) {
        return
      }
      e.preventDefault()
      const now = performance.now()
      const gap = now - lastWheel
      lastWheel = now
      // Coalesce trackpad momentum tails (<60ms apart) while keeping mouse wheel notches immediate
      const isStream = gap < 60
      if (now - lastStep < (isStream ? 420 : 180)) return
      lastStep = now
      step(d)
    }

    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.defaultPrevented || el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? "")) return
      if (el?.closest?.('[role="dialog"],[role="grid"],[role="listbox"],[role="menu"],[role="radiogroup"],[data-radix-popper-content-wrapper]')) return
      if (e.key === " " && el?.closest?.('button,a,summary,[role="button"],[role="tab"]')) return
      if (["ArrowDown", "PageDown"].includes(e.key) || (e.key === " " && !e.shiftKey)) {
        e.preventDefault()
        step(1)
      } else if (["ArrowUp", "PageUp"].includes(e.key) || (e.key === " " && e.shiftKey)) {
        e.preventDefault()
        step(-1)
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault()
        go(e.key === "Home" ? 0 : slides.length - 1)
      }
    }

    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? 0
      touchInner = (e.target as Element | null)?.closest?.("[data-deck-scroll]") as HTMLElement | null
    }
    const onTouchEnd = (e: TouchEvent) => {
      const endY = e.changedTouches[0]?.clientY ?? touchY
      const dy = touchY - endY
      if (Math.abs(dy) < 36) return
      const d = Math.sign(dy)
      if (touchInner && (d > 0 ? touchInner.scrollTop + touchInner.clientHeight < touchInner.scrollHeight - 2 : touchInner.scrollTop > 2)) {
        return
      }
      step(d)
    }

    const onGoto = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      if (slides.some((s) => s.id === id)) {
        e.preventDefault()
        go(id)
      }
    }
    const onHash = () => {
      const id = window.location.hash.slice(1)
      if (id) go(id)
    }

    target.addEventListener("wheel", onWheel, { passive: false })
    target.addEventListener("touchstart", onTouchStart, { passive: true })
    target.addEventListener("touchend", onTouchEnd, { passive: true })
    window.addEventListener("keydown", onKey)
    window.addEventListener("deck:goto", onGoto)
    window.addEventListener("hashchange", onHash)
    return () => {
      target.removeEventListener("wheel", onWheel)
      target.removeEventListener("touchstart", onTouchStart)
      target.removeEventListener("touchend", onTouchEnd)
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("deck:goto", onGoto)
      window.removeEventListener("hashchange", onHash)
    }
  }, [go, slides])

  const slide = slides[index]
  const dark = slide.tone === "dark"

  return (
    <div
      ref={root}
      className={cn(
        "deck-root fixed inset-0 h-dvh w-full touch-none overflow-hidden overscroll-none transition-colors duration-700",
        dark ? "bg-[#081420] text-[#f3ecdf]" : "bg-[#f5efe4] text-[#14201b]",
      )}
      data-tone={slide.tone}
    >
      {background}

      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.section
            key={slide.id}
            id={slide.id}
            aria-roledescription="slide"
            aria-label={`${index + 1} / ${slides.length}: ${slide.label}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0.12 : 0.24, ease: EASE_COPY }}
            className="pointer-events-auto absolute inset-0 overflow-y-auto overscroll-none scrollbar-none md:overflow-hidden"
          >
            {slide.content}
          </motion.section>
        </AnimatePresence>
      </div>

      {overlay?.({ index, slide, go })}

      {header?.({ index, slide, go })}

      {/* progress line — follows the camera progress */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 h-[3px] bg-current/10">
        <div ref={bar} className="h-full origin-left bg-[#f0a35e] will-change-transform" style={{ transform: `scaleX(${(index + 1) / slides.length})` }} />
      </div>

      {/* slide counter */}
      <div className="pointer-events-none absolute bottom-5 left-5 z-40 hidden items-end gap-3 sm:bottom-7 sm:left-8 sm:flex">
        <div className="relative h-[2.3rem] overflow-hidden font-display text-[2.2rem] font-semibold leading-none">
          <AnimatePresence initial={false} custom={dir} mode="popLayout">
            <motion.span
              key={index}
              custom={dir}
              initial={{ y: dir > 0 ? "100%" : "-100%", opacity: 0 }}
              animate={{ y: "0%", opacity: 1 }}
              exit={{ y: dir > 0 ? "-100%" : "100%", opacity: 0 }}
              transition={{ duration: 0.5, ease: EASE_SLIDE }}
              className="block tabular"
            >
              {String(index + 1).padStart(2, "0")}
            </motion.span>
          </AnimatePresence>
        </div>
        <span className="pb-1 text-xs tracking-[0.2em] opacity-55">/ {String(slides.length).padStart(2, "0")}</span>
      </div>
    </div>
  )
}
