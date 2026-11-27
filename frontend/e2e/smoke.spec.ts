import { expect, test } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("stayra.lang", "en"))
})

test("guest books a room and pays the deposit", async ({ page }) => {
  await page.goto("/h/pine-hill")
  await expect(page.getByRole("heading", { level: 1, name: "Pine Hill Homestay" })).toBeVisible()

  // Pick a random far-future stay so repeated runs don't collide.
  const offset = 120 + Math.floor(Math.random() * 400)
  const start = new Date(Date.now() + offset * 86_400_000)
  const end = new Date(start.getTime() + 86_400_000)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const rooms = await (await page.request.get("/api/public/pine-hill")).json()
  const room = rooms.rooms.find((r: { name: string }) => r.name === "Attic Twin")

  await page.goto(`/h/pine-hill/rooms/${room.id}?mode=Nightly&start=${iso(start)}&end=${iso(end)}&guests=2`)
  await expect(page.getByText("Total", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Reserve", exact: true }).click()

  await page.getByLabel("Full name").fill("Playwright Guest")
  await page.getByLabel("Phone number").fill("0912 345 678")
  await page.getByRole("button", { name: "Continue" }).click()
  await page.getByRole("button", { name: /Reserve and pay/ }).click()

  await expect(page.getByRole("heading", { name: "Pay your deposit" })).toBeVisible()
  await page.getByRole("button", { name: "Simulate payment (demo)" }).click()
  await expect(page.getByRole("heading", { name: "You're booked" })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/^STR-[A-Z0-9]{6}$/)).toBeVisible()
})

test("chat widget answers with room cards", async ({ page }) => {
  await page.goto("/h/pine-hill")
  await page.evaluate(() => localStorage.removeItem("stayra.chat.pine-hill"))
  await page.reload()
  await page.getByRole("button", { name: "Chat with us" }).click()
  const chat = page.getByRole("dialog", { name: /Chat with Pine Hill/ })
  await expect(chat).toBeVisible()
  await chat.getByRole("button", { name: "Show me the rooms" }).click()
  await expect(chat.getByText("Pine Loft").first()).toBeVisible({ timeout: 30_000 })
  await expect(chat.getByRole("link", { name: "View" }).first()).toBeVisible()
})
