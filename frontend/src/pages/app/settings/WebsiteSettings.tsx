import { useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ExternalLink, ImagePlus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Page } from "@/components/layout/AppShell"
import { ErrorState, Field, PageHeader, Section, Spinner, useErrorMessage, useFieldError } from "@/components/common"
import { PhotoTile } from "@/components/booking/BookingParts"
import { getLanguageOption, languageOptions } from "@/i18n/languages"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { brandStyle, isBrandColor } from "@/lib/brand"
import { resizeToWebp } from "@/lib/image"
import { cn } from "@/lib/utils"
import type { TenantSettings } from "@/lib/types"
import { useSettings } from "./BotSettings"
import { homeBackdrops } from "@/lib/homeBackdrops"
import { usePublicHome } from "@/pages/public/PublicLayout"

type ImageKind = "logo" | "cover" | "bg-about" | "bg-rooms" | "bg-policies" | "bg-contact"
type BgKind = Exclude<ImageKind, "logo" | "cover">

/** Home page slides that can have their own background (the hero uses the cover photo). */
const BG_SLOTS: { kind: BgKind; field: "bgAboutUrl" | "bgRoomsUrl" | "bgPoliciesUrl" | "bgContactUrl"; slide: string; label: string }[] = [
  { kind: "bg-about", field: "bgAboutUrl", slide: "gioi-thieu", label: "public.deck.navAbout" },
  { kind: "bg-rooms", field: "bgRoomsUrl", slide: "rooms", label: "public.deck.navRooms" },
  { kind: "bg-policies", field: "bgPoliciesUrl", slide: "chinh-sach", label: "public.deck.navPolicies" },
  { kind: "bg-contact", field: "bgContactUrl", slide: "lien-he", label: "public.deck.navContact" },
]

const IMAGE_FIELDS = ["logoUrl", "coverImageUrl", "bgAboutUrl", "bgRoomsUrl", "bgPoliciesUrl", "bgContactUrl"] as const
const SWATCHES = ["#1F5F4A", "#111111", "#B83A0B", "#2F4858", "#5B4636", "#7A3B3B", "#3D4F7D", "#4B5D3A"]

function websiteValues(settings: TenantSettings) {
  const { name, description, address, phone, email, accentColor, latitude, longitude, defaultLanguage } = settings
  return { name, description, address, phone, email, accentColor, latitude, longitude, defaultLanguage }
}

