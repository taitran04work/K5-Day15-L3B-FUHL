import { useEffect, useState } from "react"
import { Link } from "react-router"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Copy, ExternalLink, Plus, QrCode, RefreshCw, ShieldCheck, Trash2, Webhook } from "lucide-react"
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
  allowedThreadIds?: string[]
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

interface DeplaoRecipient {
  threadId: string
  displayName: string
  type: string
  phone?: string | null
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
  const [dTest, setDTest] = useState({ accountId: "", conversationId: "", text: "", type: "user" })
  const [recipients, setRecipients] = useState<DeplaoRecipient[]>([])
  const [accounts, setAccounts] = useState<DeplaoAccount[]>([])
  const [whitelistConn, setWhitelistConn] = useState<ChannelConnectionDto | null>(null)
  const [whitelistSelected, setWhitelistSelected] = useState<string[]>([])
  const [whitelistSearch, setWhitelistSearch] = useState("")
  const [whitelistOptions, setWhitelistOptions] = useState<DeplaoRecipient[]>([])
  const [whitelistLoading, setWhitelistLoading] = useState(false)
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [qrTempId, setQrTempId] = useState<string | null>(null)
  const [qrState, setQrState] = useState<{ status: string; qrDataUrl: string; message?: string | null }>({ status: "idle", qrDataUrl: "" })
  const [oaForm, setOaForm] = useState({ appId: "", appSecret: "", oaId: "", oaSecretKey: "", accessToken: "", refreshToken: "" })

  const d = deplao.data
  const connections = d?.connections ?? []
  const s = zalo.data

  const startZaloQr = useMutation({
    mutationFn: () => api.post<{ tempId: string }>("/api/app/channels/deplao/zalo/qr"),
    onSuccess: (r) => {
      setQrTempId(r.tempId)
      setQrState({ status: "initializing", qrDataUrl: "" })
    },
    onError: (e) => {
      setQrState({ status: "error", qrDataUrl: "", message: errorMessage(e) })
    },
  })

  useEffect(() => {
    if (!qrModalOpen || !qrTempId) return
    if (["success", "error", "expired", "declined"].includes(qrState.status)) return

    const timer = window.setInterval(async () => {
      try {
        const res = await api.get<{
          tempId: string
          status: string
          qrDataUrl: string
          message?: string | null
          accountId?: string | null
          accountName?: string | null
        }>(`/api/app/channels/deplao/zalo/qr/${qrTempId}`)
        setQrState({ status: res.status, qrDataUrl: res.qrDataUrl, message: res.message })
        if (res.status === "success") {
          toast.success(`Đã kết nối Zalo${res.accountName ? `: ${res.accountName}` : ""}`)
          setQrTempId(null)
          setQrModalOpen(false)
          void qc.invalidateQueries({ queryKey: ["deplao"] })
        }
      } catch (e) {
        setQrState({ status: "error", qrDataUrl: "", message: errorMessage(e) })
      }
    }, 1500)

    return () => window.clearInterval(timer)
  }, [qrModalOpen, qrTempId, qrState.status, qc, errorMessage])

  const openQrModal = () => {
    setQrModalOpen(true)
    setQrTempId(null)
    setQrState({ status: "initializing", qrDataUrl: "" })
    startZaloQr.mutate()
  }

  const closeQrModal = (open: boolean) => {
    setQrModalOpen(open)
    if (!open && qrTempId && !["success", "error", "expired", "declined"].includes(qrState.status)) {
      void api.post(`/api/app/channels/deplao/zalo/qr/${qrTempId}/abort`).catch(() => {})
    }
    if (!open) setQrTempId(null)
  }

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

