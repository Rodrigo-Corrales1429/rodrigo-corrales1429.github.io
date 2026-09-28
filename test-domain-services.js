"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const { Pool } = require("pg");
const { migrate } = require("./db/migrate");
const { assertDisposableTestDatabase, testDatabaseUrl } = require("./db/test-target");
const { releaseReservation } = require("./services/inventory");
const { prepareCheckout, getOrder } = require("./services/orders");
const { applyVerifiedPayment } = require("./services/payments");

const key = "clave-sintetica-de-prueba";
const expected = { accountId: "cuenta-de-prueba", environment: "sandbox" };
const limits = { maxPerSku: 6, maxUnits: 12, maxPerIdentity: 1, fraction: 0.8, safetyStock: 1 };
const uuid = () => crypto.randomUUID();
const quote = (lines, shipping = 0) => {
  const priced = lines.map(([sku, quantity]) => ({ sku, title: `Pieza ${sku}`, quantity,
    unitPriceCentavos: 100, lineTotalCentavos: quantity * 100 }));
  const subtotal = priced.reduce((sum, line) => sum + line.lineTotalCentavos, 0);
  return { currency: "MXN", lines: priced, subtotalCentavos: subtotal,
    shippingCentavos: shipping, totalCentavos: subtotal + shipping };
};
const prepare = (pool, lines, identity = uuid(), options = {}) => prepareCheckout(pool, {
  quote: quote(lines), identity, hashKey: key, folio: `TEST-${uuid()}`,
  idempotencyKey: options.idempotencyKey, limits: { ...limits, ...options.limits }
});
const observation = (prepared, options = {}) => ({ verified: true,
  providerPaymentId: `payment-${uuid()}`, folio: prepared.folio, attemptId: prepared.attemptId,
  status: "approved", amountCentavos: 100, currency: "MXN", accountId: expected.accountId,
  environment: expected.environment, ...options });

