import { useEffect, useRef, useState, type ReactNode } from "react"
import { Link } from "react-router"
import { useTranslation } from "react-i18next"
import {
  ArrowRight,
  Bot,
  Building2,
  CalendarRange,
  ChevronDown,
  Clock,
  FileCheck2,
  Globe,
  Home,
  LayoutDashboard,
  Menu,
  MessageSquare,
  ShieldCheck,
  Trees,
  Wallet,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { LanguageSwitch } from "@/components/LanguageSwitch"
import { cn } from "@/lib/utils"

type MenuId = "solutions" | "types" | "demos" | null

interface NavCardItem {
  title: string
  desc: string
  icon: ReactNode
  to?: string
  href?: string
  badge?: string
  onSelect?: () => void
}

function scrollToSection(id: string) {
  const el = document.getElementById(id)
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
}

export function LandingNavbar({ onSelectFeature }: { onSelectFeature?: (id: string) => void }) {
  const { t } = useTranslation()
  const [openMenu, setOpenMenu] = useState<MenuId>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [mobileAccordion, setMobileAccordion] = useState<MenuId>("solutions")
  const [scrolled, setScrolled] = useState(false)
  const closeTimer = useRef<number | null>(null)
  const navRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenMenu(null)
        setMobileOpen(false)
      }
    }
    const onPointerDown = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    window.addEventListener("keydown", onKey)
    document.addEventListener("mousedown", onPointerDown)
    return () => {
      window.removeEventListener("keydown", onKey)
      document.removeEventListener("mousedown", onPointerDown)
    }
  }, [])

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => setOpenMenu(null), 130)
  }

  const openDropdown = (id: MenuId) => {
    cancelClose()
    setOpenMenu(id)
  }

  const jumpToFeature = (featureId: string) => {
    setOpenMenu(null)
    setMobileOpen(false)
    onSelectFeature?.(featureId)
    scrollToSection("platform")
  }

  const solutions: NavCardItem[] = [
    {
      title: t("landing.nav.solBookingTitle"),
      desc: t("landing.nav.solBookingDesc"),
      icon: <Globe className="size-4" />,
      onSelect: () => jumpToFeature("booking"),
    },
    {
      title: t("landing.nav.solAiTitle"),
      desc: t("landing.nav.solAiDesc"),
      icon: <Bot className="size-4" />,
      onSelect: () => jumpToFeature("ai"),
    },
    {
      title: t("landing.nav.solPolicyTitle"),
      desc: t("landing.nav.solPolicyDesc"),
      icon: <FileCheck2 className="size-4" />,
      onSelect: () => jumpToFeature("policy"),
    },
    {
      title: t("landing.nav.solCalendarTitle"),
      desc: t("landing.nav.solCalendarDesc"),
      icon: <CalendarRange className="size-4" />,
      onSelect: () => jumpToFeature("calendar"),
    },
    {
      title: t("landing.nav.solPaymentsTitle"),
      desc: t("landing.nav.solPaymentsDesc"),
      icon: <Wallet className="size-4" />,
      onSelect: () => jumpToFeature("inbox"),
    },
  ]

  const propertyTypes: NavCardItem[] = [
    {
      title: t("landing.nav.typeHomestayTitle"),
      desc: t("landing.nav.typeHomestayDesc"),
      icon: <Home className="size-4" />,
      href: "#bento",
    },
    {
      title: t("landing.nav.typeFarmstayTitle"),
      desc: t("landing.nav.typeFarmstayDesc"),
      icon: <Trees className="size-4" />,
      href: "#bento",
    },
    {
      title: t("landing.nav.typeStudioTitle"),
      desc: t("landing.nav.typeStudioDesc"),
      icon: <Clock className="size-4" />,
      href: "#platform",
    },
    {
      title: t("landing.nav.typeChainTitle"),
      desc: t("landing.nav.typeChainDesc"),
      icon: <Building2 className="size-4" />,
      href: "#pricing",
    },
  ]

  const demos: NavCardItem[] = [
    {
      title: t("landing.nav.demoPineTitle"),
      desc: t("landing.nav.demoPineDesc"),
      icon: <Trees className="size-4" />,
      to: "/h/pine-hill",
      badge: "Live",
    },
    {
      title: t("landing.nav.demoSeaTitle"),
      desc: t("landing.nav.demoSeaDesc"),
      icon: <ShieldCheck className="size-4" />,
      to: "/h/sea-breeze",
      badge: "Live",
    },
    {
      title: t("landing.nav.demoZaloTitle"),
      desc: t("landing.nav.demoZaloDesc"),
      icon: <MessageSquare className="size-4" />,
      to: "/dev/zalo-simulator",
      badge: "Zalo",
    },
    {
      title: t("landing.nav.demoOwnerTitle"),
      desc: t("landing.nav.demoOwnerDesc"),
      icon: <LayoutDashboard className="size-4" />,
      to: "/login",
    },
  ]

  const renderItem = (item: NavCardItem) => {
    const inner = (
      <div className="group flex items-start gap-3 rounded-xl p-3 text-left transition-all duration-150 hover:bg-muted/80">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background text-brand shadow-xs transition-colors duration-150 group-hover:border-brand/30 group-hover:bg-brand group-hover:text-brand-foreground">
          {item.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground transition-colors group-hover:text-brand">
              {item.title}
            </span>
            {item.badge && (
              <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand">
                {item.badge}
              </span>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{item.desc}</p>
        </div>
        <ArrowRight className="mt-1 size-3.5 shrink-0 text-muted-foreground opacity-0 -translate-x-1 transition-all duration-150 group-hover:translate-x-0 group-hover:text-brand group-hover:opacity-100" />
      </div>
    )

    if (item.to) {
      return (
        <Link key={item.title} to={item.to} onClick={() => setOpenMenu(null)}>
          {inner}
        </Link>
      )
    }
    if (item.href) {
      const targetId = item.href.replace("#", "")
      return (
        <button
          key={item.title}
          type="button"
          className="w-full"
          onClick={() => {
            setOpenMenu(null)
            scrollToSection(targetId)
          }}
        >
          {inner}
        </button>
      )
    }
    return (
      <button key={item.title} type="button" className="w-full" onClick={item.onSelect}>
        {inner}
      </button>
    )
  }

  const triggerCls = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150",
      active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
    )

  return (
    <header
      ref={navRef}
      className={cn(
        "sticky top-0 z-40 border-b transition-all duration-200",
        scrolled
          ? "border-border/80 bg-background/90 shadow-xs backdrop-blur-md"
          : "border-transparent bg-background/80 backdrop-blur-sm",
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6 lg:gap-8">
          <Link to="/" className="group flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-xs font-bold tracking-tight text-brand-foreground shadow-xs transition-transform duration-200 group-hover:scale-105">
              S
            </span>
            <span className="text-base font-semibold tracking-tight text-foreground">Stayra</span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex" aria-label={t("nav.main")}>
            <div
              className="relative"
              onMouseEnter={() => openDropdown("solutions")}
              onMouseLeave={scheduleClose}
            >
              <button
                type="button"
                aria-expanded={openMenu === "solutions"}
                onClick={() => setOpenMenu(openMenu === "solutions" ? null : "solutions")}
                className={triggerCls(openMenu === "solutions")}
              >
                {t("landing.nav.solutions")}
                <ChevronDown
                  className={cn(
                    "size-3.5 transition-transform duration-200",
                    openMenu === "solutions" && "rotate-180",
                  )}
                />
              </button>
              <div
                className={cn(
                  "absolute left-0 top-full pt-2 transition-all duration-200 ease-out origin-top-left",
                  openMenu === "solutions"
                    ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
                    : "pointer-events-none -translate-y-1.5 scale-[0.98] opacity-0",
                )}
              >
                <div className="w-[620px] rounded-2xl border bg-popover p-3 shadow-xl">
                  <div className="px-3 pb-2 pt-1 text-xs font-medium text-muted-foreground">
                    {t("landing.nav.solutionsDesc")}
                  </div>
                  <div className="grid grid-cols-2 gap-1">{solutions.map(renderItem)}</div>
                </div>
              </div>
            </div>

            <div
              className="relative"
              onMouseEnter={() => openDropdown("types")}
              onMouseLeave={scheduleClose}
            >
              <button
                type="button"
                aria-expanded={openMenu === "types"}
                onClick={() => setOpenMenu(openMenu === "types" ? null : "types")}
                className={triggerCls(openMenu === "types")}
              >
                {t("landing.nav.propertyTypes")}
                <ChevronDown
                  className={cn(
                    "size-3.5 transition-transform duration-200",
                    openMenu === "types" && "rotate-180",
                  )}
                />
              </button>
              <div
                className={cn(
                  "absolute left-0 top-full pt-2 transition-all duration-200 ease-out origin-top-left",
                  openMenu === "types"
                    ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
                    : "pointer-events-none -translate-y-1.5 scale-[0.98] opacity-0",
                )}
              >
                <div className="w-[480px] rounded-2xl border bg-popover p-3 shadow-xl">
                  <div className="grid grid-cols-1 gap-1">{propertyTypes.map(renderItem)}</div>
                </div>
              </div>
            </div>

            <div
              className="relative"
              onMouseEnter={() => openDropdown("demos")}
              onMouseLeave={scheduleClose}
            >
              <button
                type="button"
                aria-expanded={openMenu === "demos"}
                onClick={() => setOpenMenu(openMenu === "demos" ? null : "demos")}
                className={triggerCls(openMenu === "demos")}
              >
                {t("landing.nav.demos")}
                <ChevronDown
                  className={cn(
                    "size-3.5 transition-transform duration-200",
                    openMenu === "demos" && "rotate-180",
                  )}
                />
              </button>
              <div
                className={cn(
                  "absolute left-0 top-full pt-2 transition-all duration-200 ease-out origin-top-left",
                  openMenu === "demos"
                    ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
                    : "pointer-events-none -translate-y-1.5 scale-[0.98] opacity-0",
                )}
              >
                <div className="w-[520px] rounded-2xl border bg-popover p-3 shadow-xl">
                  <div className="grid grid-cols-1 gap-1">{demos.map(renderItem)}</div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => scrollToSection("pricing")}
              className={triggerCls(false)}
            >
              {t("landing.nav.pricing")}
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("faq")}
              className={triggerCls(false)}
            >
              {t("landing.nav.faq")}
            </button>
          </nav>
        </div>

        <div className="flex items-center gap-2 sm:gap-2.5">
          <LanguageSwitch compact className="sm:hidden" />
          <LanguageSwitch className="hidden sm:inline-flex" />
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link to="/login">{t("auth.signIn")}</Link>
          </Button>
          <Button asChild size="sm" className="group hidden shadow-xs sm:inline-flex">
            <Link to="/h/pine-hill">
              {t("landing.nav.exploreDemo")}
              <ArrowRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          </Button>
          <button
            type="button"
            aria-label={t("nav.openMenu")}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
            className="inline-flex size-9 items-center justify-center rounded-lg border bg-background text-foreground transition-colors hover:bg-muted lg:hidden"
          >
            {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      {/* Mobile slide-down drawer */}
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-out lg:hidden",
          mobileOpen ? "grid-rows-[1fr] border-t opacity-100" : "pointer-events-none grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden bg-background/95 backdrop-blur-md">
          <div className="mx-auto max-w-7xl space-y-2 px-4 py-4">
            {[
              { id: "solutions" as const, label: t("landing.nav.solutions"), items: solutions },
              { id: "types" as const, label: t("landing.nav.propertyTypes"), items: propertyTypes },
              { id: "demos" as const, label: t("landing.nav.demos"), items: demos },
            ].map((section) => {
              const expanded = mobileAccordion === section.id
              return (
                <div key={section.id} className="rounded-xl border bg-card">
                  <button
                    type="button"
                    onClick={() => setMobileAccordion(expanded ? null : section.id)}
                    className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold"
                  >
                    {section.label}
                    <ChevronDown className={cn("size-4 transition-transform duration-200", expanded && "rotate-180")} />
                  </button>
                  <div
                    className={cn(
                      "grid transition-[grid-template-rows] duration-250 ease-out",
                      expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                    )}
                  >
                    <div className="overflow-hidden">
                      <div className="space-y-1 border-t px-2 py-2">
                        {section.items.map((item) =>
                          item.to ? (
                            <Link
                              key={item.title}
                              to={item.to}
                              onClick={() => setMobileOpen(false)}
                              className="flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-muted"
                            >
                              <span className="font-medium">{item.title}</span>
                              <ArrowRight className="size-3.5 text-muted-foreground" />
                            </Link>
                          ) : (
                            <button
                              key={item.title}
                              type="button"
                              onClick={() => {
                                setMobileOpen(false)
                                if (item.href) scrollToSection(item.href.replace("#", ""))
                                else item.onSelect?.()
                              }}
                              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"
                            >
                              <span className="font-medium">{item.title}</span>
                              <ArrowRight className="size-3.5 text-muted-foreground" />
                            </button>
                          ),
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}

            <div className="grid grid-cols-2 gap-2 pt-2">
              <Button asChild variant="outline" className="w-full" onClick={() => setMobileOpen(false)}>
                <Link to="/login">{t("auth.signIn")}</Link>
              </Button>
              <Button asChild className="w-full" onClick={() => setMobileOpen(false)}>
                <Link to="/h/pine-hill">{t("landing.nav.exploreDemo")}</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
