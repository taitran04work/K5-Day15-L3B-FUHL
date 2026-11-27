// Types mirroring the API contracts (backend/src/Stayra.Api/Contracts/Dtos.cs).

export type BookingMode = "Nightly" | "Hourly"
export type BookingSource = "Web" | "WebChat" | "Zalo" | "Owner"
export type BookingStatus = "Hold" | "PendingDeposit" | "Confirmed" | "CheckedIn" | "CheckedOut" | "Cancelled" | "Expired" | "NoShow"
export type PaymentKind = "Deposit" | "Remaining" | "Extra" | "Refund"
export type PaymentStatus = "Created" | "Paid" | "Failed" | "Expired" | "Refunded"
export type PaymentProvider = "VNPay" | "Cash" | "Manual"
export type ChangeRequestType = "ChangeRoom" | "ChangeDates" | "Cancel"
export type ChangeRequestStatus = "Pending" | "Approved" | "Rejected" | "Auto"
export type PriceRuleType = "Weekend" | "DateRange" | "Holiday" | "HourWindow"
export type AdjustmentType = "Percent" | "Fixed" | "Override"
export type RemainingPaymentTrigger = "HoursBeforeCheckIn" | "AtCheckIn" | "AtCheckOut"
export type LowerPriceHandling = "Refund" | "Credit"
export type UserRole = "PlatformAdmin" | "Owner" | "Staff"
export type DocumentStatus = "Uploaded" | "Processing" | "Ready" | "Failed"
export type RefundPolicyStatus = "Draft" | "Active" | "Archived"
export type RefundAppliesTo = "Deposit" | "Total"
export type FaqStatus = "Suggested" | "Approved"
export type ChannelType = "WebWidget" | "Zalo"
export type ConversationStatus = "Bot" | "HumanTakeover" | "Closed"
export type MessageRole = "Guest" | "Bot" | "Owner" | "System" | "Tool"
export type DayOfWeek = "Sunday" | "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday"

export interface Me {
  id: string
  email: string
  name: string
  role: UserRole
  tenantId: string | null
  tenantSlug: string | null
  tenantName: string | null
  accentColor: string | null
}

export interface Photo {
  id: string
  url: string
  caption: string | null
  sortOrder: number
  isCover: boolean
}

export interface Room {
  id: string
  name: string
  code: string
  description: string | null
  maxGuests: number
  baseGuests: number
  beds: string | null
  areaM2: number | null
  amenities: string[]
  isActive: boolean
  supportsNightly: boolean
  supportsHourly: boolean
  baseNightlyPrice: number
  baseHourlyPrice: number
  minHours: number
  extraGuestFee: number
  sortOrder: number
  coverUrl: string | null
  photos: Photo[]
}

export interface QuoteLine {
  label: string
  date: string
  hour: number | null
  basePrice: number
  price: number
  ruleName: string | null
}

export interface Quote {
  roomId: string
  roomName: string
  mode: BookingMode
  startAt: string
  endAt: string
  units: number
  guests: number
  lines: QuoteLine[]
  subtotal: number
  extraGuestFee: number
  total: number
  deposit: number
  depositPercent: number
  currency: string
}

export interface Payment {
  id: string
  bookingId: string
  kind: PaymentKind
  amount: number
  provider: PaymentProvider
  orderId: string
  payUrl: string | null
  qrCodeUrl: string | null
  deeplink: string | null
  status: PaymentStatus
  transId: number | null
  message: string | null
  expiresAt: string | null
  createdAt: string
  paidAt: string | null
}

export interface Booking {
  id: string
  code: string
  roomId: string
  roomName: string | null
  mode: BookingMode
  startAt: string
  endAt: string
  guests: number
  guestName: string
  guestPhone: string
  guestEmail: string | null
  note: string | null
  source: BookingSource
  status: BookingStatus
  totalAmount: number
  depositAmount: number
  paidAmount: number
  refundAmount: number
  creditAmount: number
  balance: number
  holdExpiresAt: string | null
  createdAt: string
  conversationId: string | null
  cancelReason: string | null
}

export interface ChangeRequest {
  id: string
  bookingId: string
  type: ChangeRequestType
  payload: Record<string, unknown>
  priceDiff: number
  refundQuote: number
  explanation: string | null
  reason: string | null
  status: ChangeRequestStatus
  decidedBy: string | null
  decidedAt: string | null
  createdAt: string
}

export interface GuestBooking {
  code: string
  status: BookingStatus
  mode: BookingMode
  startAt: string
  endAt: string
  guests: number
  guestName: string
  room: Room
  totalAmount: number
  depositAmount: number
  paidAmount: number
  refundAmount: number
  balance: number
  holdExpiresAt: string | null
  payments: Payment[]
  pendingRequest: ChangeRequest | null
}

export interface RefundQuote {
  covered: boolean
  requiresApproval: boolean
  refundAmount: number
  refundPercent: number
  appliesTo: RefundAppliesTo | null
  ruleLabel: string | null
  hoursBeforeCheckIn: number
  policyVersion: number | null
  explanation: string
}

export interface ChangeQuote {
  available: boolean
  unavailableReason: string | null
  roomId: string
  roomName: string
  startAt: string
  endAt: string
  oldTotal: number
  newTotal: number
  priceDiff: number
  amountToPay: number
  amountToRefund: number
  creditAmount: number
  requiresApproval: boolean
  explanation: string
  quote: Quote | null
}

