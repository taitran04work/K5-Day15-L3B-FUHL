import { formatDistanceToNowStrict, type Locale } from "date-fns"
import { enUS, vi } from "date-fns/locale"
import { useTranslation } from "react-i18next"
import i18n from "@/i18n"
import { getLanguageOption } from "@/i18n/languages"

export const TZ = "Asia/Ho_Chi_Minh"

const lang = (language = i18n.language) => getLanguageOption(language).value
const locale = (): Locale => (lang() === "vi" ? vi : enUS)
const intlLocale = (language?: string) => (lang(language) === "vi" ? "vi-VN" : "en-GB")

/** vi: "1.250.000 ₫" · en: "₫1,250,000" */
export function money(amount: number | null | undefined, language?: string) {
  const v = Math.round(amount ?? 0)
  if (lang(language) === "vi") return `${new Intl.NumberFormat("vi-VN").format(v)} ₫`
  return `${v < 0 ? "-" : ""}₫${new Intl.NumberFormat("en-US").format(Math.abs(v))}`
}

export function number(n: number) {
  return new Intl.NumberFormat(lang() === "vi" ? "vi-VN" : "en-US").format(n)
}

function fmt(d: string | Date, opts: Intl.DateTimeFormatOptions, language?: string) {
  return new Intl.DateTimeFormat(intlLocale(language), { timeZone: TZ, ...opts }).format(typeof d === "string" ? new Date(d) : d)
}

/** "Fri, 18 Dec" */
export const shortDate = (d: string | Date, language?: string) => fmt(d, { weekday: "short", day: "numeric", month: "short" }, language)
/** "18 Dec 2026" */
export const date = (d: string | Date) => fmt(d, { day: "numeric", month: "short", year: "numeric" })
/** "14:00" */
export const time = (d: string | Date, language?: string) => fmt(d, { hour: "2-digit", minute: "2-digit", hour12: false }, language)
/** "18 Dec, 14:00" */
export const dateTime = (d: string | Date, language?: string) => fmt(d, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }, language)
/** "December 2026" */
export const monthYear = (d: Date) => new Intl.DateTimeFormat(intlLocale(), { month: "long", year: "numeric" }).format(d)

export function relative(d: string | Date) {
  const v = typeof d === "string" ? new Date(d) : d
  if (Math.abs(Date.now() - v.getTime()) < 45_000) return lang() === "vi" ? "vừa xong" : "just now"
  return formatDistanceToNowStrict(v, { addSuffix: true, locale: locale() })
}

/** Local date (Asia/Ho_Chi_Minh) as yyyy-MM-dd */
export function isoDate(d: Date | string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    typeof d === "string" ? new Date(d) : d,
  )
  return parts
}

/** Range label for a booking: nightly "18–21 Dec" + nights; hourly "18 Dec, 14:00–17:00" */
export function stayLabel(mode: "Nightly" | "Hourly", startAt: string, endAt: string, language?: string) {
  if (mode === "Hourly") return `${shortDate(startAt, language)}, ${time(startAt, language)}–${time(endAt, language)}`
  return `${shortDate(startAt, language)} – ${shortDate(endAt, language)}`
}

export function useLocalizedFormat() {
  const { i18n } = useTranslation()
  const language = i18n.language
  return {
    money: (amount: Parameters<typeof money>[0]) => money(amount, language),
    shortDate: (value: string | Date) => shortDate(value, language),
    time: (value: string | Date) => time(value, language),
    dateTime: (value: string | Date) => dateTime(value, language),
    stayLabel: (mode: "Nightly" | "Hourly", start: string, end: string) => stayLabel(mode, start, end, language),
  }
}

export function nights(startAt: string, endAt: string) {
  const a = new Date(isoDate(startAt))
  const b = new Date(isoDate(endAt))
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000))
}

export function initials(name?: string | null) {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase()
}

export function phone(p?: string | null) {
  if (!p) return ""
  const d = p.replace(/\D/g, "")
  return d.length === 10 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : p
}

export const vnPhone = /^(0|84)(3|5|7|8|9)\d{8}$/
export const normalizePhone = (v: string) => v.replace(/[^\d]/g, "")

  export function rememberBookingPhone(code: string, phoneNumber: string, email?: string | null) {
    sessionStorage.setItem(`stayra.booking.${code}`, phoneNumber)
    if (email?.trim()) sessionStorage.setItem(`stayra.booking.email.${code}`, email.trim())
  }
