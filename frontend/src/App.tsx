import { lazy, Suspense, useEffect, useState, type ReactNode } from "react"
import { createBrowserRouter, Navigate, RouterProvider, useLocation, useOutlet } from "react-router"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { SystemTheme, SystemThemeScope } from "@/components/layout/SystemTheme"
import { AuthProvider, useAuth } from "@/lib/auth"
import { Spinner } from "@/components/common"
import { Logo } from "@/components/Logo"

const AppShell = lazy(() => import("@/components/layout/AppShell").then((m) => ({ default: m.AppShell })))
const AdminShell = lazy(() => import("@/components/layout/AppShell").then((m) => ({ default: m.AdminShell })))

const Landing = lazy(() => import("@/pages/Landing"))
const Login = lazy(() => import("@/pages/auth/Login"))
const ForgotPassword = lazy(() => import("@/pages/auth/ForgotPassword"))
const ResetPassword = lazy(() => import("@/pages/auth/ResetPassword"))

const PublicLayout = lazy(() => import("@/pages/public/PublicLayout"))
const TenantHome = lazy(() => import("@/pages/public/TenantHome"))
const PublicRoomsPage = lazy(() => import("@/pages/public/RoomsPage"))
const RoomPage = lazy(() => import("@/pages/public/RoomPage"))
const BookPage = lazy(() => import("@/pages/public/BookPage"))
const ConfirmationPage = lazy(() => import("@/pages/public/ConfirmationPage"))
const ManageBooking = lazy(() => import("@/pages/public/ManageBooking"))
const PayReturn = lazy(() => import("@/pages/public/PayReturn"))

const Overview = lazy(() => import("@/pages/app/Overview"))
const CalendarPage = lazy(() => import("@/pages/app/CalendarPage"))
const Bookings = lazy(() => import("@/pages/app/Bookings"))
const Inbox = lazy(() => import("@/pages/app/Inbox"))
const Rooms = lazy(() => import("@/pages/app/Rooms"))
const RoomDetail = lazy(() => import("@/pages/app/RoomDetail"))
const Pricing = lazy(() => import("@/pages/app/Pricing"))
const Policies = lazy(() => import("@/pages/app/Policies"))
const Payments = lazy(() => import("@/pages/app/Payments"))
const BotSettings = lazy(() => import("@/pages/app/settings/BotSettings"))
const WebsiteSettings = lazy(() => import("@/pages/app/settings/WebsiteSettings"))
const ChannelSettings = lazy(() => import("@/pages/app/settings/ChannelSettings"))
const TeamSettings = lazy(() => import("@/pages/app/settings/TeamSettings"))

const AdminTenants = lazy(() => import("@/pages/admin/Tenants"))
const AdminUsage = lazy(() => import("@/pages/admin/Usage"))
const ZaloSimulator = lazy(() => import("@/pages/dev/ZaloSimulator"))
const NotFound = lazy(() => import("@/pages/NotFound"))

function FullPageSpinner() {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center text-muted-foreground">
      <Spinner className="size-5" />
    </div>
  )
}

function RequireRole({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <FullPageSpinner />
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (!roles.includes(user.role)) return <Navigate to={user.role === "PlatformAdmin" ? "/admin" : "/app"} replace />
  return <>{children}</>
}

const CURTAIN_EASE = [0.76, 0, 0.24, 1] as const

function usesSystemTheme(pathname: string) {
  const path = pathname.toLowerCase().replace(/\/+$/, "")
  return path !== "" && !path.startsWith("/h/") && path !== "/pay/return" && path !== "/dev/zalo-simulator"
}

/** Brand curtain that sweeps over the screen while one route group swaps for another. */
function RouteCurtain({ system }: { system: boolean }) {
  return (
    <motion.div
      aria-hidden
      className="route-curtain pointer-events-none fixed inset-0 z-[100] flex items-center justify-center"
      data-system={system || undefined}
      initial={{ y: "100%" }}
      animate={{ y: ["100%", "0%", "0%", "-100%"] }}
      transition={{ duration: 0.9, times: [0, 0.32, 0.58, 1], ease: CURTAIN_EASE }}
    >
      <motion.span
        className="flex items-center gap-3 text-[#f3ecdf]"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: [0, 1, 1, 0], y: [14, 0, 0, -14] }}
        transition={{ duration: 0.9, times: [0.16, 0.34, 0.58, 0.8] }}
      >
        <Logo tone="light" className={system ? "h-20" : "h-14"} />
      </motion.span>
    </motion.div>
  )
}

