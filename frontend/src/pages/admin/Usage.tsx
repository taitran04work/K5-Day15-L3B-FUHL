import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { Skeleton } from "@/components/ui/skeleton"
import { Page } from "@/components/layout/AppShell"
import { ErrorState, PageHeader, Section, Stat } from "@/components/common"
import { BarSeries } from "@/components/app/BarSeries"
import { api } from "@/lib/api"
import { number, shortDate } from "@/lib/format"

interface UsageData {
  tenants: number
  activeTenants: number
  bookings30: number
  conversations30: number
  tokens30: number
  days: { date: string; guestMessages: number; botMessages: number; tokens: number }[]
}

export default function Usage() {
  const { t } = useTranslation()
  const usage = useQuery({ queryKey: ["admin-usage"], queryFn: () => api.get<UsageData>("/api/admin/usage") })
  if (usage.error) return <Page><ErrorState error={usage.error} onRetry={() => void usage.refetch()} /></Page>
  const d = usage.data
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
                <BarSeries caption={t("admin.guestMessages")} data={d.days.map((x) => ({ key: x.date, label: shortDate(x.date), value: x.guestMessages }))} format={number} />
              )}
            </Section>
            <Section title={t("admin.tokens")} description={t("admin.perDay")}>
              {d.days.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">{t("admin.noUsage")}</p>
              ) : (
                <BarSeries caption={t("admin.tokens")} data={d.days.map((x) => ({ key: x.date, label: shortDate(x.date), value: x.tokens }))} format={number} />
              )}
            </Section>
          </div>
        </div>
      )}
    </Page>
  )
}
