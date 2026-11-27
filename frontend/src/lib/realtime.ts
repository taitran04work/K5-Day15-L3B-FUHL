import { useEffect, useRef } from "react"
import { HubConnectionBuilder, LogLevel, type HubConnection } from "@microsoft/signalr"
import { tokenStore } from "./api"

type Handlers = Record<string, (...args: never[]) => void>

/** Owner inbox hub: conversationUpdated, messageAdded, bookingChanged, documentChanged */
export function useInboxHub(handlers: Handlers, enabled = true) {
  const ref = useRef(handlers)
  useEffect(() => {
    ref.current = handlers
  })
  useEffect(() => {
    if (!enabled) return
    const conn = new HubConnectionBuilder()
      .withUrl("/hubs/inbox", { accessTokenFactory: () => tokenStore.get() ?? "" })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Critical)
      .build()
    for (const name of ["conversationUpdated", "messageAdded", "bookingChanged", "documentChanged"]) {
      conn.on(name, (...args: unknown[]) => (ref.current[name] as ((...a: unknown[]) => void) | undefined)?.(...args))
    }
    conn.start().catch(() => {
      /* reconnects automatically */
    })
    return () => {
      void conn.stop()
    }
  }, [enabled])
}

/** Guest widget hub: join a conversation group with the visitor token; events messageAdded, typing. */
export function useWidgetHub(conversationId: string | null, token: string | null, handlers: Handlers) {
  const ref = useRef(handlers)
  useEffect(() => {
    ref.current = handlers
  })
  useEffect(() => {
    if (!conversationId || !token) return
    const conn: HubConnection = new HubConnectionBuilder()
      .withUrl("/hubs/widget")
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Critical)
      .build()
    for (const name of ["messageAdded", "typing"]) {
      conn.on(name, (...args: unknown[]) => (ref.current[name] as ((...a: unknown[]) => void) | undefined)?.(...args))
    }
    const join = () => conn.invoke("Join", conversationId, token).catch(() => undefined)
    conn.onreconnected(() => void join())
    conn
      .start()
      .then(join)
      .catch(() => undefined)
    return () => {
      void conn.stop()
    }
  }, [conversationId, token])
}
