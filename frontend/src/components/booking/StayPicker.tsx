import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { addDays, format, parseISO } from "date-fns"
import { enUS, vi } from "date-fns/locale"
import type { DateRange } from "react-day-picker"
import { CalendarDays, Minus, Plus } from "lucide-react"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { isoDate, shortDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { BookingMode } from "@/lib/types"

export interface StayValue {
  mode: BookingMode
  start: string // nightly: yyyy-MM-dd · hourly: yyyy-MM-ddTHH:mm (local)
  end: string
  guests: number
}

export function todayLocal() {
  return isoDate(new Date())
}

export function defaultStay(mode: BookingMode = "Nightly", openingTime = "07:00"): StayValue {
  const today = parseISO(todayLocal())
  if (mode === "Nightly") return { mode, start: format(addDays(today, 7), "yyyy-MM-dd"), end: format(addDays(today, 9), "yyyy-MM-dd"), guests: 2 }
  const day = format(addDays(today, 1), "yyyy-MM-dd")
  const h = Math.max(14, parseInt(openingTime))
  return { mode, start: `${day}T${String(h).padStart(2, "0")}:00`, end: `${day}T${String(h + 3).padStart(2, "0")}:00`, guests: 2 }
}

export function useBusy(slug: string, roomId?: string) {
  const from = todayLocal()
  return useQuery({
    queryKey: ["busy", slug, roomId, from],
    enabled: !!roomId,
    queryFn: () => api.get<{ bookedNights: string[]; busyRanges: { start: string; end: string }[] }>(`/api/public/${slug}/rooms/${roomId}/busy?from=${from}&days=120`),
  })
}

export function GuestStepper({ value, max, onChange, compact }: { value: number; max: number; onChange: (n: number) => void; compact?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className={cn("flex items-center justify-between gap-3", !compact && "rounded-md border px-3 py-1.5")}>
      {!compact && <span className="text-sm">{t("booking.guestsCount", { count: value })}</span>}
      <div className="flex items-center gap-1">
        <Button type="button" variant="outline" size="icon-sm" onClick={() => onChange(Math.max(1, value - 1))} disabled={value <= 1} aria-label={t("booking.fewerGuests")}>
          <Minus />
        </Button>
        <span className="w-8 text-center text-sm tabular" aria-live="polite">
          {value}
        </span>
        <Button type="button" variant="outline" size="icon-sm" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={t("booking.moreGuests")}>
          <Plus />
        </Button>
      </div>
    </div>
  )
}

export function ModeToggle({ value, onChange, nightly = true, hourly = true }: { value: BookingMode; onChange: (m: BookingMode) => void; nightly?: boolean; hourly?: boolean }) {
  const { t } = useTranslation()
  if (!(nightly && hourly)) return null
  return (
    <div role="radiogroup" aria-label={t("booking.stayType")} className="grid grid-cols-2 rounded-md bg-muted p-0.5 text-sm">
      {(["Nightly", "Hourly"] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={value === m}
          onClick={() => onChange(m)}
          className={cn("rounded-[6px] py-1.5 font-medium text-muted-foreground transition-colors", value === m && "bg-background text-foreground shadow-sm")}
        >
          {m === "Nightly" ? t("booking.byNight") : t("booking.byHour")}
        </button>
      ))}
    </div>
  )
}

