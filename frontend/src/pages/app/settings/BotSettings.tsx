import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { AlertTriangle, Bot, Clock, ShieldCheck, SlidersHorizontal, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Page } from "@/components/layout/AppShell"
import { ErrorState, Field, PageHeader, Section, Spinner, Stat, useErrorMessage, useFieldError } from "@/components/common"
import { useDevConfig } from "@/components/booking/BookingParts"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { LowerPriceHandling, RemainingPaymentTrigger, TenantSettings } from "@/lib/types"

function ToggleRow({ id, label, hint, checked, onChange }: { id: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-6 py-4 first:pt-0 last:pb-0">
      <Label htmlFor={id} className="flex-1 cursor-pointer font-normal">
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-sm text-muted-foreground">{hint}</span>
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: () => api.get<TenantSettings>("/api/app/settings") })
}

export default function BotSettings() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const settings = useSettings()
  const dev = useDevConfig()
  const fieldError = useFieldError()
  const errorMessage = useErrorMessage()
  const [s, setS] = useState<TenantSettings | null>(null)
  useEffect(() => {
    if (settings.data) setS(settings.data)
  }, [settings.data])

  const saveBot = useMutation({
    mutationFn: () => api.put<TenantSettings>("/api/app/settings/bot", { botEnabled: s!.botEnabled, botPersona: s!.botPersona, autoApproveChanges: s!.autoApproveChanges, autoApproveCancellations: s!.autoApproveCancellations, defaultLanguage: s!.defaultLanguage }),
  })
  const saveBooking = useMutation({
    mutationFn: () =>
      api.put<TenantSettings>("/api/app/settings/booking", {
        checkInTime: s!.checkInTime, checkOutTime: s!.checkOutTime, openingTime: s!.openingTime, closingTime: s!.closingTime,
        cleaningBufferMinutes: s!.cleaningBufferMinutes, depositPercent: s!.depositPercent, remainingPaymentTrigger: s!.remainingPaymentTrigger,
        remainingPaymentHours: s!.remainingPaymentHours, remainingReminderHours: s!.remainingReminderHours, holdMinutes: s!.holdMinutes, lowerPriceHandling: s!.lowerPriceHandling,
      }),
  })
  const save = async () => {
    try {
      await saveBot.mutateAsync()
      const res = await saveBooking.mutateAsync()
      qc.setQueryData(["settings"], res)
      toast.success(t("common.saved"))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  if (settings.error) return <Page><ErrorState error={settings.error} onRetry={() => void settings.refetch()} /></Page>
  if (!s) {
    return (
      <Page>
        <Skeleton className="h-8 w-48" />
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[92px] rounded-xl" />
          ))}
        </div>
        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </Page>
    )
  }

  const set = <K extends keyof TenantSettings>(k: K, v: TenantSettings[K]) => setS({ ...s, [k]: v })
  const pending = saveBot.isPending || saveBooking.isPending
  const err = saveBooking.error

  return (
    <Page>
      <PageHeader
        title={t("botSettings.title")}
        description={t("botSettings.description")}
        actions={
          <Button onClick={() => void save()} disabled={pending}>
            {pending && <Spinner />} {t("common.saveChanges")}
          </Button>
        }
      />

      <div className="space-y-6">
        {/* Offline AI notice banner when ANTHROPIC_API_KEY is missing */}
        {dev.data && !dev.data.aiEnabled && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/80 px-5 py-4 text-sm text-amber-900 dark:border-warning/30 dark:bg-warning/10 dark:text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-warning" aria-hidden />
            <div>
              <span className="font-medium">{t("botSettings.offlineTitle")}:</span>{" "}
              <span>{t("botSettings.offlineBody")}</span>
            </div>
          </div>
        )}

        {/* At-a-glance summary cards matching Overview */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label={t("botSettings.assistant")}
            value={
              <span className="inline-flex items-center gap-2">
                <span className={cn("size-2.5 rounded-full", s.botEnabled ? "bg-brand" : "bg-muted-foreground/40")} />
                <span>{s.botEnabled ? t("botSettings.enabled") : t("rooms.hidden")}</span>
              </span>
            }
            hint={s.defaultLanguage === "vi" ? "Tiếng Việt" : "English"}
          />
          <Stat
            label={t("botSettings.deposit")}
            value={`${s.depositPercent}%`}
            hint={`${t("botSettings.hold")}: ${s.holdMinutes}`}
          />
          <Stat
            label={t("botSettings.times")}
            value={`${s.checkInTime} – ${s.checkOutTime}`}
            hint={`${t("botSettings.opening")}: ${s.openingTime} – ${s.closingTime}`}
          />
          <Stat
            label={t("botSettings.automation")}
            value={[s.autoApproveChanges, s.autoApproveCancellations].filter(Boolean).length + " / 2"}
            hint={s.lowerPriceHandling === "Refund" ? t("botSettings.lowerRefund") : t("botSettings.lowerCredit")}
          />
        </div>

        {/* Balanced 2-column workspace layout */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 xl:items-start">
          <div className="space-y-6">
            <Section
              title={t("botSettings.assistant")}
              actions={<Bot className="size-4 text-muted-foreground" aria-hidden />}
            >
              <div className="divide-y">
                <ToggleRow
                  id="bot"
                  label={t("botSettings.enabled")}
                  hint={t("botSettings.enabledHint")}
                  checked={s.botEnabled}
                  onChange={(v) => set("botEnabled", v)}
                />
                <div className="py-4">
                  <Field label={t("botSettings.persona")} hint={t("botSettings.personaHint")}>
                    <Textarea
                      rows={3}
                      value={s.botPersona ?? ""}
                      onChange={(e) => set("botPersona", e.target.value)}
                      placeholder={t("botSettings.personaPlaceholder")}
                    />
                  </Field>
                </div>
                <div className="pt-4">
                  <Field label={t("botSettings.language")} hint={t("botSettings.languageHint")}>
                    <Select value={s.defaultLanguage} onValueChange={(v) => set("defaultLanguage", v)}>
                      <SelectTrigger className="w-full sm:w-64">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="vi">Tiếng Việt</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </div>
            </Section>

            <Section
              title={t("botSettings.automation")}
              actions={<SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden />}
            >
              <div className="divide-y">
                <ToggleRow
                  id="changes"
                  label={t("botSettings.autoChanges")}
                  hint={t("botSettings.autoChangesHint")}
                  checked={s.autoApproveChanges}
                  onChange={(v) => set("autoApproveChanges", v)}
                />
                <ToggleRow
                  id="cancels"
                  label={t("botSettings.autoCancels")}
                  hint={t("botSettings.autoCancelsHint")}
                  checked={s.autoApproveCancellations}
                  onChange={(v) => set("autoApproveCancellations", v)}
                />
                <div className="pt-4">
                  <Field label={t("botSettings.lowerPrice")} hint={t("botSettings.lowerPriceHint")}>
                    <Select value={s.lowerPriceHandling} onValueChange={(v) => set("lowerPriceHandling", v as LowerPriceHandling)}>
                      <SelectTrigger className="w-full sm:w-80">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Refund">{t("botSettings.lowerRefund")}</SelectItem>
                        <SelectItem value="Credit">{t("botSettings.lowerCredit")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </div>
            </Section>
          </div>

          <div className="space-y-6">
            <Section
              title={t("botSettings.payments")}
              description={t("botSettings.paymentsDescription")}
              actions={<Wallet className="size-4 text-muted-foreground" aria-hidden />}
            >
              <div className="grid gap-4 sm:grid-cols-3 sm:items-end">
                <Field label={t("botSettings.deposit")} error={fieldError(err, "depositPercent")}>
                  <Input type="number" min={0} max={100} value={s.depositPercent} onChange={(e) => set("depositPercent", Number(e.target.value))} className="tabular" />
                </Field>
                <Field label={t("botSettings.hold")} error={fieldError(err, "holdMinutes")}>
                  <Input type="number" min={5} max={120} value={s.holdMinutes} onChange={(e) => set("holdMinutes", Number(e.target.value))} className="tabular" />
                </Field>
                <Field label={t("botSettings.reminder")} error={fieldError(err, "remainingReminderHours")}>
                  <Input type="number" min={0} value={s.remainingReminderHours} onChange={(e) => set("remainingReminderHours", Number(e.target.value))} className="tabular" />
                </Field>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_160px]">
                <Field label={t("botSettings.remainingWhen")}>
                  <Select value={s.remainingPaymentTrigger} onValueChange={(v) => set("remainingPaymentTrigger", v as RemainingPaymentTrigger)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["HoursBeforeCheckIn", "AtCheckIn", "AtCheckOut"] as const).map((x) => (
                        <SelectItem key={x} value={x}>
                          {t(`botSettings.trigger.${x}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {s.remainingPaymentTrigger === "HoursBeforeCheckIn" && (
                  <Field label={t("botSettings.hoursBefore")} error={fieldError(err, "remainingPaymentHours")}>
                    <Input type="number" min={0} value={s.remainingPaymentHours} onChange={(e) => set("remainingPaymentHours", Number(e.target.value))} className="tabular" />
                  </Field>
                )}
              </div>
            </Section>

            <Section
              title={t("botSettings.times")}
              actions={<Clock className="size-4 text-muted-foreground" aria-hidden />}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("botSettings.checkIn")}>
                  <Input type="time" value={s.checkInTime} onChange={(e) => set("checkInTime", e.target.value)} />
                </Field>
                <Field label={t("botSettings.checkOut")}>
                  <Input type="time" value={s.checkOutTime} onChange={(e) => set("checkOutTime", e.target.value)} />
                </Field>
                <Field label={t("botSettings.opening")}>
                  <Input type="time" value={s.openingTime} onChange={(e) => set("openingTime", e.target.value)} />
                </Field>
                <Field label={t("botSettings.closing")}>
                  <Input type="time" value={s.closingTime} onChange={(e) => set("closingTime", e.target.value)} />
                </Field>
              </div>
              <div className="mt-4 max-w-sm">
                <Field label={t("botSettings.cleaning")} hint={t("botSettings.cleaningHint")}>
                  <Input type="number" min={0} max={240} value={s.cleaningBufferMinutes} onChange={(e) => set("cleaningBufferMinutes", Number(e.target.value))} className="tabular" />
                </Field>
              </div>
            </Section>

            <div className="flex items-start gap-3 rounded-xl border bg-canvas px-5 py-4">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
              <div>
                <p className="text-sm font-medium">{t("botSettings.howItWorks")}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("botSettings.howItWorksBody")}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Page>
  )
}
