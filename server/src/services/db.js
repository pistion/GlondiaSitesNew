import { PrismaClient } from '@prisma/client';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import dotenv from 'dotenv';

// Prisma reads env("DATABASE_URL") when the client is instantiated. Because ESM
// imports run before server.js body code, load env here as the DB module boots.
dotenv.config({ path: '.env.local' });
dotenv.config();

if (!process.env.DATABASE_URL && process.env.NODE_ENV !== 'production') {
  process.env.DATABASE_URL = 'file:./prisma/dev.db';
  console.warn('[db] DATABASE_URL was not set; using local SQLite fallback file:./prisma/dev.db.');
}

function ensureSqliteUrl(url) {
  if (!url || !url.startsWith('file:')) return url;
  if (url.startsWith('file:///') || url.startsWith('file://')) return url;
  const path = url.slice('file:'.length);
  if (path.startsWith('/')) return `file://${path}`;
  return url;
}

function ensureDbDir(url) {
  if (!url || !url.startsWith('file:')) return;
  try {
    const path = url
      .replace(/^file:\/\/\//, '/')
      .replace(/^file:\/\//, '')
      .replace(/^file:\//, '/')
      .replace(/^file:/, '')
      .split('?')[0];
    const dir = dirname(path);
    if (dir && dir !== '.' && dir !== '/') mkdirSync(dir, { recursive: true });
  } catch { /* Prisma will surface the real error */ }
}

const rawUrl = process.env.DATABASE_URL;
const normalizedUrl = ensureSqliteUrl(rawUrl);
if (normalizedUrl && normalizedUrl !== rawUrl) {
  process.env.DATABASE_URL = normalizedUrl;
  console.log('[db] DATABASE_URL normalized for runtime safety.');
}
ensureDbDir(process.env.DATABASE_URL);

const globalForPrisma = globalThis;
const slowQueryMs = Number(process.env.PRISMA_SLOW_QUERY_MS || 200);
const logQueries = String(process.env.PRISMA_LOG_QUERIES || 'false').toLowerCase() === 'true';

// NOTE: prisma.$use() was removed in Prisma 5. Soft-delete filtering is done
// explicitly in each route query (where: { deletedAt: null }).
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'stdout', level: 'warn' },
      { emit: 'stdout', level: 'error' },
    ],
  });

prisma.$on('query', (event) => {
  if (logQueries) console.debug(`[db:query] ${event.duration}ms ${event.query}`);
  if (event.duration >= slowQueryMs) console.warn(`[db:slow-query] ${event.duration}ms ${event.query}`);
});

export async function connectPrisma() {
  await prisma.$connect();
}

/**
 * Self-heal additive columns on the `users` table.
 *
 * The project is push-based (no migration files) and `db:push` only runs as a
 * manual script — not on boot, and the `prisma` CLI is a devDependency so it
 * cannot run in production. If the live DB predates a schema change, the Prisma
 * client expects columns the table lacks and EVERY user query throws (500s on
 * login/me/profile/billing/admin). This adds any missing columns idempotently
 * via SQLite `ALTER TABLE ADD COLUMN` so the running DB matches the schema.
 *
 * Only additive, nullable/defaulted columns — never drops or alters existing
 * data. No-op on non-SQLite datasources.
 */
export async function ensureUserColumns() {
  const url = process.env.DATABASE_URL || '';
  if (!url.startsWith('file:')) return; // SQLite only

  // Column name (snake_case, matching @map) → SQLite definition.
  const desired = [
    ['phone', 'TEXT'],
    ['profile_details', "TEXT NOT NULL DEFAULT '{}'"],
    ['id_photo_path', 'TEXT'],
    ['account_status', "TEXT NOT NULL DEFAULT 'active'"],
    ['disabled_at', 'DATETIME'],
    ['disabled_reason', 'TEXT'],
    ['deleted_at', 'DATETIME'],
    ['reactivated_at', 'DATETIME'],
    ['avatar_path', 'TEXT'],
    ['client_id', 'TEXT'],
    ['signup_ip', 'TEXT'],
  ];

  try {
    const rows = await prisma.$queryRawUnsafe(`PRAGMA table_info('users')`);
    if (!Array.isArray(rows) || rows.length === 0) return; // table not created yet (fresh DB → db:push handles it)
    const have = new Set(rows.map((r) => r.name));
    const added = [];
    for (const [name, def] of desired) {
      if (have.has(name)) continue;
      try {
        await prisma.$executeRawUnsafe(`ALTER TABLE "users" ADD COLUMN "${name}" ${def}`);
        added.push(name);
      } catch (err) {
        console.error(`[db] Failed to add users.${name}:`, err.message);
      }
    }
    if (added.length) console.log(`[db] Self-healed missing users columns: ${added.join(', ')}`);
    // Unique client reference (glondiac-XXXX). Index name matches Prisma's default.
    try {
      await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "users_client_id_key" ON "users"("client_id")`);
    } catch (err) {
      console.error('[db] Failed to create users.client_id unique index:', err.message);
    }
  } catch (err) {
    console.error('[db] ensureUserColumns failed:', err.message);
  }
}

/**
 * Create the `notifications` table if it doesn't exist (same push-based reason
 * as ensureUserColumns). Idempotent. SQLite only.
 */
export async function ensureNotificationsTable() {
  const url = process.env.DATABASE_URL || '';
  if (!url.startsWith('file:')) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "notifications" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "user_id" TEXT,
        "audience" TEXT NOT NULL DEFAULT 'user',
        "type" TEXT NOT NULL DEFAULT 'info',
        "title" TEXT NOT NULL,
        "message" TEXT NOT NULL,
        "action_url" TEXT,
        "entity_type" TEXT,
        "entity_id" TEXT,
        "metadata" TEXT NOT NULL DEFAULT '{}',
        "read_at" DATETIME,
        "deleted_at" DATETIME,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "notifications_user_id_read_at_idx" ON "notifications" ("user_id", "read_at")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "notifications_audience_created_at_idx" ON "notifications" ("audience", "created_at")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "notifications_type_created_at_idx" ON "notifications" ("type", "created_at")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "notifications_entity_type_entity_id_idx" ON "notifications" ("entity_type", "entity_id")`);
  } catch (err) {
    console.error('[db] ensureNotificationsTable failed:', err.message);
  }
}

/**
 * Create the `client_projects` table if it doesn't exist. Projects are the
 * parent container for customer work: hosting, domains, email, VPS, builds, and
 * consultations can all be grouped under one project id.
 */
export async function ensureClientProjectsTable() {
  const url = process.env.DATABASE_URL || '';
  if (!url.startsWith('file:')) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "client_projects" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "project_code" TEXT NOT NULL,
        "user_id" TEXT,
        "client_id" TEXT,
        "workspace_id" TEXT,
        "name" TEXT NOT NULL,
        "slug" TEXT NOT NULL,
        "service_type" TEXT NOT NULL DEFAULT 'website',
        "status" TEXT NOT NULL DEFAULT 'draft',
        "priority" TEXT NOT NULL DEFAULT 'normal',
        "description" TEXT,
        "storage_namespace" TEXT NOT NULL DEFAULT '',
        "auto_billing_enabled" BOOLEAN NOT NULL DEFAULT false,
        "billing_amount" DECIMAL NOT NULL DEFAULT 0,
        "billing_currency" TEXT NOT NULL DEFAULT 'PGK',
        "billing_interval" TEXT NOT NULL DEFAULT 'monthly',
        "metadata" TEXT NOT NULL DEFAULT '{}',
        "archived_at" DATETIME,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "client_projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      )
    `);
    const columns = await prisma.$queryRawUnsafe(`PRAGMA table_info("client_projects")`);
    const columnNames = new Set(columns.map((column) => column.name));
    const additions = [
      ['storage_namespace', `TEXT NOT NULL DEFAULT ''`],
      ['auto_billing_enabled', `BOOLEAN NOT NULL DEFAULT false`],
      ['billing_amount', `DECIMAL NOT NULL DEFAULT 0`],
      ['billing_currency', `TEXT NOT NULL DEFAULT 'PGK'`],
      ['billing_interval', `TEXT NOT NULL DEFAULT 'monthly'`],
    ];
    for (const [name, definition] of additions) {
      if (!columnNames.has(name)) await prisma.$executeRawUnsafe(`ALTER TABLE "client_projects" ADD COLUMN "${name}" ${definition}`);
    }
    await prisma.$executeRawUnsafe(`UPDATE "client_projects" SET "storage_namespace" = 'clients/' || COALESCE("client_id", 'unassigned') || '/projects/' || "id" WHERE "storage_namespace" = ''`);
    const projectLinkedTables = [
      'vps_services',
      'web_hosting_services',
      'cloud_storage_services',
      'business_services',
      'domain_addon_services',
      'email_mailboxes',
      'service_access',
    ];
    for (const table of projectLinkedTables) {
      const tableInfo = await prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`);
      if (!tableInfo.length || tableInfo.some((column) => column.name === 'client_project_id')) continue;
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "client_project_id" TEXT`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "${table}_client_project_id_idx" ON "${table}"("client_project_id")`);
    }
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "client_projects_project_code_key" ON "client_projects"("project_code")`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "client_projects_user_id_slug_key" ON "client_projects"("user_id", "slug")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "client_projects_user_id_service_type_idx" ON "client_projects"("user_id", "service_type")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "client_projects_client_id_idx" ON "client_projects"("client_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "client_projects_workspace_id_idx" ON "client_projects"("workspace_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "client_projects_status_created_at_idx" ON "client_projects"("status", "created_at")`);
  } catch (err) {
    console.error('[db] ensureClientProjectsTable failed:', err.message);
  }
}

