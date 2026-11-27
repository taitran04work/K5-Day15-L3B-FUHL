import { useState } from "react"
import { Link } from "react-router"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Copy, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Page } from "@/components/layout/AppShell"
import { ErrorState, Field, PageHeader, Section, Spinner, useErrorMessage, useFieldError } from "@/components/common"
import { useDevConfig } from "@/components/booking/BookingParts"
import { api } from "@/lib/api"
import { dateTime } from "@/lib/format"

interface ZaloStatus {
  connected: boolean
  configured: boolean
  appId: string | null
  oaId: string | null
  hasAppSecret: boolean
  hasOaSecretKey: boolean
  hasRefreshToken: boolean
  webhookUrl: string
  tokenExpiresAt: string | null
}

export default function ChannelSettings() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const dev = useDevConfig()
  const fieldError = useFieldError()
  const errorMessage = useErrorMessage()
  const status = useQuery({ queryKey: ["zalo"], queryFn: () => api.get<ZaloStatus>("/api/app/channels/zalo") })
  const [form, setForm] = useState({ appId: "", appSecret: "", oaId: "", oaSecretKey: "", accessToken: "", refreshToken: "" })
  const [test, setTest] = useState({ userId: "", text: "" })
  const s = status.data

  const save = useMutation({
    mutationFn: () => api.put<ZaloStatus>("/api/app/channels/zalo", Object.fromEntries(Object.entries({ ...form, appId: form.appId || s?.appId, oaId: form.oaId || s?.oaId }).map(([k, v]) => [k, v || null]))),
    onSuccess: () => {
      toast.success(t("channels.saved"))
      setForm({ appId: "", appSecret: "", oaId: "", oaSecretKey: "", accessToken: "", refreshToken: "" })
      void qc.invalidateQueries({ queryKey: ["zalo"] })
    },
  })
  const disconnect = useMutation({ mutationFn: () => api.del("/api/app/channels/zalo"), onSuccess: () => void qc.invalidateQueries({ queryKey: ["zalo"] }) })
  const sendTest = useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string }>("/api/app/channels/zalo/test", test),
    onSuccess: (r) => (r.ok ? toast.success(t("channels.testSent")) : toast.error(r.message || t("channels.testFailed"))),
    onError: (e) => toast.error(errorMessage(e)),
  })

  if (status.error) return <Page narrow><ErrorState error={status.error} onRetry={() => void status.refetch()} /></Page>

  return (
    <Page narrow>
      <PageHeader title={t("channels.title")} description={t("channels.description")} />
      {!s ? (
        <Skeleton className="h-72 w-full rounded-xl" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="space-y-6">
            <Section
              title="Zalo Official Account"
              description={s.connected ? t("channels.connected", { oa: s.oaId ?? "" }) : t("channels.notConnected")}
              actions={s.configured && <span className={s.connected ? "text-sm text-brand" : "text-sm text-muted-foreground"}>{s.connected ? t("channels.statusOn") : t("channels.statusPartial")}</span>}
            >
              <div className="space-y-4">
                <Field label={t("channels.webhookUrl")} hint={t("channels.webhookHint")}>
                  <div className="flex gap-2">
                    <Input readOnly value={s.webhookUrl} className="font-mono text-xs" />
                    <Button variant="outline" size="icon" onClick={() => { void navigator.clipboard.writeText(s.webhookUrl); toast.success(t("common.copied")) }} aria-label={t("common.copy")}>
                      <Copy />
                    </Button>
                  </div>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("channels.appId")} error={fieldError(save.error, "appId")}>
                    <Input value={form.appId} placeholder={s.appId ?? ""} onChange={(e) => setForm({ ...form, appId: e.target.value })} />
                  </Field>
                  <Field label={t("channels.oaId")} error={fieldError(save.error, "oaId")}>
                    <Input value={form.oaId} placeholder={s.oaId ?? ""} onChange={(e) => setForm({ ...form, oaId: e.target.value })} />
                  </Field>
                  <Field label={t("channels.appSecret")} hint={s.hasAppSecret ? t("channels.storedHint") : undefined}>
                    <Input type="password" value={form.appSecret} placeholder={s.hasAppSecret ? "••••••••" : ""} onChange={(e) => setForm({ ...form, appSecret: e.target.value })} />
                  </Field>
                  <Field label={t("channels.oaSecret")} hint={s.hasOaSecretKey ? t("channels.storedHint") : undefined} error={fieldError(save.error, "oaSecretKey")}>
                    <Input type="password" value={form.oaSecretKey} placeholder={s.hasOaSecretKey ? "••••••••" : ""} onChange={(e) => setForm({ ...form, oaSecretKey: e.target.value })} />
                  </Field>
                  <Field label={t("channels.accessToken")} optional>
                    <Input type="password" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} />
                  </Field>
                  <Field label={t("channels.refreshToken")} optional hint={s.hasRefreshToken ? t("channels.storedHint") : undefined}>
                    <Input type="password" value={form.refreshToken} placeholder={s.hasRefreshToken ? "••••••••" : ""} onChange={(e) => setForm({ ...form, refreshToken: e.target.value })} />
                  </Field>
                </div>
                {s.tokenExpiresAt && <p className="text-xs text-muted-foreground">{t("channels.tokenExpires", { when: dateTime(s.tokenExpiresAt) })}</p>}
                {save.error && !fieldError(save.error, "appId") && !fieldError(save.error, "oaSecretKey") && <p className="text-sm text-destructive">{errorMessage(save.error)}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => save.mutate()} disabled={save.isPending}>
                    {save.isPending && <Spinner />} {s.configured ? t("channels.update") : t("channels.connect")}
                  </Button>
                  {s.configured && (
                    <Button variant="ghost" onClick={() => disconnect.mutate()}>
                      {t("channels.disconnect")}
                    </Button>
                  )}
                </div>
              </div>
            </Section>

            {s.connected && (
              <Section title={t("channels.testTitle")} description={t("channels.testDescription")}>
                <div className="grid gap-4 sm:grid-cols-[200px_1fr_auto] sm:items-end">
                  <Field label={t("channels.zaloUserId")}>
                    <Input value={test.userId} onChange={(e) => setTest({ ...test, userId: e.target.value })} />
                  </Field>
                  <Field label={t("channels.message")} optional>
                    <Input value={test.text} onChange={(e) => setTest({ ...test, text: e.target.value })} />
                  </Field>
                  <Button variant="outline" onClick={() => sendTest.mutate()} disabled={!test.userId || sendTest.isPending}>
                    {sendTest.isPending && <Spinner />} {t("channels.sendTest")}
                  </Button>
                </div>
              </Section>
            )}
          </div>
          <aside className="space-y-4 lg:sticky lg:top-8 lg:h-fit">
            <div className="rounded-xl border p-5 text-sm">
              <p className="font-medium">{t("channels.stepsTitle")}</p>
              <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-muted-foreground">
                <li>{t("channels.step1")}</li>
                <li>{t("channels.step2")}</li>
                <li>{t("channels.step3")}</li>
                <li>{t("channels.step4")}</li>
              </ol>
            </div>
            {dev.data?.devTools && (
              <div className="rounded-xl border p-5 text-sm">
                <p className="font-medium">{t("channels.simulatorTitle")}</p>
                <p className="mt-1 text-muted-foreground">{t("channels.simulatorBody")}</p>
                <Button asChild variant="outline" size="sm" className="mt-3">
                  <Link to="/dev/zalo-simulator" target="_blank">
                    {t("channels.openSimulator")} <ExternalLink />
                  </Link>
                </Button>
              </div>
            )}
          </aside>
        </div>
      )}
    </Page>
  )
}
