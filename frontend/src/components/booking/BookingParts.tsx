import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { QRCodeSVG } from "qrcode.react"
import { ChevronLeft, ChevronRight, ExternalLink, ImageOff } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { KeyValue, Spinner, StatusBadge } from "@/components/common"
import { api } from "@/lib/api"
import { useLocalizedFormat } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { BookingStatus, Payment, Photo, Quote } from "@/lib/types"

export function useDevConfig() {
  return useQuery({
    queryKey: ["dev-config"],
    queryFn: () => api.get<{ devTools: boolean; aiEnabled: boolean; embeddingsEnabled: boolean }>("/api/dev/config"),
    staleTime: Infinity,
  })
}

export function QuoteSummary({ quote, compact }: { quote: Quote; compact?: boolean }) {
  const { t } = useTranslation()
  const { money } = useLocalizedFormat()
  const unit = quote.mode === "Nightly" ? t("booking.nightsCount", { count: quote.units }) : t("booking.hoursCount", { count: quote.units })
  const grouped = new Map<number, number>()
  for (const l of quote.lines) grouped.set(l.price, (grouped.get(l.price) ?? 0) + 1)
  return (
    <dl className="divide-y text-sm">
      <div className="pb-2">
        {compact ? (
          <KeyValue label={unit}>{money(quote.subtotal)}</KeyValue>
        ) : (
          [...grouped.entries()].map(([price, n]) => (
            <KeyValue key={price} label={`${money(price)} × ${quote.mode === "Nightly" ? t("booking.nightsCount", { count: n }) : t("booking.hoursCount", { count: n })}`}>
              {money(price * n)}
            </KeyValue>
          ))
        )}
        {quote.extraGuestFee > 0 && <KeyValue label={t("booking.extraGuestFee")}>{money(quote.extraGuestFee)}</KeyValue>}
      </div>
      <div className="pt-2">
        <KeyValue label={t("booking.total")} className="font-semibold [&_dt]:text-foreground">
          {money(quote.total)}
        </KeyValue>
        <KeyValue label={t("booking.depositToday", { percent: quote.depositPercent })}>{money(quote.deposit)}</KeyValue>
      </div>
    </dl>
  )
}

