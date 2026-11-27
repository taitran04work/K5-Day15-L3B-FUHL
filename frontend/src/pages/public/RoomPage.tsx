import { Link, useNavigate, useParams, useSearchParams } from "react-router"
import { useTranslation } from "react-i18next"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/common"
import { AmenityList, Gallery, QuoteSummary } from "@/components/booking/BookingParts"
import { GuestStepper, HourPicker, ModeToggle, NightRangePicker, defaultStay, useBusy, type StayValue } from "@/components/booking/StayPicker"
import { api, ApiError } from "@/lib/api"
import { money } from "@/lib/format"
import type { BookingMode, Quote, Room } from "@/lib/types"
import { usePublic } from "./PublicLayout"

export function useStayFromParams(room: Room | undefined, openingTime: string): [StayValue, (s: StayValue) => void] {
  const [params, setParams] = useSearchParams()
  const mode = (params.get("mode") as BookingMode | null) ?? (room && !room.supportsNightly ? "Hourly" : "Nightly")
  const fallback = defaultStay(mode, openingTime)
  const stay: StayValue = {
    mode,
    start: params.get("start") ?? fallback.start,
    end: params.get("end") ?? fallback.end,
    guests: Number(params.get("guests") ?? Math.min(2, room?.maxGuests ?? 2)),
  }
  const set = (s: StayValue) => setParams({ mode: s.mode, start: s.start, end: s.end, guests: String(s.guests) }, { replace: true })
  return [stay, set]
}

export default function RoomPage() {
  const { home, slug } = usePublic()
  const { roomId = "" } = useParams()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const tenant = home.tenant
  const room = useQuery({ queryKey: ["public-room", slug, roomId], queryFn: () => api.get<Room>(`/api/public/${slug}/rooms/${roomId}`) })
  const [stay, setStay] = useStayFromParams(room.data, tenant.openingTime)
  const busy = useBusy(slug, roomId)

  const quote = useQuery({
    queryKey: ["quote", slug, roomId, stay],
    enabled: !!room.data,
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: () => api.post<{ quote: Quote; available: boolean }>(`/api/public/${slug}/quote`, { ...stay, roomId }),
  })

  if (room.isLoading)
    return (
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-10 sm:px-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[420px] w-full rounded-2xl" />
      </div>
    )
  if (room.error || !room.data)
    return (
      <div className="mx-auto max-w-xl px-4 py-20">
        <ErrorState error={room.error} onRetry={() => void room.refetch()} />
      </div>
    )

  const r = room.data
  const quoteError = quote.error instanceof ApiError ? quote.error.message : null
  const canBook = quote.data?.available && !quote.isFetching && !quote.error

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-6 sm:px-6">
      <Link to={`/h/${slug}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> {t("room.allRooms")}
      </Link>
      <h1 className="mt-3 text-xl sm:text-2xl">{r.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {[r.beds, t("room.upToGuests", { count: r.maxGuests }), r.areaM2 ? `${r.areaM2} m²` : null].filter(Boolean).join(" · ")}
      </p>

      <div className="mt-6">
        <Gallery photos={r.photos} title={r.name} />
      </div>

      <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_400px]">
        <div className="min-w-0 space-y-10">
          {r.description && <p className="max-w-2xl text-base leading-relaxed text-foreground/90">{r.description}</p>}
          {r.amenities.length > 0 && (
            <section className="border-t pt-8">
              <h2 className="text-lg">{t("room.amenities")}</h2>
              <AmenityList amenities={r.amenities} className="mt-5" />
            </section>
          )}
          <section className="border-t pt-8">
            <h2 className="text-lg">{t("room.pricesTitle")}</h2>
            <dl className="mt-5 grid max-w-md gap-3 text-sm">
              {r.supportsNightly && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t("room.nightlyRate")}</dt>
                  <dd className="tabular">{money(r.baseNightlyPrice)}</dd>
                </div>
              )}
              {r.supportsHourly && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t("room.hourlyRate", { count: r.minHours })}</dt>
                  <dd className="tabular">{money(r.baseHourlyPrice)}</dd>
                </div>
              )}
              {r.extraGuestFee > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">{t("room.extraGuest", { count: r.baseGuests })}</dt>
                  <dd className="tabular">{money(r.extraGuestFee)}</dd>
                </div>
              )}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">{t("room.pricesNote")}</p>
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:h-fit">
          <div className="space-y-4 rounded-xl border p-5 shadow-sm">
            <p className="text-base">
              <span className="font-semibold tabular">{money(r.supportsNightly && stay.mode === "Nightly" ? r.baseNightlyPrice : r.baseHourlyPrice)}</span>{" "}
              <span className="text-sm text-muted-foreground">{stay.mode === "Nightly" ? t("room.perNight") : t("room.perHour")}</span>
            </p>
            <ModeToggle
              value={stay.mode}
              nightly={r.supportsNightly}
              hourly={r.supportsHourly}
              onChange={(m) => setStay({ ...defaultStay(m, tenant.openingTime), guests: stay.guests })}
            />
            {stay.mode === "Nightly" ? (
              <NightRangePicker start={stay.start} end={stay.end} bookedNights={busy.data?.bookedNights} onChange={(s, e) => setStay({ ...stay, start: s, end: e })} />
            ) : (
              <HourPicker
                start={stay.start}
                end={stay.end}
                openingTime={tenant.openingTime}
                closingTime={tenant.closingTime}
                minHours={r.minHours}
                busy={busy.data?.busyRanges}
                onChange={(s, e) => setStay({ ...stay, start: s, end: e })}
              />
            )}
            <GuestStepper value={stay.guests} max={r.maxGuests} onChange={(g) => setStay({ ...stay, guests: g })} />

            <div className="min-h-[96px]">
              {quote.isLoading ? (
                <div className="space-y-2 pt-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ) : quoteError ? (
                <p className="rounded-md bg-muted px-3 py-2.5 text-sm text-muted-foreground">{quoteError}</p>
              ) : quote.data && !quote.data.available ? (
                <p className="rounded-md bg-muted px-3 py-2.5 text-sm text-muted-foreground">{t("room.notAvailable")}</p>
              ) : quote.data ? (
                <div className={quote.isFetching ? "opacity-60 transition-opacity" : ""}>
                  <QuoteSummary quote={quote.data.quote} />
                </div>
              ) : null}
            </div>

            <Button
              size="lg"
              className="w-full"
              disabled={!canBook}
              onClick={() => navigate(`/h/${slug}/book?room=${r.id}&mode=${stay.mode}&start=${stay.start}&end=${stay.end}&guests=${stay.guests}`)}
            >
              {t("room.reserve")}
            </Button>
            <p className="text-center text-xs text-muted-foreground">{t("room.reserveHint", { minutes: tenant.holdMinutes })}</p>
          </div>
        </aside>
      </div>
    </div>
  )
}
