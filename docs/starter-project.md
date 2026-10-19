# Backend Implementation Prompt — Partner Club WhatsApp Marketing System

## 1. Role and Objective

Act as a senior Node.js backend engineer and software architect.

Build a production-oriented REST API backend for the Partner Club WhatsApp Marketing System for Lao Brewery Co., Ltd. (Carlsberg Group).

The backend will support a Next.js frontend built with:

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- React Hook Form
- Zod

The backend technology stack must be:

- Node.js
- Express.js
- TypeScript
- MongoDB
- Mongoose
- Zod for request validation

The system manages Partner Club outlets, audience segmentation, WhatsApp marketing campaigns, message templates, campaign reports, staff accounts, permissions, and contact consent.

Build a modular backend that is maintainable, secure, testable, and ready for future integration with the official WhatsApp Business Platform.

**Important:** Start by inspecting the existing repository. If the frontend already exists, create the backend in a separate directory or service without breaking the frontend.

---

## 2. Technical Requirements

Use:

- Node.js LTS compatible with the project environment
- Express.js
- TypeScript with strict mode
- MongoDB
- Mongoose
- Zod
- JWT-based authentication or an established secure session strategy
- bcrypt or an appropriate password-hashing library
- Helmet
- CORS with an explicit frontend origin allowlist
- Rate limiting
- Pino or another structured logger
- A test framework such as Vitest or Jest
- Supertest for API integration tests

Use compatible, maintained package versions.

Use Zod to validate incoming request bodies, query parameters, route parameters, environment variables, and configuration.

Use Mongoose schemas for database persistence and model-level constraints. Do not assume Zod replaces database validation or vice versa.

Avoid introducing unnecessary frameworks or dependencies.

## 3. Suggested Project Structure

Organize the backend into feature-based modules.

