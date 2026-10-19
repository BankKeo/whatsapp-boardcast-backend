# Partner Club WhatsApp Marketing System — Backend

Production-oriented REST API for the Partner Club WhatsApp Marketing System
(Lao Brewery Co., Ltd., Carlsberg Group). It manages outlets, audience segments,
WhatsApp campaigns, message templates, reports, staff accounts, permissions and
contact consent.

Stack: **Node.js · Express · TypeScript (strict) · MongoDB · Mongoose · Zod**.

The API is designed to be consumed by the existing Next.js dashboard
(`whatsapp-boardcast-dashboard`). Response shapes and enum values match that
project's `types/*.ts` contract, so an API response serialises straight into the
existing UI. See `docs/starter-project.md` (the brief) and `docs/schema-design.md`
(model/contract reconciliation).

---

## 1. Requirements

- Node.js **20+** (developed on Node 24)
- A MongoDB instance (local `mongod`, Docker, or MongoDB Atlas)
- npm or pnpm

## 2. Quick start

```bash
npm install
cp .env.example .env          # then edit values
npm run seed                  # creates the admin, demo outlets, templates, campaigns
npm run dev                   # http://localhost:4000/api/v1
```

The seeded administrator (change the password after first sign-in):

| Email | Password |
| --- | --- |
| `admin@partnerclub.local` | `ChangeMe-Admin-2026` |

```bash
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@partnerclub.local","password":"ChangeMe-Admin-2026"}'
```

