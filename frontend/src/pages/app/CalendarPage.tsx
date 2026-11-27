import { useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns"
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Page } from "@/components/layout/AppShell"
import { EmptyState, ErrorState, PageHeader } from "@/components/common"
import { BookingDrawer } from "@/components/app/BookingDrawer"
import { NewBookingDialog, type NewBookingPreset } from "@/components/app/NewBookingDialog"
import { api } from "@/lib/api"
import { isoDate, monthYear, time } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Booking } from "@/lib/types"

interface CalendarData {
  rooms: { id: string; name: string; code: string; supportsHourly: boolean }[]
  bookings: Booking[]
}

const tone: Record<string, string> = {
  Hold: "bg-amber-100 text-amber-900 border-amber-300 border-dashed dark:border-warning/40 dark:bg-warning/15 dark:text-warning",
  PendingDeposit: "bg-amber-100 text-amber-900 border-amber-300 dark:border-warning/40 dark:bg-warning/15 dark:text-warning",
  Confirmed: "bg-brand text-brand-foreground border-transparent",
  CheckedIn: "bg-foreground text-background border-transparent",
  CheckedOut: "bg-muted text-muted-foreground border-border",
  NoShow: "bg-red-50 text-red-800 border-red-200 dark:border-destructive/30 dark:bg-destructive/15 dark:text-destructive",
}

function localHour(iso: string) {
  const [h, m] = time(iso).split(":").map(Number)
  return h + m / 60
}

