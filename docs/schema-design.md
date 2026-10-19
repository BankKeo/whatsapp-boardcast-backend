# Database schema design

Mongoose models + Zod schemas for the Partner Club WhatsApp Marketing System
backend, derived from `docs/starter-project.md` and the contracts the existing
dashboard already consumes.

## How to read this

Two sources had to be reconciled:

- **`docs/starter-project.md`** — the backend brief (models, consent, approval,
  provider abstraction).
- **`whatsapp-boardcast-dashboard`** — a working Next.js prototype whose types
  and service functions are the de-facto API contract. Its own docs
  (`docs/outlet-database-integration.md`, `consent-and-eligibility.md`) ask the
  server to keep the *same return shapes* so the UI needs no rework.

Decision: **store the dashboard's field names and enum values**, and add the
richer fields the brief requires on top. That way an API response serialises
straight into the existing `types/*.ts` Zod schemas.

## Files

| Model | File | Dashboard counterpart |
| --- | --- | --- |
| `User` | `src/modules/users/user.model.ts` | `types/team.ts` |
| `Outlet` | `src/modules/outlets/outlet.model.ts` | `types/outlet.ts` |
| `Province` | `src/modules/outlets/province.model.ts` | `lib/data/constants.ts` |
| `Segment` | `src/modules/segments/segment.model.ts` | `types/segment.ts` |
| `Campaign` | `src/modules/campaigns/campaign.model.ts` | `types/campaign.ts` |
| `CampaignRecipient` | `src/modules/campaigns/campaignRecipient.model.ts` | (simulated metrics) |
| `MessageTemplate` | `src/modules/templates/template.model.ts` | `types/template.ts` |
| `AuditLog` | `src/modules/audit-logs/auditLog.model.ts` | `types/activity.ts` |
| `ImportJob` | `src/modules/imports/importJob.model.ts` | `CsvImportResult` |
| `ApplicationSetting` | `src/modules/settings/applicationSetting.model.ts` | Settings sections |
| `RefreshToken` | `src/modules/auth/refreshToken.model.ts` | — |

Zod request schemas live beside each model (`*.schema.ts`) and are ported from
`whatsapp-boardcast-dashboard/lib/schemas/*`, so client and server validation
cannot drift. Shared enums are in `src/common/constants/domain.ts`; Lao
province/district reference data in `src/common/constants/laos.ts`; phone logic
in `src/common/utils/phone.ts` (ported from `lib/phone.ts`).

## Enum alignment

The brief uses canonical codes (`ON_TRADE`, `ADMIN`); the dashboard uses display
values. The schema stores the display values because they are what the UI reads:

| Concept | Stored value |
| --- | --- |
| Outlet category | `On-Trade`, `Off-Trade`, `Modern Trade` |
| Outlet status | `Active`, `Inactive`, `Pending Review` |
| Outlet channel / source | `Field team`, `CSV import`, `Distributor list`, `Partner referral` |
| WhatsApp eligibility | `Eligible`, `Ineligible`, `Needs review` |
| Data quality | `Complete`, `Needs review`, `Incomplete` |
| Consent status | `Unknown`, `Opted in`, `Opted out` |
| Campaign status | `Draft`, `Pending Approval`, `Scheduled`, `Sending`, `Completed`, `Cancelled`, `Failed` |
| Roles | `Administrator`, `Marketing Manager`, `Campaign Creator`, `Read-Only Analyst` |
| Template status | `Approved`, `Pending Approval`, `Rejected`, `Draft` |

If canonical storage is ever preferred, add a transform in the serializer rather
than changing the model — the UI depends on these strings.

## Derived fields and consent/eligibility rules

`Outlet` stores derived fields so they can be indexed and filtered in Mongo
rather than recomputed per request. The single source of truth is
`deriveOutletFields()` in `outlet.model.ts`, run in a `pre('validate')` hook:

