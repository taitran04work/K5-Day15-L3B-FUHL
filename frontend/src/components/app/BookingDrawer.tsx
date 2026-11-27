import type { TFunction } from "i18next"
import { useState } from "react"
import { Link } from "react-router"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { MessageSquare, MoreHorizontal } from "lucide-react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ErrorState, Field, KeyValue, Spinner, StatusBadge, useErrorMessage } from "@/components/common"
import { api } from "@/lib/api"
import { dateTime, money, phone, shortDate, stayLabel, time } from "@/lib/format"
import type { BookingDetail, ChangeRequest, RefundQuote } from "@/lib/types"

function useBookingMutation(id: string, path: string, successMsg: string) {
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  return useMutation({
      mutationFn: (body?: unknown) => api.post(`/api/app/bookings/${id}/${path}`, body ?? {}),
      onSuccess: () => {
        toast.success(successMsg)
        void qc.invalidateQueries({ queryKey: ["booking", id] })
        void qc.invalidateQueries({ queryKey: ["bookings"] })
        void qc.invalidateQueries({ queryKey: ["calendar"] })
        void qc.invalidateQueries({ queryKey: ["overview"] })
      },
    onError: (e) => toast.error(errorMessage(e)),
  })
}

function RequestRow({ r, bookingId }: { r: ChangeRequest; bookingId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const [refund, setRefund] = useState(String(r.refundQuote))
  const decide = useMutation({
    mutationFn: (approve: boolean) => api.post(`/api/app/bookings/requests/${r.id}/decide`, { approve, refundAmount: r.type === "Cancel" ? Number(refund) : null }),
    onSuccess: (_, approve) => {
      toast.success(approve ? t("bookings.requestApproved") : t("bookings.requestRejected"))
      void qc.invalidateQueries({ queryKey: ["booking", bookingId] })
      void qc.invalidateQueries({ queryKey: ["bookings"] })
      void qc.invalidateQueries({ queryKey: ["overview"] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const payload = r.payload as { start?: string; end?: string; roomId?: string }
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{t(`bookings.requestType.${r.type}`)}</p>
        <StatusBadge status={r.status} kind="request" />
      </div>
      {r.type !== "Cancel" && payload.start && (
        <p className="mt-1 text-sm text-muted-foreground">
          {payload.start.replace("T", " ")} → {payload.end?.replace("T", " ")}
          {r.priceDiff !== 0 && ` · ${r.priceDiff > 0 ? "+" : ""}${money(r.priceDiff)}`}
        </p>
      )}
      {r.explanation && <p className="mt-1 text-sm text-muted-foreground">{r.explanation}</p>}
      {r.reason && <p className="mt-1 text-sm">“{r.reason}”</p>}
      {r.status === "Pending" ? (
        <div className="mt-3 space-y-3">
          {r.type === "Cancel" && (
            <Field label={t("bookings.refundAmount")} hint={t("bookings.refundSuggested", { amount: money(r.refundQuote) })}>
              <Input type="number" min={0} step={1000} value={refund} onChange={(e) => setRefund(e.target.value)} className="tabular" />
            </Field>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => decide.mutate(true)} disabled={decide.isPending}>
              {decide.isPending && <Spinner />} {t("bookings.approve")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => decide.mutate(false)} disabled={decide.isPending}>
              {t("bookings.reject")}
            </Button>
          </div>
        </div>
      ) : (
        r.decidedAt && <p className="mt-2 text-xs text-muted-foreground">{t("bookings.decidedBy", { who: r.decidedBy?.replace("owner:", "") ?? "", when: dateTime(r.decidedAt) })}</p>
      )}
    </div>
  )
}

function CancelDialog({ id, open, onOpenChange, paid }: { id: string; open: boolean; onOpenChange: (o: boolean) => void; paid: number }) {
  const { t } = useTranslation()
  const [reason, setReason] = useState("")
  const [refund, setRefund] = useState<string | null>(null)
  const quote = useQuery({ queryKey: ["cancel-quote-owner", id], enabled: open, queryFn: () => api.post<RefundQuote>(`/api/app/bookings/${id}/cancel-quote`) })
  const cancel = useBookingMutation(id, "cancel", t("bookings.cancelled"))
  const value = refund ?? String(quote.data?.refundAmount ?? 0)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("bookings.cancelTitle")}</DialogTitle>
          <DialogDescription>{t("bookings.cancelDescription")}</DialogDescription>
        </DialogHeader>
        {quote.data ? <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{quote.data.explanation}</p> : <Skeleton className="h-12" />}
        <Field label={t("bookings.refundAmount")} hint={t("bookings.refundMax", { amount: money(paid) })}>
          <Input type="number" min={0} max={paid} step={1000} value={value} onChange={(e) => setRefund(e.target.value)} className="tabular" />
        </Field>
        <Field label={t("bookings.reason")} optional>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.back")}
          </Button>
          <Button
            variant="destructive"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate({ reason: reason || null, refundAmount: Number(value) }, { onSuccess: () => onOpenChange(false) })}
          >
            {cancel.isPending && <Spinner />} {t("bookings.cancelBooking")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function timelineLabel(t: TFunction, action: string) {
  return t(`timeline.${action.replace(/\./g, "_")}`, { defaultValue: action })
}

export function BookingDrawer({ id, onOpenChange }: { id: string | null; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const [cancelOpen, setCancelOpen] = useState(false)
  const detail = useQuery({ queryKey: ["booking", id], enabled: !!id, queryFn: () => api.get<BookingDetail>(`/api/app/bookings/${id}`) })
  const checkIn = useBookingMutation(id ?? "", "check-in", t("bookings.checkedIn"))
  const checkOut = useBookingMutation(id ?? "", "check-out", t("bookings.checkedOut"))
  const noShow = useBookingMutation(id ?? "", "no-show", t("bookings.markedNoShow"))
  const confirm = useBookingMutation(id ?? "", "confirm", t("bookings.confirmed"))
  const sendRemaining = useBookingMutation(id ?? "", "send-remaining", t("bookings.linkSent"))

  const d = detail.data
  const b = d?.booking
  const canCheckIn = b?.status === "Confirmed"
  const canCheckOut = b?.status === "CheckedIn" || b?.status === "Confirmed"
  const canCashCheckOut = b?.status === "CheckedIn" && b.balance > 0
  const canNoShow = b?.status === "Confirmed" && new Date(b.startAt) < new Date()
  const canCancel = !!b && ["Hold", "PendingDeposit", "Confirmed"].includes(b.status)
  const hasMoreActions = Boolean(d?.conversationId) || canCashCheckOut || canNoShow || canCancel
  const busy = checkIn.isPending || checkOut.isPending

  return (
    <Sheet open={!!id} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl">
        {detail.isLoading || !d || !b ? (
          detail.error ? (
            <div className="p-6">
              <SheetTitle className="sr-only">{t("bookings.title")}</SheetTitle>
              <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
            </div>
          ) : (
            <div className="space-y-4 p-6">
              <SheetTitle className="sr-only">{t("bookings.title")}</SheetTitle>
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-60" />
              <Skeleton className="h-40 w-full" />
            </div>
          )
        ) : (
          <>
            <SheetHeader className="gap-1 border-b px-6 py-5">
              <div className="flex items-center gap-3 pr-8">
                <SheetTitle className="font-mono text-lg tracking-wide">{b.code}</SheetTitle>
                <StatusBadge status={b.status} />
              </div>
              <SheetDescription>
                {b.guestName} · {d.room.name} · {stayLabel(b.mode, b.startAt, b.endAt)}
              </SheetDescription>
              <div className="flex flex-wrap gap-2 pt-3">
                {b.status === "PendingDeposit" && (
                  <Button size="sm" onClick={() => confirm.mutate(undefined)} disabled={confirm.isPending}>
                    {t("bookings.markConfirmed")}
                  </Button>
                )}
                {canCheckIn && (
                  <Button size="sm" onClick={() => checkIn.mutate(undefined)} disabled={busy}>
                    {checkIn.isPending && <Spinner />} {t("bookings.checkIn")}
                  </Button>
                )}
                {canCheckOut && b.status === "CheckedIn" && (
                  <Button size="sm" onClick={() => checkOut.mutate({ settledInCash: false })} disabled={busy}>
                    {checkOut.isPending && <Spinner />} {t("bookings.checkOut")}
                  </Button>
                )}
                {b.balance > 0 && ["Confirmed", "CheckedIn"].includes(b.status) && (
                  <Button size="sm" variant="outline" onClick={() => sendRemaining.mutate(undefined)} disabled={sendRemaining.isPending}>
                    {sendRemaining.isPending && <Spinner />} {t("bookings.sendPaymentLink")}
                  </Button>
                )}
                {hasMoreActions && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-sm" variant="outline" aria-label={t("common.more")}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      {d.conversationId && (
                        <DropdownMenuItem asChild>
                          <Link to={`/app/inbox?c=${d.conversationId}`}>
                            <MessageSquare /> {t("bookings.openConversation")}
                          </Link>
                        </DropdownMenuItem>
                      )}
                      {canCashCheckOut && (
                        <DropdownMenuItem onClick={() => checkOut.mutate({ settledInCash: true })}>{t("bookings.checkOutCash")}</DropdownMenuItem>
                      )}
                      {canNoShow && (
                        <DropdownMenuItem onClick={() => noShow.mutate(undefined)}>{t("bookings.markNoShow")}</DropdownMenuItem>
                      )}
                      {canCancel && (
                        <>
                          {(d.conversationId || canNoShow) && <DropdownMenuSeparator />}
                          <DropdownMenuItem variant="destructive" onClick={() => setCancelOpen(true)}>
                            {t("bookings.cancelBooking")}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </SheetHeader>

            <div className="space-y-8 px-6 py-6">
              {d.requests.some((r) => r.status === "Pending") && (
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">{t("bookings.needsDecision")}</h3>
                  {d.requests
                    .filter((r) => r.status === "Pending")
                    .map((r) => (
                      <RequestRow key={r.id} r={r} bookingId={b.id} />
                    ))}
                </section>
              )}

              <section>
                <h3 className="text-sm font-semibold">{t("bookings.guest")}</h3>
                <dl className="mt-2">
                  <KeyValue label={t("bookings.name")}>{b.guestName}</KeyValue>
                  <KeyValue label={t("bookings.phone")}>
                    <a href={`tel:${b.guestPhone}`} className="hover:underline">
                      {phone(b.guestPhone)}
                    </a>
                  </KeyValue>
                  {b.guestEmail && <KeyValue label={t("bookings.email")}>{b.guestEmail}</KeyValue>}
                  <KeyValue label={t("bookings.guests")}>{b.guests}</KeyValue>
                  <KeyValue label={t("bookings.source")}>{t(`source.${b.source}`)}</KeyValue>
                  {b.note && <KeyValue label={t("bookings.note")}>{b.note}</KeyValue>}
                </dl>
              </section>

              <section>
                <h3 className="text-sm font-semibold">{t("bookings.stay")}</h3>
                <dl className="mt-2">
                  <KeyValue label={t("bookings.room")}>{d.room.name}</KeyValue>
                  <KeyValue label={b.mode === "Nightly" ? t("booking.checkIn") : t("booking.start")}>{`${shortDate(b.startAt)}, ${time(b.startAt)}`}</KeyValue>
                  <KeyValue label={b.mode === "Nightly" ? t("booking.checkOut") : t("booking.end")}>{`${shortDate(b.endAt)}, ${time(b.endAt)}`}</KeyValue>
                  {b.holdExpiresAt && b.status === "Hold" && <KeyValue label={t("bookings.holdExpires")}>{time(b.holdExpiresAt)}</KeyValue>}
                </dl>
              </section>

              <section>
                <h3 className="text-sm font-semibold">{t("bookings.money")}</h3>
                <dl className="mt-2">
                  {d.priceBreakdown?.lines?.length > 0 && (
                    <KeyValue label={b.mode === "Nightly" ? t("booking.nightsCount", { count: d.priceBreakdown.units }) : t("booking.hoursCount", { count: d.priceBreakdown.units })}>
                      {money(d.priceBreakdown.subtotal)}
                    </KeyValue>
                  )}
                  {d.priceBreakdown?.extraGuestFee > 0 && <KeyValue label={t("booking.extraGuestFee")}>{money(d.priceBreakdown.extraGuestFee)}</KeyValue>}
                  <KeyValue label={t("booking.total")} className="font-medium [&_dt]:text-foreground">
                    {money(b.totalAmount)}
                  </KeyValue>
                  <KeyValue label={t("bookings.deposit")}>{money(b.depositAmount)}</KeyValue>
                  <KeyValue label={t("booking.paid")}>{money(b.paidAmount)}</KeyValue>
                  {b.refundAmount > 0 && <KeyValue label={t("booking.refunded")}>{money(b.refundAmount)}</KeyValue>}
                  {b.creditAmount > 0 && <KeyValue label={t("bookings.credit")}>{money(b.creditAmount)}</KeyValue>}
                  <KeyValue label={t("booking.balance")} className="font-semibold [&_dt]:text-foreground">
                    {money(b.balance)}
                  </KeyValue>
                  {d.remainingDueAt && b.balance > 0 && <KeyValue label={t("bookings.balanceDue")}>{dateTime(d.remainingDueAt)}</KeyValue>}
                </dl>
              </section>

              {d.payments.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold">{t("bookings.payments")}</h3>
                  <ul className="mt-2 divide-y rounded-lg border">
                    {d.payments.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                        <div className="min-w-0">
                          <p>
                            {t(`payment.kind.${p.kind}`)} <span className="text-muted-foreground">· {t(`payment.provider.${p.provider}`)}</span>
                          </p>
                          <p className="text-xs text-muted-foreground">{dateTime(p.paidAt ?? p.createdAt)}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className="tabular">{p.kind === "Refund" ? `−${money(p.amount)}` : money(p.amount)}</span>
                          <StatusBadge status={p.status} kind="payment" />
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {d.requests.some((r) => r.status !== "Pending") && (
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">{t("bookings.requests")}</h3>
                  {d.requests
                    .filter((r) => r.status !== "Pending")
                    .map((r) => (
                      <RequestRow key={r.id} r={r} bookingId={b.id} />
                    ))}
                </section>
              )}

              {d.timeline.length > 0 && (
                <section>
                  <h3 className="text-sm font-semibold">{t("bookings.activity")}</h3>
                  <ol className="mt-3 space-y-3 border-l pl-4">
                    {[...d.timeline].reverse().map((item, i) => (
                      <li key={i} className="relative text-sm">
                        <span className="absolute -left-[21px] top-1.5 size-2 rounded-full border-2 border-background bg-foreground/30" />
                        <p>{timelineLabel(t, item.action)}</p>
                        <p className="text-xs text-muted-foreground">
                          {dateTime(item.at)} · {t(`actor.${item.actor.split(":")[0]}`, { defaultValue: item.actor })}
                          {item.actor.startsWith("owner:") && ` (${item.actor.slice(6)})`}
                        </p>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </div>
            <CancelDialog id={b.id} open={cancelOpen} onOpenChange={setCancelOpen} paid={b.paidAmount - b.refundAmount} />
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
