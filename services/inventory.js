"use strict";

const crypto = require("node:crypto");
const { withTransaction } = require("../db/transaction");

// La misma clave y el mismo orden de locks se usan en reserva, liberación y cobro.
const INVENTORY_LOCK_KEY = "482003741930211";

function configuredInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function reservationLimits(overrides = {}, environment = process.env) {
  const quoteMax = configuredInt(environment.CANTIDAD_MAXIMA_POR_LINEA, 200);
  const maxPerSku = Math.min(quoteMax, configuredInt(environment.INVENTARIO_MAX_POR_SKU, 6));
  const effectivePerSku = Math.min(quoteMax, configuredInt(overrides.maxPerSku ?? environment.INVENTARIO_MAX_POR_SKU, maxPerSku));
  const parsedFraction = Number.parseFloat(environment.INVENTARIO_FRACCION_RESERVABLE);
  return {
    ttlMinutes: Math.min(60, Math.max(1, configuredInt(overrides.ttlMinutes ?? environment.INVENTARIO_MINUTOS_RESERVA, 15))),
    maxPerSku: effectivePerSku,
    maxUnits: Math.max(effectivePerSku, configuredInt(overrides.maxUnits ?? environment.INVENTARIO_MAX_UNIDADES, 12)),
    maxPerIdentity: configuredInt(overrides.maxPerIdentity ?? environment.INVENTARIO_MAX_RESERVAS_POR_IDENTIDAD, 1),
    fraction: Math.min(0.8, Math.max(0.1, Number.isFinite(Number(overrides.fraction))
      ? Number(overrides.fraction)
      : Number.isFinite(parsedFraction) && parsedFraction > 0 ? parsedFraction : 0.5)),
    safetyStock: Math.max(1, configuredInt(overrides.safetyStock ?? environment.INVENTARIO_STOCK_SEGURIDAD, 1))
  };
}

async function lockInventory(client) {
  await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [INVENTORY_LOCK_KEY]);
}

function hashIdentity(identity, hashKey) {
  if (!identity || !hashKey) throw new Error("Identidad y clave HMAC requeridas para reservar");
  return crypto.createHmac("sha256", hashKey).update(String(identity)).digest("hex");
}

function validateLines(lines, limits) {
  if (!Array.isArray(lines) || !lines.length) throw new Error("Orden sin líneas");
  const skus = new Set();
  let units = 0;
  for (const line of lines) {
    if (typeof line.sku !== "string" || !line.sku || skus.has(line.sku) ||
        !Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      throw new Error("Línea de reserva inválida o duplicada");
    }
    skus.add(line.sku);
    if (line.quantity > limits.maxPerSku) return { ok: false, reason: "max_per_sku", sku: line.sku };
    units += line.quantity;
  }
  if (units > limits.maxUnits) return { ok: false, reason: "max_units" };
  return { ok: true, skus: [...skus].sort() };
}

// Devuelve un resultado de negocio, no lanza por falta de stock: la liberación previa debe COMMIT.
async function prepareReservationTx(client, { lines, identity, hashKey, limits: overrides }) {
  const limits = reservationLimits(overrides);
  const validation = validateLines(lines, limits);
  if (!validation.ok) return validation;
  const identityHash = hashIdentity(identity, hashKey);
  await lockInventory(client);
  const now = (await client.query("SELECT clock_timestamp() AS at")).rows[0].at;

  const previous = (await client.query(`
    SELECT DISTINCT r.order_id, min(r.created_at) AS oldest
    FROM inventory_reservations r
    WHERE r.identity_hash = $1 AND r.state = 'active' AND r.expires_at > $2
    GROUP BY r.order_id ORDER BY oldest, r.order_id`, [identityHash, now])).rows;
  const releaseCount = Math.max(0, previous.length - (limits.maxPerIdentity - 1));
  const releasedOrderIds = previous.slice(0, releaseCount).map(row => row.order_id).sort();
  if (releasedOrderIds.length) {
    await client.query(`UPDATE inventory_reservations SET state='released', reason='replaced', updated_at=clock_timestamp()
      WHERE order_id = ANY($1::uuid[]) AND state='active' AND expires_at > $2`, [releasedOrderIds, now]);
    await client.query(`UPDATE orders SET fulfillment_state='unallocated', version=version+1, updated_at=clock_timestamp()
      WHERE id = ANY($1::uuid[]) AND fulfillment_state='reserved'`, [releasedOrderIds]);
  }

  const stockRows = (await client.query(`SELECT sku, on_hand FROM inventory
    WHERE sku = ANY($1::text[]) ORDER BY sku FOR UPDATE`, [validation.skus])).rows;
  const stock = new Map(stockRows.map(row => [row.sku, row.on_hand]));
  const heldRows = (await client.query(`SELECT sku, sum(quantity)::bigint AS quantity
    FROM inventory_reservations
    WHERE sku = ANY($1::text[]) AND state='active' AND expires_at > $2
    GROUP BY sku`, [validation.skus, now])).rows;
  const held = new Map(heldRows.map(row => [row.sku, BigInt(row.quantity)]));

  for (const line of lines) {
    const onHand = stock.get(line.sku) || 0;
    const reserved = held.get(line.sku) || 0n;
    if (BigInt(line.quantity) > BigInt(onHand) - reserved) {
      return { ok: false, reason: "stock", sku: line.sku, releasedOrderIds };
    }
  }
  for (const line of lines) {
    const onHand = stock.get(line.sku) || 0;
    const reserved = held.get(line.sku) || 0n;
    const ceiling = Math.min(Math.floor(onHand * limits.fraction), Math.max(0, onHand - limits.safetyStock));
    if (BigInt(line.quantity) > BigInt(ceiling) - reserved) {
      return { ok: false, reason: "stock_protected", sku: line.sku, releasedOrderIds };
    }
  }
  return { ok: true, identityHash, expiresAt: new Date(now.getTime() + limits.ttlMinutes * 60_000), releasedOrderIds };
}

async function insertReservationTx(client, { orderId, lines, identityHash, expiresAt }) {
  for (const line of lines) {
    await client.query(`INSERT INTO inventory_reservations
      (order_id, sku, quantity, identity_hash, expires_at) VALUES ($1,$2,$3,$4,$5)`,
    [orderId, line.sku, line.quantity, identityHash, expiresAt]);
  }
}

async function releaseReservation(pool, orderId, reason = "cancelled") {
  return withTransaction(pool, async client => {
    await lockInventory(client);
    const order = (await client.query("SELECT payment_state FROM orders WHERE id=$1 FOR UPDATE", [orderId])).rows[0];
    if (!order) return { released: false, reason: "order_missing" };
    if (order.payment_state === "approved") return { released: false, reason: "paid" };
    const result = await client.query(`UPDATE inventory_reservations
      SET state='released', reason=$2, updated_at=clock_timestamp()
      WHERE order_id=$1 AND state='active' RETURNING sku`, [orderId, reason]);
    if (result.rowCount) {
      await client.query(`UPDATE orders SET fulfillment_state='unallocated', version=version+1,
        updated_at=clock_timestamp() WHERE id=$1 AND fulfillment_state='reserved'`, [orderId]);
    }
    return { released: result.rowCount > 0, lines: result.rowCount };
  });
}

module.exports = { lockInventory, hashIdentity, reservationLimits, prepareReservationTx, insertReservationTx, releaseReservation };
