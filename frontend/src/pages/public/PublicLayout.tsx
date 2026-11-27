import { Link, NavLink, Outlet, useOutletContext, useParams } from "react-router"
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { useEffect } from "react"
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
  const { t } = useTranslation()
  const home = usePublicHome(slug)
  useBrand(home.data?.tenant.accentColor)

  useEffect(() => {
    if (home.data) document.title = home.data.tenant.name
  }, [home.data])

  if (home.isLoading)
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted-foreground">
        <Spinner className="size-5" />
      </div>
    )
  if (home.error || !home.data)
    return (
      <div className="mx-auto max-w-lg px-4 py-24">
        {home.error instanceof ApiError && home.error.status === 404 ? (
          <div className="text-center">
            <h1 className="text-xl">{t("public.notFoundTitle")}</h1>
            <p className="mt-2 text-muted-foreground">{t("public.notFoundDescription")}</p>
          </div>
        ) : (
          <ErrorState error={home.error} onRetry={() => void home.refetch()} />
        )}
      </div>
    )

  const tenant = home.data.tenant
  const navCls = ({ isActive }: { isActive: boolean }) => cn("rounded-md py-1.5 text-sm text-muted-foreground hover:text-foreground sm:px-3", isActive && "text-foreground")

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6">
          <Link to={`/h/${slug}`} className="flex min-w-0 items-center gap-2 sm:gap-2.5">
            {tenant.logoUrl ? (
              <img src={tenant.logoUrl} alt="" className="size-7 shrink-0 rounded-md object-cover sm:size-8" />
            ) : (
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand text-sm font-semibold text-brand-foreground sm:size-8">{tenant.name[0]}</span>
            )}
            <span className="truncate text-sm font-semibold tracking-tight sm:text-base">{tenant.name}</span>
          </Link>
          <nav className="flex shrink-0 items-center gap-2 sm:gap-1" aria-label={t("nav.main")}>
            <NavLink to={`/h/${slug}`} end className={cn(navCls({ isActive: false }), "hidden sm:inline-flex")}>
              {t("public.rooms")}
            </NavLink>
            <NavLink to={`/h/${slug}/manage`} className={navCls}>
              {t("public.manageBooking")}
            </NavLink>
            <LanguageSwitch className="ml-2 hidden sm:inline-flex" />
            {tenant.botEnabled && <ChatWidget slug={slug} tenant={tenant} />}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <Outlet context={{ home: home.data, slug }} />
      </main>

      <footer className="mt-12 border-t sm:mt-24">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-muted-foreground sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="space-y-1">
            <p className="font-medium text-foreground">{tenant.name}</p>
            {tenant.address && <p>{tenant.address}</p>}
            <p>
              {tenant.phone && <a href={`tel:${tenant.phone}`} className="hover:text-foreground">{tenant.phone}</a>}
              {tenant.phone && tenant.email && " · "}
              {tenant.email && <a href={`mailto:${tenant.email}`} className="hover:text-foreground">{tenant.email}</a>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <LanguageSwitch className="sm:hidden" />
            <span className="text-xs">{t("public.poweredBy")} Stayra</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
