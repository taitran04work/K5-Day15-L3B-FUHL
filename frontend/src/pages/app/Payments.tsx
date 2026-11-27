import { useState } from "react"
import { useTranslation } from "react-i18next"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { CircleDollarSign } from "lucide-react"
import { Page } from "@/components/layout/AppShell"
import { EmptyState, ErrorState, PageHeader, RowsSkeleton, Stat, StatusBadge } from "@/components/common"
import { BookingDrawer } from "@/components/app/BookingDrawer"
import { api, qs } from "@/lib/api"
import { dateTime, money } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Payment } from "@/lib/types"

interface PaymentsResponse {
  total: number
  summary: { paid30: number; refunded30: number; open: number }
  items: { payment: Payment; bookingCode: string; guestName: string }[]
}

export default function Payments() {
  const { t } = useTranslation()
  const [status, setStatus] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const data = useQuery({
    queryKey: ["payments", status],
    placeholderData: keepPreviousData,
    queryFn: () => api.get<PaymentsResponse>(`/api/app/payments${qs({ status, pageSize: 100 })}`),
  })
  const filters = ["", "Paid", "Created", "Refunded", "Failed", "Expired"]
  return (
    <Page>
      <PageHeader title={t("payments.title")} description={t("payments.description")} />
      {data.data && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <Stat label={t("payments.received30")} value={money(data.data.summary.paid30)} />
          <Stat label={t("payments.refunded30")} value={money(data.data.summary.refunded30)} />
          <Stat label={t("payments.open")} value={money(data.data.summary.open)} hint={t("payments.openHint")} />
        </div>
      )}
      <div className="-mx-1 mb-4 flex flex-wrap gap-1 px-1" role="tablist">
        {filters.map((f) => (
          <button
            key={f || "all"}
            role="tab"
            aria-selected={status === f}
            onClick={() => setStatus(f)}
            className={cn("whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground", status === f && "bg-muted font-medium text-foreground")}
          >
            {f ? t(`status.payment.${f}`) : t("payments.all")}
          </button>
        ))}
      </div>
      {data.isLoading ? (
        <RowsSkeleton />
      ) : data.error ? (
        <ErrorState error={data.error} onRetry={() => void data.refetch()} />
      ) : !data.data?.items.length ? (
        <EmptyState icon={<CircleDollarSign />} title={t("payments.emptyTitle")} description={t("payments.emptyDescription")} />
      ) : (
        <div className="responsive-table-frame rounded-xl border">
          <table className="responsive-table w-full text-sm" role="table">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">{t("payments.col.date")}</th>
                <th className="px-4 py-2.5 font-medium">{t("payments.col.booking")}</th>
                <th className="px-4 py-2.5 font-medium">{t("payments.col.type")}</th>
                <th className="px-4 py-2.5 font-medium">{t("payments.col.method")}</th>
                <th className="px-4 py-2.5 font-medium">{t("payments.col.status")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("payments.col.amount")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.data.items.map(({ payment: p, bookingCode, guestName }) => (
                <tr key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelected(p.bookingId)}>
                  <td data-label={t("payments.col.date")} className="px-4 py-3 text-muted-foreground">{dateTime(p.paidAt ?? p.createdAt)}</td>
                  <td data-row-title className="px-4 py-3">
                    <p>{guestName}</p>
                    <p className="font-mono text-xs text-muted-foreground">{bookingCode}</p>
                  </td>
                  <td data-label={t("payments.col.type")} className="px-4 py-3">{t(`payment.kind.${p.kind}`)}</td>
                  <td data-label={t("payments.col.method")} className="px-4 py-3 text-muted-foreground">{t(`payment.provider.${p.provider}`)}</td>
                  <td data-label={t("payments.col.status")} className="px-4 py-3">
                    <StatusBadge status={p.status} kind="payment" />
                  </td>
                  <td data-label={t("payments.col.amount")} className="px-4 py-3 text-right tabular">{p.kind === "Refund" ? `−${money(p.amount)}` : money(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <BookingDrawer id={selected} onOpenChange={(o) => !o && setSelected(null)} />
    </Page>
  )
}
