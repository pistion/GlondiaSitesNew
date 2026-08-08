# Glondia domain protection provisioning

The customer browser only creates a Glondia add-on request. It never calls an
infrastructure provider. The database is the queue, evidence store, billing
record, and customer-facing confirmation source.

## Stage 1 — Save the request

`requestCustomerCloudflareAddon()` verifies ownership and writes:

- a queued `domain_addon_services` row;
- an `addon:<addonId>` evidence snapshot with `record_request`;
- the selected feature, customer, organization, domain, and queue timestamp.

Only after both writes succeed does the API return `202 queued`. A backend task
then calls `processCustomerDomainAddon()`.

## Stage 2 — Obtain and save assigned nameservers

The worker creates or reuses the zone because assigned nameservers do not exist
until the zone exists. It saves the exact assigned nameservers in
`domain_service_snapshots` before attempting a registrar change.

## Stage 3 — Read database evidence and update nameservers

The worker reads the assigned nameservers back from the snapshot. It refuses to
continue unless at least two stored nameservers exist. The registrar update uses
only that stored evidence:

```json
{
  "provider": "custom",
  "hosts": ["<stored-nameserver-1>", "<stored-nameserver-2>"]
}
```

The registrar response and delegation timestamp are then saved to the snapshot.

## Stage 4 — Save billing evidence

Every add-on has its own `domain_addon_services` billing columns and ledger row.
Provider cost, Glondia adjustment, customer total, invoice, payment transaction,
renewal, and lifecycle status remain separate.

The currently implemented baseline controls are included features:

- Bot control maps to baseline Bot Fight Mode.
- Anti-scraping maps to Block AI Bots/content-bot baseline controls.

Their verified included provider cost is recorded as zero. Super Bot Fight Mode,
bot scoring, granular exceptions, and Enterprise Bot Management must be offered
as different paid Glondia products and are not silently enabled by these rows.

For a charged service, the worker stops at `payment_required`. The database
retains provider cost, the 30% Glondia margin, and customer total separately.
The combined invoice creates the customer charge and a provider payable. A paid
invoice updates the add-on with its transaction reference and automatically
resumes provisioning. Zero-cost controls skip checkout and remain exactly zero.

The customer checkout endpoints are:

- `POST /api/payments/domain-addon/create-order`
- `POST /api/payments/domain-addon/capture`

Order creation accepts only an owned `awaiting_payment` add-on with a positive
provider and customer amount. It creates the PayPal cart, immutable invoice,
invoice line, provider payable, and add-on links together. Capture records the
payment transaction and resumes the stored provisioning job.

## Stage 5 — Request delegation verification

Only a stored registrar confirmation can advance the snapshot to
`request_activation_check`. The worker persists the domain/zone mapping and
requests an authoritative nameserver check. Follow-up checks run after 30
seconds, 2 minutes, and 5 minutes; the normal domain scheduler is the restart
recovery path.

## Stage 6 — Enable and confirm

Protection configuration is sent only when synchronized zone state is `active`.
The response is saved, the add-on becomes `active`, and the activation timestamp
is recorded. Failures become `provisioning_failed`; the UI reads that database
state instead of an upstream response.

## Review commands

```powershell
npm run db:validate
npm run lint
node --test --test-concurrency=1 server/test/cloudflarePricing.test.js server/test/domainTenancy.integration.test.js
npm run build
```