/**
 * Create the `deployment_subscriptions` table if it doesn't exist (same
 * push-based reason as above). Without it, trial-subscription writes fail and
 * the deploy-first billing/cleanup timers can't run. Idempotent. SQLite only.
 */
export async function ensureDeploymentSubscriptionsTable() {
  const url = process.env.DATABASE_URL || '';
  if (!url.startsWith('file:')) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "deployment_subscriptions" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "deployment_id" TEXT NOT NULL UNIQUE,
        "user_id" TEXT,
        "checkout_order_id" TEXT,
        "status" TEXT NOT NULL DEFAULT 'trialing',
        "current_period_start" DATETIME,
        "current_period_end" DATETIME,
        "next_billing_at" DATETIME,
        "renewal_reminder_at" DATETIME,
        "last_paid_at" DATETIME,
        "renewal_count" INTEGER NOT NULL DEFAULT 0,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "deployment_subscriptions_user_id_idx" ON "deployment_subscriptions" ("user_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "deployment_subscriptions_status_idx" ON "deployment_subscriptions" ("status")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "deployment_subscriptions_next_billing_at_idx" ON "deployment_subscriptions" ("next_billing_at")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "deployment_subscriptions_renewal_reminder_at_idx" ON "deployment_subscriptions" ("renewal_reminder_at")`);
  } catch (err) {
    console.error('[db] ensureDeploymentSubscriptionsTable failed:', err.message);
  }
}

/**
 * Create the `payment_methods` table if it doesn't exist. Vaulted PayPal/card
 * references are required for saved-method checkout and recurring renewals.
 * Idempotent. SQLite only.
 */
export async function ensurePaymentMethodsTable() {
  const url = process.env.DATABASE_URL || '';
  if (!url.startsWith('file:')) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "payment_methods" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "user_id" TEXT,
        "organization_id" TEXT,
        "provider" TEXT NOT NULL,
        "provider_method_id" TEXT,
        "method_type" TEXT NOT NULL DEFAULT 'unknown',
        "brand" TEXT,
        "last4" TEXT,
        "expiry_month" INTEGER,
        "expiry_year" INTEGER,
        "is_default" BOOLEAN NOT NULL DEFAULT false,
        "status" TEXT NOT NULL DEFAULT 'active',
        "metadata" TEXT NOT NULL DEFAULT '{}',
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "payment_methods_user_id_idx" ON "payment_methods" ("user_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "payment_methods_organization_id_idx" ON "payment_methods" ("organization_id")`);
  } catch (err) {
    console.error('[db] ensurePaymentMethodsTable failed:', err.message);
  }
}

/**
 * Create the `service_requests` table if missing (CRM intake — not tickets).
 * Push-based deploy: schema changes may not run automatically in production.
 * Idempotent. SQLite only. Never drops data.
 */
/**
 * Unified billing ledger.
 *
 * One normalized billing surface for the three UI levels:
 * platform/account, service category, and unique billable item. Existing
 * source tables remain intact; this table mirrors enough identity and money
 * fields to query billing cleanly across hosting, VPS, domains, email, etc.
 */
