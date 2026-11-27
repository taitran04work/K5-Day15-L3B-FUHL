import type { PublicHome } from "@/lib/types"

/** Slide ids of the guest home page, in order. The policies slide only exists when there's something to show. */
export function homeSlideIds(home: PublicHome): string[] {
  const ids = ["top", "gioi-thieu", "rooms"]
  if (home.cancellation || home.faqs.length > 0) ids.push("chinh-sach")
  ids.push("lien-he")
  return ids
}

export interface HomeBackdrop {
  url: string
  /** true when the owner hasn't picked one and a room photo is used instead */
  auto: boolean
}

/**
 * Background photo for every home page slide: the owner's pick (Website settings) first, otherwise the next
 * room photo not already used elsewhere. Shared by the guest page and the settings preview so they always agree.
 * `chinh-sach` is always resolved (after the real slides) so settings can preview it even before policies exist.
 */
export function homeBackdrops(home: PublicHome): Record<string, HomeBackdrop> {
  const { tenant, rooms } = home
  const chosen: Record<string, string | null> = {
    top: tenant.coverImageUrl,
    "gioi-thieu": tenant.bgAboutUrl,
    rooms: tenant.bgRoomsUrl,
    "chinh-sach": tenant.bgPoliciesUrl,
    "lien-he": tenant.bgContactUrl,
  }
  const taken = new Set(Object.values(chosen).filter((u): u is string => !!u))
  const pool = [...new Set(rooms.flatMap((r) => [r.coverUrl, ...r.photos.map((p) => p.url)]).filter((u): u is string => !!u && !taken.has(u)))]
  const fallback = [...taken][0] ?? ""
  let next = 0
  const pick = (id: string): HomeBackdrop =>
    chosen[id] ? { url: chosen[id]!, auto: false } : { url: pool.length ? pool[next++ % pool.length] : fallback, auto: true }

  const result: Record<string, HomeBackdrop> = {}
  for (const id of homeSlideIds(home)) result[id] = pick(id)
  if (!result["chinh-sach"]) result["chinh-sach"] = pick("chinh-sach")
  return result
}
