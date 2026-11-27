import { useState } from "react"
import { Link } from "react-router"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { QRCodeSVG } from "qrcode.react"
import { ExternalLink, QrCode } from "lucide-react"
import { Button } from "@/components/ui/button"
import { KeyValue, Spinner, StatusBadge } from "@/components/common"
import { Lightbox, PhotoTile, useDevConfig } from "@/components/booking/BookingParts"
import { api } from "@/lib/api"
import { useLocalizedFormat } from "@/lib/format"
import type { BookingMode, BookingStatus, CardData, Payment, Photo } from "@/lib/types"

type Any = Record<string, unknown>
const s = (v: unknown) => (typeof v === "string" ? v : "")
const n = (v: unknown) => (typeof v === "number" ? v : 0)

function RoomCards({ data, slug, onQuickReply }: { data: Any; slug: string; onQuickReply?: (text: string) => void }) {
  const { t } = useTranslation()
  const { money } = useLocalizedFormat()
  const rooms = (data.rooms as Any[]) ?? []
  return (
    <div className="-mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-1 scrollbar-none">
      {rooms.map((r) => (
        <div key={s(r.id)} className="w-[200px] shrink-0 snap-start overflow-hidden rounded-xl border bg-background">
          <PhotoTile url={s(r.coverUrl)} alt={s(r.name)} className="aspect-[4/3] w-full" />
          <div className="space-y-1 p-3">
            <p className="truncate text-sm font-medium">{s(r.name)}</p>
            <p className="text-xs text-muted-foreground">
              {r.total != null ? (
                <>
                  <span className="font-medium text-foreground tabular">{money(n(r.total))}</span> {t("chat.total")}
                </>
              ) : r.nightlyPrice != null ? (
                <>
                  <span className="font-medium text-foreground tabular">{money(n(r.nightlyPrice))}</span> {t("room.perNight")}
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground tabular">{money(n(r.hourlyPrice))}</span> {t("room.perHour")}
                </>
              )}
            </p>
            <div className="flex gap-1.5 pt-1">
              <Button asChild size="xs" variant="outline">
                <Link to={`/h/${slug}/rooms/${s(r.id)}`}>{t("chat.view")}</Link>
              </Button>
              {onQuickReply && (
                <Button size="xs" onClick={() => onQuickReply(t("chat.bookThis", { name: s(r.name) }))}>
                  {t("chat.choose")}
                </Button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function GalleryCard({ data }: { data: Any }) {
  const photos = ((data.photos as Any[]) ?? []).map((p, i) => ({ id: String(i), url: s(p.url), caption: (p.caption as string | null) ?? null, sortOrder: i, isCover: i === 0 })) as Photo[]
  const [index, setIndex] = useState<number | null>(null)
  return (
    <>
      <div className="grid grid-cols-3 gap-1.5 overflow-hidden rounded-xl">
        {photos.slice(0, 6).map((p, i) => (
          <PhotoTile key={p.id} url={p.url} alt={p.caption ?? s(data.roomName)} onClick={() => setIndex(i)} className="aspect-square w-full" />
        ))}
      </div>
      <Lightbox photos={photos} index={index} onIndex={setIndex} title={s(data.roomName)} />
    </>
  )
}

function QuoteCard({ data }: { data: Any }) {
  const { t } = useTranslation()
  const { money, stayLabel } = useLocalizedFormat()
  const mode = s(data.mode) as BookingMode
  return (
    <div className="rounded-xl border bg-background p-3.5">
      <p className="text-sm font-medium">{s(data.roomName)}</p>
      <p className="text-xs text-muted-foreground">
        {stayLabel(mode, s(data.startAt), s(data.endAt))} · {t("booking.guestsCount", { count: n(data.guests) })}
      </p>
      <dl className="mt-2.5 border-t pt-2">
        <KeyValue label={mode === "Nightly" ? t("booking.nightsCount", { count: n(data.units) }) : t("booking.hoursCount", { count: n(data.units) })}>{money(n(data.subtotal))}</KeyValue>
        {n(data.extraGuestFee) > 0 && <KeyValue label={t("booking.extraGuestFee")}>{money(n(data.extraGuestFee))}</KeyValue>}
        <KeyValue label={t("booking.total")} className="font-semibold [&_dt]:text-foreground">
          {money(n(data.total))}
        </KeyValue>
        <KeyValue label={t("booking.depositToday", { percent: n(data.depositPercent) })}>{money(n(data.deposit))}</KeyValue>
      </dl>
    </div>
  )
}

function BookingSummary({ data }: { data: Any }) {
  const { t } = useTranslation()
  const { money, stayLabel } = useLocalizedFormat()
  return (
    <div className="rounded-xl border bg-background p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-sm font-semibold tracking-wide">{s(data.code)}</p>
        <StatusBadge status={s(data.status) as BookingStatus} />
      </div>
      <p className="mt-1 text-sm">{s(data.roomName)}</p>
      <p className="text-xs text-muted-foreground">
        {stayLabel(s(data.mode) as BookingMode, s(data.startAt), s(data.endAt))} · {t("booking.guestsCount", { count: n(data.guests) })}
      </p>
      <dl className="mt-2.5 border-t pt-2">
        <KeyValue label={t("booking.total")}>{money(n(data.total))}</KeyValue>
        <KeyValue label={t("booking.paid")}>{money(n(data.paid))}</KeyValue>
        <KeyValue label={t("booking.balance")} className="font-semibold [&_dt]:text-foreground">
          {money(n(data.balance))}
        </KeyValue>
      </dl>
    </div>
  )
}

function PaymentBlock({ data, slug }: { data: Any; slug: string }) {
  const { t } = useTranslation()
  const { money } = useLocalizedFormat()
  const dev = useDevConfig()
  const qc = useQueryClient()
  const [showQr, setShowQr] = useState(false)
  const paymentId = s(data.paymentId)
  const status = useQuery({
    queryKey: ["payment", paymentId],
    queryFn: () => api.get<{ payment: Payment; bookingStatus: BookingStatus }>(`/api/public/${slug}/payments/${paymentId}`),
    refetchInterval: (q) => (q.state.data && q.state.data.payment.status !== "Created" ? false : 4000),
  })
  const p = status.data?.payment
  const current = p?.status ?? s(data.status)
  const payUrl = p?.payUrl ?? (data.payUrl as string | null)
  const qr = p?.qrCodeUrl ?? (data.qrCodeUrl as string | null) ?? payUrl
  const simulate = useMutation({
    mutationFn: () => api.post(`/api/dev/payments/${paymentId}/simulate-success`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payment", paymentId] }),
  })
  const label = t(`chat.pay${s(data.kind)}`, { amount: money(n(data.amount)), defaultValue: t("chat.payAmount", { amount: money(n(data.amount)) }) })

  return (
    <div className="rounded-xl border bg-background p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t(`payment.kind.${s(data.kind)}`)}</p>
        <StatusBadge status={current} kind="payment" />
      </div>
      <p className="mt-0.5 text-lg font-semibold tabular">{money(n(data.amount))}</p>
      {current === "Created" ? (
        <div className="mt-3 space-y-2">
          {payUrl && (
            <Button asChild className="w-full">
              <a href={payUrl} target="_blank" rel="noreferrer">
                {label} <ExternalLink />
              </a>
            </Button>
          )}
          {qr && (
            <Button variant="outline" className="w-full" onClick={() => setShowQr((v) => !v)}>
              <QrCode /> {showQr ? t("chat.hideQr") : t("chat.showQr")}
            </Button>
          )}
          {showQr && qr && (
            <div className="flex justify-center rounded-lg border bg-white p-3">
              <QRCodeSVG value={qr} size={156} marginSize={0} />
            </div>
          )}
          {dev.data?.devTools && (
            <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => simulate.mutate()} disabled={simulate.isPending}>
              {simulate.isPending && <Spinner />} {t("payment.simulate")}
            </Button>
          )}
        </div>
      ) : current === "Paid" ? (
        <p className="mt-2 text-sm text-muted-foreground">{t("payment.receivedHint")}</p>
      ) : null}
    </div>
  )
}

export function ChatCard({ card, slug, onQuickReply }: { card: CardData; slug: string; onQuickReply?: (text: string) => void }) {
  switch (card.type) {
    case "room_card":
      return <RoomCards data={card.data} slug={slug} onQuickReply={onQuickReply} />
    case "gallery":
      return <GalleryCard data={card.data} />
    case "quote":
      return <QuoteCard data={card.data} />
    case "booking_summary":
      return <BookingSummary data={card.data} />
    case "payment":
      return <PaymentBlock data={card.data} slug={slug} />
    default:
      return null
  }
}
