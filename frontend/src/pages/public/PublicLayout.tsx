import { Link, NavLink, Outlet, useLocation, useOutletContext, useParams } from "react-router"
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { LanguageSwitch } from "@/components/LanguageSwitch"
import { ErrorState, Spinner } from "@/components/common"
import { ChatWidget } from "@/components/chat/ChatWidget"
import { api, ApiError } from "@/lib/api"
import { useBrand } from "@/lib/brand"
import { cn } from "@/lib/utils"
import type { PublicHome } from "@/lib/types"

export function usePublicHome(slug: string) {
  return useQuery({ queryKey: ["public", slug], queryFn: () => api.get<PublicHome>(`/api/public/${slug}`), staleTime: 60_000 })
}

export function usePublic() {
  return useOutletContext<{ home: PublicHome; slug: string }>()
}

export default function PublicLayout() {
  const { slug = "" } = useParams()
  const { pathname } = useLocation()
  const { t } = useTranslation()
  const home = usePublicHome(slug)
  const [scrolled, setScrolled] = useState(false)
  useBrand(home.data?.tenant.accentColor)

  useEffect(() => {
    if (home.data) document.title = home.data.tenant.name
  }, [home.data])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  if (home.isLoading)
    return (
      <div className="public-editorial flex min-h-dvh items-center justify-center text-muted-foreground">
        <Spinner className="size-5" />
      </div>
    )
  if (home.error || !home.data)
    return (
      <div className="public-editorial min-h-dvh">
        <div className="mx-auto max-w-lg px-4 py-24">
          {home.error instanceof ApiError && home.error.status === 404 ? (
            <div className="rounded-2xl border bg-card p-10 text-center">
              <h1 className="font-editorial text-2xl font-medium">{t("public.notFoundTitle")}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{t("public.notFoundDescription")}</p>
            </div>
          ) : (
            <ErrorState error={home.error} onRetry={() => void home.refetch()} />
          )}
        </div>
      </div>
    )

  const tenant = home.data.tenant
  const normalizedPath = pathname.replace(/\/+$/, "")
  const isHome = normalizedPath === `/h/${slug}`
  const overlayHero = isHome && !scrolled

  const navCls = ({ isActive }: { isActive: boolean }) =>
    cn(
      "rounded-full px-3 py-1.5 text-sm transition-colors duration-200",
      overlayHero
        ? cn("text-white/85 hover:text-white", isActive && "bg-white/15 text-white")
        : cn("text-muted-foreground hover:text-foreground", isActive && "font-medium text-foreground"),
    )

  return (
    <div className="public-editorial flex min-h-dvh flex-col">
      <header
        className={cn(
          "z-30 transition-all duration-300",
          isHome ? "fixed inset-x-0 top-0" : "sticky top-0",
          overlayHero
            ? "border-b border-white/15 bg-gradient-to-b from-black/50 to-transparent text-white"
            : "border-b border-border/80 bg-[var(--editorial-surface)]/92 text-foreground backdrop-blur-md",
        )}
      >
        <div className="mx-auto flex h-[72px] max-w-[1280px] items-center justify-between gap-3 px-4 sm:px-8">
          <Link to={`/h/${slug}`} className="group flex min-w-0 items-center gap-3">
            {tenant.logoUrl ? (
              <img src={tenant.logoUrl} alt="" className="size-8 shrink-0 rounded-full object-cover ring-1 ring-black/10" />
            ) : (
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold tracking-wide transition-colors",
                  overlayHero ? "bg-white/20 text-white backdrop-blur-xs ring-1 ring-white/30" : "bg-brand text-brand-foreground",
                )}
              >
                {tenant.name[0]}
              </span>
            )}
            <span className="truncate font-editorial text-lg font-medium tracking-tight sm:text-xl">{tenant.name}</span>
          </Link>

          <nav className="flex shrink-0 items-center gap-1 sm:gap-2" aria-label={t("nav.main")}>
            <NavLink to={`/h/${slug}`} end className={({ isActive }) => cn(navCls({ isActive }), "hidden sm:inline-flex")}>
              {t("public.rooms")}
            </NavLink>
            <NavLink to={`/h/${slug}/manage`} className={navCls}>
              {t("public.manageBooking")}
            </NavLink>
            <LanguageSwitch
              className={cn(
                "ml-2 hidden sm:inline-flex",
                overlayHero && "border-white/30 bg-black/25 [&_button]:text-white/80 [&_button[aria-checked=true]]:bg-white [&_button[aria-checked=true]]:text-[#171614]",
              )}
            />
            {tenant.botEnabled && <ChatWidget slug={slug} tenant={tenant} />}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <div key={pathname} className="animate-panel-enter">
          <Outlet context={{ home: home.data, slug }} />
        </div>
      </main>

      <footer className="mt-16 border-t bg-[var(--editorial-surface-alt)] sm:mt-24">
        <div className="mx-auto max-w-[1280px] px-4 py-14 text-sm text-muted-foreground sm:px-8 sm:py-16">
          <div className="flex flex-col justify-between gap-10 md:flex-row md:items-end">
            <div className="max-w-md space-y-2">
              <p className="font-editorial text-xl font-medium text-foreground">{tenant.name}</p>
              {tenant.address && <p className="leading-relaxed">{tenant.address}</p>}
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
                {tenant.phone && (
                  <a href={`tel:${tenant.phone}`} className="transition-colors hover:text-foreground">
                    {tenant.phone}
                  </a>
                )}
                {tenant.phone && tenant.email && <span aria-hidden>·</span>}
                {tenant.email && (
                  <a href={`mailto:${tenant.email}`} className="transition-colors hover:text-foreground">
                    {tenant.email}
                  </a>
                )}
              </p>
            </div>

            <div className="flex flex-col items-start gap-4 md:items-end">
              <div className="flex flex-wrap items-center gap-5 text-sm">
                <Link to={`/h/${slug}`} className="transition-colors hover:text-foreground">
                  {t("public.rooms")}
                </Link>
                <Link to={`/h/${slug}/manage`} className="transition-colors hover:text-foreground">
                  {t("public.manageBooking")}
                </Link>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <LanguageSwitch className="sm:hidden" />
                <span className="text-xs tracking-wide">{t("public.poweredBy")} Stayra</span>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