```text
backend/
├── src/
│   ├── app.ts
│   ├── server.ts
│   ├── config/
│   │   ├── env.ts
│   │   ├── database.ts
│   │   └── cors.ts
│   ├── common/
│   │   ├── errors/
│   │   ├── middleware/
│   │   ├── validators/
│   │   ├── utils/
│   │   └── types/
│   ├── modules/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── outlets/
│   │   ├── segments/
│   │   ├── campaigns/
│   │   ├── templates/
│   │   ├── whatsapp/
│   │   ├── reports/
│   │   ├── imports/
│   │   ├── audit-logs/
│   │   └── settings/
│   └── routes/
│       └── index.ts
├── tests/
├── scripts/
│   └── seed.ts
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

Each feature module should separate:

- Routes
- Controllers
- Services
- Mongoose models
- Zod schemas
- Types, where needed

Keep business logic in services rather than route handlers.

---

## 4. Database Models

Implement Mongoose models with timestamps, appropriate indexes, validation, and consistent references.

### 4.1 User

Fields:

- name
- email
- passwordHash
- role
- status
- lastLoginAt
- createdAt
- updatedAt

Roles:

- ADMIN
- MARKETING_MANAGER
- CAMPAIGN_CREATOR
- ANALYST

Requirements:

- Unique normalized email.
- Password hashes only; never store plaintext passwords.
- Account activation and deactivation.
- Role-based authorization.
- Prevent unauthorized privilege escalation.

### 4.2 Outlet

Fields:

- outletName
- ownerName
- phoneNumber
- normalizedPhoneNumber
- address
- province
- district
- outletCategory
- marketingConsentStatus
- marketingConsentAt
- marketingConsentSource
- consentRevokedAt
- whatsappEligibility
- dataQualityStatus
- source
- lastUpdatedBy
- timestamps

Outlet categories should support:

- ON_TRADE
- OFF_TRADE
- OTHER

Consent states should distinguish:

- UNKNOWN
- OPTED_IN
- OPTED_OUT

WhatsApp eligibility should distinguish:

- ELIGIBLE
- INELIGIBLE
- NEEDS_REVIEW

Never infer marketing consent merely from the existence of a phone number.

Add indexes for normalized phone number, province, category, eligibility, and common search fields.

Handle duplicate phone numbers safely. Where the business requires one unique contact per number, enforce the appropriate database constraint and provide a clear conflict response.

Do not silently merge different outlets sharing a contact number.

### 4.3 Audience Segment

Fields:

- name
- description
- filters
- createdBy
- updatedBy
- timestamps

Support reusable filters for:

- Multiple provinces
- Multiple outlet categories
- Consent status
- WhatsApp eligibility
- Data quality status

Validate filter definitions with Zod and whitelist allowed filter fields and operators.

Do not accept raw MongoDB queries from clients.

### 4.4 Campaign

Fields:

- name
- objective
- description
- status
- audienceSegmentId
- audienceFiltersSnapshot
- templateId
- selectedProvinces
- selectedCategories
- recipientCount
- eligibleRecipientCount
- scheduledAt
- createdBy
- approvedBy
- approvedAt
- startedAt
- completedAt
- timestamps

Statuses:

- DRAFT
- PENDING_APPROVAL
- APPROVED
- SCHEDULED
- QUEUED
- SENDING
- COMPLETED
- CANCELLED
- FAILED

Store an immutable snapshot of the campaign's audience criteria at the appropriate workflow stage so the campaign's intended targeting can be audited later.

### 4.5 Campaign Recipient

Use a separate collection for recipient-level tracking rather than embedding thousands of recipient records inside a campaign document.

Fields:

- campaignId
- outletId
- phoneNumberSnapshot
- templateId
- status
- providerMessageId
- attemptedAt
- sentAt
- deliveredAt
- readAt
- failedAt
- failureCode
- failureReason
- timestamps

Use indexes for campaignId, outletId, status, and providerMessageId.

Prevent duplicate recipient jobs for the same campaign where appropriate.

### 4.6 Message Template

Fields:

- name
- category
- language
- content or template metadata
- variables
- providerTemplateId
- approvalStatus
- createdBy
- updatedBy
- timestamps

Approval states:

- DRAFT
- PENDING
- APPROVED
- REJECTED
- DISABLED

Distinguish locally drafted content from templates approved by the WhatsApp provider.

### 4.7 Additional Models

Implement where appropriate:

- AuditLog
- ImportJob
- ApplicationSetting
- RefreshToken or session model, depending on the chosen authentication strategy

Use pagination or separate collections for high-volume data.

---

## 5. REST API Design

Use the versioned prefix:

`/api/v1`

Return consistent JSON responses and appropriate HTTP status codes.

### 5.1 Authentication

Implement:

- POST `/auth/login`
- POST `/auth/refresh`
- POST `/auth/logout`
- GET `/auth/me`
- POST `/auth/change-password`

Requirements:

- Validate every request with Zod.
- Apply rate limiting to authentication endpoints.
- Use short-lived access tokens if using JWT.
- Securely manage refresh tokens, preferably using rotation and revocation.
- Store refresh credentials in appropriately secured, HTTP-only cookies when the architecture supports cookies.
- Never place secrets in frontend code.
- Protect all private routes.
- Do not implement public self-registration unless explicitly required.

Seed an initial administrator through a controlled script or secure setup procedure.

### 5.2 Outlets

Implement:

- GET `/outlets`
- GET `/outlets/:id`
- POST `/outlets`
- PATCH `/outlets/:id`
- DELETE `/outlets/:id`
- POST `/outlets/bulk`
- GET `/outlets/export`
- GET `/outlets/import/template`
- POST `/outlets/import/preview`
- POST `/outlets/import/commit`

The listing endpoint must support:

- Search
- Province filter
- District filter
- Category filter
- Consent filter
- Eligibility filter
- Data-quality filter
- Sorting by approved fields
- Page number
- Page size

Example:

`GET /api/v1/outlets?province=Vientiane%20Capital&category=ON_TRADE&page=1&limit=25`

Return paginated results containing:

- Data
- Page
- Limit
- Total records
- Total pages

Do not expose unbounded list endpoints.

For CSV imports:

- Validate headers.
- Validate individual rows.
- Normalize phone numbers.
- Detect duplicates.
- Return row-level validation errors.
- Provide an import preview before committing.
- Track import counts for successful, skipped, and invalid records.
- Prevent unauthorized mass updates.
- Process large imports in batches.

Never silently discard invalid rows or overwrite existing records without a clear policy.

### 5.3 Audience Segments

Implement:

- GET `/segments`
- GET `/segments/:id`
- POST `/segments`
- PATCH `/segments/:id`
- DELETE `/segments/:id`
- POST `/segments/preview`
- GET `/segments/:id/recipients`

The preview endpoint should calculate:

- Matching outlets
- Eligible marketing contacts
- Contacts with missing or invalid phone numbers
- Contacts without confirmed marketing consent
- Excluded contacts

The actual recipient list must apply all required consent and eligibility checks on the server.

Use safe, whitelisted MongoDB filter construction. Never execute client-provided MongoDB operators or arbitrary query objects.

### 5.4 Campaigns

Implement:

- GET `/campaigns`
- GET `/campaigns/:id`
- POST `/campaigns`
- PATCH `/campaigns/:id`
- POST `/campaigns/:id/preview`
- POST `/campaigns/:id/submit`
- POST `/campaigns/:id/approve`
- POST `/campaigns/:id/schedule`
- POST `/campaigns/:id/cancel`
- POST `/campaigns/:id/send`
- POST `/campaigns/:id/duplicate`
- GET `/campaigns/:id/recipients`
- GET `/campaigns/:id/report`

Enforce valid state transitions.

Examples:

- Draft campaigns can be edited.
- Campaigns requiring approval cannot be sent before approval.
- Cancelled campaigns cannot be sent.
- Completed campaigns cannot be edited as though they were drafts.
- Only authorized roles can approve or send campaigns.

Before scheduling or sending:

1. Validate campaign details.
2. Resolve the audience using server-side filters.
3. Check marketing consent and current contact eligibility.
4. Validate template approval and messaging requirements.
5. Calculate the final eligible recipient count.
6. Show a final preview and any warnings.
7. Create campaign recipient jobs safely.
8. Dispatch jobs only when the configured provider integration is active.

Support idempotency for campaign creation and dispatch operations where appropriate. Repeated requests must not unintentionally send duplicate messages.

### 5.5 Message Templates

Implement:

- GET `/templates`
- GET `/templates/:id`
- POST `/templates`
- PATCH `/templates/:id`
- DELETE `/templates/:id`
- POST `/templates/:id/submit-for-approval`
- POST `/templates/:id/refresh-status`

Validate template variables and required metadata.

Do not mark a template approved unless that status has been confirmed by the configured provider or authorized administrative process.

### 5.6 Reports

Implement:

- GET `/reports/overview`
- GET `/reports/campaign-performance`
- GET `/reports/province-performance`
- GET `/reports/category-performance`
- GET `/reports/message-failures`
- GET `/reports/export`

Support:

- Date range
- Campaign
- Province
- Outlet category

Calculate metrics using persisted campaign and recipient data.

Distinguish attempted, sent, delivered, read, and failed counts. Do not treat queued messages as sent or count the same message multiple times.

Use MongoDB aggregation pipelines where appropriate and ensure the required indexes exist.

### 5.7 Users and Settings

Implement:

- GET `/users`
- POST `/users`
- PATCH `/users/:id`
- PATCH `/users/:id/status`
- GET `/settings`
- PATCH `/settings`
- GET `/audit-logs`

Enforce role permissions for user administration, settings changes, approvals, exports, and audit access.

Never allow an administrator to accidentally deactivate the only active administrator without a safe recovery process.

---

## 6. WhatsApp Integration Architecture

Prepare a provider abstraction for the official WhatsApp Business Platform.

Example interface:

- sendTemplateMessage()
- getTemplateStatus()
- validateWebhook()
- processWebhookEvent()
- getProviderHealth()

Keep provider-specific HTTP calls out of campaign controllers.

Use a service boundary such as:

`WhatsAppProvider → CampaignService → RecipientQueue`

Requirements:

- Use approved message templates where required.
- Respect WhatsApp's current business messaging and consent policies.
- Track provider message IDs.
- Process delivery, read, and failure webhook events.
- Verify webhook authenticity.
- Deduplicate webhook events.
- Handle API errors, rate limits, timeouts, and retryable failures.
- Use exponential backoff for retryable failures.
- Avoid retrying permanent failures indefinitely.
- Never send marketing messages to opted-out contacts.
- Recheck eligibility immediately before dispatch.
- Record audit information for campaign sends and administrative changes.

Do not use unofficial WhatsApp Web automation.

If provider credentials are absent, use a mock provider in development and clearly label the integration as simulated.

Never report successful real-world delivery from a mock provider.

---

## 7. Background Jobs and Scheduling

Design campaign dispatch so a large campaign does not block an Express request.

Use a job queue such as BullMQ with Redis if the deployment environment supports it.

Background jobs should handle:

- CSV import processing.
- Audience snapshot creation.
- Campaign recipient preparation.
- Scheduled campaign dispatch.
- WhatsApp message sending.
- Retryable failures.
- Webhook event processing.
- Report generation for large datasets.

Use separate worker processes where appropriate.

Requirements:

- Idempotent job handling.
- Controlled concurrency.
- Provider rate-limit compliance.
- Job retry policies.
- Dead-letter or failed-job handling.
- Job progress tracking.
- Cancellation for jobs that have not yet been dispatched.

Do not introduce Redis solely for a small prototype if it adds unnecessary setup complexity. However, document the production queue architecture and avoid designing the system around synchronous bulk sending.

---

## 8. Security Requirements

Implement:

- Helmet security headers.
- Explicit CORS origin allowlist.
- Authentication and role-based authorization.
- Zod validation for all external input.
- Rate limiting.
- Safe MongoDB query construction.
- Request body size limits.
- Secure password hashing.
- Protected configuration and secrets.
- Redaction of passwords, tokens, and sensitive contact data in logs.
- Audit logging for important administrative actions.
- Pagination and limits for exports and listings.
- Safe error responses without stack traces in production.
- Protection against unauthorized data exports.
- Safe CSV generation to prevent spreadsheet formula injection.
- Protection against CSV import abuse.
- Webhook signature verification.
- Controlled handling of personal data and consent records.

Use transactions where needed and supported by the MongoDB deployment, particularly for multi-step operations that require consistency.

Do not assume Mongoose validation alone prevents all injection or authorization vulnerabilities.

---

## 9. Zod Validation Standards

Create reusable schemas for:

- Environment variables.
- Login credentials.
- Outlet create and update requests.
- Outlet filters and pagination.
- CSV import records.
- Segment creation and filters.
- Campaign creation and state transitions.
- Message templates.
- User administration.
- Report filters.
- Settings.

Requirements:

- Infer TypeScript types from Zod schemas where practical.
- Reject unexpected or unsupported input fields where appropriate.
- Validate ObjectId route parameters.
- Validate enums.
- Enforce string length limits.
- Normalize email addresses and phone numbers.
- Validate dates and date ranges.
- Allowlist sort fields and sort directions.
- Return readable validation errors with field paths.
- Never trust client-supplied recipient counts or campaign metrics.

Use a reusable validation middleware that parses request bodies, query parameters, and route parameters before the controller runs.

---

## 10. API Response and Error Format

Use a consistent response structure.

Successful response:

{
"success": true,
"data": {},
"meta": {
"page": 1,
"limit": 25,
"total": 100,
"totalPages": 4
}
}

Error response:

{
"success": false,
"error": {
"code": "VALIDATION_ERROR",
"message": "Please check the submitted information.",
"details": []
}
}

Use appropriate status codes, including:

- 200 for successful reads and updates.
- 201 for resource creation.
- 204 when a successful response intentionally has no body.
- 400 for invalid requests.
- 401 for unauthenticated requests.
- 403 for insufficient permissions.
- 404 for missing resources.
- 409 for duplicate or conflicting operations.
- 422 for validation failures, if consistently adopted.
- 429 for rate limits.
- 500 for unexpected server errors.

Do not expose stack traces, database internals, or secrets in production responses.

---

## 11. Environment Configuration

Create a validated `.env.example` containing placeholders for:

NODE_ENV=
PORT=
API_PREFIX=
MONGODB_URI=
FRONTEND_URL=
ACCESS_TOKEN_SECRET=
REFRESH_TOKEN_SECRET=
ACCESS_TOKEN_TTL=
REFRESH_TOKEN_TTL=
WHATSAPP_PROVIDER=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=
REDIS_URL=

Include only the variables required by the chosen implementation and document optional integration variables.

Validate environment variables with Zod at startup.

Fail fast with a clear configuration error when a required variable is missing. Never commit real credentials.

Do not expose server-only environment variables through Next.js public environment variables.

---

## 12. Frontend Integration

Ensure the API is easy for the existing Next.js frontend to consume.

Requirements:

- JSON REST endpoints.
- Consistent response types.
- Predictable pagination.
- Field-level validation errors.
- Appropriate HTTP status codes.
- CORS configuration for the frontend origin.
- A documented authentication flow.
- Stable route names and request schemas.

Provide a typed API contract or OpenAPI specification if practical.

Create example request and response payloads for:

- Listing outlets.
- Creating an outlet.
- Previewing a segment.
- Creating a campaign.
- Scheduling a campaign.
- Retrieving campaign reports.

Keep the API independent of frontend component implementation.

---

## 13. Testing Requirements

Write unit and integration tests for:

- Zod validation.
- Authentication.
- Authorization.
- Outlet CRUD.
- Duplicate contact handling.
- Pagination and filtering.
- CSV import validation.
- Audience segment preview.
- Consent and eligibility enforcement.
- Campaign state transitions.
- Approval workflow.
- Duplicate dispatch prevention.
- Report aggregation.
- Webhook verification and deduplication.

Test that opted-out contacts are never included in marketing dispatch jobs.

Test that unapproved templates cannot be sent when approval is required.

Test that repeated dispatch requests do not create duplicate sends.

Use isolated test databases or an appropriate MongoDB test setup. Never run destructive tests against production data.

---

## 14. Seed Data and Local Development

Create a seed script that generates:

- An initial administrator through a controlled setup process.
- Sample Lao provinces and districts.
- Outlet records with On-Trade and Off-Trade categories.
- Different consent and eligibility states.
- Sample audience segments.
- Draft and completed campaigns.
- Sample message templates.
- Simulated campaign recipient results.

Use obviously fictional contact details for demo data. Do not use real customer phone numbers or real credentials.

Include npm scripts for:

- Development.
- Build.
- Production start.
- Type checking.
- Linting.
- Testing.
- Database seeding.

Document local setup, MongoDB configuration, environment variables, and API usage in README.md.

---

## 15. Implementation Order

Build incrementally in this order.

### Phase 1 — Backend Foundation

1. Inspect the repository and existing frontend API requirements.
2. Set up Express, TypeScript, and environment validation.
3. Connect MongoDB.
4. Configure logging, error handling, CORS, and security middleware.
5. Implement shared Zod validation middleware.
6. Establish a consistent API response format.

### Phase 2 — Core Business APIs

7. Authentication and authorization.
8. Outlet management and search.
9. CSV import and export.
10. Audience segmentation.
11. Campaign CRUD and lifecycle.
12. Message templates.

### Phase 3 — Marketing Operations

13. Campaign recipient preparation.
14. Mock WhatsApp provider.
15. Background job and scheduling integration.
16. Campaign reporting.
17. Audit logs and administrative settings.

### Phase 4 — Production Preparation

18. Official WhatsApp Business Platform integration.
19. Webhook verification and delivery status tracking.
20. Security and authorization tests.
21. Performance checks and database index review.
22. Deployment documentation and operational monitoring.

Do not implement the entire backend in one giant file. Complete each module, test it, and then proceed to the next.

---

## 16. Definition of Done

The backend is ready for frontend integration when:

- The Express server starts successfully.
- MongoDB connects and models are created.
- Environment variables are validated at startup.
- All implemented endpoints have Zod validation.
- Authentication and role permissions work.
- Outlet CRUD, search, filtering, and pagination work.
- CSV import provides row-level validation feedback.
- Audience segmentation returns server-calculated counts.
- Campaign lifecycle and approval rules are enforced.
- Marketing consent and eligibility are checked server-side.
- Campaign recipient records can be created without unintended duplicates.
- Reports use persisted data or clearly identified mock data.
- WhatsApp mock mode never claims to send real messages.
- Tests cover the core business rules.
- The README explains how to run and test the backend.
- The frontend can integrate using documented REST endpoints.

**Begin by inspecting the repository and implementing Phase 1, then continue with the core business APIs. Prioritize correctness, security, clear module boundaries, and integration with the existing Next.js frontend.**
