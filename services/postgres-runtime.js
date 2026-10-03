"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createPool } = require("../db/pool");
const { testDatabaseUrl, assertDisposableTestDatabase } = require("../db/test-target");
const domain = require("./commerce");
const { getOrder } = require("./orders");
const { reservationLimits } = require("./inventory");
const { getProductoPorSku } = require("../catalog.js");
const { centavosAPesos } = require("../quote-engine.js");

const MESSAGE = "El pago en línea no está disponible temporalmente. Intenta de nuevo en unos minutos o escríbenos por WhatsApp.";
const UNCERTAIN_MESSAGE = "No pudimos confirmar el estado de tu intento de pago. Para evitar un posible cobro duplicado, no vuelvas a pagar por ahora. Conservamos el intento para conciliación.";
function unavailable() { const error = new Error("commerce_unavailable"); error.commerceUnavailable = true; return error; }
function config(env = process.env) {
  if (env.PERSISTENCIA && env.PERSISTENCIA !== "postgres") throw unavailable();
  if (!/^[a-f0-9]{64,}$/i.test(env.COMMERCE_HMAC_KEY || "") || (env.COMMERCE_HMAC_KEY.length % 2)) {
    throw unavailable(); // al menos 32 bytes aleatorios hex; sin default ni impresión de la clave.
  }
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(env.MP_ACCOUNT_ID || "") ||
      !["production", "sandbox"].includes(env.MP_ENVIRONMENT)) throw unavailable();
  if (env.NODE_ENV === "production" && env.MP_ENVIRONMENT !== "production") throw unavailable();
  return { key: Buffer.from(env.COMMERCE_HMAC_KEY, "hex"), expected: {
    accountId: env.MP_ACCOUNT_ID, environment: env.MP_ENVIRONMENT } };
}
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const safeId = value => {
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  return typeof text === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(text) ? text : null;
};
function providerObservation(payment, requestedId) {
  const id = safeId(payment?.id);
  const amount = payment?.transaction_amount;
  const text = typeof amount === "number" && Number.isFinite(amount) ? String(amount) : "";
  if (!id || id !== String(requestedId) || !/^\d+(\.\d{1,2})?$/.test(text) ||
      !/^[A-Z]{3}$/.test(payment.currency_id || "") ||
      !["pending", "in_process", "authorized", "approved", "rejected", "cancelled", "refunded", "charged_back"].includes(payment.status) ||
      typeof payment.live_mode !== "boolean" || !safeId(payment.collector_id)) {
    throw new Error("provider_contract");
  }
  const [whole, fraction = ""] = text.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("provider_amount");
  const attemptId = payment.metadata?.attempt_id;
  return { verified: true, providerPaymentId: id, folio: safeId(payment.external_reference) || "unassociated",
    attemptId: typeof attemptId === "string" && uuidPattern.test(attemptId) ? attemptId : "00000000-0000-0000-0000-000000000000",
    status: payment.status, amountCentavos: cents.toString(), currency: payment.currency_id,
    accountId: safeId(payment.collector_id), environment: payment.live_mode ? "production" : "sandbox" };
}

