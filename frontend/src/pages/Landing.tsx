import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react"
import { Link } from "react-router"
import { useTranslation } from "react-i18next"
import { AnimatePresence, motion } from "motion/react"
import {
  ArrowRight,
  Bot,
  CalendarRange,
  CalendarX2,
  Calculator,
  FileCheck2,
  FileQuestion,
  Globe,
  Inbox,
  MessagesSquare,
} from "lucide-react"
import { Logo } from "@/components/Logo"
import { PricingAndFaq } from "@/components/landing/PricingAndFaq"
import { SlideDeck, type DeckSlide } from "@/components/landing/deck/SlideDeck"
import { BOARD, SHOTS, type SceneLabels, type Shot } from "@/components/landing/deck/shots"
import type { BoardRefs } from "@/components/landing/deck/StayScene"
import { CountUp } from "@/components/motion/CountUp"
import { Reveal, SplitWords, Stagger, StaggerItem, EASE } from "@/components/motion/Reveal"
import { getLanguageOption, languageOptions } from "@/i18n/languages"
import { cn } from "@/lib/utils"

const StayScene = lazy(() => import("@/components/landing/deck/StayScene"))

const AMBER = "#f0a35e"

interface StatItem {
  value: number
  suffix: string
  label: string
}
interface TextItem {
  title: string
  body: string
}
interface StepItem {
  step: string
  title: string
  desc: string
}
interface TypeCard {
  tag: string
  title: string
  desc: string
}
interface PlatformItem {
  id: string
  badge: string
  title: string
  desc: string
  cta: string
  to: string
}

/* ---------- shared slide chrome ---------- */

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <Reveal direction="up" distance={14} blur={false}>
      <span className="legible inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.26em] text-[#f6b273]">
        <span className="h-px w-8 bg-[#f0a35e]" />
        {children}
      </span>
    </Reveal>
  )
}

type Scrim = "left" | "right" | "center" | "full"

/** Soft radial darkening behind the copy only — fades to 0% before the edges so no dark box ever slides across the 3D scene. */
const SCRIMS: Record<Scrim, string> = {
  left: "bg-[radial-gradient(62%_75%_at_22%_52%,rgba(4,9,19,0.72)_0%,rgba(4,9,19,0.36)_55%,rgba(4,9,19,0)_100%)]",
  right: "bg-[radial-gradient(62%_75%_at_78%_52%,rgba(4,9,19,0.72)_0%,rgba(4,9,19,0.36)_55%,rgba(4,9,19,0)_100%)]",
  center: "bg-[radial-gradient(75%_55%_at_50%_36%,rgba(4,9,19,0.72)_0%,rgba(4,9,19,0.32)_62%,rgba(4,9,19,0)_100%)]",
  full: "bg-[radial-gradient(85%_68%_at_50%_54%,rgba(4,9,19,0.58)_0%,rgba(4,9,19,0.24)_58%,rgba(4,9,19,0)_100%)]",
}

function Frame({ children, scrim = "left", className }: { children: ReactNode; scrim?: Scrim; className?: string }) {
  return (
    <div className="relative min-h-dvh">
      <div aria-hidden className={cn("pointer-events-none absolute inset-0 max-md:bg-[rgba(4,9,19,0.7)]", SCRIMS[scrim])} />
      <div className={cn("relative flex min-h-dvh items-center px-6 pb-24 pt-28 text-[#f6efe2] sm:px-10 lg:px-20", className)}>{children}</div>
    </div>
  )
}

function H2({ children, className }: { children: string; className?: string }) {
  return (
    <h2 className={cn("legible mt-5 font-display text-[2.1rem] font-bold leading-[1.08] text-[#fbf6ec] sm:text-[3.2rem]", className)}>
      <SplitWords text={children} />
    </h2>
  )
}

function Lead({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Reveal delay={0.25}>
      <p className={cn("legible mt-4 max-w-xl text-base font-medium leading-relaxed text-[#f6efe2]/90 sm:text-lg", className)}>{children}</p>
    </Reveal>
  )
}

