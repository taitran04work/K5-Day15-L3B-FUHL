import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Field, Spinner, useErrorMessage, useFieldError } from "@/components/common"
import { GuestStepper, HourPicker, ModeToggle, NightRangePicker, defaultStay, type StayValue } from "@/components/booking/StayPicker"
import { api } from "@/lib/api"
import { money } from "@/lib/format"
import type { Quote, Room, TenantSettings } from "@/lib/types"

export interface NewBookingPreset {
  roomId?: string
  stay?: StayValue
}

export function NewBookingDialog({ open, onOpenChange, preset, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; preset?: NewBookingPreset; onCreated?: (id: string) => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const fieldError = useFieldError()
  const errorMessage = useErrorMessage()
  const rooms = useQuery({ queryKey: ["rooms"], queryFn: () => api.get<Room[]>("/api/app/rooms") })
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<TenantSettings>("/api/app/settings") })
  const activeRooms = (rooms.data ?? []).filter((r) => r.isActive)
  const [roomId, setRoomId] = useState("")
  const [stay, setStay] = useState<StayValue>(defaultStay())
  const [guest, setGuest] = useState({ name: "", phone: "", email: "", note: "" })
  const [confirmed, setConfirmed] = useState(true)
  const [paid, setPaid] = useState("")

  useEffect(() => {
    if (!open) return
    setRoomId(preset?.roomId ?? "")
    setStay(preset?.stay ?? defaultStay())
    setGuest({ name: "", phone: "", email: "", note: "" })
    setPaid("")
    setConfirmed(true)
  }, [open, preset])

  const room = activeRooms.find((r) => r.id === roomId) ?? activeRooms[0]
  const effectiveRoomId = room?.id ?? ""

  const quote = useQuery({
    queryKey: ["owner-quote", effectiveRoomId, stay],
    enabled: open && !!effectiveRoomId,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: () => api.post<{ quote: Quote; available: boolean }>("/api/app/bookings/quote", { roomId: effectiveRoomId, ...stay, guestName: "", guestPhone: "", markConfirmed: false }),
  })

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>("/api/app/bookings", {
        roomId: effectiveRoomId,
        ...stay,
        guestName: guest.name,
        guestPhone: guest.phone,
        guestEmail: guest.email || null,
        note: guest.note || null,
        markConfirmed: confirmed,
        amountPaid: paid ? Number(paid) : null,
      }),
    onSuccess: (b) => {
      toast.success(t("bookings.created"))
      void qc.invalidateQueries({ queryKey: ["bookings"] })
      void qc.invalidateQueries({ queryKey: ["calendar"] })
      onOpenChange(false)
      onCreated?.(b.id)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("bookings.newTitle")}</DialogTitle>
          <DialogDescription>{t("bookings.newDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-4">
            <Field label={t("bookings.room")}>
              <Select value={effectiveRoomId} onValueChange={setRoomId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("bookings.chooseRoom")} />
                </SelectTrigger>
                <SelectContent>
                  {activeRooms.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {room && <ModeToggle value={stay.mode} nightly={room.supportsNightly} hourly={room.supportsHourly} onChange={(m) => setStay({ ...defaultStay(m, settings.data?.openingTime), guests: stay.guests })} />}
            {stay.mode === "Nightly" ? (
              <NightRangePicker start={stay.start} end={stay.end} onChange={(s, e) => setStay({ ...stay, start: s, end: e })} />
            ) : (
              <HourPicker
                start={stay.start}
                end={stay.end}
                openingTime={settings.data?.openingTime ?? "07:00"}
                closingTime={settings.data?.closingTime ?? "23:00"}
                minHours={room?.minHours ?? 1}
                onChange={(s, e) => setStay({ ...stay, start: s, end: e })}
              />
            )}
            <GuestStepper value={stay.guests} max={room?.maxGuests ?? 10} onChange={(g) => setStay({ ...stay, guests: g })} />
            <div className="rounded-lg bg-muted px-4 py-3 text-sm">
              {quote.error ? (
                <span className="text-muted-foreground">{errorMessage(quote.error)}</span>
              ) : quote.data ? (
                <div className="flex items-baseline justify-between gap-3">
                  <span className={quote.data.available ? "text-muted-foreground" : "text-destructive"}>
                    {quote.data.available ? t("bookings.available") : t("room.notAvailable")}
                  </span>
                  <span className="font-semibold tabular">{money(quote.data.quote.total)}</span>
                </div>
              ) : (
                <span className="text-muted-foreground">{t("common.loading")}</span>
              )}
            </div>
          </div>
          <div className="space-y-4">
            <Field label={t("bookings.name")} error={fieldError(create.error, "guestName")}>
              <Input value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} />
            </Field>
            <Field label={t("bookings.phone")} error={fieldError(create.error, "guestPhone")}>
              <Input type="tel" value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} placeholder="0912 345 678" />
            </Field>
            <Field label={t("bookings.email")} optional>
              <Input type="email" value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} />
            </Field>
            <Field label={t("bookings.amountPaid")} optional hint={t("bookings.amountPaidHint")}>
              <Input type="number" min={0} step={1000} value={paid} onChange={(e) => setPaid(e.target.value)} className="tabular" />
            </Field>
            <div className="flex items-start gap-2.5">
              <Checkbox id="confirmed" checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} />
              <Label htmlFor="confirmed" className="font-normal leading-snug">
                {t("bookings.markConfirmedNow")}
              </Label>
            </div>
          </div>
        </div>
        {create.error && !fieldError(create.error, "guestName") && !fieldError(create.error, "guestPhone") && <p className="text-sm text-destructive">{errorMessage(create.error)}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !quote.data?.available}>
            {create.isPending && <Spinner />} {t("bookings.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