## 3. npm scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Development server with reload (tsx watch) |
| `npm run build` | Compile to `dist/` (`tsc -p tsconfig.build.json`) |
| `npm start` | Run the compiled server (`node dist/server.js`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit + integration suite |
| `npm run test:watch` | Vitest in watch mode |
| `npm run seed` | Seed the demo dataset |
| `npm run seed:admin` | Create/refresh only the administrator |

## 4. Environment variables

Validated with Zod at startup (`src/config/env.ts`); a misconfigured deployment
fails fast with a readable report. See `.env.example` for the full list.

| Variable | Notes |
| --- | --- |
| `NODE_ENV` | `development` \| `test` \| `production` |
| `PORT` | HTTP port (default `4000`) |
| `API_PREFIX` | Route prefix (default `/api/v1`) |
| `MONGODB_URI` | MongoDB connection string (required) |
| `FRONTEND_URL` / `CORS_ORIGINS` | Browser origin allowlist |
| `ACCESS_TOKEN_SECRET` / `REFRESH_TOKEN_SECRET` | JWT secrets — **required unique values in production** |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL` | e.g. `15m`, `30d` |
| `WHATSAPP_PROVIDER` | `mock` (default, simulated) or `meta` |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | Required when `WHATSAPP_PROVIDER=meta` |
| `WHATSAPP_REQUIRE_APPROVED_TEMPLATES` | Block dispatch of non-approved templates (default `true`) |
| `MESSAGING_DAILY_CAP_PER_CONTACT` | Rolling 24h per-contact cap |
| `QUEUE_DRIVER` / `REDIS_URL` | `memory` (default) or `redis` |

`WHATSAPP_PROVIDER=mock` is forced whenever credentials are absent, and the API
always labels the integration as simulated (`data.simulated = true`). **Mock mode
never claims real delivery.**

## 5. Project structure

```text
src/
├── app.ts                     # Express wiring (security → routes → errors)
├── server.ts                  # bootstrap, scheduler, graceful shutdown
├── config/                    # env, database, logger, cors
├── common/
│   ├── errors/                # AppError taxonomy
│   ├── http/                  # response envelope + pagination meta
│   ├── middleware/            # validate, authenticate, authorize, rate limit, errors
│   ├── validators/            # ObjectId, dates
│   ├── utils/                 # phone, csv, crypto, password, duration, redact
│   ├── constants/             # domain enums, Lao provinces/districts
│   └── auth/                  # auth context types
├── modules/
│   ├── auth/ users/ outlets/ segments/ campaigns/ templates/
│   ├── whatsapp/              # provider abstraction + mock/meta providers + webhook
│   ├── reports/ settings/ audit-logs/ imports/ jobs/
└── routes/                    # versioned router + health
scripts/seed.ts
tests/                         # unit + integration (Vitest + Supertest)
```

Each module separates **routes → controller → service → model / zod schema**.
Business logic lives in services, never in route handlers.

## 6. API

All endpoints are under `/api/v1`. Private routes require a bearer access token.

### Authentication (`/auth`)

| Method | Path | Description |
| --- | --- | --- |
| POST | `/auth/login` | Email + password → access token (refresh token set as HTTP-only cookie) |
| POST | `/auth/refresh` | Rotate the refresh token (reuse revokes all sessions) |
| POST | `/auth/logout` | Revoke the refresh token and clear cookies |
| GET | `/auth/me` | Current user |
| POST | `/auth/change-password` | Change password (revokes all sessions) |

### Outlets (`/outlets`)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/outlets` | Search / filter / sort / paginate |
| GET | `/outlets/stats` | Dashboard KPIs and distributions |
| GET | `/outlets/breakdown` | Audience breakdown for a filter set |
| GET | `/outlets/:id` | Detail |
| POST | `/outlets` | Create |
| PATCH | `/outlets/:id` | Update (merges then re-validates) |
| DELETE | `/outlets/:id` | Delete |
| POST | `/outlets/bulk` | Bulk create (≤ 500) |
| GET | `/outlets/export` | CSV export |
| GET | `/outlets/import/template` | CSV import template |
| GET | `/outlets/import/jobs` | Import job history |
| POST | `/outlets/import/preview` | Validate a CSV and return row-level results |
| POST | `/outlets/import/commit` | Commit a validated CSV |

Listing example:

```
GET /api/v1/outlets?province=Vientiane%20Capital&category=On-Trade&consent=consented&page=1&limit=25
```

The list, export and breakdown queries also accept the plural form used by the
dashboard's multi-select filters; repeat the key and qs parses it as an array:

```
GET /api/v1/outlets?provinces=Vientiane%20Capital&provinces=Savannakhet&categories=On-Trade&page=1&limit=25
```

### Segments, campaigns, templates, reports, admin

| Area | Paths |
| --- | --- |
| Segments | `GET/POST /segments`, `GET/PATCH/DELETE /segments/:id`, `POST /segments/preview`, `GET /segments/:id/recipients` |
| Campaigns | `GET/POST /campaigns`, `GET/PATCH /campaigns/:id`, `POST /campaigns/:id/{preview,submit,approve,schedule,cancel,send,duplicate}`, `GET /campaigns/:id/{recipients,report}` |
| Templates | `GET/POST /templates`, `GET/PATCH/DELETE /templates/:id`, `POST /templates/:id/{submit-for-approval,refresh-status}` |
| Reports | `GET /reports/{overview,campaign-performance,province-performance,category-performance,message-failures,export}` |
| Users | `GET/POST /users`, `GET/PATCH /users/:id`, `PATCH /users/:id/status` |
| Settings | `GET/PATCH /settings` |
| Audit | `GET /audit-logs` |
| WhatsApp | `GET/POST /whatsapp/webhook`, `GET /whatsapp/health` |
| Ops | `GET /health` |

## 7. Response format

Success:

```json
{ "success": true, "data": {}, "meta": { "page": 1, "limit": 25, "total": 100, "totalPages": 4 } }
```

Error:

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Please check the submitted information.", "details": [ { "path": "phone", "message": "Enter a valid …" } ] } }
```

Status codes: `200`, `201`, `204`, `400`, `401`, `403`, `404`, `409`, `422`
(validation), `429`, `500`. Stack traces and database internals are never returned
in production.

### Example payloads

Create an outlet:

```bash
curl -X POST http://localhost:4000/api/v1/outlets \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "name":"Sok Dee Mini Mart","ownerName":"Khamla Sisouphan",
    "phone":"+856 20 5555 1188","province":"Vientiane Capital","district":"Chanthabouly",
    "village":"Ban Phonxay","category":"Off-Trade","status":"Active","channel":"Field team",
    "whatsappVerified":true,"marketingConsent":true,"consentSource":"Field team form","notes":""
  }'