export async function ensureBillingLedgerTable() {
  const url = process.env.DATABASE_URL || '';
  if (!url.startsWith('file:')) return;

  try {
    const existing = await prisma.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'billing_ledger' LIMIT 1`);
    if (Array.isArray(existing) && existing.length > 0) {
      const fks = await prisma.$queryRawUnsafe(`PRAGMA foreign_key_list('billing_ledger')`);
      const count = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS count FROM "billing_ledger"`);
      if (Array.isArray(fks) && fks.length > 0 && Number(count?.[0]?.count || 0) === 0) {
        await prisma.$executeRawUnsafe(`DROP TABLE "billing_ledger"`);
        console.log('[db] Recreated empty billing_ledger without legacy user FK.');
      }
    }

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "billing_ledger" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "user_id" TEXT,
        "organization_id" TEXT,
        "scope" TEXT NOT NULL DEFAULT 'item',
        "service_type" TEXT NOT NULL,
        "service_id" TEXT,
        "service_name" TEXT,
        "billing_type" TEXT NOT NULL,
        "classification" TEXT NOT NULL DEFAULT 'charge',
        "stage" TEXT NOT NULL DEFAULT 'recorded',
        "direction" TEXT NOT NULL DEFAULT 'debit',
        "source_table" TEXT,
        "source_id" TEXT,
        "checkout_order_id" TEXT,
        "invoice_id" TEXT,
        "payment_method_id" TEXT,
        "receipt_id" TEXT,
        "invoice_line_item_id" TEXT,
        "description" TEXT,
        "quantity" INTEGER NOT NULL DEFAULT 1,
        "unit_cents" INTEGER NOT NULL DEFAULT 0,
        "provider_amount_cents" INTEGER,
        "markup_percent" REAL NOT NULL DEFAULT 0,
        "markup_amount_cents" INTEGER NOT NULL DEFAULT 0,
        "amount_cents" INTEGER NOT NULL DEFAULT 0,
        "currency" TEXT NOT NULL DEFAULT 'USD',
        "status" TEXT NOT NULL DEFAULT 'pending',
        "period_start" DATETIME,
        "period_end" DATETIME,
        "due_at" DATETIME,
        "paid_at" DATETIME,
        "metadata" TEXT NOT NULL DEFAULT '{}',
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);

    const rows = await prisma.$queryRawUnsafe(`PRAGMA table_info('billing_ledger')`);
    const have = new Set((rows || []).map((r) => r.name));
    const desired = [
      ['organization_id', 'TEXT'],
      ['scope', "TEXT NOT NULL DEFAULT 'item'"],
      ['service_type', "TEXT NOT NULL DEFAULT 'other'"],
      ['service_id', 'TEXT'],
      ['service_name', 'TEXT'],
      ['billing_type', "TEXT NOT NULL DEFAULT 'charge'"],
      ['classification', "TEXT NOT NULL DEFAULT 'charge'"],
      ['stage', "TEXT NOT NULL DEFAULT 'recorded'"],
      ['direction', "TEXT NOT NULL DEFAULT 'debit'"],
      ['source_table', 'TEXT'],
      ['source_id', 'TEXT'],
      ['checkout_order_id', 'TEXT'],
      ['invoice_id', 'TEXT'],
      ['payment_method_id', 'TEXT'],
      ['receipt_id', 'TEXT'],
      ['invoice_line_item_id', 'TEXT'],
      ['description', 'TEXT'],
      ['quantity', 'INTEGER NOT NULL DEFAULT 1'],
      ['unit_cents', 'INTEGER NOT NULL DEFAULT 0'],
      ['provider_amount_cents', 'INTEGER'],
      ['markup_percent', 'REAL NOT NULL DEFAULT 0'],
      ['markup_amount_cents', 'INTEGER NOT NULL DEFAULT 0'],
      ['amount_cents', 'INTEGER NOT NULL DEFAULT 0'],
      ['currency', "TEXT NOT NULL DEFAULT 'USD'"],
      ['status', "TEXT NOT NULL DEFAULT 'pending'"],
      ['period_start', 'DATETIME'],
      ['period_end', 'DATETIME'],
      ['due_at', 'DATETIME'],
      ['paid_at', 'DATETIME'],
      ['metadata', "TEXT NOT NULL DEFAULT '{}'"],
      ['created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
      ['updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
    ];
    const added = [];
    for (const [name, def] of desired) {
      if (have.has(name)) continue;
      try {
        await prisma.$executeRawUnsafe(`ALTER TABLE "billing_ledger" ADD COLUMN "${name}" ${def}`);
        added.push(name);
      } catch (err) {
        console.error(`[db] Failed to add billing_ledger.${name}:`, err.message);
      }
    }
    if (added.length) console.log(`[db] Self-healed missing billing_ledger columns: ${added.join(', ')}`);

    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "billing_ledger_source_table_source_id_billing_type_key" ON "billing_ledger" ("source_table", "source_id", "billing_type")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "billing_ledger_user_id_created_at_idx" ON "billing_ledger" ("user_id", "created_at")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "billing_ledger_organization_id_created_at_idx" ON "billing_ledger" ("organization_id", "created_at")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "billing_ledger_scope_created_at_idx" ON "billing_ledger" ("scope", "created_at")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "billing_ledger_service_type_created_at_idx" ON "billing_ledger" ("service_type", "created_at")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "billing_ledger_service_type_service_id_created_at_idx" ON "billing_ledger" ("service_type", "service_id", "created_at")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "billing_ledger_checkout_order_id_idx" ON "billing_ledger" ("checkout_order_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "billing_ledger_invoice_id_idx" ON "billing_ledger" ("invoice_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "billing_ledger_invoice_line_item_id_idx" ON "billing_ledger" ("invoice_line_item_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "billing_ledger_classification_stage_idx" ON "billing_ledger" ("classification", "stage")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "billing_ledger_status_due_at_idx" ON "billing_ledger" ("status", "due_at")`);
    await prisma.$executeRawUnsafe(`UPDATE "billing_ledger" SET "service_type" = 'email' WHERE "service_type" = 'email_plan'`);

    await prisma.$executeRawUnsafe(`
      INSERT OR IGNORE INTO "billing_ledger" (
        "id", "user_id", "organization_id", "scope", "service_type", "service_id",
        "billing_type", "direction", "source_table", "source_id", "checkout_order_id",
        "description", "quantity", "unit_cents", "amount_cents", "currency", "status",
        "due_at", "paid_at", "metadata", "created_at", "updated_at"
      )
      SELECT lower(hex(randomblob(16))), o."user_id", o."organization_id", 'item',
        CASE WHEN o."type" = 'deployment' THEN 'hosting' WHEN o."type" = 'email_plan' THEN 'email' ELSE o."type" END,
        o."deployment_id", 'charge', 'debit', 'checkout_orders', o."id", o."id",
        CASE WHEN o."type" = 'deployment' THEN 'Hosting deployment charge' ELSE o."type" || ' charge' END,
        1, o."total_amount_cents", o."total_amount_cents", o."currency", o."status",
        o."due_at", o."paid_at", o."metadata", o."created_at", o."updated_at"
      FROM "checkout_orders" o
    `);
    await prisma.$executeRawUnsafe(`
      INSERT OR IGNORE INTO "billing_ledger" (
        "id", "user_id", "organization_id", "scope", "service_type", "service_id",
        "service_name", "billing_type", "direction", "source_table", "source_id",
        "checkout_order_id", "description", "quantity", "unit_cents", "amount_cents",
        "currency", "status", "metadata", "created_at", "updated_at"
      )
      SELECT lower(hex(randomblob(16))), v."created_by_user_id", v."organization_id", 'item',
        'vps', v."id", v."label", 'charge', 'debit', 'vps_services', v."id",
        v."checkout_order_id", 'VPS service charge', 1, v."total_price_cents",
        v."total_price_cents", v."currency",
        CASE WHEN v."payment_status" IN ('completed', 'active') THEN 'paid' ELSE v."payment_status" END,
        v."metadata", v."created_at", v."updated_at"
      FROM "vps_services" v
      WHERE v."deleted_at" IS NULL
    `);

    await prisma.$executeRawUnsafe(`
      INSERT OR IGNORE INTO "billing_ledger" (
        "id", "user_id", "organization_id", "scope", "service_type", "service_id",
        "service_name", "billing_type", "direction", "source_table", "source_id",
        "checkout_order_id", "description", "quantity", "unit_cents", "amount_cents",
        "currency", "status", "period_end", "due_at", "metadata", "created_at", "updated_at"
      )
      SELECT lower(hex(randomblob(16))), b."created_by_user_id", b."organization_id", 'item',
        b."type", b."id", b."name", 'charge', 'debit', 'business_services', b."id",
        b."checkout_order_id", b."type" || ' service charge', 1, b."total_price_cents",
        b."total_price_cents", b."currency",
        CASE WHEN b."payment_status" IN ('completed', 'active') THEN 'paid' ELSE b."payment_status" END,
        b."expires_at", b."renews_at", b."metadata", b."created_at", b."updated_at"
      FROM "business_services" b
      WHERE b."deleted_at" IS NULL
    `);
  } catch (err) {
    console.error('[db] ensureBillingLedgerTable failed:', err.message);
  }
}

export async function ensureBillingEvidenceTables() {
  const url = process.env.DATABASE_URL || '';
  if (!url.startsWith('file:')) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "billing_usage_records" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "user_id" TEXT,
        "organization_id" TEXT,
        "service_type" TEXT NOT NULL,
        "service_id" TEXT,
        "service_name" TEXT,
        "charge_category" TEXT NOT NULL DEFAULT 'usage',
        "meter" TEXT NOT NULL,
        "unit" TEXT NOT NULL,
        "quantity" REAL NOT NULL DEFAULT 0,
        "included_quantity" REAL NOT NULL DEFAULT 0,
        "billable_quantity" REAL NOT NULL DEFAULT 0,
        "provider" TEXT NOT NULL DEFAULT 'platform',
        "provider_rate_id" TEXT,
        "provider_usage_id" TEXT,
        "pricing_model" TEXT NOT NULL DEFAULT 'metered',
        "pricing_source" TEXT NOT NULL DEFAULT 'platform',
        "provider_unit_cost_micros" INTEGER,
        "markup_percent" REAL NOT NULL DEFAULT 0,
        "markup_unit_cost_micros" INTEGER NOT NULL DEFAULT 0,
        "customer_unit_cost_micros" INTEGER NOT NULL DEFAULT 0,
        "unit_cost_micros" INTEGER NOT NULL DEFAULT 0,
        "provider_amount_cents" INTEGER,
        "markup_amount_cents" INTEGER NOT NULL DEFAULT 0,
        "customer_amount_cents" INTEGER NOT NULL DEFAULT 0,
        "amount_cents" INTEGER NOT NULL DEFAULT 0,
        "currency" TEXT NOT NULL DEFAULT 'USD',
        "status" TEXT NOT NULL DEFAULT 'accruing',
        "source" TEXT NOT NULL DEFAULT 'platform',
        "source_record_id" TEXT,
        "period_start" DATETIME NOT NULL,
        "period_end" DATETIME NOT NULL,
        "metadata" TEXT NOT NULL DEFAULT '{}',
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
    const usageColumns = await prisma.$queryRawUnsafe(`PRAGMA table_info('billing_usage_records')`);
    const usageColumnNames = new Set((usageColumns || []).map((row) => row.name));
    for (const [name, definition] of [
      ['charge_category', "TEXT NOT NULL DEFAULT 'usage'"],
      ['provider', "TEXT NOT NULL DEFAULT 'platform'"],
      ['provider_rate_id', 'TEXT'],
      ['provider_usage_id', 'TEXT'],
      ['pricing_model', "TEXT NOT NULL DEFAULT 'metered'"],
      ['pricing_source', "TEXT NOT NULL DEFAULT 'legacy'"],
      ['provider_unit_cost_micros', 'INTEGER'],
      ['markup_percent', 'REAL NOT NULL DEFAULT 0'],
      ['markup_unit_cost_micros', 'INTEGER NOT NULL DEFAULT 0'],
      ['customer_unit_cost_micros', 'INTEGER NOT NULL DEFAULT 0'],
      ['provider_amount_cents', 'INTEGER'],
      ['markup_amount_cents', 'INTEGER NOT NULL DEFAULT 0'],
      ['customer_amount_cents', 'INTEGER NOT NULL DEFAULT 0'],
    ]) {
      if (!usageColumnNames.has(name)) {
        await prisma.$executeRawUnsafe(`ALTER TABLE "billing_usage_records" ADD COLUMN "${name}" ${definition}`);
      }
    }
    await prisma.$executeRawUnsafe(`
      UPDATE "billing_usage_records"
      SET "customer_unit_cost_micros" = "unit_cost_micros",
          "customer_amount_cents" = "amount_cents"
      WHERE "pricing_source" = 'legacy'
    `);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "billing_usage_records_service_type_service_id_meter_period_start_period_end_source_key" ON "billing_usage_records" ("service_type","service_id","meter","period_start","period_end","source")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "billing_usage_records_user_id_period_start_idx" ON "billing_usage_records" ("user_id","period_start")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "billing_usage_records_organization_id_period_start_idx" ON "billing_usage_records" ("organization_id","period_start")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "billing_usage_records_service_type_service_id_period_start_idx" ON "billing_usage_records" ("service_type","service_id","period_start")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "billing_usage_records_status_period_end_idx" ON "billing_usage_records" ("status","period_end")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "billing_usage_records_service_type_charge_category_meter_idx" ON "billing_usage_records" ("service_type","charge_category","meter")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "billing_usage_records_provider_provider_usage_id_idx" ON "billing_usage_records" ("provider","provider_usage_id")`);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "payment_transactions" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "user_id" TEXT,
        "organization_id" TEXT,
        "checkout_order_id" TEXT,
        "invoice_id" TEXT,
        "payment_method_id" TEXT,
        "receipt_id" TEXT,
        "service_type" TEXT,
        "service_id" TEXT,
        "transaction_type" TEXT NOT NULL DEFAULT 'payment',
        "payment_stage" TEXT NOT NULL DEFAULT 'attempt',
        "attempt_number" INTEGER NOT NULL DEFAULT 1,
        "provider" TEXT NOT NULL DEFAULT 'manual',
        "provider_transaction_id" TEXT,
        "status" TEXT NOT NULL DEFAULT 'pending',
        "amount_cents" INTEGER NOT NULL DEFAULT 0,
        "currency" TEXT NOT NULL DEFAULT 'USD',
        "failure_code" TEXT,
        "failure_message" TEXT,
        "processed_at" DATETIME,
        "metadata" TEXT NOT NULL DEFAULT '{}',
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
    const paymentColumns = await prisma.$queryRawUnsafe(`PRAGMA table_info('payment_transactions')`);
    const paymentColumnNames = new Set((paymentColumns || []).map((row) => row.name));
    for (const [name, definition] of [
      ['payment_stage', "TEXT NOT NULL DEFAULT 'attempt'"],
      ['attempt_number', 'INTEGER NOT NULL DEFAULT 1'],
    ]) {
      if (!paymentColumnNames.has(name)) {
        await prisma.$executeRawUnsafe(`ALTER TABLE "payment_transactions" ADD COLUMN "${name}" ${definition}`);
      }
    }
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "payment_transactions_provider_provider_transaction_id_transaction_type_key" ON "payment_transactions" ("provider","provider_transaction_id","transaction_type")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "payment_transactions_user_id_created_at_idx" ON "payment_transactions" ("user_id","created_at")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "payment_transactions_organization_id_created_at_idx" ON "payment_transactions" ("organization_id","created_at")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "payment_transactions_checkout_order_id_idx" ON "payment_transactions" ("checkout_order_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "payment_transactions_invoice_id_idx" ON "payment_transactions" ("invoice_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "payment_transactions_service_type_service_id_created_at_idx" ON "payment_transactions" ("service_type","service_id","created_at")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "payment_transactions_status_created_at_idx" ON "payment_transactions" ("status","created_at")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "payment_transactions_payment_stage_status_created_at_idx" ON "payment_transactions" ("payment_stage","status","created_at")`);

    const invoiceLineColumns = await prisma.$queryRawUnsafe(`PRAGMA table_info('invoice_line_items')`);
    const invoiceLineNames = new Set((invoiceLineColumns || []).map((row) => row.name));
    for (const [name, definition] of [
      ['service_type', 'TEXT'],
      ['service_id', 'TEXT'],
      ['usage_record_id', 'TEXT'],
      ['line_classification', "TEXT NOT NULL DEFAULT 'usage_charge'"],
      ['adjustment_type', 'TEXT'],
      ['direction', "TEXT NOT NULL DEFAULT 'debit'"],
      ['source_table', 'TEXT'],
      ['source_id', 'TEXT'],
      ['provider_amount_cents', 'INTEGER'],
      ['markup_percent', 'REAL NOT NULL DEFAULT 0'],
      ['markup_amount_cents', 'INTEGER NOT NULL DEFAULT 0'],
    ]) {
      if (!invoiceLineNames.has(name)) {
        await prisma.$executeRawUnsafe(`ALTER TABLE "invoice_line_items" ADD COLUMN "${name}" ${definition}`);
      }
    }
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "invoice_line_items_service_type_service_id_idx" ON "invoice_line_items" ("service_type","service_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "invoice_line_items_usage_record_id_idx" ON "invoice_line_items" ("usage_record_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "invoice_line_items_line_classification_direction_idx" ON "invoice_line_items" ("line_classification","direction")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "invoice_line_items_source_table_source_id_idx" ON "invoice_line_items" ("source_table","source_id")`);

    const invoiceColumns = await prisma.$queryRawUnsafe(`PRAGMA table_info('invoices')`);
    if (!(invoiceColumns || []).some((row) => row.name === 'credits_cents')) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "invoices" ADD COLUMN "credits_cents" INTEGER NOT NULL DEFAULT 0`);
    }

    // Backfill verified captures into the durable payment history.
    await prisma.$executeRawUnsafe(`
      INSERT OR IGNORE INTO "payment_transactions" (
        "id","user_id","organization_id","checkout_order_id","service_type","service_id",
        "transaction_type","provider","provider_transaction_id","status","amount_cents",
        "currency","processed_at","metadata","created_at","updated_at"
      )
      SELECT lower(hex(randomblob(16))), o."user_id", o."organization_id", o."id",
        CASE WHEN o."type" = 'deployment' THEN 'hosting' ELSE o."type" END,
        o."deployment_id", 'payment', o."provider", o."provider_capture_id", 'completed',
        o."total_amount_cents", o."currency", o."paid_at", o."metadata", o."created_at", o."updated_at"
      FROM "checkout_orders" o
      WHERE o."status" = 'paid' AND o."provider_capture_id" IS NOT NULL
    `);

    await prisma.$executeRawUnsafe(`
      INSERT OR IGNORE INTO "billing_usage_records" (
        "id","user_id","organization_id","service_type","service_id","meter","unit",
        "quantity","included_quantity","billable_quantity","unit_cost_micros",
        "amount_cents","currency","status","source","source_record_id","period_start",
        "period_end","metadata","created_at","updated_at"
      )
      SELECT lower(hex(randomblob(16))), h."created_by_user_id", h."organization_id",
        'hosting', h."deployment_id", 'bandwidth', 'MB', h."bandwidth_used_mb", 0,
        h."bandwidth_used_mb", 0, 0, 'USD', 'accruing', 'hosting_usage_summaries',
        h."id", h."created_at", h."updated_at", h."metadata", h."created_at", h."updated_at"
      FROM "hosting_usage_summaries" h
    `);
    await prisma.$executeRawUnsafe(`
      INSERT OR IGNORE INTO "billing_usage_records" (
        "id","user_id","organization_id","service_type","service_id","meter","unit",
        "quantity","included_quantity","billable_quantity","unit_cost_micros",
        "amount_cents","currency","status","source","source_record_id","period_start",
        "period_end","metadata","created_at","updated_at"
      )
      SELECT lower(hex(randomblob(16))), a."user_id", NULL, 'builder', a."project_id",
        'ai_tokens', 'token', a."prompt_tokens" + a."completion_tokens", 0,
        a."prompt_tokens" + a."completion_tokens", 0,
        CAST(ROUND(a."estimated_cost_micros" / 10000.0) AS INTEGER), 'USD',
        'finalized', 'ai_usage_events', a."id", a."created_at", a."created_at",
        a."metadata", a."created_at", a."created_at"
      FROM "ai_usage_events" a
    `);
    await prisma.$executeRawUnsafe(`
      UPDATE "billing_usage_records"
      SET "customer_unit_cost_micros" = "unit_cost_micros",
          "customer_amount_cents" = "amount_cents"
      WHERE ("customer_unit_cost_micros" = 0 AND "unit_cost_micros" <> 0)
         OR ("customer_amount_cents" = 0 AND "amount_cents" <> 0)
    `);

    await prisma.$executeRawUnsafe(`
      INSERT OR IGNORE INTO "billing_ledger" (
        "id","user_id","organization_id","scope","service_type","service_id",
        "service_name","billing_type","direction","source_table","source_id",
        "description","quantity","unit_cents","amount_cents","currency","status",
        "period_start","period_end","metadata","created_at","updated_at"
      )
      SELECT lower(hex(randomblob(16))), u."user_id", u."organization_id",
        CASE WHEN u."service_id" IS NULL THEN 'service' ELSE 'item' END,
        u."service_type", u."service_id", u."service_name", 'usage',
        CASE WHEN u."amount_cents" > 0 THEN 'debit' ELSE 'neutral' END,
        'billing_usage_records', u."id", u."meter" || ' usage',
        CAST(ROUND(u."billable_quantity") AS INTEGER),
        CAST(ROUND(u."unit_cost_micros" / 10000.0) AS INTEGER),
        u."amount_cents", u."currency", u."status", u."period_start", u."period_end",
        u."metadata", u."created_at", u."updated_at"
      FROM "billing_usage_records" u
    `);
    await prisma.$executeRawUnsafe(`
      INSERT OR IGNORE INTO "billing_ledger" (
        "id","user_id","organization_id","scope","service_type","service_id",
        "billing_type","direction","source_table","source_id","checkout_order_id",
        "invoice_id","payment_method_id","receipt_id","description","unit_cents",
        "amount_cents","currency","status","paid_at","metadata","created_at","updated_at"
      )
      SELECT lower(hex(randomblob(16))), p."user_id", p."organization_id",
        CASE WHEN p."service_id" IS NULL THEN 'service' ELSE 'item' END,
        COALESCE(p."service_type",'platform'), p."service_id",
        CASE WHEN p."transaction_type" = 'refund' THEN 'refund' ELSE 'payment' END,
        CASE WHEN p."transaction_type" = 'refund' THEN 'debit' ELSE 'credit' END,
        'payment_transactions', p."id", p."checkout_order_id", p."invoice_id",
        p."payment_method_id", p."receipt_id",
        CASE WHEN p."transaction_type" = 'refund' THEN 'Payment refund' ELSE 'Payment received' END,
        p."amount_cents", p."amount_cents", p."currency",
        CASE WHEN p."status" = 'completed' THEN 'paid' ELSE p."status" END,
        p."processed_at", p."metadata", p."created_at", p."updated_at"
      FROM "payment_transactions" p
    `);
    await prisma.$executeRawUnsafe(`
      INSERT OR IGNORE INTO "billing_ledger" (
        "id","user_id","organization_id","scope","service_type","billing_type",
        "direction","source_table","source_id","invoice_id","description","unit_cents",
        "amount_cents","currency","status","due_at","paid_at","metadata","created_at","updated_at"
      )
      SELECT lower(hex(randomblob(16))), i."user_id", i."organization_id", 'platform',
        'platform', 'invoice', 'neutral', 'invoices', i."id", i."id",
        'Invoice ' || i."invoice_number", i."total_cents", i."total_cents",
        i."currency", i."status", i."due_at", i."paid_at", i."metadata",
        i."created_at", i."updated_at"
      FROM "invoices" i
    `);
  } catch (err) {
    console.error('[db] ensureBillingEvidenceTables failed:', err.message);
  }
}

