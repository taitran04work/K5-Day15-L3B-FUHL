import { useState, type ReactNode } from "react"
import { NavLink, Outlet, useLocation } from "react-router"
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
import { useAuth } from "@/lib/auth"
import { useBrand } from "@/lib/brand"
import { api } from "@/lib/api"
import { initials } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ConversationSummary } from "@/lib/types"

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
      {title && <p className="px-3 pb-1 pt-4 text-xs font-medium text-subtle">{title}</p>}
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex h-8 items-center gap-2.5 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-4 [&_svg]:shrink-0",
              isActive && "bg-muted font-medium text-foreground",
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
    <div className="flex h-full flex-col">
      <div className="px-4 pb-2 pt-4">{header}</div>
      <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label={t("nav.main")}>
        {groups.map((g, i) => (
          <NavGroup key={i} title={g.title} items={g.items} onNavigate={onNavigate} />
        ))}
      </nav>
      <div className="border-t p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-2.5 rounded-md p-2 text-left hover:bg-muted">
              <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold">{initials(user?.name)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{user?.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{user?.email}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-56">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t("nav.language")}</DropdownMenuLabel>
            <div className="px-2 pb-2">
              <LanguageSwitch className="w-full" />
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
  return (
    <div className="min-h-dvh bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r bg-canvas lg:block">
        <Sidebar groups={groups} header={header} />
      </aside>
      <div className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur lg:hidden">
        <Button variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label={t("nav.openMenu")}>
          <Menu />
        </Button>
        <div className="min-w-0 flex-1">{header}</div>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">{t("nav.main")}</SheetTitle>
          <Sidebar groups={groups} header={header} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <main className="lg:pl-60">{children}</main>
    </div>
  )
}

export function AppShell() {
  const { t } = useTranslation()
  const { user } = useAuth()
  useBrand(user?.accentColor)
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
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand text-xs font-semibold text-brand-foreground">{initials(user?.tenantName)}</span>
        <span className="truncate text-sm font-semibold">{user?.tenantName}</span>
      </div>
      {user?.tenantSlug && (
        <a
          href={`/h/${user.tenantSlug}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
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
      <div key={location.pathname.split("/")[2] ?? "home"} className="animate-in fade-in duration-200">
        <Outlet />
      </div>
    </Shell>
  )
}

export function AdminShell() {
  const { t } = useTranslation()
  useBrand("#111111")
  const groups = [
    {
      items: [
        { to: "/admin", label: t("nav.tenants"), icon: <Users />, end: true },
        { to: "/admin/usage", label: t("nav.usage"), icon: <LayoutGrid /> },
      ],
    },
  ]
  const header = (
    <div className="flex items-center gap-2.5">
      <span className="flex size-7 items-center justify-center rounded-md bg-foreground text-xs font-semibold text-background">S</span>
      <span className="text-sm font-semibold">Stayra</span>
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t("nav.admin")}</span>
    </div>
  )
  return (
    <Shell groups={groups} header={header}>
      <Outlet />
    </Shell>
  )
}

/** Standard page container for the owner/admin app. Wide by default; `narrow` for forms. */
export function Page({ children, className, narrow }: { children: ReactNode; className?: string; narrow?: boolean }) {
  return <div className={cn("mx-auto w-full px-4 py-6 sm:px-6 lg:px-10 lg:py-8", narrow ? "max-w-5xl" : "max-w-[1600px]", className)}>{children}</div>
}
