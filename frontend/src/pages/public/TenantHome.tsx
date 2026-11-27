import { useMemo, useState } from "react"
import { Link } from "react-router"
import { useTranslation } from "react-i18next"
import { useMutation } from "@tanstack/react-query"
import { MapPin } from "lucide-react"
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
  return (
    <Link to={`/h/${slug}/rooms/${room.id}${params}`} className="group block rounded-xl focus-visible:outline-offset-4">
      <PhotoTile url={room.coverUrl} alt={room.name} className="aspect-[4/3] w-full rounded-xl" />
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-medium">{room.name}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {[room.beds, t("room.upToGuests", { count: room.maxGuests }), room.areaM2 ? `${room.areaM2} m²` : null].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      <p className="mt-1.5 text-sm">
        {quote ? (
          <>
            <span className="font-semibold tabular">{money(quote.total)}</span>{" "}
            <span className="text-muted-foreground">
              {t("room.totalFor", { units: quote.mode === "Nightly" ? t("booking.nightsCount", { count: quote.units }) : t("booking.hoursCount", { count: quote.units }) })}
            </span>
          </>
        ) : room.supportsNightly ? (
          <>
            <span className="font-semibold tabular">{money(room.baseNightlyPrice)}</span> <span className="text-muted-foreground">{t("room.perNight")}</span>
            {room.supportsHourly && <span className="text-muted-foreground"> · {t("room.hourlyFrom", { price: money(room.baseHourlyPrice) })}</span>}
          </>
        ) : (
          <>
            <span className="font-semibold tabular">{money(room.baseHourlyPrice)}</span> <span className="text-muted-foreground">{t("room.perHour")}</span>
          </>
        )}
      </p>
    </Link>
  )
}