export async function ensureServiceRequestsTable() {
  const url = process.env.DATABASE_URL || '';
  if (!url.startsWith('file:')) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "service_requests" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "request_number" TEXT NOT NULL,
        "user_id" TEXT,
        "organization_id" TEXT,
        "source" TEXT NOT NULL DEFAULT 'public_form',
        "request_type" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'new',
        "priority" TEXT NOT NULL DEFAULT 'normal',
        "contact_name" TEXT NOT NULL,
        "contact_email" TEXT NOT NULL,
        "contact_phone" TEXT,
        "company_name" TEXT,
        "subject" TEXT NOT NULL,
        "description" TEXT NOT NULL,
        "budget_range" TEXT,
        "timeline" TEXT,
        "preferred_contact_method" TEXT,
        "assigned_admin_id" TEXT,
        "converted_lead_id" TEXT,
        "converted_ticket_id" TEXT,
        "metadata" TEXT NOT NULL DEFAULT '{}',
        "admin_notes" TEXT,
        "last_contacted_at" DATETIME,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "service_requests_request_number_key" ON "service_requests" ("request_number")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "service_requests_status_created_at_idx" ON "service_requests" ("status", "created_at")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "service_requests_request_type_created_at_idx" ON "service_requests" ("request_type", "created_at")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "service_requests_user_id_created_at_idx" ON "service_requests" ("user_id", "created_at")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "service_requests_assigned_admin_id_status_idx" ON "service_requests" ("assigned_admin_id", "status")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "service_requests_contact_email_idx" ON "service_requests" ("contact_email")`,
    );
  } catch (err) {
    console.error('[db] ensureServiceRequestsTable failed:', err.message);
  }
}

/**
 * CRM email lists + members (contact capture for admin CRM Email Lists).
 * Idempotent. SQLite only. Never drops data.
 */
export async function ensureCrmEmailTables() {
  const url = process.env.DATABASE_URL || '';
  if (!url.startsWith('file:')) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "crm_email_lists" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "list_type" TEXT NOT NULL DEFAULT 'general',
        "status" TEXT NOT NULL DEFAULT 'active',
        "metadata" TEXT NOT NULL DEFAULT '{}',
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "crm_email_list_members" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "email_list_id" TEXT NOT NULL,
        "user_id" TEXT,
        "email" TEXT NOT NULL,
        "name" TEXT,
        "status" TEXT NOT NULL DEFAULT 'subscribed',
        "subscribed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "unsubscribed_at" DATETIME,
        "metadata" TEXT NOT NULL DEFAULT '{}',
        CONSTRAINT "crm_email_list_members_email_list_id_fkey"
          FOREIGN KEY ("email_list_id") REFERENCES "crm_email_lists" ("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      )`);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "crm_email_list_members_email_list_id_email_key"
       ON "crm_email_list_members" ("email_list_id", "email")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "crm_email_list_members_user_id_idx"
       ON "crm_email_list_members" ("user_id")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "crm_email_list_members_email_list_id_idx"
       ON "crm_email_list_members" ("email_list_id")`,
    );
  } catch (err) {
    console.error('[db] ensureCrmEmailTables failed:', err.message);
  }
}

/**
 * Business Email mailbox records.
 *
 * The mailbox table is intentionally relational: every mailbox belongs to a
 * user/client (`user_id`) and points at the persisted `business_services` row
 * created for that mailbox (`business_service_id`). The selected mailbox plan
 * is stored as `plan_service_id` (`email-plan:<userId>`) so quota checks can
 * connect mailbox usage back to the customer's chosen email plan.
 *
 * Idempotent. SQLite only. Never drops data.
 */
export async function ensureEmailMailboxTables() {
  const url = process.env.DATABASE_URL || '';
  if (!url.startsWith('file:')) return;

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "email_mailboxes" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "user_id" TEXT NOT NULL,
        "plan_service_id" TEXT NOT NULL,
        "business_service_id" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "local_part" TEXT NOT NULL,
        "domain" TEXT NOT NULL,
        "password_hash" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'pending_setup',
        "storage_limit_bytes" TEXT NOT NULL DEFAULT '5368709120',
        "storage_used_bytes" TEXT NOT NULL DEFAULT '0',
        "usage_source" TEXT NOT NULL DEFAULT 'pending_provider',
        "last_usage_sync_at" DATETIME,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "email_mailboxes_user_id_fkey"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id")
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "email_mailboxes_business_service_id_fkey"
          FOREIGN KEY ("business_service_id") REFERENCES "business_services" ("id")
          ON DELETE RESTRICT ON UPDATE CASCADE
      )`);

    const rows = await prisma.$queryRawUnsafe(`PRAGMA table_info('email_mailboxes')`);
    if (Array.isArray(rows) && rows.length > 0) {
      const have = new Set(rows.map((r) => r.name));
      const desired = [
        ['storage_limit_bytes', "TEXT NOT NULL DEFAULT '5368709120'"],
        ['storage_used_bytes', "TEXT NOT NULL DEFAULT '0'"],
        ['usage_source', "TEXT NOT NULL DEFAULT 'pending_provider'"],
        ['last_usage_sync_at', 'DATETIME'],
      ];
      const added = [];
      for (const [name, def] of desired) {
        if (have.has(name)) continue;
        try {
          await prisma.$executeRawUnsafe(`ALTER TABLE "email_mailboxes" ADD COLUMN "${name}" ${def}`);
          added.push(name);
        } catch (err) {
          console.error(`[db] Failed to add email_mailboxes.${name}:`, err.message);
        }
      }
      if (added.length) console.log(`[db] Self-healed missing email_mailboxes columns: ${added.join(', ')}`);
    }

    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "email_mailboxes_business_service_id_key" ON "email_mailboxes" ("business_service_id")`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "email_mailboxes_email_key" ON "email_mailboxes" ("email")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "email_mailboxes_user_id_status_idx" ON "email_mailboxes" ("user_id", "status")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "email_mailboxes_plan_service_id_idx" ON "email_mailboxes" ("plan_service_id")`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "email_transport_settings" (
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
        CONSTRAINT "email_transport_settings_user_id_fkey"
          FOREIGN KEY ("user_id") REFERENCES "users" ("id")
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT "email_transport_settings_email_mailbox_id_fkey"
          FOREIGN KEY ("email_mailbox_id") REFERENCES "email_mailboxes" ("id")
          ON DELETE CASCADE ON UPDATE CASCADE
      )`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "email_transport_settings_email_mailbox_id_key" ON "email_transport_settings" ("email_mailbox_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "email_transport_settings_user_id_organization_id_idx" ON "email_transport_settings" ("user_id", "organization_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "email_transport_settings_provider_idx" ON "email_transport_settings" ("provider")`);
    await prisma.$executeRawUnsafe(`
      INSERT OR IGNORE INTO "email_transport_settings" (
        "id", "user_id", "organization_id", "email_mailbox_id", "provider", "username",
        "imap_host", "imap_port", "imap_security", "smtp_host", "smtp_port", "smtp_security",
        "authentication_required", "source", "last_synced_at", "created_at", "updated_at"
      )
      SELECT
        'transport:' || mailbox."id",
        mailbox."user_id",
        service."organization_id",
        mailbox."id",
        'spacemail',
        mailbox."email",
        'mail.spacemail.com',
        993,
        'SSL/TLS',
        'mail.spacemail.com',
        465,
        'SSL/TLS',
        true,
        'provider_catalog',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM "email_mailboxes" mailbox
      INNER JOIN "business_services" service ON service."id" = mailbox."business_service_id"
      WHERE lower(service."provider") IN ('spacemail', 'spaceship')
    `);
  } catch (err) {
    console.error('[db] ensureEmailMailboxTables failed:', err.message);
  }
}

