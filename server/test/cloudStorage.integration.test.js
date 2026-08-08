import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = 3994;
const base = `http://127.0.0.1:${port}/api/cloud-storage`;
let processHandle;
let temp;

function api(path, { method = "GET", user = "storage-owner", body } = {}) {
  return fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-user-id": user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

before(
  async () => {
    temp = mkdtempSync(join(tmpdir(), "glondia-cloud-storage-"));
    const db = join(temp, "test.db");
    closeSync(openSync(db, "w"));
    const databaseUrl = `file:${db.replaceAll("\\", "/")}`;
    execSync("npx prisma db push --skip-generate", {
      cwd: root,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "ignore",
    });
    processHandle = spawn(process.execPath, ["server/src/server.js"], {
      cwd: root,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        PORT: String(port),
        NODE_ENV: "development",
        AUTH_DEV_FALLBACK: "true",
        VPS_TEST_MODE: "true",
        VULTR_API_KEY: "",
      },
      stdio: "ignore",
    });
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error("Cloud Storage test server did not start.");
  },
  { timeout: 120000 },
);

after(() => {
  processHandle?.kill();
  if (temp)
    try {
      rmSync(temp, { recursive: true, force: true });
    } catch {}
});

test("catalog exposes cached storage choices and PostgreSQL capacities", async () => {
  const response = await api("/catalog");
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data.plans.length, 18);
  assert.deepEqual(
    new Set(
      data.plans
        .filter((plan) => plan.serviceKind === "postgres")
        .map((plan) => plan.size),
    ),
    new Set(["10gb", "50gb", "100gb"]),
  );
  assert.deepEqual(
    new Set(
      data.plans
        .filter((plan) => plan.serviceKind !== "postgres")
        .map((plan) => plan.size),
    ),
    new Set(["smallest", "largest"]),
  );
  assert.equal("providerCatalog" in data, false);
  assert.equal("providerCostCents" in data.plans[0], false);
  assert.equal("markupAmountCents" in data.plans[0], false);
});

test("creates durable service, access, billing and protected credentials", async () => {
  const response = await api("/services", {
    method: "POST",
    body: {
      name: "Client file storage",
      serviceKind: "private_vault",
      tenancy: "shared",
      planSize: "smallest",
      region: "syd",
    },
  });
  assert.equal(response.status, 201);
  const { data: service } = await response.json();
  assert.equal(service.status, "active");
  assert.equal(service.totalPriceCents, 520);
  assert.equal("monthlyCostCents" in service, false);
  assert.equal("credentialsCiphertext" in service, false);

  const [logs, billing, credentials] = await Promise.all([
    api(`/services/${service.id}/logs`),
    api(`/services/${service.id}/billing`),
    api(`/services/${service.id}/credentials`),
  ]);
  assert.equal(logs.status, 200);
  assert.equal(billing.status, 200);
  assert.equal(credentials.status, 200);
  assert.ok((await logs.json()).data.length >= 3);
  const billingData = (await billing.json()).data;
  assert.equal(billingData.ledger[0].amountCents, 520);
  assert.equal("providerAmountCents" in billingData.ledger[0], false);
  assert.equal("markupAmountCents" in billingData.ledger[0], false);
  const credentialData = (await credentials.json()).data.credentials;
  assert.ok(credentialData.bucket);
  assert.equal(credentialData.transferAccess.scope, "cloud-drive-container");
  assert.equal(credentialData.transferAccess.root, "/drive");
  assert.equal(credentialData.transferAccess.protocol, "sftp/ssh");
  assert.match(credentialData.transferAccess.privateKey, /BEGIN PRIVATE KEY/);
  assert.ok(credentialData.transferAccess.password.length >= 20);
  assert.equal(credentialData.transferAccess.username.includes("root"), false);

  const foreign = await api(`/services/${service.id}`, {
    user: "another-customer",
  });
  assert.equal(foreign.status, 404);
});

test("validates PostgreSQL versions within one service kind", async () => {
  const invalid = await api("/quote", {
    method: "POST",
    body: {
      serviceKind: "postgres",
      tenancy: "shared",
      planSize: "10gb",
      region: "syd",
      postgresVersion: "14",
    },
  });
  assert.equal(invalid.status, 400);
  for (const version of ["15", "16"]) {
    const valid = await api("/quote", {
      method: "POST",
      body: {
        serviceKind: "postgres",
        tenancy: "dedicated",
        planSize: "100gb",
        region: "syd",
        postgresVersion: version,
      },
    });
    assert.equal(valid.status, 200);
    assert.equal((await valid.json()).data.postgresVersion, version);
  }
});

test("creates protected internal and external PostgreSQL connection profiles", async () => {
  const externalPassword = "Customer-db-password-2026";
  const response = await api("/services", {
    method: "POST",
    body: {
      name: "Accounts Server",
      serviceKind: "postgres",
      tenancy: "shared",
      planSize: "50gb",
      region: "syd",
      postgresVersion: "16",
      externalAccessEnabled: true,
      externalPassword,
      trustedNetworks: ["203.0.113.10/32"],
    },
  });
  assert.equal(response.status, 201);
  const { data: service } = await response.json();
  assert.equal(service.externalAccessEnabled, true);
  assert.deepEqual(service.trustedNetworks, ["203.0.113.10/32"]);

  const credentialsResponse = await api(`/services/${service.id}/credentials`);
  const { data } = await credentialsResponse.json();
  assert.equal(credentialsResponse.status, 200);
  assert.equal(data.credentials.internal.sslMode, "require");
  assert.equal(data.credentials.external.password, externalPassword);
  assert.equal(data.credentials.external.sslMode, "require");

  const logs = await (await api(`/services/${service.id}/logs`)).text();
  assert.equal(logs.includes(externalPassword), false);
});