/**
 * Two live HTML sheets permanently projected onto the 3D wooden boards in StayScene.
 * Because they sit right on the boards in 3D space, zooming in from Demos or panning
 * between Pricing and FAQ reveals them continuously with zero pop-in effect.
 */
function ProjectedBoards({ boardRefs, activeSlideId }: { boardRefs: BoardRefs; activeSlideId: string }) {
  const [w, h] = BOARD.paper
  const hv = `${BOARD.fill * 100}dvh`
  const sheetStyle = {
    height: hv,
    width: `min(94vw, calc(${hv} * ${(w / h).toFixed(4)}))`,
    visibility: "hidden" as const,
  }
  const interactive = activeSlideId === "bang-gia" || activeSlideId === "hoi-dap"

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-0 overflow-hidden",
        interactive ? "z-20" : "z-[5]",
      )}
    >
      <div
        ref={boardRefs.pricing}
        data-deck-scroll
        style={sheetStyle}
        className={cn(
          "paper-sheet absolute left-0 top-0 overflow-y-auto rounded-[4px] shadow-[0_30px_90px_-40px_rgba(0,0,0,0.65)] will-change-transform",
          activeSlideId === "bang-gia" ? "pointer-events-auto" : "pointer-events-none",
        )}
      >
        <PricingAndFaq part="pricing" />
      </div>
      <div
        ref={boardRefs.faq}
        data-deck-scroll
        style={sheetStyle}
        className={cn(
          "paper-sheet absolute left-0 top-0 overflow-y-auto rounded-[4px] shadow-[0_30px_90px_-40px_rgba(0,0,0,0.65)] will-change-transform",
          activeSlideId === "hoi-dap" ? "pointer-events-auto" : "pointer-events-none",
        )}
      >
        <PricingAndFaq part="faq" />
      </div>
    </div>
  )
}

/* ---------- background: the island scene ---------- */

function DeckBackground({ shots, progress, boardRefs }: { shots: Shot[]; progress: RefObject<number>; boardRefs: BoardRefs }) {
  const { t, i18n } = useTranslation()
  // stable object so the scene isn't handed new props on every render
  const labels = useMemo(() => t("landing.deck.scene", { returnObjects: true }) as SceneLabels, [t, i18n.language]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 isolate z-0">
      {/* shown while the 3D chunk loads */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#040a18_0%,#0d1a36_55%,#7a3c22_78%,#0a1a26_80%,#061019_100%)]" />
      <div className="absolute inset-0 max-md:translate-x-[14%]">
        <Suspense fallback={null}>
          <StayScene shots={shots} progress={progress} active labels={labels} boardRefs={boardRefs} />
        </Suspense>
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(4,9,19,0.5)_0%,transparent_16%,transparent_84%,rgba(4,9,19,0.55)_100%)]" />
    </div>
  )
}

/* ---------- page ---------- */

/** One camera shot per slide; together they read as one flight around, over and into the island. */
const SHOT_FOR: Record<string, Shot> = {
  top: SHOTS.hero,
  "thuc-trang": SHOTS.problem,
  "so-lieu": SHOTS.live,
  "mo-hinh": SHOTS.types,
  "nen-tang": SHOTS.platform,
  "trien-khai": SHOTS.steps,
  "bang-gia": SHOTS.pricing,
  "hoi-dap": SHOTS.faq,
  "bat-dau": SHOTS.cta,
}

