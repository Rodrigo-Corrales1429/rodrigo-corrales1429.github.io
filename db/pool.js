"use strict";

const fs = require("node:fs");
const net = require("node:net");
const { Pool } = require("pg");

function positiveInteger(value, name, fallback) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${name} debe ser un entero positivo`);
  }
  return number;
}

function createPool({
  url = process.env.DATABASE_URL,
  tls = process.env.DATABASE_TLS,
  caFile = process.env.DATABASE_CA_FILE,
  poolMax = process.env.DB_POOL_MAX,
  connectTimeoutMs = process.env.DB_CONNECT_TIMEOUT_MS,
  statementTimeoutMs = process.env.DB_STATEMENT_TIMEOUT_MS,
  lockTimeoutMs = process.env.DB_LOCK_TIMEOUT_MS,
  environment = process.env.NODE_ENV
} = {}) {
  if (!url) throw new Error("DATABASE_URL no configurada");

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL inválida");
  }
  if (!(["postgres:", "postgresql:"].includes(parsed.protocol) && parsed.hostname && parsed.pathname.length > 1)) {
    throw new Error("DATABASE_URL inválida");
  }
  // pg-connection-string puede sobrescribir la opción ssl si la URL contiene estos parámetros.
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert", "ssl"]) {
    if (parsed.searchParams.has(key)) throw new Error("Opciones TLS en DATABASE_URL no admitidas");
  }

  const mode = tls || (environment === "production" ? "verify-full" : "disable");
  if (mode !== "verify-full" && mode !== "disable") throw new Error("DATABASE_TLS inválida");
  if (environment === "production" && mode !== "verify-full") {
    throw new Error("PostgreSQL requiere TLS verificado en producción");
  }
  if (mode === "verify-full" && net.isIP(parsed.hostname.replace(/^\[|\]$/g, ""))) {
    throw new Error("TLS verificado requiere un hostname PostgreSQL");
  }
  if (caFile && mode !== "verify-full") throw new Error("DATABASE_CA_FILE requiere TLS verificado");

  const ssl = mode === "verify-full"
    ? { rejectUnauthorized: true, servername: parsed.hostname, ...(caFile ? { ca: fs.readFileSync(caFile) } : {}) }
    : false;

  return new Pool({
    connectionString: url,
    ssl,
    max: positiveInteger(poolMax, "DB_POOL_MAX", 5),
    connectionTimeoutMillis: positiveInteger(connectTimeoutMs, "DB_CONNECT_TIMEOUT_MS", 5000),
    statement_timeout: positiveInteger(statementTimeoutMs, "DB_STATEMENT_TIMEOUT_MS", 15000),
    lock_timeout: positiveInteger(lockTimeoutMs, "DB_LOCK_TIMEOUT_MS", 5000)
  });
}

module.exports = { createPool };