  const saveAllowedThreads = useMutation({
    mutationFn: ({ id, allowedThreadIds }: { id: string; allowedThreadIds: string[] }) =>
      api.put(`/api/app/channels/deplao/connections/${id}/allowed-threads`, { allowedThreadIds }),
    onSuccess: () => {
      toast.success("Đã lưu giới hạn nhóm / cuộc trò chuyện được phép trả lời")
      setWhitelistConn(null)
      void qc.invalidateQueries({ queryKey: ["deplao"] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const openWhitelistModal = async (conn: ChannelConnectionDto) => {
    setWhitelistConn(conn)
    setWhitelistSelected(conn.allowedThreadIds ?? [])
    setWhitelistSearch("")
    setWhitelistLoading(true)
    try {
      const r = await api.get<{ ok: boolean; recipients: DeplaoRecipient[] }>(
        `/api/app/channels/deplao/recipients?accountId=${encodeURIComponent(conn.accountId)}`
      )
      setWhitelistOptions(r.recipients ?? [])
    } catch (e) {
      toast.error(errorMessage(e))
      setWhitelistOptions([])
    } finally {
      setWhitelistLoading(false)
    }
  }

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

  const loadRecipients = useMutation({
    mutationFn: (accountId?: string) => {
      const targetAcc = accountId || dTest.accountId || connections[0]?.accountId || ""
      const q = targetAcc ? `?accountId=${encodeURIComponent(targetAcc)}` : ""
      return api.get<{ ok: boolean; recipients: DeplaoRecipient[]; error?: string }>(`/api/app/channels/deplao/recipients${q}`)
    },
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(r.error || "Không tải được danh bạ")
        return
      }
      setRecipients(r.recipients ?? [])
      if ((r.recipients ?? []).length === 0) toast.info("Chưa có cuộc trò chuyện/danh bạ nào trên tài khoản này.")
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const sendTest = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; message: string }>("/api/app/channels/deplao/test", {
        ...dTest,
        accountId: dTest.accountId || connections[0]?.accountId || null,
      }),
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
                  <Button size="sm" onClick={openQrModal}>
                    <QrCode className="mr-1.5 size-3.5" />
                    Kết nối Zalo (Quét QR)
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => loadAccounts.mutate()} disabled={loadAccounts.isPending}>
                    {loadAccounts.isPending ? <Spinner /> : <RefreshCw className="size-3.5" />}
                    <span className="ml-1.5">{t("channels.deplaoLoadAccounts")}</span>
                  </Button>
                </div>
              }
            >
              <div className="space-y-4">
                {connections.length === 0 ? (
                  <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                    Chưa có kênh nào được gắn cho homestay này. Bấm &ldquo;{t("channels.deplaoLoadAccounts")}&rdquo; để chọn tài khoản từ Deplao.
                  </p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {connections.map((c) => {
                      const wlCount = c.allowedThreadIds?.length ?? 0
                      return (
                      <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-xs">{c.channel}</span>
                            {c.accountName}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <span className="truncate font-mono text-xs text-muted-foreground">{c.accountId}</span>
                            <span
                              className={
                                wlCount > 0
                                  ? "rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"
                                  : "rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400"
                              }
                            >
                              {wlCount > 0 ? `Chỉ trả lời ${wlCount} nhóm/chat` : "Trả lời tất cả"}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => void openWhitelistModal(c)}>
                            <ShieldCheck className="mr-1 size-3.5" />
                            Chọn nhóm/chat
                          </Button>
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
                      )
                    })}
                  </ul>
                )}

                {accounts.length > 0 && (
                  <div className="space-y-2 rounded-lg bg-muted/40 p-3">
                    <p className="text-xs font-medium text-muted-foreground">Tài khoản đang có trên Deplao T123:</p>
                    <div className="flex flex-wrap gap-2">
                      {accounts.map((acc) => {
                        const already = connections.some((c) => c.accountId === acc.id)
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
              <Section
                title={t("channels.testTitle")}
                description="Chọn người nhận từ danh bạ/hội thoại hoặc nhập User / Thread ID để gửi tin nhắn thử."
                actions={
                  connections.length > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => loadRecipients.mutate(dTest.accountId || connections[0]?.accountId)}
                      disabled={loadRecipients.isPending}
                    >
                      {loadRecipients.isPending ? <Spinner /> : <RefreshCw className="size-3.5" />}
                      <span className="ml-1.5">Tải danh bạ</span>
                    </Button>
                  )
                }
              >
                <div className="space-y-4">
                  {connections.length > 0 && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Tài khoản gửi">
                        <select
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={dTest.accountId || connections[0]?.accountId || ""}
                          onChange={(e) => {
                            const accId = e.target.value
                            setDTest({ ...dTest, accountId: accId, conversationId: "" })
                            setRecipients([])
                            loadRecipients.mutate(accId)
                          }}
                        >
                          {connections.map((c) => (
                            <option key={c.id} value={c.accountId}>
                              {c.accountName} ({c.channel})
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Chọn nhanh từ danh bạ / hội thoại" optional>
                        <select
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={dTest.conversationId}
                          onFocus={() => {
                            if (recipients.length === 0 && !loadRecipients.isPending) {
                              loadRecipients.mutate(dTest.accountId || connections[0]?.accountId)
                            }
                          }}
                          onChange={(e) => {
                            const selected = recipients.find((r) => r.threadId === e.target.value)
                            setDTest({
                              ...dTest,
                              conversationId: e.target.value,
                              type: selected?.type ?? "user",
                            })
                          }}
                        >
                          <option value="">
                            {loadRecipients.isPending
                              ? "Đang tải danh bạ..."
                              : recipients.length > 0
                                ? "-- Chọn người nhận --"
                                : "-- Bấm để tải danh bạ --"}
                          </option>
                          {recipients.map((r) => (
                            <option key={r.threadId} value={r.threadId}>
                              {r.displayName} {r.type === "group" ? "[Nhóm]" : r.phone ? `(${r.phone})` : ""}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                  )}
                  <div className="grid gap-4 sm:grid-cols-[200px_1fr_auto] sm:items-end">
                    <Field label="User / Thread ID">
                      <Input
                        value={dTest.conversationId}
                        onChange={(e) => setDTest({ ...dTest, conversationId: e.target.value })}
                        placeholder="Chọn ở trên hoặc nhập ID"
                      />
                    </Field>
                    <Field label={t("channels.message")} optional>
                      <Input value={dTest.text} onChange={(e) => setDTest({ ...dTest, text: e.target.value })} />
                    </Field>
                    <Button variant="outline" onClick={() => sendTest.mutate()} disabled={!dTest.conversationId || sendTest.isPending}>
                      {sendTest.isPending && <Spinner />} {t("channels.sendTest")}
                    </Button>
                  </div>
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
                <li>Bấm &ldquo;Kết nối Zalo (Quét QR)&rdquo; để quét mã trực tiếp bằng điện thoại.</li>
                <li>Tài khoản sau khi quét sẽ tự động được gắn vào workspace homestay này.</li>
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

      <Dialog open={!!whitelistConn} onOpenChange={(open) => { if (!open) setWhitelistConn(null) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Giới hạn nhóm / cuộc trò chuyện</DialogTitle>
            <DialogDescription>
              Chỉ những nhóm hoặc người bạn tick chọn dưới đây mới được AI tự động trả lời. Nếu bỏ trống tất cả, AI sẽ trả lời mọi tin nhắn gửi tới tài khoản <strong>{whitelistConn?.accountName}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Tìm theo tên nhóm hoặc số điện thoại..."
              value={whitelistSearch}
              onChange={(e) => setWhitelistSearch(e.target.value)}
            />
            <div className="max-h-72 overflow-y-auto rounded-lg border divide-y">
              {whitelistLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <Spinner /> Đang tải danh sách nhóm / hội thoại...
                </div>
              ) : whitelistOptions.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Không tìm thấy hội thoại nào trên tài khoản này.</p>
              ) : (
                whitelistOptions
                  .filter((r) => {
                    const q = whitelistSearch.trim().toLowerCase()
                    if (!q) return true
                    return r.displayName.toLowerCase().includes(q) || r.threadId.includes(q) || (r.phone ?? "").includes(q)
                  })
                  .map((r) => {
                    const checked = whitelistSelected.includes(r.threadId)
                    return (
                      <label key={r.threadId} className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 hover:bg-muted/40">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            className="size-4 rounded border-input"
                            checked={checked}
                            onChange={(e) => {
                              setWhitelistSelected((prev) =>
                                e.target.checked ? [...prev, r.threadId] : prev.filter((id) => id !== r.threadId)
                              )
                            }}
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {r.displayName}
                              {r.type === "group" && <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px]">Nhóm</span>}
                            </p>
                            <p className="truncate font-mono text-[11px] text-muted-foreground">{r.threadId}</p>
                          </div>
                        </div>
                      </label>
                    )
                  })
              )}
            </div>
            <div className="flex items-center justify-between gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setWhitelistSelected([])} disabled={whitelistSelected.length === 0}>
                Bỏ chọn tất cả
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setWhitelistConn(null)}>Hủy</Button>
                <Button
                  size="sm"
                  disabled={saveAllowedThreads.isPending || !whitelistConn}
                  onClick={() => whitelistConn && saveAllowedThreads.mutate({ id: whitelistConn.id, allowedThreadIds: whitelistSelected })}
                >
                  {saveAllowedThreads.isPending && <Spinner />}
                  Lưu ({whitelistSelected.length > 0 ? `${whitelistSelected.length} đã chọn` : "Trả lời tất cả"})
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={qrModalOpen} onOpenChange={closeQrModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Kết nối tài khoản Zalo</DialogTitle>
            <DialogDescription>
              Mở ứng dụng Zalo trên điện thoại và quét mã QR bên dưới để kết nối vào workspace homestay này.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center gap-4 py-4">
            {qrState.status === "initializing" && (
              <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
                <Spinner />
                <span>Đang khởi tạo mã QR Zalo...</span>
              </div>
            )}
            {qrState.status === "waiting" && qrState.qrDataUrl && (
              <>
                <img src={qrState.qrDataUrl} alt="Zalo QR" className="size-56 rounded-xl border bg-white p-2 shadow-sm" />
                <p className="text-center text-xs text-muted-foreground">Đang chờ bạn quét mã QR trên điện thoại...</p>
              </>
            )}
            {qrState.status === "scanned" && (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Spinner />
                <p className="text-sm font-medium">Đã quét mã QR!</p>
                <p className="text-xs text-muted-foreground">Vui lòng bấm &ldquo;Đăng nhập&rdquo; trên điện thoại để hoàn tất.</p>
              </div>
            )}
            {(qrState.status === "error" || qrState.status === "expired" || qrState.status === "declined") && (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <p className="text-sm text-destructive">
                  {qrState.message ||
                    (qrState.status === "expired"
                      ? "Mã QR đã hết hạn."
                      : qrState.status === "declined"
                        ? "Bạn đã từ chối đăng nhập trên điện thoại."
                        : "Không thể đăng nhập Zalo.")}
                </p>
                <Button size="sm" onClick={openQrModal} disabled={startZaloQr.isPending}>
                  {startZaloQr.isPending && <Spinner />} Tạo lại mã QR
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Page>
  )
}
