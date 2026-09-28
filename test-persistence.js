"use strict";

// Ejecutar solo con TEST_DATABASE_URL de una instancia PostgreSQL desechable.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Pool } = require("pg");
const { migrate } = require("./db/migrate");
const { createPool, poolConfig } = require("./db/pool");
const { TEST_MARKER, assertDisposableTestDatabase, testDatabaseUrl } = require("./db/test-target");
const { withTransaction } = require("./db/transaction");
const repo = require("./repositories/core");

const uuid = () => crypto.randomUUID();
const order = (folio = `TEST-${uuid()}`) => ({
  id: uuid(), folio, currency: "MXN", subtotalCentavos: 10000,
  shippingCentavos: 1500, totalCentavos: 11500
});
const item = (orderId, sku = "TEST-SKU") => ({
  orderId, sku, title: "Pieza de prueba", quantity: 1,
  unitPriceCentavos: 10000, lineTotalCentavos: 10000
});

async function expectPgCode(operation, code) {
  await assert.rejects(operation, error => error && error.code === code);
}

async function main() {
  const url = testDatabaseUrl();
  const target = new URL(url);
  const guard = env => () => testDatabaseUrl({ NODE_ENV: "test", ...env });
  const remote = new URL(url);
  remote.hostname = "db.invalid";
  assert.throws(guard({ TEST_DATABASE_URL: remote.href }), /BLOQUEO/);
  const otherDatabase = new URL(url);
  otherDatabase.pathname = "/otra_base";
  assert.throws(guard({ TEST_DATABASE_URL: otherDatabase.href }), /BLOQUEO/);
  const productionAlias = new URL(url);
  productionAlias.hostname = target.hostname === "localhost" ? "127.0.0.1" : "localhost";
  assert.throws(guard({ TEST_DATABASE_URL: url, DATABASE_URL: productionAlias.href }), /BLOQUEO/);
  assert.throws(guard({ DATABASE_URL: url }), /BLOQUEO/);
  assert.throws(() => testDatabaseUrl({ NODE_ENV: "production", TEST_DATABASE_URL: url }), /BLOQUEO/);
  process.stdout.write("✓ Destinos remotos, otras bases y entorno de producción rechazados\n");

  // Aunque DATABASE_URL apareciera a mitad de la ejecución, en test el pool no la toma.
  assert.throws(() => createPool(), /BLOQUEO/);
  assert.throws(() => createPool({ url: remote.href }), /BLOQUEO/);
  process.env.DATABASE_URL = remote.href;
  try {
    assert.throws(() => createPool(), /BLOQUEO/);
    // Ni declarándose producción: el entorno lo fija NODE_ENV, no el llamador.
    assert.throws(() => createPool({ url: remote.href, environment: "production", tls: "verify-full" }), /BLOQUEO/);
    assert.throws(() => createPool({ environment: "production" }), /BLOQUEO/);
  } finally {
    delete process.env.DATABASE_URL;
  }
  const serverSays = row => ({ query: async () => ({ rows: [row] }) });
  const marked = { name: "valquiria_test", loopback: true, marker: TEST_MARKER };
  await assertDisposableTestDatabase(serverSays(marked));
  for (const forged of [{ ...marked, marker: null }, { ...marked, name: "valquiria" }, { ...marked, loopback: null }]) {
    await assert.rejects(() => assertDisposableTestDatabase(serverSays(forged)), /BLOQUEO/);
  }
  process.stdout.write("✓ Sin fallback a DATABASE_URL; base sin marca, con otro nombre o no local rechazada\n");

  const tlsTarget = new URL(url);
  tlsTarget.hostname = "db.invalid";
  // La configuración de producción se prueba con la función pura: sin pool, sin conexión posible.
  assert.throws(() => poolConfig({ url: tlsTarget.href, tls: "disable", environment: "production" }), /TLS verificado/);
  const unsafeTlsTarget = new URL(tlsTarget);
  unsafeTlsTarget.searchParams.set("sslmode", "no-verify");
  assert.throws(() => poolConfig({ url: unsafeTlsTarget.href, tls: "verify-full", environment: "production" }), /Opciones TLS/);
  assert.throws(() => poolConfig({ url: tlsTarget.href, poolMax: "0", environment: "production" }), /DB_POOL_MAX/);
  const productionConfig = poolConfig({ url: tlsTarget.href, tls: "verify-full", environment: "production" });
  assert.equal(productionConfig.ssl.rejectUnauthorized, true);
  assert.equal(productionConfig.ssl.servername, "db.invalid");
  assert.equal(poolConfig({ url: tlsTarget.href, environment: "production" }).ssl.rejectUnauthorized, true);
  process.stdout.write("✓ Pool: TLS de producción y límites de configuración; el llamador no elige entorno\n");

  const schema = `phase2a_test_${crypto.randomBytes(8).toString("hex")}`;
  const admin = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 5000 });
  let testPool;
  let temporary;
  let schemaCreated = false;
  try {
    await assertDisposableTestDatabase(admin);
    await admin.query(`CREATE SCHEMA ${schema}`);
    schemaCreated = true;
    testPool = new Pool({
      connectionString: url, max: 4, connectionTimeoutMillis: 5000,
      options: `-c search_path=${schema}`
    });
    const activeSchema = (await testPool.query("SELECT current_schema() AS name")).rows[0].name;
    if (activeSchema !== schema) throw new Error("El search_path de pruebas no está aislado");
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), "valquiria-migrations-"));
    const source = await fs.readFile(path.join(__dirname, "db/migrations/001_core.sql"), "utf8");
    const migration = path.join(temporary, "001_core.sql");
    await fs.writeFile(migration, source);

    assert.deepEqual(await migrate(testPool, temporary), { applied: 1, total: 1 });
    assert.deepEqual(await migrate(testPool, temporary), { applied: 0, total: 1 });
    assert.equal((await testPool.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n, 1);
    process.stdout.write("✓ Migración vacía y repetida\n");

    await fs.writeFile(migration, `${source}\n-- Cambio después de aplicar\n`);
    await assert.rejects(() => migrate(testPool, temporary), /Checksum/);
    await fs.writeFile(migration, source);
    process.stdout.write("✓ Checksum alterado detectado\n");

    const failedMigration = path.join(temporary, "002_failed.sql");
    await fs.writeFile(failedMigration, "CREATE TABLE partial_probe (id integer); SELECT * FROM does_not_exist;");
    await assert.rejects(() => migrate(testPool, temporary));
    assert.equal((await testPool.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n, 1);
    assert.equal((await testPool.query("SELECT to_regclass('partial_probe') AS found")).rows[0].found, null);
    await fs.unlink(failedMigration);
    process.stdout.write("✓ Fallo parcial revertido y sin registro de migración\n");

    const created = order();
    await withTransaction(testPool, async client => {
      await repo.insertOrder(client, created);
      await repo.insertOrderItem(client, item(created.id));
      await repo.insertPaymentAttempt(client, {
        id: uuid(), orderId: created.id, requestFingerprint: "a".repeat(64), providerKey: `TEST-${uuid()}`
      });
    });
    assert.equal((await repo.getOrderByFolio(testPool, created.folio)).id, created.id);
    process.stdout.write("✓ Repositorios: commit y lectura\n");

    const rolledBack = order();
    await expectPgCode(() => withTransaction(testPool, async client => {
      await repo.insertOrder(client, rolledBack);
      await repo.insertOrderItem(client, { ...item(rolledBack.id), quantity: 0 });
    }), "23514");
    assert.equal(await repo.getOrderByFolio(testPool, rolledBack.folio), null);
    process.stdout.write("✓ Transacción: rollback completo tras escritura inicial\n");

    const sharedFolio = `TEST-${uuid()}`;
    const [firstConnection, secondConnection] = await Promise.all([testPool.connect(), testPool.connect()]);
    let concurrent;
    try {
      concurrent = await Promise.allSettled([
        repo.insertOrder(firstConnection, order(sharedFolio)),
        repo.insertOrder(secondConnection, order(sharedFolio))
      ]);
    } finally {
      firstConnection.release();
      secondConnection.release();
    }
    assert.equal(concurrent.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(concurrent.filter(result => result.status === "rejected" && result.reason.code === "23505").length, 1);
    process.stdout.write("✓ Folio único bajo dos conexiones\n");

    await expectPgCode(() => repo.insertOrder(testPool, { ...order(), totalCentavos: -1 }), "23514");
    await expectPgCode(() => repo.insertOrder(testPool, { ...order(), currency: "USD" }), "23514");
    await expectPgCode(() => repo.insertOrderItem(testPool, item(uuid())), "23503");
    await expectPgCode(() => repo.insertOrderItem(testPool, { ...item(created.id, "OTRO"), quantity: -1 }), "23514");
    await expectPgCode(() => testPool.query("INSERT INTO inventory(sku,on_hand) VALUES($1,$2)", ["BAD", -1]), "23514");
    await assert.rejects(() => repo.insertOrder(testPool, { ...order(), subtotalCentavos: Number.MAX_SAFE_INTEGER + 1 }), /enteros seguros/);
    await assert.rejects(() => repo.insertOrder(testPool, { ...order(), subtotalCentavos: "9223372036854775808" }), /fuera de rango/);
    const exactLarge = 9007199254740993n;
    const largeOrder = await repo.insertOrder(testPool, {
      ...order(), subtotalCentavos: exactLarge, shippingCentavos: 0n, totalCentavos: exactLarge
    });
    assert.equal(largeOrder.total_centavos, exactLarge.toString());
    process.stdout.write("✓ Constraints de importe, moneda, FK, cantidad y stock; centavos grandes exactos\n");

    const paymentId = `payment-${uuid()}`;
    const [paymentConnectionA, paymentConnectionB] = await Promise.all([testPool.connect(), testPool.connect()]);
    let paymentWrites;
    try {
      paymentWrites = await Promise.allSettled([
        paymentConnectionA.query("INSERT INTO payments(id,provider_payment_id,order_id) VALUES($1,$2,$3)", [uuid(), paymentId, created.id]),
        paymentConnectionB.query("INSERT INTO payments(id,provider_payment_id,order_id) VALUES($1,$2,$3)", [uuid(), paymentId, created.id])
      ]);
    } finally {
      paymentConnectionA.release();
      paymentConnectionB.release();
    }
    assert.equal(paymentWrites.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(paymentWrites.filter(result => result.status === "rejected" && result.reason.code === "23505").length, 1);
    process.stdout.write("✓ Payment ID único bajo dos conexiones\n");

    const unrelated = order();
    await repo.insertOrder(testPool, unrelated);
    const attemptId = uuid();
    await repo.insertPaymentAttempt(testPool, {
      id: attemptId, orderId: created.id, requestFingerprint: "b".repeat(64), providerKey: `TEST-${uuid()}`
    });
    await expectPgCode(() => testPool.query(
      "INSERT INTO payments(id,provider_payment_id,order_id,attempt_id) VALUES($1,$2,$3,$4)",
      [uuid(), `payment-${uuid()}`, unrelated.id, attemptId]), "23503");
    await expectPgCode(() => testPool.query(
      "INSERT INTO payment_attempts(id,order_id,request_fingerprint,provider_key,state) VALUES($1,$2,$3,$4,'ready')",
      [uuid(), created.id, "c".repeat(64), `TEST-${uuid()}`]), "23514");
    await expectPgCode(() => testPool.query(
      "INSERT INTO payments(id,provider_payment_id,order_id,status) VALUES($1,$2,$3,'approved')",
      [uuid(), `payment-${uuid()}`, created.id]), "23514");
    process.stdout.write("✓ Intento de otra orden rechazado\n");

    await testPool.query("INSERT INTO inventory(sku,on_hand) VALUES($1,$2)", ["TEST-SKU", 2]);
    const reservationValues = [created.id, "TEST-SKU", 1];
    await testPool.query("INSERT INTO inventory_reservations(order_id,sku,quantity,expires_at) VALUES($1,$2,$3,now() + interval '15 minutes')", reservationValues);
    await expectPgCode(() => testPool.query(
      "INSERT INTO inventory_reservations(order_id,sku,quantity,expires_at) VALUES($1,$2,$3,now() + interval '15 minutes')", reservationValues), "23505");
    await expectPgCode(() => testPool.query(
      "INSERT INTO inventory_reservations(order_id,sku,quantity,expires_at) VALUES($1,$2,$3,now() + interval '15 minutes')",
      [unrelated.id, "TEST-SKU", 1]), "23503");
    await testPool.query("INSERT INTO inventory_movements(id,sku,order_id,kind,delta,operation_key) VALUES($1,$2,$3,'sale',-1,$4)",
      [uuid(), "TEST-SKU", created.id, `sale-${uuid()}`]);
    await expectPgCode(() => testPool.query(
      "INSERT INTO inventory_movements(id,sku,order_id,kind,delta,operation_key) VALUES($1,$2,$3,'sale',-1,$4)",
      [uuid(), "TEST-SKU", created.id, `sale-${uuid()}`]), "23505");
    process.stdout.write("✓ Reserva por línea y una venta por orden/SKU\n");

    const eventId = `event-${uuid()}`;
    await testPool.query("INSERT INTO payment_events(id,source,external_event_id,provider_payment_id) VALUES($1,'webhook',$2,$3)",
      [uuid(), eventId, paymentId]);
    await expectPgCode(() => testPool.query(
      "INSERT INTO payment_events(id,source,external_event_id,provider_payment_id) VALUES($1,'webhook',$2,$3)",
      [uuid(), eventId, paymentId]), "23505");
    const duplicateKey = `notice-${uuid()}`;
    await testPool.query("INSERT INTO outbox(id,order_id,entity_version,event_type,channel,dedupe_key) VALUES($1,$2,1,'approved','telegram',$3)",
      [uuid(), created.id, duplicateKey]);
    await expectPgCode(() => testPool.query(
      "INSERT INTO outbox(id,order_id,entity_version,event_type,channel,dedupe_key) VALUES($1,$2,1,'approved','telegram',$3)",
      [uuid(), created.id, duplicateKey]), "23505");
    process.stdout.write("✓ Evento y aviso deduplicados\n");

    const resilient = createPool({ url });
    try {
      const pid = (await resilient.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      // Sin listener propio de la prueba: si createPool no manejara 'error', el proceso moriría aquí.
      await admin.query("SELECT pg_terminate_backend($1)", [pid]);
      for (let waited = 0; resilient.totalCount > 0; waited += 20) {
        if (waited > 2000) throw new Error("El pool no descartó la conexión cerrada por el servidor");
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal((await resilient.query("SELECT 1 AS ok")).rows[0].ok, 1);
    } finally {
      await resilient.end();
    }
    process.stdout.write("✓ Pool sobrevive a una conexión cerrada por el servidor y reconecta\n");
    process.stdout.write("✓ Fase 2A: PostgreSQL real; todas las pruebas pasaron\n");
  } finally {
    try {
      if (testPool) await testPool.end();
    } finally {
      try {
        if (schemaCreated) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      } finally {
        try { await admin.end(); } finally {
          if (temporary) await fs.rm(temporary, { recursive: true, force: true });
        }
      }
    }
  }
}

main().catch(error => {
  // No imprimir URLs, parámetros SQL, PII ni posibles credenciales de conexión.
  process.stderr.write(error.message.startsWith("BLOQUEO:") ? `${error.message}\n` : "Prueba PostgreSQL fallida; revisa la instancia de test y los asserts.\n");
  process.exitCode = 1;
});
