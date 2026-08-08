CREATE TABLE "provider_payables" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT,
    "organization_id" TEXT,
    "provider" TEXT NOT NULL,
    "service_type" TEXT NOT NULL,
    "service_id" TEXT,
    "invoice_id" TEXT,
    "invoice_line_item_id" TEXT,
    "usage_record_id" TEXT,
    "provider_reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'recorded',
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "funded_by_transaction_id" TEXT,
    "due_at" DATETIME,
    "settled_at" DATETIME,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "provider_payables_invoice_line_item_id_key" ON "provider_payables"("invoice_line_item_id");
CREATE INDEX "provider_payables_provider_status_due_at_idx" ON "provider_payables"("provider", "status", "due_at");
CREATE INDEX "provider_payables_invoice_id_idx" ON "provider_payables"("invoice_id");
CREATE INDEX "provider_payables_service_type_service_id_idx" ON "provider_payables"("service_type", "service_id");
CREATE INDEX "provider_payables_funded_by_transaction_id_idx" ON "provider_payables"("funded_by_transaction_id");

CREATE TABLE "provider_settlements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "provider_transaction_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "failure_code" TEXT,
    "failure_message" TEXT,
    "processed_at" DATETIME,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "provider_settlements_provider_provider_transaction_id_key"
ON "provider_settlements"("provider", "provider_transaction_id");
CREATE INDEX "provider_settlements_provider_status_created_at_idx"
ON "provider_settlements"("provider", "status", "created_at");

CREATE TABLE "settlement_allocations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider_settlement_id" TEXT NOT NULL,
    "provider_payable_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "settlement_allocations_provider_settlement_id_provider_payable_id_key"
ON "settlement_allocations"("provider_settlement_id", "provider_payable_id");
CREATE INDEX "settlement_allocations_provider_payable_id_idx"
ON "settlement_allocations"("provider_payable_id");
