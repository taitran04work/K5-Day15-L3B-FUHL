import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react"
import { Link } from "react-router"
import { useTranslation } from "react-i18next"
import { useMutation } from "@tanstack/react-query"
import { ArrowRight, BedDouble, Clock, Mail, MapPin, Phone, Users, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/common"
import { LanguageSwitch } from "@/components/LanguageSwitch"
import { Logo } from "@/components/Logo"
import { GuestStepper, HourPicker, ModeToggle, NightRangePicker, defaultStay, type StayValue } from "@/components/booking/StayPicker"
import { SlideDeck, type DeckSlide } from "@/components/landing/deck/SlideDeck"
import { CountUp } from "@/components/motion/CountUp"
import { Reveal, SplitWords, Stagger, StaggerItem } from "@/components/motion/Reveal"
import { api } from "@/lib/api"
import { money } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { PublicHome, PublicTenant, Quote, Room } from "@/lib/types"
import { usePublic } from "./PublicLayout"

const ChatWidget = lazy(() => import("@/components/chat/ChatWidget").then((m) => ({ default: m.ChatWidget })))

type Availability = { available: { room: Room; quote: Quote }[]; unavailable: { roomId: string; reason: string }[] }

const goto = (id: string) => window.dispatchEvent(new CustomEvent("deck:goto", { detail: id }))
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/* ---------- chrome (same language as the Stayra landing, in the tenant's accent) ---------- */

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <Reveal direction="up" distance={14} blur={false}>
      <span className="legible inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.26em] text-white/85">
        <span className="h-px w-8 bg-brand" />
        {children}
      </span>
    </Reveal>
  )
}

function H2({ children, className }: { children: string; className?: string }) {
  return (
    <h2 className={cn("legible mt-5 font-display text-[2.1rem] font-bold leading-[1.08] text-[#fbf6ec] sm:text-[3.1rem]", className)}>
      <SplitWords text={children} />
    </h2>
  )
}

const SCRIM = {
  left: "bg-[linear-gradient(90deg,rgba(6,8,12,0.88)_0%,rgba(6,8,12,0.6)_42%,rgba(6,8,12,0.1)_75%)]",
  bottom: "bg-[linear-gradient(0deg,rgba(6,8,12,0.92)_0%,rgba(6,8,12,0.55)_45%,rgba(6,8,12,0.2)_100%)]",
  full: "bg-[rgba(6,8,12,0.62)]",
}

function Frame({ children, scrim = "left", className }: { children: ReactNode; scrim?: keyof typeof SCRIM; className?: string }) {
  return (
    <div className="relative min-h-dvh">
      <div aria-hidden className={cn("pointer-events-none absolute inset-0 max-md:bg-[rgba(6,8,12,0.7)]", SCRIM[scrim])} />
      <div className={cn("relative flex min-h-dvh items-center px-5 pb-24 pt-28 text-[#f6efe2] sm:px-10 lg:px-20", className)}>{children}</div>
    </div>
  )
}

