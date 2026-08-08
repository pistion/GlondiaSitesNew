ALTER TABLE "provider_payables" ADD COLUMN "provider_service_reference" TEXT;
CREATE INDEX "provider_payables_provider_provider_service_reference_idx"
ON "provider_payables"("provider", "provider_service_reference");

ALTER TABLE "invoices" ADD COLUMN "settlement_status" TEXT NOT NULL DEFAULT 'not_ready';
