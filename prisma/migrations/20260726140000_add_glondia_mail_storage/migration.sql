CREATE TABLE "mail_folders" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "email_mailbox_id" TEXT NOT NULL,
  "provider_folder_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "role" TEXT,
  "uid_validity" TEXT,
  "last_synced_at" DATETIME,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mail_folders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mail_folders_email_mailbox_id_fkey" FOREIGN KEY ("email_mailbox_id") REFERENCES "email_mailboxes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "mail_folders_email_mailbox_id_provider_folder_id_key" ON "mail_folders"("email_mailbox_id", "provider_folder_id");
CREATE INDEX "mail_folders_user_id_organization_id_idx" ON "mail_folders"("user_id", "organization_id");
CREATE INDEX "mail_folders_email_mailbox_id_role_idx" ON "mail_folders"("email_mailbox_id", "role");

CREATE TABLE "mail_messages" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "email_mailbox_id" TEXT NOT NULL,
  "folder_id" TEXT NOT NULL,
  "provider_message_id" TEXT NOT NULL,
  "internet_message_id" TEXT,
  "subject" TEXT NOT NULL DEFAULT '',
  "from_json" TEXT NOT NULL DEFAULT '[]',
  "to_json" TEXT NOT NULL DEFAULT '[]',
  "cc_json" TEXT NOT NULL DEFAULT '[]',
  "reply_to_json" TEXT NOT NULL DEFAULT '[]',
  "text_body" TEXT NOT NULL DEFAULT '',
  "html_body" TEXT NOT NULL DEFAULT '',
  "flags_json" TEXT NOT NULL DEFAULT '[]',
  "sent_at" DATETIME,
  "received_at" DATETIME,
  "size_bytes" INTEGER NOT NULL DEFAULT 0,
  "has_attachments" BOOLEAN NOT NULL DEFAULT false,
  "imported_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mail_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mail_messages_email_mailbox_id_fkey" FOREIGN KEY ("email_mailbox_id") REFERENCES "email_mailboxes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mail_messages_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "mail_folders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "mail_messages_folder_id_provider_message_id_key" ON "mail_messages"("folder_id", "provider_message_id");
CREATE INDEX "mail_messages_user_id_email_mailbox_id_received_at_idx" ON "mail_messages"("user_id", "email_mailbox_id", "received_at");
CREATE INDEX "mail_messages_email_mailbox_id_folder_id_idx" ON "mail_messages"("email_mailbox_id", "folder_id");

CREATE TABLE "mail_attachments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "message_id" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL DEFAULT 0,
  "content" BLOB,
  "content_id" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mail_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "mail_messages" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "mail_attachments_message_id_idx" ON "mail_attachments"("message_id");
