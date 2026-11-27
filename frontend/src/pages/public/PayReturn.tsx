import { useEffect } from "react"
import { Link, useLocation } from "react-router"
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/common"
import { api } from "@/lib/api"
import { useBrand } from "@/lib/brand"
import { useLocalizedFormat } from "@/lib/format"
import { GuestBackdrop, GuestPageHeading, GuestStateCard } from "./GuestVisuals"
import { usePublicHome } from "./PublicLayout"
import { GuestLanguage } from "./GuestLanguage"

interface ReturnResult {
  signatureValid: boolean
  found: boolean
  status: string | null
  bookingCode: string | null
  tenantSlug: string | null
  amount: number
  kind: string | null
  responseCode: string | null
  transactionStatus: string | null
  message: string | null
}

/** VNPay redirects the guest here with a signed query string; the API verifies it and records the payment. */
export default function PayReturn() {
  const { search } = useLocation()
  const result = useQuery({ queryKey: ["pay-return", search], queryFn: () => api.get<ReturnResult>(`/api/payments/vnpay/return${search}`), retry: false })
  const home = usePublicHome(result.data?.tenantSlug ?? "")
  useBrand(home.data?.tenant.accentColor)

  useEffect(() => {
    document.title = "Stayra"
  }, [])

  return (
    <GuestLanguage language={home.data?.tenant.defaultLanguage}>
      <PaymentResult r={result.data} loading={result.isLoading || home.isLoading} image={home.data?.tenant.coverImageUrl} />
    </GuestLanguage>
  )
}

function PaymentResult({ r, loading, image }: { r?: ReturnResult; loading: boolean; image?: string | null }) {
  const { t } = useTranslation()
  const { money } = useLocalizedFormat()
  const success = r && (r.status === "Paid" || (r.responseCode === "00" && r.transactionStatus === "00")) && r.signatureValid
  return (
    <div className="guest-storefront relative isolate grid min-h-dvh place-items-center px-4 py-12">
      <GuestBackdrop image={image} />
      <GuestStateCard className="w-full max-w-lg">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
            <Spinner className="size-5" />
            <p className="text-sm">{t("payReturn.checking")}</p>
          </div>
        ) : (
          <>
            <div
              className={`mx-auto flex size-12 items-center justify-center rounded-full border border-white/20 ${
                success ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {success ? <Check className="size-5" /> : <X className="size-5" />}
            </div>

            <GuestPageHeading
              className="mt-5"
              title={t(success ? "payReturn.successTitle" : "payReturn.failedTitle")}
              description={success
                ? t("payReturn.successDescription", { amount: money(r?.amount ?? 0), code: r?.bookingCode ?? "" })
                : r?.message || t("payReturn.failedDescription")}
            />

            {r?.tenantSlug && r.bookingCode ? (
              <Button asChild size="lg" className="mt-7 h-11 w-full rounded-xl">
                <Link to={`/h/${r.tenantSlug}/manage?code=${r.bookingCode}`}>{t("payReturn.viewBooking")}</Link>
              </Button>
            ) : (
              <Button asChild variant="outline" size="lg" className="mt-7 h-11 w-full rounded-xl">
                <Link to="/">{t("payReturn.backHome")}</Link>
              </Button>
            )}
          </>
        )}
      </GuestStateCard>
    </div>
  )
}