/**
 * Self-heal additive columns on the ticket tables (same push-based reason as
 * ensureUserColumns): conversation bookkeeping on `tickets` and delivery
 * status on `ticket_messages`. Only additive, defaulted/nullable columns.
 * Idempotent. SQLite only.
 */
export async function ensureTicketColumns() {
  const url = process.env.DATABASE_URL || '';
  if (!url.startsWith('file:')) return;

  const tables = {
    tickets: [
      ['last_message_at', 'DATETIME'],
      ['last_customer_message_at', 'DATETIME'],
      ['last_admin_message_at', 'DATETIME'],
      ['unread_for_customer', 'INTEGER NOT NULL DEFAULT 0'],
      ['unread_for_admin', 'INTEGER NOT NULL DEFAULT 0'],
    ],
    ticket_messages: [
      ['status', "TEXT NOT NULL DEFAULT 'sent'"],
      ['seen_at', 'DATETIME'],
      ['replied_at', 'DATETIME'],
      ['edited_at', 'DATETIME'],
      ['deleted_at', 'DATETIME'],
    ],
  };

  try {
    for (const [table, columns] of Object.entries(tables)) {
      const rows = await prisma.$queryRawUnsafe(`PRAGMA table_info('${table}')`);
      if (!Array.isArray(rows) || rows.length === 0) continue; // fresh DB → db:push creates it
      const have = new Set(rows.map((r) => r.name));
      const added = [];
      for (const [name, def] of columns) {
        if (have.has(name)) continue;
        try {
          await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${name}" ${def}`);
          added.push(name);
        } catch (err) {
          console.error(`[db] Failed to add ${table}.${name}:`, err.message);
        }
      }
      if (added.length) console.log(`[db] Self-healed missing ${table} columns: ${added.join(', ')}`);
    }
  } catch (err) {
    console.error('[db] ensureTicketColumns failed:', err.message);
  }
}