export default function Landing() {
  const { t } = useTranslation()
  const progress = useRef(0)
  const pricingBoardRef = useRef<HTMLDivElement>(null)
  const faqBoardRef = useRef<HTMLDivElement>(null)
  const boardRefs = useMemo<BoardRefs>(() => ({ pricing: pricingBoardRef, faq: faqBoardRef }), [])

  useEffect(() => {
    document.title = "Stayra — Hospitality OS & AI Concierge"
  }, [])

  // Built from translations only — interactive widgets keep their own state, so clicking
  // inside a slide never rebuilds the deck or moves the camera.
  const slides: DeckSlide[] = useMemo(() => {
    const heroStats = t("landing.deck.hero.stats", { returnObjects: true }) as StatItem[]
    const problems = t("landing.deck.problem.items", { returnObjects: true }) as TextItem[]
    const types = t("landing.deck.types.cards", { returnObjects: true }) as TypeCard[]
    const steps = t("landing.steps.items", { returnObjects: true }) as StepItem[]
    const problemIcons = [MessagesSquare, CalendarX2, Calculator, FileQuestion]
    const typeImages = ["/landing/beach.webp", "/landing/mountain-deck.webp", "/landing/city-apartment.webp"]

    return [
      /* 01 — hero */
      {
        id: "top",
        label: t("landing.deck.nav.hero"),
        tone: "dark",
        content: (
          <Frame scrim="left">
            <div className="max-w-2xl">
              <Eyebrow>{t("landing.deck.hero.kicker")}</Eyebrow>
              <h1 className="legible mt-6 font-display text-[2.6rem] font-bold leading-[1.02] text-[#fbf6ec] sm:text-[3.8rem] lg:text-[4.6rem]">
                <SplitWords text={t("landing.deck.hero.line1")} />
                <br />
                <SplitWords text={t("landing.deck.hero.line2")} delay={0.15} className="text-[#ffbe78]" />
              </h1>
              <Lead>{t("landing.deck.hero.short")}</Lead>
              <Reveal delay={0.6} className="mt-9 flex flex-wrap items-center gap-3">
                <PrimaryLink to="/h/pine-hill">{t("landing.demoPine")}</PrimaryLink>
                <GhostLink to="/h/sea-breeze">{t("landing.demoSea")}</GhostLink>
              </Reveal>
              <Stagger delay={0.8} className="mt-12 grid max-w-xl grid-cols-3 gap-4 border-t border-white/15 pt-6">
                {heroStats.map((s) => (
                  <StaggerItem key={s.label}>
                    <p className="legible font-display text-3xl font-bold text-[#fbf6ec] sm:text-[2.7rem]">
                      <CountUp to={s.value} duration={2.2} delay={1} />
                      <span className="text-[#f0a35e]">{s.suffix}</span>
                    </p>
                    <p className="legible mt-1.5 text-[13px] font-medium leading-snug text-[#f6efe2]/80">{s.label}</p>
                  </StaggerItem>
                ))}
              </Stagger>
            </div>
            <ScrollHint text={t("landing.deck.scrollHint")} />
          </Frame>
        ),
      },

      /* 02 — problem: titles only */
      {
        id: "thuc-trang",
        label: t("landing.deck.nav.problem"),
        tone: "dark",
        content: (
          <Frame scrim="right" className="md:justify-end">
            <div className="w-full max-w-xl">
              <Eyebrow>{t("landing.deck.problem.eyebrow")}</Eyebrow>
              <H2>{t("landing.deck.problem.title")}</H2>
              <Stagger delay={0.3} stagger={0.12} className="mt-10 grid gap-3">
                {problems.map((p, i) => {
                  const Icon = problemIcons[i % problemIcons.length]
                  return (
                    <StaggerItem key={p.title}>
                      <GlassCard className="flex items-center gap-4 px-5 py-4">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#f0a35e]/15 text-[#f0a35e]">
                          <Icon className="size-5" />
                        </span>
                        <span className="text-base font-semibold text-[#fbf6ec]">{p.title}</span>
                        <span className="ml-auto font-display text-sm font-bold text-white/30">{String(i + 1).padStart(2, "0")}</span>
                      </GlassCard>
                    </StaggerItem>
                  )
                })}
              </Stagger>
            </div>
          </Frame>
        ),
      },

      /* 03 — live numbers over the aerial view */
      {
        id: "so-lieu",
        label: t("landing.deck.nav.live"),
        tone: "dark",
        content: (
          <Frame scrim="left">
            <div className="w-full max-w-xl">
              <Eyebrow>{t("landing.deck.live.eyebrow")}</Eyebrow>
              <H2>{t("landing.deck.live.title")}</H2>
              <Stagger delay={0.3} stagger={0.12} className="mt-10 grid grid-cols-2 gap-3">
                <BigStat label={t("landing.deck.live.occ")}>
                  <CountUp to={83} delay={0.5} />
                  <Accent>%</Accent>
                </BigStat>
                <BigStat label={t("landing.deck.live.rooms")}>
                  <CountUp to={5} delay={0.6} />
                  <Accent>/6</Accent>
                </BigStat>
                <BigStat label={t("landing.deck.live.revenue")}>
                  <Accent>₫</Accent>
                  <CountUp to={24.85} decimals={2} delay={0.7} locale="en-US" />
                  <Accent>M</Accent>
                </BigStat>
                <BigStat label={t("landing.deck.live.chats")}>
                  <CountUp to={28} delay={0.8} />
                </BigStat>
              </Stagger>
              <Reveal delay={1}>
                <p className="legible mt-5 text-xs text-[#f6efe2]/70">{t("landing.deck.live.note")}</p>
              </Reveal>
            </div>
          </Frame>
        ),
      },

      /* 04 — property types, with photos */
      {
        id: "mo-hinh",
        label: t("landing.deck.nav.types"),
        tone: "dark",
        content: (
          <Frame scrim="full" className="justify-center">
            <div className="mx-auto w-full max-w-6xl">
              <div className="text-center">
                <Eyebrow>{t("landing.deck.types.eyebrow")}</Eyebrow>
                <H2 className="mx-auto max-w-3xl">{t("landing.deck.types.title")}</H2>
              </div>
              <Stagger delay={0.3} stagger={0.14} className="mt-10 grid gap-4 md:grid-cols-3">
                {types.map((c, i) => (
                  <StaggerItem key={c.title}>
                    <PhotoCard img={typeImages[i % typeImages.length]} tag={c.tag} title={c.title} />
                  </StaggerItem>
                ))}
              </Stagger>
            </div>
          </Frame>
        ),
      },

      /* 05 — platform: compact tab switcher (own state) */
      {
        id: "nen-tang",
        label: t("landing.deck.nav.platform"),
        tone: "dark",
        content: (
          <Frame scrim="full" className="justify-center">
            <div className="mx-auto w-full max-w-6xl">
              <Eyebrow>{t("landing.platform.eyebrow")}</Eyebrow>
              <H2 className="max-w-3xl">{t("landing.deck.platformTitle")}</H2>
              <Reveal delay={0.3} className="mt-10">
                <FeatureTabs />
              </Reveal>
            </div>
          </Frame>
        ),
      },

      /* 06 — steps: titles only */
      {
        id: "trien-khai",
        label: t("landing.deck.nav.steps"),
        tone: "dark",
        content: (
          <Frame scrim="left">
            <div className="w-full max-w-xl">
              <Eyebrow>{t("landing.steps.eyebrow")}</Eyebrow>
              <H2>{t("landing.deck.stepsTitle")}</H2>
              <div className="relative mt-12 pl-12">
                <motion.span
                  aria-hidden
                  className="absolute bottom-3 left-[15px] top-3 w-px origin-top bg-gradient-to-b from-[#f0a35e] via-[#f0a35e]/60 to-transparent"
                  initial={{ scaleY: 0 }}
                  whileInView={{ scaleY: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 1.6, delay: 0.4, ease: EASE }}
                />
                <Stagger delay={0.45} stagger={0.28} className="space-y-8">
                  {steps.map((s) => (
                    <StaggerItem key={s.step} className="relative">
                      <span className="absolute -left-12 top-0 flex size-[31px] items-center justify-center rounded-full bg-[#f0a35e] text-xs font-bold text-[#1a120a]">
                        {s.step}
                      </span>
                      <h3 className="legible text-xl font-semibold text-[#fbf6ec]">{s.title}</h3>
                    </StaggerItem>
                  ))}
                </Stagger>
              </div>
            </div>
          </Frame>
        ),
      },

      /* 07 — pricing board: rendered live on the 3D board via ProjectedBoards */
      {
        id: "bang-gia",
        label: t("landing.deck.nav.pricing"),
        tone: "dark",
        content: <div className="pointer-events-none min-h-dvh" />,
      },

      /* 08 — FAQ board: rendered live on the 3D board via ProjectedBoards */
      {
        id: "hoi-dap",
        label: t("landing.deck.nav.faq"),
        tone: "dark",
        content: <div className="pointer-events-none min-h-dvh" />,
      },

      /* 09 — cta + footer */
      {
        id: "bat-dau",
        label: t("landing.deck.nav.cta"),
        tone: "dark",
        content: (
          <div className="relative flex min-h-dvh flex-col px-6 pt-28 text-[#f6efe2] sm:px-10 lg:px-20">
            <div aria-hidden className={cn("pointer-events-none absolute inset-0", SCRIMS.center)} />
            <div className="relative mx-auto flex max-w-3xl flex-1 flex-col items-center text-center">
              <Eyebrow>{t("landing.deck.cta.kicker")}</Eyebrow>
              <H2>{t("landing.cta.title")}</H2>
              <Reveal delay={0.45} className="mt-9 flex flex-wrap justify-center gap-3">
                <PrimaryLink to="/h/pine-hill">{t("landing.cta.primary")}</PrimaryLink>
                <GhostLink to="/login">{t("landing.cta.secondary")}</GhostLink>
              </Reveal>
            </div>
            <Reveal delay={0.6} className="relative">
              <footer className="mx-auto mb-8 mt-[30vh] flex w-full max-w-5xl flex-col gap-4 rounded-2xl border border-white/10 bg-[#060d1a]/85 px-5 py-4 text-xs text-[#f6efe2]/80 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex items-center gap-3">
                  <Logo tone="light" className="h-6" />
                  <span>
                    © {new Date().getFullYear()} {t("landing.footer.rights")}
                  </span>
                </span>
                <div className="flex flex-wrap gap-x-3 gap-y-2">
                  {[
                    ["/h/pine-hill", "Pine Hill"],
                    ["/h/sea-breeze", "Sea Breeze"],
                    ["/dev/zalo-simulator", "Zalo Simulator"],
                    ["/h/pine-hill/manage", t("public.manageBooking")],
                  ].map(([to, label]) => (
                    <Link
                      key={to}
                      to={to}
                      className="group relative inline-flex overflow-hidden rounded-full px-2.5 py-1 transition-all duration-300 hover:-translate-y-0.5 hover:text-[#f0a35e]"
                    >
                      <HoverSheen tone="subtle" />
                      <span className="relative">{label}</span>
                    </Link>
                  ))}
                </div>
              </footer>
            </Reveal>
          </div>
        ),
      },
    ]
  }, [t])

  const sceneShots = useMemo(() => slides.map((s) => SHOT_FOR[s.id] ?? SHOTS.hero), [slides])

  return (
    <SlideDeck
      slides={slides}
      progress={progress}
      background={<DeckBackground shots={sceneShots} progress={progress} boardRefs={boardRefs} />}
      overlay={({ slide }) => <ProjectedBoards boardRefs={boardRefs} activeSlideId={slide.id} />}
      header={({ go }) => <DeckHeader go={go} />}
    />
  )
}

