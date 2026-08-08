ALTER TABLE "client_projects" ADD COLUMN "storage_namespace" TEXT NOT NULL DEFAULT '';
ALTER TABLE "client_projects" ADD COLUMN "auto_billing_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "client_projects" ADD COLUMN "billing_amount" DECIMAL NOT NULL DEFAULT 0;
ALTER TABLE "client_projects" ADD COLUMN "billing_currency" TEXT NOT NULL DEFAULT 'PGK';
ALTER TABLE "client_projects" ADD COLUMN "billing_interval" TEXT NOT NULL DEFAULT 'monthly';

UPDATE "client_projects"
SET "storage_namespace" = 'clients/' || COALESCE("client_id", 'unassigned') || '/projects/' || "id"
WHERE "storage_namespace" = '';

ALTER TABLE "vps_services" ADD COLUMN "client_project_id" TEXT;
ALTER TABLE "web_hosting_services" ADD COLUMN "client_project_id" TEXT;
ALTER TABLE "cloud_storage_services" ADD COLUMN "client_project_id" TEXT;
ALTER TABLE "business_services" ADD COLUMN "client_project_id" TEXT;
ALTER TABLE "domain_addon_services" ADD COLUMN "client_project_id" TEXT;
ALTER TABLE "email_mailboxes" ADD COLUMN "client_project_id" TEXT;
ALTER TABLE "service_access" ADD COLUMN "client_project_id" TEXT;

CREATE INDEX "vps_services_client_project_id_idx" ON "vps_services"("client_project_id");
CREATE INDEX "web_hosting_services_client_project_id_idx" ON "web_hosting_services"("client_project_id");
CREATE INDEX "cloud_storage_services_client_project_id_idx" ON "cloud_storage_services"("client_project_id");
CREATE INDEX "business_services_client_project_id_idx" ON "business_services"("client_project_id");
CREATE INDEX "domain_addon_services_client_project_id_idx" ON "domain_addon_services"("client_project_id");
CREATE INDEX "email_mailboxes_client_project_id_idx" ON "email_mailboxes"("client_project_id");
CREATE INDEX "service_access_client_project_id_idx" ON "service_access"("client_project_id");
