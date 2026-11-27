import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { ArrowUp, MessageCircle, RotateCcw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LanguageSwitch } from "@/components/LanguageSwitch"
import { api } from "@/lib/api"
import { time } from "@/lib/format"
import { useWidgetHub } from "@/lib/realtime"
import { cn } from "@/lib/utils"
import type { StayValue } from "@/components/booking/StayPicker"
import type { ChatMessage, PublicTenant } from "@/lib/types"
import { ChatBookingForm } from "./ChatBookingForm"
import { ChatCard, type BookRoomSelection } from "./ChatCards"

function formatIsoInZone(iso: string, timeZone: string, mode: "Nightly" | "Hourly"): string | undefined {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return undefined
  const formatted = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timeZone || "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d)
  return mode === "Nightly" ? formatted.slice(0, 10) : formatted.slice(0, 16).replace(" ", "T")
}

function parseStayFromText(text: string): Partial<StayValue> | undefined {
  const now = new Date()
  const todayIso = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).format(now)
  const todayYear = Number(todayIso.slice(0, 4))
  const found: string[] = []
  const isoRe = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g
  for (const m of text.matchAll(isoRe)) {
    found.push(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`)
  }
  if (found.length < 2) {
    const dmyRe = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g
    for (const m of text.matchAll(dmyRe)) {
      const day = Number(m[1])
      const month = Number(m[2])
      if (month < 1 || month > 12 || day < 1 || day > 31) continue
      let year = m[3] ? Number(m[3]) : todayYear
      if (year < 100) year += 2000
      let iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      if (!m[3] && iso < todayIso) iso = `${year + 1}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      if (!found.includes(iso)) found.push(iso)
    }
  }
  if (found.length < 2 || found[1] <= found[0]) return undefined
  const gm = text.match(/\b(\d{1,2})\s*(?:người|khách|guests?|people|pax)\b/i)
  const guests = gm ? Number(gm[1]) : undefined
  return { mode: "Nightly", start: found[0], end: found[1], guests: guests && guests > 0 ? guests : undefined }
}

function findLatestStay(messages: ChatMessage[], timeZone: string): Partial<StayValue> | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const cards = messages[i].cards
    if (!cards) continue
    for (let j = cards.length - 1; j >= 0; j--) {
      const card = cards[j]
      if (card.type === "quote") {
        const d = card.data
        const mode = d.mode === "Nightly" || d.mode === "Hourly" ? d.mode : undefined
        const start = typeof d.start === "string" ? d.start : mode && typeof d.startAt === "string" ? formatIsoInZone(d.startAt, timeZone, mode) : undefined
        const end = typeof d.end === "string" ? d.end : mode && typeof d.endAt === "string" ? formatIsoInZone(d.endAt, timeZone, mode) : undefined
        const guests = typeof d.guests === "number" && d.guests > 0 ? d.guests : undefined
        if (mode && start && end) return { mode, start, end, guests }
      }
      if (card.type === "room_card" && Array.isArray(card.data.rooms)) {
        for (const r of card.data.rooms as Record<string, unknown>[]) {
          const mode = r.mode === "Nightly" || r.mode === "Hourly" ? r.mode : undefined
          const start = typeof r.start === "string" ? r.start : undefined
          const end = typeof r.end === "string" ? r.end : undefined
          const guests = typeof r.guests === "number" && r.guests > 0 ? r.guests : undefined
          if (mode && start && end) return { mode, start, end, guests }
        }
      }
    }
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "System" || !messages[i].content) continue
    const parsed = parseStayFromText(messages[i].content)
    if (parsed) return parsed
  }
  return undefined
}

interface Session {
  conversationId: string
  visitorToken: string
}

export function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1.5 rounded-full bg-current" style={{ animation: `typing-dot 1.2s ${i * 0.15}s infinite ease-in-out` }} />
      ))}
    </span>
  )
}

/** Renders one message. `side` decides alignment from the viewer's perspective. */
export function MessageBubble({
  m,
  mine,
  slug,
  onQuickReply,
  onBookRoom,
  showAuthor,
}: {
  m: ChatMessage
  mine: boolean
  slug: string
  onQuickReply?: (t: string) => void
  onBookRoom?: (room: BookRoomSelection) => void
  showAuthor?: boolean
}) {
  const { t } = useTranslation()
  if (m.role === "System")
    return (
      <div className="space-y-2 py-1">
        <p className="mx-auto max-w-[85%] text-center text-xs text-muted-foreground">{m.content}</p>
        {m.cards?.map((c, i) => (
          <div key={i} className="mx-auto max-w-[85%]">
            <ChatCard card={c} slug={slug} onQuickReply={onQuickReply} onBookRoom={onBookRoom} />
          </div>
        ))}
      </div>
    )
  return (
    <div className={cn("flex flex-col gap-1.5", mine ? "items-end" : "items-start")}>
      {showAuthor && !mine && (
        <span className="px-1 text-xs text-muted-foreground">{m.role === "Owner" ? (m.authorName ?? t("chat.host")) : m.role === "Bot" ? t("chat.assistant") : m.authorName}</span>
      )}
      {m.content && (
        <div
          className={cn(
            "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
            mine ? "rounded-br-md bg-brand text-brand-foreground" : "rounded-bl-md bg-muted text-foreground",
          )}
        >
          {m.content}
        </div>
      )}
      {m.cards?.map((c, i) => (
        <div key={i} className="w-full max-w-[92%]">
          <ChatCard card={c} slug={slug} onQuickReply={onQuickReply} onBookRoom={onBookRoom} />
        </div>
      ))}
      <span className="px-1 text-[11px] text-subtle">{time(m.createdAt)}</span>
    </div>
  )
}

