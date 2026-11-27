import { Link, useParams } from "react-router"
import { useTranslation } from "react-i18next"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/common"
import { BookingSummaryCard, useGuestBooking } from "./ManageBooking"
import { usePublic } from "./PublicLayout"

export default function ConfirmationPage() {
  const { home, slug } = usePublic()
  const { code = "" } = useParams()
  const { t } = useTranslation()
  const phone = sessionStorage.getItem(`stayra.booking.${code}`)
  const booking = useGuestBooking(slug, code, phone)

  if (!phone)
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <h1 className="text-xl">{t("confirmation.lookupTitle")}</h1>
        <p className="mt-2 text-muted-foreground">{t("confirmation.lookupDescription")}</p>
        <Button asChild className="mt-6">
          <Link to={`/h/${slug}/manage?code=${code}`}>{t("public.manageBooking")}</Link>
        </Button>
      </div>
    )

  if (booking.isLoading)
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-16">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64 w-full rounded-xl" />
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
    <div className="mx-auto max-w-2xl px-4 py-12 sm:py-16">
      <div className="flex size-11 items-center justify-center rounded-full bg-brand text-brand-foreground">
        <Check className="size-5" />
      </div>
      <h1 className="mt-5 text-xl sm:text-2xl">{confirmed ? t("confirmation.confirmedTitle") : t("confirmation.heldTitle")}</h1>
      <p className="mt-2 text-base text-muted-foreground">{confirmed ? t("confirmation.confirmedDescription", { name: b.guestName }) : t("confirmation.heldDescription")}</p>

      <div className="mt-8 rounded-xl border px-5 py-4">
        <p className="text-sm text-muted-foreground">{t("confirmation.code")}</p>
        <p className="mt-1 font-mono text-xl font-semibold tracking-wider">{b.code}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("confirmation.codeHint")}</p>
      </div>

      <div className="mt-6">
        <BookingSummaryCard booking={b} tenant={home.tenant} />
      </div>

      <div className="mt-8 flex flex-wrap gap-2">
        <Button asChild>
          <Link to={`/h/${slug}/manage?code=${b.code}`}>{t("public.manageBooking")}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to={`/h/${slug}`}>{t("confirmation.backHome")}</Link>
        </Button>
      </div>
    </div>
  )
}
