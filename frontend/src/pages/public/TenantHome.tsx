import { useMemo, useState } from "react"
import { Link } from "react-router"
import { useTranslation } from "react-i18next"
import { useMutation } from "@tanstack/react-query"
import { ArrowRight, ImageOff, MapPin } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState, Spinner } from "@/components/common"
import { PhotoTile } from "@/components/booking/BookingParts"
import { GuestStepper, HourPicker, ModeToggle, NightRangePicker, defaultStay, type StayValue } from "@/components/booking/StayPicker"
import { api } from "@/lib/api"
import { money } from "@/lib/format"
import type { Quote, Room } from "@/lib/types"
import { usePublic } from "./PublicLayout"

function RoomCard({ room, slug, quote, search }: { room: Room; slug: string; quote?: Quote; search?: StayValue }) {
  const { t } = useTranslation()
  const params = search ? `?mode=${search.mode}&start=${search.start}&end=${search.end}&guests=${search.guests}` : ""

  const specParts = [
    room.beds,
    t("room.upToGuests", { count: room.maxGuests }),
    room.areaM2 ? `${room.areaM2} m²` : null,
    ...room.amenities.slice(0, 2).map((a) => t(`amenity.${a}`, { defaultValue: a.replace(/_/g, " ") })),
  ]
    .filter(Boolean)
    .slice(0, 3)

  return (
    <Link to={`/h/${slug}/rooms/${room.id}${params}`} className="group block focus-visible:outline-offset-4">
      <PhotoTile url={room.coverUrl} alt={room.name} className="aspect-[4/3] w-full rounded-xl" />
      <div className="mt-4 space-y-2">
        <h3 className="font-editorial text-2xl font-normal tracking-tight text-foreground transition-colors group-hover:text-brand">
          {room.name}
        </h3>
        <p className="text-sm text-muted-foreground">{specParts.join(" · ")}</p>
        <div className="flex items-baseline justify-between gap-4 pt-1">
          <p className="text-sm">
            {quote ? (
              <>
                <span className="text-base font-medium tabular text-foreground">{money(quote.total)}</span>{" "}
                <span className="text-muted-foreground">
                  {t("room.totalFor", {
                    units: quote.mode === "Nightly" ? t("booking.nightsCount", { count: quote.units }) : t("booking.hoursCount", { count: quote.units }),
                  })}
                </span>
              </>
            ) : room.supportsNightly ? (
              <>
                <span className="text-base font-medium tabular text-foreground">{money(room.baseNightlyPrice)}</span>{" "}
                <span className="text-muted-foreground">{t("room.perNight")}</span>
              </>
            ) : (
              <>
                <span className="text-base font-medium tabular text-foreground">{money(room.baseHourlyPrice)}</span>{" "}
                <span className="text-muted-foreground">{t("room.perHour")}</span>
              </>
            )}
          </p>
          <span className="inline-flex items-center gap-1 text-sm font-medium text-brand">
            {t("room.viewDetails")}
            <ArrowRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-1" />
          </span>
        </div>
      </div>
    </Link>
  )
}

