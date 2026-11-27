import { useState } from "react"
import { Link } from "react-router"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Copy, ExternalLink, Plus, QrCode, RefreshCw, Trash2, Webhook } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Page } from "@/components/layout/AppShell"
import { ErrorState, Field, PageHeader, Section, Spinner, useErrorMessage, useFieldError } from "@/components/common"
import { useDevConfig } from "@/components/booking/BookingParts"
import { api } from "@/lib/api"

interface ChannelConnectionDto {
  id: string
  channel: string
  accountId: string
  accountName: string
  isEnabled: boolean
  createdAt: string
}

interface DeplaoStatus {
  connected: boolean
  platformManaged: boolean
  configured: boolean
  baseUrl: string
  accountId: string | null
  webhookId: string | null
  hasApiKey: boolean
  hasWebhookSecret: boolean
  webhookUrl: string
  connections: ChannelConnectionDto[]
}

interface DeplaoAccount {
  id: string
  channel: string
  name: string
  online: boolean
  status: string | null
}

interface ZaloStatus {
  connected: boolean
  configured: boolean
  appId: string | null
  oaId: string | null
  hasAppSecret: boolean
  hasOaSecretKey: boolean
  hasRefreshToken: boolean
  webhookUrl: string
}

export default function ChannelSettings() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const dev = useDevConfig()
  const fieldError = useFieldError()
  const errorMessage = useErrorMessage()

  const deplao = useQuery({ queryKey: ["deplao"], queryFn: () => api.get<DeplaoStatus>("/api/app/channels/deplao") })
  const zalo = useQuery({ queryKey: ["zalo"], queryFn: () => api.get<ZaloStatus>("/api/app/channels/zalo") })

  const [dForm, setDForm] = useState({ baseUrl: "", apiKey: "", webhookSecret: "" })
  const [dTest, setDTest] = useState({ conversationId: "", text: "" })
  const [accounts, setAccounts] = useState<DeplaoAccount[]>([])
  const [deplaoModalOpen, setDeplaoModalOpen] = useState(false)
  const [oaForm, setOaForm] = useState({ appId: "", appSecret: "", oaId: "", oaSecretKey: "", accessToken: "", refreshToken: "" })

  const d = deplao.data
  const s = zalo.data

  const loadAccounts = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; accounts: DeplaoAccount[]; error?: string }>("/api/app/channels/deplao/accounts", {
        baseUrl: dForm.baseUrl || d?.baseUrl || null,
        apiKey: dForm.apiKey || null,
      }),
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(r.error || t("channels.deplaoNoAccounts"))
        return
      }
      setAccounts(r.accounts)
      if (r.accounts.length === 0) toast.info(t("channels.deplaoNoAccounts"))
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const addConnection = useMutation({
    mutationFn: (acc: DeplaoAccount) =>
      api.post<DeplaoStatus>("/api/app/channels/deplao/connections", {
        channel: acc.channel,
        accountId: acc.id,
        accountName: acc.name,
      }),
    onSuccess: () => {
      toast.success(t("channels.deplaoSaved"))
      void qc.invalidateQueries({ queryKey: ["deplao"] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const toggleConnection = useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) =>
      api.put(`/api/app/channels/deplao/connections/${id}`, { isEnabled }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["deplao"] }),
    onError: (e) => toast.error(errorMessage(e)),
  })

  const removeConnection = useMutation({
    mutationFn: (id: string) => api.del(`/api/app/channels/deplao/connections/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["deplao"] }),
    onError: (e) => toast.error(errorMessage(e)),
  })

  const saveGateway = useMutation({
    mutationFn: () =>
      api.put("/api/app/channels/deplao", {
        baseUrl: dForm.baseUrl || d?.baseUrl || null,
        apiKey: dForm.apiKey || null,
        webhookSecret: dForm.webhookSecret || null,
      }),
    onSuccess: () => {
      toast.success(t("channels.deplaoSaved"))
      setDForm({ baseUrl: "", apiKey: "", webhookSecret: "" })
      void qc.invalidateQueries({ queryKey: ["deplao"] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const registerWebhook = useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string }>("/api/app/channels/deplao/register-webhook"),
    onSuccess: (r) => (r.ok ? toast.success(t("channels.deplaoWebhookRegistered")) : toast.error(r.message)),
    onError: (e) => toast.error(errorMessage(e)),
  })

  const sendTest = useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string }>("/api/app/channels/deplao/test", dTest),
    onSuccess: (r) => (r.ok ? toast.success(t("channels.testSent")) : toast.error(r.message || t("channels.testFailed"))),
    onError: (e) => toast.error(errorMessage(e)),
  })

  const saveOa = useMutation({
    mutationFn: () =>
      api.put("/api/app/channels/zalo", Object.fromEntries(Object.entries({ ...oaForm, appId: oaForm.appId || s?.appId, oaId: oaForm.oaId || s?.oaId }).map(([k, v]) => [k, v || null]))),
    onSuccess: () => {
      toast.success(t("channels.saved"))
      setOaForm({ appId: "", appSecret: "", oaId: "", oaSecretKey: "", accessToken: "", refreshToken: "" })
      void qc.invalidateQueries({ queryKey: ["zalo"] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  if (deplao.error) return <Page narrow><ErrorState error={deplao.error} onRetry={() => void deplao.refetch()} /></Page>

  return (
    <Page narrow>
      <PageHeader title={t("channels.title")} description="Kết nối Zalo, Facebook, Telegram qua Deplao T123 vào cùng AI Agent." />
      {!d ? (
        <Skeleton className="h-72 w-full rounded-xl" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="space-y-6">
            <Section
              title="Kênh đã kết nối (Zalo / Facebook / Telegram)"
              description={d.connected ? "Các kết nối được lưu riêng theo từng homestay trong cơ sở dữ liệu." : "Cần cấu hình Gateway Deplao hoặc biến môi trường Deplao__ApiKey."}
              actions={
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setDeplaoModalOpen(true)}>
                    <QrCode className="mr-1.5 size-3.5" />
                    Đăng nhập tài khoản mới
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => loadAccounts.mutate()} disabled={loadAccounts.isPending}>
                    {loadAccounts.isPending ? <Spinner /> : <RefreshCw className="size-3.5" />}
                    <span className="ml-1.5">{t("channels.deplaoLoadAccounts")}</span>
                  </Button>
                </div>
              }
            >
              <div className="space-y-4">
                {d.connections.length === 0 ? (
                  <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                    Chưa có kênh nào được gắn cho homestay này. Bấm &ldquo;{t("channels.deplaoLoadAccounts")}&rdquo; để chọn tài khoản từ Deplao.
                  </p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {d.connections.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-xs">{c.channel}</span>
                            {c.accountName}
                          </p>
                          <p className="truncate font-mono text-xs text-muted-foreground">{c.accountId}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Switch
                            checked={c.isEnabled}
                            onCheckedChange={(checked) => toggleConnection.mutate({ id: c.id, isEnabled: checked })}
                            aria-label={c.accountName}
                          />
                          <Button variant="ghost" size="icon-sm" onClick={() => removeConnection.mutate(c.id)} aria-label="Remove">
                            <Trash2 className="size-4 text-muted-foreground" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {accounts.length > 0 && (
                  <div className="space-y-2 rounded-lg bg-muted/40 p-3">
                    <p className="text-xs font-medium text-muted-foreground">Tài khoản đang có trên Deplao T123:</p>
                    <div className="flex flex-wrap gap-2">
                      {accounts.map((acc) => {
                        const already = d.connections.some((c) => c.accountId === acc.id)
                        return (
                          <Button
                            key={acc.id}
                            size="sm"
                            variant={already ? "secondary" : "outline"}
                            disabled={already || addConnection.isPending}
                            onClick={() => addConnection.mutate(acc)}
                          >
                            <Plus className="mr-1 size-3.5" />
                            {acc.name} ({acc.channel}) {acc.online ? "●" : "○"}
                          </Button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </Section>

            {d.connected && (
              <Section title={t("channels.testTitle")} description="Gửi tin nhắn thử tới một user/thread ID qua Deplao T123.">
                <div className="grid gap-4 sm:grid-cols-[200px_1fr_auto] sm:items-end">
                  <Field label="User / Thread ID">
                    <Input value={dTest.conversationId} onChange={(e) => setDTest({ ...dTest, conversationId: e.target.value })} />
                  </Field>
                  <Field label={t("channels.message")} optional>
                    <Input value={dTest.text} onChange={(e) => setDTest({ ...dTest, text: e.target.value })} />
                  </Field>
                  <Button variant="outline" onClick={() => sendTest.mutate()} disabled={!dTest.conversationId || sendTest.isPending}>
                    {sendTest.isPending && <Spinner />} {t("channels.sendTest")}
                  </Button>
                </div>
              </Section>
            )}

            <details className="rounded-xl border p-5">
              <summary className="cursor-pointer text-sm font-medium">
                Cấu hình nâng cao (Gateway riêng, Webhook &amp; Zalo OA)
              </summary>
              <div className="mt-4 space-y-6">
                <div className="space-y-4">
                  <Field label={t("channels.webhookUrl")}>
                    <div className="flex gap-2">
                      <Input readOnly value={d.webhookUrl} className="font-mono text-xs" />
                      <Button variant="outline" size="icon" onClick={() => { void navigator.clipboard.writeText(d.webhookUrl); toast.success(t("common.copied")) }} aria-label={t("common.copy")}>
                        <Copy />
                      </Button>
                    </div>
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label={t("channels.deplaoBaseUrl")} error={fieldError(saveGateway.error, "baseUrl")}>
                      <Input value={dForm.baseUrl} placeholder={d.baseUrl} onChange={(e) => setDForm({ ...dForm, baseUrl: e.target.value })} />
                    </Field>
                    <Field label={t("channels.deplaoApiKey")} hint={d.hasApiKey ? t("channels.storedHint") : d.platformManaged ? "Đang dùng key hệ thống" : undefined}>
                      <Input type="password" value={dForm.apiKey} placeholder={d.hasApiKey ? "••••••••" : "dpk_..."} onChange={(e) => setDForm({ ...dForm, apiKey: e.target.value })} />
                    </Field>
                    <Field label={t("channels.deplaoWebhookSecret")} optional>
                      <Input type="password" value={dForm.webhookSecret} placeholder={d.hasWebhookSecret ? "••••••••" : "whsec_..."} onChange={(e) => setDForm({ ...dForm, webhookSecret: e.target.value })} />
                    </Field>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => saveGateway.mutate()} disabled={saveGateway.isPending}>
                      {saveGateway.isPending && <Spinner />} {t("channels.update")}
                    </Button>
                    {d.connected && (
                      <Button size="sm" variant="outline" onClick={() => registerWebhook.mutate()} disabled={registerWebhook.isPending}>
                        {registerWebhook.isPending ? <Spinner /> : <Webhook className="mr-1 size-4" />} {t("channels.deplaoRegisterWebhook")}
                      </Button>
                    )}
                  </div>
                </div>

                {s && (
                  <div className="space-y-4 border-t pt-4">
                    <p className="text-sm font-medium">Zalo Official Account (tuỳ chọn)</p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label={t("channels.appId")}><Input value={oaForm.appId} placeholder={s.appId ?? ""} onChange={(e) => setOaForm({ ...oaForm, appId: e.target.value })} /></Field>
                      <Field label={t("channels.oaId")}><Input value={oaForm.oaId} placeholder={s.oaId ?? ""} onChange={(e) => setOaForm({ ...oaForm, oaId: e.target.value })} /></Field>
                      <Field label={t("channels.oaSecret")}><Input type="password" value={oaForm.oaSecretKey} placeholder={s.hasOaSecretKey ? "••••••••" : ""} onChange={(e) => setOaForm({ ...oaForm, oaSecretKey: e.target.value })} /></Field>
                      <Field label={t("channels.accessToken")}><Input type="password" value={oaForm.accessToken} onChange={(e) => setOaForm({ ...oaForm, accessToken: e.target.value })} /></Field>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => saveOa.mutate()} disabled={saveOa.isPending}>
                      {saveOa.isPending && <Spinner />} Lưu Zalo OA
                    </Button>
                  </div>
                )}
              </div>
            </details>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-8 lg:h-fit">
            <div className="rounded-xl border p-5 text-sm">
              <p className="font-medium">Kết nối nhanh với Deplao T123</p>
              <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-muted-foreground">
                <li>Bấm &ldquo;Đăng nhập tài khoản mới&rdquo; để quét QR Zalo hoặc đăng nhập Facebook / Telegram.</li>
                <li>Đóng cửa sổ hoặc bấm &ldquo;{t("channels.deplaoLoadAccounts")}&rdquo; để chọn tài khoản cho homestay.</li>
                <li>Mọi tin nhắn từ các kênh đều đi vào cùng AI Agent &amp; Hộp thư.</li>
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

      <Dialog
        open={deplaoModalOpen}
        onOpenChange={(open) => {
          setDeplaoModalOpen(open)
          if (!open && d?.connected) loadAccounts.mutate()
        }}
      >
        <DialogContent className="flex h-[85vh] flex-col gap-3 sm:max-w-5xl">
          <DialogHeader className="flex-row items-center justify-between space-y-0 pr-8">
            <div>
              <DialogTitle>Đăng nhập tài khoản Social (Deplao T123)</DialogTitle>
              <DialogDescription>
                Quét mã QR Zalo hoặc đăng nhập Facebook / Telegram, sau đó đóng cửa sổ này để tải lại danh sách nick.
              </DialogDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <a href="/deplao/" target="_blank" rel="noreferrer">
                Mở tab mới <ExternalLink className="ml-1.5 size-3.5" />
              </a>
            </Button>
          </DialogHeader>
          <iframe src="/deplao/" title="Deplao Web" className="w-full flex-1 rounded-md border bg-background" />
        </DialogContent>
      </Dialog>
    </Page>
  )
}