/** Countdown "14:59" until a hold/payment expires. */
export function Countdown({ until, onExpire }: { until: string; onExpire?: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const left = Math.max(0, new Date(until).getTime() - now)
  useEffect(() => {
    if (left === 0) onExpire?.()
  }, [left, onExpire])
  const m = Math.floor(left / 60000)
  const s = Math.floor((left % 60000) / 1000)
  return <span className="tabular">{`${m}:${String(s).padStart(2, "0")}`}</span>
}

/**
 * VNPay payment card: amount, QR (scan to open VNPay), "Pay with VNPay" button, live status polling,
 * and a "Simulate payment" button in development so the demo never depends on the network.
 */
export function PaymentCard({ slug, payment, onPaid, className }: { slug: string; payment: Payment; onPaid?: (bookingStatus: BookingStatus) => void; className?: string }) {
  const { t } = useTranslation()
  const { money } = useLocalizedFormat()
  const dev = useDevConfig()
  const qc = useQueryClient()
  const status = useQuery({
    queryKey: ["payment", payment.id],
    queryFn: () => api.get<{ payment: Payment; bookingStatus: BookingStatus; bookingCode: string }>(`/api/public/${slug}/payments/${payment.id}`),
    refetchInterval: (q) => (q.state.data?.payment.status === "Created" || !q.state.data ? 3000 : false),
  })
  const current = status.data?.payment ?? payment
  const paid = current.status === "Paid"

  useEffect(() => {
    if (paid && status.data) onPaid?.(status.data.bookingStatus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paid])

  const simulate = useMutation({
    mutationFn: () => api.post<Payment>(`/api/dev/payments/${payment.id}/simulate-success`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payment", payment.id] }),
    onError: () => toast.error(t("common.errorDescription")),
  })

  const qrValue = current.qrCodeUrl || current.payUrl
  const label = t(`payment.kind.${current.kind}`)

  return (
    <div className={cn("rounded-xl border bg-card", className)}>
      <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold tabular">{money(current.amount)}</p>
        </div>
        <StatusBadge status={current.status} kind="payment" />
      </div>
      {paid ? (
        <div className="px-5 py-6 text-center">
          <p className="text-base font-medium">{t("payment.received")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("payment.receivedHint")}</p>
        </div>
      ) : current.status === "Created" ? (
        <div className="grid gap-5 px-5 py-5 sm:grid-cols-[auto_1fr] sm:items-center">
          {qrValue ? (
            <div className="mx-auto rounded-lg border bg-white p-3">
              <QRCodeSVG value={qrValue} size={148} level="M" marginSize={0} />
            </div>
          ) : (
            <div className="mx-auto flex size-[174px] items-center justify-center rounded-lg border border-dashed px-4 text-center text-xs text-muted-foreground">
              {t("payment.qrUnavailable")}
            </div>
          )}
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("payment.scanHint")}</p>
            {current.payUrl && (
              <Button asChild className="w-full">
                <a href={current.payUrl} target="_blank" rel="noreferrer">
                  {t("payment.payWithVnpay")} <ExternalLink />
                </a>
              </Button>
            )}
            {dev.data?.devTools && (
              <Button variant="outline" className="w-full" onClick={() => simulate.mutate()} disabled={simulate.isPending}>
                {simulate.isPending && <Spinner />} {t("payment.simulate")}
              </Button>
            )}
            {current.expiresAt && (
              <p className="text-xs text-muted-foreground">
                {t("payment.expiresIn")} <Countdown until={current.expiresAt} onExpire={() => void status.refetch()} />
              </p>
            )}
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="size-3" /> {t("payment.waiting")}
            </p>
          </div>
        </div>
      ) : (
        <div className="px-5 py-6 text-center text-sm text-muted-foreground">{t(`payment.statusHint.${current.status}`)}</div>
      )}
    </div>
  )
}

export function PhotoTile({ url, alt, className, onClick }: { url?: string | null; alt: string; className?: string; onClick?: () => void }) {
  const [failed, setFailed] = useState(false)
  const Comp = onClick ? "button" : "div"
  return (
    <Comp type={onClick ? "button" : undefined} onClick={onClick} className={cn("relative block overflow-hidden bg-muted", onClick && "group", className)}>
      {url && !failed ? (
        <img src={url} alt={alt} loading="lazy" onError={() => setFailed(true)} className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
      ) : (
        <span className="flex size-full items-center justify-center text-subtle">
          <ImageOff className="size-5" aria-hidden />
        </span>
      )}
    </Comp>
  )
}

/** Airbnb-style mosaic: one large photo + up to four small ones. Opens a lightbox. */
export function Gallery({ photos, title }: { photos: Photo[]; title: string }) {
  const { t } = useTranslation()
  const [index, setIndex] = useState<number | null>(null)
  const list = photos.length ? photos : [{ id: "none", url: "", caption: null, sortOrder: 0, isCover: true }]
  const main = list[0]
  const rest = list.slice(1, 5)
  return (
    <>
      <div className={cn("grid gap-2 overflow-hidden rounded-2xl", rest.length ? "md:grid-cols-4 md:grid-rows-2" : "")} style={{ height: "min(56vw, 460px)" }}>
        <PhotoTile url={main.url} alt={main.caption ?? title} onClick={() => setIndex(0)} className={cn("size-full", rest.length && "md:col-span-2 md:row-span-2")} />
        {rest.map((p, i) => (
          <PhotoTile
            key={p.id}
            url={p.url}
            alt={p.caption ?? title}
            onClick={() => setIndex(i + 1)}
            className={cn(
              "hidden size-full md:block",
              rest.length === 1 && "md:col-span-2 md:row-span-2",
              rest.length === 2 && "md:col-span-2",
              rest.length === 3 && i === 2 && "md:col-span-2",
            )}
          />
        ))}
      </div>
      {photos.length > 1 && (
        <div className="mt-3 flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setIndex(0)}>
            {t("room.showAllPhotos", { count: photos.length })}
          </Button>
        </div>
      )}
      <Lightbox photos={photos} index={index} onIndex={setIndex} title={title} />
    </>
  )
}

export function Lightbox({ photos, index, onIndex, title }: { photos: Photo[]; index: number | null; onIndex: (i: number | null) => void; title: string }) {
  const { t } = useTranslation()
  const open = index !== null && photos.length > 0
  const p = open ? photos[index] : null
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") onIndex(((index ?? 0) + 1) % photos.length)
      if (e.key === "ArrowLeft") onIndex(((index ?? 0) - 1 + photos.length) % photos.length)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, index, photos.length, onIndex])
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onIndex(null)}>
      <DialogContent className="max-w-[min(1100px,calc(100%-2rem))] gap-0 border-0 bg-black p-0 sm:max-w-[min(1100px,calc(100%-2rem))] [&>button]:text-white">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {p && (
          <figure className="relative">
            <img src={p.url} alt={p.caption ?? title} className="max-h-[80dvh] w-full rounded-t-xl object-contain" />
            <figcaption className="flex items-center justify-between gap-4 px-4 py-3 text-sm text-white/80">
              <span>{p.caption ?? title}</span>
              <span className="tabular">
                {(index ?? 0) + 1} / {photos.length}
              </span>
            </figcaption>
            {photos.length > 1 && (
              <>
                <button
                  className="absolute left-3 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-foreground hover:bg-white"
                  onClick={() => onIndex(((index ?? 0) - 1 + photos.length) % photos.length)}
                  aria-label={t("room.previousPhoto")}
                >
                  <ChevronLeft className="size-5" />
                </button>
                <button
                  className="absolute right-3 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-foreground hover:bg-white"
                  onClick={() => onIndex(((index ?? 0) + 1) % photos.length)}
                  aria-label={t("room.nextPhoto")}
                >
                  <ChevronRight className="size-5" />
                </button>
              </>
            )}
          </figure>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function AmenityList({ amenities, className }: { amenities: string[]; className?: string }) {
  const { t } = useTranslation()
  if (!amenities.length) return null
  return (
    <ul className={cn("grid grid-cols-1 gap-x-8 gap-y-2.5 sm:grid-cols-2", className)}>
      {amenities.map((a) => (
        <li key={a} className="flex items-center gap-3 text-sm">
          <span className="size-1.5 shrink-0 rounded-full bg-foreground/40" aria-hidden />
          {t(`amenity.${a}`, { defaultValue: a.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) })}
        </li>
      ))}
    </ul>
  )
}

export const AMENITY_KEYS = [
  "wifi", "ac", "heater", "hot_water", "balcony", "bathtub", "kitchenette", "kettle", "coffee", "parking",
  "mountain_view", "valley_view", "garden_view", "sea_view", "lake_view", "tv", "workspace", "breakfast",
]