export interface PublicTenant {
  slug: string
  name: string
  description: string | null
  address: string | null
  phone: string | null
  email: string | null
  logoUrl: string | null
  coverImageUrl: string | null
  accentColor: string
  latitude: number | null
  longitude: number | null
  defaultLanguage: string
  currency: string
  timeZone: string
  checkInTime: string
  checkOutTime: string
  openingTime: string
  closingTime: string
  depositPercent: number
  holdMinutes: number
  botEnabled: boolean
  /** home page slide backgrounds (the hero uses coverImageUrl); null = auto from room photos */
  bgAboutUrl: string | null
  bgRoomsUrl: string | null
  bgPoliciesUrl: string | null
  bgContactUrl: string | null
}

export interface Faq {
  id: string
  question: string
  answer: string
  status: FaqStatus
  sortOrder: number
}

export interface PublicHome {
  tenant: PublicTenant
  rooms: Room[]
  faqs: Faq[]
  cancellation: {
    rules: { label: string; refundPercent: number; appliesTo: RefundAppliesTo; minHoursBeforeCheckIn: number; maxHoursBeforeCheckIn: number | null }[]
    noShowRefundPercent: number
    notes: string | null
  } | null
}

export interface TenantSettings {
  id: string
  slug: string
  name: string
  description: string | null
  address: string | null
  phone: string | null
  email: string | null
  logoUrl: string | null
  coverImageUrl: string | null
  accentColor: string
  latitude: number | null
  longitude: number | null
  defaultLanguage: string
  currency: string
  timeZone: string
  checkInTime: string
  checkOutTime: string
  openingTime: string
  closingTime: string
  cleaningBufferMinutes: number
  depositPercent: number
  remainingPaymentTrigger: RemainingPaymentTrigger
  remainingPaymentHours: number
  remainingReminderHours: number
  holdMinutes: number
  botEnabled: boolean
  botPersona: string | null
  autoApproveChanges: boolean
  autoApproveCancellations: boolean
  lowerPriceHandling: LowerPriceHandling
  zaloConnected: boolean
  zaloAppId: string | null
  zaloOaId: string | null
  vnpayCustom: boolean
  vnpayTmnCode: string | null
  /** the homestay's own Anthropic key is stored (never returned; only its last 4 chars) */
  aiKeyConfigured: boolean
  aiKeyHint: string | null
  aiModel: string | null
  smtpCustom: boolean
  smtpHost: string | null
  smtpPort: number | null
  smtpUsername: string | null
  smtpFromEmail: string | null
  smtpFromName: string | null
  smtpEnableSsl: boolean
  /** home page slide backgrounds (the hero uses coverImageUrl); null = auto from room photos */
  bgAboutUrl: string | null
  bgRoomsUrl: string | null
  bgPoliciesUrl: string | null
  bgContactUrl: string | null
}

export interface PriceRule {
  id: string
  roomId: string | null
  name: string
  type: PriceRuleType
  daysOfWeek: DayOfWeek[]
  startDate: string | null
  endDate: string | null
  startTime: string | null
  endTime: string | null
  adjustmentType: AdjustmentType
  value: number
  priority: number
  isActive: boolean
}

export interface RefundRule {
  minHoursBeforeCheckIn: number
  maxHoursBeforeCheckIn: number | null
  refundPercent: number
  appliesTo: RefundAppliesTo
  label: string
  sourceQuote: string | null
  sourcePage: number | null
}

export interface PolicyWarning {
  code: string
  message: string
  fromHours: number | null
  toHours: number | null
}

export interface RefundPolicy {
  id: string
  status: RefundPolicyStatus
  version: number
  sourceDocumentId: string | null
  rules: RefundRule[]
  noShowRefundPercent: number
  notes: string | null
  ambiguities: string[]
  approvedBy: string | null
  approvedAt: string | null
  createdAt: string
  warnings: PolicyWarning[]
}

export interface PolicyDocument {
  id: string
  fileName: string
  url: string
  status: DocumentStatus
  statusDetail: string | null
  pageCount: number
  chunkCount: number
  uploadedAt: string
}

export interface CardData {
  type: "room_card" | "gallery" | "quote" | "booking_summary" | "payment"
  data: Record<string, unknown>
}

export interface ChatMessage {
  id: string
  conversationId: string
  role: MessageRole
  content: string
  cards: CardData[] | null
  authorName: string | null
  toolName: string | null
  createdAt: string
}

export interface ConversationSummary {
  id: string
  channel: ChannelType
  guestName: string | null
  guestPhone: string | null
  status: ConversationStatus
  needsAttention: boolean
  unreadCount: number
  lastMessagePreview: string | null
  lastMessageAt: string
  bookingId: string | null
  bookingCode: string | null
  language: string
  handoffReason: string | null
}

export interface ImportRow {
  row: number
  name: string
  code: string
  description: string | null
  maxGuests: number
  beds: string | null
  nightlyPrice: number | null
  hourlyPrice: number | null
  minHours: number
  amenities: string[]
  exists: boolean
  errors: Record<string, string>
}

export interface ImportPreview {
  rows: ImportRow[]
  valid: number
  invalid: number
  new: number
  updates: number
}

export interface TimelineItem {
  at: string
  kind: string
  action: string
  actor: string
  data: Record<string, unknown> | null
}

export interface BookingDetail {
  booking: Booking
  room: Room
  payments: Payment[]
  requests: ChangeRequest[]
  timeline: TimelineItem[]
  conversationId: string | null
  nextStatuses: BookingStatus[]
  priceBreakdown: Quote
  remainingDueAt: string | null
}
