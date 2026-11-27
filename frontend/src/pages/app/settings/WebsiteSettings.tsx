import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ExternalLink, ImagePlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Page } from "@/components/layout/AppShell"
import { ErrorState, Field, PageHeader, Section, Spinner, useErrorMessage, useFieldError } from "@/components/common"
import { PhotoTile } from "@/components/booking/BookingParts"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { brandStyle, isBrandColor } from "@/lib/brand"
import { resizeToWebp } from "@/lib/image"
import { cn } from "@/lib/utils"
import type { TenantSettings } from "@/lib/types"
import { useSettings } from "./BotSettings"

const SWATCHES = ["#1F5F4A", "#111111", "#B83A0B", "#2F4858", "#5B4636", "#7A3B3B", "#3D4F7D", "#4B5D3A"]

export default function WebsiteSettings() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { refresh } = useAuth()
  const settings = useSettings()
  const fieldError = useFieldError()
  const errorMessage = useErrorMessage()
  const [s, setS] = useState<TenantSettings | null>(null)
  const logoRef = useRef<HTMLInputElement>(null)
  const coverRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (settings.data) setS(settings.data)
  }, [settings.data])

  const save = useMutation({
    mutationFn: () =>
      api.put<TenantSettings>("/api/app/settings/website", {
        name: s!.name, description: s!.description, address: s!.address, phone: s!.phone, email: s!.email,
        accentColor: s!.accentColor, latitude: s!.latitude, longitude: s!.longitude, defaultLanguage: s!.defaultLanguage,
      }),
    onSuccess: (res) => {
      qc.setQueryData(["settings"], res)
      void qc.invalidateQueries({ queryKey: ["public"] })
      void refresh()
      toast.success(t("common.saved"))
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const upload = useMutation({
    mutationFn: async ({ kind, file }: { kind: "logo" | "cover"; file: File }) => {
      const form = new FormData()
      form.append("file", await resizeToWebp(file, kind === "logo" ? 512 : 2400))
      return api.upload<TenantSettings>(`/api/app/settings/images/${kind}`, form)
    },
    onSuccess: (res) => {
      qc.setQueryData(["settings"], res)
      setS((x) => (x ? { ...x, logoUrl: res.logoUrl, coverImageUrl: res.coverImageUrl } : x))
      toast.success(t("common.saved"))
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  if (settings.error) return <Page narrow><ErrorState error={settings.error} onRetry={() => void settings.refetch()} /></Page>
  if (!s) return <Page narrow><Skeleton className="h-8 w-48" /><Skeleton className="mt-6 h-64 w-full" /></Page>
  const set = <K extends keyof TenantSettings>(k: K, v: TenantSettings[K]) => setS({ ...s, [k]: v })
  const validColor = isBrandColor(s.accentColor)
  const colorError = validColor ? fieldError(save.error, "accentColor") : t("validation.color_format")
  const preview = brandStyle(validColor ? s.accentColor : settings.data?.accentColor)

  return (
    <Page narrow>
      <PageHeader
        title={t("website.title")}
        description={t("website.description")}
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={`/h/${s.slug}`} target="_blank" rel="noreferrer">
                {t("website.view")} <ExternalLink />
              </a>
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !validColor}>
              {save.isPending && <Spinner />} {t("common.saveChanges")}
            </Button>
          </>
        }
      />
      <div className="space-y-6">
        <Section title={t("website.images")}>
          <div className="grid gap-6 sm:grid-cols-[160px_1fr]">
            <div>
              <p className="mb-2 text-sm font-medium">{t("website.logo")}</p>
              <button type="button" aria-label={t("website.logo")} onClick={() => logoRef.current?.click()} className="flex size-32 items-center justify-center overflow-hidden rounded-xl border border-dashed hover:bg-muted/40">
                {s.logoUrl ? <img src={s.logoUrl} alt="" className="size-full object-contain p-2" /> : <ImagePlus className="size-5 text-muted-foreground" />}
              </button>
              <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate({ kind: "logo", file: f }); e.target.value = "" }} />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">{t("website.cover")}</p>
              <button type="button" onClick={() => coverRef.current?.click()} className="block w-full overflow-hidden rounded-xl border border-dashed hover:opacity-95">
                {s.coverImageUrl ? <PhotoTile url={s.coverImageUrl} alt="" className="aspect-[21/9] w-full" /> : <span className="flex aspect-[21/9] items-center justify-center text-muted-foreground"><ImagePlus className="size-5" /></span>}
              </button>
              <input ref={coverRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate({ kind: "cover", file: f }); e.target.value = "" }} />
              {upload.isPending && <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Spinner className="size-3" /> {t("website.uploading")}</p>}
            </div>
          </div>
        </Section>

        <Section title={t("website.details")}>
          <div className="space-y-4">
            <Field label={t("website.name")} error={fieldError(save.error, "name")}>
              <Input value={s.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label={t("website.intro")} hint={t("website.introHint")}>
              <Textarea rows={4} value={s.description ?? ""} onChange={(e) => set("description", e.target.value)} />
            </Field>
            <Field label={t("website.address")}>
              <Input value={s.address ?? ""} onChange={(e) => set("address", e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("website.phone")} error={fieldError(save.error, "phone")}>
                <Input type="tel" value={s.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
              </Field>
              <Field label={t("website.email")} error={fieldError(save.error, "email")}>
                <Input type="email" value={s.email ?? ""} onChange={(e) => set("email", e.target.value)} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("website.latitude")} optional>
                <Input type="number" step="0.0001" value={s.latitude ?? ""} onChange={(e) => set("latitude", e.target.value === "" ? null : Number(e.target.value))} className="tabular" />
              </Field>
              <Field label={t("website.longitude")} optional hint={t("website.mapHint")}>
                <Input type="number" step="0.0001" value={s.longitude ?? ""} onChange={(e) => set("longitude", e.target.value === "" ? null : Number(e.target.value))} className="tabular" />
              </Field>
            </div>
          </div>
        </Section>

        <Section title={t("website.accent")} description={t("website.accentHint")}>
          <div className="flex flex-wrap items-center gap-2">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => set("accentColor", c)}
                className={cn("size-8 rounded-full border border-input ring-offset-2 ring-offset-card transition", s.accentColor.toLowerCase() === c.toLowerCase() && "ring-2 ring-foreground")}
                style={{ background: c }}
                aria-label={c}
                aria-pressed={s.accentColor.toLowerCase() === c.toLowerCase()}
              />
            ))}
            <input type="color" value={preview["--brand"]} onChange={(e) => set("accentColor", e.target.value)} className="h-9 w-10 cursor-pointer rounded-md border border-input bg-background p-1" aria-label={t("website.colorPicker")} />
            <Input value={s.accentColor} onChange={(e) => set("accentColor", e.target.value)} className="w-28 font-mono text-xs" aria-label={t("website.customColor")} aria-invalid={!!colorError} aria-describedby={colorError ? "website-color-error" : undefined} />
          </div>
          {colorError && <p id="website-color-error" className="mt-2 text-xs text-destructive">{colorError}</p>}
          <div className="website-color-preview mt-5 flex flex-wrap items-center gap-3 rounded-lg border bg-background p-4" style={preview}>
            <span className="inline-flex h-8 items-center rounded-md border border-black/10 bg-primary px-3 text-sm font-medium text-primary-foreground">{t("website.previewButton")}</span>
            <span className="text-sm text-muted-foreground">{t("website.previewText")}</span>
          </div>
        </Section>
      </div>
    </Page>
  )
}