export default function TenantHome() {
  const { home, slug } = usePublic()
  const { t } = useTranslation()
  const { tenant, rooms, faqs, cancellation } = home
  const hasHourly = rooms.some((r) => r.supportsHourly)
  const [search, setSearch] = useState<StayValue>(() => defaultStay("Nightly", tenant.openingTime))
  const [heroImgFailed, setHeroImgFailed] = useState(false)

  const availability = useMutation({
    mutationFn: (s: StayValue) =>
      api.post<{ available: { room: Room; quote: Quote }[]; unavailable: { roomId: string; reason: string }[] }>(`/api/public/${slug}/availability`, s),
  })
  const searched = availability.data ? search : undefined
  const quotes = useMemo(() => new Map(availability.data?.available.map((a) => [a.room.id, a.quote]) ?? []), [availability.data])
  const shownRooms = availability.data ? rooms.filter((r) => quotes.has(r.id)) : rooms

  const heroImage = tenant.coverImageUrl || rooms.find((r) => r.coverUrl)?.coverUrl || null
  const firstSentence = tenant.description ? tenant.description.split(/(?<=[.!?])\s+/)[0] : null

  return (
    <div>
      {/* Full-bleed Editorial Hero */}
      <section className="relative flex min-h-[70vh] flex-col justify-end overflow-hidden bg-[#1a1916] sm:min-h-[78vh]">
        {heroImage && !heroImgFailed ? (
          <img
            src={heroImage}
            alt={tenant.name}
            onError={() => setHeroImgFailed(true)}
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#23221d] via-[#1c1b17] to-[#13120f]">
            <div className="mx-auto flex max-w-[1280px] justify-end px-4 pt-24 sm:px-8">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] tracking-wide text-white/45">
                <ImageOff className="size-3.5" aria-hidden />
                <span>{t("public.noPhotosYet")}</span>
              </span>
            </div>
          </div>
        )}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-black/45"
        />

        <div className="relative z-10 mx-auto w-full max-w-[1280px] px-4 pb-10 pt-28 sm:px-8 sm:pb-14">
          <div className="max-w-2xl text-white">
            {tenant.address && (
              <p className="inline-flex items-center gap-1.5 text-xs tracking-widest text-white/80 uppercase">
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                <span>{tenant.address}</span>
              </p>
            )}
            <h1 className="mt-3 font-editorial text-4xl font-normal leading-[1.06] tracking-tight text-white sm:text-6xl">
              {tenant.name}
            </h1>
            {firstSentence && (
              <p className="mt-4 max-w-xl text-base leading-relaxed text-white/85 sm:text-lg">
                {firstSentence}
              </p>
            )}
          </div>

          {/* Compact floating search bar */}
          <form
            className="mt-8 rounded-2xl border border-white/15 bg-[var(--editorial-surface)]/95 p-3 text-foreground shadow-[0_24px_60px_-20px_rgba(0,0,0,0.45)] backdrop-blur-md sm:mt-10 sm:p-4"
            onSubmit={(e) => {
              e.preventDefault()
              availability.mutate(search)
              document.getElementById("rooms")?.scrollIntoView({ behavior: "smooth" })
            }}
          >
            {hasHourly && (
              <div className="mb-3 max-w-xs">
                <ModeToggle value={search.mode} onChange={(m) => setSearch({ ...defaultStay(m, tenant.openingTime), guests: search.guests })} />
              </div>
            )}
            <div className="grid gap-3 lg:grid-cols-[1.4fr_220px_auto] lg:items-center">
              <div>
                {search.mode === "Nightly" ? (
                  <NightRangePicker start={search.start} end={search.end} onChange={(s, e) => setSearch({ ...search, start: s, end: e })} />
                ) : (
                  <HourPicker
                    start={search.start}
                    end={search.end}
                    openingTime={tenant.openingTime}
                    closingTime={tenant.closingTime}
                    minHours={Math.min(...rooms.filter((r) => r.supportsHourly).map((r) => r.minHours))}
                    onChange={(s, e) => setSearch({ ...search, start: s, end: e })}
                  />
                )}
              </div>
              <div className="[&>div]:h-[54px] [&>div]:rounded-md">
                <GuestStepper value={search.guests} max={Math.max(1, ...rooms.map((r) => r.maxGuests))} onChange={(g) => setSearch({ ...search, guests: g })} />
              </div>
              <Button type="submit" size="lg" className="h-[54px] w-full rounded-xl px-7 lg:w-auto" disabled={availability.isPending}>
                {availability.isPending && <Spinner />} {t("public.checkAvailability")}
              </Button>
            </div>
          </form>
        </div>
      </section>

      {/* Quiet editorial facts strip */}
      <section className="mx-auto max-w-[1280px] px-4 py-14 sm:px-8 sm:py-16">
        <div className="grid gap-8 border-b pb-14 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-6">
            {tenant.description && (
              <p className="max-w-xl text-base leading-relaxed text-foreground/85">{tenant.description}</p>
            )}
          </div>
          <dl className="grid grid-cols-3 gap-6 lg:col-span-6">
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">{t("public.checkIn")}</dt>
              <dd className="mt-1.5 text-base font-medium tabular text-foreground">{t("public.fromTime", { time: tenant.checkInTime })}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">{t("public.checkOut")}</dt>
              <dd className="mt-1.5 text-base font-medium tabular text-foreground">{t("public.byTime", { time: tenant.checkOutTime })}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-muted-foreground">{t("public.deposit")}</dt>
              <dd className="mt-1.5 text-base font-medium text-foreground">{t("public.depositValue", { percent: tenant.depositPercent })}</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* Rooms Collection */}
      <section id="rooms" className="mx-auto max-w-[1280px] scroll-mt-24 px-4 pb-16 sm:px-8 sm:pb-24">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-editorial text-3xl font-normal tracking-tight sm:text-4xl">
              {availability.data ? t("public.availableRooms") : t("public.ourRooms")}
            </h2>
            {availability.data && (
              <p className="mt-2 text-sm text-muted-foreground">{t("public.availableCount", { count: shownRooms.length })}</p>
            )}
          </div>
          {availability.data && (
            <Button variant="outline" size="sm" onClick={() => availability.reset()}>
              {t("public.showAllRooms")}
            </Button>
          )}
        </div>

        {shownRooms.length === 0 ? (
          <EmptyState
            className="mt-8 bg-card"
            title={t("public.noRoomsTitle")}
            description={t("public.noRoomsDescription")}
            action={<Button variant="outline" onClick={() => availability.reset()}>{t("public.showAllRooms")}</Button>}
          />
        ) : (
          <div className="mt-10 grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
            {shownRooms.map((r) => (
              <RoomCard key={r.id} room={r} slug={slug} quote={quotes.get(r.id)} search={searched} />
            ))}
          </div>
        )}
      </section>

      {/* Cancellation & Good to Know */}
      {(cancellation || faqs.length > 0) && (
        <section className="mx-auto max-w-[1280px] border-t px-4 py-16 sm:px-8 sm:py-20">
          <div className="grid gap-14 lg:grid-cols-2">
            {cancellation && (
              <div>
                <h2 className="font-editorial text-2xl font-normal sm:text-3xl">{t("public.cancellationTitle")}</h2>
                <ul className="mt-6 divide-y border-y">
                  {cancellation.rules.map((r, i) => (
                    <li key={i} className="flex items-center justify-between gap-4 py-3.5 text-sm">
                      <span className="text-foreground/90">{r.label}</span>
                      <span className="font-medium tabular text-foreground">
                        {r.refundPercent > 0
                          ? t("public.refundOf", { percent: r.refundPercent, of: r.appliesTo === "Deposit" ? t("public.ofDeposit") : t("public.ofTotal") })
                          : t("public.noRefund")}
                      </span>
                    </li>
                  ))}
                  <li className="flex items-center justify-between gap-4 py-3.5 text-sm">
                    <span className="text-foreground/90">{t("public.noShow")}</span>
                    <span className="font-medium text-foreground">{cancellation.noShowRefundPercent > 0 ? `${cancellation.noShowRefundPercent}%` : t("public.noRefund")}</span>
                  </li>
                </ul>
                {cancellation.notes && <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{cancellation.notes}</p>}
              </div>
            )}

            {faqs.length > 0 && (
              <div>
                <h2 className="font-editorial text-2xl font-normal sm:text-3xl">{t("public.faqTitle")}</h2>
                <div className="mt-6 divide-y border-y">
                  {faqs.map((f) => (
                    <details key={f.id} className="group py-3.5">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-foreground">
                        <span>{f.question}</span>
                        <span className="text-lg leading-none text-muted-foreground transition-transform duration-200 group-open:rotate-45" aria-hidden>
                          +
                        </span>
                      </summary>
                      <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{f.answer}</p>
                    </details>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Location */}
      {tenant.latitude && tenant.longitude && (
        <section className="mx-auto max-w-[1280px] border-t px-4 py-14 sm:px-8 sm:py-16">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <h2 className="font-editorial text-2xl font-normal sm:text-3xl">{t("public.location")}</h2>
              {tenant.address && <p className="mt-2 text-sm text-muted-foreground">{tenant.address}</p>}
            </div>
            <a
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand underline decoration-brand/40 underline-offset-4 transition-colors hover:decoration-brand"
              href={`https://www.google.com/maps/search/?api=1&query=${tenant.latitude},${tenant.longitude}`}
              target="_blank"
              rel="noreferrer"
            >
              {t("public.openInMaps")}
              <ArrowRight className="size-3.5" />
            </a>
          </div>
        </section>
      )}
    </div>
  )
}
