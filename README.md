# HealthyStudy Intranet Microservice

Reusable NestJS + PostgreSQL microservice powering Intranet modules (`Weather`, `Lost & Found`, `Media Upload Auth`, and future campus services) for **HealthyStudy / CourseBazaar** and any external project via REST API.

## Port & Core Endpoints

- Default port: `3004` (`PORT` in `.env`)
- Swagger UI / OpenAPI JSON: `http://localhost:3004/docs` and `/docs-json`
- Healthcheck: `GET /health`
- Weather:
  - Forecast (up to 16 days + past days, `hourlyByDate`, Air Quality): `GET /weather?lat=41.2995&lon=69.2401&city=Tashkent&days=16&pastDays=1`
  - Monthly outlook: `GET /weather/monthly?lat=41.2995&lon=69.2401&city=Tashkent`
  - Geocoding search: `GET /weather/search?q=Samarkand&lang=uz&count=6`
- Lost & Found:
  - List / Filter: `GET /lost-found?organizationId=...&type=found|lost&branchId=...&category=...&search=...`
  - Stats KPI: `GET /lost-found/stats?organizationId=...`
  - Item detail: `GET /lost-found/:id`
  - Create item (+ instant Smart Match): `POST /lost-found`
  - Update item: `PATCH /lost-found/:id`
  - Submit proof claim: `POST /lost-found/:id/claims`
  - Reception moderation queue: `GET /lost-found/admin/queue?organizationId=...`
  - Approve / Reject claim: `PATCH /lost-found/claims/:claimId/resolve`
  - Handover audit log (`returned`): `PATCH /lost-found/:id/return`
  - Archive / Delete: `PATCH /lost-found/:id/archive`, `DELETE /lost-found/:id`
- Media Upload Auth:
  - Signed ImageKit params: `GET /media/upload-auth`

## Multi-Project REST API Authentication

This service isolates tenants by `(tenant_key, organization_id)` and supports:

1. **Bearer JWT / Cookie (`Authorization: Bearer <token>`)** — verifies HealthyStudy / compatible JWT tokens (`JWT_SECRET`).
2. **External API Key (`x-api-key`)** — configure `EXTERNAL_API_KEYS=my_key:my_project_tenant` in `.env`.
   - Optional forwarded user context headers for external BFF servers: `x-organization-id`, `x-user-id`, `x-user-name`, `x-user-role` (`admin` or `user`), `x-user-phone`.
3. **Internal Service Secret (`x-internal-secret`)** — trusted server-to-server calls (`INTERNAL_SERVICE_SECRET`).
4. **Webhooks** — set `WEBHOOK_URL` and `WEBHOOK_SECRET` in `.env` to receive signed (`x-intranet-signature`) JSON notifications on `LOST_FOUND_SMART_MATCH`, `LOST_FOUND_CLAIM_SUBMITTED`, `LOST_FOUND_CLAIM_APPROVED`, `LOST_FOUND_CLAIM_REJECTED`, and `LOST_FOUND_ITEM_RETURNED`.

## Database

- PostgreSQL database: `healthystudy_intranet_db` (or `DATABASE_URL` in `.env`).
- Entities auto-create `lost_found_items` and `lost_found_claims` via TypeORM when `DB_SYNCHRONIZE=true` (and `DB_AUTO_CREATE=true` creates the database on local Postgres automatically if missing).

## Local Commands

```bash
pnpm install
pnpm run start:dev
pnpm test
pnpm run build
```

## Docker Deployment

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f intranet-service
docker compose down
```