async function main() {
  // Guardia compartida: solo esquema aleatorio en la base local desechable y marcada.
  const url = testDatabaseUrl();
  const schema = `phase2b_test_${crypto.randomBytes(8).toString("hex")}`;
  const admin = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 5000 });
  let pool;
  let second;
  let created = false;
  try {
    await assertDisposableTestDatabase(admin);
    await admin.query(`CREATE SCHEMA ${schema}`);
    created = true;
    const opts = { connectionString: url, max: 4, connectionTimeoutMillis: 5000,
      options: `-c search_path=${schema}` };
    pool = new Pool(opts);
    second = new Pool(opts);
    assert.equal((await pool.query("SELECT current_schema() AS name")).rows[0].name, schema);
    assert.equal((await second.query("SELECT current_schema() AS name")).rows[0].name, schema);
    await migrate(pool, path.join(__dirname, "db/migrations"));
    const stock = async (sku, count) => pool.query("INSERT INTO inventory(sku,on_hand) VALUES($1,$2)", [sku, count]);
    const count = async sku => (await pool.query("SELECT on_hand FROM inventory WHERE sku=$1", [sku])).rows[0].on_hand;
    const sales = async orderId => (await pool.query(`SELECT count(*)::int AS n FROM inventory_movements
      WHERE order_id=$1 AND kind='sale'`, [orderId])).rows[0].n;
    const expire = async orderId => pool.query(`UPDATE inventory_reservations SET
      created_at=clock_timestamp()-interval '2 minutes', expires_at=clock_timestamp()-interval '1 second'
      WHERE order_id=$1`, [orderId]);

    await stock("A", 5);
    await stock("B", 5);
    const first = await prepare(pool, [["A", 2], ["B", 1]], "identity-A", { idempotencyKey: "checkout-A" });
    assert.equal(first.ok, true);
    assert.equal((await getOrder(pool, first.folio)).items.length, 2);
    const repeat = await prepareCheckout(second, { quote: quote([["A", 2], ["B", 1]]),
      identity: "identity-A", hashKey: key, folio: first.folio, idempotencyKey: "checkout-A", limits });
    assert.equal(repeat.repeated, true);
    assert.equal(repeat.orderId, first.orderId);
    assert.equal((await prepareCheckout(pool, { quote: quote([["A", 1]]), identity: "identity-A",
      hashKey: key, folio: first.folio, idempotencyKey: "checkout-A", limits })).reason, "idempotency_conflict");
    assert.equal((await prepare(pool, [["A", 4]], "different")).ok, false);
    assert.equal((await prepare(pool, [["A", 1], ["MISSING", 1]], "different")).ok, false);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM orders")).rows[0].n, 1);
    assert.equal((await pool.query("SELECT identity_hash FROM inventory_reservations WHERE order_id=$1 LIMIT 1", [first.orderId])).rows[0].identity_hash.length, 64);
    process.stdout.write("✓ Reserva, HMAC, límites, multi-SKU e idempotencia de preparación\n");

    const replaced = await prepare(pool, [["B", 1]], "identity-A");
    assert.equal(replaced.ok, true);
    assert.equal((await pool.query("SELECT state FROM inventory_reservations WHERE order_id=$1 LIMIT 1", [first.orderId])).rows[0].state, "released");
    const failedReplacement = await prepare(pool, [["A", 5]], "identity-A");
    assert.equal(failedReplacement.ok, false);
    assert.equal((await pool.query("SELECT state FROM inventory_reservations WHERE order_id=$1", [replaced.orderId])).rows[0].state, "released");
    await stock("PROTECTED", 1);
    assert.equal((await prepare(pool, [["PROTECTED", 1]])).reason, "stock_protected");
    await stock("EXPIRE", 2);
    const expiring = await prepare(pool, [["EXPIRE", 1]]);
    await expire(expiring.orderId);
    assert.equal((await prepare(second, [["EXPIRE", 1]])).ok, true);
    await stock("FRACTION", 10);
    assert.equal((await prepare(pool, [["FRACTION", 9]], uuid(), { limits: { maxPerSku: 10, maxUnits: 10 } })).reason, "stock_protected");
    process.stdout.write("✓ Reemplazo exitoso y fallido con liberación confirmada; seguridad y fracción\n");

    await stock("RACE", 2);
    const raced = await Promise.all([prepare(pool, [["RACE", 1]]), prepare(second, [["RACE", 1]])]);
    assert.equal(raced.filter(result => result.ok).length, 1);
    assert.equal(raced.filter(result => !result.ok).length, 1);
    process.stdout.write("✓ Dos pools compiten por la última unidad reservable\n");

    const paid = await prepare(pool, [["A", 1]]);
    const paidObservation = observation(paid);
    assert.equal((await applyVerifiedPayment(pool, paidObservation, expected)).outcome, "allocated");
    assert.equal((await applyVerifiedPayment(second, paidObservation, expected)).outcome, "duplicate");
    assert.equal(await sales(paid.orderId), 1);
    assert.equal((await pool.query("SELECT state FROM inventory_reservations WHERE order_id=$1", [paid.orderId])).rows[0].state, "consumed");
    assert.equal((await applyVerifiedPayment(second, observation(paid), expected)).outcome, "double_payment");
    assert.equal(await sales(paid.orderId), 1);
    assert.equal((await applyVerifiedPayment(pool, { ...paidObservation, folio: first.folio, attemptId: first.attemptId }, expected)).outcome, "association_conflict");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM payments WHERE order_id=$1 AND status='approved'", [paid.orderId])).rows[0].n, 2);
    const stockBeforeRefund = await count("A");
    assert.equal((await applyVerifiedPayment(pool, { ...paidObservation, status: "refunded" }, expected)).outcome, "financial_reversal");
    assert.equal(await count("A"), stockBeforeRefund);
    assert.equal(await sales(paid.orderId), 1);
    process.stdout.write("✓ Approved consume una vez; repetición, otro payment_id y asociación ajena\n");

    const bad = await prepare(pool, [["B", 1]]);
    const wrongAmount = observation(bad, { amountCentavos: 99 });
    assert.equal((await applyVerifiedPayment(pool, wrongAmount, expected)).reason, "amount");
    assert.equal((await applyVerifiedPayment(pool, observation(bad, { currency: "USD" }), expected)).reason, "currency");
    assert.equal((await applyVerifiedPayment(pool, observation(bad, { accountId: "otra-cuenta" }), expected)).reason, "account");
    assert.equal((await applyVerifiedPayment(pool, observation(bad, { attemptId: uuid() }), expected)).reason, "association");
    assert.equal(await sales(bad.orderId), 0);
    assert.equal((await applyVerifiedPayment(pool, { ...wrongAmount, amountCentavos: 100 }, expected)).outcome, "allocated");
    assert.equal(await sales(bad.orderId), 1);
    process.stdout.write("✓ Monto/moneda/cuenta incompatibles no venden; observación corregida se concilia\n");

    const late = await prepare(pool, [["B", 1]]);
    await expire(late.orderId);
    assert.equal((await applyVerifiedPayment(pool, observation(late), expected)).outcome, "allocated");
    assert.equal(await sales(late.orderId), 1);
    await stock("SCARCE", 1);
    const tooLate = await prepare(pool, [["B", 1], ["A", 1]]);
    await expire(tooLate.orderId);
    await pool.query("UPDATE inventory SET on_hand=0 WHERE sku='A'");
    const beforeB = await count("B");
    const noStock = observation(tooLate, { amountCentavos: 200 });
    assert.equal((await applyVerifiedPayment(pool, noStock, expected)).outcome, "paid_unallocated");
    assert.equal((await applyVerifiedPayment(second, noStock, expected)).outcome, "duplicate");
    assert.equal(await count("B"), beforeB);
    assert.equal(await sales(tooLate.orderId), 0);
    assert.equal((await getOrder(pool, tooLate.folio)).fulfillment_state, "paid_unallocated");
    assert.equal((await pool.query("SELECT status FROM payments WHERE provider_payment_id=$1", [noStock.providerPaymentId])).rows[0].status, "approved");
    process.stdout.write("✓ Pago tardío con y sin stock; multi-SKU sin consumo parcial\n");

    // Pago tardío con stock: una orden vendida no conserva reservas «active», aunque hayan vencido.
    await stock("LATE-A", 5);
    await stock("LATE-B", 5);
    const lateMulti = await prepare(pool, [["LATE-A", 1], ["LATE-B", 2]]);
    await expire(lateMulti.orderId);
    const lateObserved = observation(lateMulti, { amountCentavos: 300 });
    assert.equal((await applyVerifiedPayment(pool, lateObserved, expected)).outcome, "allocated");
    assert.equal((await applyVerifiedPayment(second, lateObserved, expected)).outcome, "duplicate");
    assert.equal(await count("LATE-A"), 4);
    assert.equal(await count("LATE-B"), 3);
    assert.deepEqual((await pool.query(`SELECT sku, count(*)::int AS n, sum(delta)::int AS delta
      FROM inventory_movements WHERE order_id=$1 AND kind='sale' GROUP BY sku ORDER BY sku`, [lateMulti.orderId])).rows,
    [{ sku: "LATE-A", n: 1, delta: -1 }, { sku: "LATE-B", n: 1, delta: -2 }]);
    assert.deepEqual((await pool.query(`SELECT DISTINCT state FROM inventory_reservations
      WHERE order_id=$1`, [lateMulti.orderId])).rows.map(row => row.state), ["consumed"]);
    assert.equal((await getOrder(pool, lateMulti.folio)).fulfillment_state, "allocated");
    process.stdout.write("✓ Pago tardío con stock: allocated, stock y venta una vez por SKU, reservas vencidas consumed\n");

    await stock("MULTI1", 5);
    await stock("MULTI2", 5);
    const multi = await prepare(pool, [["MULTI1", 1], ["MULTI2", 2]]);
    assert.equal((await applyVerifiedPayment(pool, observation(multi, { amountCentavos: 300 }), expected)).outcome, "allocated");
    assert.equal(await sales(multi.orderId), 2);
    assert.equal(await count("MULTI1"), 4);
    assert.equal(await count("MULTI2"), 3);
    const rejected = await prepare(pool, [["MULTI1", 1]]);
    assert.equal((await applyVerifiedPayment(pool, observation(rejected, { status: "rejected" }), expected)).outcome, "recorded");
    assert.equal((await pool.query("SELECT state FROM inventory_reservations WHERE order_id=$1", [rejected.orderId])).rows[0].state, "released");
    assert.equal(await sales(rejected.orderId), 0);
    process.stdout.write("✓ Multi-SKU completo; rechazo libera sin venta\n");

    await stock("CONCURRENT", 3);
    const concurrent = await prepare(pool, [["CONCURRENT", 1]]);
    const samePayment = observation(concurrent);
    const outcomes = await Promise.all([
      applyVerifiedPayment(pool, samePayment, expected), applyVerifiedPayment(second, samePayment, expected)
    ]);
    assert.deepEqual(outcomes.map(result => result.outcome).sort(), ["allocated", "duplicate"]);
    assert.equal(await sales(concurrent.orderId), 1);
    await second.end();
    second = new Pool(opts);
    assert.equal((await applyVerifiedPayment(second, samePayment, expected)).outcome, "duplicate");
    const twoPayments = await prepare(pool, [["CONCURRENT", 1]]);
    const distinctOutcomes = await Promise.all([
      applyVerifiedPayment(pool, observation(twoPayments), expected),
      applyVerifiedPayment(second, observation(twoPayments), expected)
    ]);
    assert.deepEqual(distinctOutcomes.map(result => result.outcome).sort(), ["allocated", "double_payment"]);
    assert.equal(await sales(twoPayments.orderId), 1);
    process.stdout.write("✓ Dos pools, restart y pagos distintos: una sola venta por orden\n");

    // Un trigger BEFORE que devuelve NULL deja el descuento en rowCount=0 aunque el stock sobre.
    await pool.query("CREATE FUNCTION skip_stock_write() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NULL; END'");
    await pool.query(`CREATE TRIGGER ghost_stock BEFORE UPDATE ON inventory FOR EACH ROW
      WHEN (OLD.sku LIKE 'GHOST-%') EXECUTE FUNCTION skip_stock_write()`);
    const movements = async orderId => (await pool.query(
      "SELECT count(*)::int AS n FROM inventory_movements WHERE order_id=$1", [orderId])).rows[0].n;
    const activeHolds = async orderId => (await pool.query(`SELECT count(*)::int AS n
      FROM inventory_reservations WHERE order_id=$1 AND state='active'`, [orderId])).rows[0].n;
    const expectUnallocated = async (prepared, observed, stockBefore) => {
      assert.deepEqual(await applyVerifiedPayment(pool, observed, expected),
        { outcome: "paid_unallocated", reason: "stock_write_conflict" });
      for (const [sku, units] of stockBefore) assert.equal(await count(sku), units);
      assert.equal(await movements(prepared.orderId), 0);
      assert.equal(await activeHolds(prepared.orderId), 0);
      const persisted = await getOrder(pool, prepared.folio);
      assert.equal(persisted.payment_state, "approved");
      assert.equal(persisted.fulfillment_state, "paid_unallocated");
      assert.equal(persisted.review_reason, "stock_write_conflict");
      assert.equal((await pool.query("SELECT status FROM payments WHERE provider_payment_id=$1",
        [observed.providerPaymentId])).rows[0].status, "approved");
      assert.equal((await applyVerifiedPayment(second, observed, expected)).outcome, "duplicate");
      assert.equal(await movements(prepared.orderId), 0);
    };
    await stock("GHOST-1", 5);
    const ghost = await prepare(pool, [["GHOST-1", 1]]);
    await expectUnallocated(ghost, observation(ghost), [["GHOST-1", 5]]);
    // FINE se descuenta primero (orden por SKU) y GHOST-2 falla: FINE debe volver a 5.
    await stock("FINE", 5);
    await stock("GHOST-2", 5);
    const mixed = await prepare(pool, [["FINE", 1], ["GHOST-2", 1]]);
    await expectUnallocated(mixed, observation(mixed, { amountCentavos: 200 }), [["FINE", 5], ["GHOST-2", 5]]);
    await pool.query("DROP TRIGGER ghost_stock ON inventory");
    const healthy = await prepare(pool, [["FINE", 1], ["GHOST-2", 1]]);
    assert.equal((await applyVerifiedPayment(pool, observation(healthy, { amountCentavos: 200 }), expected)).outcome, "allocated");
    assert.equal(await count("FINE"), 4);
    assert.equal(await count("GHOST-2"), 4);
    process.stdout.write("✓ Descuento con rowCount=0: sin venta, sin movimiento, sin consumo parcial multi-SKU; pagado sin asignar\n");

    await stock("LAST", 3);
    const lastA = await prepare(pool, [["LAST", 1]]);
    const lastB = await prepare(pool, [["LAST", 1]]);
    assert.equal(lastA.ok && lastB.ok, true);
    await expire(lastA.orderId);
    await expire(lastB.orderId);
    await pool.query("UPDATE inventory SET on_hand=1 WHERE sku='LAST'");
    const lastOutcomes = await Promise.all([
      applyVerifiedPayment(pool, observation(lastA), expected),
      applyVerifiedPayment(second, observation(lastB), expected)
    ]);
    assert.deepEqual(lastOutcomes.map(result => result.outcome).sort(), ["allocated", "paid_unallocated"]);
    assert.equal(await count("LAST"), 0);
    assert.equal(await sales(lastA.orderId) + await sales(lastB.orderId), 1);
    process.stdout.write("✓ Dos órdenes cobradas a la vez contra la última pieza: una asignada, otra pagada sin asignar\n");

    const activeUnits = async sku => Number((await pool.query(`SELECT coalesce(sum(quantity),0) AS n
      FROM inventory_reservations WHERE sku=$1 AND state='active' AND expires_at>clock_timestamp()`, [sku])).rows[0].n);
    await stock("RVSP", 4);
    const payer = await prepare(pool, [["RVSP", 1]]);
    await expire(payer.orderId);
    const [payerResult, reserverResult] = await Promise.all([
      applyVerifiedPayment(pool, observation(payer), expected), prepare(second, [["RVSP", 3]])
    ]);
    assert.equal(payerResult.outcome, "allocated");
    assert.equal(await count("RVSP"), 3);
    assert.equal(await activeUnits("RVSP"), reserverResult.ok ? 3 : 0);
    if (!reserverResult.ok) assert.equal(reserverResult.reason, "stock_protected");
    assert.ok(await activeUnits("RVSP") <= await count("RVSP"));

    await stock("RELEASE", 3);
    const releasing = await prepare(pool, [["RELEASE", 1]]);
    const [releaseResult, releasePayment] = await Promise.all([
      releaseReservation(second, releasing.orderId, "cancelled"),
      applyVerifiedPayment(pool, observation(releasing), expected)
    ]);
    assert.equal(releasePayment.outcome, "allocated");
    assert.ok(releaseResult.released === true || releaseResult.reason === "paid");
    assert.equal(await count("RELEASE"), 2);
    assert.equal(await sales(releasing.orderId), 1);
    assert.equal(await activeHolds(releasing.orderId), 0);
    assert.equal((await getOrder(pool, releasing.folio)).fulfillment_state, "allocated");
    process.stdout.write("✓ Reserva contra cobro y liberación contra cobro: sin sobreventa ni venta perdida\n");

    // La propiedad de la reserva es el visitante que la creó, no la red por la que llega.
    await stock("SHARED", 10);
    const visitorA = uuid();
    const visitorB = uuid();
    const ownA = await prepare(pool, [["SHARED", 1]], visitorA);
    const ownB = await prepare(pool, [["SHARED", 1]], visitorB);
    assert.equal(await activeHolds(ownA.orderId), 1);
    assert.equal(await activeHolds(ownB.orderId), 1);
    const ownA2 = await prepare(pool, [["SHARED", 2]], visitorA);
    assert.equal(ownA2.ok, true);
    assert.equal(await activeHolds(ownA.orderId), 0);
    assert.equal(await activeHolds(ownB.orderId), 1);
    assert.equal(await activeHolds(ownA2.orderId), 1);
    process.stdout.write("✓ Visitantes distintos no se liberan entre sí; el mismo visitante reemplaza la suya\n");

    await stock("ROLLBACK", 5);
    for (const failurePoint of ["after_payment_write", "after_stock_decrement", "before_commit"]) {
      const candidate = await prepare(pool, [["ROLLBACK", 1]]);
      const event = observation(candidate);
      const before = await count("ROLLBACK");
      await assert.rejects(() => applyVerifiedPayment(pool, event, expected, { onStep(name) {
        if (name === failurePoint) throw new Error("Fallo inyectado");
      } }), /Fallo inyectado/);
      assert.equal(await count("ROLLBACK"), before);
      assert.equal(await sales(candidate.orderId), 0);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM payments WHERE provider_payment_id=$1", [event.providerPaymentId])).rows[0].n, 0);
      assert.equal((await getOrder(pool, candidate.folio)).payment_state, "pending");
      assert.equal((await applyVerifiedPayment(pool, event, expected)).outcome, "allocated");
    }
    process.stdout.write("✓ Fallos tras pago, tras stock y antes de commit: rollback completo\n");

    // Abuso: 30 identidades distintas contra un SKU. El techo (fracción + stock de seguridad) manda.
    for (const [sku, fraction, techo] of [["HOARD", 0.8, 8], ["HOARD5", 0.5, 5]]) {
      await stock(sku, 10);
      const intentos = [];
      for (let i = 0; i < 30; i++) intentos.push(await prepare(pool, [[sku, 1]], uuid(), { limits: { fraction } }));
      assert.equal(intentos.filter(r => r.ok).length, techo);
      assert.ok(intentos.filter(r => !r.ok).every(r => r.reason === "stock_protected"));
      assert.equal(await activeUnits(sku), techo);
      assert.ok(await count(sku) - await activeUnits(sku) >= 1);
    }
    for (const r of (await pool.query("SELECT DISTINCT order_id FROM inventory_reservations WHERE sku='HOARD'")).rows) await expire(r.order_id);
    assert.equal((await prepare(pool, [["HOARD", 1]], uuid())).ok, true);
    process.stdout.write("✓ Abuso con 30 identidades: se apartan como mucho el techo; el stock nunca queda en 0; al expirar se libera\n");

    // Invariantes sobre TODO lo que dejaron las pruebas anteriores.
    const filas = async sql => (await pool.query(sql)).rows;
    assert.deepEqual(await filas(`SELECT o.id FROM orders o WHERE fulfillment_state <> 'allocated' AND EXISTS
      (SELECT 1 FROM inventory_movements m WHERE m.order_id=o.id AND m.kind='sale')`), [], "venta sin orden asignada");
    assert.deepEqual(await filas(`SELECT i.order_id, i.sku FROM order_items i JOIN orders o ON o.id=i.order_id
      LEFT JOIN inventory_movements m ON m.order_id=i.order_id AND m.sku=i.sku AND m.kind='sale'
      WHERE o.fulfillment_state='allocated' GROUP BY i.order_id, i.sku, i.quantity
      HAVING count(m.id) <> 1 OR coalesce(sum(m.delta),0) <> -i.quantity`), [], "orden asignada sin una venta exacta por línea");
    assert.deepEqual(await filas(`SELECT DISTINCT r.order_id FROM inventory_reservations r JOIN orders o ON o.id=r.order_id
      WHERE r.state='active' AND o.fulfillment_state <> 'reserved'`), [], "reserva activa en orden no reservada");
    assert.deepEqual(await filas(`SELECT id FROM orders WHERE fulfillment_state IN ('allocated','paid_unallocated')
      AND payment_state NOT IN ('approved','refunded','charged_back')`), [], "orden surtida o pagada sin pago aprobado");
    assert.deepEqual(await filas(`SELECT DISTINCT m.order_id FROM inventory_movements m WHERE m.kind='sale' AND NOT EXISTS
      (SELECT 1 FROM payments p WHERE p.order_id=m.order_id AND p.status IN ('approved','refunded','charged_back'))`), [],
    "venta sin pago");
    assert.deepEqual(await filas(`SELECT sku FROM inventory i WHERE on_hand < (SELECT coalesce(sum(quantity),0)
      FROM inventory_reservations r WHERE r.sku=i.sku AND r.state='active' AND r.expires_at > clock_timestamp())`), [],
    "más apartado que existencias");
    assert.deepEqual(await filas("SELECT sku FROM inventory WHERE on_hand < 0"), [], "stock negativo");
    assert.deepEqual(await filas(`SELECT i.order_id FROM order_items i LEFT JOIN inventory_movements m
      ON m.order_id=i.order_id AND m.sku=i.sku AND m.kind='sale' GROUP BY i.order_id
      HAVING count(m.id) > 0 AND count(m.id) < count(i.sku)`), [], "consumo parcial de una orden multi-SKU");
    process.stdout.write("✓ Invariantes: ventas, pagos, reservas y estados de orden coherentes en todos los datos de la suite\n");
  } finally {
    if (second) await second.end();
    if (pool) await pool.end();
    if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
}

main().catch(error => {
  process.stderr.write(`FAIL test-domain-services: ${error.message}\n`);
  process.exitCode = 1;
});
