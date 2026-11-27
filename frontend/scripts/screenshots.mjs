// Usage: node scripts/screenshots.mjs [outDir] [filter]
import { chromium } from "@playwright/test"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

const base = new URL(process.env.BASE_URL ?? "http://localhost:5173")
const out = process.argv[2] ?? "../docs/screenshots"
const filter = process.argv[3]
const lang = process.env.LANG_UI === "vi" ? "vi" : "en"
mkdirSync(out, { recursive: true })

async function json(path, options) {
  const res = await fetch(new URL(path, base), options)
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.json()
}

async function token(email, password) {
  const session = await json("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  return session.token
}

const [ownerToken, adminToken, home] = await Promise.all([
  token("owner@pinehill.dev", "Owner@123"),
  token("admin@stayra.dev", "Admin@123"),
  json("/api/public/pine-hill"),
])
const { items } = await json("/api/app/bookings?status=Confirmed&q=0912009988", {
  headers: { Authorization: `Bearer ${ownerToken}` },
})
const booking = items[0]?.booking
if (!booking) throw new Error("The seeded Pine Hill booking is missing")
const roomId = home.rooms[0].id
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

const pages = [
  { name: "landing", path: "/" },
  { name: "login", path: "/login" },
  { name: "forgot-password", path: "/forgot-password" },
  { name: "reset-password", path: "/reset-password?token=demo-preview" },
  { name: "public-home", path: "/h/pine-hill" },
  { name: "public-room", path: `/h/pine-hill/rooms/${roomId}` },
  { name: "public-book", path: `/h/pine-hill/book?room=${roomId}&mode=Nightly&start=${day(56)}&end=${day(58)}&guests=2` },
  { name: "public-confirmation", path: `/h/pine-hill/booking/${booking.code}`, booking },
  { name: "public-manage", path: "/h/pine-hill/manage" },
  { name: "public-sea", path: "/h/sea-breeze" },
  { name: "pay-return", path: "/pay/return" },
  { name: "chat-widget", path: "/h/pine-hill", chat: true },
  { name: "owner-overview", path: "/app", auth: ownerToken },
  { name: "owner-calendar", path: "/app/calendar", auth: ownerToken },
  { name: "owner-bookings", path: "/app/bookings", auth: ownerToken },
  { name: "owner-inbox", path: "/app/inbox", auth: ownerToken },
  { name: "owner-rooms", path: "/app/rooms", auth: ownerToken },
  { name: "owner-pricing", path: "/app/pricing", auth: ownerToken },
  { name: "owner-policies", path: "/app/policies", auth: ownerToken },
  { name: "owner-payments", path: "/app/payments", auth: ownerToken },
  { name: "owner-bot", path: "/app/settings/bot", auth: ownerToken },
  { name: "owner-website", path: "/app/settings/website", auth: ownerToken },
  { name: "owner-channels", path: "/app/settings/channels", auth: ownerToken },
  { name: "owner-team", path: "/app/settings/team", auth: ownerToken },
  { name: "admin-tenants", path: "/admin", auth: adminToken },
  { name: "admin-usage", path: "/admin/usage", auth: adminToken },
  { name: "zalo-simulator", path: "/dev/zalo-simulator", ready: "main header" },
  { name: "not-found", path: "/not-found" },
]

const browser = await chromium.launch()
const errors = []
try {
  for (const width of [1440, 375]) {
    for (const p of pages) {
      if (filter && !p.name.includes(filter)) continue
      const localStorage = [{ name: "stayra.lang", value: lang }]
      if (p.auth) localStorage.push({ name: "stayra.token", value: p.auth })
      const page = await browser.newPage({
        viewport: { width, height: width === 375 ? 812 : 900 },
        locale: lang === "vi" ? "vi-VN" : "en-US",
        timezoneId: "Asia/Ho_Chi_Minh",
        storageState: { cookies: [], origins: [{ origin: base.origin, localStorage }] },
      })
      const label = `${p.name}@${width}`
      page.on("pageerror", (error) => errors.push(`${label}: ${error.message}`))
      page.on("response", (response) => {
        if (response.status() >= 400 && response.url().startsWith(`${base.origin}/api/`))
          errors.push(`${label}: HTTP ${response.status()} ${new URL(response.url()).pathname}`)
      })
      if (p.booking) {
        await page.addInitScript(({ code, guestPhone }) => {
          sessionStorage.setItem(`stayra.booking.${code}`, guestPhone)
        }, p.booking)
      }
      try {
        await page.goto(new URL(p.path, base).href, { waitUntil: "domcontentloaded" })
        await page.locator(p.ready ?? "h1").first().waitFor({ timeout: 12_000 })
        if (new URL(page.url()).pathname !== new URL(p.path, base).pathname)
          throw new Error(`Unexpected redirect to ${new URL(page.url()).pathname}`)
        if (p.chat) {
          await page.getByRole("button", { name: lang === "vi" ? "Chat với chúng tôi" : "Chat with us", exact: true }).click()
          await page.getByRole("dialog").waitFor()
        }
        await page.waitForLoadState("networkidle", { timeout: 12_000 })
        await page.evaluate(async () => {
          await document.fonts.ready
          await Promise.all(Array.from(document.images, (img) => {
            img.loading = "eager"
            return img.decode().catch(() => {})
          }))
        })
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        if (overflow > 1) errors.push(`${label}: page overflows by ${overflow}px`)
        await page.screenshot({ path: join(out, `${p.name}-${width}.png`), fullPage: !p.chat, animations: "disabled" })
        console.log(label)
      } catch (error) {
        errors.push(`${label}: ${error.message}`)
      } finally {
        await page.close()
      }
    }
  }
} finally {
  await browser.close()
}

if (errors.length) {
  console.error(errors.join("\n"))
  process.exitCode = 1
}