- **Phone status** — `Valid` when it normalises to `+85620` + 8 digits, else
  `Invalid` / `Missing`.
- **WhatsApp eligibility** — `Eligible` = verified **and** valid phone;
  `Needs review` = valid phone but not verified; `Ineligible` = unusable number.
  The dashboard's `eligible`/`ineligible` filter maps to this.
- **Consent status** — `Opted out` (revoked) > `Opted in` > `Unknown`. Consent is
  never inferred from the mere presence of a number, per the brief §4.2.
- **Data quality** — `Incomplete` (bad phone) → `Needs review` (unverified, no
  consent, or duplicate) → `Complete`.

`duplicatePhone` and the resulting `dataQualityStatus` depend on *other* records,
so they are refreshed by the outlets service (bulk recompute) after writes, not
by the single-document hook.

## Duplicate handling

The brief says to enforce a unique contact where the business requires it. The
dashboard does **not**: it treats a shared number as a data-quality problem
(`duplicatePhone`, shown on import and bucketed as "Needs review"). So
`phoneNormalized` is **indexed but not unique**. Import still reports
`file` / `database` duplicates per row, and dispatch de-duplicates by number. If
a hard one-contact-per-number rule is later required, add a partial unique index
and return `409` on conflict.

## Idempotency and dispatch safety

- `Campaign.idempotencyKey` — unique sparse; repeated create/dispatch requests
  return the existing campaign instead of duplicating it.
- `CampaignRecipient { campaignId, outletId }` — **unique compound index**; the
  guarantee that a retried job cannot message the same outlet twice.
- `CampaignRecipient.providerMessageId` — unique sparse, for webhook upserts.
- `metrics.read` is nullable: older campaigns have no read receipts (the UI shows
  `—` / "Unavailable").

## Indexes summary

- **Outlets** — text (`name`, `ownerName`), `phoneNormalized`, `phoneStatus`,
  `province`, `district`, `category`, `status`, `channel`, `whatsappEligibility`,
  `marketingConsent`, `dataQualityStatus`; compounds `{province,category}`,
  `{province,district}`, `{marketingConsent,whatsappEligibility}`,
  `{status,dataQualityStatus}`.
- **Campaigns** — text (`name`,`description`,`owner`), `{status,createdAt}`,
  `{status,scheduledAt}` (scheduler sweep), `{audience.provinces,audience.categories}`,
  `idempotencyKey` unique sparse.
- **Recipients** — unique `{campaignId,outletId}`, `{campaignId,status}`,
  `providerMessageId` unique sparse.
- **Users** — unique `email`, `{role,status}`.
- **Templates** — text (`name`,`body`), `{status,language}`, `providerTemplateId`
  unique sparse.
- **RefreshToken** — `tokenHash` unique, TTL on `expiresAt`.
- **AuditLog** — `createdAt` desc, `{targetType,targetId,createdAt}`.

## API serialisation

Every schema uses the shared `baseSchemaOptions` (`src/common/utils/mongo.ts`):
`timestamps: true`, and `toJSON` renames `_id → id`, drops `__v`, and includes
virtuals. ObjectId references are exposed as strings, matching the dashboard's
opaque ids (`out-…`, `cmp-…`). Paginated list endpoints return
`{ success, data, meta: { page, limit, total, totalPages } }` per brief §10.

## Deliberate gaps / open items

- No `package.json`/`tsconfig.json` yet — these are schema artifacts, not a
  runnable service. Phase 1 (Express + env validation + Mongo connection) is the
  next step per brief §15.
- `Province` is modelled but not yet seeded from `src/common/constants/laos.ts`.
- Campaign statuses follow the dashboard (no separate `Approved`/`Queued`
  states); approval is recorded via `approvedBy`/`approvedAt`, and `Scheduled`
  covers queued-for-dispatch. Extend the enum if the worker needs finer states.
- High-volume import row results should move to a dedicated `ImportJobRow`
  collection; today only a bounded `previewRows` sample is embedded.