/** Nightly date range picker with booked nights disabled. */
export function NightRangePicker({ start, end, bookedNights, onChange }: { start: string; end: string; bookedNights?: string[]; onChange: (start: string, end: string) => void }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [range, setRange] = useState<DateRange | undefined>({ from: parseISO(start), to: parseISO(end) })
  const booked = useMemo(() => new Set(bookedNights ?? []), [bookedNights])
  const today = parseISO(todayLocal())

  const disabled = (d: Date) => d < today || booked.has(format(d, "yyyy-MM-dd"))

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setRange({ from: parseISO(start), to: parseISO(end) })
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className="grid w-full grid-cols-2 overflow-hidden rounded-md border text-left hover:border-foreground/30">
          <span className="border-r px-3 py-2">
            <span className="block text-xs text-muted-foreground">{t("booking.checkIn")}</span>
            <span className="block text-sm font-medium">{shortDate(start + "T12:00:00+07:00", i18n.language)}</span>
          </span>
          <span className="px-3 py-2">
            <span className="block text-xs text-muted-foreground">{t("booking.checkOut")}</span>
            <span className="block text-sm font-medium">{shortDate(end + "T12:00:00+07:00", i18n.language)}</span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          numberOfMonths={typeof window !== "undefined" && window.innerWidth > 768 ? 2 : 1}
          selected={range}
          defaultMonth={range?.from}
          locale={i18n.language.startsWith("vi") ? vi : enUS}
          weekStartsOn={1}
          disabled={disabled}
          excludeDisabled
          onSelect={(r) => {
            setRange(r)
            if (r?.from && r.to && r.to > r.from) {
              onChange(format(r.from, "yyyy-MM-dd"), format(r.to, "yyyy-MM-dd"))
              setOpen(false)
            }
          }}
        />
        <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">{range?.from && !range.to ? t("booking.pickCheckOut") : t("booking.pickCheckIn")}</p>
      </PopoverContent>
    </Popover>
  )
}

/** Hourly: date + start time + duration within opening hours. */
export function HourPicker({ start, end, openingTime, closingTime, minHours, busy, onChange }: {
  start: string
  end: string
  openingTime: string
  closingTime: string
  minHours: number
  busy?: { start: string; end: string }[]
  onChange: (start: string, end: string) => void
}) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const day = start.slice(0, 10)
  const startHour = parseInt(start.slice(11, 13))
  const duration = Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 3_600_000))
  const openH = parseInt(openingTime)
  const closeH = closingTime === "00:00" ? 24 : parseInt(closingTime)
  const today = parseISO(todayLocal())

  const isBusy = (h: number, len: number) =>
    (busy ?? []).some((r) => {
      const s = `${day}T${String(h).padStart(2, "0")}:00`
      const e = h + len >= 24 ? `${format(addDays(parseISO(day), 1), "yyyy-MM-dd")}T00:00` : `${day}T${String(h + len).padStart(2, "0")}:00`
      return s < r.end && r.start < e
    })

  const hours = Array.from({ length: Math.max(0, closeH - minHours - openH + 1) }, (_, i) => openH + i)
  const durations = Array.from({ length: Math.max(0, closeH - startHour - minHours + 1) }, (_, i) => minHours + i)
  const build = (d: string, h: number, len: number) => {
    const s = `${d}T${String(h).padStart(2, "0")}:00`
    const e = h + len >= 24 ? `${format(addDays(parseISO(d), 1), "yyyy-MM-dd")}T00:00` : `${d}T${String(h + len).padStart(2, "0")}:00`
    onChange(s, e)
  }

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left hover:border-foreground/30">
            <CalendarDays className="size-4 text-muted-foreground" />
            <span>
              <span className="block text-xs text-muted-foreground">{t("booking.date")}</span>
              <span className="block text-sm font-medium">{shortDate(day + "T12:00:00+07:00", i18n.language)}</span>
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={parseISO(day)}
            defaultMonth={parseISO(day)}
            locale={i18n.language.startsWith("vi") ? vi : enUS}
            weekStartsOn={1}
            disabled={(d) => d < today}
            onSelect={(d) => {
              if (d) {
                build(format(d, "yyyy-MM-dd"), startHour, duration)
                setOpen(false)
              }
            }}
          />
        </PopoverContent>
      </Popover>
      <div className="grid grid-cols-2 gap-2">
        <Select value={String(startHour)} onValueChange={(v) => build(day, parseInt(v), Math.min(duration, closeH - parseInt(v)))}>
          <SelectTrigger className="w-full" aria-label={t("booking.startTime")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {hours.map((h) => (
              <SelectItem key={h} value={String(h)} disabled={isBusy(h, minHours)}>
                {String(h).padStart(2, "0")}:00
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(duration)} onValueChange={(v) => build(day, startHour, parseInt(v))}>
          <SelectTrigger className="w-full" aria-label={t("booking.duration")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {durations.map((d) => (
              <SelectItem key={d} value={String(d)} disabled={isBusy(startHour, d)}>
                {t("booking.hoursCount", { count: d })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {isBusy(startHour, duration) && <p className="text-xs text-destructive">{t("booking.slotTaken")}</p>}
    </div>
  )
}