export function mergeMessages(prev: ChatMessage[], incoming: ChatMessage[]) {
  const map = new Map(prev.map((m) => [m.id, m]))
  for (const m of incoming) map.set(m.id, m)
  return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function ChatWidget({ slug, tenant }: { slug: string; tenant: PublicTenant }) {
  const { t, i18n } = useTranslation()
  const storageKey = `stayra.chat.${slug}`
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState<Session | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? "null")
    } catch {
      return null
    }
  })
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [convStatus, setConvStatus] = useState<"Bot" | "HumanTakeover" | "Closed">("Bot")
  const [bookingRoom, setBookingRoom] = useState<BookRoomSelection | null>(null)
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const [typing, setTyping] = useState(false)
  const [unread, setUnread] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const startedRef = useRef(false)
  const syncedLangRef = useRef<string | null>(null)

  const start = useCallback(async (forceNew = false) => {
    try {
      const lang = i18n.language.startsWith("vi") ? "vi" : "en"
      const res = await api.post<{ conversationId: string; visitorToken: string; status?: "Bot" | "HumanTakeover" | "Closed"; messages: ChatMessage[] }>(`/api/public/${slug}/chat/conversations`, {
        language: lang,
        visitorToken: forceNew ? null : (session?.visitorToken ?? null),
      })
      const s = { conversationId: res.conversationId, visitorToken: res.visitorToken }
      localStorage.setItem(storageKey, JSON.stringify(s))
      syncedLangRef.current = lang
      setSession(s)
      setConvStatus(res.status ?? "Bot")
      setBookingRoom(null)
      setUnread(0)
      const visible = res.messages.filter((m) => m.role !== "Tool")
      setMessages(forceNew ? visible : (prev) => mergeMessages(prev, visible))
      setError(null)
    } catch {
      localStorage.removeItem(storageKey)
      setSession(null)
      setError(t("chat.connectError"))
    }
  }, [slug, session?.visitorToken, i18n.language, storageKey, t])

  useEffect(() => {
    if (open) setUnread(0)
    if (open && !startedRef.current) {
      startedRef.current = true
      void start()
    }
  }, [open, start])

  useEffect(() => {
    if (!session) return
    const lang = i18n.language.startsWith("vi") ? "vi" : "en"
    if (syncedLangRef.current === lang) return
    syncedLangRef.current = lang
    void api.post(`/api/public/${slug}/chat/conversations/${session.conversationId}/language`, { token: session.visitorToken, language: lang }).catch(() => undefined)
  }, [i18n.language, session, slug])

  useWidgetHub(session?.conversationId ?? null, session?.visitorToken ?? null, {
    messageAdded: (m: ChatMessage) => {
      if (m.role === "Tool") return
      if (m.role === "Owner") setConvStatus("HumanTakeover")
      if (!open && (m.role === "Bot" || m.role === "Owner")) setUnread((u) => u + 1)
      setMessages((prev) => {
        if (m.role === "Guest") {
          const localIdx = prev.findIndex((x) => x.id.startsWith("local-") && x.content === m.content)
          if (localIdx !== -1) {
            const withoutLocal = prev.filter((_, idx) => idx !== localIdx)
            return mergeMessages(withoutLocal, [m])
          }
        }
        return mergeMessages(prev, [m])
      })
      if (m.role !== "Guest") setTyping(false)
    },
    typing: (v: boolean) => setTyping(v),
    conversationStatus: (status: "Bot" | "HumanTakeover" | "Closed") => setConvStatus(status),
  })

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, typing, open])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  const send = async (value: string) => {
    const content = value.trim()
    if (!content || !session || sending) return
    if (content.length > 2000) {
      setError(t("chat.tooLong"))
      return
    }
    setText("")
    setSending(true)
    if (convStatus !== "HumanTakeover") setTyping(true)
    setError(null)
    const optimistic: ChatMessage = { id: `local-${Date.now()}`, conversationId: session.conversationId, role: "Guest", content, cards: null, authorName: null, toolName: null, createdAt: new Date().toISOString() }
    setMessages((prev) => [...prev, optimistic])
    try {
      const res = await api.post<{ status?: "Bot" | "HumanTakeover" | "Closed"; messages: ChatMessage[] }>(`/api/public/${slug}/chat/conversations/${session.conversationId}/messages`, { token: session.visitorToken, text: content })
      if (res.status) setConvStatus(res.status)
      setMessages((prev) => mergeMessages(prev.filter((m) => m.id !== optimistic.id), res.messages.filter((m) => m.role !== "Tool")))
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
      setText(content)
      setError(e instanceof Error && e.message ? e.message : t("chat.sendError"))
    } finally {
      setSending(false)
      setTyping(false)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void send(text)
  }

  const chips = [t("chat.chipRooms"), t("chat.chipAvailability"), t("chat.chipRules"), t("chat.chipManage")]
  const guestCount = messages.filter((m) => m.role === "Guest").length
  const handleBookRoom = (room: BookRoomSelection) => {
    setBookingRoom({
      ...room,
      initialStay: room.initialStay ?? findLatestStay(messages, tenant.timeZone),
    })
  }

  const launcher = (className: string) => (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      className={cn("relative shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground", className)}
      aria-label={open ? t("chat.close") : t("chat.open")}
      aria-expanded={open}
    >
      {open ? <X className="size-5" /> : <MessageCircle className="size-4 sm:size-6" />}
      {!open && unread > 0 && (
        <span className="absolute -right-1 -top-1 flex min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
          {unread}
        </span>
      )}
    </button>
  )

  const overlay = (
    <>
      {launcher("fixed bottom-5 right-5 z-40 hidden size-14 shadow-lg transition-transform hover:scale-105 sm:flex")}
      {open && (
        <section
          className="fixed inset-0 z-50 flex flex-col bg-background animate-in fade-in slide-in-from-bottom-4 duration-200 sm:inset-auto sm:bottom-24 sm:right-5 sm:h-[min(640px,calc(100dvh-8rem))] sm:w-[400px] sm:overflow-hidden sm:rounded-2xl sm:border sm:shadow-2xl"
          aria-label={t("chat.title", { name: tenant.name })}
          role="dialog"
        >
          <header className="flex items-center gap-3 border-b px-4 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-brand-foreground">{tenant.name[0]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold [overflow-wrap:anywhere]">{tenant.name}</p>
              <p className="text-xs text-muted-foreground">{convStatus === "HumanTakeover" ? t("chat.hostJoined") : t("chat.subtitle")}</p>
            </div>
            <LanguageSwitch compact className="shrink-0" />
            {guestCount > 0 && (
              <Button variant="ghost" size="icon-sm" onClick={() => void start(true)} disabled={sending} title={t("chat.newChat")} aria-label={t("chat.newChat")}>
                <RotateCcw className="size-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)} aria-label={t("chat.close")}>
              <X />
            </Button>
          </header>

          {bookingRoom && session ? (
            <ChatBookingForm
              slug={slug}
              tenant={tenant}
              roomId={bookingRoom.id}
              roomName={bookingRoom.name}
              initialStay={bookingRoom.initialStay}
              onCancel={() => setBookingRoom(null)}
              onSubmitBooking={(msg) => {
                setBookingRoom(null)
                void send(msg)
              }}
            />
          ) : (
            <>
              <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
                {messages.length === 0 && !error && (
                  <div className="rounded-2xl bg-muted px-4 py-3 text-sm">
                    {t("chat.welcome", { name: tenant.name })}
                  </div>
                )}
                {messages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    m={m}
                    mine={m.role === "Guest"}
                    slug={slug}
                    onQuickReply={(q) => void send(q)}
                    onBookRoom={handleBookRoom}
                    showAuthor
                  />
                ))}
                {typing && (
                  <div className="flex items-start">
                    <div className="rounded-2xl rounded-bl-md bg-muted px-3.5 py-3 text-muted-foreground" aria-label={t("chat.typing")}>
                      <TypingDots />
                    </div>
                  </div>
                )}
                {guestCount === 0 && session && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {chips.map((c) => (
                      <button key={c} type="button" onClick={() => void send(c)} className="rounded-full border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                        {c}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {error && (
                <div className="flex items-center justify-between gap-2 border-t bg-muted/60 px-4 py-2 text-xs" role="alert">
                  <span>{error}</span>
                  {!session && (
                    <button className="font-medium underline" onClick={() => void start()}>
                      {t("common.tryAgain")}
                    </button>
                  )}
                </div>
              )}

              <form onSubmit={onSubmit} className="border-t p-3">
                <div className="flex items-end gap-2 rounded-xl border bg-background px-3 py-2 focus-within:border-foreground/40">
                  <textarea
                    ref={inputRef}
                    rows={1}
                    value={text}
                    maxLength={2000}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        void send(text)
                      }
                    }}
                    placeholder={t("chat.placeholder")}
                    aria-label={t("chat.placeholder")}
                    className="max-h-32 min-w-0 flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-subtle"
                    style={{ fieldSizing: "content" } as React.CSSProperties}
                  />
                  <Button type="submit" size="icon-sm" className="rounded-full" disabled={!text.trim() || sending || !session} aria-label={t("chat.send")}>
                    <ArrowUp />
                  </Button>
                </div>
                <p className="mt-2 text-center text-[11px] text-subtle">{t("chat.disclaimer")}</p>
              </form>
            </>
          )}
        </section>
      )}
    </>
  )

  return (
    <>
      {!open && launcher("flex size-8 sm:hidden")}
      {createPortal(overlay, document.body)}
    </>
  )
}
