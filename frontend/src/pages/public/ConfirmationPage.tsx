import { Link, useParams } from "react-router"
import { useTranslation } from "react-i18next"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/common"
import { GuestPageHeading, GuestStateCard } from "./GuestVisuals"
import { BookingSummaryCard, useGuestBooking } from "./ManageBooking"
import { usePublic } from "./PublicLayout"

export default function ConfirmationPage() {
  const { home, slug } = usePublic()
  const { code = "" } = useParams()
  const { t } = useTranslation()
  const phone = sessionStorage.getItem(`stayra.booking.${code}`)
  const email = sessionStorage.getItem(`stayra.booking.email.${code}`)
  const booking = useGuestBooking(slug, code, phone, email)

  if (!phone || !email)
    return (
      <div className="mx-auto max-w-lg px-4 py-20">
        <GuestStateCard>
          <GuestPageHeading title={t("confirmation.lookupTitle")} description={t("confirmation.lookupDescription")} />
          <Button asChild size="lg" className="mt-6 rounded-xl px-7">
            <Link to={`/h/${slug}/manage?code=${code}`}>{t("public.manageBooking")}</Link>
          </Button>
        </GuestStateCard>
      </div>
    )

  if (booking.isLoading)
    return (
      <div className="mx-auto max-w-2xl space-y-5 px-4 py-14 sm:px-6">
        <Skeleton className="size-12 rounded-full" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    )
  if (booking.error || !booking.data)
    return (
      <div className="mx-auto max-w-xl px-4 py-20">
        <ErrorState error={booking.error} onRetry={() => void booking.refetch()} />
      </div>
    )

  const b = booking.data
  const confirmed = b.status === "Confirmed" || b.status === "CheckedIn"
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8 sm:py-14">
      <div className="flex size-12 items-center justify-center rounded-full border border-white/20 bg-brand text-brand-foreground shadow-xs">
        <Check className="size-5" />
      </div>

      <GuestPageHeading
        className="mt-5"
        title={t(confirmed ? "confirmation.confirmedTitle" : "confirmation.heldTitle")}
        description={confirmed ? t("confirmation.confirmedDescription", { name: b.guestName }) : t("confirmation.heldDescription")}
      />

      <div className="guest-panel mt-8 px-6 py-5">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{t("confirmation.code")}</p>
        <p className="mt-1.5 font-mono text-2xl font-semibold tracking-wider text-foreground">{b.code}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t("confirmation.codeHint")}</p>
      </div>

      <div className="mt-6">
        <BookingSummaryCard booking={b} tenant={home.tenant} />
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild size="lg" className="rounded-xl px-6">
          <Link to={`/h/${slug}/manage?code=${b.code}`}>{t("public.manageBooking")}</Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="rounded-xl px-6">
          <Link to={`/h/${slug}`}>{t("confirmation.backHome")}</Link>
        </Button>
      </div>
    </div>
  )
}
