# Hosting service ownership — database-first architecture

Canonical note for the client-separated, DB-first service ownership model as it
applies to **hosting** (Render-backed). VPS (Vultr) is the reference
implementation; hosting is being brought onto the same model in stages. This
document is the short architecture note referenced by the code.

## The contract

```
Client / User
  → ServiceAccess            (central customer-facing service index)
    → local service record   (WebHostingService — the source of truth)
      → provider adapter      (renderApiService — the ONLY way to reach Render)
        → provider response
          → local DB update   (record + access + audit)
            → dashboard reads local DB
```

- **The database is the source of truth for the dashboard.** Provider APIs
  (Render, Vultr, PayPal, Spaceship…) are sources of **reconciliation only**.
- Provider calls happen during controlled command flows, webhooks, explicit
  sync, or scheduled reconciliation — **never** inline with a customer read as
  the authority, and **never inside a DB transaction**.
- After a provider call succeeds, the returned provider IDs/statuses are
  recorded in the DB and linked to the exact client-owned local record.

### Core rules (enforced by the code below)

1. Never show another client's provider resources to a user.
2. Never treat scanned provider inventory as customer-owned unless it maps to a
   local record or an explicit `ProviderResource` row.
3. Never delete local DB history because a provider record is missing.
4. Provider missing ⇒ mark the local record `provider_missing` / `review_required`.
5. Provider success + DB failure ⇒ compensation + admin warning, never silent loss.
6. `ServiceAccess` decides whether a customer can manage a service.
7. The dashboard reads `ServiceAccess` + local service rows.
8. Admin views may show drift warnings; customers see only their owned services.
9. Payment/webhook/capture update `CheckoutOrder` + local record + `ServiceAccess`
   + audit log, idempotently.
10. Provider calls stay outside DB transactions.

## Canonical lifecycle (`status`)

`pending` → `provisioning`/`building` → `live` · `failed`/`error` ·
`provider_missing` · `destroy_pending` → `destroyed` · `review_required`.

Soft delete only (`deletedAt` + `status = destroyed`) — history is preserved.

## Relationships

| Concern | Model |
| --- | --- |
| Client identity | `User` |
| Provider-level scope | `organizationId` |
| Customer access index | `ServiceAccess` (`serviceType`, `serviceId`) |
| Render hosting record | `WebHostingService` |
| Vultr VPS record | `VpsService` |
| Account-level provider objects | `ProviderResource` |
| Billing | `CheckoutOrder` / `PaymentReceipt` / `DeploymentSubscription` |
| Actions / corrections | `AuditLog` / `AdminCommand` |

**Stable hosting identity:** the public route id is `deploymentId`. Backfill
pins `WebHostingService.id` **and** `ServiceAccess.serviceId` to it, so the
route id, the DB row, and the access row line up.

## Code map (hosting)

| Layer | File | Role |
| --- | --- | --- |
| Repository | `server/src/repositories/hosting.repository.js` | Canonical `WebHostingService` Prisma access + transaction bundles (`createPendingBundle`, `activateProvisionedBundle`, `markProvisionFailedBundle`, `finalizeDestroyBundle`, `markHostingPaid`, `markProviderMissing`). |
| Provisioning | `server/src/services/hostingProvisioningService.js` | DB-first create sequence: pending record+access → Render (outside txn) → activate/fail/skip → compensation. Provider call is injectable. |
| ZIP deploy | `…/pipelines/base64ZipToRender.pipeline.js` | Live ZIP path: creates the canonical record through `createHostingService` with the Render create+trigger as the injected provider fn; store write is a tagged mirror. |
| Reads | `server/src/services/hostingReadService.js` | DB-first customer list, throttled Render sync, legacy `hostingStore` merged as fallback with `source`/`drift` tags. |
| Sync | `server/src/services/hostingSyncService.js` | Reconciles **only known** local rows against Render; `provider_missing` on 404, never deletes; per-org throttle. |
| Routes | `server/src/routes/hostingRoutes.js` | Ownership + transitional `requireServiceAccessOrLegacy('hosting', …)`. |
| Payment | `server/src/services/deploymentBillingService.js` → `hostingRepo.markHostingPaid` | Idempotent DB payment sync on capture/webhook. |
| Backfill | `server/src/services/hostingRelationshipRepairService.js` + `scripts/backfill-hosting.mjs` | Promote `hostingStore` deployments → `WebHostingService` + `ServiceAccess`; never auto-claims imported provider services. |
| Oversight | `server/src/services/serviceDriftWarnings.js` | `PAYMENT_ACCESS_MISMATCH`, `PROVIDER_MISSING`, `SERVICE_OWNER_SCOPE_MISMATCH` over resolved DTOs. |