```

Preview a segment:

```bash
curl -X POST http://localhost:4000/api/v1/segments/preview \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{ "filters": { "provinces": ["Vientiane Capital"], "categories": ["On-Trade"], "consent": "consented", "eligibility": "eligible" }, "limit": 8 }'
```

Create → schedule → send a campaign:

```bash
curl -X POST http://localhost:4000/api/v1/campaigns \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{ "details": {"name":"December push","objective":"Seasonal promotion","description":"","owner":"Khamla Sisouphan"},
        "audience": {"segmentId":null,"segmentName":null,"filters":{"provinces":["Vientiane Capital"],"categories":["On-Trade"],"consent":"consented","eligibility":"eligible"}},
        "message": {"templateId":"<id>","language":"en","message":"Hello partner, our seasonal promotion is live."},
        "scheduledAt": null, "idempotencyKey":"wizard-0184" }'

curl -X POST http://localhost:4000/api/v1/campaigns/<id>/schedule -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"scheduledAt":null,"language":"en"}'
curl -X POST http://localhost:4000/api/v1/campaigns/<id>/send     -H "Authorization: Bearer $TOKEN"
```

## 8. Consent, eligibility and dispatch safety

Enforced server-side on every audience resolution (`src/modules/outlets/outlet.model.ts`):

- **Phone valid** — normalises to `+856 20` + 8 digits.
- **Eligible** — `whatsappVerified` **and** valid phone.
- **Consented** — consent on file; withdrawal is a first-class event, never
  inferred from a phone number.
- **Deliverable** — eligible **and** consented (used for recipient counts).
- Dispatch re-resolves consent/eligibility at send time, de-duplicates to **one
  message per unique number**, and applies a rolling 24h per-contact cap.
- Opted-out contacts are never included in dispatch jobs.

## 9. Campaign lifecycle

`Draft → Pending Approval → Scheduled → Sending → Completed`, with `Cancelled`
from pre-send states and `Failed` on unrecoverable errors. Only Administrators
and Marketing Managers may approve, schedule, cancel or send. Approval and the
audience criteria snapshot are recorded for audit. Dispatch requires an approved
template when `WHATSAPP_REQUIRE_APPROVED_TEMPLATES=true`.

## 10. Background jobs & scheduling

Campaign fan-out and scheduled dispatch run through a queue so requests never
block (`src/modules/jobs/`). The default is an in-process queue with concurrency,
retries with backoff and a dead-letter list; a scheduler sweep dispatches due
campaigns every 60s.

**Production:** set `QUEUE_DRIVER=redis` and run a BullMQ worker against
`REDIS_URL`. Job processors are registered in
`src/modules/jobs/processors.ts`; the queue interface is driver-agnostic.

## 11. Testing

```bash
npm test
```

Unit tests cover phone logic, query building, the campaign state machine, CSV
safety, template variables and settings. Integration tests run the full Express
app against an in-memory MongoDB and cover authentication, authorization, outlet
CRUD, duplicate handling, pagination/filtering, CSV import validation, segment
preview, consent/eligibility enforcement, the approval workflow, duplicate
dispatch prevention, report aggregation and webhook verification/deduplication.

Tests use `mongodb-memory-server` and never touch real data.

## 12. Security notes

Helmet headers, explicit CORS allowlist, global + auth rate limiting, body size
limits, bcrypt password hashing, JWT access tokens with rotating/revocable
HTTP-only refresh-token cookies, Zod validation on all input, whitelisted MongoDB
query construction (no raw operator injection), log redaction of secrets and
contact data, safe CSV generation (formula-injection guarded), webhook signature
verification, and audit logging for administrative actions.

## 13. Definition of done

Server starts; MongoDB connects; env validated at startup; every endpoint
validated with Zod; auth and role permissions enforced; outlet CRUD/search/import
work with row-level feedback; segments and campaigns return server-calculated
counts with consent/eligibility enforced; campaign lifecycle and approval rules
enforced; recipients created without duplicates; reports use persisted data;
mock mode never claims real sends; tests cover the core rules.
