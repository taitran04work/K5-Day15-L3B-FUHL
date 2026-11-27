import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Bot, CalendarCheck2, CheckCircle2, Globe, LayoutDashboard, QrCode, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

type PreviewTab = "overview" | "booking" | "ai"

export function HeroProductPreview() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<PreviewTab>("overview")

  const tabs: { id: PreviewTab; label: string; icon: typeof LayoutDashboard }[] = [
    { id: "overview", label: t("landing.preview.tabOverview"), icon: LayoutDashboard },
    { id: "booking", label: t("landing.preview.tabBooking"), icon: Globe },
    { id: "ai", label: t("landing.preview.tabAi"), icon: Bot },
  ]

  const chartHeights = [32, 54, 42, 76, 64, 90, 72, 95, 58, 84, 70, 88]

  return (
    <div className="relative mx-auto w-full max-w-2xl lg:max-w-none">
      {/* Subtle decorative glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-tr from-brand/12 via-brand/4 to-transparent blur-2xl"
      />

      <div className="overflow-hidden rounded-2xl border border-border/90 bg-card shadow-[0_24px_60px_-24px_rgba(17,17,17,0.18)]">
        {/* Browser chrome + interactive tab switcher */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-canvas px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-border" />
            <span className="size-2.5 rounded-full bg-border" />
            <span className="size-2.5 rounded-full bg-border" />
            <span className="ml-2 hidden items-center gap-1.5 rounded-full border bg-background px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground sm:inline-flex">
              <span className="size-1.5 rounded-full bg-brand" />
              {t("landing.preview.liveBadge")}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-muted/80 p-1">
            {tabs.map((item) => {
              const Icon = item.icon
              const active = tab === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-150",
                    active
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className={cn("size-3.5", active && "text-brand")} />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Interactive preview canvas */}
        <div key={tab} className="animate-panel-enter p-4 sm:p-5">
          {tab === "overview" && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border bg-background p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-xs">
                  <p className="text-xs text-muted-foreground">{t("landing.preview.occLabel")}</p>
                  <p className="mt-1 text-lg font-semibold tabular text-foreground">{t("landing.preview.occValue")}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{t("landing.preview.occHint")}</p>
                </div>
                <div className="rounded-xl border bg-background p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-xs">
                  <p className="text-xs text-muted-foreground">{t("landing.preview.revLabel")}</p>
                  <p className="mt-1 text-lg font-semibold tabular text-foreground">{t("landing.preview.revValue")}</p>
                  <p className="mt-0.5 text-[11px] text-brand">{t("landing.preview.revHint")}</p>
                </div>
                <div className="rounded-xl border bg-background p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-xs">
                  <p className="text-xs text-muted-foreground">{t("landing.preview.aiLabel")}</p>
                  <p className="mt-1 text-lg font-semibold tabular text-foreground">{t("landing.preview.aiValue")}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{t("landing.preview.aiHint")}</p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-5">
                <div className="rounded-xl border bg-background p-3.5 sm:col-span-3">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs font-semibold">{t("overview.revenueTitle")}</span>
                    <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand">
                      0% OTA fee
                    </span>
                  </div>
                  <div className="flex h-24 items-end gap-1.5">
                    {chartHeights.map((h, idx) => (
                      <div
                        key={idx}
                        style={{ height: `${h}%` }}
                        className={cn(
                          "flex-1 rounded-t-sm transition-all duration-200 hover:opacity-80",
                          idx >= 9 ? "bg-brand" : "bg-brand/75",
                        )}
                      />
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border bg-background p-3.5 sm:col-span-2">
                  <p className="mb-2.5 text-xs font-semibold">{t("landing.preview.arrivalsTitle")}</p>
                  <div className="space-y-2">
                    <div className="flex items-start gap-2 rounded-lg border bg-canvas p-2 transition-colors hover:border-brand/30">
                      <CalendarCheck2 className="mt-0.5 size-3.5 shrink-0 text-brand" />
                      <p className="text-[11px] leading-snug text-foreground">{t("landing.preview.arrivalsItem1")}</p>
                    </div>
                    <div className="flex items-start gap-2 rounded-lg border bg-canvas p-2 transition-colors hover:border-brand/30">
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-brand" />
                      <p className="text-[11px] leading-snug text-foreground">{t("landing.preview.arrivalsItem2")}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === "booking" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-canvas px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">{t("landing.preview.bookingHeadline")}</p>
                  <p className="text-xs text-muted-foreground">{t("landing.preview.bookingSub")}</p>
                </div>
                <span className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground">
                  {t("landing.preview.checkAvail")}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { name: t("landing.preview.room1"), price: t("landing.preview.room1Price"), meta: "1 queen · 28 m² · Nightly & Hourly" },
                  { name: t("landing.preview.room2"), price: t("landing.preview.room2Price"), meta: "2 queen · 42 m² · Up to 5 guests" },
                ].map((room, i) => (
                  <div
                    key={room.name}
                    className="group overflow-hidden rounded-xl border bg-background transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-sm"
                  >
                    <div
                      className={cn(
                        "flex h-24 items-end p-3 text-white",
                        i === 0
                          ? "bg-gradient-to-br from-[#1f5f4a] via-[#2b725a] to-[#3f8b71]"
                          : "bg-gradient-to-br from-[#1b3a30] via-[#285446] to-[#3c7361]",
                      )}
                    >
                      <span className="rounded-full bg-black/30 px-2 py-0.5 text-[11px] backdrop-blur-xs">
                        {t("landing.preview.instantDeposit")}
                      </span>
                    </div>
                    <div className="p-3">
                      <p className="text-sm font-semibold">{room.name}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{room.meta}</p>
                      <p className="mt-2 text-xs font-semibold tabular text-brand">{room.price}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "ai" && (
            <div className="space-y-3 rounded-xl border bg-canvas p-3.5">
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-foreground px-3.5 py-2 text-xs text-background">
                  {t("landing.preview.chatGuest")}
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  <Sparkles className="size-3 text-brand" />
                  {t("landing.preview.chatTool1")}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  <Sparkles className="size-3 text-brand" />
                  {t("landing.preview.chatTool2")}
                </span>
              </div>

              <div className="max-w-[92%] space-y-2.5 rounded-2xl rounded-bl-sm border bg-background p-3.5 shadow-xs">
                <p className="text-xs leading-relaxed text-foreground">{t("landing.preview.chatBot")}</p>
                <div className="flex items-center justify-between gap-2 rounded-xl border bg-brand-soft/60 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <QrCode className="size-4 text-brand" />
                    <span className="text-xs font-semibold text-brand">{t("landing.preview.chatPayBtn")}</span>
                  </div>
                  <span className="rounded-md bg-brand px-2 py-0.5 text-[11px] font-medium text-brand-foreground">
                    MoMo
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
