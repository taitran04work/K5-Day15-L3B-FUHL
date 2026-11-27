import { useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Check, ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState, Field, Spinner, useErrorMessage } from "@/components/common"
import { Countdown, PaymentCard, PhotoTile, QuoteSummary } from "@/components/booking/BookingParts"
import { api, ApiError } from "@/lib/api"
import { money, stayLabel } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { BookingMode, GuestBooking, Payment, Quote, Room } from "@/lib/types"
import { usePublic } from "./PublicLayout"

export const vnPhone = /^(0|84)(3|5|7|8|9)\d{8}$/
export const normalizePhone = (v: string) => v.replace(/[^\d]/g, "")

export function rememberBookingPhone(code: string, phone: string, email?: string | null) {
  sessionStorage.setItem(`stayra.booking.${code}`, phone)
  if (email) sessionStorage.setItem(`stayra.booking.email.${code}`, email)
}

type Step = "details" | "review" | "pay"

export default function BookPage() {
  const { home, slug } = usePublic()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const errorMessage = useErrorMessage()
  const [params] = useSearchParams()
  const roomId = params.get("room") ?? ""
  const stay = {
    mode: (params.get("mode") ?? "Nightly") as BookingMode,
    start: params.get("start") ?? "",
    end: params.get("end") ?? "",
    guests: Number(params.get("guests") ?? 2),
  }
  const [step, setStep] = useState<Step>("details")
  const [created, setCreated] = useState<{ booking: GuestBooking; deposit: Payment | null; phone: string } | null>(null)

  const schema = z.object({
    guestName: z.string().trim().min(2, t("validation.name_too_short")),
    guestPhone: z.string().refine((v) => vnPhone.test(normalizePhone(v)), t("validation.phone")),
    guestEmail: z.string().trim().email(t("validation.email")),
    note: z.string().max(1000).optional(),
  })
  type FormValues = z.infer<typeof schema>
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { guestName: "", guestPhone: "", guestEmail: "", note: "" } })

  const room = useQuery({ queryKey: ["public-room", slug, roomId], enabled: !!roomId, queryFn: () => api.get<Room>(`/api/public/${slug}/rooms/${roomId}`) })
  const quote = useQuery({
    queryKey: ["quote", slug, roomId, stay],
    enabled: !!roomId && !created,
    retry: false,
    queryFn: () => api.post<{ quote: Quote; available: boolean }>(`/api/public/${slug}/quote`, { ...stay, roomId }),
  })

  const create = useMutation({
    mutationFn: (v: FormValues) =>
      api.post<{ booking: GuestBooking; deposit: Payment | null; phone: string }>(`/api/public/${slug}/bookings`, {
        roomId,
        ...stay,
        guestName: v.guestName,
        guestPhone: v.guestPhone,
        guestEmail: v.guestEmail.trim(),
        note: v.note || null,
      }),
    onSuccess: (res) => {
      rememberBookingPhone(res.booking.code, res.phone, form.getValues("guestEmail").trim())
      setCreated(res)
      if (!res.deposit) navigate(`/h/${slug}/booking/${res.booking.code}`)
      else setStep("pay")
      window.scrollTo({ top: 0 })
    },
    onError: (err) => {
      if (err instanceof ApiError && err.errors.guestPhone) form.setError("guestPhone", { message: t("validation.phone") })
    },
  })

  if (!roomId || !stay.start) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20">
        <ErrorState />
      </div>
    )
  }

  const steps: { id: Step; label: string }[] = [
    { id: "details", label: t("book.stepDetails") },
    { id: "review", label: t("book.stepReview") },
    { id: "pay", label: t("book.stepPay") },
  ]
  const stepIndex = steps.findIndex((s) => s.id === step)
  const q = quote.data?.quote
  const values = form.getValues()

  return (
    <div className="mx-auto max-w-2xl px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
      {step !== "pay" && (
        <button
          type="button"
          onClick={() => (step === "review" ? setStep("details") : navigate(-1))}
          className="group inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
          <span>{t("common.back")}</span>
        </button>
      )}

      <h1 className="mt-4 font-editorial text-3xl font-normal tracking-tight sm:text-4xl">
        {step === "pay" ? t("book.payTitle") : t("book.title")}
      </h1>

      <ol className="mt-6 flex items-center gap-2 text-sm" aria-label={t("book.progress")}>
        {steps.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular transition-colors",
                i < stepIndex && "border-brand bg-brand text-brand-foreground",
                i === stepIndex && "border-foreground bg-foreground text-background",
                i > stepIndex && "text-muted-foreground",
              )}
              aria-current={i === stepIndex ? "step" : undefined}
            >
              {i < stepIndex ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={i === stepIndex ? "font-medium text-foreground" : "sr-only text-muted-foreground sm:not-sr-only"}>{s.label}</span>
            {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-border sm:w-10" aria-hidden />}
          </li>
        ))}
      </ol>

      {/* Single-column clear reservation summary with prominent total */}
      <section className="mt-8 overflow-hidden rounded-2xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b px-5 py-4">
          <div className="flex min-w-0 items-center gap-4">
            {room.data ? (
              <PhotoTile url={room.data.coverUrl} alt={room.data.name} className="size-16 shrink-0 rounded-xl" />
            ) : (
              <Skeleton className="size-16 shrink-0 rounded-xl" />
            )}
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{t("book.summary")}</p>
              {room.data ? (
                <>
                  <p className="mt-0.5 truncate font-editorial text-xl font-normal text-foreground">{room.data.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {[q ? stayLabel(q.mode, q.startAt, q.endAt) : null, t("booking.guestsCount", { count: stay.guests })].filter(Boolean).join(" · ")}
                  </p>
                </>
              ) : (
                <div className="mt-1 space-y-2">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-3.5 w-28" />
                </div>
              )}
            </div>
          </div>

          {q && (
            <div className="text-left sm:text-right">
              <p className="text-xs text-muted-foreground">{t("booking.total")}</p>
              <p className="text-xl font-semibold tabular text-foreground">{money(q.total)}</p>
            </div>
          )}
        </div>

        <div className="bg-muted/35 px-5 py-4">
          {q ? (
            <QuoteSummary quote={q} />
          ) : quote.error ? (
            <p className="text-sm text-destructive">{errorMessage(quote.error)}</p>
          ) : (
            <Skeleton className="h-16 w-full" />
          )}
          {quote.data && !quote.data.available && !created && (
            <p className="mt-3 text-sm font-medium text-destructive">{t("room.notAvailable")}</p>
          )}
        </div>
      </section>

      {/* Active step panel */}
      <div className="mt-8">
        {step === "details" && (
          <form
            className="space-y-5 rounded-2xl border bg-card p-6 sm:p-7"
            onSubmit={form.handleSubmit(() => setStep("review"))}
            noValidate
          >
            <Field label={t("book.fullName")} htmlFor="guestName" error={form.formState.errors.guestName?.message}>
              <Input id="guestName" autoComplete="name" className="h-10 bg-background" {...form.register("guestName")} aria-invalid={!!form.formState.errors.guestName} />
            </Field>
            <Field label={t("book.phone")} htmlFor="guestPhone" error={form.formState.errors.guestPhone?.message} hint={t("book.phoneHint")}>
              <Input id="guestPhone" type="tel" inputMode="tel" autoComplete="tel" placeholder="0912 345 678" className="h-10 bg-background" {...form.register("guestPhone")} aria-invalid={!!form.formState.errors.guestPhone} />
            </Field>
            <Field label={t("book.email")} htmlFor="guestEmail" hint={t("book.emailHint")} error={form.formState.errors.guestEmail?.message}>
              <Input id="guestEmail" type="email" autoComplete="email" className="h-10 bg-background" {...form.register("guestEmail")} />
            </Field>
            <Field label={t("book.note")} htmlFor="note" optional hint={t("book.noteHint")}>
              <Textarea id="note" rows={3} className="bg-background" {...form.register("note")} />
            </Field>
            <Button type="submit" size="lg" className="h-11 w-full rounded-xl sm:w-auto sm:px-8">
              {t("common.continue")}
            </Button>
          </form>
        )}

        {step === "review" && (
          <div className="space-y-6 rounded-2xl border bg-card p-6 sm:p-7">
            <dl className="divide-y border-y">
              {[
                [t("book.guest"), values.guestName],
                [t("book.phone"), values.guestPhone],
                values.guestEmail ? [t("book.email"), values.guestEmail] : null,
                values.note ? [t("book.note"), values.note] : null,
              ]
                .filter((x): x is string[] => !!x)
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-6 py-3.5 text-sm">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="text-right font-medium text-foreground">{v}</dd>
                  </div>
                ))}
            </dl>

            {home.cancellation && (
              <div>
                <h2 className="font-editorial text-xl font-normal">{t("public.cancellationTitle")}</h2>
                <ul className="mt-2.5 space-y-1.5 text-sm text-muted-foreground">
                  {home.cancellation.rules.map((r, i) => (
                    <li key={i}>
                      {r.label}:{" "}
                      <span className="text-foreground">
                        {r.refundPercent > 0
                          ? t("public.refundOf", { percent: r.refundPercent, of: r.appliesTo === "Deposit" ? t("public.ofDeposit") : t("public.ofTotal") })
                          : t("public.noRefund")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-sm text-muted-foreground">{t("book.holdNotice", { minutes: home.tenant.holdMinutes })}</p>

            {create.error && (
              <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
                {errorMessage(create.error)}
              </p>
            )}

            <Button
              size="lg"
              className="h-11 w-full rounded-xl sm:w-auto sm:px-8"
              onClick={() => create.mutate(form.getValues())}
              disabled={create.isPending || !quote.data?.available}
            >
              {create.isPending && <Spinner />} {q ? t("book.reserveAndPay", { amount: money(q.deposit) }) : t("common.continue")}
            </Button>
          </div>
        )}

        {step === "pay" && created?.deposit && (
          <div className="space-y-5">
            <div className="rounded-2xl border bg-card px-5 py-4 text-sm">
              <p>
                {t("book.heldFor", { code: created.booking.code })}{" "}
                {created.booking.holdExpiresAt && (
                  <span className="font-semibold text-brand">
                    <Countdown until={created.booking.holdExpiresAt} />
                  </span>
                )}
              </p>
            </div>
            <PaymentCard slug={slug} payment={created.deposit} onPaid={() => navigate(`/h/${slug}/booking/${created.booking.code}`)} />
            <p className="text-xs text-muted-foreground">
              {t("book.payLater")}{" "}
              <Link className="underline underline-offset-4 hover:text-foreground" to={`/h/${slug}/manage?code=${created.booking.code}`}>
                {t("public.manageBooking")}
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
