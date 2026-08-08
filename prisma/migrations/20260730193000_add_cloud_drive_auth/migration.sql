CREATE TABLE "cloud_drive_credentials" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "service_id" TEXT NOT NULL,
  "user_id" TEXT,
  "account_email" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "initial_password_ciphertext" TEXT,
  "initial_password_viewed_at" DATETIME,
  "password_version" INTEGER NOT NULL DEFAULT 1,
  "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false,
  "two_factor_method" TEXT,
  "last_login_at" DATETIME,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL,
  CONSTRAINT "cloud_drive_credentials_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "cloud_storage_services" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "cloud_drive_credentials_service_id_key" ON "cloud_drive_credentials"("service_id");
CREATE INDEX "cloud_drive_credentials_user_id_idx" ON "cloud_drive_credentials"("user_id");

CREATE TABLE "cloud_drive_sessions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "service_id" TEXT NOT NULL,
  "user_id" TEXT,
  "token_hash" TEXT NOT NULL,
  "expires_at" DATETIME NOT NULL,
  "last_used_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" DATETIME,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cloud_drive_sessions_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "cloud_storage_services" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "cloud_drive_sessions_token_hash_key" ON "cloud_drive_sessions"("token_hash");
CREATE INDEX "cloud_drive_sessions_service_id_expires_at_idx" ON "cloud_drive_sessions"("service_id", "expires_at");
CREATE INDEX "cloud_drive_sessions_user_id_idx" ON "cloud_drive_sessions"("user_id");
