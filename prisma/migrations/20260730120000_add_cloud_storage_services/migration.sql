CREATE TABLE "cloud_storage_services" (
  "id" TEXT NOT NULL PRIMARY KEY, "organization_id" TEXT NOT NULL, "created_by_user_id" TEXT,
  "checkout_order_id" TEXT, "name" TEXT NOT NULL, "service_kind" TEXT NOT NULL, "tenancy" TEXT NOT NULL,
  "plan_key" TEXT NOT NULL, "plan_size" TEXT NOT NULL, "region" TEXT NOT NULL, "postgres_version" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'vultr', "provider_resource_id" TEXT, "provider_secondary_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending_payment', "provisioning_stage" TEXT NOT NULL DEFAULT 'intent_recorded',
  "sync_status" TEXT NOT NULL DEFAULT 'pending', "admin_status" TEXT NOT NULL DEFAULT 'allowed',
  "payment_status" TEXT NOT NULL DEFAULT 'pending', "capacity_bytes" TEXT NOT NULL DEFAULT '0',
  "transfer_included_bytes" TEXT NOT NULL DEFAULT '0', "storage_used_bytes" TEXT NOT NULL DEFAULT '0',
  "transfer_used_bytes" TEXT NOT NULL DEFAULT '0', "overage_storage_bytes" TEXT NOT NULL DEFAULT '0',
  "overage_transfer_bytes" TEXT NOT NULL DEFAULT '0', "monthly_cost_cents" INTEGER NOT NULL DEFAULT 0,
  "markup_percent" REAL NOT NULL DEFAULT 30, "markup_amount_cents" INTEGER NOT NULL DEFAULT 0,
  "total_price_cents" INTEGER NOT NULL DEFAULT 0, "currency" TEXT NOT NULL DEFAULT 'USD',
  "deployment_branch" TEXT NOT NULL DEFAULT 'main', "public_access" BOOLEAN NOT NULL DEFAULT false,
  "cors_origins" TEXT NOT NULL DEFAULT '[]', "trusted_networks" TEXT NOT NULL DEFAULT '[]',
  "retention_daily" INTEGER NOT NULL DEFAULT 7, "retention_weekly" INTEGER NOT NULL DEFAULT 4,
  "credentials_ciphertext" TEXT, "credentials_preview" TEXT, "last_synced_at" DATETIME,
  "paid_at" DATETIME, "activated_at" DATETIME, "suspended_at" DATETIME, "deleted_at" DATETIME,
  "metadata" TEXT NOT NULL DEFAULT '{}', "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "cloud_storage_services_org_kind_idx" ON "cloud_storage_services"("organization_id", "service_kind");
CREATE INDEX "cloud_storage_services_user_idx" ON "cloud_storage_services"("created_by_user_id");
CREATE INDEX "cloud_storage_services_order_idx" ON "cloud_storage_services"("checkout_order_id");
CREATE INDEX "cloud_storage_services_provider_idx" ON "cloud_storage_services"("provider_resource_id");
CREATE INDEX "cloud_storage_services_status_idx" ON "cloud_storage_services"("status", "payment_status");

CREATE TABLE "cloud_storage_catalog_snapshots" (
  "id" TEXT NOT NULL PRIMARY KEY, "catalog_key" TEXT NOT NULL, "payload" TEXT NOT NULL,
  "sync_status" TEXT NOT NULL DEFAULT 'seeded', "error_message" TEXT, "last_synced_at" DATETIME,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "cloud_storage_catalog_key_key" ON "cloud_storage_catalog_snapshots"("catalog_key");

CREATE TABLE "cloud_storage_action_logs" (
  "id" TEXT NOT NULL PRIMARY KEY, "service_id" TEXT NOT NULL, "organization_id" TEXT NOT NULL,
  "actor_user_id" TEXT, "action" TEXT NOT NULL, "stage" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending',
  "request" TEXT NOT NULL DEFAULT '{}', "response" TEXT NOT NULL DEFAULT '{}', "error_message" TEXT,
  "provider_request_id" TEXT, "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_storage_action_service_fkey" FOREIGN KEY ("service_id") REFERENCES "cloud_storage_services"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "cloud_storage_action_service_idx" ON "cloud_storage_action_logs"("service_id", "created_at");
CREATE INDEX "cloud_storage_action_org_idx" ON "cloud_storage_action_logs"("organization_id", "created_at");

CREATE TABLE "cloud_storage_usage_samples" (
  "id" TEXT NOT NULL PRIMARY KEY, "service_id" TEXT NOT NULL, "period_key" TEXT NOT NULL,
  "storage_bytes" TEXT NOT NULL DEFAULT '0', "transfer_bytes" TEXT NOT NULL DEFAULT '0',
  "request_count" INTEGER NOT NULL DEFAULT 0, "overage_amount_cents" INTEGER NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL DEFAULT 'provider', "provider_payload" TEXT, "sampled_at" DATETIME NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_storage_usage_service_fkey" FOREIGN KEY ("service_id") REFERENCES "cloud_storage_services"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "cloud_storage_usage_unique" ON "cloud_storage_usage_samples"("service_id", "period_key", "sampled_at");
CREATE INDEX "cloud_storage_usage_service_idx" ON "cloud_storage_usage_samples"("service_id", "sampled_at");

CREATE TABLE "cloud_storage_restore_points" (
  "id" TEXT NOT NULL PRIMARY KEY, "service_id" TEXT NOT NULL, "provider_snapshot_id" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'daily', "status" TEXT NOT NULL DEFAULT 'available',
  "size_bytes" TEXT NOT NULL DEFAULT '0', "expires_at" DATETIME, "restored_at" DATETIME,
  "metadata" TEXT NOT NULL DEFAULT '{}', "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_storage_restore_service_fkey" FOREIGN KEY ("service_id") REFERENCES "cloud_storage_services"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "cloud_storage_restore_service_idx" ON "cloud_storage_restore_points"("service_id", "created_at");

CREATE TABLE "cloud_storage_objects" (
  "id" TEXT NOT NULL PRIMARY KEY, "service_id" TEXT NOT NULL, "object_key" TEXT NOT NULL,
  "display_name" TEXT NOT NULL, "content_type" TEXT, "size_bytes" TEXT NOT NULL DEFAULT '0',
  "version" INTEGER NOT NULL DEFAULT 1, "status" TEXT NOT NULL DEFAULT 'active', "checksum" TEXT,
  "deleted_at" DATETIME, "metadata" TEXT NOT NULL DEFAULT '{}', "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_storage_object_service_fkey" FOREIGN KEY ("service_id") REFERENCES "cloud_storage_services"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "cloud_storage_object_version_key" ON "cloud_storage_objects"("service_id", "object_key", "version");
CREATE INDEX "cloud_storage_object_status_idx" ON "cloud_storage_objects"("service_id", "status");

CREATE TABLE "cloud_storage_repository_links" (
  "id" TEXT NOT NULL PRIMARY KEY, "service_id" TEXT NOT NULL, "hosting_service_id" TEXT,
  "repository_name" TEXT NOT NULL, "deployment_branch" TEXT NOT NULL DEFAULT 'main',
  "webhook_secret_hash" TEXT NOT NULL, "last_delivery_id" TEXT, "last_commit_sha" TEXT,
  "last_deployment_id" TEXT, "auto_deploy_enabled" BOOLEAN NOT NULL DEFAULT true,
  "metadata" TEXT NOT NULL DEFAULT '{}', "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_storage_repo_service_fkey" FOREIGN KEY ("service_id") REFERENCES "cloud_storage_services"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "cloud_storage_repo_name_key" ON "cloud_storage_repository_links"("service_id", "repository_name");
CREATE INDEX "cloud_storage_repo_hosting_idx" ON "cloud_storage_repository_links"("hosting_service_id");
