import { isValid, parseISO } from "date-fns"
import type { StayValue } from "@/components/booking/StayPicker"
import { api } from "@/lib/api"
import { shortDate, stayLabel } from "@/lib/format"
import type { Quote, Room } from "@/lib/types"

interface Availability {
  available: { room: Room; quote: Quote }[]
}

export function searchAvailableRooms(slug: string, stay: StayValue) {
  return api.post<Availability>(`/api/public/${slug}/availability`, stay)
}

export function availableRoomsKey(slug: string, stay: StayValue | null) {
  return ["public-availability", slug, stay] as const
}

export function stayQuery(stay?: StayValue | null) {
  if (!stay) return ""
  return `?${new URLSearchParams({ ...stay, guests: String(stay.guests) })}`
}

export function readStayQuery(params: URLSearchParams): StayValue | null {
  const mode = params.get("mode")
  if (mode !== "Nightly" && mode !== "Hourly") return null

  const start = params.get("start") ?? ""
  const end = params.get("end") ?? ""
  const guests = Number(params.get("guests"))
  const dateFormat = mode === "Nightly" ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
  if (!dateFormat.test(start) || !dateFormat.test(end) || start >= end || !Number.isSafeInteger(guests) || guests < 1) return null
  if (!isValid(parseISO(start)) || !isValid(parseISO(end))) return null

  return { mode, start, end, guests }
}

export function stayQueryLabel(stay: StayValue, language: string) {
  if (stay.mode === "Nightly") return stayLabel(stay.mode, stay.start, stay.end, language)

  const [startDay, startTime] = stay.start.split("T")
  const [endDay, endTime] = stay.end.split("T")
  const endLabel = endDay === startDay ? endTime : `${shortDate(endDay, language)}, ${endTime}`
  return `${shortDate(startDay, language)}, ${startTime} – ${endLabel}`
}
