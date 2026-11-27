import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { ArrowUp, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LanguageSwitch } from "@/components/LanguageSwitch"
import { ErrorState, Spinner } from "@/components/common"
import { TypingDots, mergeMessages } from "@/components/chat/ChatWidget"
import { ChatCard } from "@/components/chat/ChatCards"
import { api } from "@/lib/api"
import { useBrand } from "@/lib/brand"
import { time } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ChatMessage } from "@/lib/types"

const ZALO_BLUE = "#0068FF"

/** Development-only page that mimics a Zalo chat and posts fake webhook events through the real pipeline. */
export default function ZaloSimulator() {
  const { t } = useTranslation()
  useBrand(ZALO_BLUE)
  const [slug, setSlug] = useState(() => localStorage.getItem("stayra.sim.slug") ?? "pine-hill")
  const [userId, setUserId] = useState(() => localStorage.getItem("stayra.sim.user") ?? `sim-${Math.floor(1000000 + Math.random() * 8999999)}`)
  const [userName, setUserName] = useState(() => localStorage.getItem("stayra.sim.name") ?? "Khách Zalo")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const dev = useQuery({ queryKey: ["dev-config"], queryFn: () => api.get<{ devTools: boolean }>("/api/dev/config"), staleTime: Infinity })

  useEffect(() => {
    localStorage.setItem("stayra.sim.slug", slug)
    localStorage.setItem("stayra.sim.user", userId)
    localStorage.setItem("stayra.sim.name", userName)
  }, [slug, userId, userName])

  const history = useQuery({
    queryKey: ["sim", slug, userId],
    queryFn: () => api.get<{ conversationId: string | null; messages: ChatMessage[] }>(`/api/dev/zalo/${slug}/conversations/${userId}`),
    refetchInterval: 4000,
    retry: false,
  })
  useEffect(() => {
    if (history.data) setMessages((prev) => mergeMessages(prev.filter((m) => !m.id.startsWith("local-")), history.data!.messages.filter((m) => m.role !== "Tool")))
  }, [history.data])
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" })
  }, [messages.length, sending])

  const send = async (value: string) => {
    const content = value.trim()
    if (!content || sending) return
    setText("")
    setSending(true)
    setError(null)
    setMessages((p) => [...p, { id: `local-${Date.now()}`, conversationId: "", role: "Guest", content, cards: null, authorName: userName, toolName: null, createdAt: new Date().toISOString() }])
    try {
      const res = await api.post<{ conversationId: string; messages: ChatMessage[] }>(`/api/dev/zalo/${slug}/send`, { userId, userName, text: content })
      setMessages((p) => mergeMessages(p.filter((m) => !m.id.startsWith("local-")), res.messages.filter((m) => m.role !== "Tool")))
    } catch (e) {
      setError(e instanceof Error ? e.message : t("chat.sendError"))
    } finally {
      setSending(false)
    }
  }

  if (dev.isLoading)
    return <p role="status" className="p-6 text-center text-sm text-muted-foreground">{t("common.loading")}</p>
  if (dev.error)
    return <ErrorState className="mx-auto my-6 max-w-lg" error={dev.error} onRetry={() => void dev.refetch()} />
  if (dev.data && !dev.data.devTools)
    return <div className="flex min-h-dvh items-center justify-center p-6 text-sm text-muted-foreground">{t("sim.disabled")}</div>

  return (
    <div className="flex min-h-dvh bg-[#eef0f3]">
      <aside className="hidden w-80 shrink-0 flex-col gap-5 border-r bg-background p-6 lg:flex">
        <div>
          <p className="text-sm font-semibold">{t("sim.title")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("sim.description")}</p>
        </div>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">{t("sim.homestay")}</span>
          <select value={slug} onChange={(e) => { setSlug(e.target.value); setMessages([]) }} className="h-9 w-full rounded-md border bg-background px-3">
            <option value="pine-hill">Pine Hill Homestay</option>
            <option value="sea-breeze">Sea Breeze House</option>
          </select>
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">{t("sim.userName")}</span>
          <Input value={userName} onChange={(e) => setUserName(e.target.value)} />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">{t("sim.userId")}</span>
          <Input value={userId} readOnly className="font-mono text-xs" />
        </label>
        <Button variant="outline" onClick={() => { setUserId(`sim-${Math.floor(1000000 + Math.random() * 8999999)}`); setMessages([]) }}>
          <RotateCcw /> {t("sim.newUser")}
        </Button>
        <div className="mt-auto space-y-3">
          <p className="text-xs text-muted-foreground">{t("sim.hint")}</p>
          <LanguageSwitch />
        </div>
      </aside>

      <main className="mx-auto flex h-dvh w-full max-w-[460px] flex-col bg-white shadow-sm">
        <header className="flex items-center gap-3 px-4 py-3 text-white" style={{ background: ZALO_BLUE }}>
          <span className="flex size-9 items-center justify-center rounded-full bg-white/20 text-sm font-semibold">{slug === "pine-hill" ? "P" : "S"}</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{slug === "pine-hill" ? "Pine Hill Homestay" : "Sea Breeze House"}</p>
            <p className="text-xs text-white/80">{t("sim.officialAccount")}</p>
          </div>
        </header>
        <div className="flex-1 space-y-3 overflow-y-auto bg-[#e2e9f1] px-3 py-4">
          {history.isLoading ? (
            <p role="status" className="mt-10 text-center text-xs text-muted-foreground">{t("common.loading")}</p>
          ) : history.error ? (
            <ErrorState error={history.error} onRetry={() => void history.refetch()} />
          ) : messages.length === 0 && (
            <p className="mx-auto mt-10 max-w-[80%] text-center text-xs text-muted-foreground">{t("sim.empty")}</p>
          )}
          {messages.map((m) =>
            m.role === "System" ? (
              <div key={m.id} className="space-y-2">
                <p className="mx-auto max-w-[85%] rounded-full bg-black/5 px-3 py-1 text-center text-[11px] text-muted-foreground">{m.content}</p>
                {m.cards?.map((c, i) => (
                  <div key={i} className="mx-auto max-w-[85%]">
                    <ChatCard card={c} slug={slug} />
                  </div>
                ))}
              </div>
            ) : (
              <div key={m.id} className={cn("flex flex-col gap-1", m.role === "Guest" ? "items-end" : "items-start")}>
                {m.content && (
                  <div className={cn("max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm shadow-xs", m.role === "Guest" ? "bg-[#d5e7ff]" : "bg-white")}>
                    {m.content}
                    <span className="mt-1 block text-right text-[10px] text-muted-foreground">{time(m.createdAt)}</span>
                  </div>
                )}
                {m.cards?.map((c, i) => (
                  <div key={i} className="w-full max-w-[88%]">
                    <ChatCard card={c} slug={slug} onQuickReply={(q) => void send(q)} />
                  </div>
                ))}
              </div>
            ),
          )}
          {sending && (
            <div className="flex">
              <div className="rounded-lg bg-white px-3 py-2.5 text-muted-foreground shadow-xs">
                <TypingDots />
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
        {error && <p className="bg-red-50 px-4 py-2 text-xs text-red-800">{error}</p>}
        <form onSubmit={(e) => { e.preventDefault(); void send(text) }} className="flex items-center gap-2 border-t bg-white px-3 py-2.5">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("sim.placeholder")} className="border-0 bg-muted shadow-none focus-visible:ring-0" aria-label={t("sim.placeholder")} />
          <Button type="submit" size="icon" className="rounded-full" disabled={!text.trim() || sending} aria-label={t("chat.send")}>
            {sending ? <Spinner /> : <ArrowUp />}
          </Button>
        </form>
      </main>
    </div>
  )
}
