import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { CheckCircle2, Eye, EyeOff, KeyRound, Trash2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Field, Section, Spinner, useErrorMessage, useFieldError } from "@/components/common"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { TenantSettings } from "@/lib/types"

/** Models the backend accepts (TenantAi.Models). */
const MODELS = [
  { id: "claude-haiku-5-5", key: "haiku" },
  { id: "claude-sonnet-5-5", key: "sonnet" },
  { id: "claude-opus-5-5", key: "opus" },
] as const

/**
 * Bring-your-own Anthropic key for the homestay's chatbot. The key is write-only: it's verified and
 * encrypted by the server, and only its last 4 characters ever come back.
 */
export function AiKeyCard({ settings }: { settings: TenantSettings }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const fieldError = useFieldError()
  const errorMessage = useErrorMessage()
  const [key, setKey] = useState("")
  const [show, setShow] = useState(false)
  const model = settings.aiModel ?? MODELS[0].id

  const save = useMutation({
    mutationFn: (body: { apiKey?: string; model?: string; removeKey?: boolean }) => api.put<TenantSettings>("/api/app/settings/ai", body),
    onSuccess: (res, body) => {
      qc.setQueryData(["settings"], res)
      setKey("")
      toast.success(body.removeKey ? t("aiKey.removed") : body.apiKey ? t("aiKey.saved") : t("common.saved"))
    },
    onError: (e) => {
      if (!fieldError(e, "apiKey")) toast.error(errorMessage(e))
    },
  })
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; error: string | null }>("/api/app/settings/ai/test", {}),
  })

  const connected = settings.aiKeyConfigured
  const keyError = fieldError(save.error, "apiKey")

  return (
    <Section
      title={t("aiKey.title")}
      description={t("aiKey.description")}
      actions={
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
            connected ? "bg-brand-soft text-brand" : "bg-muted text-muted-foreground",
          )}
        >
          <span className={cn("size-1.5 rounded-full", connected ? "bg-brand" : "bg-muted-foreground/50")} />
          {connected ? t("aiKey.connected", { hint: settings.aiKeyHint ?? "" }) : t("aiKey.notConnected")}
        </span>
      }
    >
      <div className="space-y-4">
        {!connected && <p className="rounded-lg bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">{t("aiKey.offlineNote")}</p>}

        <Field label={connected ? t("aiKey.replaceKey") : t("aiKey.apiKey")} hint={t("aiKey.keyHint")} error={keyError}>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type={show ? "text" : "password"}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="sk-ant-…"
                autoComplete="off"
                spellCheck={false}
                className="pl-9 pr-10 font-mono"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label={show ? t("aiKey.hide") : t("aiKey.show")}
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <Button onClick={() => save.mutate({ apiKey: key.trim() })} disabled={!key.trim() || save.isPending}>
              {save.isPending && save.variables?.apiKey && <Spinner />} {t("aiKey.verifySave")}
            </Button>
          </div>
        </Field>

        <Field label={t("aiKey.model")} hint={t("aiKey.modelHint")}>
          <Select value={model} onValueChange={(v) => save.mutate({ model: v })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {t(`aiKey.models.${m.key}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {connected && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <Button variant="outline" size="sm" onClick={() => test.mutate()} disabled={test.isPending}>
              {test.isPending && <Spinner />} {t("aiKey.test")}
            </Button>
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => save.mutate({ removeKey: true })} disabled={save.isPending}>
              <Trash2 /> {t("aiKey.remove")}
            </Button>
            {test.data && (
              <span className={cn("inline-flex items-center gap-1.5 text-sm", test.data.ok ? "text-success" : "text-destructive")}>
                {test.data.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
                {test.data.ok ? t("aiKey.testOk") : t(`aiKey.errors.${test.data.error ?? "unreachable"}`, { defaultValue: t("aiKey.errors.unreachable") })}
              </span>
            )}
          </div>
        )}
      </div>
    </Section>
  )
}
