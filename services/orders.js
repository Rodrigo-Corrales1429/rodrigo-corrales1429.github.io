"use strict";

const crypto = require("node:crypto");
const { withTransaction } = require("../db/transaction");
const repo = require("../repositories/core");
const inventory = require("./inventory");

function money(value) {
  const amount = BigInt(repo.cents(value));
  if (amount < 0n) throw new RangeError("Importe negativo");
  return amount;
}

// quote debe proceder del motor de cotización del servidor; este servicio no acepta un carrito público.
function validateQuote(quote) {
  if (!quote || quote.currency !== "MXN" || !Array.isArray(quote.lines) || !quote.lines.length) {
    throw new Error("Cotización interna inválida");
  }
  const skus = new Set();
  let subtotal = 0n;
  const lines = quote.lines.map(line => {
    if (typeof line.sku !== "string" || !line.sku || skus.has(line.sku) ||
        typeof line.title !== "string" || !line.title ||
        !Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      throw new Error("Línea interna inválida");
    }
    skus.add(line.sku);
    const unit = money(line.unitPriceCentavos);
    const total = money(line.lineTotalCentavos);
    if (total !== unit * BigInt(line.quantity)) throw new Error("Total de línea inconsistente");
    subtotal += total;
    return { ...line, unitPriceCentavos: unit.toString(), lineTotalCentavos: total.toString() };
  });
  const shipping = money(quote.shippingCentavos);
  const total = money(quote.totalCentavos);
  if (subtotal !== money(quote.subtotalCentavos) || total !== subtotal + shipping || total === 0n ||
      total > 9223372036854775807n) throw new Error("Total de orden inconsistente");
  return { lines, subtotalCentavos: subtotal.toString(), shippingCentavos: shipping.toString(),
    totalCentavos: total.toString(), currency: "MXN" };
}

function digest(value, key) {
  if (!key) throw new Error("Clave HMAC requerida");
  return crypto.createHmac("sha256", key).update(value).digest("hex");
}

// identity es el dueño de la reserva: el UUID del visitante, nunca la IP (la comparten personas distintas).
async function prepareCheckout(pool, options) {
  return withTransaction(pool, client => prepareCheckoutTx(client, options));
}

// Permite al adaptador asociar snapshot/intent en TX1, sin duplicar reservas ni lógica SQL.
async function prepareCheckoutTx(client, { quote, identity, hashKey, folio, buyer = {}, idempotencyKey, limits, reuseActive = false }) {
  const priced = validateQuote(quote);
  if (typeof folio !== "string" || folio.length < 3 || folio.length > 120) throw new Error("Folio inválido");
  const identityHash = inventory.hashIdentity(identity, hashKey);
  const fingerprint = digest(JSON.stringify({ version: 2, identityHash, priced, buyer }), hashKey);
  const idempotencyHash = idempotencyKey ? digest(idempotencyKey, hashKey) : null;
    await inventory.lockInventory(client);
    if (idempotencyHash) {
      const existing = (await client.query(`SELECT a.id AS attempt_id, a.request_fingerprint, a.provider_key,
        o.id AS order_id, o.folio FROM payment_attempts a JOIN orders o ON o.id=a.order_id
        WHERE a.idempotency_key_hash=$1`, [idempotencyHash])).rows[0];
      if (existing) {
        if (existing.request_fingerprint !== fingerprint) return { ok: false, reason: "idempotency_conflict" };
        return { ok: true, repeated: true, orderId: existing.order_id, attemptId: existing.attempt_id,
          folio: existing.folio, providerKey: existing.provider_key };
      }
    }
    if (!idempotencyHash && reuseActive) {
      const existing = (await client.query(`SELECT a.id AS attempt_id, a.provider_key, o.id AS order_id, o.folio
        FROM payment_attempts a JOIN orders o ON o.id=a.order_id
        WHERE a.request_fingerprint=$1 AND a.state<>'failed' AND a.expires_at>clock_timestamp()
        AND o.payment_state IN ('pending','in_process','authorized')
        AND EXISTS (SELECT 1 FROM inventory_reservations r WHERE r.order_id=o.id
          AND r.identity_hash=$2 AND r.state='active')
        ORDER BY a.created_at DESC LIMIT 1`, [fingerprint, identityHash])).rows[0];
      if (existing) return { ok: true, repeated: true, orderId: existing.order_id,
        attemptId: existing.attempt_id, folio: existing.folio, providerKey: existing.provider_key };
    }
    if (await repo.getOrderByFolio(client, folio)) return { ok: false, reason: "folio_conflict" };
    const reservation = await inventory.prepareReservationTx(client, {
      lines: priced.lines, identity, hashKey, limits
    });
    if (!reservation.ok) return reservation; // Se confirma cualquier liberación por reemplazo.

    const orderId = crypto.randomUUID();
    const attemptId = crypto.randomUUID();
    const providerKey = crypto.randomUUID();
    await repo.insertOrder(client, { id: orderId, folio, ...priced,
      buyerName: buyer.name, buyerEmail: buyer.email, buyerPhone: buyer.phone,
      shippingAddress: buyer.shippingAddress });
    for (const line of priced.lines) await repo.insertOrderItem(client, { ...line, orderId });
    await repo.insertPaymentAttempt(client, { id: attemptId, orderId, requestFingerprint: fingerprint,
      providerKey, idempotencyKeyHash: idempotencyHash });
    await inventory.insertReservationTx(client, { orderId, lines: priced.lines,
      identityHash: reservation.identityHash, expiresAt: reservation.expiresAt });
    await client.query(`UPDATE orders SET fulfillment_state='reserved', version=version+1,
      updated_at=clock_timestamp() WHERE id=$1`, [orderId]);
    return { ok: true, orderId, attemptId, folio, providerKey,
      expiresAt: reservation.expiresAt, releasedOrderIds: reservation.releasedOrderIds };
}

async function getOrder(pool, folio) {
  return withTransaction(pool, async client => {
    const order = await repo.getOrderByFolio(client, folio);
    if (!order) return null;
    const items = (await client.query("SELECT * FROM order_items WHERE order_id=$1 ORDER BY sku", [order.id])).rows;
    return { ...order, items };
  });
}

module.exports = { prepareCheckout, prepareCheckoutTx, getOrder };
