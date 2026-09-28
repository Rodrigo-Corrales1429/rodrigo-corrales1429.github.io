"use strict";

// Barrera anti-producción de las suites PostgreSQL, en dos capas independientes:
// la URL se valida antes de abrir un socket y la identidad se confirma en el propio
// servidor antes de cualquier DDL. Una base real no pasa la segunda capa aunque un
// túnel o un alias la hagan parecer local: le falta la marca que solo se pone a mano
// en la base desechable.
const TEST_DATABASE = "valquiria_test";
const TEST_MARKER = "valquiria:disposable-test";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function assertLocalTestUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error("BLOQUEO: TEST_DATABASE_URL inválida"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname) ||
      url.pathname !== `/${TEST_DATABASE}` || url.search || url.hash) {
    throw new Error(`BLOQUEO: la suite solo admite PostgreSQL local ${TEST_DATABASE}`);
  }
  return raw;
}

// Solo TEST_DATABASE_URL, y DATABASE_URL ausente: sin fallback posible a la base real.
function testDatabaseUrl(env = process.env) {
  if (env.NODE_ENV !== "test") throw new Error("BLOQUEO: NODE_ENV debe ser test");
  if (env.DATABASE_URL) throw new Error("BLOQUEO: DATABASE_URL debe estar ausente durante las pruebas");
  if (!env.TEST_DATABASE_URL) throw new Error("BLOQUEO: falta PostgreSQL real de prueba (TEST_DATABASE_URL)");
  return assertLocalTestUrl(env.TEST_DATABASE_URL);
}

// Funciones calificadas con pg_catalog: un search_path inyectado no puede suplantarlas.
async function assertDisposableTestDatabase(queryable) {
  const target = (await queryable.query(`SELECT pg_catalog.current_database() AS name,
      pg_catalog.inet_server_addr() IN (inet '127.0.0.1', inet '::1') AS loopback,
      pg_catalog.shobj_description(d.oid, 'pg_database') AS marker
    FROM pg_catalog.pg_database d WHERE d.datname = pg_catalog.current_database()`)).rows[0];
  if (!target || target.name !== TEST_DATABASE || target.loopback !== true || target.marker !== TEST_MARKER) {
    throw new Error(`BLOQUEO: el servidor no es la base local ${TEST_DATABASE} marcada como desechable`);
  }
}

module.exports = { TEST_DATABASE, TEST_MARKER, assertLocalTestUrl, testDatabaseUrl, assertDisposableTestDatabase };