/**
 * Provider resource ownership map (VPS SSH keys, snapshots, backups…).
 * Every provider-account-level resource a customer creates is recorded here so
 * list/delete/restore can be scoped to the owning organization instead of
 * exposing the shared Vultr account. Idempotent. SQLite only.
 */
export async function ensureProviderResourcesTable() {
  const url = process.env.DATABASE_URL || '';
  if (!url.startsWith('file:')) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "provider_resources" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organization_id" TEXT NOT NULL,
        "user_id" TEXT,
        "service_id" TEXT,
        "provider" TEXT NOT NULL DEFAULT 'vultr',
        "resource_type" TEXT NOT NULL,
        "provider_resource_id" TEXT NOT NULL,
        "name" TEXT,
        "status" TEXT NOT NULL DEFAULT 'active',
        "metadata" TEXT NOT NULL DEFAULT '{}',
        "deleted_at" DATETIME,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "provider_resources_provider_resource_type_provider_resource_id_key"
       ON "provider_resources" ("provider", "resource_type", "provider_resource_id")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "provider_resources_organization_id_resource_type_idx"
       ON "provider_resources" ("organization_id", "resource_type")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "provider_resources_service_id_idx"
       ON "provider_resources" ("service_id")`,
    );
  } catch (err) {
    console.error('[db] ensureProviderResourcesTable failed:', err.message);
  }
}

/**
 * Durable hosting environment variables.
 *
 * The Hosting Env Vars UI used to persist only to the legacy JSON hosting
 * store. Keep that store for compatibility, but create a relational table so
 * each variable is queryable by hosting service, Render service, owner, and
 * organization. Values remain redacted publicly and encrypted when marked as
 * secret.
 */
export async function ensureHostingEnvVarsTable() {
  const url = process.env.DATABASE_URL || '';
  if (!url.startsWith('file:')) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "hosting_environment_variables" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "hosting_service_id" TEXT NOT NULL,
        "render_service_id" TEXT,
        "deployment_id" TEXT NOT NULL,
        "organization_id" TEXT,
        "created_by_user_id" TEXT,
        "key" TEXT NOT NULL,
        "environment" TEXT NOT NULL DEFAULT 'production',
        "encrypted" BOOLEAN NOT NULL DEFAULT 1,
        "value_preview" TEXT NOT NULL,
        "value_ciphertext" TEXT,
        "value_plaintext" TEXT,
        "render_synced" BOOLEAN NOT NULL DEFAULT 0,
        "requires_redeploy" BOOLEAN NOT NULL DEFAULT 1,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "hosting_environment_variables_hosting_service_id_key_environment_key"
       ON "hosting_environment_variables" ("hosting_service_id", "key", "environment")`,
    );
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "hosting_environment_variables_deployment_id_idx" ON "hosting_environment_variables" ("deployment_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "hosting_environment_variables_render_service_id_idx" ON "hosting_environment_variables" ("render_service_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "hosting_environment_variables_organization_id_idx" ON "hosting_environment_variables" ("organization_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "hosting_environment_variables_created_by_user_id_idx" ON "hosting_environment_variables" ("created_by_user_id")`);
  } catch (err) {
    console.error('[db] ensureHostingEnvVarsTable failed:', err.message);
  }
}

/**
 * Durable hosting response headers.
 *
 * Headers belong to a Glondia hosting service/deployment. Provider sync is
 * best-effort, but this table remains the source of truth for the dashboard.
 */
export async function ensureHostingHeadersTable() {
  const url = process.env.DATABASE_URL || '';
  if (!url.startsWith('file:')) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "hosting_headers" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "hosting_service_id" TEXT NOT NULL,
        "render_service_id" TEXT,
        "deployment_id" TEXT NOT NULL,
        "organization_id" TEXT,
        "created_by_user_id" TEXT,
        "path" TEXT NOT NULL DEFAULT '/*',
        "name" TEXT NOT NULL,
        "value" TEXT NOT NULL,
        "provider_synced" BOOLEAN NOT NULL DEFAULT 0,
        "provider_error" TEXT,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "hosting_headers_hosting_service_id_path_name_key"
       ON "hosting_headers" ("hosting_service_id", "path", "name")`,
    );
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "hosting_headers_deployment_id_idx" ON "hosting_headers" ("deployment_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "hosting_headers_render_service_id_idx" ON "hosting_headers" ("render_service_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "hosting_headers_organization_id_idx" ON "hosting_headers" ("organization_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "hosting_headers_created_by_user_id_idx" ON "hosting_headers" ("created_by_user_id")`);
  } catch (err) {
    console.error('[db] ensureHostingHeadersTable failed:', err.message);
  }
}

/**
 * Durable hosting persistent disks.
 *
 * Each disk is attached to a Glondia hosting deployment and mirrored to the
 * provider when possible. The relational record keeps the customer's dashboard
 * usable even when provider sync is delayed.
 */
export async function ensureHostingDisksTable() {
  const url = process.env.DATABASE_URL || '';
  if (!url.startsWith('file:')) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "hosting_disks" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "disk_id" TEXT NOT NULL,
        "hosting_service_id" TEXT NOT NULL,
        "render_service_id" TEXT,
        "deployment_id" TEXT NOT NULL,
        "organization_id" TEXT,
        "created_by_user_id" TEXT,
        "name" TEXT NOT NULL,
        "mount_path" TEXT NOT NULL,
        "size_gb" INTEGER NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'pending_provider',
        "provider_sync_status" TEXT NOT NULL DEFAULT 'pending_provider',
        "provider_error" TEXT,
        "render_disk_json" TEXT,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "hosting_disks_hosting_service_id_disk_id_key"
       ON "hosting_disks" ("hosting_service_id", "disk_id")`,
    );
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "hosting_disks_deployment_id_idx" ON "hosting_disks" ("deployment_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "hosting_disks_render_service_id_idx" ON "hosting_disks" ("render_service_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "hosting_disks_organization_id_idx" ON "hosting_disks" ("organization_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "hosting_disks_created_by_user_id_idx" ON "hosting_disks" ("created_by_user_id")`);
  } catch (err) {
    console.error('[db] ensureHostingDisksTable failed:', err.message);
  }
}

/**
 * Durable hosting metrics + usage summaries.
 *
 * Live graphs still come from the provider, but samples are cached against the
 * canonical WebHostingService/deployment so the dashboard has a relational
 * history, can show monthly usage, and can survive provider telemetry gaps.
 */
export async function ensureHostingMetricsTables() {
  const url = process.env.DATABASE_URL || '';
  if (!url.startsWith('file:')) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "hosting_metric_samples" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "hosting_service_id" TEXT NOT NULL,
        "render_service_id" TEXT,
        "deployment_id" TEXT NOT NULL,
        "organization_id" TEXT,
        "created_by_user_id" TEXT,
        "metric_type" TEXT NOT NULL,
        "unit" TEXT NOT NULL DEFAULT 'value',
        "range_key" TEXT NOT NULL DEFAULT '12h',
        "resolution" TEXT NOT NULL DEFAULT 'hour',
        "sample_at" DATETIME NOT NULL,
        "value" REAL NOT NULL,
        "source" TEXT NOT NULL DEFAULT 'provider',
        "provider_payload" TEXT,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "hosting_metric_samples_hosting_service_id_metric_type_range_key_sample_at_key"
       ON "hosting_metric_samples" ("hosting_service_id", "metric_type", "range_key", "sample_at")`,
    );
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "hosting_metric_samples_deployment_id_metric_type_sample_at_idx" ON "hosting_metric_samples" ("deployment_id", "metric_type", "sample_at")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "hosting_metric_samples_render_service_id_idx" ON "hosting_metric_samples" ("render_service_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "hosting_metric_samples_organization_id_idx" ON "hosting_metric_samples" ("organization_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "hosting_metric_samples_created_by_user_id_idx" ON "hosting_metric_samples" ("created_by_user_id")`);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "hosting_usage_summaries" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "hosting_service_id" TEXT NOT NULL,
        "render_service_id" TEXT,
        "deployment_id" TEXT NOT NULL,
        "organization_id" TEXT,
        "created_by_user_id" TEXT,
        "period_key" TEXT NOT NULL,
        "bandwidth_used_mb" REAL NOT NULL DEFAULT 0,
        "request_count" INTEGER NOT NULL DEFAULT 0,
        "event_count" INTEGER NOT NULL DEFAULT 0,
        "source" TEXT NOT NULL DEFAULT 'provider',
        "last_provider_sync_at" DATETIME,
        "metadata" TEXT NOT NULL DEFAULT '{}',
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "hosting_usage_summaries_hosting_service_id_period_key_key"
       ON "hosting_usage_summaries" ("hosting_service_id", "period_key")`,
    );
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "hosting_usage_summaries_deployment_id_period_key_idx" ON "hosting_usage_summaries" ("deployment_id", "period_key")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "hosting_usage_summaries_organization_id_idx" ON "hosting_usage_summaries" ("organization_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "hosting_usage_summaries_created_by_user_id_idx" ON "hosting_usage_summaries" ("created_by_user_id")`);
  } catch (err) {
    console.error('[db] ensureHostingMetricsTables failed:', err.message);
  }
}