/* ---------- platform tabs (state lives here, not in the deck) ---------- */

const PLATFORM_ICONS: Record<string, typeof Globe> = { booking: Globe, ai: Bot, policy: FileCheck2, inbox: Inbox, calendar: CalendarRange }

function FeatureTabs() {
  const { t } = useTranslation()
  const items = t("landing.platform.items", { returnObjects: true }) as PlatformItem[]
  const [active, setActive] = useState(items[0]?.id)
  const current = items.find((i) => i.id === active) ?? items[0]
  const Icon = PLATFORM_ICONS[current.id] ?? Globe
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="grid gap-2" role="tablist">
        {items.map((it) => {
          const I = PLATFORM_ICONS[it.id] ?? Globe
          const on = it.id === current.id
          return (
            <button
              key={it.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setActive(it.id)}
              className={cn(
                "group relative flex items-center gap-3 overflow-hidden rounded-2xl border px-4 py-3 text-left transition-all duration-300 hover:-translate-y-0.5",
                on ? "border-[#f0a35e]/60 bg-[#2a1d12]/85" : "border-white/10 bg-[#08101e]/82 hover:border-[#f0a35e]/45",
              )}
            >
              <HoverSheen tone="subtle" />
              <span className={cn("relative flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors", on ? "bg-[#f0a35e] text-[#1a120a]" : "bg-white/10 text-[#f6efe2]")}>
                <I className="size-4" />
              </span>
              <span className="relative text-[15px] font-semibold text-[#fbf6ec]">{it.badge}</span>
            </button>
          )
        })}
      </div>
      <div className="relative min-h-[260px] overflow-hidden rounded-3xl border border-white/12 bg-[#08101e]/85 p-7 shadow-[0_30px_80px_-40px_#000] sm:p-9">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={current.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            <span className="flex size-12 items-center justify-center rounded-2xl bg-[#f0a35e]/15 text-[#f0a35e]">
              <Icon className="size-6" />
            </span>
            <h3 className="mt-5 font-display text-2xl font-bold text-[#fbf6ec] sm:text-[1.75rem]">{current.title}</h3>
            <p className="mt-3 max-w-lg text-base leading-relaxed text-[#f6efe2]/85">{current.desc}</p>
            <Link
              to={current.to}
              className="group relative mt-6 inline-flex items-center gap-1.5 overflow-hidden rounded-full border border-[#f0a35e]/35 bg-[#f0a35e]/10 px-4 py-2 text-sm font-semibold text-[#f0a35e] transition-all duration-300 hover:-translate-y-0.5 hover:border-[#f0a35e]"
            >
              <HoverSheen tone="subtle" />
              <span className="relative">{current.cta}</span>
              <ArrowRight className="relative size-4 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

/* ---------- small pieces ---------- */

function HoverSheen({ tone = "bright" }: { tone?: "bright" | "subtle" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 -translate-x-full transition-transform duration-700 group-hover:translate-x-full",
        tone === "bright" ? "bg-white/30" : "bg-white/15",
      )}
    />
  )
}

