import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { ArrowUp, MessageCircle, SquarePen, X } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Button } from "@/components/ui/button"
import { getLanguageOption } from "@/i18n/languages"
import { api } from "@/lib/api"
import { useLocalizedFormat } from "@/lib/format"
import { useWidgetHub } from "@/lib/realtime"
import { cn } from "@/lib/utils"
import type { ChatMessage, PublicTenant } from "@/lib/types"
import { ChatCard } from "./ChatCards"

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
export function MessageBubble({ m, mine, slug, onQuickReply, showAuthor }: { m: ChatMessage; mine: boolean; slug: string; onQuickReply?: (t: string) => void; showAuthor?: boolean }) {
  const { t } = useTranslation()
  const { time } = useLocalizedFormat()
  if (m.role === "System")
    return (
      <div className="space-y-2 py-1">
        <p className="mx-auto max-w-[85%] text-center text-xs text-muted-foreground">{m.content}</p>
        {m.cards?.map((c, i) => (
          <div key={i} className="mx-auto max-w-[85%]">
            <ChatCard card={c} slug={slug} onQuickReply={onQuickReply} />
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
          <ChatCard card={c} slug={slug} onQuickReply={onQuickReply} />
        </div>
      ))}
      <span className="px-1 text-[11px] text-subtle">{time(m.createdAt)}</span>
    </div>
  )
}

