# Stayra

A multi-tenant SaaS that gives small homestays a calm, photo-first booking website and an AI concierge — on the web and on Zalo — that books rooms, takes MoMo deposits, handles room and date changes, cancellations and refunds, and sends the remaining balance automatically.

All money, availability and refund logic is deterministic C#. The language model only talks; every number it says comes from a tool call.

## Quick start

```bash
cp .env.example .env        # optional — sensible defaults are built in
docker compose up --build
```

| | |
|---|---|
| Web app | http://localhost:5173 |
| Demo homestays | http://localhost:5173/h/pine-hill · http://localhost:5173/h/sea-breeze |
| Owner app | http://localhost:5173/app — `owner@pinehill.dev` / `Owner@123` |
| Platform admin | http://localhost:5173/admin — `admin@stayra.dev` / `Admin@123` |
| Zalo simulator | http://localhost:5173/dev/zalo-simulator |
| API + Swagger | http://localhost:8080/swagger |
| Background jobs | http://localhost:8080/hangfire (Development only) |

First start takes a minute: the API migrates the database, downloads the demo photos into storage and ingests the sample policy PDF.

The demo works fully offline from AI and MoMo:

- **No `ANTHROPIC_API_KEY`** → a deterministic, bilingual guided assistant answers instead of Claude (rooms, availability, guided booking, booking lookup, cancellation, hand-off). Add a key for the full Claude concierge.
- **No `VOYAGE_API_KEY`** → policy search uses Postgres full-text search instead of embeddings.
- **MoMo** uses the public sandbox credentials from `.env.example`. Every payment card also has a **Simulate payment** button in Development, so the demo never depends on the network.

See [docs/DEMO.md](docs/DEMO.md) for a five-minute walkthrough.

## Repository layout

```
backend/    .NET 10 Web API
  src/Stayra.Domain           entities, enums, booking state machine
  src/Stayra.Application      pricing, refund, availability engines; booking/change/payment services
  src/Stayra.Infrastructure   EF Core + Postgres/pgvector, MoMo, Claude, Voyage, Zalo, PDF, import, Hangfire jobs, seed
  src/Stayra.Api              controllers, auth, tenant resolution, SignalR hubs
  tests/Stayra.Tests          xUnit (unit + Testcontainers integration)
frontend/   React 19 + TypeScript + Vite, Tailwind v4, shadcn/ui (Radix), TanStack Query, i18next
docker/     Dockerfiles
docs/       DEMO.md, DECISIONS.md, screenshots
seed/       sample policy PDF and rooms spreadsheet
```

## Developing locally

Requirements: .NET SDK 10, Node 22+, Docker.

```bash
docker compose up -d postgres

# API on :8080 (seeds on first run)
cd backend/src/Stayra.Api
ASPNETCORE_ENVIRONMENT=Development \
Momo__PartnerCode=MOMO Momo__AccessKey=F8BBA842ECF85 Momo__SecretKey=K951B6PE1waDMi640xX08PD3vg6EkVlz \
dotnet run --urls http://localhost:8080
# or: backend/run-api.sh (publishes to a temp folder so build/test still work while it runs)

# Web on :5173 (proxies /api, /hubs, /files to :8080)
cd frontend && npm install && npm run dev
```

### Checks

```bash
cd backend && dotnet test                 # 77 tests; integration tests start a pgvector container
cd frontend && npm run typecheck && npm run lint
cd frontend && npx playwright test        # needs the API running; starts Vite itself
cd frontend && npm run gen:api            # regenerate typed API client from Swagger
cd frontend && node scripts/screenshots.mjs ../docs/screenshots
cd frontend && LANG_UI=vi node scripts/screenshots.mjs ../docs/screenshots/vi
# Both runs capture 1440px and 375px. Start the Docker stack first.
```

## Configuration

Everything is configured through environment variables — see [.env.example](.env.example). Secrets never live in code. Per-tenant credentials (Zalo tokens, custom MoMo keys) are encrypted at rest with ASP.NET Data Protection; keys are stored in the database.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Claude concierge and policy extraction (default model `claude-sonnet-5-5`) |
| `VOYAGE_API_KEY` | `voyage-3` embeddings for policy search |
| `MOMO_PARTNER_CODE`, `MOMO_ACCESS_KEY`, `MOMO_SECRET_KEY` | Platform MoMo credentials (sandbox by default) |
| `PUBLIC_API_URL` | Public base URL for MoMo IPN and Zalo webhooks (use ngrok: `docker compose --profile tunnel up`) |
| `WEB_BASE_URL` | Where the web app is served (CORS, redirects, links in messages) |
| `JWT_KEY` | Signing key for owner/admin sessions |

## How it fits together

- **Tenancy** — every tenant-owned row has `TenantId`; EF Core global query filters scope every query to the tenant resolved from the owner's JWT (`/api/app`) or the URL slug (`/api/public/{slug}`). Writes to another tenant's rows are rejected in `SaveChanges`. Covered by tests at the DbContext and HTTP level.
- **No double booking** — a Postgres exclusion constraint (`btree_gist`, `tstzrange(start, blocked_until)`) on blocking statuses, plus a per-room advisory lock that sweeps expired holds before insert. A test fires 10 concurrent holds at one slot; exactly one wins.
- **Pricing** — `PricingEngine` quotes per night or per hour: a fixed-price rule wins outright; otherwise fixed amounts are added, then percentages applied; each unit rounds to 1,000 ₫; deposit = total × deposit % rounded to 1,000 ₫.
- **Refunds** — `RefundEngine` uses only the active, owner-approved policy. No active policy, or a window no rule covers, means the cancellation waits for the owner.
- **Payments** — MoMo `captureWallet` with HMAC-SHA256 signatures; the IPN and the browser return are both signature-verified and idempotent by `orderId`; a Hangfire job reconciles open payments via the query API; refunds use the refund API.
- **Concierge** — one `ConciergeService` for widget and Zalo: last 30 messages, language detection, Claude tool use (max 6 iterations), every tool call persisted. Owners watch live over SignalR and can take over.
- **Policies** — PDF → PdfPig text → ~800-token chunks → embeddings (or full-text) for answers; Claude structured output → draft refund rules with source quotes → owner review beside the PDF → activate (versioned).

Design decisions and deviations from the brief are in [docs/DECISIONS.md](docs/DECISIONS.md).
