"use strict";

// Todos los métodos reciben un cliente SQL. El llamador decide el límite transaccional.
function cents(value) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new RangeError("Centavos deben ser enteros seguros");
  }
  if (!(["number", "bigint", "string"].includes(typeof value)) || !/^-?\d+$/.test(String(value))) {
    throw new TypeError("Centavos deben ser enteros decimales");
  }
  const amount = BigInt(value);
  if (amount < -(2n ** 63n) || amount > 2n ** 63n - 1n) {
    throw new RangeError("Centavos fuera de rango bigint");
  }
  return amount.toString();
}

async function insertOrder(client, order) {
  const { rows } = await client.query(`
    INSERT INTO orders (id, folio, currency, subtotal_centavos, shipping_centavos,
      total_centavos, buyer_name, buyer_email, buyer_phone, shipping_address)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
  [order.id, order.folio, order.currency, cents(order.subtotalCentavos), cents(order.shippingCentavos),
    cents(order.totalCentavos), order.buyerName || null, order.buyerEmail || null,
    order.buyerPhone || null, order.shippingAddress || null]);
  return rows[0];
}

async function insertOrderItem(client, item) {
  const { rows } = await client.query(`
    INSERT INTO order_items (order_id, sku, title, quantity, unit_price_centavos, line_total_centavos)
    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
  [item.orderId, item.sku, item.title, item.quantity, cents(item.unitPriceCentavos), cents(item.lineTotalCentavos)]);
  return rows[0];
}

async function insertPaymentAttempt(client, attempt) {
  const { rows } = await client.query(`
    INSERT INTO payment_attempts (id, order_id, request_fingerprint, provider_key, idempotency_key_hash)
    VALUES ($1,$2,$3,$4,$5) RETURNING *`,
  [attempt.id, attempt.orderId, attempt.requestFingerprint, attempt.providerKey,
    attempt.idempotencyKeyHash || null]);
  return rows[0];
}

async function getOrderByFolio(client, folio) {
  const { rows } = await client.query("SELECT * FROM orders WHERE folio = $1", [folio]);
  return rows[0] || null;
}

module.exports = { insertOrder, insertOrderItem, insertPaymentAttempt, getOrderByFolio };
