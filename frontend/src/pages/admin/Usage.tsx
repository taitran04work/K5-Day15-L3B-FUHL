import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Page } from "@/components/layout/AppShell"
import { ErrorState, Field, PageHeader, Section, Stat } from "@/components/common"
import { BarSeries } from "@/components/app/BarSeries"
import { api } from "@/lib/api"
import { number, shortDate } from "@/lib/format"

interface UsageData {
  tenants: number
  activeTenants: number
  bookings30: number
  conversations30: number
  inputTokens30: number
  outputTokens30: number
  tokens30: number
  days: { date: string; guestMessages: number; botMessages: number; tokens: number }[]
}

const MODELS = [
  { name: "Gemini 3.1 Flash Lite", inputPer1M: 0.25, outputPer1M: 1.5 },
  { name: "Gemini 4 Hydrogen", inputPer1M: 1.5, outputPer1M: 7.5 },
  { name: "Claude Sonnet 4.5", inputPer1M: 3.0, outputPer1M: 15.0 },
]

export default function Usage() {
  const { t } = useTranslation()
  const usage = useQuery({ queryKey: ["admin-usage"], queryFn: () => api.get<UsageData>("/api/admin/usage") })
  const [sessionsBase, setSessionsBase] = useState(700)
  const [turnsPerSession, setTurnsPerSession] = useState(4)
  const [vndRate, setVndRate] = useState(25400)

  if (usage.error) return <Page><ErrorState error={usage.error} onRetry={() => void usage.refetch()} /></Page>
  const d = usage.data

  const convs = d && d.conversations30 > 0 ? d.conversations30 : 1
  const avgInPerSession = d && d.inputTokens30 > 0 ? Math.round(d.inputTokens30 / convs) : turnsPerSession * 1400
  const avgOutPerSession = d && d.outputTokens30 > 0 ? Math.round(d.outputTokens30 / convs) : turnsPerSession * 350

  const fmtUsd = (v: number) => (v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`)
  const fmtVnd = (v: number) => `${Math.round(v * vndRate).toLocaleString("vi-VN")} ₫`

  return (
    <Page>
      <PageHeader title={t("admin.usageTitle")} description={t("admin.usageDescription")} />
      {!d ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label={t("admin.activeTenants")} value={`${d.activeTenants} / ${d.tenants}`} />
            <Stat label={t("admin.bookings30")} value={number(d.bookings30)} />
            <Stat label={t("admin.conversations30")} value={number(d.conversations30)} />
            <Stat label={t("admin.tokens30")} value={number(d.tokens30)} />
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <Section title={t("admin.guestMessages")} description={t("admin.perDay")}>
              {d.days.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">{t("admin.noUsage")}</p>
              ) : (
                <BarSeries
                  caption={t("admin.guestMessages")}
                  data={d.days.map((x) => ({
                    key: x.date,
                    label: shortDate(x.date),
                    axisLabel: `${x.date.slice(8, 10)}/${x.date.slice(5, 7)}`,
                    value: x.guestMessages,
                  }))}
                  format={number}
                />
              )}
            </Section>
            <Section title={t("admin.tokens")} description={t("admin.perDay")}>
              {d.days.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">{t("admin.noUsage")}</p>
              ) : (
                <BarSeries
                  caption={t("admin.tokens")}
                  data={d.days.map((x) => ({
                    key: x.date,
                    label: shortDate(x.date),
                    axisLabel: `${x.date.slice(8, 10)}/${x.date.slice(5, 7)}`,
                    value: x.tokens,
                  }))}
                  format={number}
                />
              )}
            </Section>
          </div>

          <Section
            title="Mô phỏng chi phí AI (Cost Simulation)"
            description={`Ước tính từ ${number(avgInPerSession)} token vào + ${number(avgOutPerSession)} token ra / phiên (${d.tokens30 > 0 ? "đo từ dữ liệu thực" : "ước tính theo số lượt/phiên"}).`}
          >
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Số phiên / tháng (kịch bản cơ sở)">
                  <Input type="number" min={10} value={sessionsBase} onChange={(e) => setSessionsBase(Math.max(1, Number(e.target.value) || 1))} />
                </Field>
                <Field label="Số lượt hỏi / phiên (mặc định khi chưa có log)">
                  <Input type="number" min={1} max={20} value={turnsPerSession} onChange={(e) => setTurnsPerSession(Math.max(1, Number(e.target.value) || 1))} />
                </Field>
                <Field label="Tỉ giá USD → VND">
                  <Input type="number" min={1000} value={vndRate} onChange={(e) => setVndRate(Math.max(1000, Number(e.target.value) || 25400))} />
                </Field>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-4">Model</th>
                      <th className="py-2 pr-4">Chi phí / phiên</th>
                      <th className="py-2 pr-4">Thấp ({Math.round(sessionsBase * 0.4)} phiên/tháng)</th>
                      <th className="py-2 pr-4">Cơ sở ({sessionsBase} phiên/tháng)</th>
                      <th className="py-2">Cao ({Math.round(sessionsBase * 1.5)} phiên/tháng)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MODELS.map((m) => {
                      const perSession = (avgInPerSession * m.inputPer1M + avgOutPerSession * m.outputPer1M) / 1_000_000
                      const low = perSession * Math.round(sessionsBase * 0.4)
                      const base = perSession * sessionsBase
                      const high = perSession * Math.round(sessionsBase * 1.5)
                      return (
                        <tr key={m.name} className="border-b last:border-0">
                          <td className="py-2.5 pr-4 font-medium">{m.name}</td>
                          <td className="py-2.5 pr-4 tabular">{fmtUsd(perSession)} ({fmtVnd(perSession)})</td>
                          <td className="py-2.5 pr-4 tabular">{fmtUsd(low)} ({fmtVnd(low)})</td>
                          <td className="py-2.5 pr-4 font-medium tabular">{fmtUsd(base)} ({fmtVnd(base)})</td>
                          <td className="py-2.5 tabular">{fmtUsd(high)} ({fmtVnd(high)})</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </Section>
        </div>
      )}
    </Page>
  )
}
