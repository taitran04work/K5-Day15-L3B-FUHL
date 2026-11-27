import { useState } from "react"
import { useSearchParams } from "react-router"
import { useTranslation } from "react-i18next"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { ListChecks, Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Page } from "@/components/layout/AppShell"
import { EmptyState, ErrorState, PageHeader, RowsSkeleton, StatusBadge } from "@/components/common"
import { BookingDrawer } from "@/components/app/BookingDrawer"
import { NewBookingDialog } from "@/components/app/NewBookingDialog"
import { api, qs } from "@/lib/api"
import { isoDate, money, nights, stayLabel } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Booking } from "@/lib/types"

const tabs = {
  upcoming: { status: "Hold,PendingDeposit,Confirmed", from: () => isoDate(new Date()) },
  inhouse: { status: "CheckedIn" },
  past: { status: "CheckedOut,NoShow" },
  cancelled: { status: "Cancelled,Expired" },
  all: {},
} as Record<string, { status?: string; from?: () => string }>

export default function Bookings() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const tab = params.get("tab") ?? "upcoming"
  const selected = params.get("b")
  const [q, setQ] = useState("")
  const [newOpen, setNewOpen] = useState(false)
  const cfg = tabs[tab] ?? tabs.upcoming

  const list = useQuery({
    queryKey: ["bookings", tab, q],
    placeholderData: keepPreviousData,
    queryFn: () =>
      api.get<{ total: number; items: { booking: Booking; hasPendingRequest: boolean }[] }>(
        `/api/app/bookings${qs({ status: cfg.status, from: cfg.from?.(), q, pageSize: 100 })}`,
      ),
  })
  const items = tab === "upcoming" ? [...(list.data?.items ?? [])].sort((a, b) => a.booking.startAt.localeCompare(b.booking.startAt)) : (list.data?.items ?? [])

  const setSelected = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set("b", id)
    else next.delete("b")
    setParams(next, { replace: true })
  }

  return (
    <Page>
      <PageHeader
        title={t("bookings.title")}
        description={t("bookings.description")}
        actions={
          <Button onClick={() => setNewOpen(true)}>
            <Plus /> {t("bookings.new")}
          </Button>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-1 flex flex-wrap gap-1 px-1" role="tablist">
          {Object.keys(tabs).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setParams({ tab: k }, { replace: true })}
              className={cn("whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground", tab === k && "bg-muted font-medium text-foreground")}
            >
              {t(`bookings.tab.${k}`)}
            </button>
          ))}
        </div>
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("bookings.search")} className="pl-9" aria-label={t("bookings.search")} />
        </div>
      </div>

      {list.isLoading ? (
        <RowsSkeleton />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title={q ? t("bookings.noResults") : t(`bookings.empty.${tab}`, { defaultValue: t("bookings.empty.all") })}
          description={q ? t("bookings.noResultsHint") : t("bookings.emptyHint")}
          action={
            q ? (
              <Button variant="outline" onClick={() => setQ("")}>
                {t("bookings.clearSearch")}
              </Button>
            ) : (
              <Button onClick={() => setNewOpen(true)}>
                <Plus /> {t("bookings.new")}
              </Button>
            )
          }
        />
      ) : (
        <>
        <ul className="divide-y rounded-xl border sm:hidden">
          {items.map(({ booking: b, hasPendingRequest }) => (
            <li key={b.id}>
              <button onClick={() => setSelected(b.id)} className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left">
                <span className="min-w-0">
                  <span className="block text-sm font-medium [overflow-wrap:anywhere]">{b.guestName}</span>
                  <span className="block text-xs text-muted-foreground">{b.roomName}</span>
                  <span className="block text-xs text-muted-foreground">{stayLabel(b.mode, b.startAt, b.endAt)}</span>
                  <span className="mt-1.5 flex flex-wrap gap-1.5">
                    <StatusBadge status={b.status} />
                    {hasPendingRequest && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">{t("bookings.needsDecision")}</span>}
                  </span>
                </span>
                <span className="shrink-0 text-right text-sm tabular">
                  {money(b.totalAmount)}
                  {b.balance > 0 && <span className="block text-xs text-muted-foreground">{t("overview.due", { amount: money(b.balance) })}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto rounded-xl border sm:block">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">{t("bookings.col.guest")}</th>
                <th className="px-4 py-2.5 font-medium">{t("bookings.col.room")}</th>
                <th className="px-4 py-2.5 font-medium">{t("bookings.col.stay")}</th>
                <th className="px-4 py-2.5 font-medium">{t("bookings.col.status")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("bookings.col.total")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("bookings.col.balance")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map(({ booking: b, hasPendingRequest }) => (
                <tr
                  key={b.id}
                  onClick={() => setSelected(b.id)}
                  onKeyDown={(e) => e.key === "Enter" && setSelected(b.id)}
                  tabIndex={0}
                  className={cn("cursor-pointer outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/60", selected === b.id && "bg-muted/60")}
                >
                  <td className="px-4 py-3">
                    <p className="font-medium">{b.guestName}</p>
                    <p className="font-mono text-xs text-muted-foreground">{b.code}</p>
                  </td>
                  <td className="px-4 py-3">{b.roomName}</td>
                  <td className="px-4 py-3">
                    <p>{stayLabel(b.mode, b.startAt, b.endAt)}</p>
                    <p className="text-xs text-muted-foreground">
                      {b.mode === "Nightly" ? t("booking.nightsCount", { count: nights(b.startAt, b.endAt) }) : t("bookings.hourly")} · {t(`source.${b.source}`)}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={b.status} />
                      {hasPendingRequest && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">{t("bookings.needsDecision")}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular">{money(b.totalAmount)}</td>
                  <td className={cn("px-4 py-3 text-right tabular", b.balance > 0 ? "" : "text-muted-foreground")}>{money(b.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
      <BookingDrawer id={selected} onOpenChange={(o) => !o && setSelected(null)} />
      <NewBookingDialog open={newOpen} onOpenChange={setNewOpen} onCreated={setSelected} />
    </Page>
  )
}
