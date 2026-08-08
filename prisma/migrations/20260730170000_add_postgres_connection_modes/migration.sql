ALTER TABLE "cloud_storage_services" ADD COLUMN "external_access_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "cloud_storage_services" ADD COLUMN "private_network_attached" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "cloud_storage_services" ADD COLUMN "provisioning_secret_ciphertext" TEXT;
