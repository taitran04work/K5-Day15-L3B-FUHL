import { Link } from "react-router"
import { useTranslation } from "react-i18next"
import { ArrowRight } from "lucide-react"
import { PhotoTile } from "@/components/booking/BookingParts"
import type { StayValue } from "@/components/booking/StayPicker"
import { useLocalizedFormat } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Quote, Room } from "@/lib/types"
import { stayQuery } from "./publicStay"

export function PublicRoomCard({ room, slug, quote, stay, heading: Heading = "h3", className }: { room: Room; slug: string; quote?: Quote; stay?: StayValue; heading?: "h2" | "h3"; className?: string }) {
  const { t } = useTranslation()
  const { money } = useLocalizedFormat()
  const specs = [room.beds, t("room.upToGuests", { count: room.maxGuests }), room.areaM2 ? `${room.areaM2} m²` : null].filter(Boolean)
  const value = money(quote?.total ?? (room.supportsNightly ? room.baseNightlyPrice : room.baseHourlyPrice))
  const unit = quote
    ? t("room.totalFor", { units: t(quote.mode === "Nightly" ? "booking.nightsCount" : "booking.hoursCount", { count: quote.units }) })
    : t(room.supportsNightly ? "room.perNight" : "room.perHour")

  return (
    <Link
      to={`/h/${slug}/rooms/${room.id}${stayQuery(stay)}`}
      className={cn("group relative flex min-w-0 items-end overflow-hidden rounded-[1.4rem] border border-white/15 bg-[#0b0f16] shadow-[0_20px_48px_-24px_#000] motion-safe:transition-transform motion-safe:hover:-translate-y-1", className)}
    >
      <PhotoTile url={room.coverUrl || room.photos[0]?.url} alt="" className="absolute inset-0 size-full rounded-none bg-[#18212b] motion-safe:transition-transform motion-safe:duration-700 motion-safe:group-hover:scale-105" />
      <span aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,transparent_25%,rgba(6,8,12,0.63)_59%,rgba(6,8,12,0.98)_100%)]" />
      <div className="relative w-full p-4 sm:p-5">
        <Heading className="font-display text-xl font-bold leading-tight text-white wrap-break-word">{room.name}</Heading>
        <p className="mt-1.5 min-h-[2.25rem] line-clamp-2 text-xs leading-relaxed text-white/80">{specs.join(" · ")}</p>
        <div className="mt-4 flex items-end justify-between gap-2">
          <p className="min-w-0">
            <span className="block whitespace-nowrap font-display text-[clamp(1.2rem,1.5vw,1.65rem)] font-bold leading-tight text-white tabular">{value}</span>
            <span className="mt-0.5 block text-xs text-white/75">{unit}</span>
          </p>
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full border border-white/25 bg-brand text-brand-foreground motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5">
            <ArrowRight className="size-4" />
          </span>
        </div>
      </div>
    </Link>
  )
}
