"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { createPool } = require("./db/pool");
const { testDatabaseUrl, assertDisposableTestDatabase } = require("./db/test-target");
const { config, providerObservation } = require("./services/postgres-runtime");

const uncertainMessage = "No pudimos confirmar el estado de tu intento de pago. Para evitar un posible cobro duplicado, no vuelvas a pagar por ahora. Conservamos el intento para conciliación.";
function assertUncertain(result) {
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { error: uncertainMessage });
  assert.doesNotMatch(JSON.stringify(result.body), /uncertain|creating|payment_attempts|stack|pref-|recover-key|mp_http|unos minutos|estamos verificando/i);
}

const buyer = { nombre: "Ana Prueba", whatsapp: "5550000000", email: "ana@example.test",
  cp: "03330", direccion: "Av. Prueba 123, Ciudad de México" };
const adminToken = "panel-sintetico-de-pruebas-0123456789012345";
const hashKey = "ab".repeat(32);
const secret = "firma-sintetica-exclusiva-de-pruebas";
let passed = 0;
let currentTest = "guardas";
async function test(name, work) {
  currentTest = name;
  await work();
  passed++;
  process.stdout.write(`✓ ${name}\n`);
}
const listen = server => new Promise((resolve, reject) => {
  server.once("error", reject).listen(0, "127.0.0.1", () => resolve(server.address().port));
});
async function start(extra, mpUrl) {
  const probe = http.createServer();
  const port = await listen(probe);
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    cwd: __dirname,
    env: { PATH: process.env.PATH, NODE_ENV: "test", PORT: String(port), PERSISTENCIA: "postgres",
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL, DATABASE_TLS: "disable",
      COMMERCE_HMAC_KEY: hashKey, MP_ACCOUNT_ID: "test-account", MP_ENVIRONMENT: "sandbox",
      GEMINI_API_KEY: "sintetica-no-se-usa", MP_ACCESS_TOKEN: "sintetico-no-real",
      MP_WEBHOOK_SECRET: secret, MP_API_URL: mpUrl, AVISOS_SILENCIO: "1", ALMACEN_RUTA: "",
      LEADS_TOKEN: adminToken, RATE_LIMIT_PAGO_POR_MINUTO: "1000",
      RATE_LIMIT_PAGO_POR_DIA: "10000", RATE_LIMIT_ADMIN_POR_MINUTO: "1000",
      RATE_LIMIT_PULSO_POR_MINUTO: "1000", DB_CONNECT_TIMEOUT_MS: "300",
      ...extra }, stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  child.stdout.on("data", b => { logs += b; });
  child.stderr.on("data", b => { logs += b; });
  let base;
  for (let i = 0; i < 100; i++) {
    const found = logs.match(/Activo en puerto (\d+)/);
    if (found) { base = `http://127.0.0.1:${found[1]}`; break; }
    if (child.exitCode !== null) throw new Error("Servidor no arrancó (logs privados omitidos)");
    await new Promise(r => setTimeout(r, 40));
  }
  if (!base) { child.kill("SIGKILL"); throw new Error("Servidor no anunció el puerto"); }
  return { base, logs: () => logs, stop: async () => {
    if (child.exitCode !== null) return;
    await new Promise(resolve => { child.once("exit", resolve); child.kill("SIGTERM"); });
  } };
}
async function request(app, route, body, headers = {}) {
  const response = await fetch(app.base + route, { method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  return { status: response.status, body: await response.json() };
}

async function main() {
  // Nunca heredar DATABASE_URL/.env/credenciales reales. Confirmar marcador antes de DDL.
  const url = testDatabaseUrl();
  const pool = createPool({ url });
  const pool2 = createPool({ url });
  await assertDisposableTestDatabase(pool);
  await assertDisposableTestDatabase(pool2);
  const applications = new Set();
  const fixtureDirectories = [];
  let preferences = 0, preferenceMode = 200, notifyMode = 200, paymentQueries = 0;
  const prefs = new Map(), payments = new Map(), notices = [];
  const logCopies = [];
  const fake = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
    const reply = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    try {
      if (req.url === "/checkout/preferences") {
        preferences++;
        const key = req.headers["x-idempotency-key"];
        const persisted = (await pool2.query(`SELECT o.id,a.id AS attempt_id FROM orders o
          JOIN payment_attempts a ON a.order_id=o.id WHERE o.folio=$1`, [body.external_reference])).rows[0];
        assert.ok(persisted, "TX1 debe ser visible desde otro pool antes de MP");
        assert.equal(persisted.attempt_id, body.metadata.attempt_id);
        const free = await pool2.query("SELECT pg_try_advisory_xact_lock(482003741930211) AS free");
        assert.equal(free.rows[0].free, true, "MP fuera de TX/lock inventario");
        if (preferenceMode !== 200 && preferenceMode !== "disconnect") return reply(preferenceMode, { message: "error-sintetico-privado" });
        const prior = prefs.get(key);
        if (prior) assert.deepEqual(body, prior.body, "reintento conserva payload completo");
        const saved = prior || { body, id: `pref-${prefs.size + 1}` };
        prefs.set(key, saved);
        if (preferenceMode === "disconnect") return res.destroy();
        return reply(200, { id: saved.id, init_point: `https://www.mercadopago.com.mx/checkout/${saved.id}` });
      }
      if (req.url.startsWith("/v1/payments/")) {
        paymentQueries++;
        const data = payments.get(decodeURIComponent(req.url.split("/").pop()));
        return reply(data ? 200 : 404, data || {});
      }
      if (req.url.includes(":generateContent")) {
        const responded = body.contents.at(-1).parts.some(p => p.functionResponse);
        return reply(200, { candidates: [{ content: { role: "model", parts: responded ? [] : [{
          functionCall: { name: "calcular_cotizacion", args: { accion: "agregar", items: [{ producto: "endo", cantidad: 1 }] } }
        }] }, finishReason: "STOP" }] });
      }
      if (req.url === "/notify") {
        if (notifyMode === 200) {
          const durable = (await pool2.query("SELECT payment_state,fulfillment_state FROM orders WHERE folio=$1", [body.folio])).rows[0];
          assert.equal(durable.payment_state, "approved");
          assert.equal(durable.fulfillment_state, "allocated");
          notices.push({ key: req.headers["x-idempotency-key"], body });
        }
        return reply(notifyMode, {});
      }
      reply(404, {});
    } catch { reply(500, { message: "invariante del proveedor falso" }); }
  });
  const fakePort = await listen(fake);
  const fakeUrl = `http://127.0.0.1:${fakePort}`;
  async function boot(extra = {}) {
    const app = await start({ PEDIDOS_WEBHOOK_URL: `${fakeUrl}/notify`, GEMINI_BASE_URL: fakeUrl, ENVIOS_PROVEEDOR: "tabla", ...extra }, fakeUrl);
    applications.add(app);
    return app;
  }
  async function stop(app) { logCopies.push(app.logs()); await app.stop(); applications.delete(app); }
  async function reset() {
    for (const app of [...applications]) await stop(app);
    await assertDisposableTestDatabase(pool);
    await pool.query(`TRUNCATE outbox,audit_events,payment_events,payments,inventory_movements,
      inventory_reservations,payment_attempts,order_items,orders,inventory`);
    await pool.query("INSERT INTO inventory(sku,on_hand) VALUES('ValEnd',50),('ValPulpo',50),('ValNis',50)");
    preferences = 0; paymentQueries = 0; preferenceMode = 200; notifyMode = 200;
    prefs.clear(); payments.clear(); notices.length = 0;
  }
  const input = (extra = {}) => ({ items: [{ sku: "ValEnd", cantidad: 1 }], comprador: buyer,
    visitante: crypto.randomUUID(), ...extra });
  async function checkout(app, data = input(), key) {
    return request(app, "/api/pago", data, key ? { "Idempotency-Key": key } : {});
  }
  async function row(folio) { return (await pool.query("SELECT * FROM orders WHERE folio=$1", [folio])).rows[0]; }
  const count = async table => {
    // Lista cerrada de identificadores del fixture, no datos del HTTP.
    assert.ok(["orders", "payment_attempts", "inventory_reservations", "inventory_movements", "payments", "payment_events", "outbox"].includes(table));
    return Number((await pool.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
  };
  async function paid(folio, id = crypto.randomUUID(), overrides = {}) {
    const order = await row(folio);
    const attempt = (await pool.query("SELECT id FROM payment_attempts WHERE order_id=$1", [order.id])).rows[0];
    payments.set(id, { id, status: "approved", transaction_amount: Number(order.total_centavos) / 100,
      currency_id: "MXN", external_reference: folio, metadata: { attempt_id: attempt.id },
      collector_id: "test-account", live_mode: false, payment_type_id: "credit_card",
      // Secreto/PII sintéticos en provider payload: deben excluirse del SQL y logs.
      payer: { email: "provider-pii@example.test" }, card: { token: "provider-secret-sintetico" }, ...overrides });
    return id;
  }
  async function webhook(app, id, valid = true) {
    const requestId = crypto.randomUUID(), ts = String(Math.floor(Date.now() / 1000));
    const signature = crypto.createHmac("sha256", secret).update(`id:${id};request-id:${requestId};ts:${ts};`).digest("hex");
    return request(app, "/api/pago/webhook", { type: "payment", data: { id } }, {
      "x-request-id": requestId, "x-signature": `ts=${ts},v1=${valid ? signature : "0".repeat(64)}` });
  }
  async function successful(app, data, key) {
    const result = await checkout(app, data, key);
    assert.equal(result.status, 200);
    assert.equal(await count("orders") > 0, true);
    return result.body.folio;
  }
  async function fault(table, operation, body, work) {
    assert.ok(["orders", "payment_attempts", "payments"].includes(table));
    await pool.query(`CREATE FUNCTION commerce_test_fault() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN ${body}; RETURN NEW; END; $f$`);
    await pool.query(`CREATE TRIGGER commerce_test_fault BEFORE ${operation} ON ${table}
      FOR EACH ROW EXECUTE FUNCTION commerce_test_fault()`);
    try { await work(); }
    finally {
      await pool.query(`DROP TRIGGER commerce_test_fault ON ${table}`);
      await pool.query("DROP FUNCTION commerce_test_fault()");
    }
  }
  try {
    await test("config fail-closed: HMAC sin default, >=32 bytes; cuenta y entorno explícitos", async () => {
      const base = { COMMERCE_HMAC_KEY: hashKey, MP_ACCOUNT_ID: "test-account", MP_ENVIRONMENT: "sandbox", NODE_ENV: "test" };
      assert.equal(config(base).key.length, 32);
      for (const overrides of [{ COMMERCE_HMAC_KEY: undefined }, { COMMERCE_HMAC_KEY: "ab" },
        { MP_ACCOUNT_ID: undefined }, { MP_ENVIRONMENT: "invalid" }, { NODE_ENV: "production" }, { PERSISTENCIA: "invalid" }]) {
        assert.throws(() => config({ ...base, ...overrides }), /commerce_unavailable/);
      }
    });
    await reset();
    const unavailable = "postgresql://valquiria_test@127.0.0.1:1/valquiria_test";
    let app = await boot({ TEST_DATABASE_URL: unavailable });
    await test("SQL caída: checkout 503, cero preferencias y proceso vivo", async () => {
      const result = await checkout(app);
      assert.equal(result.status, 503);
      assert.equal(preferences, 0);
      assert.deepEqual((await request(app, "/health")).body, { ok: true });
      assert.doesNotMatch(JSON.stringify(result.body), /postgres|valquiria_test|SELECT|localhost|127\.0\.0\.1/i);
      assert.doesNotMatch(result.body.error, /Conservamos el intento|posible cobro duplicado/);
    });
    await reset(); app = await boot();
    await test("conexión SQL cortada DURANTE TX1: rollback total, cero MP y 503", async () => {
      await fault("orders", "INSERT", "PERFORM pg_terminate_backend(pg_backend_pid())", async () => {
        assert.equal((await checkout(app)).status, 503);
        assert.equal(await count("orders"), 0);
        assert.equal(await count("inventory_reservations"), 0);
        assert.equal(preferences, 0);
      });
    });
    await test("MP 500 después de commit: pedido/intent uncertain durable, reserva acotada", async () => {
      preferenceMode = 500;
      assertUncertain(await checkout(app));
      assert.equal(await count("orders"), 1);
      assert.equal(preferences, 1);
      const a = (await pool.query("SELECT state,expires_at,next_check_at FROM payment_attempts")).rows[0];
      assert.equal(a.state, "uncertain"); assert.ok(a.expires_at && a.next_check_at);
    });
    await reset(); app = await boot();
    await test("MP crea preferencia y corta conexión: mensaje seguro inicial/retry/restart, sin segundo POST", async () => {
      const data = input();
      preferenceMode = "disconnect";
      assertUncertain(await checkout(app, data, "disconnect-key-0001"));
      assert.equal(prefs.size, 1); assert.equal(preferences, 1);
      const before = (await pool.query("SELECT id,state,retry_count,expires_at FROM payment_attempts")).rows[0];
      assert.equal(before.state, "uncertain"); assert.equal(before.retry_count, 1);
      assert.ok(before.expires_at > new Date());
      assertUncertain(await checkout(app, data, "disconnect-key-0001"));
      await stop(app); app = await boot();
      assertUncertain(await checkout(app, data, "disconnect-key-0001"));
      assert.equal(preferences, 1); assert.equal(prefs.size, 1);
      assert.equal(await count("orders"), 1); assert.equal(await count("inventory_movements"), 0);
      const after = (await pool.query("SELECT id,state,retry_count,expires_at FROM payment_attempts")).rows[0];
      assert.deepEqual(after, before);
      await pool.query("UPDATE payment_attempts SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [before.id]);
      assertUncertain(await checkout(app, data, "disconnect-key-0001"));
      assert.equal(preferences, 1); assert.equal(await count("inventory_movements"), 0);
    });
    await reset(); app = await boot();
    await test("MP 400 definitivo libera reservas, no inventario ni venta", async () => {
      preferenceMode = 400;
      const data = input();
      const result = await checkout(app, data, "failed-key-0001");
      assert.equal(result.status, 503);
      assert.doesNotMatch(result.body.error, /posible cobro duplicado|Conservamos el intento/);
      assert.equal((await pool.query("SELECT state FROM payment_attempts")).rows[0].state, "failed");
      assert.equal((await pool.query("SELECT state FROM inventory_reservations")).rows[0].state, "released");
      assert.equal(await count("inventory_movements"), 0);
      const retry = await checkout(app, data, "failed-key-0001");
      assert.equal(retry.status, 503);
      assert.doesNotMatch(retry.body.error, /posible cobro duplicado|Conservamos el intento/);
      assert.equal(preferences, 1);
    });
    await reset(); app = await boot();
    await test("fallo TX2/restart: intento uncertain durable, cero POST ciego/segunda preferencia", async () => {
      const data = input();
      await fault("payment_attempts", "UPDATE", "IF NEW.state='ready' THEN RAISE EXCEPTION 'secret-sql-sintetico'; END IF", async () => {
        assertUncertain(await checkout(app, data, "recover-key-0001"));
      });
      assert.equal(prefs.size, 1);
      assert.equal((await pool.query("SELECT state FROM payment_attempts")).rows[0].state, "creating");
      await stop(app);
      await pool.query("UPDATE payment_attempts SET lease_until=clock_timestamp()-interval '1 second'");
      app = await boot();
      assertUncertain(await checkout(app, data, "recover-key-0001"));
      assert.equal(preferences, 1); assert.equal(prefs.size, 1); assert.equal(await count("orders"), 1);
      assert.equal((await pool.query("SELECT state FROM payment_attempts")).rows[0].state, "uncertain");
      const admin = await request(app, "/api/admin/resumen", undefined, { "x-leads-token": adminToken });
      assert.equal(admin.body.intentos_inciertos.length, 1);
    });
    await reset(); app = await boot();
    let folio, paymentId;
    await test("firma inválida antes de consulta/SQL: cero efectos", async () => {
      assert.equal((await webhook(app, "fake-unsigned", false)).status, 401);
      assert.equal(paymentQueries, 0); assert.equal(await count("payment_events"), 0);
    });
    await test("webhook duplicado: un evento, pago y movimiento; 200 sólo tras commit", async () => {
      folio = await successful(app); paymentId = await paid(folio);
      assert.equal((await webhook(app, paymentId)).status, 200);
      assert.equal((await webhook(app, paymentId)).body.repetido, true);
      assert.equal(await count("payment_events"), 1); assert.equal(await count("payments"), 1);
      assert.equal(await count("inventory_movements"), 1);
      assert.equal((await row(folio)).fulfillment_state, "allocated");
    });
    await test("approved repetido desde proceso/pool nuevos no consume dos veces", async () => {
      await stop(app); app = await boot();
      assert.equal((await webhook(app, paymentId)).body.repetido, true);
      assert.equal(await count("inventory_movements"), 1);
    });
    await test("pending tardío no degrada approved ni repone inventario", async () => {
      payments.get(paymentId).status = "pending";
      assert.equal((await webhook(app, paymentId)).body.repetido, true);
      assert.equal((await row(folio)).payment_state, "approved");
      assert.equal((await pool.query("SELECT on_hand FROM inventory WHERE sku='ValEnd'")).rows[0].on_hand, 49);
    });
    await test("restart REAL: proceso A termina; B recupera pago/reserva/public/admin sin RAM", async () => {
      await stop(app); app = await boot();
      const publicResult = await request(app, `/api/pedido/${folio}`);
      assert.equal(publicResult.status, 200); assert.equal(publicResult.body.estado, "approved");
      assert.equal((await pool2.query("SELECT state FROM inventory_reservations")).rows[0].state, "consumed");
      assert.equal((await request(app, "/api/admin/resumen")).status, 404);
      const admin = await request(app, "/api/admin/resumen", undefined, { "x-leads-token": adminToken });
      assert.equal(admin.status, 200); assert.equal(admin.body.pedidos.length, 1);
      assert.equal(admin.body.pedidos[0].email, buyer.email);
      assert.equal(admin.body.dinero.pagados, 1); assert.equal(admin.body.persistencia.schema_compatible, true);
      assert.equal(admin.body.hoy.fuente, "postgres");
      assert.deepEqual(Object.keys(publicResult.body).sort(), ["ok", "folio", "estado", "total", "total_centavos", "creado"].sort());
      assert.doesNotMatch(JSON.stringify(publicResult.body), /Ana|5550000000|example.test|Prueba 123|03330|buyer|direccion/i);
    });
    await test("payment ID asociado a otro pedido: review, sin reasociar ni nuevo stock", async () => {
      const other = await successful(app);
      const second = await row(other), attempt = (await pool.query("SELECT id FROM payment_attempts WHERE order_id=$1", [second.id])).rows[0];
      payments.set(paymentId, { ...payments.get(paymentId), status: "approved", external_reference: other,
        transaction_amount: Number(second.total_centavos) / 100, metadata: { attempt_id: attempt.id } });
      assert.equal((await webhook(app, paymentId)).body.revision, true);
      assert.equal(await count("inventory_movements"), 1);
      assert.equal((await pool.query("SELECT order_id FROM payments WHERE provider_payment_id=$1", [paymentId])).rows[0].order_id, (await row(folio)).id);
      assert.equal((await row(other)).payment_state, "pending");
    });
    await reset(); app = await boot();
    await test("webhooks simultáneos en DOS procesos/pools reales: un consumo", async () => {
      const b = await boot();
      folio = await successful(app); paymentId = await paid(folio);
      const results = await Promise.all([webhook(app, paymentId), webhook(b, paymentId)]);
      assert.deepEqual(results.map(r => r.status), [200, 200]);
      assert.equal(results.filter(r => r.body.repetido).length, 1);
      assert.equal(await count("inventory_movements"), 1); assert.equal(await count("payment_events"), 1);
    });
    await reset(); app = await boot();
    await test("aprobado tras reserva expirada CON stock: asignación íntegra", async () => {
      folio = await successful(app); paymentId = await paid(folio);
      await pool.query("UPDATE inventory_reservations SET created_at=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '1 second'");
      assert.equal((await webhook(app, paymentId)).body.revision, false);
      assert.equal((await row(folio)).fulfillment_state, "allocated");
      assert.equal(await count("inventory_movements"), 1);
    });
    await reset(); app = await boot();
    await test("aprobado tras reserva expirada SIN stock: pago durable, paid_unallocated, cero surtido", async () => {
      folio = await successful(app); paymentId = await paid(folio);
      await pool.query("UPDATE inventory_reservations SET created_at=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '1 second'");
      await pool.query("UPDATE inventory SET on_hand=0 WHERE sku='ValEnd'");
      assert.equal((await webhook(app, paymentId)).body.revision, true);
      const order = await row(folio);
      assert.equal(order.payment_state, "approved"); assert.equal(order.fulfillment_state, "paid_unallocated");
      assert.equal(await count("payments"), 1); assert.equal(await count("inventory_movements"), 0);
      assert.equal(Number((await pool.query("SELECT count(*) AS n FROM outbox WHERE event_type='pago_revision'")).rows[0].n), 1);
      assert.equal(Number((await pool.query("SELECT count(*) AS n FROM outbox WHERE channel='orders_webhook'")).rows[0].n), 0);
    });
    await reset(); app = await boot();
    await test("amount mismatch: review durable, cero inventario/surtido", async () => {
      folio = await successful(app); paymentId = await paid(folio, crypto.randomUUID(), { transaction_amount: 0.01 });
      assert.equal((await webhook(app, paymentId)).body.revision, true);
      assert.equal((await row(folio)).review_reason, "amount");
      assert.equal(await count("inventory_movements"), 0);
    });
    await reset(); app = await boot();
    await test("dos compradores/última unidad: pagos simultáneos, sólo UNO asignado (dos pools)", async () => {
      const b = await boot();
      const first = await successful(app), second = await successful(b);
      const ids = [await paid(first), await paid(second)];
      await pool.query("UPDATE inventory_reservations SET created_at=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '1 second'");
      await pool.query("UPDATE inventory SET on_hand=1 WHERE sku='ValEnd'");
      const results = await Promise.all([webhook(app, ids[0]), webhook(b, ids[1])]);
      assert.deepEqual(results.map(r => r.status), [200, 200]);
      const states = [await row(first), await row(second)].map(o => o.fulfillment_state).sort();
      assert.deepEqual(states, ["allocated", "paid_unallocated"]);
      assert.equal(await count("inventory_movements"), 1);
      assert.equal((await pool2.query("SELECT on_hand FROM inventory WHERE sku='ValEnd'")).rows[0].on_hand, 0);
    });
    await reset(); app = await boot();
    await test("multi-SKU uno agotado: no reserva parcial ni preferencia", async () => {
      await pool.query("UPDATE inventory SET on_hand=0 WHERE sku='ValPulpo'");
      const r = await checkout(app, input({ items: [{ sku: "ValEnd", cantidad: 1 }, { sku: "ValPulpo", cantidad: 1 }] }));
      assert.equal(r.status, 400); assert.equal(await count("inventory_reservations"), 0);
      assert.equal(await count("orders"), 0); assert.equal(preferences, 0);
    });
    await reset(); app = await boot({ DB_LOCK_TIMEOUT_MS: "100" });
    await test("lock timeout REAL: 503 acotado, cero MP y pool recuperable", async () => {
      const blocker = await pool2.connect();
      try {
        await blocker.query("BEGIN"); await blocker.query("SELECT pg_advisory_xact_lock(482003741930211)");
        const started = Date.now(); assert.equal((await checkout(app)).status, 503);
        assert.ok(Date.now() - started < 3000); assert.equal(preferences, 0);
      } finally { await blocker.query("ROLLBACK"); blocker.release(); }
      assert.equal((await checkout(app)).status, 200);
    });
    await reset(); app = await boot();
    await test("deadlock SQLSTATE simulado: rollback/release sin exponer detalles", async () => {
      await fault("orders", "INSERT", "RAISE EXCEPTION 'secret-sql-sintetico SELECT host' USING ERRCODE='40P01'", async () => {
        const r = await checkout(app); assert.equal(r.status, 503);
        assert.doesNotMatch(JSON.stringify(r.body), /secret-sql|SELECT|40P01|host/i);
        assert.equal(await count("orders"), 0); assert.equal(preferences, 0);
      });
      assert.equal((await checkout(app)).status, 200);
    });
    await reset(); app = await boot({ DB_STATEMENT_TIMEOUT_MS: "100" });
    await test("statement timeout REAL en prepare: rollback atómico, cliente liberado", async () => {
      await fault("orders", "INSERT", "PERFORM pg_sleep(1)", async () => {
        assert.equal((await checkout(app)).status, 503);
        assert.equal(await count("orders"), 0); assert.equal(preferences, 0);
      });
      assert.equal((await checkout(app)).status, 200);
    });
    await reset(); app = await boot();
    await test("DB cae durante webhook: 503, evento/pago/stock rollback; retry posterior aplica", async () => {
      folio = await successful(app); paymentId = await paid(folio);
      await fault("payments", "INSERT", "PERFORM pg_terminate_backend(pg_backend_pid())", async () => {
        assert.equal((await webhook(app, paymentId)).status, 503);
        assert.equal(await count("payment_events"), 0); assert.equal(await count("payments"), 0);
        assert.equal(await count("inventory_movements"), 0);
      });
      assert.equal((await webhook(app, paymentId)).status, 200);
      assert.equal(await count("inventory_movements"), 1);
    });
    await reset(); app = await boot();
    await test("caracteres hostiles y campos inesperados: SQL literal, PII operacional allowlist", async () => {
      const hostile = { ...buyer, nombre: "Ana'); DROP TABLE orders; --", direccion: "Calle 123'); DROP TABLE inventory; --",
        token: "frontend-secret-sintetico", historial: "chat-que-no-debe-persistirse", ip: "192.0.2.44" };
      folio = await successful(app, input({ comprador: hostile, precio: 0.01, status: "approved", prompt: "prompt-no-persistir" }));
      const order = await row(folio);
      assert.equal(order.buyer_name, hostile.nombre); assert.equal(order.shipping_address.direccion, hostile.direccion);
      assert.deepEqual(Object.keys(order.shipping_address).sort(), ["cp", "direccion", "referencias"]);
      assert.equal(order.payment_state, "pending"); assert.ok(BigInt(order.total_centavos) > 1n);
      assert.equal(await count("orders"), 1);
      paymentId = await paid(folio); assert.equal((await webhook(app, paymentId)).status, 200);
      const dump = JSON.stringify((await pool.query(`SELECT row_to_json(o) AS data FROM orders o UNION ALL
        SELECT row_to_json(p) FROM payments p UNION ALL SELECT row_to_json(e) FROM payment_events e
        UNION ALL SELECT row_to_json(b) FROM outbox b UNION ALL SELECT row_to_json(a) FROM audit_events a`)).rows);
      assert.doesNotMatch(dump, /frontend-secret|chat-que|192\.0\.2\.44|prompt-no|provider-pii|provider-secret/);
    });
    await reset(); app = await boot();
    await test("límites PII: nombre80/email160/phone normalizado/dirección180/referencias140", async () => {
      const long = { ...buyer, nombre: "Nombre " + "A".repeat(200),
        email: "a".repeat(145) + "@example.test", direccion: "Calle 123 " + "A".repeat(250), referencias: "R".repeat(500) };
      folio = await successful(app, input({ comprador: long })); const order = await row(folio);
      assert.equal(order.buyer_name.length, 80); assert.ok(order.buyer_email.length <= 160);
      assert.equal(order.buyer_phone, "525550000000"); assert.equal(order.shipping_address.direccion.length, 180);
      assert.equal(order.shipping_address.referencias.length, 140);
    });
    await reset(); app = await boot();
    await test("idempotency key repetida/concurrente: una orden/preferencia; conflicto 409; UUID sólo HMAC", async () => {
      const data = input(), b = await boot();
      const concurrent = await Promise.all([checkout(app, data, "checkout-repeated-0001"), checkout(b, data, "checkout-repeated-0001")]);
      assert.ok(concurrent.some(r => r.status === 200));
      assert.ok(concurrent.every(r => [200, 503].includes(r.status)));
      const original = concurrent.find(r => r.status === 200).body.folio;
      assert.equal((await checkout(b, data, "checkout-repeated-0001")).body.folio, original);
      assert.equal(await count("orders"), 1); assert.equal(preferences, 1);
      assert.equal((await checkout(app, { ...data, items: [{ sku: "ValEnd", cantidad: 2 }] }, "checkout-repeated-0001")).status, 409);
      const keys = JSON.stringify((await pool.query(`SELECT r.identity_hash,a.idempotency_key_hash,a.request_fingerprint
        FROM inventory_reservations r JOIN payment_attempts a ON a.order_id=r.order_id`)).rows);
      assert.doesNotMatch(keys, new RegExp(data.visitante)); assert.doesNotMatch(keys, /checkout-repeated-0001/);
    });
    await reset(); app = await boot();
    await test("reintento sin header después de TTL de reserva conserva intent/preferencia vigente", async () => {
      const data = input(); folio = await successful(app, data);
      await pool.query("UPDATE inventory_reservations SET created_at=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '1 second'");
      assert.equal((await checkout(app, data)).body.folio, folio);
      assert.equal(await count("orders"), 1); assert.equal(preferences, 1);
    });
    await reset(); app = await boot();
    await test("pago legacy/desconocido: evento/pago/alerta durables sin venta", async () => {
      const id = "legacy-paid-0001";
      payments.set(id, { id, status: "approved", transaction_amount: 149, currency_id: "MXN",
        external_reference: "VQ-LEGACY", collector_id: "test-account", live_mode: false });
      assert.equal((await webhook(app, id)).body.revision, true);
      assert.equal(await count("orders"), 0); assert.equal(await count("payments"), 1);
      assert.equal(await count("inventory_movements"), 0);
      assert.equal((await pool.query("SELECT outcome FROM payment_events")).rows[0].outcome, "review");
      assert.equal((await pool.query("SELECT event_type,payment_event_id FROM outbox")).rows[0].event_type, "pago_revision");
      await stop(app); app = await boot();
      const admin = await request(app, "/api/admin/resumen", undefined, { "x-leads-token": adminToken });
      assert.equal(admin.body.pagos_no_conciliados.length, 1);
    });
    await reset(); app = await boot();
    await test("outbox fallo de canal no revierte venta; restart reintenta con clave durable", async () => {
      notifyMode = 500; folio = await successful(app); paymentId = await paid(folio);
      assert.equal((await webhook(app, paymentId)).status, 200);
      for (let i = 0; i < 100; i++) {
        if ((await pool.query("SELECT state FROM outbox WHERE channel='orders_webhook'")).rows[0]?.state === "failed") break;
        await new Promise(r => setTimeout(r, 30));
      }
      const event = (await pool.query("SELECT id,state FROM outbox WHERE channel='orders_webhook'")).rows[0];
      assert.equal(event.state, "failed"); assert.equal((await row(folio)).payment_state, "approved");
      await stop(app); notifyMode = 200;
      await pool.query("UPDATE outbox SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE channel='orders_webhook'");
      app = await boot();
      for (let i = 0; i < 100 && !notices.length; i++) await new Promise(r => setTimeout(r, 30));
      assert.equal(notices.length, 1); assert.equal(notices[0].key, event.id);
      assert.equal(await count("inventory_movements"), 1);
    });
    await reset(); app = await boot();
    await test("pending→approved y otro payment ID: dos cobros, una venta/ingreso durable", async () => {
      folio = await successful(app); paymentId = await paid(folio, crypto.randomUUID(), { status: "pending" });
      assert.equal((await webhook(app, paymentId)).status, 200);
      assert.equal((await row(folio)).payment_state, "pending"); assert.equal(await count("inventory_movements"), 0);
      payments.get(paymentId).status = "approved";
      assert.equal((await webhook(app, paymentId)).status, 200);
      const second = await paid(folio);
      assert.equal((await webhook(app, second)).body.duplicado, true);
      assert.equal(await count("payments"), 2); assert.equal(await count("inventory_movements"), 1);
      const admin = await request(app, "/api/admin/resumen", undefined, { "x-leads-token": adminToken });
      assert.equal(admin.body.dinero.pagados, 1);
      assert.equal(admin.body.dinero.cobrado_centavos, Number((await row(folio)).total_centavos));
      const alert = (await pool.query("SELECT event_data FROM outbox WHERE event_type='pago_duplicado'")).rows[0].event_data;
      assert.equal(alert.pago_original, paymentId); assert.equal(alert.pago_duplicado, second);
    });
    await reset(); app = await boot();
    await test("moneda/cuenta/entorno verificados incompatibles: review sin surtido", async () => {
      for (const invalid of [{ currency_id: "USD" }, { collector_id: "other-account" }, { live_mode: true }]) {
        const f = await successful(app), id = await paid(f, crypto.randomUUID(), invalid);
        assert.equal((await webhook(app, id)).body.revision, true);
        assert.equal((await row(f)).payment_state, "review");
      }
      assert.equal(await count("inventory_movements"), 0);
    });
    await reset(); app = await boot();
    await test("pago multi-SKU con uno agotado: cero consumo parcial, paid_unallocated", async () => {
      folio = await successful(app, input({ items: [{ sku: "ValEnd", cantidad: 1 }, { sku: "ValPulpo", cantidad: 1 }] }));
      paymentId = await paid(folio);
      await pool.query("UPDATE inventory_reservations SET created_at=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '1 second'");
      await pool.query("UPDATE inventory SET on_hand=0 WHERE sku='ValPulpo'");
      assert.equal((await webhook(app, paymentId)).body.revision, true);
      assert.equal((await row(folio)).fulfillment_state, "paid_unallocated");
      assert.equal((await pool.query("SELECT on_hand FROM inventory WHERE sku='ValEnd'")).rows[0].on_hand, 50);
      assert.equal(await count("inventory_movements"), 0);
    });
    await reset(); app = await boot();
    await test("schema incompleto/checksum divergente: health vivo, checkout503 antes de MP", async () => {
      const previous = (await pool.query("SELECT checksum FROM schema_migrations WHERE version='002'")).rows[0].checksum;
      await pool.query("UPDATE schema_migrations SET checksum=$1 WHERE version='002'", ["0".repeat(64)]);
      try {
        assert.equal((await checkout(app)).status, 503); assert.equal(preferences, 0);
        assert.equal((await request(app, "/health")).status, 200);
      } finally { await pool.query("UPDATE schema_migrations SET checksum=$1 WHERE version='002'", [previous]); }
    });
    await test("Asesor real con Gemini FALSO: stock SQL cero no cae al stock de productos.json", async () => {
      await pool.query("UPDATE inventory SET on_hand=0 WHERE sku='ValEnd'");
      const r = await request(app, "/api/chat", { messages: [{ role: "user", parts: [{ text: "agrega un endo" }] }], carrito: [] });
      assert.equal(r.status, 200); assert.equal(r.body.cotizacion, null);
      assert.deepEqual(r.body.acciones, []);
      assert.match(r.body.reply, /No pude/);
      assert.equal(preferences, 0);
    });
    await test("contrato proveedor estricto: monto/tipos/ID/entorno no coercibles", async () => {
      const valid = { id: "synthetic-pay", status: "approved", transaction_amount: 12.34,
        currency_id: "MXN", live_mode: false, collector_id: "test-account" };
      assert.equal(providerObservation(valid, valid.id).amountCentavos, "1234");
      for (const bad of [{ transaction_amount: true }, { transaction_amount: "12.34" }, { transaction_amount: -1 },
        { transaction_amount: Infinity }, { transaction_amount: 12.345 }, { live_mode: undefined }, { collector_id: undefined }, { id: "other" }]) {
        assert.throws(() => providerObservation({ ...valid, ...bad }, valid.id));
      }
    });
    await test("snapshot legacy: diagnóstico sin PII ni restauración de pedidos SQL", async () => {
      await reset();
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), "valquiria-snapshot-test-"));
      fixtureDirectories.push(directory);
      const file = path.join(directory, "snapshot.json");
      await fs.writeFile(file, "Ana Prueba ana@example.test contenido inválido", "utf8");
      app = await boot({ ALMACEN_RUTA: file });
      assert.deepEqual((await request(app, "/health")).body, { ok: true });
      assert.equal(await count("orders"), 0);
      assert.doesNotMatch(app.logs(), /Ana Prueba|ana@example|contenido inválido/);
      assert.match(app.logs(), /snapshot_json_invalid/);
      await stop(app);
      await fs.writeFile(file, JSON.stringify({ _guardado: "ana@example.test", pedidos: [{ comprador: buyer }] }), "utf8");
      app = await boot({ ALMACEN_RUTA: file });
      assert.deepEqual((await request(app, "/health")).body, { ok: true });
      assert.equal(await count("orders"), 0);
      assert.doesNotMatch(app.logs(), /Ana Prueba|ana@example/);
      assert.match(app.logs(), /Recuperado: 0 pedidos/);
      await stop(app);
      const snapshot = JSON.parse(await fs.readFile(file, "utf8"));
      assert.equal(Object.hasOwn(snapshot, "pedidos"), false);
      assert.ok(Array.isArray(snapshot.leads));
      assert.ok(Array.isArray(snapshot.bitacora));
    });
    await test("logs sin PII, secretos sintéticos, URL SQL, consulta ni payload proveedor", async () => {
      for (const running of [...applications]) await stop(running);
      assert.doesNotMatch(logCopies.join("\n"), /ana@example|Ana Prueba|5550000000|Prueba 123|provider-pii|provider-secret|DROP TABLE|secret-sql-sintetico|postgresql:\/\/|frontend-secret/);
    });
  } finally {
    for (const app of [...applications]) await stop(app);
    await new Promise(resolve => fake.close(resolve));
    await pool.end(); await pool2.end();
    for (const directory of fixtureDirectories) await fs.rm(directory, { recursive: true, force: true });
  }
  process.stdout.write(`✓ ${passed}/${passed} pruebas de integración PostgreSQL\n`);
}
main().catch(error => {
  if (error.code === "ERR_ASSERTION") process.stderr.write(`FAIL ${currentTest}: assertion (${typeof error.actual === "number" ? error.actual : "redacted"} != ${typeof error.expected === "number" ? error.expected : "redacted"})\n`);
  else process.stderr.write(`FAIL ${currentTest}: código ${/^[A-Z0-9]{5}$/.test(error.code || "") ? error.code : "omitido"}; ${String(error.stack || "").split("\n").slice(1, 4).map(s => s.match(/test-postgres-commerce\.js:\d+:\d+/)?.[0] || "frame externo").join(", ")} (datos privados omitidos).\n`);
  process.exitCode = 1;
});