function Glass({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl border border-white/12 bg-[#0b0f16]/82 shadow-[0_24px_60px_-30px_#000]", className)}>{children}</div>
}

/* ---------- photo backdrop: one photo per slide, cross-faded and drifting with the scroll ---------- */

function PhotoBackdrop({ images, progress }: { images: string[]; progress: RefObject<number> }) {
  const layers = useRef<(HTMLDivElement | null)[]>([])
  // only the current slide's photo and its neighbours are downloaded (covers can be >1 MB)
  const [wanted, setWanted] = useState<ReadonlySet<number>>(() => new Set([0, 1]))
  useEffect(() => {
    let raf = 0
    let lastNear = 0
    const tick = (t: number) => {
      const p = progress.current
      const r = Math.round(p)
      if (r !== lastNear) {
        lastNear = r
        // once requested, a photo stays mounted so going back never re-downloads it
        setWanted((prev) => (prev.has(r - 1) && prev.has(r) && prev.has(r + 1) ? prev : new Set([...prev, r - 1, r, r + 1])))
      }
      layers.current.forEach((el, i) => {
        if (!el) return
        const d = p - i
        const o = clamp01(1 - Math.abs(d))
        if (o < 0.002) {
          // hidden layers cost nothing: no per-frame writes
          if (el.style.visibility !== "hidden") {
            el.style.visibility = "hidden"
            el.style.opacity = "0"
          }
          return
        }
        el.style.visibility = ""
        el.style.opacity = String(o)
        // slow Ken Burns drift + a little parallax as the slide hands over
        const zoom = 1.06 + Math.abs(d) * 0.1 + Math.sin(t / 7000 + i) * 0.025
        el.style.transform = `translate3d(0, ${(-d * 7).toFixed(2)}%, 0) scale(${zoom.toFixed(4)})`
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [progress, images.length])

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden bg-[#0b0f14]">
      {images.map((src, i) => (
        <div
          key={`${i}-${src}`}
          ref={(el) => {
            layers.current[i] = el
          }}
          className="absolute inset-[-4%] will-change-transform"
          style={{ opacity: i === 0 ? 1 : 0, visibility: i === 0 ? undefined : "hidden" }}
        >
          {src ? (
            wanted.has(i) && <img src={src} alt="" decoding="async" fetchPriority={i === 0 ? "high" : "low"} className="size-full object-cover" />
          ) : (
            <div className="size-full bg-[radial-gradient(70%_60%_at_60%_30%,color-mix(in_oklab,var(--brand)_45%,#0b0f14)_0%,#0b0f14_75%)]" />
          )}
        </div>
      ))}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,8,12,0.55)_0%,transparent_18%,transparent_80%,rgba(6,8,12,0.6)_100%)]" />
    </div>
  )
}

/* ---------- page ---------- */

export default function TenantHome() {
  const { home, slug } = usePublic()
  const { t } = useTranslation()
  const progress = useRef(0)
  const { tenant, rooms } = home
  // search results are page-scoped: never carry them over to another property or visit
  useEffect(() => () => publishSearch(null), [slug])

  const images = useMemo(() => {
    const roomPhotos = rooms.flatMap((r) => [r.coverUrl, ...r.photos.map((p) => p.url)]).filter((u): u is string => !!u)
    const unique = [...new Set([tenant.coverImageUrl, ...roomPhotos].filter((u): u is string => !!u))]
    // one per slide, cycling if the property has few photos
    return Array.from({ length: 5 }, (_, i) => unique.length ? unique[i % unique.length] : "")
  }, [rooms, tenant.coverImageUrl])

  // Slides only depend on the data + language. Interactive parts (search, accordions) keep
  // their own state, so using them never rebuilds the deck.
  const slides: DeckSlide[] = useMemo(() => {
    const list: DeckSlide[] = [
      { id: "top", label: t("public.deck.navHome"), tone: "dark", content: <HeroSlide home={home} slug={slug} /> },
      { id: "gioi-thieu", label: t("public.deck.navAbout"), tone: "dark", content: <AboutSlide home={home} /> },
      { id: "rooms", label: t("public.deck.navRooms"), tone: "dark", content: <RoomsSlide home={home} slug={slug} /> },
    ]
    if (home.cancellation || home.faqs.length > 0) list.push({ id: "chinh-sach", label: t("public.deck.navPolicies"), tone: "dark", content: <PoliciesSlide home={home} /> })
    list.push({ id: "lien-he", label: t("public.deck.navContact"), tone: "dark", content: <ContactSlide tenant={tenant} slug={slug} /> })
    return list
  }, [home, slug, t, tenant])

  return (
    <SlideDeck
      slides={slides}
      progress={progress}
      background={<PhotoBackdrop images={images} progress={progress} />}
      header={({ go }) => <TenantHeader tenant={tenant} slug={slug} go={go} />}
    />
  )
}

/* ---------- shared search state between the hero form and the rooms slide ---------- */

let lastSearch: { stay: StayValue; result: Availability } | null = null
const searchListeners = new Set<() => void>()
function publishSearch(v: typeof lastSearch) {
  lastSearch = v
  searchListeners.forEach((l) => l())
}
function useLastSearch() {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    searchListeners.add(l)
    return () => {
      searchListeners.delete(l)
    }
  }, [])
  return lastSearch
}

/* ---------- 01 hero ---------- */

function HeroSlide({ home, slug }: { home: PublicHome; slug: string }) {
  const { t } = useTranslation()
  const { tenant, rooms } = home
  const hasHourly = rooms.some((r) => r.supportsHourly)
  const [search, setSearch] = useState<StayValue>(() => defaultStay("Nightly", tenant.openingTime))
  const availability = useMutation({
    mutationFn: (s: StayValue) => api.post<Availability>(`/api/public/${slug}/availability`, s),
    onSuccess: (result, stay) => {
      publishSearch({ stay, result })
      goto("rooms")
    },
  })
  const firstSentence = tenant.description ? tenant.description.split(/(?<=[.!?])\s+/)[0] : null
  const nightly = rooms.filter((r) => r.supportsNightly).map((r) => r.baseNightlyPrice)
  const fromPrice = nightly.length ? Math.min(...nightly) : null

  return (
    <Frame scrim="bottom" className="items-end">
      <div className="mx-auto w-full max-w-[1200px]">
        <div className="max-w-3xl">
          {tenant.address && (
            <Reveal direction="up" distance={14} blur={false}>
              <p className="legible inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-white/85">
                <MapPin className="size-4 text-brand" />
                {tenant.address}
              </p>
            </Reveal>
          )}
          <h1 className="legible mt-4 font-display text-[2.8rem] font-bold leading-[1.02] text-white sm:text-[4.4rem] lg:text-[5.4rem]">
            <SplitWords text={tenant.name} />
          </h1>
          {firstSentence && (
            <Reveal delay={0.3}>
              <p className="legible mt-4 max-w-xl text-base font-medium leading-relaxed text-white/90 sm:text-lg">{firstSentence}</p>
            </Reveal>
          )}
        </div>

        <Reveal delay={0.45}>
          <form
            className="mt-8 rounded-2xl border border-white/20 bg-[var(--editorial-surface)]/95 p-3 text-foreground shadow-[0_30px_80px_-30px_rgba(0,0,0,0.7)] sm:p-4"
            onSubmit={(e) => {
              e.preventDefault()
              availability.mutate(search)
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
              <Button type="submit" size="lg" className="h-[54px] w-full rounded-xl px-7 text-[15px] lg:w-auto" disabled={availability.isPending}>
                {availability.isPending && <Spinner />} {t("public.checkAvailability")}
              </Button>
            </div>
          </form>
        </Reveal>

        <Stagger delay={0.6} className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <HeroStat icon={BedDouble} label={t("public.deck.roomsCount")}>
            <CountUp to={rooms.length} delay={0.8} />
          </HeroStat>
          <HeroStat icon={Users} label={t("public.deck.maxGuests")}>
            <CountUp to={Math.max(1, ...rooms.map((r) => r.maxGuests))} delay={0.9} />
          </HeroStat>
          {fromPrice != null && (
            <HeroStat icon={Wallet} label={t("public.deck.fromPrice")}>
              {money(fromPrice)}
            </HeroStat>
          )}
          <HeroStat icon={Clock} label={t("public.deck.deposit")}>
            <CountUp to={tenant.depositPercent} delay={1} />%
          </HeroStat>
        </Stagger>
      </div>
    </Frame>
  )
}

function HeroStat({ icon: Icon, label, children }: { icon: typeof BedDouble; label: string; children: ReactNode }) {
  return (
    <StaggerItem>
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-black/45 text-white">
          <Icon className="size-5" />
        </span>
        <div>
          <p className="legible font-display text-2xl font-bold leading-none text-white">{children}</p>
          <p className="legible mt-1 text-xs font-medium text-white/80">{label}</p>
        </div>
      </div>
    </StaggerItem>
  )
}

/* ---------- 02 about ---------- */

function AboutSlide({ home }: { home: PublicHome }) {
  const { t } = useTranslation()
  const { tenant, rooms } = home
  const photos = useMemo(
    () => [...new Set(rooms.flatMap((r) => [r.coverUrl, ...r.photos.map((p) => p.url)]).filter((u): u is string => !!u))].slice(1, 4),
    [rooms],
  )
  return (
    <Frame scrim="left">
      <div className="mx-auto grid w-full max-w-[1200px] items-center gap-10 lg:grid-cols-[1fr_1fr]">
        <div>
          <Eyebrow>{t("public.deck.welcome")} {tenant.name}</Eyebrow>
          <H2>{t("public.deck.aboutTitle")}</H2>
          {tenant.description && (
            <Reveal delay={0.25}>
              <p className="legible mt-5 line-clamp-5 max-w-xl text-base font-medium leading-relaxed text-white/90 sm:text-lg">{tenant.description}</p>
            </Reveal>
          )}
          <Stagger delay={0.4} className="mt-8 grid max-w-xl grid-cols-3 gap-3">
            {[
              [t("public.checkIn"), t("public.fromTime", { time: tenant.checkInTime })],
              [t("public.checkOut"), t("public.byTime", { time: tenant.checkOutTime })],
              [t("public.deposit"), `${tenant.depositPercent}%`],
            ].map(([k, v]) => (
              <StaggerItem key={k}>
                <Glass className="px-4 py-3.5">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/65">{k}</p>
                  <p className="mt-1 text-lg font-semibold text-white">{v}</p>
                </Glass>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
        {photos.length > 0 && (
          <Stagger delay={0.3} stagger={0.15} className="hidden grid-cols-2 gap-3 lg:grid">
            {photos.map((src, i) => (
              <StaggerItem key={src} className={cn(i === 0 && "row-span-2")}>
                <div className={cn("overflow-hidden rounded-2xl border border-white/15 shadow-[0_30px_60px_-30px_#000]", i === 0 ? "h-[420px]" : "h-[204px]")}>
                  <img src={src} alt="" loading="lazy" className="size-full object-cover transition-transform duration-[1.4s] hover:scale-110" />
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </div>
    </Frame>
  )
}

/* ---------- 03 rooms ---------- */

function RoomsSlide({ home, slug }: { home: PublicHome; slug: string }) {
  const { t } = useTranslation()
  const last = useLastSearch()
  const quotes = useMemo(() => new Map(last?.result.available.map((a) => [a.room.id, a.quote]) ?? []), [last])
  const shown = last ? home.rooms.filter((r) => quotes.has(r.id)) : home.rooms

  return (
    <Frame scrim="full" className="items-start">
      <div className="mx-auto w-full max-w-[1200px]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>{last ? t("public.availableRooms") : t("public.ourRooms")}</Eyebrow>
            <H2>{t("public.deck.roomsTitle")}</H2>
            {last && <p className="legible mt-3 text-base font-medium text-white/85">{t("public.availableCount", { count: shown.length })}</p>}
          </div>
          {last && (
            <button type="button" onClick={() => publishSearch(null)} className="rounded-full border border-white/30 bg-black/45 px-4 py-2 text-sm font-semibold text-white transition hover:bg-black/60">
              {t("public.showAllRooms")}
            </button>
          )}
        </div>

        {shown.length === 0 ? (
          <Glass className="mt-10 p-8 text-center">
            <p className="text-lg font-semibold text-white">{t("public.noRoomsTitle")}</p>
            <p className="mt-2 text-sm text-white/75">{t("public.noRoomsDescription")}</p>
          </Glass>
        ) : (
          <Stagger key={last ? "searched" : "all"} delay={0.25} stagger={0.08} className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((r) => (
              <StaggerItem key={r.id}>
                <RoomCard room={r} slug={slug} quote={quotes.get(r.id)} search={last?.stay} />
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </div>
    </Frame>
  )
}

function RoomCard({ room, slug, quote, search }: { room: Room; slug: string; quote?: Quote; search?: StayValue }) {
  const { t } = useTranslation()
  const params = search ? `?mode=${search.mode}&start=${search.start}&end=${search.end}&guests=${search.guests}` : ""
  const [failed, setFailed] = useState(false)
  const specs = [room.beds, t("room.upToGuests", { count: room.maxGuests }), room.areaM2 ? `${room.areaM2} m²` : null].filter(Boolean).slice(0, 3)
  const price = quote
    ? { value: money(quote.total), unit: t("room.totalFor", { units: quote.mode === "Nightly" ? t("booking.nightsCount", { count: quote.units }) : t("booking.hoursCount", { count: quote.units }) }) }
    : room.supportsNightly
      ? { value: money(room.baseNightlyPrice), unit: t("room.perNight") }
      : { value: money(room.baseHourlyPrice), unit: t("room.perHour") }

  return (
    <Link
      to={`/h/${slug}/rooms/${room.id}${params}`}
      className="group relative flex h-[360px] flex-col justify-end overflow-hidden rounded-[22px] border border-white/12 bg-[#0b0f16] shadow-[0_30px_60px_-30px_#000] transition-transform duration-500 hover:-translate-y-1.5"
    >
      {room.coverUrl && !failed && (
        <img src={room.coverUrl} alt={room.name} loading="lazy" onError={() => setFailed(true)} className="absolute inset-0 size-full object-cover transition-transform duration-[1.2s] group-hover:scale-110" />
      )}
      <span className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,8,12,0)_30%,rgba(6,8,12,0.55)_60%,rgba(6,8,12,0.95)_100%)]" />
      <div className="relative p-5">
        <h3 className="text-xl font-semibold text-white">{room.name}</h3>
        <p className="mt-1 text-sm text-white/75">{specs.join(" · ")}</p>
        <div className="mt-4 flex items-end justify-between gap-3">
          <p>
            <span className="font-display text-2xl font-bold text-white">{price.value}</span> <span className="text-sm text-white/70">{price.unit}</span>
          </p>
          <span className="flex size-10 items-center justify-center rounded-full bg-brand text-brand-foreground transition-transform duration-300 group-hover:translate-x-1">
            <ArrowRight className="size-4" />
          </span>
        </div>
      </div>
    </Link>
  )
}

/* ---------- 04 policies + FAQ ---------- */

function PoliciesSlide({ home }: { home: PublicHome }) {
  const { t } = useTranslation()
  const { cancellation, faqs } = home
  const [open, setOpen] = useState<string | null>(faqs[0]?.id ?? null)
  return (
    <Frame scrim="full" className="items-start lg:items-center">
      <div className="mx-auto w-full max-w-[1200px]">
        <Eyebrow>{t("public.deck.navPolicies")}</Eyebrow>
        <H2>{t("public.deck.policiesTitle")}</H2>
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          {cancellation && (
            <Reveal delay={0.25}>
              <Glass className="p-6 sm:p-7">
                <h3 className="text-xl font-semibold text-white">{t("public.cancellationTitle")}</h3>
                <ul className="mt-4 divide-y divide-white/10">
                  {cancellation.rules.map((r, i) => (
                    <li key={i} className="flex items-center justify-between gap-4 py-3 text-[15px]">
                      <span className="text-white/85">{r.label}</span>
                      <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-sm font-semibold", r.refundPercent > 0 ? "bg-brand text-brand-foreground" : "bg-white/10 text-white/80")}>
                        {r.refundPercent > 0
                          ? t("public.refundOf", { percent: r.refundPercent, of: r.appliesTo === "Deposit" ? t("public.ofDeposit") : t("public.ofTotal") })
                          : t("public.noRefund")}
                      </span>
                    </li>
                  ))}
                  <li className="flex items-center justify-between gap-4 py-3 text-[15px]">
                    <span className="text-white/85">{t("public.noShow")}</span>
                    <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-0.5 text-sm font-semibold text-white/80">
                      {cancellation.noShowRefundPercent > 0 ? `${cancellation.noShowRefundPercent}%` : t("public.noRefund")}
                    </span>
                  </li>
                </ul>
              </Glass>
            </Reveal>
          )}
          {faqs.length > 0 && (
            <Reveal delay={0.35}>
              <Glass className="p-6 sm:p-7">
                <h3 className="text-xl font-semibold text-white">{t("public.faqTitle")}</h3>
                <div className="mt-4 divide-y divide-white/10">
                  {faqs.map((f) => {
                    const isOpen = open === f.id
                    return (
                      <div key={f.id} className="py-1">
                        <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : f.id)} className="flex w-full items-center justify-between gap-4 py-2.5 text-left text-[15px] font-semibold text-white">
                          {f.question}
                          <span className={cn("text-xl leading-none text-white/60 transition-transform duration-300", isOpen && "rotate-45 text-white")} aria-hidden>
                            +
                          </span>
                        </button>
                        <div className={cn("grid transition-[grid-template-rows] duration-300 ease-out", isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                          <p className="overflow-hidden text-sm leading-relaxed text-white/80">
                            <span className="block pb-3">{f.answer}</span>
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Glass>
            </Reveal>
          )}
        </div>
      </div>
    </Frame>
  )
}

/* ---------- 05 contact + map + footer ---------- */

function ContactSlide({ tenant, slug }: { tenant: PublicTenant; slug: string }) {
  const { t } = useTranslation()
  const mapQuery = tenant.latitude != null && tenant.longitude != null ? encodeURIComponent(`${tenant.latitude},${tenant.longitude}`) : null
  return (
    <div className="relative flex min-h-dvh flex-col">
      <div aria-hidden className={cn("pointer-events-none absolute inset-0", SCRIM.full)} />
      <div className="relative flex flex-1 items-center px-5 pb-10 pt-28 text-[#f6efe2] sm:px-10 lg:px-20">
        <div className="mx-auto grid w-full max-w-[1200px] items-center gap-10 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <Eyebrow>{t("public.deck.navContact")}</Eyebrow>
            <H2>{t("public.deck.contactTitle")}</H2>
            <Stagger delay={0.3} className="mt-8 space-y-3">
              {tenant.address && (
                <StaggerItem>
                  <ContactRow icon={MapPin}>{tenant.address}</ContactRow>
                </StaggerItem>
              )}
              {tenant.phone && (
                <StaggerItem>
                  <ContactRow icon={Phone} href={`tel:${tenant.phone}`}>{tenant.phone}</ContactRow>
                </StaggerItem>
              )}
              {tenant.email && (
                <StaggerItem>
                  <ContactRow icon={Mail} href={`mailto:${tenant.email}`}>{tenant.email}</ContactRow>
                </StaggerItem>
              )}
            </Stagger>
            <Reveal delay={0.55} className="mt-8 flex flex-wrap gap-3">
              <button type="button" onClick={() => goto("top")} className="inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3.5 text-[15px] font-semibold text-brand-foreground shadow-lg transition hover:-translate-y-0.5">
                {t("public.deck.bookNow")}
                <ArrowRight className="size-4" />
              </button>
              <Link to={`/h/${slug}/manage`} className="inline-flex items-center rounded-full border border-white/30 bg-black/45 px-6 py-3.5 text-[15px] font-semibold text-white transition hover:bg-black/60">
                {t("public.manageBooking")}
              </Link>
            </Reveal>
          </div>
          {mapQuery && (
            <Reveal delay={0.35} direction="left">
              <Glass className="overflow-hidden p-2">
                <iframe
                  title={`${t("public.location")} · ${tenant.name}`}
                  src={`https://www.google.com/maps?q=${mapQuery}&z=15&output=embed`}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="block h-72 w-full rounded-xl sm:h-96"
                />
                <a
                  className="flex items-center justify-between gap-2 px-3 py-3 text-sm font-semibold text-white"
                  href={`https://www.google.com/maps/search/?api=1&query=${mapQuery}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("public.openInMaps")}
                  <ArrowRight className="size-4" />
                </a>
              </Glass>
            </Reveal>
          )}
        </div>
      </div>
      <footer className="relative mb-6 ml-5 mr-24 flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#0b0f16]/85 px-5 py-4 text-sm text-white/75 sm:ml-36 sm:flex-row sm:items-center sm:justify-between">
        <span className="font-semibold text-white">{tenant.name}</span>
        <span className="inline-flex items-center gap-2 text-xs">
          {t("public.poweredBy")} <Logo tone="light" className="h-5" />
        </span>
      </footer>
    </div>
  )
}

function ContactRow({ icon: Icon, href, children }: { icon: typeof MapPin; href?: string; children: ReactNode }) {
  const body = (
    <Glass className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:border-white/30">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-foreground">
        <Icon className="size-4" />
      </span>
      <span className="text-[15px] font-medium text-white">{children}</span>
    </Glass>
  )
  return href ? <a href={href}>{body}</a> : body
}

/* ---------- header ---------- */

function TenantHeader({ tenant, slug, go }: { tenant: PublicTenant; slug: string; go: (target: number | string) => void }) {
  const { t } = useTranslation()
  const links: [string, string][] = [
    ["gioi-thieu", t("public.deck.navAbout")],
    ["rooms", t("public.deck.navRooms")],
    ["lien-he", t("public.deck.navContact")],
  ]
  return (
    <header className="absolute inset-x-0 top-0 z-50 px-3 pt-3 sm:px-8 sm:pt-6">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3 rounded-full border border-white/12 bg-[#0b0f16]/70 py-2 pl-2 pr-2 text-white shadow-[0_10px_40px_-20px_#000] backdrop-blur-md sm:pl-3">
        <button type="button" onClick={() => go(0)} className="flex min-w-0 items-center gap-2.5">
          {tenant.logoUrl ? (
            <img src={tenant.logoUrl} alt="" className="size-9 shrink-0 rounded-full object-cover ring-1 ring-white/20" />
          ) : (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-brand-foreground">{tenant.name[0]}</span>
          )}
          <span className="truncate font-display text-lg font-bold tracking-tight">{tenant.name}</span>
        </button>
        <nav className="hidden items-center gap-1 md:flex">
          {links.map(([id, label]) => (
            <button key={id} type="button" onClick={() => go(id)} className="rounded-full px-3.5 py-1.5 text-sm font-medium text-white/85 transition hover:bg-white/10 hover:text-white">
              {label}
            </button>
          ))}
          <Link to={`/h/${slug}/manage`} className="rounded-full px-3.5 py-1.5 text-sm font-medium text-white/85 transition hover:bg-white/10 hover:text-white">
            {t("public.manageBooking")}
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <div className="hidden rounded-full bg-white/90 text-[#14201b] sm:block">
            <LanguageSwitch />
          </div>
          {tenant.botEnabled && (
            <Suspense fallback={null}>
              <ChatWidget slug={slug} tenant={tenant} />
            </Suspense>
          )}
          <button type="button" onClick={() => go(0)} className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:brightness-110">
            {t("public.deck.bookNow")}
          </button>
        </div>
      </div>
    </header>
  )
}