function createRuntime() {
  const state = { db_connected: false, schema_compatible: false, configuration_valid: false,
    checkout_failures: 0, webhook_reconciliation_failures: 0 };
  let pool, settings;
  try {
    settings = config();
    pool = createPool(process.env.NODE_ENV === "test" ? { url: testDatabaseUrl() } : {});
    state.configuration_valid = true;
  } catch { console.error("[commerce] configuración inválida; checkout cerrado"); }
  const files = fs.readdirSync(path.join(__dirname, "../db/migrations"))
    .filter(file => /^\d{3}_[a-z0-9_]+\.sql$/.test(file)).sort().map(file => ({
      version: file.slice(0, 3), name: file, checksum: crypto.createHash("sha256")
        .update(fs.readFileSync(path.join(__dirname, "../db/migrations", file))).digest("hex") }));

  async function ready() {
    if (!pool) throw unavailable();
    try {
      if (process.env.NODE_ENV === "test") await assertDisposableTestDatabase(pool);
      const rows = (await pool.query("SELECT version,name,checksum FROM schema_migrations ORDER BY version")).rows;
      state.db_connected = true;
      state.schema_compatible = rows.length === files.length && files.every((file, i) =>
        file.version === rows[i].version && file.name === rows[i].name && file.checksum === rows[i].checksum);
      if (!state.schema_compatible) throw unavailable();
      // Consulta sin DDL: un schema mutilado aun con checksum correcto tampoco permite cobrar.
      await pool.query(`SELECT a.expires_at,o.shipping_quote,p.method_type,b.payment_event_id,b.event_data
        FROM payment_attempts a JOIN orders o ON o.id=a.order_id
        LEFT JOIN payments p ON p.order_id=o.id LEFT JOIN outbox b ON b.order_id=o.id LIMIT 0`);
    } catch (error) {
      if (!error.commerceUnavailable) state.db_connected = false;
      state.schema_compatible = false;
      console.error("[commerce] DB/schema no listo; checkout cerrado");
      throw unavailable();
    }
  }
  async function inventory() {
    await ready();
    const rows = (await pool.query(`SELECT i.sku,i.on_hand,
      coalesce((SELECT sum(r.quantity) FROM inventory_reservations r WHERE r.sku=i.sku
        AND r.state='active' AND r.expires_at>clock_timestamp()),0)::int AS held,
      coalesce((SELECT -sum(m.delta) FROM inventory_movements m WHERE m.sku=i.sku AND m.kind='sale'),0)::int AS sold
      FROM inventory i ORDER BY i.sku`)).rows;
    return rows.map(row => ({ sku: row.sku, nombre: getProductoPorSku(row.sku)?.nombre || row.sku,
      stock_declarado: row.on_hand, vendido_en_esta_sesion: row.sold, apartado_ahora: row.held,
      disponible: Math.max(0, row.on_hand - row.held), agotado: row.on_hand <= row.held }));
  }
  async function prepare({ cot, identity, buyer, idempotencyKey, shipping, expiresAt, folio }) {
    await ready();
    const quote = { currency: "MXN", lines: cot.lineas.map(line => ({ sku: line.sku,
      title: line.nombre, quantity: line.cantidad, unitPriceCentavos: getProductoPorSku(line.sku).precio_centavos,
      lineTotalCentavos: line.cantidad * getProductoPorSku(line.sku).precio_centavos })),
    subtotalCentavos: cot._raw.subtotal_centavos, shippingCentavos: shipping.desglose.envio_centavos,
    totalCentavos: shipping.desglose.total_centavos };
    // El visitante y la llave pública sólo aparecen en HMAC, nunca en filas ni logs.
    const key = idempotencyKey ? crypto.createHmac("sha256", settings.key)
      .update(JSON.stringify([identity, idempotencyKey])).digest("hex") : undefined;
    return domain.prepare(pool, { quote, identity, buyer: { name: buyer.nombre, phone: buyer.whatsapp,
      email: buyer.email, shippingAddress: { cp: buyer.cp, direccion: buyer.direccion, referencias: buyer.referencias || "" } },
    hashKey: settings.key, folio, idempotencyKey: key, limits: reservationLimits() }, { shipping, expiresAt });
  }
  async function reconcile(payment, requestedId) {
    await ready();
    const observation = providerObservation(payment, requestedId);
    const eventKey = crypto.createHmac("sha256", settings.key).update(JSON.stringify(observation)).digest("hex");
    return domain.reconcile(pool, observation, settings.expected, eventKey, safeId(payment.payment_type_id)?.slice(0, 40) || null);
  }
  function publicOrder(order) {
    return { ok: true, folio: order.folio, estado: order.payment_state === "review" || order.fulfillment_state === "paid_unallocated"
      ? "revision" : order.payment_state === "pending" ? "pendiente" : order.payment_state,
    total: centavosAPesos(Number(order.total_centavos)), total_centavos: Number(order.total_centavos), creado: order.created_at };
  }
  async function read(folio) { await ready(); return getOrder(pool, folio); }
  async function admin() {
    await ready();
    const rows = (await pool.query(`SELECT o.*,
      (SELECT max(verified_at) FROM payments p WHERE p.order_id=o.id AND p.status='approved') AS paid_at,
      (SELECT method_type FROM payments p WHERE p.order_id=o.id ORDER BY verified_at DESC LIMIT 1) AS method,
      coalesce((SELECT jsonb_agg(jsonb_build_object('sku',i.sku,'cantidad',i.quantity,'titulo',i.title) ORDER BY i.sku)
        FROM order_items i WHERE i.order_id=o.id),'[]') AS items
      FROM orders o ORDER BY created_at DESC,id LIMIT 300`)).rows;
    const money = (await pool.query(`SELECT count(*)::int AS pedidos_totales,
      count(*) FILTER(WHERE payment_state='approved')::int AS pagados,
      count(*) FILTER(WHERE payment_state IN ('pending','in_process','authorized'))::int AS pendientes,
      count(*) FILTER(WHERE payment_state='review' OR review_reason IS NOT NULL)::int AS en_revision,
      coalesce(sum(total_centavos) FILTER(WHERE payment_state='approved'),0)::text AS cobrado_centavos,
      coalesce(sum(total_centavos) FILTER(WHERE payment_state IN ('pending','in_process','authorized')),0)::text AS en_el_aire_centavos,
      count(*) FILTER(WHERE fulfillment_state='paid_unallocated')::int AS paid_unallocated_count FROM orders`)).rows[0];
    const unmatched = (await pool.query(`SELECT provider_payment_id,status,amount_centavos,currency,verified_at
      FROM payments WHERE order_id IS NULL ORDER BY created_at DESC LIMIT 100`)).rows;
    const uncertain = (await pool.query(`SELECT a.id AS intento_id,o.folio,a.state,a.expires_at
      FROM payment_attempts a JOIN orders o ON o.id=a.order_id
      WHERE a.state='uncertain' OR (a.state='creating' AND a.lease_until<clock_timestamp())
      ORDER BY a.created_at LIMIT 100`)).rows;
    const today = (await pool.query(`SELECT
      count(*) FILTER(WHERE event_type='pago_iniciado')::int AS links,
      count(*) FILTER(WHERE event_type='pago_aprobado' AND channel='orders_webhook')::int AS pagos,
      coalesce(sum((event_data->>'total_centavos')::bigint)
        FILTER(WHERE event_type='pago_aprobado' AND channel='orders_webhook'),0)::text AS cobrado_centavos,
      count(*) FILTER(WHERE event_type='pago_revision')::int AS revision
      FROM outbox WHERE created_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'America/Mexico_City')
        AT TIME ZONE 'America/Mexico_City'`)).rows[0];
    for (const amount of [money.cobrado_centavos, money.en_el_aire_centavos, today.cobrado_centavos]) {
      if (BigInt(amount) > BigInt(Number.MAX_SAFE_INTEGER)) throw unavailable();
    }
    return { pedidos: rows.map(order => ({ ...publicOrder(order), estado: order.payment_state === "pending" ? "pendiente" :
      order.payment_state === "review" ? "revision" : order.payment_state, fulfillment_state: order.fulfillment_state,
    motivo_revision: order.review_reason, pagado: order.paid_at, email: order.buyer_email, metodo: order.method,
    contacto: { nombre: order.buyer_name, whatsapp: order.buyer_phone }, items: order.items,
    envio: order.shipping_quote?.envio || null, logistica: order.shipping_quote?.logistica || null,
    destino: order.shipping_address })), dinero: { ...money, cobrado_centavos: Number(money.cobrado_centavos),
      en_el_aire_centavos: Number(money.en_el_aire_centavos), cobrado: centavosAPesos(Number(money.cobrado_centavos)) },
    hoy: { ...today, cobrado_centavos: Number(today.cobrado_centavos), fuente: "postgres" },
    pagos_no_conciliados: unmatched, intentos_inciertos: uncertain, inventario: await inventory(),
    persistencia: { ...state, paid_unallocated_count: money.paid_unallocated_count,
      pool_total: pool.totalCount, pool_idle: pool.idleCount, pool_waiting: pool.waitingCount } };
  }
  return { MESSAGE, UNCERTAIN_MESSAGE, ready, inventory, prepare, reconcile, read, publicOrder, admin, state,
    claimPreference: id => domain.claimPreference(pool, id),
    attachPreference: (leased, data) => domain.attachPreference(pool, leased, data),
    failPreference: (leased, definitive) => domain.failPreference(pool, leased, definitive),
    drain: deliver => domain.drainOutbox(pool, deliver), close: async () => pool?.end() };
}

module.exports = { createRuntime, config, providerObservation, MESSAGE };
