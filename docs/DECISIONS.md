# Decisions

Defaults chosen where the brief left room, and the places where the build deliberately differs from it.

## Product and naming

- **Name: Stayra** (the brief said "Nestly"; renamed on request). Namespaces are `Stayra.*`, booking codes are `STR-XXXXXX`, and the platform admin is `admin@stayra.dev`.
- Booking codes use a 31-character alphabet without `0/O/1/I/L`, so they can be read over the phone.

## AI

- **Model: `claude-haiku-5-5`**, configurable with `ANTHROPIC_MODEL`. The brief named `claude-haiku-4-5`, but that model retires on 2026-11-30, days after this build. haiku 5.5 is its direct successor.
- **Concierge calls:** no `temperature` (current models reject it) and `effort: low` for chat latency. Thinking blocks are passed back unchanged within a turn's tool loop. Across turns only the visible text is replayed. A `refusal` stop reason hands the conversation to the owner.
- **Policy extraction** uses structured outputs (`output_config.format` with a JSON schema) rather than forced tool use. Current models reject forced `tool_choice`.
- **Offline mode.** No AI key is available in this environment, so:
  - a deterministic, bilingual guided assistant (`OfflineConcierge`) answers when `ANTHROPIC_API_KEY` is empty. It keeps the demo fully working: rooms, availability, guided booking, booking lookup, cancellation and hand-off.
  - a heuristic extractor turns policy PDFs into rules without Claude. Uploading the seed PDF through the owner API yields three draft rules (100%, 50%, and 0%) with source quotes.
  - **The Claude code paths compile but have not been run against the live API.** Run them once with a real key before showing the full concierge.
- **Embeddings:** Voyage `voyage-3` (1024 dimensions) when `VOYAGE_API_KEY` is set. Otherwise policy search uses Postgres full-text search (`to_tsvector('simple')`) plus a keyword fallback.

## Booking engine

- **Availability guarantee.** A Postgres exclusion constraint on `(RoomId, tstzrange(StartAt, BlockedUntil))` covers the blocking statuses Hold, PendingDeposit, Confirmed and CheckedIn. An advisory lock per room serializes the "expire stale holds, then insert" step. `BlockedUntil` is `EndAt` plus the cleaning buffer for hourly stays, and equals `EndAt` for nightly stays.
- **Expired holds.** The minute job and the insert path both mark expired holds `Expired`, so the constraint never has to know the time.
- **Pricing order:**
  - A matching *Override* rule (highest priority wins) sets the unit price and stops.
  - Otherwise all matching *Fixed* amounts are added, then all *Percent* values are summed and applied once.
  - Each unit is rounded to 1,000 ₫.
  - Weekend rules apply to the *nights that start* on the chosen days (Friday and Saturday by default).
- **Extra guests** pay per night for each guest above the room's `BaseGuests` ("included guests"). For hourly stays it is charged once.
- **Hourly stays** must start and end on the same day, within the tenant's opening hours (07:00–23:00 by default).
- **Statuses.** Hold is a web or chat booking with a running clock. PendingDeposit is an owner-created booking awaiting payment, with no clock. Owners can create bookings that are confirmed straight away (cash, bank transfer).
- **Late deposits.** A deposit paid after a hold expired revives the booking if the slot is still free. If not, it is refunded in full automatically.
- **Changes:**
  - A higher price adds to the remaining balance. If the guest has already paid more than the deposit, a separate "price difference" MoMo link is created instead.
  - A lower price refunds anything paid above the new total, or keeps it as credit (`LowerPriceHandling` setting).
- **Refunds:**
  - Only the Active policy is used.
  - Cancelling at or after check-in counts as a no-show.
  - A window that no rule covers, or having no active policy, sends the cancellation to the owner for approval.
  - Refunds are capped at the amount actually paid.
  - Owners can override the refund amount when approving.
- **Remaining balance** is requested by a Hangfire job scheduled when the deposit is paid. Owners also have a "Send payment link" button. With the default settings (24 hours before check-in) the demo would wait a day.

## Payments

- MoMo `captureWallet` v2. Both the IPN and the browser return page carry MoMo's signed fields, so **the return page also records the payment**. That makes payments complete on localhost without ngrok.
- A reconciliation job queries open payments every 5 minutes.
- The "Simulate payment" button exists only when `ASPNETCORE_ENVIRONMENT=Development`.
- Refunds of simulated or cash payments are recorded as refunded without calling MoMo; the host settles those by hand.
- MoMo's `qrCodeUrl` is a `momo://` payload, not an image, so the frontend renders the QR code itself.

## Channels

- Zalo sends text plus media images; rich cards become text with links. Simulator user IDs start with `sim-` and are never sent to the Zalo API.
- When an owner replies in the inbox, the conversation is taken over automatically.
- Booking notices, change and cancellation replies, refund explanations, and payment reminders use the conversation language. Chat tool replies use the current chat language. Booking notices use the linked conversation's current language, with the homestay's default for messages without a conversation. Room names, rule labels and host notes retain their original wording.

## Frontend

- **shadcn/ui** components use the classic Radix-based `new-york` style. The current CLI defaults to Base UI, which the brief excludes.
- **Single accent colour:**
  - CSS variable `--brand` is set per tenant at runtime. Its foreground colour is chosen for WCAG AA contrast.
  - Status badges use subtle amber only for "needs action" states and red only for failures or no-shows. Everything else is neutral or the accent.
- **Type scale** is enforced by remapping Tailwind's sizes: `text-xs/sm/base/lg/xl/2xl` = 13/14/16/20/28/40 px.
- **Money:** `vi` shows `1.250.000 ₫`, `en` shows `₫1,250,000`. Dates are always shown in `Asia/Ho_Chi_Minh` time.
- **API types:**
  - `src/lib/api-schema.d.ts` is generated by openapi-typescript (`npm run gen:api`).
  - Endpoints that return anonymous objects use hand-written types in `src/lib/types.ts`, which mirror `Contracts/Dtos.cs`.
- **Translations:**
  - Vietnamese has no plural forms, so counted strings are written once and mapped to i18next's `_other` key at load time.
  - A script checks that every key used in the code exists in both languages.
- **Lint:** `react-refresh/only-export-components` is off. Several page modules export small hooks next to their component; that only affects hot-reload granularity in development.
- **Owner calendar** shows 14 days by default (21 and 31 are available). Drag across empty days on a room row to start a booking. The room column stays visible while scrolling the timeline on narrow screens.
- **Responsive tables** show labeled rows in narrow containers so actions and values stay accessible without horizontal scrolling.
- **Location** shows the address and a Google Maps link. The booking site works without loading a third-party map.
- **Mobile chat** opens from the booking site header so the launcher leaves forms and booking summaries visible.

## Not done or simplified

- Email and SMS are stubs: invite links, password resets and SMS messages are written to the API log.
- The Zalo "list" template isn't used; Zalo receives text plus images.
- File storage is local disk behind `IFileStorage`; an S3 implementation is not included.
