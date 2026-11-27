import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Copy, ExternalLink, Plus, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Page } from "@/components/layout/AppShell"
import { EmptyState, ErrorState, Field, PageHeader, RowsSkeleton, Spinner, useErrorMessage, useFieldError } from "@/components/common"
import { api } from "@/lib/api"
import { date, money, number } from "@/lib/format"
import { cn } from "@/lib/utils"

interface AdminTenant {
  id: string
  slug: string
  name: string
  status: "Active" | "Suspended"
  ownerEmail: string | null
  address: string | null
  rooms: number
  bookingsLast30: number
  revenueLast30: number
  conversations30: number
  tokensLast30: number
  createdAt: string
}

function CreateTenantSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const fieldError = useFieldError()
  const errorMessage = useErrorMessage()
  const [f, setF] = useState({ name: "", slug: "", ownerName: "", ownerEmail: "", address: "", phone: "", defaultLanguage: "vi" })
  const create = useMutation({
    mutationFn: () => api.post<{ inviteUrl: string; temporaryPassword: string; tenant: AdminTenant }>("/api/admin/tenants", { ...f, slug: f.slug || null }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-tenants"] }),
  })
  const close = (o: boolean) => {
    if (!o) {
      create.reset()
      setF({ name: "", slug: "", ownerName: "", ownerEmail: "", address: "", phone: "", defaultLanguage: "vi" })
    }
    onOpenChange(o)
  }
  const done = create.data
  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle>{done ? t("admin.createdTitle") : t("admin.createTitle")}</SheetTitle>
          <SheetDescription>{done ? t("admin.createdDescription", { name: done.tenant.name }) : t("admin.createDescription")}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-6 py-5">
          {done ? (
            <>
              <Field label={t("admin.inviteLink")} hint={t("admin.inviteHint")}>
                <div className="flex gap-2">
                  <Input readOnly value={done.inviteUrl} className="font-mono text-xs" />
                  <Button variant="outline" size="icon" onClick={() => { void navigator.clipboard.writeText(done.inviteUrl); toast.success(t("common.copied")) }} aria-label={t("common.copy")}>
                    <Copy />
                  </Button>
                </div>
              </Field>
              <Field label={t("admin.tempPassword")}>
                <Input readOnly value={done.temporaryPassword} className="font-mono" />
              </Field>
              <Button variant="outline" asChild>
                <a href={`/h/${done.tenant.slug}`} target="_blank" rel="noreferrer">
                  {t("admin.openSite")} <ExternalLink />
                </a>
              </Button>
            </>
          ) : (
            <>
              <Field label={t("admin.homestayName")} error={fieldError(create.error, "name")}>
                <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
              </Field>
              <Field label={t("admin.webAddress")} optional hint={`/h/${f.slug || (f.name ? f.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "your-homestay")}`} error={fieldError(create.error, "slug")}>
                <Input value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} className="font-mono" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("admin.ownerName")} error={fieldError(create.error, "ownerName")}>
                  <Input value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} />
                </Field>
                <Field label={t("admin.ownerEmail")} error={fieldError(create.error, "ownerEmail")}>
                  <Input type="email" value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} />
                </Field>
              </div>
              <Field label={t("website.address")} optional>
                <Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("website.phone")} optional>
                  <Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
                </Field>
                <Field label={t("botSettings.language")}>
                  <Select value={f.defaultLanguage} onValueChange={(v) => setF({ ...f, defaultLanguage: v })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="vi">Tiếng Việt</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              {create.error && !Object.keys((create.error as { errors?: object }).errors ?? {}).length && <p className="text-sm text-destructive">{errorMessage(create.error)}</p>}
            </>
          )}
        </div>
        <SheetFooter className="border-t px-6 py-4">
          {done ? (
            <Button onClick={() => close(false)}>{t("common.done")}</Button>
          ) : (
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => close(false)}>
                {t("common.cancel")}
              </Button>
              <Button onClick={() => create.mutate()} disabled={create.isPending}>
                {create.isPending && <Spinner />} {t("admin.create")}
              </Button>
            </div>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export default function Tenants() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const tenants = useQuery({ queryKey: ["admin-tenants"], queryFn: () => api.get<AdminTenant[]>("/api/admin/tenants") })
  const [open, setOpen] = useState(false)
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.post(`/api/admin/tenants/${id}/status`, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-tenants"] }),
    onError: (e) => toast.error(errorMessage(e)),
  })
  return (
    <Page>
      <PageHeader
        title={t("admin.tenantsTitle")}
        description={t("admin.tenantsDescription")}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> {t("admin.newTenant")}
          </Button>
        }
      />
      {tenants.isLoading ? (
        <RowsSkeleton />
      ) : tenants.error ? (
        <ErrorState error={tenants.error} onRetry={() => void tenants.refetch()} />
      ) : !tenants.data?.length ? (
        <EmptyState icon={<Users />} title={t("admin.emptyTitle")} description={t("admin.emptyDescription")} action={<Button onClick={() => setOpen(true)}><Plus /> {t("admin.newTenant")}</Button>} />
      ) : (
        <div className="responsive-table-frame rounded-xl border">
          <table className="responsive-table w-full text-sm" role="table">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">{t("admin.col.homestay")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("admin.col.rooms")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("admin.col.bookings")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("admin.col.revenue")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("admin.col.conversations")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("admin.col.tokens")}</th>
                <th className="px-4 py-2.5 font-medium">{t("admin.col.status")}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {tenants.data.map((x) => (
                <tr key={x.id}>
                  <td data-row-title className="px-4 py-3">
                    <a href={`/h/${x.slug}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                      {x.name}
                    </a>
                    <p className="text-xs text-muted-foreground">
                      {x.ownerEmail} · {t("admin.since", { date: date(x.createdAt) })}
                    </p>
                  </td>
                  <td data-label={t("admin.col.rooms")} className="px-4 py-3 text-right tabular">{x.rooms}</td>
                  <td data-label={t("admin.col.bookings")} className="px-4 py-3 text-right tabular">{x.bookingsLast30}</td>
                  <td data-label={t("admin.col.revenue")} className="px-4 py-3 text-right tabular">{money(x.revenueLast30)}</td>
                  <td data-label={t("admin.col.conversations")} className="px-4 py-3 text-right tabular">{x.conversations30}</td>
                  <td data-label={t("admin.col.tokens")} className="px-4 py-3 text-right text-muted-foreground tabular">{number(x.tokensLast30)}</td>
                  <td data-label={t("admin.col.status")} className="px-4 py-3">
                    <span className={cn("text-sm", x.status === "Suspended" && "text-destructive")}>{t(`admin.status.${x.status}`)}</span>
                  </td>
                  <td data-row-action className="px-4 py-3 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setStatus.mutate({ id: x.id, status: x.status === "Active" ? "Suspended" : "Active" })}>
                      {x.status === "Active" ? t("admin.suspend") : t("admin.reactivate")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{t("admin.last30")}</p>
      <CreateTenantSheet open={open} onOpenChange={setOpen} />
    </Page>
  )
}