## Completed write-path wiring

The live write/mutation paths now go through the DB-first ownership layer:

- **ZIP deploy create** — `base64ZipToRender.pipeline.deployZipSite` records the
  canonical `WebHostingService` (id === deploymentId) **and** a pending
  `ServiceAccess` via `hostingProvisioningService.createHostingService` **before**
  any Render call. The Render create+trigger is the injected provider function —
  the pipeline no longer calls `renderApiService.createService` directly. The
  `hostingStore` write is a mirror tagged `legacyMirror: true` /
  `mirrorOf: 'web_hosting_service'` / `canonicalServiceId`.
- **Delete** — `hostingService.delete` now soft-deletes the canonical row via
  `hostingRepo.finalizeDestroyBundle` on confirmed provider removal (or when the
  service was never provisioned), and on a provider delete **failure** keeps the
  row, marks it `destroy_failed`, and raises an admin notification. The DB row is
  never purged. The store mirror is purged only on confirmed destroy.
- **Sync** — a Render-gone (404/410) during sync marks the DB row
  `provider_missing` (never destroyed); `hostingSyncService` does the same for
  the reconciliation path.
- **Suspend / resume** — mirror provider status onto the DB row (best-effort).
- **Payment** — `deploymentBillingService.markDeploymentPaid` →
  `hostingRepo.markHostingPaid` (idempotent). A missing relational row is logged
  as a repair flag (`npm run backfill:hosting`), never silently treated complete.

## Remaining legacy `hostingStore` (JSON) dependencies

The JSON store at `DATA_DIR/render-hosting.json` is **transitional cache**, not
authoritative. Still reading/writing it:

1. **`zipToRender.pipeline.js` `run()`** — the *other* ZIP intake path (via
   `zipDeployPipeline.middleware.js`) still creates records through
   `deploymentRecordStore` (store), not `hostingProvisioningService`. It should
   be wired the same way `base64ZipToRender.pipeline.js` now is. Highest-priority
   remaining item.
2. **`hostingService.js`** — settings/build/source/env/domain/disk and
   redeploy/restart still write the store as authority (delete + suspend/resume
   now mirror to the DB). Move these onto `hostingRepo.updateProviderState` /
   `mergeMetadata` next.
3. **`deploymentOwnership.middleware.js`** — reads the store to enforce
   ownership. Retire once every deployment has a `ServiceAccess` row, then flip
   `requireServiceAccessOrLegacy` → `requireServiceAccess` (see the migration
   guard in `routes/hostingRoutes.js`).
4. **`deploymentCleanupService.js`** — scans store deployments (local records,
   not Render inventory ✔) but should read `WebHostingService` once every
   creation path is DB-first.
5. **`adminCustomerOversightService.js`** — dual-reads store + DB and reports
   `HOSTING_DUAL_SOURCE_MISMATCH`. Keep until the store is retired.
6. **`hostingReadService.js`** — intentionally merges the store as fallback; the
   last step is to stop consulting it once backfill + DB-first writes are proven.

### Retirement order

Backfill (done) → DB-first reads (done) → DB-first create via
`base64ZipToRender` + delete/suspend/resume (done) → wire `zipToRender.run()`
and remaining mutations → route enforcement flip → drop `hostingStore` reads →
remove the store.
