import { Link, useSearchParams } from "react-router"
import { useTranslation } from "react-i18next"
import { skipToken, useQuery } from "@tanstack/react-query"
import { CalendarDays } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/common"
import { GuestPageHeading, GuestStateCard } from "./GuestVisuals"
import { usePublic } from "./PublicLayout"
import { PublicRoomCard } from "./PublicRoomCard"
import { availableRoomsKey, readStayQuery, searchAvailableRooms, stayQueryLabel } from "./publicStay"

export default function RoomsPage() {
  const { home, slug } = usePublic()
  const { t, i18n } = useTranslation()
  const [params] = useSearchParams()
  const stay = readStayQuery(params)
  const available = useQuery({
    queryKey: availableRoomsKey(slug, stay),
    queryFn: stay ? () => searchAvailableRooms(slug, stay) : skipToken,
    staleTime: 15_000,
    retry: false,
  })
  const quotes = new Map(available.data?.available.map(({ room, quote }) => [room.id, quote]))
  const rooms = stay ? home.rooms.filter((room) => quotes.has(room.id)) : home.rooms
  const roomsUrl = `/h/${slug}/rooms`

  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-14 pt-8 sm:px-8 sm:pt-14">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <GuestPageHeading
          title={stay ? t("public.availableRooms") : t("room.allRooms")}
          description={stay ? `${stayQueryLabel(stay, i18n.language)} · ${t("booking.guestsCount", { count: stay.guests })}` : home.tenant.name}
        />
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="h-10 rounded-full px-4">
            <Link to={`/h/${slug}`}><CalendarDays aria-hidden /> {t(stay ? "public.changeSearchDates" : "public.checkAvailability")}</Link>
          </Button>
          {stay && (
            <Button asChild variant="outline" className="h-10 rounded-full px-4">
              <Link to={roomsUrl}>{t("public.showAllRooms")}</Link>
            </Button>
          )}
        </div>
      </div>

      {available.isLoading ? (
        <div aria-busy="true" className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-80 w-full rounded-[1.4rem]" />)}
        </div>
      ) : available.error ? (
        <div className="guest-panel mt-8"><ErrorState className="border-0" error={available.error} onRetry={() => void available.refetch()} /></div>
      ) : rooms.length === 0 ? (
        <GuestStateCard className="mt-8">
          <h2 className="font-display text-lg font-bold">{t(stay ? "public.noRoomsTitle" : "public.noListedRoomsTitle")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t(stay ? "public.noRoomsDescription" : "public.noListedRoomsDescription")}</p>
        </GuestStateCard>
      ) : (
        <>
          <p className="mt-7 border-t pt-4 text-sm font-medium text-muted-foreground">
            {t(stay ? "public.availableCount" : "public.listedRoomCount", { count: rooms.length })}
          </p>
          <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {rooms.map((room) => <PublicRoomCard key={room.id} room={room} slug={slug} quote={quotes.get(room.id)} stay={stay ?? undefined} heading="h2" className="h-[clamp(17rem,35vw,23rem)]" />)}
          </div>
        </>
      )}
    </div>
  )
}
