import { Link } from "react-router"
import { useTranslation } from "react-i18next"
import {
  ArrowRight,
  Bot,
  CalendarRange,
  Check,
  FileCheck2,
  Globe,
  Inbox,
  Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface PlatformItem {
  id: string
  badge: string
  title: string
  desc: string
  bullets: string[]
  cta: string
  to: string
}

const iconMap: Record<string, typeof Globe> = {
  booking: Globe,
  ai: Bot,
  policy: FileCheck2,
  inbox: Inbox,
  calendar: CalendarRange,
}

export function PlatformShowcase({
  activeId,
  onChangeId,
}: {
  activeId: string
  onChangeId: (id: string) => void
}) {
  const { t } = useTranslation()
  const items = t("landing.platform.items", { returnObjects: true }) as PlatformItem[]
  const current = items.find((i) => i.id === activeId) ?? items[0]
  const CurrentIcon = iconMap[current.id] ?? Sparkles

  return (
    <section id="platform" className="scroll-mt-20 border-t bg-canvas py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-xs font-medium text-brand">
            <Sparkles className="size-3.5" />
            {t("landing.platform.eyebrow")}
          </span>
          <h2 className="mt-4 text-xl leading-tight sm:text-2xl">{t("landing.platform.title")}</h2>
          <p className="mt-3 text-base text-muted-foreground">{t("landing.platform.subtitle")}</p>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-12 lg:items-start">
          {/* Left selector list */}
          <div className="space-y-2 lg:col-span-5">
            {items.map((item) => {
              const Icon = iconMap[item.id] ?? Globe
              const active = item.id === current.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChangeId(item.id)}
                  className={cn(
                    "group relative flex w-full items-start gap-3.5 rounded-xl border p-4 text-left transition-all duration-200",
                    active
                      ? "border-brand/40 bg-background shadow-sm"
                      : "border-transparent bg-transparent hover:border-border hover:bg-background/70",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-lg border transition-colors duration-200",
                      active
                        ? "border-brand bg-brand text-brand-foreground"
                        : "bg-background text-muted-foreground group-hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-brand">
                        {item.badge}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm font-semibold text-foreground">{item.title}</p>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Right detail panel */}
          <div className="lg:col-span-7">
            <div
              key={current.id}
              className="animate-panel-enter overflow-hidden rounded-2xl border bg-background p-6 shadow-sm sm:p-8"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <CurrentIcon className="size-5" />
                </div>
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-brand">
                    {current.badge}
                  </span>
                  <h3 className="text-lg font-semibold text-foreground">{current.title}</h3>
                </div>
              </div>

              <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
                {current.desc}
              </p>

              <ul className="mt-6 space-y-3 border-t pt-6">
                {current.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-3 text-sm text-foreground">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
                      <Check className="size-3.5" />
                    </span>
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-7 flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-canvas p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="size-2 rounded-full bg-brand" />
                  <span>Pine Hill · Sea Breeze · Owner Portal</span>
                </div>
                <Button asChild size="sm" className="group">
                  <Link to={current.to}>
                    {current.cta}
                    <ArrowRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
