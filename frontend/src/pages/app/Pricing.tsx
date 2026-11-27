import type { TFunction } from "i18next"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { parseISO } from "date-fns"
import { Plus, Tag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Page } from "@/components/layout/AppShell"
import { EmptyState, ErrorState, Field, PageHeader, RowsSkeleton, Section, Spinner, useErrorMessage, useFieldError } from "@/components/common"
import { api } from "@/lib/api"
import { date as fmtDate, money } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { AdjustmentType, DayOfWeek, PriceRule, PriceRuleType, Room } from "@/lib/types"

const DAYS: DayOfWeek[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
type RuleForm = Omit<PriceRule, "id">
const blank: RuleForm = { roomId: null, name: "", type: "Weekend", daysOfWeek: ["Friday", "Saturday"], startDate: null, endDate: null, startTime: null, endTime: null, adjustmentType: "Percent", value: 10, priority: 10, isActive: true }

function RuleDialog({ rule, open, onOpenChange, rooms }: { rule: PriceRule | null; open: boolean; onOpenChange: (o: boolean) => void; rooms: Room[] }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const fieldError = useFieldError()
  const errorMessage = useErrorMessage()
  const [f, setF] = useState<RuleForm>(blank)
  useEffect(() => {
    if (open) setF(rule ? { ...rule, startTime: rule.startTime?.slice(0, 5) ?? null, endTime: rule.endTime?.slice(0, 5) ?? null } : blank)
  }, [open, rule])
  const set = <K extends keyof RuleForm>(k: K, v: RuleForm[K]) => setF((x) => ({ ...x, [k]: v }))
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, startTime: f.startTime ? `${f.startTime.slice(0, 5)}:00` : null, endTime: f.endTime ? `${f.endTime.slice(0, 5)}:00` : null }
      return rule ? api.put(`/api/app/pricing/rules/${rule.id}`, body) : api.post("/api/app/pricing/rules", body)
    },
    onSuccess: () => {
      toast.success(t("common.saved"))
      void qc.invalidateQueries({ queryKey: ["price-rules"] })
      void qc.invalidateQueries({ queryKey: ["price-calendar"] })
      onOpenChange(false)
    },
  })
  const del = useMutation({
    mutationFn: () => api.del(`/api/app/pricing/rules/${rule!.id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["price-rules"] })
      void qc.invalidateQueries({ queryKey: ["price-calendar"] })
      onOpenChange(false)
    },
  })
  const needsDates = f.type === "DateRange" || f.type === "Holiday"
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{rule ? t("pricing.editRule") : t("pricing.newRule")}</DialogTitle>
          <DialogDescription>{t("pricing.ruleDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label={t("pricing.name")} error={fieldError(save.error, "name")}>
            <Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={t("pricing.namePlaceholder")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("pricing.when")}>
              <Select value={f.type} onValueChange={(v) => set("type", v as PriceRuleType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["Weekend", "DateRange", "Holiday", "HourWindow"] as const).map((x) => (
                    <SelectItem key={x} value={x}>
                      {t(`pricing.type.${x}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("pricing.appliesTo")}>
              <Select value={f.roomId ?? "all"} onValueChange={(v) => set("roomId", v === "all" ? null : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("pricing.allRooms")}</SelectItem>
                  {rooms.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {(f.type === "Weekend" || f.type === "HourWindow" || needsDates) && (
            <fieldset>
              <legend className="text-sm font-medium">{t("pricing.days")}</legend>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {DAYS.map((d) => {
                  const on = f.daysOfWeek.includes(d)
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set("daysOfWeek", on ? f.daysOfWeek.filter((x) => x !== d) : [...f.daysOfWeek, d])}
                      className={cn("w-11 rounded-md border py-1.5 text-xs", on ? "border-foreground bg-foreground text-background" : "text-muted-foreground")}
                    >
                      {t(`days.short.${d}`)}
                    </button>
                  )
                })}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{f.type === "Weekend" ? t("pricing.weekendHint") : t("pricing.daysHint")}</p>
            </fieldset>
          )}
          {needsDates && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("pricing.from")} error={fieldError(save.error, "startDate")}>
                <Input type="date" value={f.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || null)} />
              </Field>
              <Field label={t("pricing.to")} error={fieldError(save.error, "endDate")}>
                <Input type="date" value={f.endDate ?? ""} onChange={(e) => set("endDate", e.target.value || null)} />
              </Field>
            </div>
          )}
          {f.type === "HourWindow" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("pricing.fromTime")} error={fieldError(save.error, "startTime")}>
                <Input type="time" value={f.startTime ?? ""} onChange={(e) => set("startTime", e.target.value || null)} />
              </Field>
              <Field label={t("pricing.toTime")} error={fieldError(save.error, "endTime")}>
                <Input type="time" value={f.endTime ?? ""} onChange={(e) => set("endTime", e.target.value || null)} />
              </Field>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("pricing.adjustment")}>
              <Select value={f.adjustmentType} onValueChange={(v) => set("adjustmentType", v as AdjustmentType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["Percent", "Fixed", "Override"] as const).map((x) => (
                    <SelectItem key={x} value={x}>
                      {t(`pricing.adj.${x}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={f.adjustmentType === "Percent" ? t("pricing.percent") : t("pricing.amount")} error={fieldError(save.error, "value")}>
              <Input type="number" value={f.value} step={f.adjustmentType === "Percent" ? 1 : 10000} onChange={(e) => set("value", Number(e.target.value))} className="tabular" />
            </Field>
            <Field label={t("pricing.priority")} hint={t("pricing.priorityHint")}>
              <Input type="number" value={f.priority} onChange={(e) => set("priority", Number(e.target.value))} className="tabular" />
            </Field>
          </div>
          {save.error && !fieldError(save.error, "name") && <p className="text-sm text-destructive">{errorMessage(save.error)}</p>}
        </div>
        <DialogFooter>
          {rule && (
            <Button variant="ghost" className="mr-auto text-destructive hover:text-destructive" onClick={() => del.mutate()} disabled={del.isPending}>
              {t("common.delete")}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Spinner />} {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function describeAdj(t: TFunction, r: PriceRule) {
  if (r.adjustmentType === "Percent") return `${r.value > 0 ? "+" : ""}${r.value}%`
  if (r.adjustmentType === "Fixed") return `${r.value > 0 ? "+" : ""}${money(r.value)}`
  return t("pricing.setTo", { price: money(r.value) })
}

function PricePreview({ rooms }: { rooms: Room[] }) {
  const { t } = useTranslation()
  const nightly = rooms.filter((r) => r.supportsNightly)
  const [roomId, setRoomId] = useState<string>("")
  const [days, setDays] = useState<7 | 14>(14)
  const id = roomId || nightly[0]?.id
  const cal = useQuery({
    queryKey: ["price-calendar", id, days],
    enabled: !!id,
    queryFn: () => api.get<{ date: string; price: number; rule: string | null }[]>(`/api/app/pricing/calendar?roomId=${id}&days=${days}`),
  })
  const room = nightly.find((r) => r.id === id)
  const weeks = useMemo(() => {
    const list = cal.data ?? []
    if (!list.length) return []
    const first = parseISO(list[0].date)
    const pad = (first.getDay() + 6) % 7
    const cells: ({ date: string; price: number; rule: string | null } | null)[] = [...Array(pad).fill(null), ...list]
    const rows = []
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))
    return rows
  }, [cal.data])

  if (!nightly.length) return null
  return (
    <Section
      title={t("pricing.previewTitle")}
      description={t("pricing.previewDescription", { days })}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label={t("pricing.previewTitle")} className="inline-flex items-center rounded-lg border bg-muted/60 p-0.5 text-xs">
            {([7, 14] as const).map((d) => {
              const active = days === d
              return (
                <button
                  key={d}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setDays(d)}
                  className={cn(
                    "rounded-md px-2.5 py-1 font-medium transition-all",
                    active ? "bg-background font-semibold text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {d === 7 ? t("pricing.oneWeek") : t("pricing.twoWeeks")}
                </button>
              )
            })}
          </div>
          <Select value={id} onValueChange={setRoomId}>
            <SelectTrigger className="w-48" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {nightly.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    >
      {cal.isLoading ? (
        <Skeleton className="h-44 w-full rounded-lg" />
      ) : (
        <>
          <div className="grid grid-cols-7 gap-2 text-center text-xs font-medium text-muted-foreground">
            {DAYS.map((d) => (
              <span key={d} className="py-1">
                {t(`days.short.${d}`)}
              </span>
            ))}
          </div>
          <div className="mt-1.5 space-y-2">
            {weeks.map((w, i) => (
              <div key={i} className="grid grid-cols-7 gap-2">
                {w.map((c, j) => {
                  if (!c) return <div key={j} className="rounded-lg border border-dashed border-border/50 bg-muted/20" />
                  const dt = parseISO(c.date)
                  const changed = !!c.rule && c.price !== room?.baseNightlyPrice
                  return (
                    <div
                      key={c.date}
                      title={`${fmtDate(c.date + "T12:00:00+07:00")} · ${money(c.price)}${c.rule ? ` · ${c.rule}` : ""}`}
                      className={cn(
                        "flex min-h-[82px] flex-col justify-between rounded-lg border px-2.5 py-2 transition-colors",
                        changed ? "border-brand/40 bg-brand-soft" : "bg-background/50",
                      )}
                    >
                      <span className="text-xs font-medium text-muted-foreground tabular">
                        {String(dt.getDate()).padStart(2, "0")}/{String(dt.getMonth() + 1).padStart(2, "0")}
                      </span>
                      <div className="mt-2">
                        <p className={cn("text-sm font-semibold tabular leading-tight", changed ? "text-brand" : "text-foreground")}>
                          {money(c.price)}
                        </p>
                        <p className={cn("mt-0.5 truncate text-[11px]", changed ? "text-brand/85" : "text-subtle")}>
                          {changed ? c.rule : t("pricing.basePriceTag")}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">{t("pricing.previewLegend", { price: money(room?.baseNightlyPrice ?? 0) })}</p>
        </>
      )}
    </Section>
  )
}

export default function Pricing() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const rules = useQuery({ queryKey: ["price-rules"], queryFn: () => api.get<PriceRule[]>("/api/app/pricing/rules") })
  const rooms = useQuery({ queryKey: ["rooms"], queryFn: () => api.get<Room[]>("/api/app/rooms") })
  const [editing, setEditing] = useState<PriceRule | null>(null)
  const [open, setOpen] = useState(false)
  const toggle = useMutation({
    mutationFn: (r: PriceRule) => api.put(`/api/app/pricing/rules/${r.id}`, { ...r, isActive: !r.isActive }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["price-rules"] })
      void qc.invalidateQueries({ queryKey: ["price-calendar"] })
    },
  })
  const roomName = (id: string | null) => (id ? (rooms.data?.find((r) => r.id === id)?.name ?? "") : t("pricing.allRooms"))

  return (
    <Page>
      <PageHeader
        title={t("pricing.title")}
        description={t("pricing.description")}
        actions={
          <Button onClick={() => { setEditing(null); setOpen(true) }}>
            <Plus /> {t("pricing.addRule")}
          </Button>
        }
      />
      <div className="space-y-6">
        <Section title={t("pricing.rulesTitle")} description={t("pricing.orderHint")}>
          {rules.isLoading ? (
            <RowsSkeleton rows={3} />
          ) : rules.error ? (
            <ErrorState error={rules.error} onRetry={() => void rules.refetch()} />
          ) : !rules.data?.length ? (
            <EmptyState
              icon={<Tag />}
              title={t("pricing.emptyTitle")}
              description={t("pricing.emptyDescription")}
              action={
                <Button onClick={() => setOpen(true)}>
                  <Plus /> {t("pricing.addRule")}
                </Button>
              }
            />
          ) : (
            <div className="responsive-table-frame -mx-1 rounded-lg border">
              <table className="responsive-table w-full text-sm" role="table">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">{t("pricing.col.rule")}</th>
                    <th className="px-4 py-2.5 font-medium">{t("pricing.col.when")}</th>
                    <th className="px-4 py-2.5 text-right font-medium">{t("pricing.col.change")}</th>
                    <th className="px-4 py-2.5 text-right font-medium">{t("pricing.col.priority")}</th>
                    <th className="px-4 py-2.5 font-medium">
                      <span className="sr-only">{t("pricing.col.active")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rules.data.map((r) => (
                    <tr key={r.id} className="cursor-pointer transition-colors hover:bg-muted/50" onClick={() => { setEditing(r); setOpen(true) }}>
                      <td data-row-title className="px-4 py-3">
                        <p className={cn("font-medium", !r.isActive && "text-muted-foreground")}>{r.name}</p>
                        <p className="text-xs text-muted-foreground">{roomName(r.roomId)}</p>
                      </td>
                      <td data-label={t("pricing.col.when")} className="px-4 py-3 text-muted-foreground">
                        {t(`pricing.type.${r.type}`)}
                        {r.startDate && ` · ${fmtDate(r.startDate + "T12:00:00+07:00")} – ${fmtDate(r.endDate + "T12:00:00+07:00")}`}
                        {r.startTime && ` · ${r.startTime.slice(0, 5)}–${r.endTime?.slice(0, 5)}`}
                        {r.daysOfWeek.length > 0 && r.type !== "Holiday" && ` · ${r.daysOfWeek.map((d) => t(`days.short.${d}`)).join(", ")}`}
                      </td>
                      <td
                        data-label={t("pricing.col.change")}
                        className={cn("px-4 py-3 text-right font-medium tabular", r.isActive ? "text-brand" : "text-muted-foreground")}
                      >
                        {describeAdj(t, r)}
                      </td>
                      <td data-label={t("pricing.col.priority")} className="px-4 py-3 text-right text-muted-foreground tabular">{r.priority}</td>
                      <td data-label={t("pricing.col.active")} className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <Switch checked={r.isActive} onCheckedChange={() => toggle.mutate(r)} aria-label={t("pricing.col.active")} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
        <PricePreview rooms={rooms.data ?? []} />
      </div>
      <RuleDialog rule={editing} open={open} onOpenChange={setOpen} rooms={rooms.data ?? []} />
    </Page>
  )
}