/**
 * Canonical Site Builder tables. This project currently uses Prisma db:push
 * plus additive SQLite bootstraps instead of checked-in migration files, so
 * create the new durable BuilderProject lifecycle tables idempotently at boot.
 */
export async function ensureBuilderLifecycleTables() {
  const url = process.env.DATABASE_URL || '';
  if (!url.startsWith('file:')) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "builder_projects" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "user_id" TEXT NOT NULL,
        "client_project_id" TEXT,
        "source_type" TEXT NOT NULL,
        "template_id" TEXT,
        "template_version" TEXT,
        "template_source_commit" TEXT,
        "template_manifest_hash" TEXT,
        "name" TEXT NOT NULL,
        "slug" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'DRAFT',
        "version" INTEGER NOT NULL DEFAULT 1,
        "current_revision_id" TEXT,
        "approved_revision_id" TEXT,
        "plan_json" TEXT NOT NULL DEFAULT '{}',
        "answer_sheet_json" TEXT NOT NULL DEFAULT '{}',
        "metadata" TEXT NOT NULL DEFAULT '{}',
        "archived_at" DATETIME,
        "deleted_at" DATETIME,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "builder_projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
      )`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "builder_projects_user_id_slug_key" ON "builder_projects" ("user_id", "slug")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "builder_projects_user_id_status_idx" ON "builder_projects" ("user_id", "status")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "builder_projects_client_project_id_idx" ON "builder_projects" ("client_project_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "builder_projects_template_id_template_version_idx" ON "builder_projects" ("template_id", "template_version")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "builder_projects_updated_at_idx" ON "builder_projects" ("updated_at")`);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "builder_revisions" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "project_id" TEXT NOT NULL,
        "revision_number" INTEGER NOT NULL,
        "parent_revision_id" TEXT,
        "status" TEXT NOT NULL DEFAULT 'DRAFT',
        "plan_snapshot_json" TEXT NOT NULL DEFAULT '{}',
        "answer_sheet_json" TEXT NOT NULL DEFAULT '{}',
        "generated_site_json" TEXT NOT NULL DEFAULT '{}',
        "artifact_location" TEXT,
        "artifact_checksum" TEXT,
        "source_commit" TEXT,
        "generation_model" TEXT,
        "generation_usage_json" TEXT NOT NULL DEFAULT '{}',
        "validation_json" TEXT NOT NULL DEFAULT '{}',
        "change_request_json" TEXT NOT NULL DEFAULT '{}',
        "created_by_user_id" TEXT,
        "approved_by_user_id" TEXT,
        "approved_at" DATETIME,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "builder_revisions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "builder_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "builder_revisions_project_id_revision_number_key" ON "builder_revisions" ("project_id", "revision_number")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "builder_revisions_project_id_status_idx" ON "builder_revisions" ("project_id", "status")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "builder_revisions_artifact_checksum_idx" ON "builder_revisions" ("artifact_checksum")`);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "builder_jobs" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "project_id" TEXT NOT NULL,
        "revision_id" TEXT,
        "job_type" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'QUEUED',
        "stage" TEXT,
        "idempotency_key" TEXT NOT NULL,
        "request_hash" TEXT,
        "payload_json" TEXT NOT NULL DEFAULT '{}',
        "result_json" TEXT NOT NULL DEFAULT '{}',
        "progress_json" TEXT NOT NULL DEFAULT '{}',
        "error_code" TEXT,
        "error_message" TEXT,
        "attempt" INTEGER NOT NULL DEFAULT 0,
        "max_attempts" INTEGER NOT NULL DEFAULT 3,
        "available_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "lease_owner" TEXT,
        "lease_expires_at" DATETIME,
        "started_at" DATETIME,
        "finished_at" DATETIME,
        "cancelled_at" DATETIME,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "builder_jobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "builder_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "builder_jobs_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "builder_revisions" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      )`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "builder_jobs_idempotency_key_key" ON "builder_jobs" ("idempotency_key")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "builder_jobs_status_available_at_idx" ON "builder_jobs" ("status", "available_at")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "builder_jobs_lease_expires_at_idx" ON "builder_jobs" ("lease_expires_at")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "builder_jobs_project_id_created_at_idx" ON "builder_jobs" ("project_id", "created_at")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "builder_jobs_revision_id_idx" ON "builder_jobs" ("revision_id")`);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "builder_job_events" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "job_id" TEXT NOT NULL,
        "sequence" INTEGER NOT NULL,
        "stage" TEXT,
        "level" TEXT NOT NULL DEFAULT 'info',
        "message" TEXT NOT NULL,
        "details_json" TEXT NOT NULL DEFAULT '{}',
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "builder_job_events_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "builder_jobs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "builder_job_events_job_id_sequence_key" ON "builder_job_events" ("job_id", "sequence")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "builder_job_events_job_id_created_at_idx" ON "builder_job_events" ("job_id", "created_at")`);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "builder_preview_grants" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "project_id" TEXT NOT NULL,
        "revision_id" TEXT NOT NULL,
        "token_hash" TEXT NOT NULL,
        "audience" TEXT NOT NULL DEFAULT 'owner',
        "expires_at" DATETIME NOT NULL,
        "revoked_at" DATETIME,
        "last_used_at" DATETIME,
        "created_by_user_id" TEXT,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "builder_preview_grants_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "builder_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "builder_preview_grants_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "builder_revisions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "builder_preview_grants_token_hash_key" ON "builder_preview_grants" ("token_hash")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "builder_preview_grants_project_id_expires_at_idx" ON "builder_preview_grants" ("project_id", "expires_at")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "builder_preview_grants_revision_id_idx" ON "builder_preview_grants" ("revision_id")`);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "builder_deployment_links" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "project_id" TEXT NOT NULL,
        "revision_id" TEXT NOT NULL,
        "deployment_id" TEXT NOT NULL,
        "idempotency_key" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'QUEUED',
        "is_current" BOOLEAN NOT NULL DEFAULT 1,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "builder_deployment_links_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "builder_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "builder_deployment_links_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "builder_revisions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
      )`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "builder_deployment_links_deployment_id_key" ON "builder_deployment_links" ("deployment_id")`);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "builder_deployment_links_idempotency_key_key" ON "builder_deployment_links" ("idempotency_key")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "builder_deployment_links_project_id_is_current_idx" ON "builder_deployment_links" ("project_id", "is_current")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "builder_deployment_links_revision_id_idx" ON "builder_deployment_links" ("revision_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "builder_deployment_links_status_idx" ON "builder_deployment_links" ("status")`);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ai_usage_events" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "user_id" TEXT,
        "project_id" TEXT,
        "job_id" TEXT,
        "provider" TEXT NOT NULL,
        "model" TEXT NOT NULL,
        "operation" TEXT NOT NULL,
        "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
        "completion_tokens" INTEGER NOT NULL DEFAULT 0,
        "estimated_cost_micros" INTEGER NOT NULL DEFAULT 0,
        "status" TEXT NOT NULL,
        "request_id" TEXT,
        "metadata" TEXT NOT NULL DEFAULT '{}',
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ai_usage_events_user_id_created_at_idx" ON "ai_usage_events" ("user_id", "created_at")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ai_usage_events_project_id_created_at_idx" ON "ai_usage_events" ("project_id", "created_at")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ai_usage_events_job_id_idx" ON "ai_usage_events" ("job_id")`);

    // Audit log for every project status transition (builderStateMachine).
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "builder_state_transitions" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "project_id" TEXT NOT NULL,
        "from_status" TEXT NOT NULL,
        "to_status" TEXT NOT NULL,
        "actor_type" TEXT NOT NULL DEFAULT 'system',
        "actor_id" TEXT,
        "reason" TEXT,
        "request_id" TEXT,
        "job_id" TEXT,
        "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "builder_state_transitions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "builder_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "builder_state_transitions_project_id_created_at_idx" ON "builder_state_transitions" ("project_id", "created_at")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "builder_state_transitions_job_id_idx" ON "builder_state_transitions" ("job_id")`);

    // Durable worker heartbeats — /readyz and job-acceptance checks read this.
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "builder_worker_heartbeats" (
        "worker_id" TEXT NOT NULL PRIMARY KEY,
        "info_json" TEXT NOT NULL DEFAULT '{}',
        "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "last_seen_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "builder_worker_heartbeats_last_seen_at_idx" ON "builder_worker_heartbeats" ("last_seen_at")`);

    // Additive provider-identity columns on deployment links (idempotency:
    // retries must reuse the recorded hosting/Render resources).
    const linkColumns = [
      ['hosting_deployment_id', 'TEXT'],
      ['render_service_id', 'TEXT'],
      ['render_deploy_id', 'TEXT'],
      ['live_url', 'TEXT'],
      ['error_message', 'TEXT'],
      ['metadata', "TEXT NOT NULL DEFAULT '{}'"],
    ];
    const linkInfo = await prisma.$queryRawUnsafe(`PRAGMA table_info('builder_deployment_links')`);
    const haveLinkCols = new Set((linkInfo || []).map((r) => r.name));
    for (const [name, def] of linkColumns) {
      if (haveLinkCols.has(name)) continue;
      try {
        await prisma.$executeRawUnsafe(`ALTER TABLE "builder_deployment_links" ADD COLUMN "${name}" ${def}`);
      } catch (err) {
        console.error(`[db] Failed to add builder_deployment_links.${name}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[db] ensureBuilderLifecycleTables failed:', err.message);
  }
}

