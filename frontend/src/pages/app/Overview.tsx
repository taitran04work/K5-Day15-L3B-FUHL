import { useState } from "react"
import { Link } from "react-router"
import { useTranslation } from "react-i18next"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Page } from "@/components/layout/AppShell"
import { ErrorState, PageHeader, Section, Stat, StatusBadge } from "@/components/common"
import { BookingDrawer } from "@/components/app/BookingDrawer"
import { BarSeries, type SeriesChartMode } from "@/components/app/BarSeries"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useInboxHub } from "@/lib/realtime"
import { money, relative, shortDate, stayLabel } from "@/lib/format"
import type { Booking, ConversationSummary } from "@/lib/types"

interface OverviewData {
  date: string
  rooms: number
  checkIns: Booking[]
  checkOuts: Booking[]
  inHouse: number
  occupancyToday: number
  occupancyNext7: number
  revenue30: number
  revenueSeries: { date: string; amount: number }[]
  pendingApprovals: number
  needsAttention: number
  upcoming: Booking[]
  bot: { conversations: number; handledByBot: number; handedOff: number; botMessages: number; hoursSaved: number; bookings: number }
}

function BookingList({ items, empty, onOpen, kind }: { items: Booking[]; empty: string; onOpen: (id: string) => void; kind: "in" | "out" | "upcoming" }) {
  const { t } = useTranslation()
  if (!items.length) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>
  return (
    <ul className="-mx-2 divide-y">
      {items.map((b) => (
        <li key={b.id}>
          <button onClick={() => onOpen(b.id)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 rounded-md px-2 py-2.5 text-left hover:bg-muted/60">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{b.guestName}</p>
              <p className="text-xs text-muted-foreground">
                {b.roomName}{kind !== "upcoming" && ` · ${t("booking.guestsCount", { count: b.guests })}`}
              </p>
            </div>
            {kind === "out" && b.balance > 0 ? (
              <span className="text-xs font-medium text-amber-700 tabular dark:text-warning">{t("overview.due", { amount: money(b.balance) })}</span>
            ) : (
              <StatusBadge status={b.status} />
            )}
            {kind === "upcoming" && <p className="col-span-2 text-xs text-muted-foreground">{stayLabel(b.mode, b.startAt, b.endAt)}</p>}
          </button>
        </li>
      ))}
    </ul>
  )
}

export default function Overview() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [chartMode, setChartMode] = useState<SeriesChartMode>("line")
  const data = useQuery({ queryKey: ["overview"], queryFn: () => api.get<OverviewData>("/api/app/overview"), refetchInterval: 60_000 })
  const conversations = useQuery({
    queryKey: ["inbox", "list", ""],
    queryFn: () => api.get<ConversationSummary[]>("/api/app/inbox/conversations"),
    refetchInterval: 60_000,
  })
  useInboxHub({
    bookingChanged: () => void qc.invalidateQueries({ queryKey: ["overview"] }),
    messageAdded: () => void qc.invalidateQueries({ queryKey: ["inbox", "list"] }),
    conversationUpdated: () => {
      void qc.invalidateQueries({ queryKey: ["overview"] })
      void qc.invalidateQueries({ queryKey: ["inbox", "list"] })
    },
  })

  const recentGuests = [...(conversations.data ?? [])]
    .sort((a, b) => {
      if (a.needsAttention !== b.needsAttention) return a.needsAttention ? -1 : 1
      return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    })
    .slice(0, 2)

  const hour = new Date().getHours()
  const greeting = hour < 12 ? t("overview.morning") : hour < 18 ? t("overview.afternoon") : t("overview.evening")
  const firstName = user?.name ?? ""

  if (data.error) return <Page><ErrorState error={data.error} onRetry={() => void data.refetch()} /></Page>
  const d = data.data

  return (
    <Page>
      <PageHeader title={`${greeting}, ${firstName}`} description={d ? shortDate(d.date + "T12:00:00+07:00") : undefined} />
      {!d ? (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[92px] rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : (
        <div className="space-y-6">
          {d.pendingApprovals > 0 && (
            <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-warning/30 dark:bg-warning/10">
              <p className="text-sm text-amber-900 dark:text-warning">
                {t("overview.pendingApprovals", { count: d.pendingApprovals })}
              </p>
              <Button size="sm" variant="outline" asChild>
                <Link to="/app/bookings?tab=upcoming">{t("overview.review")}</Link>
              </Button>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label={t("overview.occupancyToday")} value={`${Math.round(d.occupancyToday)}%`} hint={t("overview.inHouse", { count: d.inHouse, rooms: d.rooms })} />
            <Stat label={t("overview.occupancy7")} value={`${Math.round(d.occupancyNext7)}%`} hint={t("overview.next7Hint")} />
            <Stat label={t("overview.revenue30")} value={money(d.revenue30)} hint={t("overview.revenueHint")} />
          </div>

          <Section
            title={t("overview.guestMessages")}
            actions={
              <div className="flex items-center gap-3">
                {d.needsAttention > 0 && (
                  <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-warning">
                    {t("overview.needsHelpCount", { count: d.needsAttention })}
                  </span>
                )}
                <Link to="/app/inbox" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                  {t("overview.viewMore")} <ArrowRight className="size-3.5" />
                </Link>
              </div>
            }
          >
            {recentGuests.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">{t("overview.noMessages")}</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {recentGuests.map((c) => {
                  const guestLabel = c.guestName || (c.channel === "Zalo" ? t("inbox.zaloGuest") : t("inbox.webGuest"))
                  return (
                    <Link
                      key={c.id}
                      to={`/app/inbox?c=${c.id}`}
                      className="flex flex-col justify-between gap-2 rounded-lg border bg-background/60 px-4 py-3 transition-colors hover:border-foreground/20 hover:bg-muted/50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                          {c.needsAttention && <span className="size-2 shrink-0 rounded-full bg-amber-500" />}
                          <span className="truncate">{guestLabel}</span>
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
                            {c.channel === "Zalo" ? "Zalo" : t("inbox.website")}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-subtle tabular">{relative(c.lastMessageAt)}</span>
                      </div>
                      {c.lastMessagePreview && (
                        <p className="line-clamp-1 text-sm text-muted-foreground">{c.lastMessagePreview}</p>
                      )}
                    </Link>
                  )
                })}
              </div>
            )}
          </Section>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Section title={t("overview.arrivals")} description={t("overview.arrivalsCount", { count: d.checkIns.length })}>
              <BookingList items={d.checkIns} empty={t("overview.noArrivals")} onOpen={setSelected} kind="in" />
            </Section>
            <Section title={t("overview.departures")} description={t("overview.departuresCount", { count: d.checkOuts.length })}>
              <BookingList items={d.checkOuts} empty={t("overview.noDepartures")} onOpen={setSelected} kind="out" />
            </Section>
            <Section
              title={t("overview.upcoming")}
              actions={
                <Link to="/app/bookings" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                  {t("overview.all")} <ArrowRight className="size-3.5" />
                </Link>
              }
            >
              <BookingList items={d.upcoming} empty={t("overview.noUpcoming")} onOpen={setSelected} kind="upcoming" />
            </Section>
          </div>

          <Section
            title={t("overview.revenueTitle")}
            description={t("overview.revenueDescription")}
            actions={
              <div role="tablist" aria-label={t("overview.revenueTitle")} className="inline-flex items-center rounded-lg border bg-muted/60 p-0.5 text-xs">
                {(
                  [
                    ["bar", t("overview.chartBar")],
                    ["line", t("overview.chartLine")],
                  ] as const
                ).map(([modeKey, label]) => {
                  const active = chartMode === modeKey
                  return (
                    <button
                      key={modeKey}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setChartMode(modeKey)}
                      className={cn(
                        "rounded-md px-3 py-1 font-medium transition-all",
                        active ? "bg-background text-foreground shadow-xs font-semibold" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            }
          >
            {d.revenueSeries.every((p) => p.amount === 0) ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{t("overview.noRevenue")}</p>
            ) : (
              <BarSeries
                caption={t("overview.revenueTitle")}
                mode={chartMode}
                data={d.revenueSeries.map((p) => ({
                  key: p.date,
                  label: shortDate(p.date + "T12:00:00+07:00"),
                  axisLabel: `${p.date.slice(8, 10)}/${p.date.slice(5, 7)}`,
                  value: p.amount,
                }))}
                format={money}
                height={190}
              />
            )}
          </Section>
        </div>
      )}
      <BookingDrawer id={selected} onOpenChange={(o) => !o && setSelected(null)} />
    </Page>
  )
}
