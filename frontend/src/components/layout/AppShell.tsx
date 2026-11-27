import { useEffect, useRef, useState, type ReactNode } from "react"
import { Link, NavLink, Outlet, useLocation } from "react-router"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import {
  BedDouble,
  CalendarDays,
  CircleDollarSign,
  ExternalLink,
  FileText,
  Globe,
  LayoutGrid,
  ListChecks,
  LogOut,
  Menu,
  MessageSquare,
  MessagesSquare,
  Bot,
  Tag,
  Users,
} from "lucide-react"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { LanguageSwitch } from "@/components/LanguageSwitch"
import { ThemeMenuItem } from "@/components/layout/SystemTheme"
import { useAuth } from "@/lib/auth"
import { api } from "@/lib/api"
import { initials } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ConversationSummary } from "@/lib/types"
import { Logo } from "@/components/Logo"

interface NavItem {
  to: string
  label: string
  icon: ReactNode
  badge?: number
  end?: boolean
}

function NavGroup({ title, items, onNavigate }: { title?: string; items: NavItem[]; onNavigate?: () => void }) {
  return (
    <div className="space-y-0.5">
      {title && <p className="px-3 pb-1 pt-4 text-xs font-medium text-(--sidebar-muted)">{title}</p>}
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex min-h-9 items-center gap-2.5 rounded-md border-l-2 border-l-transparent px-3 text-sm text-(--sidebar-muted) transition-colors hover:bg-(--sidebar-hover) hover:text-(--sidebar-text) [&_svg]:size-4 [&_svg]:shrink-0",
              isActive && "border-l-(--sidebar-accent) bg-(--sidebar-selected) font-semibold text-(--sidebar-text) hover:bg-(--sidebar-selected) [&_svg]:text-(--sidebar-accent)",
            )
          }
        >
          {item.icon}
          <span className="flex-1 truncate">{item.label}</span>
          {!!item.badge && (
            <span className="rounded-full bg-brand px-1.5 text-[11px] font-semibold leading-[18px] text-brand-foreground tabular">{item.badge}</span>
          )}
        </NavLink>
      ))}
    </div>
  )
}

export function Sidebar({ groups, header, onNavigate }: { groups: { title?: string; items: NavItem[] }[]; header: ReactNode; onNavigate?: () => void }) {
  const { user, logout } = useAuth()
  const { t } = useTranslation()
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mx-4 mb-3 border-b border-(--sidebar-divider) pb-3 pt-3">
        <Link to={user?.role === "PlatformAdmin" ? "/admin" : "/app"} className="mb-2 block w-fit rounded-md">
          <Logo tone="light" className="h-16" />
        </Link>
        {header}
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label={t("nav.main")}>
        {groups.map((g, i) => (
          <NavGroup key={i} title={g.title} items={g.items} onNavigate={onNavigate} />
        ))}
      </nav>
      <div className="border-t border-(--sidebar-divider) px-3 py-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-2.5 rounded-md p-2 text-left hover:bg-(--sidebar-hover)">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-(--sidebar-selected) text-xs font-semibold text-(--sidebar-accent)">{initials(user?.name)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{user?.name}</span>
                <span className="block truncate text-xs text-(--sidebar-muted)">{user?.email}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("nav.language")}</DropdownMenuLabel>
            <div className="flex items-center gap-2 px-2 pb-2">
              <LanguageSwitch className="h-9 min-w-0 flex-1" />
              <ThemeMenuItem />
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout}>
              <LogOut /> {t("auth.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function Shell({ groups, header, children }: { groups: { title?: string; items: NavItem[] }[]; header: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const reduce = useReducedMotion()
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [pathname])

  return (
    <div className="min-h-dvh bg-canvas lg:flex lg:h-dvh lg:overflow-hidden">
      <aside className="system-sidebar hidden w-64 shrink-0 border-r lg:flex lg:flex-col">
        <Sidebar groups={groups} header={header} />
      </aside>
      <div className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur lg:hidden">
        <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label={t("nav.openMenu")}>
          <Menu />
        </Button>
        <Logo tone="auto" className="h-11" />
        <div className="min-w-0 flex-1">{header}</div>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="system-sidebar w-72 max-w-[calc(100%-2rem)] p-0 [&>button]:bg-(--sidebar-hover) [&>button]:text-(--sidebar-text)">
          <SheetTitle className="sr-only">{t("nav.main")}</SheetTitle>
          <Sidebar groups={groups} header={header} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <main ref={mainRef} className="min-w-0 flex-1 lg:h-dvh lg:overflow-y-auto">
        <motion.div
          key={pathname}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduce ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </motion.div>
      </main>
    </div>
  )
}