/**
 * One-time repair for VPS tenancy. JWTs never carried an organizationId, so the
 * old VPS controller filed every record under the shared 'local-org' bucket —
 * which made VPS listing effectively cross-tenant. The controller now uses the
 * verified user id as the organization id; this backfills existing rows to
 * match using the recorded creator/owner. Rows with no known owner (pre-auth
 * dev data) are left untouched. Idempotent. SQLite only.
 */
export async function ensureVpsTenancyBackfill() {
  const url = process.env.DATABASE_URL || '';
  if (!url.startsWith('file:')) return;
  try {
    const svc = await prisma.$executeRawUnsafe(
      `UPDATE "vps_services" SET "organization_id" = "created_by_user_id"
       WHERE "organization_id" = 'local-org' AND "created_by_user_id" IS NOT NULL`,
    );
    const access = await prisma.$executeRawUnsafe(
      `UPDATE "service_access" SET "organization_id" = "user_id"
       WHERE "service_type" = 'vps' AND "organization_id" = 'local-org' AND "user_id" IS NOT NULL`,
    );
    const orders = await prisma.$executeRawUnsafe(
      `UPDATE "checkout_orders" SET "organization_id" = "user_id"
       WHERE "type" = 'vps' AND "organization_id" = 'local-org' AND "user_id" IS NOT NULL`,
    );
    const logs = await prisma.$executeRawUnsafe(
      `UPDATE "vps_action_logs" SET "organization_id" =
         (SELECT s."organization_id" FROM "vps_services" s WHERE s."id" = "vps_action_logs"."vps_service_id")
       WHERE "organization_id" = 'local-org'
         AND EXISTS (SELECT 1 FROM "vps_services" s WHERE s."id" = "vps_action_logs"."vps_service_id")`,
    );
    // ServiceAccess rows were only created by the direct-deploy flow; PayPal
    // provisioned services have none, which locks owners out of the management
    // routes (they require an active row). Create the missing rows.
    const accessCreated = await prisma.$executeRawUnsafe(
      `INSERT INTO "service_access" (
         "id", "user_id", "organization_id", "service_type", "service_id", "service_name",
         "access_status", "billing_status", "admin_status", "plan_id", "starts_at",
         "metadata", "created_at", "updated_at")
       SELECT lower(hex(randomblob(16))), s."created_by_user_id", s."organization_id", 'vps', s."id", s."label",
         'active',
         CASE WHEN s."payment_status" IN ('completed', 'active') THEN 'paid'
              WHEN s."payment_status" = 'free' THEN 'free'
              ELSE 'pending' END,
         'allowed', s."plan", s."created_at",
         '{"createdVia":"startup_backfill"}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       FROM "vps_services" s
       WHERE s."deleted_at" IS NULL
         AND s."status" NOT IN ('error', 'destroyed')
         AND NOT EXISTS (
           SELECT 1 FROM "service_access" a
           WHERE a."service_type" = 'vps' AND a."service_id" = s."id")`,
    );
    const total = Number(svc) + Number(access) + Number(orders) + Number(logs) + Number(accessCreated);
    if (total > 0) {
      console.log(`[db] VPS tenancy backfill: ${svc} services, ${access} access rows, ${orders} orders, ${logs} action logs re-homed from 'local-org'; ${accessCreated} missing ServiceAccess rows created.`);
    }
  } catch (err) {
    console.error('[db] ensureVpsTenancyBackfill failed:', err.message);
  }
}

/**
 * Provider catalogs are backend-managed snapshots. Browser reads must never
 * block on, or directly cause, a Vultr API request.
 */
export async function ensureVpsCatalogSnapshotsTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "vps_catalog_snapshots" (
      "kind" TEXT NOT NULL PRIMARY KEY,
      "payload" TEXT NOT NULL DEFAULT '[]',
      "sync_status" TEXT NOT NULL DEFAULT 'seeded',
      "error_message" TEXT,
      "last_synced_at" DATETIME,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export async function ensureDomainServiceSnapshotsTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "domain_service_snapshots" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "user_id" TEXT NOT NULL,
      "organization_id" TEXT NOT NULL,
      "domain_service_id" TEXT NOT NULL,
      "domain" TEXT NOT NULL,
      "provider" TEXT NOT NULL,
      "feature" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'synced',
      "payload" TEXT NOT NULL DEFAULT '{}',
      "error_message" TEXT,
      "last_synced_at" DATETIME,
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE("domain_service_id", "provider", "feature")
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "domain_service_snapshots_user_domain_idx"
     ON "domain_service_snapshots" ("user_id", "domain_service_id")`,
  );
}

export async function ensureDomainAddonServicesTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "domain_addon_services" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "user_id" TEXT NOT NULL,
      "organization_id" TEXT NOT NULL,
      "domain_service_id" TEXT NOT NULL,
      "addon_key" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'provisioning',
      "provisioning_stage" TEXT NOT NULL DEFAULT 'record_request',
      "internal_provider" TEXT NOT NULL,
      "provider_zone_id" TEXT,
      "provider_subscription_id" TEXT,
      "provider_rate_plan_id" TEXT,
      "provider_amount_cents" INTEGER NOT NULL DEFAULT 0,
      "markup_percent" REAL NOT NULL DEFAULT 30,
      "markup_amount_cents" INTEGER NOT NULL DEFAULT 0,
      "total_amount_cents" INTEGER NOT NULL DEFAULT 0,
      "currency" TEXT NOT NULL DEFAULT 'USD',
      "billing_cycle" TEXT NOT NULL DEFAULT 'monthly',
      "billing_status" TEXT NOT NULL DEFAULT 'pending',
      "payment_status" TEXT NOT NULL DEFAULT 'pending',
      "checkout_order_id" TEXT,
      "invoice_id" TEXT,
      "invoice_line_item_id" TEXT,
      "payment_transaction_id" TEXT,
      "payment_method_id" TEXT,
      "renews_at" DATETIME,
      "activated_at" DATETIME,
      "suspended_at" DATETIME,
      "cancelled_at" DATETIME,
      "metadata" TEXT NOT NULL DEFAULT '{}',
      "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE("domain_service_id", "addon_key")
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "domain_addon_services_user_domain_idx" ON "domain_addon_services" ("user_id", "domain_service_id")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "domain_addon_services_org_billing_idx" ON "domain_addon_services" ("organization_id", "billing_status")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "domain_addon_services_invoice_idx" ON "domain_addon_services" ("invoice_id")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "domain_addon_services_payment_renewal_idx" ON "domain_addon_services" ("payment_status", "renews_at")`);
}

export async function disconnectPrisma() {
  await prisma.$disconnect();
}

export async function withTransaction(callback, options = {}) {
  return prisma.$transaction(
    async (tx) => callback(tx),
    {
      maxWait: Number(options.maxWait ?? process.env.PRISMA_TX_MAX_WAIT_MS ?? 5000),
      timeout: Number(options.timeout ?? process.env.PRISMA_TX_TIMEOUT_MS ?? 15000),
      isolationLevel: options.isolationLevel,
    },
  );
}

export async function withCompensatingTransaction({ transaction, compensate }) {
  const compensations = [];
  const addCompensation = (fn) => { if (typeof fn === 'function') compensations.push(fn); };
  try {
    return await withTransaction((tx) => transaction(tx, addCompensation));
  } catch (error) {
    for (const step of compensations.reverse()) {
      try { await step(error); } catch (e) { console.error('[db:compensation-failed]', e); }
    }
    if (typeof compensate === 'function') {
      try { await compensate(error); } catch (e) { console.error('[db:final-compensation-failed]', e); }
    }
    throw error;
  }
}

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
