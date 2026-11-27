import { useEffect } from "react"
import { Link, useLocation } from "react-router"
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/common"
import { api } from "@/lib/api"
import { money } from "@/lib/format"

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

  useEffect(() => {
    document.title = "Stayra"
  }, [])

  const r = result.data
  const success = r && (r.status === "Paid" || r.resultCode === "0") && r.signatureValid
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md rounded-2xl border bg-background p-8 text-center shadow-sm">
        {result.isLoading ? (
          <div className="flex flex-col items-center gap-3 py-6 text-muted-foreground">
            <Spinner className="size-5" />
            <p>{t("payReturn.checking")}</p>
          </div>
        ) : (
          <>
            <div className={`mx-auto flex size-11 items-center justify-center rounded-full ${success ? "bg-brand text-brand-foreground" : "bg-muted text-muted-foreground"}`}>
              {success ? <Check className="size-5" /> : <X className="size-5" />}
            </div>
            <h1 className="mt-5 text-lg">{success ? t("payReturn.successTitle") : t("payReturn.failedTitle")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {success ? t("payReturn.successDescription", { amount: money(r?.amount ?? 0), code: r?.bookingCode ?? "" }) : r?.message || t("payReturn.failedDescription")}
            </p>
            {r?.tenantSlug && r.bookingCode && (
              <Button asChild className="mt-6 w-full">
                <Link to={`/h/${r.tenantSlug}/manage?code=${r.bookingCode}`}>{t("payReturn.viewBooking")}</Link>
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