export default function CalendarPage() {
  const { t, i18n } = useTranslation()
  const [from, setFrom] = useState(() => format(addDays(parseISO(isoDate(new Date())), -2), "yyyy-MM-dd"))
  const [days, setDays] = useState(14)
  const [selected, setSelected] = useState<string | null>(null)
  const [preset, setPreset] = useState<NewBookingPreset | undefined>()
  const [newOpen, setNewOpen] = useState(false)
  const [drag, setDrag] = useState<{ roomId: string; start: number; end: number } | null>(null)
  const dragRef = useRef(drag)
  dragRef.current = drag

  const data = useQuery({
    queryKey: ["calendar", from, days],
    placeholderData: keepPreviousData,
    queryFn: () => api.get<CalendarData>(`/api/app/bookings/calendar?from=${from}&days=${days}`),
  })

  const start = parseISO(from)
  const dates = useMemo(() => Array.from({ length: days }, (_, i) => addDays(start, i)), [from, days]) // eslint-disable-line react-hooks/exhaustive-deps
  const today = isoDate(new Date())
  const locale = i18n.language.startsWith("vi") ? "vi-VN" : "en-GB"

  const position = (b: Booking) => {
    const s = differenceInCalendarDays(parseISO(isoDate(b.startAt)), start) + localHour(b.startAt) / 24
    const e = differenceInCalendarDays(parseISO(isoDate(b.endAt)), start) + localHour(b.endAt) / 24
    const left = Math.max(0, s)
    const right = Math.min(days, e)
    if (right <= 0 || left >= days) return null
    return { left: (left / days) * 100, width: ((right - left) / days) * 100, clippedStart: s < 0, clippedEnd: e > days }
  }

  const finishDrag = () => {
    const d = dragRef.current
    if (!d) return
    const a = Math.min(d.start, d.end)
    const b = Math.max(d.start, d.end) + 1
    setDrag(null)
    setPreset({ roomId: d.roomId, stay: { mode: "Nightly", start: format(addDays(start, a), "yyyy-MM-dd"), end: format(addDays(start, b), "yyyy-MM-dd"), guests: 2 } })
    setNewOpen(true)
  }

  return (
    <Page className="max-w-none">
      <PageHeader
        title={t("calendar.title")}
        description={t("calendar.description")}
        actions={
          <>
            <div className="flex items-center rounded-md border">
              <Button variant="ghost" size="icon-sm" onClick={() => setFrom(format(addDays(start, -7), "yyyy-MM-dd"))} aria-label={t("calendar.previous")}>
                <ChevronLeft />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setFrom(format(addDays(parseISO(today), -2), "yyyy-MM-dd"))}>
                {t("calendar.today")}
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => setFrom(format(addDays(start, 7), "yyyy-MM-dd"))} aria-label={t("calendar.next")}>
                <ChevronRight />
              </Button>
            </div>
            <div className="flex rounded-md border p-0.5 text-xs" role="radiogroup" aria-label={t("calendar.range")}>
              {[14, 21, 31].map((n) => (
                <button key={n} role="radio" aria-checked={days === n} onClick={() => setDays(n)} className={cn("rounded px-2.5 py-1 text-muted-foreground", days === n && "bg-muted font-medium text-foreground")}>
                  {t("calendar.days", { count: n })}
                </button>
              ))}
            </div>
            <Button onClick={() => { setPreset(undefined); setNewOpen(true) }}>
              <Plus /> {t("bookings.new")}
            </Button>
          </>
        }
      />

      {data.isLoading ? (
        <Skeleton className="h-[420px] w-full rounded-xl" />
      ) : data.error ? (
        <ErrorState error={data.error} onRetry={() => void data.refetch()} />
      ) : !data.data?.rooms.length ? (
        <EmptyState icon={<CalendarDays />} title={t("calendar.noRooms")} description={t("calendar.noRoomsHint")} />
      ) : (
        <>
          <p className="mb-3 text-sm font-medium">{monthYear(start)}</p>
          <div className="overflow-x-auto rounded-xl border" onPointerUp={finishDrag} onPointerLeave={() => drag && finishDrag()}>
            <div className="w-full [--room-column:7.5rem] sm:[--room-column:12.5rem]" style={{ minWidth: `calc(var(--room-column) + ${days * 44}px)` }}>
              <div className="sticky top-0 z-10 flex border-b bg-background">
                <div className="sticky left-0 z-10 w-(--room-column) shrink-0 border-r bg-background px-3 py-2 sm:px-4 text-xs text-muted-foreground">{t("calendar.room")}</div>
                <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` }}>
                  {dates.map((d) => {
                    const iso = format(d, "yyyy-MM-dd")
                    const weekend = d.getDay() === 0 || d.getDay() === 6
                    return (
                      <div key={iso} className={cn("border-r px-1 py-1.5 text-center last:border-r-0", weekend && "bg-muted/40", iso === today && "bg-brand-soft")}>
                        <p className="text-[11px] text-muted-foreground">{new Intl.DateTimeFormat(locale, { weekday: "short" }).format(d)}</p>
                        <p className={cn("text-sm tabular", iso === today && "font-semibold text-brand")}>{d.getDate()}</p>
                      </div>
                    )
                  })}
                </div>
              </div>
              {data.data.rooms.map((room) => {
                const bookings = data.data!.bookings.filter((b) => b.roomId === room.id)
                return (
                  <div key={room.id} className="flex border-b last:border-b-0">
                    <div className="sticky left-0 z-[1] w-(--room-column) shrink-0 border-r bg-background px-3 py-3 sm:px-4">
                      <p className="text-sm font-medium [overflow-wrap:anywhere]">{room.name}</p>
                      <p className="text-xs text-muted-foreground">{room.code}</p>
                    </div>
                    <div className="relative flex-1 select-none">
                      <div className="grid h-full" style={{ gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` }}>
                        {dates.map((d, i) => {
                          const inDrag = drag && drag.roomId === room.id && i >= Math.min(drag.start, drag.end) && i <= Math.max(drag.start, drag.end)
                          const weekend = d.getDay() === 0 || d.getDay() === 6
                          return (
                            <div
                              key={i}
                              className={cn("h-16 border-r last:border-r-0", weekend && "bg-muted/30", format(d, "yyyy-MM-dd") === today && "bg-brand-soft/60", inDrag && "bg-brand/15")}
                              onPointerDown={(e) => {
                                if (format(d, "yyyy-MM-dd") < today) return
                                e.preventDefault()
                                setDrag({ roomId: room.id, start: i, end: i })
                              }}
                              onPointerEnter={() => drag && drag.roomId === room.id && setDrag({ ...drag, end: i })}
                            />
                          )
                        })}
                      </div>
                      {bookings.map((b) => {
                        const pos = position(b)
                        if (!pos) return null
                        const hourly = b.mode === "Hourly"
                        return (
                          <button
                            key={b.id}
                            onClick={() => setSelected(b.id)}
                            onPointerDown={(e) => e.stopPropagation()}
                            title={`${b.guestName} · ${b.code}`}
                            className={cn(
                              "absolute flex items-center overflow-hidden rounded-md border px-2 text-left text-xs font-medium shadow-xs transition-opacity hover:opacity-90",
                              hourly ? "top-[38px] h-5" : "top-2.5 h-7",
                              tone[b.status] ?? tone.Confirmed,
                              pos.clippedStart && "rounded-l-none",
                              pos.clippedEnd && "rounded-r-none",
                            )}
                            style={{ left: `calc(${pos.left}% + 2px)`, width: `max(calc(${pos.width}% - 4px), ${hourly ? 22 : 10}px)` }}
                          >
                            <span className="truncate">{hourly ? `${time(b.startAt)} ${b.guestName}` : b.guestName}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            {(["Hold", "Confirmed", "CheckedIn", "CheckedOut"] as const).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className={cn("h-3 w-5 rounded-sm border", tone[s])} /> {t(`status.booking.${s}`)}
              </span>
            ))}
            <span className="ml-auto hidden sm:inline">{t("calendar.dragHint")}</span>
            <span className="sm:hidden">{t("calendar.swipeHint")}</span>
          </div>
        </>
      )}
      <BookingDrawer id={selected} onOpenChange={(o) => !o && setSelected(null)} />
      <NewBookingDialog open={newOpen} onOpenChange={setNewOpen} preset={preset} onCreated={setSelected} />
    </Page>
  )
}
