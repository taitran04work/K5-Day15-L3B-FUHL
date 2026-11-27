import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Field, KeyValue, Spinner } from "@/components/common"
import { defaultStay, GuestStepper, HourPicker, ModeToggle, NightRangePicker, useBusy, type StayValue } from "@/components/booking/StayPicker"
import { api } from "@/lib/api"
import { money } from "@/lib/format"
import type { PublicTenant, Quote, Room } from "@/lib/types"

const vnPhone = /^(0|84)(3|5|7|8|9)\d{8}$/
const normalizePhone = (v: string) => v.replace(/[^\d]/g, "")

export function ChatBookingForm({
  slug,
  tenant,
  roomId,
  roomName,
  initialStay,
  onCancel,
  onSubmitBooking,
}: {
  slug: string
  tenant: PublicTenant
  roomId: string
  roomName: string
  initialStay?: Partial<StayValue>
  onCancel: () => void
  onSubmitBooking: (message: string) => void
}) {
  const { t, i18n } = useTranslation()
  const roomQuery = useQuery({
    queryKey: ["public-room", slug, roomId],
    queryFn: () => api.get<Room>(`/api/public/${slug}/rooms/${roomId}`),
  })
  const room = roomQuery.data
  const busy = useBusy(slug, roomId)

  const [stay, setStay] = useState<StayValue>(() => {
    const base = defaultStay(initialStay?.mode ?? "Nightly", tenant.openingTime)
    return {
      mode: initialStay?.mode ?? base.mode,
      start: initialStay?.start ?? base.start,
      end: initialStay?.end ?? base.end,
      guests: initialStay?.guests ?? base.guests,
    }
  })
  const [initializedRoom, setInitializedRoom] = useState<string | null>(null)

  useEffect(() => {
    if (!room || initializedRoom === room.id) return
    setInitializedRoom(room.id)
    const wantedMode = initialStay?.mode
    const initialMode =
      wantedMode === "Hourly" && room.supportsHourly
        ? "Hourly"
        : wantedMode === "Nightly" && room.supportsNightly
          ? "Nightly"
          : room.supportsNightly
            ? "Nightly"
            : "Hourly"
    const base = defaultStay(initialMode, tenant.openingTime)
    const canReuseDates = initialStay?.start && initialStay?.end && initialMode === wantedMode
    setStay({
      mode: initialMode,
      start: canReuseDates ? initialStay.start! : base.start,
      end: canReuseDates ? initialStay.end! : base.end,
      guests: Math.min(Math.max(1, initialStay?.guests ?? 2), room.maxGuests),
    })
  }, [room, initializedRoom, tenant.openingTime, initialStay])

  const quoteQuery = useQuery({
    queryKey: ["chat-quote", slug, roomId, stay],
    enabled: !!room,
    retry: false,
    queryFn: () => api.post<{ quote: Quote; available: boolean }>(`/api/public/${slug}/quote`, { ...stay, roomId }),
  })

  const schema = z.object({
    guestName: z.string().trim().min(2, t("validation.name_too_short")),
    guestPhone: z.string().refine((v) => vnPhone.test(normalizePhone(v)), t("validation.phone")),
    guestEmail: z.string().trim().email(t("validation.email")),
    note: z.string().max(500).optional(),
  })
  type FormValues = z.infer<typeof schema>
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { guestName: "", guestPhone: "", guestEmail: "", note: "" },
  })

  const switchMode = (m: "Nightly" | "Hourly") => {
    const next = defaultStay(m, tenant.openingTime)
    setStay({ ...next, guests: Math.min(stay.guests, room?.maxGuests ?? 2) })
  }

  const submit = form.handleSubmit((v) => {
    const isVi = i18n.language.startsWith("vi")
    const modeLabel = stay.mode === "Nightly" ? (isVi ? "Theo đêm" : "Nightly") : (isVi ? "Theo giờ" : "Hourly")
    const lines = isVi
      ? [
          `Tôi xác nhận đặt phòng ${room?.name ?? roomName} theo thông tin sau:`,
          `- Hình thức: ${modeLabel}`,
          `- Thời gian: ${stay.start} đến ${stay.end}`,
          `- Số khách: ${stay.guests}`,
          `- Họ tên: ${v.guestName.trim()}`,
          `- Số điện thoại: ${normalizePhone(v.guestPhone)}`,
          v.guestEmail.trim() ? `- Email: ${v.guestEmail.trim()}` : null,
          v.note?.trim() ? `- Ghi chú: ${v.note.trim()}` : null,
        ]
      : [
          `I confirm booking ${room?.name ?? roomName} with these details:`,
          `- Stay mode: ${modeLabel}`,
          `- Dates/times: ${stay.start} to ${stay.end}`,
          `- Guests: ${stay.guests}`,
          `- Full name: ${v.guestName.trim()}`,
          `- Phone: ${normalizePhone(v.guestPhone)}`,
          v.guestEmail.trim() ? `- Email: ${v.guestEmail.trim()}` : null,
          v.note?.trim() ? `- Special requests: ${v.note.trim()}` : null,
        ]
    onSubmitBooking(lines.filter(Boolean).join("\n"))
  })

  const q = quoteQuery.data?.quote
  const available = quoteQuery.data?.available ?? false

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onCancel}>
          <ArrowLeft className="size-3.5" /> {t("chat.backToChat")}
        </Button>
        <p className="min-w-0 flex-1 truncate text-right text-xs font-medium text-muted-foreground">
          {t("chat.bookingFormTitle", { name: room?.name ?? roomName })}
        </p>
      </div>

      <form onSubmit={submit} className="flex-1 space-y-3 overflow-y-auto px-4 py-3.5">
        {!room ? (
          <div className="space-y-2.5">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <>
            <ModeToggle value={stay.mode} onChange={switchMode} nightly={room.supportsNightly} hourly={room.supportsHourly} />

            {stay.mode === "Nightly" ? (
              <NightRangePicker
                start={stay.start}
                end={stay.end}
                bookedNights={busy.data?.bookedNights}
                onChange={(start, end) => setStay((s) => ({ ...s, start, end }))}
              />
            ) : (
              <HourPicker
                start={stay.start}
                end={stay.end}
                openingTime={tenant.openingTime}
                closingTime={tenant.closingTime}
                minHours={room.minHours}
                busy={busy.data?.busyRanges}
                onChange={(start, end) => setStay((s) => ({ ...s, start, end }))}
              />
            )}

            <GuestStepper value={stay.guests} max={room.maxGuests} onChange={(guests) => setStay((s) => ({ ...s, guests }))} />

            <div className="rounded-xl border bg-muted/30 px-3 py-2 text-xs">
              {quoteQuery.isLoading ? (
                <div className="flex items-center gap-2 py-1 text-muted-foreground">
                  <Spinner className="size-3.5" /> {t("chat.checkingQuote")}
                </div>
              ) : quoteQuery.error ? (
                <p className="text-destructive">{quoteQuery.error instanceof Error ? quoteQuery.error.message : t("room.notAvailable")}</p>
              ) : q && available ? (
                <dl>
                  <KeyValue label={t("booking.total")} className="font-semibold [&_dt]:text-foreground">
                    {money(q.total)}
                  </KeyValue>
                  <KeyValue label={t("booking.depositToday", { percent: q.depositPercent })}>{money(q.deposit)}</KeyValue>
                </dl>
              ) : (
                <p className="text-destructive">{t("room.notAvailable")}</p>
              )}
            </div>

            <div className="space-y-2.5 pt-1">
              <Field label={t("book.fullName")} error={form.formState.errors.guestName?.message}>
                <Input {...form.register("guestName")} placeholder="Nguyễn Văn A" autoComplete="name" className="h-9 text-sm" />
              </Field>
              <Field label={t("book.phone")} error={form.formState.errors.guestPhone?.message}>
                <Input {...form.register("guestPhone")} type="tel" placeholder="0912 345 678" autoComplete="tel" className="h-9 text-sm" />
              </Field>
              <Field label={t("book.email")} hint={t("book.emailHint")} error={form.formState.errors.guestEmail?.message}>
                <Input {...form.register("guestEmail")} type="email" placeholder="ten@email.com" autoComplete="email" className="h-9 text-sm" />
              </Field>
              <Field label={t("book.note")} optional error={form.formState.errors.note?.message}>
                <Textarea {...form.register("note")} rows={2} placeholder={t("book.noteHint")} className="min-h-14 text-sm" />
              </Field>
            </div>

            <div className="flex gap-2 pt-1 pb-2">
              <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" className="flex-[2]" disabled={!available || quoteQuery.isLoading || !q}>
                {t("chat.confirmAndBook")}
              </Button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}