export function AppShell() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const location = useLocation()
  const inbox = useQuery({
    queryKey: ["inbox", "attention"],
    queryFn: () => api.get<ConversationSummary[]>("/api/app/inbox/conversations"),
    refetchInterval: 30_000,
    retry: false,
  })
  const attention = (inbox.data ?? []).filter((c) => c.needsAttention || c.unreadCount > 0).length

  const groups = [
    {
      items: [
        { to: "/app", label: t("nav.overview"), icon: <LayoutGrid />, end: true },
        { to: "/app/calendar", label: t("nav.calendar"), icon: <CalendarDays /> },
        { to: "/app/bookings", label: t("nav.bookings"), icon: <ListChecks /> },
        { to: "/app/inbox", label: t("nav.inbox"), icon: <MessageSquare />, badge: attention },
      ],
    },
    {
      title: t("nav.property"),
      items: [
        { to: "/app/rooms", label: t("nav.rooms"), icon: <BedDouble /> },
        { to: "/app/pricing", label: t("nav.pricing"), icon: <Tag /> },
        { to: "/app/policies", label: t("nav.policies"), icon: <FileText /> },
        { to: "/app/payments", label: t("nav.payments"), icon: <CircleDollarSign /> },
      ],
    },
    {
      title: t("nav.settings"),
      items: [
        { to: "/app/settings/bot", label: t("nav.bot"), icon: <Bot /> },
        { to: "/app/settings/website", label: t("nav.website"), icon: <Globe /> },
        { to: "/app/settings/channels", label: t("nav.channels"), icon: <MessagesSquare /> },
        { to: "/app/settings/team", label: t("nav.team"), icon: <Users /> },
      ],
    },
  ]

  const header = (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate text-sm font-medium">{user?.tenantName}</span>
      {user?.tenantSlug && (
        <a
          href={`/h/${user.tenantSlug}`}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-md p-1.5 opacity-75 transition-opacity hover:opacity-100"
          title={t("nav.viewSite")}
          aria-label={t("nav.viewSite")}
        >
          <ExternalLink className="size-4" />
        </a>
      )}
    </div>
  )

  return (
    <Shell groups={groups} header={header}>
      <div key={location.pathname.split("/")[2] ?? "home"} className="animate-page-enter">
        <Outlet />
      </div>
    </Shell>
  )
}

export function AdminShell() {
  const { t } = useTranslation()
  const groups = [
    {
      items: [
        { to: "/admin", label: t("nav.tenants"), icon: <Users />, end: true },
        { to: "/admin/usage", label: t("nav.usage"), icon: <LayoutGrid /> },
      ],
    },
  ]
  const header = (
    <span className="text-sm font-medium">{t("nav.admin")}</span>
  )
  return (
    <Shell groups={groups} header={header}>
      <Outlet />
    </Shell>
  )
}

/** Standard page container for the owner/admin app. Wide by default; `narrow` for forms. */
export function Page({ children, className, narrow }: { children: ReactNode; className?: string; narrow?: boolean }) {
  return <div className={cn("stagger-enter mx-auto w-full px-4 py-6 sm:px-6 lg:px-10 lg:py-8", narrow ? "max-w-5xl" : "max-w-[1600px]", className)}>{children}</div>
}
