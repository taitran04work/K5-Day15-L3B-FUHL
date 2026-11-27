import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Copy, ExternalLink, Eye, EyeOff, MapPin, Plus, Users, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Page } from "@/components/layout/AppShell"
import { EmptyState, ErrorState, Field, PageHeader, RowsSkeleton, Spinner, useErrorMessage, useFieldError } from "@/components/common"
import { languageOptions } from "@/i18n/languages"
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

const EMPTY_TENANT = {
  name: "", slug: "", description: "", address: "", phone: "", contactEmail: "", latitude: "", longitude: "", defaultLanguage: "vi",
  ownerName: "", ownerEmail: "", ownerPassword: "",
}

/** 12 chars, no look-alikes (0/O, 1/l/I), always with upper, lower and a digit. */
function generatePassword() {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789"]
  const all = sets.join("")
  const pick = (chars: string) => chars[crypto.getRandomValues(new Uint32Array(1))[0] % chars.length]
  const out = [...sets.map(pick), ...Array.from({ length: 9 }, () => pick(all))]
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out.join("")
}

/** Accepts "11.9316", "11,9316" or a pasted "11.9316, 108.4383" pair from Google Maps. */
function parseCoord(v: string) {
  const n = Number(v.trim().replace(",", "."))
  return v.trim() === "" || !Number.isFinite(n) ? null : n
}

function CopyButton({ value }: { value: string }) {
  const { t } = useTranslation()
  return (
    <Button variant="outline" size="icon" type="button" onClick={() => { void navigator.clipboard.writeText(value); toast.success(t("common.copied")) }} aria-label={t("common.copy")}>
      <Copy />
    </Button>
  )
}

function CreateTenantSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const fieldError = useFieldError()
  const errorMessage = useErrorMessage()
  const [f, setF] = useState(EMPTY_TENANT)
  const [showPw, setShowPw] = useState(false)
  const lat = parseCoord(f.latitude)
  const lng = parseCoord(f.longitude)
  const coordsValid = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180

  const create = useMutation({
    mutationFn: () =>
      api.post<{ tenant: AdminTenant; loginEmail: string }>("/api/admin/tenants", {
        name: f.name, slug: f.slug || null, ownerName: f.ownerName, ownerEmail: f.ownerEmail, ownerPassword: f.ownerPassword,
        description: f.description, address: f.address, phone: f.phone, contactEmail: f.contactEmail || null, defaultLanguage: f.defaultLanguage,
        latitude: lat, longitude: lng,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin-tenants"] }),
  })
  const close = (o: boolean) => {
    if (!o) {
      create.reset()
      setF(EMPTY_TENANT)
      setShowPw(false)
    }
    onOpenChange(o)
  }
  // pasting "lat, lng" into either box fills both
  const onCoord = (field: "latitude" | "longitude", v: string) => {
    const pair = v.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/)
    if (pair) setF({ ...f, latitude: pair[1], longitude: pair[2] })
    else setF({ ...f, [field]: v })
  }
  const done = create.data
  const loginUrl = `${window.location.origin}/login`

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
              <Field label={t("admin.loginPage")}>
                <div className="flex gap-2">
                  <Input readOnly value={loginUrl} className="font-mono text-xs" />
                  <CopyButton value={loginUrl} />
                </div>
              </Field>
              <Field label={t("admin.loginEmail")}>
                <div className="flex gap-2">
                  <Input readOnly value={done.loginEmail} className="font-mono" />
                  <CopyButton value={done.loginEmail} />
                </div>
              </Field>
              <Field label={t("admin.ownerPassword")} hint={t("admin.passwordShownOnce")}>
                <div className="flex gap-2">
                  <Input readOnly value={f.ownerPassword} className="font-mono" />
                  <CopyButton value={f.ownerPassword} />
                </div>
              </Field>
              <Button variant="outline" asChild>
                <a href={`/h/${done.tenant.slug}`} target="_blank" rel="noreferrer">
                  {t("admin.openSite")} <ExternalLink />
                </a>
              </Button>
            </>
          ) : (
            <>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("website.details")}</h3>
              <Field label={t("admin.homestayName")} error={fieldError(create.error, "name")}>
                <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
              </Field>
              <Field label={t("admin.webAddress")} optional hint={`/h/${f.slug || (f.name ? f.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "your-homestay")}`} error={fieldError(create.error, "slug")}>
                <Input value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} className="font-mono" />
              </Field>
              <Field label={t("website.intro")} hint={t("website.introHint")} error={fieldError(create.error, "description")}>
                <Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
              </Field>
              <Field label={t("website.address")} error={fieldError(create.error, "address")}>
                <Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("website.phone")} error={fieldError(create.error, "phone")}>
                  <Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="0912 345 678" />
                </Field>
                <Field label={t("website.email")} optional hint={t("admin.contactEmailHint")} error={fieldError(create.error, "contactEmail")}>
                  <Input type="email" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} placeholder={f.ownerEmail || "stay@homestay.vn"} />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("website.latitude")} optional error={fieldError(create.error, "latitude")}>
                  <Input inputMode="decimal" placeholder="10.346" value={f.latitude} onChange={(e) => onCoord("latitude", e.target.value)} className="font-mono" />
                </Field>
                <Field label={t("website.longitude")} optional error={fieldError(create.error, "longitude")}>
                  <Input inputMode="decimal" placeholder="107.096" value={f.longitude} onChange={(e) => onCoord("longitude", e.target.value)} className="font-mono" />
                </Field>
              </div>
              <p className="-mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                <MapPin className="mt-px size-3.5 shrink-0" />
                {t("admin.coordsHint")}
              </p>
              {coordsValid && (
                <iframe
                  key={`${lat},${lng}`}
                  title={t("admin.mapPreview")}
                  src={`https://www.google.com/maps?q=${lat},${lng}&z=15&output=embed`}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="block h-56 w-full rounded-xl border bg-muted"
                />
              )}
              <Field label={t("botSettings.language")}>
                <Select value={f.defaultLanguage} onValueChange={(v) => setF({ ...f, defaultLanguage: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {languageOptions.map(({ value, short }) => (
                      <SelectItem key={value} value={value}>{short}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <h3 className="border-t pt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("admin.ownerAccount")}</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("admin.ownerName")} error={fieldError(create.error, "ownerName")}>
                  <Input value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} />
                </Field>
                <Field label={t("admin.ownerEmail")} error={fieldError(create.error, "ownerEmail")}>
                  <Input type="email" value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} autoComplete="off" />
                </Field>
              </div>
              <Field label={t("admin.ownerPassword")} hint={t("admin.passwordHint")} error={fieldError(create.error, "ownerPassword")}>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showPw ? "text" : "password"}
                      value={f.ownerPassword}
                      onChange={(e) => setF({ ...f, ownerPassword: e.target.value })}
                      autoComplete="new-password"
                      className="pr-10 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                      aria-label={showPw ? t("aiKey.hide") : t("aiKey.show")}
                    >
                      {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  <Button type="button" variant="outline" onClick={() => { setF({ ...f, ownerPassword: generatePassword() }); setShowPw(true) }}>
                    <Wand2 /> {t("admin.generate")}
                  </Button>
                </div>
              </Field>
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