export function mergeMessages(prev: ChatMessage[], incoming: ChatMessage[]) {
  const list = [...prev]
  for (const m of incoming) {
    if (!m.id.startsWith("local-")) {
      const optIdx = list.findIndex((x) => x.id.startsWith("local-") && x.role === m.role && x.content === m.content)
      if (optIdx !== -1) list.splice(optIdx, 1)
    }
  }
  const map = new Map(list.map((m) => [m.id, m]))
  for (const m of incoming) map.set(m.id, m)
  return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function ChatWidget({ slug, tenant }: { slug: string; tenant: PublicTenant }) {
  const { t } = useTranslation()
  const language = getLanguageOption(tenant.defaultLanguage).value
  const reduceMotion = useReducedMotion()
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
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const [starting, setStarting] = useState(false)
  const [typing, setTyping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const desktopLauncherRef = useRef<HTMLButtonElement>(null)
  const mobileLauncherRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef(false)
  const startedRef = useRef(false)

  const start = useCallback(async (forceNew = false) => {
    setStarting(true)
    if (forceNew) {
      localStorage.removeItem(storageKey)
      setSession(null)
      setMessages([])
      setConvStatus("Bot")
      setTyping(false)
      setError(null)
      setText("")
    }
    try {
      const res = await api.post<{ conversationId: string; visitorToken: string; status?: "Bot" | "HumanTakeover" | "Closed"; messages: ChatMessage[] }>(`/api/public/${slug}/chat/conversations`, {
        language,
        visitorToken: forceNew ? null : (session?.visitorToken ?? null),
      })
      const s = { conversationId: res.conversationId, visitorToken: res.visitorToken }
      localStorage.setItem(storageKey, JSON.stringify(s))
      setSession(s)
      setConvStatus(res.status ?? "Bot")
      setMessages((prev) => (forceNew ? res.messages.filter((m) => m.role !== "Tool") : mergeMessages(prev, res.messages.filter((m) => m.role !== "Tool"))))
      setError(null)
    } catch {
      localStorage.removeItem(storageKey)
      setSession(null)
      setError(t("chat.connectError"))
    } finally {
      setStarting(false)
    }
  }, [slug, session?.visitorToken, language, storageKey, t])

  useEffect(() => {
    if (open && !startedRef.current) {
      startedRef.current = true
      void start()
    }
  }, [open, start])

  useWidgetHub(session?.conversationId ?? null, session?.visitorToken ?? null, {
    messageAdded: (m: ChatMessage) => {
      if (m.role === "Tool") return
      if (m.role === "Owner") setConvStatus("HumanTakeover")
      setMessages((prev) => mergeMessages(prev, [m]))
      if (m.role !== "Guest") setTyping(false)
    },
    typing: (v: boolean) => setTyping(v),
  })

  useEffect(() => {
    if (open) listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: reduceMotion ? "instant" : "smooth" })
  }, [messages, typing, open, reduceMotion])

  useEffect(() => {
    if (open) {
      const target = window.matchMedia("(pointer: coarse)").matches ? panelRef.current : inputRef.current
      target?.focus({ preventScroll: true })
    } else if (restoreFocusRef.current) {
      restoreFocusRef.current = false
      const desktop = desktopLauncherRef.current
      const launcher = desktop?.getClientRects().length ? desktop : mobileLauncherRef.current
      launcher?.focus({ preventScroll: true })
    }
  }, [open])

  const close = () => {
    restoreFocusRef.current = true
    setOpen(false)
  }

  const send = async (value: string) => {
    const content = value.trim()
    if (!content || !session || sending) return
    if (content.length > 2000) {
      setError(t("chat.tooLong"))
      return
    }
    setText("")
    setSending(true)
    setTyping(true)
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

  const launcher = (ref: RefObject<HTMLButtonElement | null>, className: string) => (
    <button
      key="launcher"
      ref={ref}
      type="button"
      onClick={() => setOpen(true)}
      className={cn("shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground", className)}
      aria-label={t("chat.open")}
      aria-haspopup="dialog"
    >
      <MessageCircle className="size-4 sm:size-6" aria-hidden />
    </button>
  )

  const overlay = (
    <AnimatePresence initial={false}>
      {!open && launcher(desktopLauncherRef, "fixed bottom-5 right-5 z-40 hidden size-14 shadow-lg motion-safe:transition-transform motion-safe:hover:scale-105 sm:flex")}
      {open && (
        <motion.section
          key="chat"
          ref={panelRef}
          initial={reduceMotion ? false : { opacity: 0, y: 20, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: reduceMotion ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] } }}
          exit={reduceMotion ? { transition: { duration: 0 } } : { opacity: 0, y: 12, scale: 0.97, pointerEvents: "none", transition: { duration: 0.16, ease: "easeIn" } }}
          className="fixed inset-0 z-50 flex origin-bottom-right flex-col overflow-hidden bg-background outline-none sm:inset-auto sm:bottom-5 sm:right-5 sm:h-[min(42rem,calc(100dvh-2.5rem))] sm:w-[min(34rem,calc(100vw-2.5rem))] sm:rounded-2xl sm:border sm:shadow-2xl"
          aria-label={t("chat.title", { name: tenant.name })}
          role="dialog"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !e.defaultPrevented && e.currentTarget.contains(e.target as Node)) close()
          }}
        >
          <header className="flex shrink-0 items-center gap-2 border-b px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:gap-3 sm:px-5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-brand-foreground">{tenant.name[0]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold [overflow-wrap:anywhere]">{tenant.name}</p>
              <p className="text-xs text-muted-foreground">{convStatus === "HumanTakeover" ? t("chat.hostJoined") : t("chat.subtitle")}</p>
            </div>
            {messages.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-full px-3 text-xs"
                onClick={() => void start(true)}
                disabled={starting || sending}
              >
                <SquarePen className="size-3.5" aria-hidden />
                <span>{t("chat.newChat")}</span>
              </Button>
            )}
            <Button variant="ghost" size="icon-lg" onClick={close} aria-label={t("chat.close")}>
              <X />
            </Button>
          </header>

          <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5" aria-live="polite">
            {messages.length === 0 && !error && (
              <div className="rounded-2xl bg-muted px-4 py-3 text-sm">
                {t("chat.welcome", { name: tenant.name })}
              </div>
            )}
            {messages.map((m) => (
              <MessageBubble key={m.id} m={m} mine={m.role === "Guest"} slug={slug} onQuickReply={(q) => void send(q)} showAuthor />
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

          {convStatus !== "Bot" && (
            <div className="flex items-center justify-between gap-2 border-t bg-muted/40 px-4 py-2 text-xs">
              <span className="text-muted-foreground">{t("chat.handoffNotice")}</span>
              <button
                type="button"
                onClick={() => void start(true)}
                disabled={starting || sending}
                className="shrink-0 font-semibold text-brand hover:underline disabled:opacity-50"
              >
                {t("chat.newChatAi")}
              </button>
            </div>
          )}

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

          <form onSubmit={onSubmit} className="shrink-0 border-t px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-4">
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
        </motion.section>
      )}
    </AnimatePresence>
  )

  return (
    <>
      {!open && launcher(mobileLauncherRef, "flex size-8 sm:hidden")}
      {createPortal(overlay, document.body)}
    </>
  )
}
