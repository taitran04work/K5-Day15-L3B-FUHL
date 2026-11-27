import { lazy, Suspense, useEffect } from "react"
import { Link, NavLink, Outlet, useLocation, useOutletContext, useParams } from "react-router"
import { useTranslation } from "react-i18next"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useQuery } from "@tanstack/react-query"
import { ErrorState, Spinner } from "@/components/common"
import { api, ApiError } from "@/lib/api"
import { useBrand } from "@/lib/brand"
import { cn } from "@/lib/utils"
import type { PublicHome } from "@/lib/types"
import { Logo } from "@/components/Logo"
import { GuestBackdrop, GuestPageHeading, GuestStateCard } from "./GuestVisuals"
import { GuestLanguage } from "./GuestLanguage"

const ChatWidget = lazy(() => import("@/components/chat/ChatWidget").then((m) => ({ default: m.ChatWidget })))

export function usePublicHome(slug: string) {
  return useQuery({ queryKey: ["public", slug], queryFn: () => api.get<PublicHome>(`/api/public/${slug}`), staleTime: 60_000, enabled: !!slug })
}

export function usePublic() {
  return useOutletContext<{ home: PublicHome; slug: string }>()
}

export default function PublicLayout() {
  const { slug = "" } = useParams()
  const { pathname } = useLocation()
  const { t } = useTranslation()
  const home = usePublicHome(slug)
  useBrand(home.data?.tenant.accentColor)

  useEffect(() => {
    if (home.data) document.title = home.data.tenant.name
  }, [home.data])

  if (home.isLoading)
    return (
      <div className="guest-storefront flex min-h-dvh items-center justify-center text-muted-foreground">
        <Spinner className="size-5" />
      </div>
    )
  if (home.error || !home.data)
    return (
      <div className="guest-storefront grid min-h-dvh place-items-center px-4 py-12">
        <div className="w-full max-w-lg">
          {home.error instanceof ApiError && home.error.status === 404 ? (
            <GuestStateCard>
              <GuestPageHeading title={t("public.notFoundTitle")} description={t("public.notFoundDescription")} />
            </GuestStateCard>
          ) : (
            <div className="guest-panel"><ErrorState className="border-0" error={home.error} onRetry={() => void home.refetch()} /></div>
          )}
        </div>
      </div>
    )

  return (
    <GuestLanguage language={home.data.tenant.defaultLanguage}>
      <Storefront home={home.data} slug={slug} pathname={pathname} />
    </GuestLanguage>
  )
}

function Storefront({ home, slug, pathname }: { home: PublicHome; slug: string; pathname: string }) {
  const { tenant } = home
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const normalizedPath = pathname.replace(/\/+$/, "")
  const isHome = normalizedPath === `/h/${slug}`

  const navCls = ({ isActive }: { isActive: boolean }) =>
    cn(
      "rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground sm:text-sm",
      isActive && "bg-white/12 text-foreground",
    )

  return (
    <div className="guest-storefront min-h-dvh bg-[#0b0f16]">
      <AnimatePresence mode="wait" initial={false}>
        {isHome ? (
          <motion.div
            key="home"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="public-editorial"
          >
            <Outlet context={{ home, slug }} />
          </motion.div>
        ) : (
          <motion.div
            key="subpages"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="relative isolate flex min-h-dvh flex-col"
          >
            <GuestBackdrop image={tenant.coverImageUrl || home.rooms.find((room) => room.coverUrl)?.coverUrl} />
            <header className="sticky top-0 z-30 px-3 pt-3 sm:px-8 sm:pt-5">
              <div className="mx-auto grid max-w-[1200px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-2xl border border-white/15 bg-[#0b0f16]/90 px-2.5 py-2 shadow-[0_10px_40px_-20px_#000] backdrop-blur-md sm:flex sm:justify-between sm:rounded-full sm:px-3">
                <Link to={`/h/${slug}`} className="flex min-w-0 items-center gap-2.5 rounded-full" aria-label={tenant.name}>
                  {tenant.logoUrl ? (
                    <img src={tenant.logoUrl} alt="" className="size-9 shrink-0 rounded-full object-cover ring-1 ring-white/15" />
                  ) : (
                    <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full border border-white/15 bg-brand text-sm font-bold text-brand-foreground">
                      {tenant.name[0]}
                    </span>
                  )}
                  <span className="truncate font-display text-sm font-bold tracking-tight sm:text-[1.25rem]">{tenant.name}</span>
                </Link>

                <nav className="order-3 col-span-2 flex flex-wrap items-center gap-1 border-t border-white/10 pt-1.5 sm:order-0 sm:shrink-0 sm:border-0 sm:p-0" aria-label={t("nav.main")}>
                  <NavLink to={`/h/${slug}/rooms`} className={navCls}>
                    {t("public.rooms")}
                  </NavLink>
                  <NavLink to={`/h/${slug}/manage`} className={navCls}>
                    {t("public.manageBooking")}
                  </NavLink>
                </nav>
                {tenant.botEnabled && (
                  <Suspense fallback={null}>
                    <ChatWidget slug={slug} tenant={tenant} />
                  </Suspense>
                )}
              </div>
            </header>

            <main className="flex-1">
              <Suspense
                fallback={
                  <div className="flex min-h-[60dvh] items-center justify-center text-muted-foreground">
                    <Spinner className="size-5" />
                  </div>
                }
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={pathname}
                    initial={reduce ? false : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? undefined : { opacity: 0, y: -6 }}
                    transition={{ duration: reduce ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <Outlet context={{ home, slug }} />
                  </motion.div>
                </AnimatePresence>
              </Suspense>
            </main>

            <footer className="mx-auto mb-5 mt-5 w-full max-w-[1280px] px-4 pb-14 sm:px-8 sm:pb-10">
              <div className="guest-panel px-5 py-6 text-sm text-muted-foreground sm:px-8 sm:py-8">
                <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
                  <div className="max-w-md space-y-2">
                    <p className="font-display text-2xl font-bold text-foreground">{tenant.name}</p>
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
                      <Link to={`/h/${slug}/rooms`} className="transition-colors hover:text-foreground">
                        {t("public.rooms")}
                      </Link>
                      <Link to={`/h/${slug}/manage`} className="transition-colors hover:text-foreground">
                        {t("public.manageBooking")}
                      </Link>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="inline-flex items-center gap-1.5 text-xs tracking-wide">{t("public.poweredBy")} <Logo tone="light" className="h-4" /></span>
                    </div>
                  </div>
                </div>
              </div>
            </footer>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
