import type { TFunction } from "i18next"
import { useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { AlertTriangle, ArrowLeft, FileText, Plus, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Page } from "@/components/layout/AppShell"
import { EmptyState, ErrorState, Field, PageHeader, RowsSkeleton, Section, Spinner, useErrorMessage } from "@/components/common"
import { api } from "@/lib/api"
import { useInboxHub } from "@/lib/realtime"
import { date, relative } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Faq, PolicyDocument, PolicyWarning, RefundAppliesTo, RefundPolicy, RefundRule } from "@/lib/types"

/** Mirrors RefundEngine.Analyze on the server for instant feedback while editing. */
function analyze(rules: RefundRule[], t: TFunction): PolicyWarning[] {
  const w: PolicyWarning[] = []
  if (!rules.length) return [{ code: "empty", message: t("policies.warn.empty"), fromHours: null, toHours: null }]
  for (const r of rules) {
    if (r.maxHoursBeforeCheckIn != null && r.maxHoursBeforeCheckIn <= r.minHoursBeforeCheckIn) w.push({ code: "invalid_range", message: t("policies.warn.invalidRange", { label: r.label }), fromHours: r.minHoursBeforeCheckIn, toHours: r.maxHoursBeforeCheckIn })
    if (r.refundPercent < 0 || r.refundPercent > 100) w.push({ code: "invalid_percent", message: t("policies.warn.invalidPercent", { label: r.label }), fromHours: null, toHours: null })
  }
  const s = [...rules].sort((a, b) => a.minHoursBeforeCheckIn - b.minHoursBeforeCheckIn)
  if (s[0].minHoursBeforeCheckIn > 0) w.push({ code: "gap", message: t("policies.warn.gapStart", { to: s[0].minHoursBeforeCheckIn }), fromHours: 0, toHours: s[0].minHoursBeforeCheckIn })
  for (let i = 0; i < s.length - 1; i++) {
    const cur = s[i], next = s[i + 1]
    if (cur.maxHoursBeforeCheckIn == null) w.push({ code: "overlap", message: t("policies.warn.overlap", { a: cur.label, b: next.label }), fromHours: next.minHoursBeforeCheckIn, toHours: null })
    else if (cur.maxHoursBeforeCheckIn < next.minHoursBeforeCheckIn) w.push({ code: "gap", message: t("policies.warn.gap", { from: cur.maxHoursBeforeCheckIn, to: next.minHoursBeforeCheckIn }), fromHours: cur.maxHoursBeforeCheckIn, toHours: next.minHoursBeforeCheckIn })
    else if (cur.maxHoursBeforeCheckIn > next.minHoursBeforeCheckIn) w.push({ code: "overlap", message: t("policies.warn.overlapRange", { a: cur.label, b: next.label, from: next.minHoursBeforeCheckIn, to: cur.maxHoursBeforeCheckIn }), fromHours: next.minHoursBeforeCheckIn, toHours: cur.maxHoursBeforeCheckIn })
  }
  const last = s[s.length - 1]
  if (last.maxHoursBeforeCheckIn != null) w.push({ code: "gap", message: t("policies.warn.gapEnd", { from: last.maxHoursBeforeCheckIn }), fromHours: last.maxHoursBeforeCheckIn, toHours: null })
  return w
}

function hoursLabel(t: TFunction, h: number) {
  return h >= 48 && h % 24 === 0 ? t("policies.days", { count: h / 24 }) : t("policies.hours", { count: h })
}

function RuleSentence({ r }: { r: RefundRule }) {
  const { t } = useTranslation()
  const window =
    r.maxHoursBeforeCheckIn == null
      ? t("policies.moreThan", { time: hoursLabel(t, r.minHoursBeforeCheckIn) })
      : r.minHoursBeforeCheckIn === 0
        ? t("policies.lessThan", { time: hoursLabel(t, r.maxHoursBeforeCheckIn) })
        : t("policies.between", { from: hoursLabel(t, r.minHoursBeforeCheckIn), to: hoursLabel(t, r.maxHoursBeforeCheckIn) })
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <span>{window}</span>
      <span className="font-medium tabular">{r.refundPercent > 0 ? t("public.refundOf", { percent: r.refundPercent, of: r.appliesTo === "Deposit" ? t("public.ofDeposit") : t("public.ofTotal") }) : t("public.noRefund")}</span>
    </div>
  )
}

