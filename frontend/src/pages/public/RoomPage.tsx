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
      <div className="mx-auto max-w-[1280px] space-y-6 px-4 py-10 sm:px-8">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-10 w-72" />
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
  const unitPrice = r.supportsNightly && stay.mode === "Nightly" ? r.baseNightlyPrice : r.baseHourlyPrice

  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-28 pt-8 sm:px-8 lg:pb-16">
      <Link
        to={`/h/${slug}`}
        className="group inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
        <span>{t("room.allRooms")}</span>
      </Link>

      <div className="mt-4 max-w-3xl">
        <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">{r.name}</h1>
        <p className="mt-2.5 text-sm text-muted-foreground sm:text-base">
          {[r.beds, t("room.upToGuests", { count: r.maxGuests }), r.areaM2 ? `${r.areaM2} m²` : null].filter(Boolean).join(" · ")}
        </p>
      </div>

      <div className="mt-8">
        <Gallery photos={r.photos} title={r.name} />
      </div>

      <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_400px] lg:gap-16">
        <div className="min-w-0 space-y-12">
          {r.description && (
            <p className="max-w-2xl text-base leading-relaxed text-foreground/90 sm:text-[17px]">{r.description}</p>
          )}

          {r.amenities.length > 0 && (
            <section className="border-t pt-10">
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("room.amenities")}</h2>
              <AmenityList amenities={r.amenities} className="mt-6" />
            </section>
          )}

          <section className="border-t pt-10">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("room.pricesTitle")}</h2>
            <dl className="mt-6 max-w-md divide-y border-y text-sm">
              {r.supportsNightly && (
                <div className="flex justify-between py-3.5">
                  <dt className="text-muted-foreground">{t("room.nightlyRate")}</dt>
                  <dd className="font-medium tabular">{money(r.baseNightlyPrice)}</dd>
                </div>
              )}
              {r.supportsHourly && (
                <div className="flex justify-between py-3.5">
                  <dt className="text-muted-foreground">{t("room.hourlyRate", { count: r.minHours })}</dt>
                  <dd className="font-medium tabular">{money(r.baseHourlyPrice)}</dd>
                </div>
              )}
              {r.extraGuestFee > 0 && (
                <div className="flex justify-between py-3.5">
                  <dt className="text-muted-foreground">{t("room.extraGuest", { count: r.baseGuests })}</dt>
                  <dd className="font-medium tabular">{money(r.extraGuestFee)}</dd>
                </div>
              )}
            </dl>
            <p className="mt-4 max-w-md text-xs leading-relaxed text-muted-foreground">{t("room.pricesNote")}</p>
          </section>
        </div>

        <aside id="booking-panel" className="scroll-mt-24 lg:sticky lg:top-24 lg:h-fit">
          <div className="space-y-4 rounded-2xl border bg-card p-6 shadow-[0_16px_40px_-24px_rgba(23,22,20,0.16)]">
            <div className="flex items-baseline justify-between gap-2 border-b pb-4">
              <p className="text-base">
                <span className="text-2xl font-semibold tabular text-foreground">{money(unitPrice)}</span>{" "}
                <span className="text-sm text-muted-foreground">{stay.mode === "Nightly" ? t("room.perNight") : t("room.perHour")}</span>
              </p>
            </div>

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

            <div className="min-h-[96px] rounded-xl bg-muted/60 p-4">
              {quote.isLoading ? (
                <div className="space-y-2.5">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ) : quoteError ? (
                <p className="text-sm text-muted-foreground">{quoteError}</p>
              ) : quote.data && !quote.data.available ? (
                <p className="text-sm text-muted-foreground">{t("room.notAvailable")}</p>
              ) : quote.data ? (
                <div className={quote.isFetching ? "opacity-60 transition-opacity" : ""}>
                  <QuoteSummary quote={quote.data.quote} />
                </div>
              ) : null}
            </div>

            <Button
              size="lg"
              className="h-11 w-full rounded-xl"
              disabled={!canBook}
              onClick={() => navigate(`/h/${slug}/book?room=${r.id}&mode=${stay.mode}&start=${stay.start}&end=${stay.end}&guests=${stay.guests}`)}
            >
              {t("room.reserve")}
            </Button>
            <p className="text-center text-xs leading-relaxed text-muted-foreground">{t("room.reserveHint", { minutes: tenant.holdMinutes })}</p>
          </div>
        </aside>
      </div>

      {/* Mobile fixed bottom bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-[var(--editorial-surface)]/95 px-4 py-3 backdrop-blur-md sm:pr-20 lg:hidden">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{t("room.fromPrice")}</p>
            <p className="truncate text-sm font-semibold tabular text-foreground">
              {money(quote.data?.quote.total ?? unitPrice)}{" "}
              <span className="font-normal text-muted-foreground">
                {quote.data?.quote
                  ? t("room.totalFor", {
                      units:
                        quote.data.quote.mode === "Nightly"
                          ? t("booking.nightsCount", { count: quote.data.quote.units })
                          : t("booking.hoursCount", { count: quote.data.quote.units }),
                    })
                  : stay.mode === "Nightly"
                    ? t("room.perNight")
                    : t("room.perHour")}
              </span>
            </p>
          </div>
          <Button
            type="button"
            className="shrink-0 rounded-xl px-5"
            onClick={() => document.getElementById("booking-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            {t("room.selectDates")}
          </Button>
        </div>
      </div>
    </div>
  )
}
