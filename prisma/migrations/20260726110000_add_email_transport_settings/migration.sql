CREATE TABLE "email_transport_settings" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "email_mailbox_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "imap_host" TEXT NOT NULL,
  "imap_port" INTEGER NOT NULL,
  "imap_security" TEXT NOT NULL DEFAULT 'SSL/TLS',
  "smtp_host" TEXT NOT NULL,
  "smtp_port" INTEGER NOT NULL,
  "smtp_security" TEXT NOT NULL DEFAULT 'SSL/TLS',
  "authentication_required" BOOLEAN NOT NULL DEFAULT true,
  "source" TEXT NOT NULL DEFAULT 'provider_catalog',
  "last_synced_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_transport_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "email_transport_settings_email_mailbox_id_fkey" FOREIGN KEY ("email_mailbox_id") REFERENCES "email_mailboxes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "email_transport_settings_email_mailbox_id_key" ON "email_transport_settings"("email_mailbox_id");
CREATE INDEX "email_transport_settings_user_id_organization_id_idx" ON "email_transport_settings"("user_id", "organization_id");
CREATE INDEX "email_transport_settings_provider_idx" ON "email_transport_settings"("provider");