export default function TenantHome() {
  const { home, slug } = usePublic()
  const { t } = useTranslation()
  const { tenant, rooms, faqs, cancellation } = home
  const hasHourly = rooms.some((r) => r.supportsHourly)
  const [search, setSearch] = useState<StayValue>(() => defaultStay("Nightly", tenant.openingTime))

  const availability = useMutation({
    mutationFn: (s: StayValue) =>
      api.post<{ available: { room: Room; quote: Quote }[]; unavailable: { roomId: string; reason: string }[] }>(`/api/public/${slug}/availability`, s),
  })
  const searched = availability.data ? search : undefined
  const quotes = useMemo(() => new Map(availability.data?.available.map((a) => [a.room.id, a.quote]) ?? []), [availability.data])
  const shownRooms = availability.data ? rooms.filter((r) => quotes.has(r.id)) : rooms

  const mosaic = [tenant.coverImageUrl, ...rooms.map((r) => r.coverUrl)].filter(Boolean).slice(0, 5) as string[]

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <section className="pb-10 pt-8 sm:pt-12">
        <h1 className="text-xl sm:text-2xl">{tenant.name}</h1>
        {tenant.address && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="size-4" aria-hidden /> {tenant.address}
          </p>
        )}
        <div className="mt-6 grid gap-2 overflow-hidden rounded-2xl md:grid-cols-4 md:grid-rows-2" style={{ height: "min(60vw, 480px)" }}>
          <PhotoTile url={mosaic[0]} alt={tenant.name} className="size-full md:col-span-2 md:row-span-2" />
          {mosaic.slice(1, 5).map((u, i) => (
            <PhotoTile key={i} url={u} alt="" className="hidden size-full md:block" />
          ))}
        </div>
      </section>

      <section className="grid gap-10 border-b pb-12 lg:grid-cols-[1fr_380px]">
        <div className="max-w-2xl">
          <p className="text-base leading-relaxed text-foreground/90">{tenant.description}</p>
          <dl className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-muted-foreground">{t("public.checkIn")}</dt>
              <dd className="mt-1 text-base font-medium tabular">{t("public.fromTime", { time: tenant.checkInTime })}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">{t("public.checkOut")}</dt>
              <dd className="mt-1 text-base font-medium tabular">{t("public.byTime", { time: tenant.checkOutTime })}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">{t("public.deposit")}</dt>
              <dd className="mt-1 text-base font-medium">{t("public.depositValue", { percent: tenant.depositPercent })}</dd>
            </div>
          </dl>
        </div>

        <form
          className="h-fit space-y-3 rounded-xl border p-5 shadow-sm lg:sticky lg:top-24"
          onSubmit={(e) => {
            e.preventDefault()
            availability.mutate(search)
            document.getElementById("rooms")?.scrollIntoView({ behavior: "smooth" })
          }}
        >
          <p className="text-base font-semibold">{t("public.findRoom")}</p>
          {hasHourly && <ModeToggle value={search.mode} onChange={(m) => setSearch({ ...defaultStay(m, tenant.openingTime), guests: search.guests })} />}
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
          <GuestStepper value={search.guests} max={Math.max(1, ...rooms.map((r) => r.maxGuests))} onChange={(g) => setSearch({ ...search, guests: g })} />
          <Button type="submit" className="w-full" size="lg" disabled={availability.isPending}>
            {availability.isPending && <Spinner />} {t("public.checkAvailability")}
          </Button>
        </form>
      </section>

      <section id="rooms" className="scroll-mt-20 py-12">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg">{availability.data ? t("public.availableRooms") : t("public.ourRooms")}</h2>
            {availability.data && (
              <p className="mt-1 text-sm text-muted-foreground">{t("public.availableCount", { count: shownRooms.length })}</p>
            )}
          </div>
          {availability.data && (
            <Button variant="ghost" size="sm" onClick={() => availability.reset()}>
              {t("public.showAllRooms")}
            </Button>
          )}
        </div>
        {shownRooms.length === 0 ? (
          <EmptyState
            className="mt-6"
            title={t("public.noRoomsTitle")}
            description={t("public.noRoomsDescription")}
            action={<Button variant="outline" onClick={() => availability.reset()}>{t("public.showAllRooms")}</Button>}
          />
        ) : (
          <div className="mt-6 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {shownRooms.map((r) => (
              <RoomCard key={r.id} room={r} slug={slug} quote={quotes.get(r.id)} search={searched} />
            ))}
          </div>
        )}
      </section>

      {(cancellation || faqs.length > 0) && (
        <section className="grid gap-10 border-t py-12 lg:grid-cols-2">
          {cancellation && (
            <div>
              <h2 className="text-lg">{t("public.cancellationTitle")}</h2>
              <ul className="mt-5 divide-y rounded-xl border">
                {cancellation.rules.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                    <span>{r.label}</span>
                    <span className="font-medium tabular">
                      {r.refundPercent > 0
                        ? t("public.refundOf", { percent: r.refundPercent, of: r.appliesTo === "Deposit" ? t("public.ofDeposit") : t("public.ofTotal") })
                        : t("public.noRefund")}
                    </span>
                  </li>
                ))}
                <li className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                  <span>{t("public.noShow")}</span>
                  <span className="font-medium">{cancellation.noShowRefundPercent > 0 ? `${cancellation.noShowRefundPercent}%` : t("public.noRefund")}</span>
                </li>
              </ul>
              {cancellation.notes && <p className="mt-3 text-sm text-muted-foreground">{cancellation.notes}</p>}
            </div>
          )}
          {faqs.length > 0 && (
            <div>
              <h2 className="text-lg">{t("public.faqTitle")}</h2>
              <div className="mt-5 divide-y rounded-xl border">
                {faqs.map((f) => (
                  <details key={f.id} className="group px-4 py-3">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium">
                      {f.question}
                      <span className="text-muted-foreground transition-transform group-open:rotate-45" aria-hidden>
                        +
                      </span>
                    </summary>
                    <p className="mt-2 text-sm text-muted-foreground">{f.answer}</p>
                  </details>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {tenant.latitude && tenant.longitude && (
        <section className="border-t py-12">
          <h2 className="text-lg">{t("public.location")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{tenant.address}</p>
          <a
            className="mt-3 inline-block text-sm font-medium underline underline-offset-4"
            href={`https://www.google.com/maps/search/?api=1&query=${tenant.latitude},${tenant.longitude}`}
            target="_blank"
            rel="noreferrer"
          >
            {t("public.openInMaps")}
          </a>
        </section>
      )}
    </div>
  )
}
