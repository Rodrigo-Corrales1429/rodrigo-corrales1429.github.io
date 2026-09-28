"use strict";

const fs = require("node:fs");
const net = require("node:net");
const { Pool } = require("pg");
const { assertLocalTestUrl } = require("./test-target");

function positiveInteger(value, name, fallback) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${name} debe ser un entero positivo`);
  }
  return number;
}

// Pura: valida y devuelve la configuración, sin abrir conexión. Así se prueba la de
// producción sin que ningún pool pueda nacer con ella dentro de un proceso de pruebas.
function poolConfig({ url, tls, caFile, poolMax, connectTimeoutMs, statementTimeoutMs, lockTimeoutMs, environment }) {
  if (environment === "test") {
    // En pruebas nunca se toma DATABASE_URL por omisión y solo cabe la base local desechable.
    if (!url) throw new Error("BLOQUEO: en NODE_ENV=test el pool exige la URL de prueba explícita");
    assertLocalTestUrl(url);
  }
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

  return {
    connectionString: url,
    ssl,
    max: positiveInteger(poolMax, "DB_POOL_MAX", 5),
    connectionTimeoutMillis: positiveInteger(connectTimeoutMs, "DB_CONNECT_TIMEOUT_MS", 5000),
    statement_timeout: positiveInteger(statementTimeoutMs, "DB_STATEMENT_TIMEOUT_MS", 15000),
    lock_timeout: positiveInteger(lockTimeoutMs, "DB_LOCK_TIMEOUT_MS", 5000)
  };
}

// El entorno lo fija el proceso (NODE_ENV), nunca el llamador: desde NODE_ENV=test nadie
// puede declararse «producción» y saltarse la barrera. Una opción desconocida se rechaza.
function createPool({
  url,
  tls = process.env.DATABASE_TLS,
  caFile = process.env.DATABASE_CA_FILE,
  poolMax = process.env.DB_POOL_MAX,
  connectTimeoutMs = process.env.DB_CONNECT_TIMEOUT_MS,
  statementTimeoutMs = process.env.DB_STATEMENT_TIMEOUT_MS,
  lockTimeoutMs = process.env.DB_LOCK_TIMEOUT_MS,
  ...unknown
} = {}) {
  const extra = Object.keys(unknown);
  if (extra.length) throw new Error(`BLOQUEO: createPool no admite ${extra.join(", ")}; el entorno es NODE_ENV`);
  const environment = process.env.NODE_ENV;
  if (url === undefined && environment !== "test") url = process.env.DATABASE_URL;

  const pool = new Pool(poolConfig({
    url, tls, caFile, poolMax, connectTimeoutMs, statementTimeoutMs, lockTimeoutMs, environment
  }));
  // Sin listener, una conexión inactiva que PostgreSQL cierra (reinicio, failover,
  // pg_terminate_backend) emite 'error' sin manejar y tumba el proceso entero. El pool
  // ya descarta ese cliente y la siguiente consulta abre otro. Solo el código: el
  // mensaje puede traer host o usuario.
  pool.on("error", error => {
    process.stderr.write(`PostgreSQL: conexión inactiva descartada (${error.code || "sin código"}).\n`);
  });
  return pool;
}

module.exports = { createPool, poolConfig };
