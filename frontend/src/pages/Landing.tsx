import { useEffect, useState } from "react"
import { Link } from "react-router"
import { useTranslation } from "react-i18next"
import {
  ArrowRight,
  Clock,
  FileSpreadsheet,
  Globe,
  Layers,
  LayoutDashboard,
  Lock,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Trees,
  Wallet,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { LanguageSwitch } from "@/components/LanguageSwitch"
import { LandingNavbar } from "@/components/landing/LandingNavbar"
import { HeroProductPreview } from "@/components/landing/HeroProductPreview"
import { PlatformShowcase } from "@/components/landing/PlatformShowcase"
import { PricingAndFaq } from "@/components/landing/PricingAndFaq"
import { useBrand } from "@/lib/brand"

interface BentoCard {
  tag: string
  title: string
  body: string
}

interface StepItem {
  step: string
  title: string
  desc: string
}

export default function Landing() {
  const { t } = useTranslation()
  const [activeFeature, setActiveFeature] = useState("booking")
  useBrand("#1F5F4A")

  useEffect(() => {
    document.title = "Stayra — Hospitality OS & AI Concierge"
  }, [])

  const ecosystemItems = t("landing.ecosystemItems", { returnObjects: true }) as string[]
  const bentoCards = t("landing.bento.cards", { returnObjects: true }) as BentoCard[]
  const steps = t("landing.steps.items", { returnObjects: true }) as StepItem[]

  const bentoIcons = [Lock, Clock, Wallet, FileSpreadsheet, Globe, Layers]

  const trustPoints = [
    t("landing.trust.noCommission"),
    t("landing.trust.noDoubleBook"),
    t("landing.trust.exactPricing"),
    t("landing.trust.hostControl"),
  ]

  const demoCards = [
    {
      title: "Pine Hill Homestay",
      tag: t("landing.demos.pineTag"),
      desc: t("landing.demos.pineDesc"),
      to: "/h/pine-hill",
      icon: Trees,
      accent: "from-[#1f5f4a] to-[#2c7a60]",
    },
    {
      title: "Sea Breeze House",
      tag: t("landing.demos.seaTag"),
      desc: t("landing.demos.seaDesc"),
      to: "/h/sea-breeze",
      icon: ShieldCheck,
      accent: "from-[#1e4d6b] to-[#2b6b94]",
    },
    {
      title: "Zalo OA Simulator",
      tag: t("landing.demos.zaloTag"),
      desc: t("landing.demos.zaloDesc"),
      to: "/dev/zalo-simulator",
      icon: MessageSquare,
      accent: "from-[#0f5298] to-[#1a73e8]",
    },
    {
      title: "Owner & Inbox Portal",
      tag: t("landing.demos.ownerTag"),
      desc: t("landing.demos.ownerDesc"),
      to: "/login",
      icon: LayoutDashboard,
      accent: "from-[#18221e] to-[#2d4039]",
    },
  ]

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <LandingNavbar onSelectFeature={setActiveFeature} />

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden pb-16 pt-12 sm:pb-24 sm:pt-16 lg:pt-20">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(ellipse_75%_55%_at_50%_-10%,color-mix(in_oklab,#1F5F4A_11%,transparent),transparent)]"
          />

          <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-12 lg:items-center lg:gap-10 lg:px-8">
            <div className="lg:col-span-6">
              <span className="inline-flex items-center gap-2 rounded-full border bg-canvas px-3.5 py-1 text-xs font-medium text-brand shadow-2xs">
                <Sparkles className="size-3.5" />
                {t("landing.eyebrow")}
              </span>

              <h1 className="mt-5 text-[1.95rem] font-semibold leading-[1.14] tracking-tight sm:text-[2.65rem]">
                {t("landing.title")}
              </h1>

              <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
                {t("landing.subtitle")}
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button asChild size="lg" className="group shadow-sm">
                  <Link to="/h/pine-hill">
                    {t("landing.demoPine")}
                    <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="transition-colors hover:bg-canvas">
                  <Link to="/h/sea-breeze">{t("landing.demoSea")}</Link>
                </Button>
                <Button asChild size="lg" variant="ghost" className="text-muted-foreground hover:text-foreground">
                  <Link to="/login">{t("landing.ownerPortal")}</Link>
                </Button>
              </div>

              <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t pt-6 sm:grid-cols-2">
                {trustPoints.map((point) => (
                  <div key={point} className="flex items-center gap-2 text-xs font-medium text-muted-foreground sm:text-sm">
                    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
                      <span className="size-1.5 rounded-full bg-brand" />
                    </span>
                    <span>{point}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-6">
              <HeroProductPreview />
            </div>
          </div>
        </section>

        {/* Ecosystem & Integrations Bar */}
        <section className="border-y bg-canvas/80 py-8">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <p className="text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("landing.ecosystemTitle")}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
              {ecosystemItems.map((label) => (
                <div
                  key={label}
                  className="flex items-center justify-center rounded-xl border bg-background px-3 py-2.5 text-center text-xs font-medium text-foreground shadow-2xs transition-all duration-150 hover:-translate-y-0.5 hover:border-brand/35 hover:text-brand"
                >
                  {label}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Interactive 5-Pillar Platform Showcase */}
        <PlatformShowcase activeId={activeFeature} onChangeId={setActiveFeature} />

        {/* Reliability Bento Grid */}
        <section id="bento" className="scroll-mt-20 border-t bg-background py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <span className="inline-flex items-center rounded-full border bg-canvas px-3 py-1 text-xs font-medium text-brand">
                {t("landing.bento.eyebrow")}
              </span>
              <h2 className="mt-4 text-xl leading-tight sm:text-2xl">{t("landing.bento.title")}</h2>
              <p className="mt-3 text-base text-muted-foreground">{t("landing.bento.subtitle")}</p>
            </div>

            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {bentoCards.map((card, index) => {
                const Icon = bentoIcons[index % bentoIcons.length]
                return (
                  <div
                    key={card.title}
                    className="group rounded-2xl border bg-card p-6 transition-all duration-200 hover:-translate-y-1 hover:border-brand/35 hover:shadow-md"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand transition-colors duration-200 group-hover:bg-brand group-hover:text-brand-foreground">
                        <Icon className="size-4" />
                      </span>
                      <span className="rounded-full border bg-canvas px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {card.tag}
                      </span>
                    </div>
                    <h3 className="mt-5 text-base font-semibold text-foreground">{card.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{card.body}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* 3-Step Workflow */}
        <section className="border-t bg-canvas py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <span className="inline-flex items-center rounded-full border bg-background px-3 py-1 text-xs font-medium text-brand">
                {t("landing.steps.eyebrow")}
              </span>
              <h2 className="mt-4 text-xl leading-tight sm:text-2xl">{t("landing.steps.title")}</h2>
            </div>

            <div className="mt-12 grid gap-6 lg:grid-cols-3">
              {steps.map((item) => (
                <div
                  key={item.step}
                  className="group relative rounded-2xl border bg-background p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-sm"
                >
                  <span className="inline-flex rounded-lg bg-brand-soft px-2.5 py-1 text-xs font-semibold tabular text-brand">
                    {item.step}
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Live Demos Grid */}
        <section id="demos" className="scroll-mt-20 border-t bg-background py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <span className="inline-flex items-center rounded-full border bg-canvas px-3 py-1 text-xs font-medium text-brand">
                {t("landing.demos.eyebrow")}
              </span>
              <h2 className="mt-4 text-xl leading-tight sm:text-2xl">{t("landing.demos.title")}</h2>
              <p className="mt-3 text-base text-muted-foreground">{t("landing.demos.subtitle")}</p>
            </div>

            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {demoCards.map((demo) => {
                const Icon = demo.icon
                return (
                  <Link
                    key={demo.to}
                    to={demo.to}
                    className="group flex flex-col overflow-hidden rounded-2xl border bg-card transition-all duration-200 hover:-translate-y-1 hover:border-brand/40 hover:shadow-lg"
                  >
                    <div className={`flex h-28 items-end justify-between bg-gradient-to-br ${demo.accent} p-4 text-white`}>
                      <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-xs">
                        {demo.tag}
                      </span>
                      <Icon className="size-5 opacity-90 transition-transform duration-200 group-hover:scale-110" />
                    </div>
                    <div className="flex flex-1 flex-col p-5">
                      <h3 className="text-base font-semibold transition-colors group-hover:text-brand">{demo.title}</h3>
                      <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{demo.desc}</p>
                      <span className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold text-brand">
                        {t("landing.demos.openDemo")}
                        <ArrowRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-1" />
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        </section>

        <PricingAndFaq />

        {/* High-Trust Dark Conversion Band */}
        <section className="border-t bg-[#11241d] py-20 text-white">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 px-4 sm:px-6 lg:flex-row lg:items-center lg:px-8">
            <div className="max-w-2xl">
              <h2 className="text-xl font-semibold leading-tight text-white sm:text-2xl">
                {t("landing.cta.title")}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-white/75 sm:text-base">
                {t("landing.cta.subtitle")}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                asChild
                size="lg"
                className="group bg-white text-[#11241d] hover:bg-white/90"
              >
                <Link to="/h/pine-hill">
                  {t("landing.cta.primary")}
                  <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white"
              >
                <Link to="/login">{t("landing.cta.secondary")}</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      {/* Multi-Column SaaS Footer */}
      <footer className="border-t bg-background">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <Link to="/" className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-xs font-bold text-brand-foreground">
                  S
                </span>
                <span className="text-base font-semibold tracking-tight">Stayra</span>
              </Link>
              <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
                {t("landing.footer.tagline")}
              </p>
              <div className="mt-5">
                <LanguageSwitch />
              </div>
            </div>

            <div className="space-y-3 text-sm lg:col-span-3">
              <p className="font-semibold text-foreground">{t("landing.footer.colProduct")}</p>
              <ul className="space-y-2 text-muted-foreground">
                <li>
                  <a href="#platform" className="transition-colors hover:text-foreground">
                    {t("landing.nav.solBookingTitle")}
                  </a>
                </li>
                <li>
                  <a href="#platform" className="transition-colors hover:text-foreground">
                    {t("landing.nav.solAiTitle")}
                  </a>
                </li>
                <li>
                  <a href="#platform" className="transition-colors hover:text-foreground">
                    {t("landing.nav.solPolicyTitle")}
                  </a>
                </li>
                <li>
                  <a href="#pricing" className="transition-colors hover:text-foreground">
                    {t("landing.nav.pricing")}
                  </a>
                </li>
              </ul>
            </div>

            <div className="space-y-3 text-sm lg:col-span-3">
              <p className="font-semibold text-foreground">{t("landing.footer.colDemos")}</p>
              <ul className="space-y-2 text-muted-foreground">
                <li>
                  <Link to="/h/pine-hill" className="transition-colors hover:text-foreground">
                    Pine Hill Homestay
                  </Link>
                </li>
                <li>
                  <Link to="/h/sea-breeze" className="transition-colors hover:text-foreground">
                    Sea Breeze House
                  </Link>
                </li>
                <li>
                  <Link to="/dev/zalo-simulator" className="transition-colors hover:text-foreground">
                    Zalo OA Simulator
                  </Link>
                </li>
                <li>
                  <Link to="/login" className="transition-colors hover:text-foreground">
                    {t("landing.ownerPortal")}
                  </Link>
                </li>
              </ul>
            </div>

            <div className="space-y-3 text-sm lg:col-span-2">
              <p className="font-semibold text-foreground">{t("landing.footer.colSupport")}</p>
              <ul className="space-y-2 text-muted-foreground">
                <li>
                  <a href="#bento" className="transition-colors hover:text-foreground">
                    {t("landing.bento.eyebrow")}
                  </a>
                </li>
                <li>
                  <a href="#faq" className="transition-colors hover:text-foreground">
                    {t("landing.nav.faq")}
                  </a>
                </li>
                <li>
                  <Link to="/h/pine-hill/manage" className="transition-colors hover:text-foreground">
                    {t("public.manageBooking")}
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center">
            <span>© {new Date().getFullYear()} Stayra. {t("landing.footer.rights")}</span>
            <span>Hospitality OS · Direct Booking · AI Concierge</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
