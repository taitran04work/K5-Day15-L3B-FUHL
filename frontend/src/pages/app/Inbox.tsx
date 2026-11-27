import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router"
import { useTranslation } from "react-i18next"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowLeft, ArrowUp, Bot, Hand, MessageSquare, RefreshCw, Search, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState, ErrorState, KeyValue, Spinner, StatusBadge, useErrorMessage } from "@/components/common"
import { BookingDrawer } from "@/components/app/BookingDrawer"
import { MessageBubble, mergeMessages } from "@/components/chat/ChatWidget"
import { getLanguageOption } from "@/i18n/languages"
import { api, qs } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useInboxHub } from "@/lib/realtime"
import { initials, money, phone, relative, stayLabel } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Booking, ChatMessage, ConversationSummary } from "@/lib/types"

interface ConversationDetail {
  conversation: ConversationSummary & { externalUserId: string | null }
  booking: Booking | null
  messages: (ChatMessage & { toolInput?: unknown; toolOutput?: unknown })[]
}

const filters = ["all", "attention", "human", "bot"] as const
const channels = ["all", "Zalo", "Facebook", "Telegram", "WebWidget"] as const

function ToolRow({ m }: { m: ChatMessage }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-center gap-1.5 text-[11px] text-subtle">
      <Wrench className="size-3" aria-hidden />
      <span>{t(`tools.${m.toolName}`, { defaultValue: m.toolName ?? m.content })}</span>
    </div>
  )
}

