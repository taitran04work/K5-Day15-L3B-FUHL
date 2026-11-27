import { useEffect, useState } from "react"
import { useSearchParams } from "react-router"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Field, KeyValue, Spinner, StatusBadge, useErrorMessage } from "@/components/common"
import { PaymentCard, PhotoTile } from "@/components/booking/BookingParts"
import { GuestStepper, HourPicker, ModeToggle, NightRangePicker, defaultStay, useBusy, type StayValue } from "@/components/booking/StayPicker"
import { api } from "@/lib/api"
import { dateTime, isoDate, money, shortDate, stayLabel, time } from "@/lib/format"
import type { ChangeQuote, GuestBooking, Payment, PublicTenant, RefundQuote, Room } from "@/lib/types"
import { normalizePhone, rememberBookingPhone, vnPhone } from "./BookPage"
import { usePublic } from "./PublicLayout"

export function useGuestBooking(slug: string, code: string | null, phone: string | null, email: string | null) {
  return useQuery({
    queryKey: ["guest-booking", slug, code, phone, email],
    enabled: !!code && !!phone && !!email,
    retry: false,
    queryFn: () => api.post<GuestBooking>(`/api/public/${slug}/bookings/lookup`, { code, phone, email }),
  })
}

export function BookingSummaryCard({ booking, tenant }: { booking: GuestBooking; tenant: PublicTenant }) {
  const { t } = useTranslation()
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="flex gap-4 border-b p-4">
        <PhotoTile url={booking.room.coverUrl} alt={booking.room.name} className="size-20 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{booking.room.name}</p>
            <StatusBadge status={booking.status} />
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{stayLabel(booking.mode, booking.startAt, booking.endAt)}</p>
          <p className="text-sm text-muted-foreground">{t("booking.guestsCount", { count: booking.guests })}</p>
        </div>
      </div>
      <dl className="p-4">
        {booking.mode === "Nightly" && (
          <>
            <KeyValue label={t("booking.checkIn")}>{`${shortDate(booking.startAt)}, ${t("public.fromTime", { time: tenant.checkInTime })}`}</KeyValue>
            <KeyValue label={t("booking.checkOut")}>{`${shortDate(booking.endAt)}, ${t("public.byTime", { time: tenant.checkOutTime })}`}</KeyValue>
          </>
        )}
        {booking.mode === "Hourly" && <KeyValue label={t("booking.time")}>{`${time(booking.startAt)}–${time(booking.endAt)}`}</KeyValue>}
        <div className="my-2 border-t" />
        <KeyValue label={t("booking.total")}>{money(booking.totalAmount)}</KeyValue>
        <KeyValue label={t("booking.paid")}>{money(booking.paidAmount)}</KeyValue>
        {booking.refundAmount > 0 && <KeyValue label={t("booking.refunded")}>{money(booking.refundAmount)}</KeyValue>}
        <KeyValue label={t("booking.balance")} className="font-semibold [&_dt]:text-foreground">
          {money(booking.balance)}
        </KeyValue>
      </dl>
    </div>
  )
}