function RouteTransitionShell() {
  const { pathname, hash } = useLocation()
  const outlet = useOutlet()
  const reduce = useReducedMotion()

  useEffect(() => {
    if (!hash) {
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior })
    }
  }, [pathname, hash])

  const managementSection = /^\/(app|admin)(?:\/|$)/i.exec(pathname)?.[1]?.toLowerCase()
  const tenantBase = /^(\/h\/[^/]+)/i.exec(pathname)?.[1]?.toLowerCase()
  const authRoute = /^\/(login|forgot-password|reset-password)\/?$/i.test(pathname)
  const groupKey = managementSection ?? tenantBase ?? (authRoute ? "auth" : pathname)
  const system = usesSystemTheme(pathname)

  // show the curtain only for real cross-group navigations, not within one property's storefront
  const [prevKey, setPrevKey] = useState(groupKey)
  const [navigated, setNavigated] = useState(false)
  if (prevKey !== groupKey) {
    setPrevKey(groupKey)
    setNavigated(true)
  }

  return (
    <>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={groupKey}
          initial={reduce ? false : { opacity: 0 }}
          animate={
            reduce
              ? { opacity: 1, transition: { duration: 0 } }
              : { opacity: 1, transition: { duration: 0.32, delay: navigated ? 0.16 : 0, ease: [0.22, 1, 0.36, 1] } }
          }
          exit={reduce ? { opacity: 1, transition: { duration: 0 } } : { opacity: 0, transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } }}
        >
          <SystemThemeScope enabled={system} />
          <Suspense fallback={<FullPageSpinner />}>{outlet}</Suspense>
        </motion.div>
      </AnimatePresence>
      {!reduce && navigated && <RouteCurtain key={groupKey} system={system} />}
    </>
  )
}

function Root() {
  const { pathname } = useLocation()
  return (
    <AuthProvider>
      <TooltipProvider delayDuration={300}>
        <SystemTheme enabled={usesSystemTheme(pathname)}>
          <RouteTransitionShell />
        </SystemTheme>
      </TooltipProvider>
    </AuthProvider>
  )
}

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: "/", element: <Landing /> },
      { path: "/login", element: <Login /> },
      { path: "/forgot-password", element: <ForgotPassword /> },
      { path: "/reset-password", element: <ResetPassword /> },
      { path: "/pay/return", element: <PayReturn /> },
      { path: "/dev/zalo-simulator", element: <ZaloSimulator /> },
      {
        path: "/h/:slug",
        element: <PublicLayout />,
        children: [
          { index: true, element: <TenantHome /> },
          { path: "rooms", element: <PublicRoomsPage /> },
          { path: "rooms/:roomId", element: <RoomPage /> },
          { path: "book", element: <BookPage /> },
          { path: "booking/:code", element: <ConfirmationPage /> },
          { path: "manage", element: <ManageBooking /> },
        ],
      },
      {
        path: "/app",
        element: (
          <RequireRole roles={["Owner", "Staff"]}>
            <AppShell />
          </RequireRole>
        ),
        children: [
          { index: true, element: <Suspense fallback={<FullPageSpinner />}><Overview /></Suspense> },
          { path: "calendar", element: <Suspense fallback={<FullPageSpinner />}><CalendarPage /></Suspense> },
          { path: "bookings", element: <Suspense fallback={<FullPageSpinner />}><Bookings /></Suspense> },
          { path: "inbox", element: <Suspense fallback={<FullPageSpinner />}><Inbox /></Suspense> },
          { path: "rooms", element: <Suspense fallback={<FullPageSpinner />}><Rooms /></Suspense> },
          { path: "rooms/new", element: <Suspense fallback={<FullPageSpinner />}><RoomDetail /></Suspense> },
          { path: "rooms/:roomId", element: <Suspense fallback={<FullPageSpinner />}><RoomDetail /></Suspense> },
          { path: "pricing", element: <Suspense fallback={<FullPageSpinner />}><Pricing /></Suspense> },
          { path: "policies", element: <Suspense fallback={<FullPageSpinner />}><Policies /></Suspense> },
          { path: "payments", element: <Suspense fallback={<FullPageSpinner />}><Payments /></Suspense> },
          { path: "settings/bot", element: <Suspense fallback={<FullPageSpinner />}><BotSettings /></Suspense> },
          { path: "settings/website", element: <Suspense fallback={<FullPageSpinner />}><WebsiteSettings /></Suspense> },
          { path: "settings/channels", element: <Suspense fallback={<FullPageSpinner />}><ChannelSettings /></Suspense> },
          { path: "settings/team", element: <Suspense fallback={<FullPageSpinner />}><TeamSettings /></Suspense> },
        ],
      },
      {
        path: "/admin",
        element: (
          <RequireRole roles={["PlatformAdmin"]}>
            <AdminShell />
          </RequireRole>
        ),
        children: [
          { index: true, element: <Suspense fallback={<FullPageSpinner />}><AdminTenants /></Suspense> },
          { path: "usage", element: <Suspense fallback={<FullPageSpinner />}><AdminUsage /></Suspense> },
        ],
      },
      { path: "*", element: <NotFound /> },
    ],
  },
])

export function App() {
  return <RouterProvider router={router} />
}
