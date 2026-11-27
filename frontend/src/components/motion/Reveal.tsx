import type { ReactNode } from "react"
import { motion, useReducedMotion, type Variants } from "motion/react"

export const EASE = [0.22, 1, 0.36, 1] as const

type Direction = "up" | "down" | "left" | "right" | "none"

const offset = (d: Direction, dist: number) =>
  d === "up" ? { y: dist } : d === "down" ? { y: -dist } : d === "left" ? { x: dist } : d === "right" ? { x: -dist } : {}

/** Fades + slides its content in the first time it enters the viewport. */
export function Reveal({
  children,
  className,
  delay = 0,
  direction = "up",
  distance = 36,
  as = "div",
}: {
  children: ReactNode
  className?: string
  delay?: number
  direction?: Direction
  distance?: number
  /** @deprecated kept for call-site compatibility; reveals no longer blur (too costly over WebGL) */
  blur?: boolean
  as?: "div" | "section" | "li" | "span" | "h1" | "h2" | "p"
}) {
  const reduce = useReducedMotion()
  const Comp = motion[as]
  return (
    <Comp
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, ...offset(direction, distance) }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: reduce ? 0.2 : 0.8, delay, ease: EASE }}
    >
      {children}
    </Comp>
  )
}

const containerVariants = (stagger: number, delay: number): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren: delay } },
})

export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 32 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
}

/** Container that reveals its <StaggerItem> children one after another. */
export function Stagger({
  children,
  className,
  stagger = 0.09,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  stagger?: number
  delay?: number
}) {
  return (
    <motion.div
      className={className}
      variants={containerVariants(stagger, delay)}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.15 }}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={itemVariants}>
      {children}
    </motion.div>
  )
}

/** Splits a headline into words that rise in one by one. */
export function SplitWords({ text, className, delay = 0 }: { text: string; className?: string; delay?: number }) {
  const reduce = useReducedMotion()
  return (
    <span className={className} aria-label={text}>
      {text.split(" ").map((word, i) => (
        <span key={i} aria-hidden className="inline-block overflow-hidden pb-[0.12em] align-bottom">
          <motion.span
            className="inline-block"
            initial={reduce ? { opacity: 0 } : { y: "110%" }}
            whileInView={reduce ? { opacity: 1 } : { y: "0%" }}
            viewport={{ once: true }}
            transition={{ duration: 0.9, delay: delay + i * 0.05, ease: EASE }}
          >
            {word}
            {" "}
          </motion.span>
        </span>
      ))}
    </span>
  )
}