function DeckHeader({ go }: { go: (target: number | string) => void }) {
  const { t, i18n } = useTranslation()
  const currentLng = getLanguageOption(i18n.language).value
  const links: [string, string][] = [
    ["nen-tang", t("landing.deck.nav.platform")],
    ["trien-khai", t("landing.deck.nav.steps")],
    ["bang-gia", t("landing.nav.pricing")],
    ["hoi-dap", t("landing.nav.faq")],
  ]
  return (
    <header className="absolute inset-x-0 top-0 z-50 px-4 pt-4 sm:px-8 sm:pt-6">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 rounded-full border border-white/10 bg-[#060d1a]/75 py-2 pl-5 pr-2 text-[#f6efe2] shadow-[0_10px_40px_-20px_#000] backdrop-blur-md">
        <button
          type="button"
          onClick={() => go(0)}
          className="group relative flex items-center overflow-hidden rounded-full px-1.5 py-0.5 transition-transform duration-300 hover:-translate-y-0.5"
          aria-label="Stayra"
        >
          <HoverSheen tone="subtle" />
          <Logo tone="light" className="relative h-10" />
        </button>
        <nav className="hidden items-center gap-1 md:flex">
          {links.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => go(id)}
              className="group relative overflow-hidden rounded-full px-3.5 py-1.5 text-sm font-medium opacity-85 transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/10 hover:opacity-100"
            >
              <HoverSheen tone="subtle" />
              <span className="relative">{label}</span>
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <div role="radiogroup" aria-label={t("nav.language")} className="hidden items-center gap-0.5 rounded-full bg-white/[0.07] p-0.5 text-xs sm:inline-flex">
            {languageOptions.map(({ value, short, name }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={currentLng === value}
                aria-label={name}
                onClick={() => void i18n.changeLanguage(value)}
                className={cn(
                  "group relative overflow-hidden rounded-full px-2.5 py-1 font-semibold tracking-wide transition-all duration-300 hover:-translate-y-0.5",
                  currentLng === value ? "bg-white/18 text-[#fbf6ec]" : "text-[#f6efe2]/55 hover:text-[#fbf6ec]",
                )}
              >
                <HoverSheen tone="subtle" />
                <span className="relative">{short}</span>
              </button>
            ))}
          </div>
          <Link
            to="/login"
            className="group relative inline-flex items-center overflow-hidden rounded-full bg-[#f0a35e] px-4 py-2 text-sm font-semibold text-[#1a120a] shadow-[0_10px_28px_-10px_#f0a35e] transition-transform duration-300 hover:-translate-y-0.5"
          >
            <HoverSheen />
            <span className="relative">{t("landing.ownerPortal")}</span>
          </Link>
        </div>
      </div>
    </header>
  )
}

function PrimaryLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-[#f0a35e] px-6 py-3.5 text-[15px] font-semibold text-[#1a120a] shadow-[0_14px_40px_-12px_#f0a35e] transition-transform duration-300 hover:-translate-y-0.5"
    >
      <HoverSheen />
      <span className="relative">{children}</span>
      <ArrowRight className="relative size-4 transition-transform duration-300 group-hover:translate-x-1" />
    </Link>
  )
}

function GhostLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="group relative inline-flex items-center overflow-hidden rounded-full border border-white/30 bg-[#060d1a]/70 px-6 py-3.5 text-[15px] font-semibold text-[#fbf6ec] transition-all duration-300 hover:-translate-y-0.5 hover:border-[#f0a35e] hover:text-[#f0a35e]"
    >
      <HoverSheen tone="subtle" />
      <span className="relative">{children}</span>
    </Link>
  )
}

function Accent({ children }: { children: ReactNode }) {
  return <span style={{ color: AMBER }}>{children}</span>
}

function GlassCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-white/12 bg-[#08101e]/85 shadow-[0_20px_50px_-30px_#000] transition-all duration-300 hover:-translate-y-0.5 hover:border-[#f0a35e]/45",
        className,
      )}
    >
      <HoverSheen tone="subtle" />
      {children}
    </div>
  )
}

function BigStat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <StaggerItem>
      <GlassCard className="px-5 py-4">
        <p className="font-display text-[2.4rem] font-bold leading-none text-[#fbf6ec] sm:text-[2.9rem]">{children}</p>
        <p className="mt-2 text-[13px] font-medium leading-snug text-[#f6efe2]/80">{label}</p>
      </GlassCard>
    </StaggerItem>
  )
}

function PhotoCard({ img, tag, title }: { img: string; tag: string; title: string }) {
  return (
    <div className="group relative h-[320px] overflow-hidden rounded-[26px] border border-white/12 shadow-[0_30px_70px_-30px_#000] transition-all duration-300 hover:-translate-y-0.5 hover:border-[#f0a35e]/45 sm:h-[380px]">
      <img src={img} alt={title} loading="lazy" className="absolute inset-0 size-full object-cover transition-transform duration-[1.4s] ease-out group-hover:scale-110" />
      <span className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,12,24,0)_45%,rgba(6,12,24,0.88)_100%)]" />
      <HoverSheen tone="subtle" />
      <span className="relative z-10 ml-4 mt-4 inline-block rounded-full bg-[#060d1a]/80 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#f6b273]">{tag}</span>
      <h3 className="absolute inset-x-0 bottom-0 p-5 text-xl font-semibold text-white">{title}</h3>
    </div>
  )
}

function ScrollHint({ text }: { text: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 1.6, duration: 0.8 }}
      className="absolute bottom-8 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#f6efe2]/70 md:flex"
    >
      <span className="relative h-10 w-6 rounded-full border border-current">
        <motion.span
          className="absolute left-1/2 top-2 h-2 w-[2px] -translate-x-1/2 rounded-full bg-[#f0a35e]"
          animate={{ y: [0, 12, 0], opacity: [1, 0.2, 1] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        />
      </span>
      {text}
    </motion.div>
  )
}