function Review({ policyId, docs, onClose }: { policyId: string; docs: PolicyDocument[]; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const policy = useQuery({ queryKey: ["policy", policyId], queryFn: () => api.get<RefundPolicy>(`/api/app/policies/${policyId}`) })
  const [rules, setRules] = useState<RefundRule[]>([])
  const [noShow, setNoShow] = useState(0)
  const [notes, setNotes] = useState("")
  const [page, setPage] = useState(1)
  const [focusQuote, setFocusQuote] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => {
    if (policy.data) {
      setRules(policy.data.rules)
      setNoShow(policy.data.noShowRefundPercent)
      setNotes(policy.data.notes ?? "")
      const first = policy.data.rules.find((r) => r.sourcePage)
      if (first?.sourcePage) setPage(first.sourcePage)
    }
  }, [policy.data])

  const warnings = useMemo(() => analyze(rules, t), [rules, t])
  const doc = docs.find((d) => d.id === policy.data?.sourceDocumentId)
  const readOnly = policy.data?.status !== "Draft"

  const save = useMutation({
    mutationFn: () => api.put<RefundPolicy>(`/api/app/policies/${policyId}`, { rules, noShowRefundPercent: noShow, notes: notes || null }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["policies"] }),
  })
  const activate = useMutation({
    mutationFn: async () => {
      await save.mutateAsync()
      return api.post(`/api/app/policies/${policyId}/activate`)
    },
    onSuccess: () => {
      toast.success(t("policies.activated"))
      void qc.invalidateQueries({ queryKey: ["policies"] })
      void qc.invalidateQueries({ queryKey: ["public"] })
      onClose()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const update = (i: number, patch: Partial<RefundRule>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const numOrNull = (v: string) => (v === "" ? null : Number(v))

  if (policy.isLoading) return <Skeleton className="h-96 w-full rounded-xl" />
  if (policy.error || !policy.data) return <ErrorState error={policy.error} onRetry={() => void policy.refetch()} />

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <button onClick={onClose} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> {t("policies.title")}
          </button>
          <h1 className="mt-2 text-xl">{readOnly ? t("policies.versionTitle", { version: policy.data.version }) : t("policies.reviewTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{readOnly ? t("policies.readOnlyHint") : t("policies.reviewDescription")}</p>
        </div>
        {!readOnly && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => save.mutate(undefined, { onSuccess: () => toast.success(t("policies.draftSaved")) })} disabled={save.isPending}>
              {save.isPending && <Spinner />} {t("policies.saveDraft")}
            </Button>
            <Button onClick={() => setConfirm(true)} disabled={activate.isPending || warnings.some((w) => w.code === "invalid_range" || w.code === "invalid_percent" || w.code === "empty")}>
              {activate.isPending && <Spinner />} {t("policies.activate")}
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {warnings.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-amber-900 dark:border-warning/30 dark:bg-warning/10 dark:text-warning">
              <p className="flex items-center gap-2 text-sm font-medium">
                <AlertTriangle className="size-4" /> {t("policies.warningsTitle")}
              </p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-6 text-sm">
                {warnings.map((w, i) => (
                  <li key={i}>{w.message}</li>
                ))}
              </ul>
            </div>
          )}
          {policy.data.ambiguities.length > 0 && (
            <div className="rounded-xl border px-4 py-3">
              <p className="text-sm font-medium">{t("policies.ambiguitiesTitle")}</p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-6 text-sm text-muted-foreground">
                {policy.data.ambiguities.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}

          <Section title={t("policies.rulesTitle")} description={t("policies.rulesDescription")}>
            <div className="space-y-3">
              {rules.map((r, i) => (
                <div key={i} className={cn("rounded-lg border p-3", focusQuote === r.sourceQuote && r.sourceQuote && "border-brand/40 bg-brand-soft/40")}>
                  <div className="grid gap-3 sm:grid-cols-[1fr_96px_96px]">
                    <Field label={t("policies.label")}>
                      <Input value={r.label} disabled={readOnly} onChange={(e) => update(i, { label: e.target.value })} />
                    </Field>
                    <Field label={t("policies.fromHours")}>
                      <Input type="number" min={0} disabled={readOnly} value={r.minHoursBeforeCheckIn} onChange={(e) => update(i, { minHoursBeforeCheckIn: Number(e.target.value) })} className="tabular" />
                    </Field>
                    <Field label={t("policies.toHours")}>
                      <Input type="number" min={0} disabled={readOnly} value={r.maxHoursBeforeCheckIn ?? ""} placeholder="∞" onChange={(e) => update(i, { maxHoursBeforeCheckIn: numOrNull(e.target.value) })} className="tabular" />
                    </Field>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[96px_1fr_auto] sm:items-end">
                    <Field label={t("policies.refund")}>
                      <Input type="number" min={0} max={100} disabled={readOnly} value={r.refundPercent} onChange={(e) => update(i, { refundPercent: Number(e.target.value) })} className="tabular" />
                    </Field>
                    <Field label={t("policies.of")}>
                      <Select value={r.appliesTo} disabled={readOnly} onValueChange={(v) => update(i, { appliesTo: v as RefundAppliesTo })}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Deposit">{t("policies.deposit")}</SelectItem>
                          <SelectItem value="Total">{t("policies.total")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    {!readOnly && (
                      <Button variant="ghost" size="icon" onClick={() => setRules(rules.filter((_, j) => j !== i))} aria-label={t("policies.removeRule")}>
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                  {r.sourceQuote && (
                    <button
                      type="button"
                      onClick={() => {
                        if (r.sourcePage) setPage(r.sourcePage)
                        setFocusQuote(r.sourceQuote)
                      }}
                      className="mt-3 block w-full rounded-md bg-muted px-3 py-2 text-left text-xs text-muted-foreground hover:text-foreground"
                    >
                      <span className="font-medium text-foreground">{t("policies.source", { page: r.sourcePage ?? "?" })}</span> “{r.sourceQuote}”
                    </button>
                  )}
                </div>
              ))}
              {!readOnly && (
                <Button variant="outline" size="sm" onClick={() => setRules([...rules, { minHoursBeforeCheckIn: 0, maxHoursBeforeCheckIn: null, refundPercent: 0, appliesTo: "Deposit", label: t("policies.newRuleLabel"), sourceQuote: null, sourcePage: null }])}>
                  <Plus /> {t("policies.addRule")}
                </Button>
              )}
            </div>
          </Section>

          <Section title={t("policies.otherTitle")}>
            <div className="space-y-4">
              <div className="max-w-[200px]">
                <Field label={t("policies.noShow")} hint={t("policies.noShowHint")}>
                  <Input type="number" min={0} max={100} disabled={readOnly} value={noShow} onChange={(e) => setNoShow(Number(e.target.value))} className="tabular" />
                </Field>
              </div>
              <Field label={t("policies.notes")} optional>
                <Textarea rows={2} disabled={readOnly} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section title={t("policies.previewTitle")} description={t("policies.previewDescription")}>
            <div className="divide-y">
              {[...rules].sort((a, b) => b.minHoursBeforeCheckIn - a.minHoursBeforeCheckIn).map((r, i) => (
                <RuleSentence key={i} r={r} />
              ))}
            </div>
          </Section>
        </div>

        <div className="xl:sticky xl:top-6 xl:h-[calc(100dvh-3rem)]">
          {doc ? (
            <div className="flex h-full min-h-[560px] flex-col overflow-hidden rounded-xl border">
              <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5 text-sm">
                <span className="truncate font-medium">{doc.fileName}</span>
                <span className="shrink-0 text-muted-foreground tabular">{t("policies.page", { page })}</span>
              </div>
              {focusQuote && <p className="border-b bg-brand-soft/60 px-4 py-2 text-xs">“{focusQuote}”</p>}
              <iframe key={page} title={doc.fileName} src={`${doc.url}#page=${page}&view=FitH`} className="w-full flex-1 bg-muted" />
            </div>
          ) : (
            <EmptyState icon={<FileText />} title={t("policies.noSourceTitle")} description={t("policies.noSourceDescription")} />
          )}
        </div>
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("policies.activateTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{warnings.length ? t("policies.activateWithWarnings", { count: warnings.length }) : t("policies.activateDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => activate.mutate()}>{t("policies.activate")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function FaqSection() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const faqs = useQuery({ queryKey: ["faqs"], queryFn: () => api.get<Faq[]>("/api/app/faqs") })
  const [editing, setEditing] = useState<{ id?: string; question: string; answer: string } | null>(null)
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["faqs"] })
    void qc.invalidateQueries({ queryKey: ["public"] })
  }
  const save = useMutation({
    mutationFn: () => (editing?.id ? api.put(`/api/app/faqs/${editing.id}`, editing) : api.post("/api/app/faqs", editing)),
    onSuccess: () => { setEditing(null); invalidate() },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const approve = useMutation({ mutationFn: (id: string) => api.post(`/api/app/faqs/${id}/approve`), onSuccess: invalidate })
  const del = useMutation({ mutationFn: (id: string) => api.del(`/api/app/faqs/${id}`), onSuccess: invalidate })
  const suggested = (faqs.data ?? []).filter((f) => f.status === "Suggested")
  const approved = (faqs.data ?? []).filter((f) => f.status === "Approved")

  return (
    <Section
      title={t("policies.faqTitle")}
      description={t("policies.faqDescription")}
      actions={
        <Button variant="outline" size="sm" onClick={() => setEditing({ question: "", answer: "" })}>
          <Plus /> {t("policies.addFaq")}
        </Button>
      }
    >
      {faqs.isLoading ? (
        <Skeleton className="h-24" />
      ) : (
        <div className="space-y-6">
          {editing && (
            <div className="space-y-3 rounded-lg border p-4">
              <Field label={t("policies.question")}>
                <Input value={editing.question} onChange={(e) => setEditing({ ...editing, question: e.target.value })} autoFocus />
              </Field>
              <Field label={t("policies.answer")}>
                <Textarea rows={3} value={editing.answer} onChange={(e) => setEditing({ ...editing, answer: e.target.value })} />
              </Field>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || !editing.question.trim() || !editing.answer.trim()}>
                  {save.isPending && <Spinner />} {t("common.save")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  {t("common.cancel")}
                </Button>
              </div>
            </div>
          )}
          {suggested.length > 0 && (
            <div>
              <p className="text-sm font-medium">{t("policies.suggested", { count: suggested.length })}</p>
              <p className="text-xs text-muted-foreground">{t("policies.suggestedHint")}</p>
              <ul className="mt-3 divide-y rounded-lg border">
                {suggested.map((f) => (
                  <li key={f.id} className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{f.question}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">{f.answer}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" onClick={() => approve.mutate(f.id)}>{t("policies.approve")}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing({ id: f.id, question: f.question, answer: f.answer })}>{t("common.edit")}</Button>
                      <Button size="sm" variant="ghost" onClick={() => del.mutate(f.id)}>{t("policies.dismiss")}</Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {approved.length === 0 && suggested.length === 0 && !editing ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("policies.noFaqs")}</p>
          ) : (
            approved.length > 0 && (
              <ul className="divide-y rounded-lg border">
                {approved.map((f) => (
                  <li key={f.id} className="group flex items-start justify-between gap-4 p-3.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{f.question}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">{f.answer}</p>
                    </div>
                    <div className="flex shrink-0 gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                      <Button size="sm" variant="ghost" onClick={() => setEditing({ id: f.id, question: f.question, answer: f.answer })}>{t("common.edit")}</Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => del.mutate(f.id)} aria-label={t("common.delete")}><Trash2 /></Button>
                    </div>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      )}
    </Section>
  )
}

export default function Policies() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const [params, setParams] = useSearchParams()
  const reviewId = params.get("review")
  const inputRef = useRef<HTMLInputElement>(null)
  const docs = useQuery({
    queryKey: ["policy-docs"],
    queryFn: () => api.get<PolicyDocument[]>("/api/app/policies/documents"),
    refetchInterval: (q) => (q.state.data?.some((d) => d.status === "Processing" || d.status === "Uploaded") ? 2500 : false),
  })
  const policies = useQuery({ queryKey: ["policies"], queryFn: () => api.get<RefundPolicy[]>("/api/app/policies"), refetchInterval: docs.data?.some((d) => d.status !== "Ready" && d.status !== "Failed") ? 3000 : false })
  useInboxHub({
    documentChanged: () => {
      void qc.invalidateQueries({ queryKey: ["policy-docs"] })
      void qc.invalidateQueries({ queryKey: ["policies"] })
      void qc.invalidateQueries({ queryKey: ["faqs"] })
    },
  })
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append("file", file)
      return api.upload<PolicyDocument>("/api/app/policies/documents", form)
    },
    onSuccess: () => {
      toast.success(t("policies.uploaded"))
      void qc.invalidateQueries({ queryKey: ["policy-docs"] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const delDoc = useMutation({ mutationFn: (id: string) => api.del(`/api/app/policies/documents/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ["policy-docs"] }) })
  const reprocess = useMutation({ mutationFn: (id: string) => api.post(`/api/app/policies/documents/${id}/reprocess`), onSuccess: () => void qc.invalidateQueries({ queryKey: ["policy-docs"] }) })
  const newDraft = useMutation({
    mutationFn: () => api.post<RefundPolicy>("/api/app/policies/draft"),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ["policies"] })
      setParams({ review: p.id })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  if (reviewId)
    return (
      <Page>
        <Review policyId={reviewId} docs={docs.data ?? []} onClose={() => setParams({})} />
      </Page>
    )

  const active = policies.data?.find((p) => p.status === "Active")
  const drafts = policies.data?.filter((p) => p.status === "Draft") ?? []
  const archived = policies.data?.filter((p) => p.status === "Archived") ?? []

  return (
    <Page>
      <PageHeader
        title={t("policies.title")}
        description={t("policies.description")}
        actions={
          <Button onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
            {upload.isPending ? <Spinner /> : <Upload />} {t("policies.upload")}
          </Button>
        }
      />
      <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = "" }} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-6">
          {drafts.map((d) => (
            <div key={d.id} className="flex flex-col gap-3 rounded-xl border border-brand/30 bg-brand-soft/50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">{t("policies.draftReady", { version: d.version })}</p>
                <p className="text-sm text-muted-foreground">
                  {t("policies.draftSummary", { count: d.rules.length })}
                  {d.warnings.length > 0 && ` · ${t("policies.warningsCount", { count: d.warnings.length })}`}
                </p>
              </div>
              <Button onClick={() => setParams({ review: d.id })}>{t("policies.review")}</Button>
            </div>
          ))}

          <Section
            title={t("policies.activeTitle")}
            description={active ? t("policies.activeMeta", { version: active.version, who: active.approvedBy ?? "", date: active.approvedAt ? date(active.approvedAt) : "" }) : undefined}
            actions={
              active && (
                <Button variant="outline" size="sm" onClick={() => newDraft.mutate()} disabled={newDraft.isPending}>
                  {t("policies.edit")}
                </Button>
              )
            }
          >
            {policies.isLoading ? (
              <Skeleton className="h-28" />
            ) : policies.error ? (
              <ErrorState error={policies.error} onRetry={() => void policies.refetch()} />
            ) : active ? (
              <>
                <div className="divide-y">
                  {[...active.rules].sort((a, b) => b.minHoursBeforeCheckIn - a.minHoursBeforeCheckIn).map((r, i) => (
                    <RuleSentence key={i} r={r} />
                  ))}
                  <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
                    <span>{t("public.noShow")}</span>
                    <span className="font-medium">{active.noShowRefundPercent > 0 ? `${active.noShowRefundPercent}%` : t("public.noRefund")}</span>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">{t("policies.activeHint")}</p>
              </>
            ) : (
              <EmptyState
                className="border-0 py-8"
                icon={<FileText />}
                title={t("policies.noActiveTitle")}
                description={t("policies.noActiveDescription")}
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button onClick={() => inputRef.current?.click()}><Upload /> {t("policies.upload")}</Button>
                    <Button variant="outline" onClick={() => newDraft.mutate()}>{t("policies.writeManually")}</Button>
                  </div>
                }
              />
            )}
          </Section>

          <FaqSection />
        </div>

        <div className="space-y-6">
          <Section title={t("policies.documents")} description={t("policies.documentsDescription")}>
            {docs.isLoading ? (
              <RowsSkeleton rows={2} className="border-0" />
            ) : !docs.data?.length ? (
              <p className="py-4 text-center text-sm text-muted-foreground">{t("policies.noDocuments")}</p>
            ) : (
              <ul className="-mx-2 divide-y">
                {docs.data.map((d) => (
                  <li key={d.id} className="flex items-start gap-3 px-2 py-3">
                    <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <a href={d.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:underline">
                        {d.fileName}
                      </a>
                      <p className="text-xs text-muted-foreground">
                        {d.status === "Ready" ? t("policies.docReady", { pages: d.pageCount, chunks: d.chunkCount }) : d.status === "Failed" ? (d.statusDetail ?? t("policies.docFailed")) : t("policies.docProcessing")}
                        {" · "}
                        {relative(d.uploadedAt)}
                      </p>
                    </div>
                    {d.status === "Processing" || d.status === "Uploaded" ? (
                      <Spinner className="mt-0.5 text-muted-foreground" />
                    ) : (
                      <div className="flex shrink-0">
                        {d.status === "Failed" && (
                          <Button size="xs" variant="ghost" onClick={() => reprocess.mutate(d.id)}>
                            {t("common.tryAgain")}
                          </Button>
                        )}
                        <Button size="icon-xs" variant="ghost" onClick={() => delDoc.mutate(d.id)} aria-label={t("common.delete")}>
                          <Trash2 />
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {archived.length > 0 && (
            <Section title={t("policies.history")}>
              <ul className="-mx-2 divide-y">
                {archived.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => setParams({ review: p.id })} className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2.5 text-left text-sm hover:bg-muted/60">
                      <span>{t("policies.versionLabel", { version: p.version })}</span>
                      <span className="text-xs text-muted-foreground">{p.approvedAt ? date(p.approvedAt) : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </Page>
  )
}