export default function WebsiteSettings() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { refresh } = useAuth()
  const settings = useSettings()
  const fieldError = useFieldError()
  const errorMessage = useErrorMessage()
  const [draft, setDraft] = useState<Partial<TenantSettings>>({})
  const s = settings.data ? { ...settings.data, ...draft } : null
  const logoRef = useRef<HTMLInputElement>(null)
  const coverRef = useRef<HTMLInputElement>(null)
  const bgRef = useRef<HTMLInputElement>(null)
  const [bgTarget, setBgTarget] = useState<BgKind | null>(null)
  const [smtpDraft, setSmtpDraft] = useState<{
    host?: string
    port?: number
    username?: string
    password: string
    fromEmail?: string
    fromName?: string
    enableSsl?: boolean
  }>({ password: "" })
  // what guests actually see behind each slide (auto picks included), from the same data the home page uses
  const publicHome = usePublicHome(settings.data?.slug ?? "")
  const backdrops = useMemo(() => (publicHome.data ? homeBackdrops(publicHome.data) : null), [publicHome.data])

  const save = useMutation({
    mutationFn: (values: TenantSettings) =>
      api.put<TenantSettings>("/api/app/settings/website", websiteValues(values)),
    onSuccess: (res, saved) => {
      qc.setQueryData<TenantSettings>(["settings"], (current) => current ? { ...current, ...websiteValues(res) } : res)
      setDraft((current) => Object.fromEntries(Object.entries(current).filter(([key, value]) => value !== saved[key as keyof TenantSettings])))
      void qc.invalidateQueries({ queryKey: ["public"] })
      void refresh()
      toast.success(t("common.saved"))
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const upload = useMutation({
    mutationFn: async ({ kind, file }: { kind: ImageKind; file: File }) => {
      const form = new FormData()
      form.append("file", await resizeToWebp(file, kind === "logo" ? 512 : 2400))
      return api.upload<TenantSettings>(`/api/app/settings/images/${kind}`, form)
    },
    onSuccess: (res) => onImages(res),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const removeImage = useMutation({
    mutationFn: (kind: ImageKind) => api.del<TenantSettings>(`/api/app/settings/images/${kind}`),
    onSuccess: (res) => onImages(res),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const saveEmail = useMutation({
    mutationFn: (removeConfig: boolean) =>
      api.put<TenantSettings>("/api/app/settings/email", {
        host: removeConfig ? null : (smtpDraft.host ?? s?.smtpHost ?? "smtp.gmail.com"),
        port: removeConfig ? null : (smtpDraft.port ?? s?.smtpPort ?? 587),
        username: removeConfig ? null : (smtpDraft.username ?? s?.smtpUsername ?? ""),
        password: removeConfig ? null : (smtpDraft.password || null),
        fromEmail: removeConfig ? null : (smtpDraft.fromEmail ?? s?.smtpFromEmail ?? null),
        fromName: removeConfig ? null : (smtpDraft.fromName ?? s?.smtpFromName ?? null),
        enableSsl: removeConfig ? true : (smtpDraft.enableSsl ?? s?.smtpEnableSsl ?? true),
        removeConfig,
      }),
    onSuccess: (res, removeConfig) => {
      qc.setQueryData<TenantSettings>(["settings"], res)
      setSmtpDraft({ password: "" })
      toast.success(t(removeConfig ? "website.emailRemoved" : "website.emailSaved"))
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  // Image updates use the saved settings. Form edits are held separately until Save.
  function onImages(res: TenantSettings) {
    qc.setQueryData<TenantSettings>(["settings"], (current) => current
      ? { ...current, ...Object.fromEntries(IMAGE_FIELDS.map((key) => [key, res[key]])) }
      : res)
    void qc.invalidateQueries({ queryKey: ["public"] })
    toast.success(t("common.saved"))
  }

  if (settings.error) return <Page narrow><ErrorState error={settings.error} onRetry={() => void settings.refetch()} /></Page>
  if (!s) return <Page narrow><Skeleton className="h-8 w-48" /><Skeleton className="mt-6 h-64 w-full" /></Page>
  const set = <K extends keyof TenantSettings>(k: K, v: TenantSettings[K]) => setDraft((current) => ({ ...current, [k]: v }))
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
            <Button onClick={() => save.mutate(s)} disabled={save.isPending || !validColor}>
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
              <p className="mt-2 text-xs text-muted-foreground">{t("website.coverHint")}</p>
              {upload.isPending && <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Spinner className="size-3" /> {t("website.uploading")}</p>}
            </div>
          </div>
        </Section>

        <Section title={t("website.backgrounds")} description={t("website.backgroundsHint")}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {BG_SLOTS.map(({ kind, field, slide, label }) => {
              const url = s[field]
              const auto = !url ? backdrops?.[slide]?.url : undefined
              return (
                <div key={kind}>
                  <p className="mb-2 text-sm font-medium">{t(label)}</p>
                  <div className="relative">
                    <button
                      type="button"
                      aria-label={t(label)}
                      onClick={() => { setBgTarget(kind); bgRef.current?.click() }}
                      className="block w-full overflow-hidden rounded-xl border border-dashed hover:opacity-95"
                    >
                      {url ? (
                        <PhotoTile url={url} alt="" className="aspect-[4/3] w-full" />
                      ) : auto ? (
                        <span className="group relative block">
                          <PhotoTile url={auto} alt="" className="aspect-[4/3] w-full" />
                          <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-medium text-white">
                            {t("website.autoBackground")}
                          </span>
                          <span className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/45 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                            <ImagePlus className="size-4" /> {t("website.replaceBackground")}
                          </span>
                        </span>
                      ) : (
                        <span className="flex aspect-[4/3] flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
                          <ImagePlus className="size-5" />
                          {t("website.autoBackground")}
                        </span>
                      )}
                    </button>
                    {url && (
                      <button
                        type="button"
                        onClick={() => removeImage.mutate(kind)}
                        aria-label={t("common.remove", { defaultValue: "Remove" })}
                        className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                      >
                        <X className="size-4" />
                      </button>
                    )}
                    {upload.isPending && upload.variables?.kind === kind && (
                      <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/70">
                        <Spinner className="size-4" />
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <input
            ref={bgRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f && bgTarget) upload.mutate({ kind: bgTarget, file: f })
              e.target.value = ""
            }}
          />
        </Section>

        <Section title={t("website.details")}>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
              <Field label={t("website.name")} error={fieldError(save.error, "name")}>
                <Input value={s.name} onChange={(e) => set("name", e.target.value)} />
              </Field>
              <Field label={t("website.guestLanguage")} htmlFor="guest-language" error={fieldError(save.error, "defaultLanguage")}>
                <Select value={getLanguageOption(s.defaultLanguage).value} onValueChange={(v) => set("defaultLanguage", v)}>
                  <SelectTrigger id="guest-language" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {languageOptions.map(({ value, short }) => <SelectItem key={value} value={value}>{short}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
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
            {s.latitude != null && s.longitude != null && Math.abs(s.latitude) <= 90 && Math.abs(s.longitude) <= 180 && (
              <iframe
                key={`${s.latitude},${s.longitude}`}
                title={t("admin.mapPreview")}
                src={`https://www.google.com/maps?q=${s.latitude},${s.longitude}&z=15&output=embed`}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="block h-56 w-full rounded-xl border bg-muted"
              />
            )}
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

        <Section
          title={t("website.emailConfig")}
          description={t("website.emailConfigHint")}
          actions={
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-medium",
                s.smtpCustom ? "bg-brand-soft text-brand" : "bg-muted text-muted-foreground",
              )}
            >
              {t(s.smtpCustom ? "website.emailStatusCustom" : "website.emailStatusDefault")}
            </span>
          }
        >
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
              <Field label={t("website.smtpHost")} htmlFor="smtp-host">
                <Input
                  id="smtp-host"
                  value={smtpDraft.host ?? s.smtpHost ?? "smtp.gmail.com"}
                  onChange={(e) => setSmtpDraft((d) => ({ ...d, host: e.target.value }))}
                  placeholder="smtp.gmail.com"
                />
              </Field>
              <Field label={t("website.smtpPort")} htmlFor="smtp-port">
                <Input
                  id="smtp-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={smtpDraft.port ?? s.smtpPort ?? 587}
                  onChange={(e) => setSmtpDraft((d) => ({ ...d, port: e.target.value === "" ? 587 : Number(e.target.value) }))}
                  className="tabular"
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("website.smtpUsername")} htmlFor="smtp-user">
                <Input
                  id="smtp-user"
                  type="email"
                  value={smtpDraft.username ?? s.smtpUsername ?? ""}
                  onChange={(e) => setSmtpDraft((d) => ({ ...d, username: e.target.value }))}
                  placeholder="homestay@gmail.com"
                />
              </Field>
              <Field label={t("website.smtpPassword")} htmlFor="smtp-pass" hint={s.smtpCustom ? t("website.smtpPasswordSavedHint") : undefined}>
                <Input
                  id="smtp-pass"
                  type="password"
                  autoComplete="new-password"
                  value={smtpDraft.password}
                  onChange={(e) => setSmtpDraft((d) => ({ ...d, password: e.target.value }))}
                  placeholder={s.smtpCustom ? "••••••••••••••••" : ""}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("website.smtpFromEmail")} htmlFor="smtp-from-email" optional>
                <Input
                  id="smtp-from-email"
                  type="email"
                  value={smtpDraft.fromEmail ?? s.smtpFromEmail ?? ""}
                  onChange={(e) => setSmtpDraft((d) => ({ ...d, fromEmail: e.target.value }))}
                  placeholder={smtpDraft.username ?? s.smtpUsername ?? "homestay@gmail.com"}
                />
              </Field>
              <Field label={t("website.smtpFromName")} htmlFor="smtp-from-name" optional>
                <Input
                  id="smtp-from-name"
                  value={smtpDraft.fromName ?? s.smtpFromName ?? ""}
                  onChange={(e) => setSmtpDraft((d) => ({ ...d, fromName: e.target.value }))}
                  placeholder={s.name}
                />
              </Field>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-xl border p-3.5">
              <Label htmlFor="smtp-ssl" className="flex-1 cursor-pointer text-sm font-medium">
                {t("website.smtpSsl")}
              </Label>
              <Switch
                id="smtp-ssl"
                checked={smtpDraft.enableSsl ?? s.smtpEnableSsl ?? true}
                onCheckedChange={(v) => setSmtpDraft((d) => ({ ...d, enableSsl: v }))}
              />
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              {s.smtpCustom && (
                <Button variant="outline" onClick={() => saveEmail.mutate(true)} disabled={saveEmail.isPending}>
                  {t("website.removeEmail")}
                </Button>
              )}
              <Button onClick={() => saveEmail.mutate(false)} disabled={saveEmail.isPending}>
                {saveEmail.isPending && <Spinner />} {t("website.saveEmail")}
              </Button>
            </div>
          </div>
        </Section>
      </div>
    </Page>
  )
}
