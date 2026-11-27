import { useEffect } from "react"
import { Link, useLocation } from "react-router"
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/common"
import { api } from "@/lib/api"
import { useBrand } from "@/lib/brand"
import { money } from "@/lib/format"
import { usePublicHome } from "./PublicLayout"

interface ReturnResult {
  signatureValid: boolean
  found: boolean
  status: string | null
  bookingCode: string | null
  tenantSlug: string | null
  amount: number
  kind: string | null
  resultCode: string | null
  message: string | null
}

/** MoMo redirects the guest here with a signed query string; the API verifies it and records the payment. */
export default function PayReturn() {
  const { search } = useLocation()
  const { t } = useTranslation()
  const result = useQuery({ queryKey: ["pay-return", search], queryFn: () => api.get<ReturnResult>(`/api/payments/momo/return${search}`), retry: false })
  const home = usePublicHome(result.data?.tenantSlug ?? "")
  useBrand(home.data?.tenant.accentColor)

  useEffect(() => {
    document.title = "Stayra"
  }, [])

  const r = result.data
  const success = r && (r.status === "Paid" || r.resultCode === "0") && r.signatureValid
  return (
    <div className="public-editorial flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-[0_20px_50px_-24px_rgba(23,22,20,0.16)] sm:p-10">
        {result.isLoading ? (
          <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
            <Spinner className="size-5" />
            <p className="text-sm">{t("payReturn.checking")}</p>
          </div>
        ) : (
          <>
            <div
              className={`mx-auto flex size-12 items-center justify-center rounded-full ${
                success ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {success ? <Check className="size-5" /> : <X className="size-5" />}
            </div>

            <h1 className="mt-5 text-2xl font-bold tracking-tight sm:text-3xl">
              {success ? t("payReturn.successTitle") : t("payReturn.failedTitle")}
            </h1>

            <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
              {success
                ? t("payReturn.successDescription", { amount: money(r?.amount ?? 0), code: r?.bookingCode ?? "" })
                : r?.message || t("payReturn.failedDescription")}
            </p>

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
      </div>
    </div>
  )
}
