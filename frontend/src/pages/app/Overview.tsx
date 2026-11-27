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
import { BarSeries } from "@/components/app/BarSeries"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useInboxHub } from "@/lib/realtime"
import { money, number, shortDate, stayLabel } from "@/lib/format"
import type { Booking } from "@/lib/types"

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
              <span className="text-xs font-medium text-amber-700 tabular">{t("overview.due", { amount: money(b.balance) })}</span>
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
  const data = useQuery({ queryKey: ["overview"], queryFn: () => api.get<OverviewData>("/api/app/overview"), refetchInterval: 60_000 })
  useInboxHub({ bookingChanged: () => void qc.invalidateQueries({ queryKey: ["overview"] }) })

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
          {(d.pendingApprovals > 0 || d.needsAttention > 0) && (
            <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-amber-900">
                {[d.pendingApprovals > 0 && t("overview.pendingApprovals", { count: d.pendingApprovals }), d.needsAttention > 0 && t("overview.needsAttention", { count: d.needsAttention })]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <div className="flex gap-2">
                {d.pendingApprovals > 0 && (
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/app/bookings?tab=upcoming">{t("overview.review")}</Link>
                  </Button>
                )}
                {d.needsAttention > 0 && (
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/app/inbox">{t("overview.openInbox")}</Link>
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label={t("overview.occupancyToday")} value={`${Math.round(d.occupancyToday)}%`} hint={t("overview.inHouse", { count: d.inHouse, rooms: d.rooms })} />
            <Stat label={t("overview.occupancy7")} value={`${Math.round(d.occupancyNext7)}%`} hint={t("overview.next7Hint")} />
            <Stat label={t("overview.revenue30")} value={money(d.revenue30)} hint={t("overview.revenueHint")} />
            <Stat label={t("overview.botHandled", { count: d.bot.handledByBot })} value={t("overview.hoursSaved", { hours: number(d.bot.hoursSaved) })} hint={t("overview.botHint", { bookings: d.bot.bookings, conversations: d.bot.conversations })} />
          </div>

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

          <Section title={t("overview.revenueTitle")} description={t("overview.revenueDescription")}>
            {d.revenueSeries.every((p) => p.amount === 0) ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{t("overview.noRevenue")}</p>
            ) : (
              <BarSeries
                caption={t("overview.revenueTitle")}
                data={d.revenueSeries.map((p) => ({ key: p.date, label: shortDate(p.date + "T12:00:00+07:00"), value: p.amount }))}
                format={money}
                height={180}
              />
            )}
          </Section>
        </div>
      )}
      <BookingDrawer id={selected} onOpenChange={(o) => !o && setSelected(null)} />
    </Page>
  )
}
