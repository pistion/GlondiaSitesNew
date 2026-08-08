ALTER TABLE "billing_ledger" ADD COLUMN "classification" TEXT NOT NULL DEFAULT 'charge';
ALTER TABLE "billing_ledger" ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'recorded';
ALTER TABLE "billing_ledger" ADD COLUMN "invoice_line_item_id" TEXT;
ALTER TABLE "billing_ledger" ADD COLUMN "provider_amount_cents" INTEGER;
ALTER TABLE "billing_ledger" ADD COLUMN "markup_percent" REAL NOT NULL DEFAULT 0;
ALTER TABLE "billing_ledger" ADD COLUMN "markup_amount_cents" INTEGER NOT NULL DEFAULT 0;

UPDATE "billing_ledger"
SET "classification" = CASE
  WHEN "billing_type" = 'usage' THEN 'usage_charge'
  WHEN "billing_type" = 'invoice' THEN 'invoice'
  WHEN "billing_type" = 'payment' AND "status" = 'failed' THEN 'payment_attempt'
  WHEN "billing_type" = 'payment' THEN 'payment'
  WHEN "billing_type" = 'refund' THEN 'refund'
  WHEN "billing_type" IN ('credit', 'adjustment') THEN "billing_type"
  ELSE 'charge'
END,
"stage" = CASE
  WHEN "billing_type" = 'usage' AND "status" = 'accruing' THEN 'metered'
  WHEN "billing_type" = 'usage' AND "status" = 'invoiced' THEN 'invoiced'
  WHEN "billing_type" = 'usage' THEN 'rated'
  WHEN "billing_type" = 'invoice' THEN 'invoiced'
  WHEN "billing_type" = 'payment' AND "status" = 'failed' THEN 'payment_failed'
  WHEN "billing_type" = 'payment' AND "status" = 'paid' THEN 'paid'
  WHEN "billing_type" = 'payment' THEN 'payment_pending'
  WHEN "billing_type" = 'refund' THEN 'refunded'
  ELSE 'recorded'
END;

CREATE INDEX "billing_ledger_invoice_line_item_id_idx" ON "billing_ledger"("invoice_line_item_id");
CREATE INDEX "billing_ledger_classification_stage_idx" ON "billing_ledger"("classification", "stage");

ALTER TABLE "billing_usage_records" ADD COLUMN "charge_category" TEXT NOT NULL DEFAULT 'usage';
ALTER TABLE "billing_usage_records" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'platform';
ALTER TABLE "billing_usage_records" ADD COLUMN "provider_rate_id" TEXT;
ALTER TABLE "billing_usage_records" ADD COLUMN "provider_usage_id" TEXT;
ALTER TABLE "billing_usage_records" ADD COLUMN "pricing_model" TEXT NOT NULL DEFAULT 'metered';
ALTER TABLE "billing_usage_records" ADD COLUMN "pricing_source" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "billing_usage_records" ADD COLUMN "provider_unit_cost_micros" INTEGER;
ALTER TABLE "billing_usage_records" ADD COLUMN "markup_percent" REAL NOT NULL DEFAULT 0;
ALTER TABLE "billing_usage_records" ADD COLUMN "markup_unit_cost_micros" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "billing_usage_records" ADD COLUMN "customer_unit_cost_micros" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "billing_usage_records" ADD COLUMN "provider_amount_cents" INTEGER;
ALTER TABLE "billing_usage_records" ADD COLUMN "markup_amount_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "billing_usage_records" ADD COLUMN "customer_amount_cents" INTEGER NOT NULL DEFAULT 0;

UPDATE "billing_usage_records"
SET "provider" = "source",
    "customer_unit_cost_micros" = "unit_cost_micros",
    "customer_amount_cents" = "amount_cents",
    "pricing_source" = 'legacy';

CREATE INDEX "billing_usage_records_service_type_charge_category_meter_idx"
  ON "billing_usage_records"("service_type", "charge_category", "meter");
CREATE INDEX "billing_usage_records_provider_provider_usage_id_idx"
  ON "billing_usage_records"("provider", "provider_usage_id");

ALTER TABLE "payment_transactions" ADD COLUMN "payment_stage" TEXT NOT NULL DEFAULT 'attempt';
ALTER TABLE "payment_transactions" ADD COLUMN "attempt_number" INTEGER NOT NULL DEFAULT 1;
UPDATE "payment_transactions"
SET "payment_stage" = CASE
  WHEN "transaction_type" = 'refund' THEN 'refund'
  WHEN "status" = 'failed' THEN 'failure'
  WHEN "status" = 'completed' THEN 'settlement'
  ELSE 'attempt'
END;
CREATE INDEX "payment_transactions_payment_stage_status_created_at_idx"
  ON "payment_transactions"("payment_stage", "status", "created_at");

ALTER TABLE "invoices" ADD COLUMN "credits_cents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "invoice_line_items" ADD COLUMN "line_classification" TEXT NOT NULL DEFAULT 'usage_charge';
ALTER TABLE "invoice_line_items" ADD COLUMN "adjustment_type" TEXT;
ALTER TABLE "invoice_line_items" ADD COLUMN "direction" TEXT NOT NULL DEFAULT 'debit';
ALTER TABLE "invoice_line_items" ADD COLUMN "source_table" TEXT;
ALTER TABLE "invoice_line_items" ADD COLUMN "source_id" TEXT;
ALTER TABLE "invoice_line_items" ADD COLUMN "provider_amount_cents" INTEGER;
ALTER TABLE "invoice_line_items" ADD COLUMN "markup_percent" REAL NOT NULL DEFAULT 0;
ALTER TABLE "invoice_line_items" ADD COLUMN "markup_amount_cents" INTEGER NOT NULL DEFAULT 0;

UPDATE "invoice_line_items"
SET "source_table" = CASE WHEN "usage_record_id" IS NULL THEN NULL ELSE 'billing_usage_records' END,
    "source_id" = "usage_record_id",
    "line_classification" = CASE WHEN "usage_record_id" IS NULL THEN 'one_time_charge' ELSE 'usage_charge' END;

CREATE INDEX "invoice_line_items_line_classification_direction_idx"
  ON "invoice_line_items"("line_classification", "direction");
CREATE INDEX "invoice_line_items_source_table_source_id_idx"
  ON "invoice_line_items"("source_table", "source_id");
