/**
 * Camera keyframes for the landing 3D scene (kept separate so three.js stays lazy-loaded).
 * The island sits still at the origin; only the camera travels. Where copy sits beside the
 * island, `look` is aimed off to one side so the island lands next to the text.
 * The deck interpolates between neighbouring shots by scroll progress, so the order of the
 * slides reads as one continuous flight: orbit → aerial → shoreline → jetty → into the villa.
 *
 * World landmarks: island radius ≈ 2.9, villa ≈ (-0.45, 0.45, -1.1), glazed front at z ≈ -0.72,
 * jetty x ≈ 1.4 / z 2.4…4.3, city skyline on the horizon towards +z.
 */
export type Vec3 = [number, number, number]

export interface Shot {
  cam: Vec3
  look: Vec3
  /** interior / lantern light level */
  glow: number
  /** show the floating product UI cards on this shot */
  cards: boolean
  /** vertical field of view; defaults to 40 */
  fov?: number
}

/**
 * Two hanging boards (pricing, FAQ) under a timber frame on the west lawn, facing +z.
 * `paper` is the printable face inside the frame. The close-up shots put the camera
 * straight in front so the paper fills 76% of the viewport height — the HTML sheet in
 * the deck is sized to the same box, so the page "lands" on the board.
 */
export const BOARD = {
  paper: [0.536, 0.336] as const,
  frame: 0.012,
  centers: { pricing: [-1.55, 0.56, 0.9] as Vec3, faq: [-0.95, 0.56, 0.9] as Vec3 },
  /** fraction of the viewport height the paper covers in the close-up */
  fill: 0.76,
}
const CLOSE = BOARD.paper[1] / (2 * Math.tan((40 / 2) * (Math.PI / 180)) * BOARD.fill)
const closeUp = (c: Vec3): Shot => ({ cam: [c[0], c[1], c[2] + 0.008 + CLOSE], look: [c[0], c[1], c[2]], glow: 2.2, cards: false, fov: 40 })

export const SHOTS = {
  // whole island, three-quarter view, island right of the headline
  hero: { cam: [7.8, 3.8, 10.8], look: [-2.5, 0.35, 1.9], glow: 1.4, cards: true },
  // swung round to the far side, island left of the copy
  problem: { cam: [-7.4, 2.7, 8.4], look: [2.4, 0.5, 2.1], glow: 0.35, cards: false },
  // drone straight above the lagoon, the full island on the right
  live: { cam: [1.6, 13.5, 8.4], look: [-3.6, 0, 0.9], glow: 1.8, cards: false },
  // standing at the end of the jetty, looking back at the villa against the sunset
  types: { cam: [1.6, 0.62, 5.6], look: [-0.5, 0.75, -1.3], glow: 1.6, cards: false },
  // on the beach by the umbrella, across the pool to the villa
  platform: { cam: [-3.4, 1.05, 3.4], look: [0.3, 0.45, -0.9], glow: 1.7, cards: false },
  // on the west lawn facing the two boards (boards framed on the right beside the steps copy),
  // so the next scroll dollies smoothly straight into the pricing board
  steps: { cam: [-2.2, 0.85, 3.8], look: [-1.85, 0.55, 0.9], glow: 2.0, cards: false, fov: 40 },
  // straight into the hanging boards
  pricing: closeUp(BOARD.centers.pricing),
  faq: closeUp(BOARD.centers.faq),
  // pull all the way out: establishing shot under the closing headline
  cta: { cam: [0.6, 6.6, 16.5], look: [0, 2.7, 0], glow: 2.4, cards: false },
} satisfies Record<string, Shot>

/** Copy for the floating product cards (passed in: drei <Html> renders outside the i18n context). */
export interface SceneLabels {
  booking: string
  bookingSub: string
  ai: string
  chat: string
  paid: string
  paidAmount: string
  occupancy: string
  calendar: string
  pricingBoard: string
  faqBoard: string
}