export default function Inbox() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const qc = useQueryClient()
  const errorMessage = useErrorMessage()
  const [params, setParams] = useSearchParams()
  const selected = params.get("c")
  const [filter, setFilter] = useState<(typeof filters)[number]>("all")
  const [channel, setChannel] = useState<(typeof channels)[number]>("all")
  const [q, setQ] = useState("")
  const [reply, setReply] = useState("")
  const [bookingOpen, setBookingOpen] = useState<string | null>(null)
  const [live, setLive] = useState<ChatMessage[]>([])
  const listEnd = useRef<HTMLDivElement>(null)

  const list = useQuery({
    queryKey: ["inbox", "list", q, channel],
    queryFn: () => api.get<ConversationSummary[]>(`/api/app/inbox/conversations${qs({ q, channel: channel === "all" ? undefined : channel })}`),
  })
  const sync = useMutation({
    mutationFn: () =>
      api.post<{ syncedAt: string; deplaoConnected: boolean; zaloAccountsOnline: number; totalConversations: number }>("/api/app/inbox/sync"),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["inbox"] })
      toast.success(r.deplaoConnected ? t("inbox.syncedDeplao", { online: r.zaloAccountsOnline }) : t("inbox.synced", { count: r.totalConversations }))
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const detail = useQuery({
    queryKey: ["inbox", "detail", selected],
    enabled: !!selected,
    queryFn: () => api.get<ConversationDetail>(`/api/app/inbox/conversations/${selected}`),
  })

  useEffect(() => {
    setLive([])
    if (selected) void api.post(`/api/app/inbox/conversations/${selected}/read`).then(() => qc.invalidateQueries({ queryKey: ["inbox", "list"] }))
  }, [selected, qc])

  useInboxHub({
    messageAdded: (m: ChatMessage) => {
      if (m.conversationId === selected) setLive((prev) => mergeMessages(prev, [m]))
    },
    conversationUpdated: (id: string) => {
      void qc.invalidateQueries({ queryKey: ["inbox", "list"] })
      void qc.invalidateQueries({ queryKey: ["inbox", "attention"] })
      if (id === selected) void qc.invalidateQueries({ queryKey: ["inbox", "detail", selected] })
    },
  })

  const messages = useMemo(() => mergeMessages(detail.data?.messages ?? [], live), [detail.data, live])

  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: "end" })
  }, [messages.length, selected])

  const action = useMutation({
    mutationFn: (path: "takeover" | "handback" | "close") => api.post(`/api/app/inbox/conversations/${selected}/${path}`),
    onSuccess: (_, path) => {
      toast.success(t(`inbox.${path}Done`))
      void qc.invalidateQueries({ queryKey: ["inbox"] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const send = useMutation({
    mutationFn: (text: string) => api.post<ChatMessage>(`/api/app/inbox/conversations/${selected}/messages`, { text }),
    onSuccess: (m) => {
      setReply("")
      if (m && m.id) setLive((prev) => mergeMessages(prev, [m]))
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const items = (list.data ?? []).filter((c) =>
    filter === "attention" ? c.needsAttention || c.unreadCount > 0 : filter === "human" ? c.status === "HumanTakeover" : filter === "bot" ? c.status === "Bot" : true,
  )
  const conv = detail.data?.conversation
  const booking = detail.data?.booking
  const select = (id: string | null) => setParams(id ? { c: id } : {}, { replace: true })
  const name = (c: ConversationSummary) => c.guestName ?? (c.channel === "Zalo" ? t("inbox.zaloGuest") : t("inbox.webGuest"))

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] lg:h-dvh">
      {/* Conversation list */}
      <aside className={cn("flex w-full shrink-0 flex-col border-r md:w-[340px]", selected && "max-md:hidden")}>
        <div className="space-y-3 border-b px-4 py-4">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-lg">{t("inbox.title")}</h1>
            <Button variant="ghost" size="sm" onClick={() => sync.mutate()} disabled={sync.isPending} aria-label={t("inbox.sync")}>
              <RefreshCw className={cn("size-3.5", sync.isPending && "animate-spin")} />
              <span className="ml-1 text-xs">{t("inbox.sync")}</span>
            </Button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("inbox.search")} className="h-8 pl-9" aria-label={t("inbox.search")} />
          </div>
          <div className="-mx-1 flex flex-wrap gap-1 px-1" role="tablist">
            {filters.map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={cn("whitespace-nowrap rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground", filter === f && "bg-muted font-medium text-foreground")}>
                {t(`inbox.filter.${f}`)}
              </button>
            ))}
          </div>
          <div className="-mx-1 flex flex-wrap gap-1 px-1" role="tablist">
            {channels.map((ch) => (
              <button key={ch} role="tab" aria-selected={channel === ch} onClick={() => setChannel(ch)} className={cn("whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground", channel === ch && "bg-brand/10 font-medium text-brand")}>
                {t(`inbox.channelFilter.${ch}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {list.isLoading ? (
            <div className="space-y-1 p-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          ) : list.error ? (
            <div className="p-4">
              <ErrorState error={list.error} onRetry={() => void list.refetch()} />
            </div>
          ) : items.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-muted-foreground">{filter === "all" && !q ? t("inbox.empty") : t("inbox.emptyFilter")}</p>
          ) : (
            <ul className="p-2">
              {items.map((c) => (
                <li key={c.id}>
                  <button onClick={() => select(c.id)} className={cn("flex w-full gap-3 rounded-lg px-3 py-3 text-left hover:bg-muted/60", selected === c.id && "bg-muted")}>
                    <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {initials(name(c))}
                      {c.needsAttention && <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-background bg-amber-500" aria-label={t("inbox.needsAttention")} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cn("truncate text-sm", c.unreadCount > 0 ? "font-semibold" : "font-medium")}>{name(c)}</span>
                        <span className="shrink-0 text-[11px] text-subtle">{relative(c.lastMessageAt)}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{c.lastMessagePreview}</span>
                      <span className="mt-1 flex items-center gap-1.5 text-[11px] text-subtle">
                        <span>{c.channel === "WebWidget" ? t("inbox.website") : c.channel}</span>
                        {c.status === "HumanTakeover" && <span>· {t("inbox.youReplying")}</span>}
                        {c.bookingCode && <span className="font-mono">· {c.bookingCode}</span>}
                        {c.unreadCount > 0 && <span className="ml-auto rounded-full bg-brand px-1.5 font-semibold text-brand-foreground tabular">{c.unreadCount}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Thread */}
      <section className={cn("flex min-w-0 flex-1 flex-col", !selected && "max-md:hidden")}>
        {!selected ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <EmptyState className="max-w-md border-0" icon={<MessageSquare />} title={t("inbox.selectTitle")} description={t("inbox.selectDescription")} />
          </div>
        ) : detail.isLoading || !conv ? (
          detail.error ? (
            <div className="p-6"><ErrorState error={detail.error} onRetry={() => void detail.refetch()} /></div>
          ) : (
            <div className="space-y-4 p-6">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-16 w-2/3" />
              <Skeleton className="ml-auto h-12 w-1/2" />
            </div>
          )
        ) : (
          <>
            <header className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
              <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={() => select(null)} aria-label={t("common.back")}>
                <ArrowLeft />
              </Button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{name(conv)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {conv.channel === "WebWidget" ? t("inbox.website") : conv.channel} · {conv.status === "HumanTakeover" ? t("inbox.statusHuman") : conv.status === "Closed" ? t("inbox.statusClosed") : t("inbox.statusBot")}
                </p>
              </div>
              {conv.status === "HumanTakeover" ? (
                <Button variant="outline" size="sm" onClick={() => action.mutate("handback")} disabled={action.isPending}>
                  <Bot /> {t("inbox.handBack")}
                </Button>
              ) : (
                <Button size="sm" onClick={() => action.mutate("takeover")} disabled={action.isPending}>
                  <Hand /> {t("inbox.takeOver")}
                </Button>
              )}
            </header>
            {conv.needsAttention && conv.handoffReason && (
              <div className="border-b bg-amber-50/70 px-6 py-2.5 text-sm text-amber-900 dark:bg-warning/10 dark:text-warning">
                {t("inbox.handoffReason")}: {conv.handoffReason}
              </div>
            )}
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
              {messages.map((m) =>
                m.role === "Tool" ? <ToolRow key={m.id} m={m} /> : <MessageBubble key={m.id} m={m} mine={m.role === "Bot" || m.role === "Owner"} slug={user?.tenantSlug ?? ""} showAuthor />,
              )}
              <div ref={listEnd} />
            </div>
            <form
              className="border-t p-3 sm:px-6"
              onSubmit={(e) => {
                e.preventDefault()
                if (reply.trim()) send.mutate(reply.trim())
              }}
            >
              {conv.status !== "HumanTakeover" ? (
                <div className="flex flex-col items-center justify-between gap-3 rounded-xl bg-muted px-4 py-3 text-sm sm:flex-row">
                  <span className="text-muted-foreground">{t("inbox.botReplying")}</span>
                  <Button type="button" size="sm" onClick={() => action.mutate("takeover")}>
                    {t("inbox.takeOverToReply")}
                  </Button>
                </div>
              ) : (
                <div className="flex items-end gap-2 rounded-xl border px-3 py-2 focus-within:border-foreground/40">
                  <textarea
                    rows={1}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        if (reply.trim()) send.mutate(reply.trim())
                      }
                    }}
                    placeholder={t("inbox.replyPlaceholder")}
                    aria-label={t("inbox.replyPlaceholder")}
                    className="max-h-32 flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-subtle"
                  />
                  <Button type="submit" size="icon-sm" className="rounded-full" disabled={!reply.trim() || send.isPending} aria-label={t("chat.send")}>
                    {send.isPending ? <Spinner /> : <ArrowUp />}
                  </Button>
                </div>
              )}
            </form>
          </>
        )}
      </section>

      {/* Context */}
      {conv && selected && (
        <aside className="hidden w-[320px] shrink-0 overflow-y-auto border-l px-5 py-5 xl:block">
          <h2 className="text-sm font-semibold">{t("inbox.guest")}</h2>
          <dl className="mt-2">
            <KeyValue label={t("bookings.name")}>{conv.guestName ?? t("inbox.unknown")}</KeyValue>
            <KeyValue label={t("bookings.phone")}>{conv.guestPhone ? phone(conv.guestPhone) : t("inbox.unknown")}</KeyValue>
            <KeyValue label={t("inbox.language")}>{getLanguageOption(conv.language).short}</KeyValue>
            <KeyValue label={t("inbox.channel")}>{conv.channel === "Zalo" ? "Zalo" : t("inbox.website")}</KeyValue>
          </dl>
          <h2 className="mt-8 text-sm font-semibold">{t("inbox.booking")}</h2>
          {booking ? (
            <button onClick={() => setBookingOpen(booking.id)} className="mt-3 w-full rounded-lg border p-3.5 text-left hover:bg-muted/50">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-semibold">{booking.code}</span>
                <StatusBadge status={booking.status} />
              </div>
              <p className="mt-1 text-sm">{booking.roomName}</p>
              <p className="text-xs text-muted-foreground">{stayLabel(booking.mode, booking.startAt, booking.endAt)}</p>
              <dl className="mt-2 border-t pt-2">
                <KeyValue label={t("booking.total")}>{money(booking.totalAmount)}</KeyValue>
                <KeyValue label={t("booking.balance")}>{money(booking.balance)}</KeyValue>
              </dl>
            </button>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{t("inbox.noBooking")}</p>
          )}
          {conv.status !== "Closed" && (
            <Button variant="ghost" size="sm" className="mt-8 px-0 text-muted-foreground" onClick={() => action.mutate("close")}>
              {t("inbox.close")}
            </Button>
          )}
          <p className="mt-6 text-xs text-muted-foreground">
            <Link to="/app/settings/bot" className="underline underline-offset-4">
              {t("inbox.botSettings")}
            </Link>
          </p>
        </aside>
      )}
      <BookingDrawer id={bookingOpen} onOpenChange={(o) => !o && setBookingOpen(null)} />
    </div>
  )
}
