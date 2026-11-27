import { lazy, Suspense, type ReactNode } from "react"
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from "react-router"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { AuthProvider, useAuth } from "@/lib/auth"
import { AdminShell, AppShell } from "@/components/layout/AppShell"
import { Spinner } from "@/components/common"

const Landing = lazy(() => import("@/pages/Landing"))
const Login = lazy(() => import("@/pages/auth/Login"))
const ForgotPassword = lazy(() => import("@/pages/auth/ForgotPassword"))
const ResetPassword = lazy(() => import("@/pages/auth/ResetPassword"))

const PublicLayout = lazy(() => import("@/pages/public/PublicLayout"))
const TenantHome = lazy(() => import("@/pages/public/TenantHome"))
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

function Root() {
  return (
    <AuthProvider>
      <TooltipProvider delayDuration={300}>
        <Suspense fallback={<FullPageSpinner />}>
          <Outlet />
        </Suspense>
        <Toaster />
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
