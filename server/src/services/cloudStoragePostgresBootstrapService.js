import { randomBytes } from "node:crypto";

function identifier(value, prefix) {
  const clean = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36);
  return `${prefix}_${clean || randomBytes(5).toString("hex")}`;
}

function literal(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function buildPostgresBootstrap(
  service,
  { internalHost, externalHost, externalPassword } = {},
) {
  const suffix = service.id.replaceAll("-", "").slice(0, 10);
  const database = identifier(service.name || suffix, "db");
  const accountBase = `${service.name || database}_${suffix}`;
  const internalUsername = identifier(accountBase, "internal");
  const externalUsername = identifier(accountBase, "external");
  const internalPassword = randomBytes(24).toString("base64url");
  const selectedExternalPassword = String(externalPassword || "");
  const sql = [
    `CREATE ROLE "${internalUsername}" LOGIN PASSWORD ${literal(internalPassword)};`,
    ...(service.externalAccessEnabled
      ? [
          `CREATE ROLE "${externalUsername}" LOGIN PASSWORD ${literal(selectedExternalPassword)};`,
        ]
      : []),
    `CREATE DATABASE "${database}" OWNER "${internalUsername}";`,
    ...(service.externalAccessEnabled
      ? [`GRANT CONNECT ON DATABASE "${database}" TO "${externalUsername}";`]
      : []),
  ].join("\n");
  const internal = internalHost
    ? {
        host: internalHost,
        port: 5432,
        database,
        username: internalUsername,
        password: internalPassword,
        sslMode: "require",
        url: `postgresql://${internalUsername}:${encodeURIComponent(internalPassword)}@${internalHost}:5432/${database}?sslmode=require`,
      }
    : null;
  const external =
    service.externalAccessEnabled && externalHost
      ? {
          host: externalHost,
          port: 5432,
          database,
          username: externalUsername,
          password: selectedExternalPassword,
          sslMode: "require",
          url: `postgresql://${externalUsername}:${encodeURIComponent(selectedExternalPassword)}@${externalHost}:5432/${database}?sslmode=require`,
        }
      : null;
  return {
    sql,
    credentials: { internal, external },
    database,
    internalUsername,
    externalUsername: external ? externalUsername : null,
  };
}