function ChangeDialog({ open, onOpenChange, booking, slug, phone, email, tenant, rooms }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  booking: GuestBooking
  slug: string
  phone: string
  email: string
  tenant: PublicTenant
  rooms: Room[]
}) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const qc = useQueryClient()
  const local = (iso: string) => {
    const d = new Date(iso)
    return `${isoDate(d)}T${time(d)}`
  }
  const initial: StayValue =
    booking.mode === "Nightly"
      ? { mode: "Nightly", start: isoDate(booking.startAt), end: isoDate(booking.endAt), guests: booking.guests }
      : { mode: "Hourly", start: local(booking.startAt), end: local(booking.endAt), guests: booking.guests }
  const [stay, setStay] = useState<StayValue>(initial)
  const [roomId, setRoomId] = useState(booking.room.id)
  const room = rooms.find((r) => r.id === roomId) ?? booking.room
  const busy = useBusy(slug, roomId)

  const quote = useMutation({
    mutationFn: () => api.post<ChangeQuote>(`/api/public/${slug}/bookings/${booking.code}/change-quote`, { phone, email, roomId, ...stay }),
  })
  const apply = useMutation({
    mutationFn: () => api.post<{ message: string; status: string; extraPayment: Payment | null }>(`/api/public/${slug}/bookings/${booking.code}/change`, { phone, email, roomId, ...stay }),
    onSuccess: (res) => {
      toast.success(res.message)
      void qc.invalidateQueries({ queryKey: ["guest-booking", slug, booking.code] })
      onOpenChange(false)
    },
  })

  const q = quote.data
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("manage.changeTitle")}</DialogTitle>
          <DialogDescription>{t("manage.changeDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={t("manage.room")}>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={roomId}
              onChange={(e) => {
                setRoomId(e.target.value)
                quote.reset()
              }}
            >
              {rooms
                .filter((r) => (stay.mode === "Nightly" ? r.supportsNightly : r.supportsHourly) && r.maxGuests >= stay.guests)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </Field>
          <ModeToggle value={stay.mode} nightly={room.supportsNightly} hourly={room.supportsHourly} onChange={(m) => { setStay({ ...defaultStay(m, tenant.openingTime), guests: stay.guests }); quote.reset() }} />
          {stay.mode === "Nightly" ? (
            <NightRangePicker start={stay.start} end={stay.end} bookedNights={roomId === booking.room.id ? undefined : busy.data?.bookedNights} onChange={(s, e) => { setStay({ ...stay, start: s, end: e }); quote.reset() }} />
          ) : (
            <HourPicker start={stay.start} end={stay.end} openingTime={tenant.openingTime} closingTime={tenant.closingTime} minHours={room.minHours} onChange={(s, e) => { setStay({ ...stay, start: s, end: e }); quote.reset() }} />
          )}
          <GuestStepper value={stay.guests} max={room.maxGuests} onChange={(g) => { setStay({ ...stay, guests: g }); quote.reset() }} />

          {q && (
            <div className="rounded-lg bg-muted p-4 text-sm">
              {q.available ? (
                <>
                  <KeyValue label={t("manage.currentTotal")}>{money(q.oldTotal)}</KeyValue>
                  <KeyValue label={t("manage.newTotal")}>{money(q.newTotal)}</KeyValue>
                  <p className="mt-2 text-muted-foreground">{q.explanation}</p>
                  {q.requiresApproval && <p className="mt-2 text-muted-foreground">{t("manage.needsApproval")}</p>}
                </>
              ) : (
                <p>{q.unavailableReason ?? t("room.notAvailable")}</p>
              )}
            </div>
          )}
          {(quote.error || apply.error) && <p className="text-sm text-destructive">{errorMessage(quote.error ?? apply.error)}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          {q?.available ? (
            <Button onClick={() => apply.mutate()} disabled={apply.isPending}>
              {apply.isPending && <Spinner />} {q.requiresApproval ? t("manage.sendRequest") : t("manage.confirmChange")}
            </Button>
          ) : (
            <Button onClick={() => quote.mutate()} disabled={quote.isPending}>
              {quote.isPending && <Spinner />} {t("manage.checkPrice")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CancelDialog({ open, onOpenChange, booking, slug, phone, email }: { open: boolean; onOpenChange: (o: boolean) => void; booking: GuestBooking; slug: string; phone: string; email: string }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const qc = useQueryClient()
  const [reason, setReason] = useState("")
  const quote = useQuery({
    queryKey: ["cancel-quote", slug, booking.code],
    enabled: open,
    queryFn: () => api.post<RefundQuote>(`/api/public/${slug}/bookings/${booking.code}/cancel-quote`, { phone, email }),
  })
  const cancel = useMutation({
    mutationFn: () => api.post<{ message: string }>(`/api/public/${slug}/bookings/${booking.code}/cancel`, { phone, email, reason: reason || null }),
    onSuccess: (res) => {
      toast.success(res.message)
      void qc.invalidateQueries({ queryKey: ["guest-booking", slug, booking.code] })
      onOpenChange(false)
    },
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("manage.cancelTitle")}</DialogTitle>
          <DialogDescription>{t("manage.cancelDescription", { code: booking.code })}</DialogDescription>
        </DialogHeader>
        {quote.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : quote.data ? (
          <div className="rounded-lg bg-muted p-4 text-sm">
            <p className="text-sm text-muted-foreground">{t("manage.refundYouGet")}</p>
            <p className="mt-0.5 text-lg font-semibold tabular">{money(quote.data.refundAmount)}</p>
            <p className="mt-2 text-muted-foreground">{quote.data.explanation}</p>
            {quote.data.requiresApproval && <p className="mt-2 text-muted-foreground">{t("manage.cancelNeedsApproval")}</p>}
          </div>
        ) : quote.error ? (
          <p className="text-sm text-destructive">{errorMessage(quote.error)}</p>
        ) : null}
        <Field label={t("manage.reason")} optional>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {cancel.error && <p className="text-sm text-destructive">{errorMessage(cancel.error)}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("manage.keepBooking")}
          </Button>
          <Button variant="destructive" onClick={() => cancel.mutate()} disabled={cancel.isPending || !quote.data}>
            {cancel.isPending && <Spinner />} {quote.data?.requiresApproval ? t("manage.requestCancellation") : t("manage.cancelBooking")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function GuestBookingView({ booking, slug, phone, email }: { booking: GuestBooking; slug: string; phone: string; email: string }) {
  const { t } = useTranslation()
  const { home } = usePublic()
  const errorMessage = useErrorMessage()
  const qc = useQueryClient()
  const [changeOpen, setChangeOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const open = booking.payments.find((p) => p.status === "Created" && p.kind !== "Refund")
  const modifiable = ["Hold", "PendingDeposit", "Confirmed"].includes(booking.status) && new Date(booking.startAt) > new Date()

  const pay = useMutation({
    mutationFn: () => api.post<Payment>(`/api/public/${slug}/bookings/${booking.code}/pay`, { phone, email }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["guest-booking", slug, booking.code] }),
  })

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <div className="min-w-0 space-y-6">
        {booking.pendingRequest && (
          <div className="rounded-xl border bg-muted/50 px-4 py-3 text-sm">
            <p className="font-medium">{booking.pendingRequest.type === "Cancel" ? t("manage.pendingCancel") : t("manage.pendingChange")}</p>
            <p className="mt-0.5 text-muted-foreground">{t("manage.pendingHint")}</p>
          </div>
        )}
        {open ? (
          <PaymentCard slug={slug} payment={open} onPaid={() => void qc.invalidateQueries({ queryKey: ["guest-booking", slug, booking.code] })} />
        ) : booking.balance > 0 && ["Hold", "PendingDeposit", "Confirmed", "CheckedIn"].includes(booking.status) ? (
          <div className="flex flex-col gap-3 rounded-xl border p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-muted-foreground">{["Hold", "PendingDeposit"].includes(booking.status) ? t("payment.kind.Deposit") : t("payment.kind.Remaining")}</p>
              <p className="text-lg font-semibold tabular">{money(["Hold", "PendingDeposit"].includes(booking.status) ? booking.depositAmount : booking.balance)}</p>
            </div>
            <Button onClick={() => pay.mutate()} disabled={pay.isPending}>
              {pay.isPending && <Spinner />} {t("manage.payNow")}
            </Button>
          </div>
        ) : null}
        {pay.error && <p className="text-sm text-destructive">{errorMessage(pay.error)}</p>}

        {modifiable && !booking.pendingRequest && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setChangeOpen(true)}>
              {t("manage.change")}
            </Button>
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setCancelOpen(true)}>
              {t("manage.cancel")}
            </Button>
          </div>
        )}

        {booking.payments.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold">{t("manage.payments")}</h2>
            <ul className="mt-3 divide-y rounded-xl border">
              {booking.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                  <div>
                    <p>{t(`payment.kind.${p.kind}`)}</p>
                    <p className="text-xs text-muted-foreground">{dateTime(p.paidAt ?? p.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular">{p.kind === "Refund" ? `−${money(p.amount)}` : money(p.amount)}</span>
                    <StatusBadge status={p.status} kind="payment" />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <aside className="lg:sticky lg:top-24 lg:h-fit">
        <BookingSummaryCard booking={booking} tenant={home.tenant} />
      </aside>
      {modifiable && (
        <>
          <ChangeDialog open={changeOpen} onOpenChange={setChangeOpen} booking={booking} slug={slug} phone={phone} email={email} tenant={home.tenant} rooms={home.rooms} />
          <CancelDialog open={cancelOpen} onOpenChange={setCancelOpen} booking={booking} slug={slug} phone={phone} email={email} />
        </>
      )}
    </div>
  )
}

export default function ManageBooking() {
  const { slug } = usePublic()
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const [params, setParams] = useSearchParams()
  const initialCode = params.get("code") ?? ""
  const [lookup, setLookup] = useState<{ code: string; phone: string; email: string } | null>(() => {
    const rememberedPhone = initialCode ? sessionStorage.getItem(`stayra.booking.${initialCode}`) : null
    const rememberedEmail = initialCode ? sessionStorage.getItem(`stayra.booking.email.${initialCode}`) : null
    return rememberedPhone && rememberedEmail ? { code: initialCode, phone: rememberedPhone, email: rememberedEmail } : null
  })
  const booking = useGuestBooking(slug, lookup?.code ?? null, lookup?.phone ?? null, lookup?.email ?? null)

  const schema = z.object({
    code: z.string().trim().min(4, t("validation.required")),
    phone: z.string().refine((v) => vnPhone.test(normalizePhone(v)), t("validation.phone")),
    email: z.string().trim().email(t("validation.email")),
  })
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { code: initialCode, phone: "", email: "" } })

  useEffect(() => {
    if (booking.data && lookup) {
      rememberBookingPhone(booking.data.code, lookup.phone, lookup.email)
      if (params.get("code") !== booking.data.code) setParams({ code: booking.data.code }, { replace: true })
    }
  }, [booking.data, lookup, params, setParams])

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-8 sm:px-6">
      <h1 className="text-xl">{booking.data ? t("manage.bookingTitle", { code: booking.data.code }) : t("manage.title")}</h1>
      {!booking.data && <p className="mt-1 text-sm text-muted-foreground">{t("manage.description")}</p>}

      {booking.data && lookup ? (
        <div className="mt-8">
          <GuestBookingView booking={booking.data} slug={slug} phone={lookup.phone} email={lookup.email} />
          <Button variant="link" className="mt-8 px-0" onClick={() => { setLookup(null); form.reset({ code: "", phone: "", email: "" }) }}>
            {t("manage.lookupAnother")}
          </Button>
        </div>
      ) : (
        <form
          className="mt-8 max-w-md space-y-4"
          noValidate
          onSubmit={form.handleSubmit((v) => setLookup({ code: v.code.trim().toUpperCase(), phone: normalizePhone(v.phone), email: v.email.trim() }))}
        >
          <Field label={t("manage.code")} htmlFor="code" error={form.formState.errors.code?.message}>
            <Input id="code" placeholder="STR-7K3Q9P" className="uppercase" autoComplete="off" {...form.register("code")} />
          </Field>
          <Field label={t("book.email")} htmlFor="email" error={form.formState.errors.email?.message}>
            <Input id="email" type="email" inputMode="email" placeholder="ten@email.com" autoComplete="email" {...form.register("email")} />
          </Field>
          <Field label={t("book.phone")} htmlFor="phone" error={form.formState.errors.phone?.message}>
            <Input id="phone" type="tel" inputMode="tel" placeholder="0912 345 678" {...form.register("phone")} />
          </Field>
          {booking.error && (
            <p className="rounded-md bg-muted px-3 py-2.5 text-sm" role="alert">
              {errorMessage(booking.error)}
            </p>
          )}
          <Button type="submit" disabled={booking.isFetching}>
            {booking.isFetching && <Spinner />} {t("manage.find")}
          </Button>
        </form>
      )}
    </div>
  )
}

