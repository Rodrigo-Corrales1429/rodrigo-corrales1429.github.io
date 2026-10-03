"use strict";

const crypto = require("node:crypto");
const { withTransaction } = require("../db/transaction");
const { cents } = require("../repositories/core");
const { lockInventory } = require("./inventory");

const STATUSES = new Set(["pending", "in_process", "authorized", "approved", "rejected", "cancelled", "refunded", "charged_back"]);
const step = (callback, name) => {
  if (callback) {
    if (process.env.NODE_ENV !== "test") throw new Error("Inyección solo permitida en test");
    callback(name);
  }
};

// observation es el resultado consultado y verificado por un futuro adaptador servidor de MP.
function validateObservation(observation, expected) {
  if (!observation || observation.verified !== true ||
      typeof observation.providerPaymentId !== "string" || !observation.providerPaymentId ||
      typeof observation.folio !== "string" || !observation.folio ||
      typeof observation.attemptId !== "string" || !observation.attemptId ||
      !STATUSES.has(observation.status) ||
      typeof expected?.accountId !== "string" || !expected.accountId ||
      !["sandbox", "production"].includes(expected.environment)) {
    throw new Error("Observación de pago no verificada o incompleta");
  }
  const amount = BigInt(cents(observation.amountCentavos));
  if (amount < 0n) throw new Error("Importe de pago inválido");
  return amount.toString();
}

async function applyVerifiedPayment(pool, observation, expected, { onStep } = {}) {
  return withTransaction(pool, client => applyVerifiedPaymentTx(client, observation, expected, { onStep }));
}

// El adaptador usa la MISMA transacción para evento/outbox y la transición de dominio.
async function applyVerifiedPaymentTx(client, observation, expected, { onStep } = {}) {
  const amount = validateObservation(observation, expected);
    await lockInventory(client);
    const order = (await client.query("SELECT * FROM orders WHERE folio=$1 FOR UPDATE", [observation.folio])).rows[0];
    const attempt = order && (await client.query(`SELECT id FROM payment_attempts
      WHERE id=$1 AND order_id=$2`, [observation.attemptId, order.id])).rows[0];
    const existing = (await client.query(`SELECT * FROM payments WHERE provider='mercado_pago'
      AND provider_payment_id=$1 FOR UPDATE`, [observation.providerPaymentId])).rows[0];
    if (existing?.order_id && (!order || existing.order_id !== order.id)) {
      return { outcome: "association_conflict" };
    }
    if (existing?.status === "approved" && order?.payment_state === "approved" &&
        !["refunded", "charged_back"].includes(observation.status)) {
      return { outcome: "duplicate" };
    }

    const associated = Boolean(order && attempt);
    const valid = associated && observation.currency === order.currency && amount === order.total_centavos &&
      observation.accountId === expected.accountId && observation.environment === expected.environment;
    const reason = !associated ? "association" : observation.currency !== order.currency ? "currency" :
      amount !== order.total_centavos ? "amount" : observation.accountId !== expected.accountId ? "account" :
      observation.environment !== expected.environment ? "environment" : null;
    if (existing) {
      // Un estado anterior nunca degrada una aprobación ya confirmada.
      if ((["refunded", "charged_back"].includes(existing.status) ||
          (existing.status === "approved" && observation.status !== "approved")) &&
          !["refunded", "charged_back"].includes(observation.status)) return { outcome: "duplicate" };
      await client.query(`UPDATE payments SET status=$2, amount_centavos=$3, currency=$4,
        provider_account_id=$5, provider_environment=$6, provider_updated_at=$7,
        order_id=COALESCE(order_id,$8), attempt_id=COALESCE(attempt_id,$9),
        verified_at=clock_timestamp(), updated_at=clock_timestamp(), version=version+1
        WHERE id=$1`, [existing.id, observation.status, amount, observation.currency,
        observation.accountId, observation.environment, observation.providerUpdatedAt || null,
        associated ? order.id : null, associated ? attempt.id : null]);
    } else {
      await client.query(`INSERT INTO payments (id,provider_payment_id,order_id,attempt_id,status,
        amount_centavos,currency,provider_account_id,provider_environment,provider_updated_at,verified_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,clock_timestamp())`,
      [crypto.randomUUID(), observation.providerPaymentId, associated ? order.id : null,
        associated ? attempt.id : null, observation.status, amount, observation.currency,
        observation.accountId, observation.environment, observation.providerUpdatedAt || null]);
    }
    step(onStep, "after_payment_write");
    if (!valid) {
      if (order && order.payment_state !== "approved") {
        await client.query(`UPDATE orders SET payment_state='review', review_reason=$2,
          version=version+1, updated_at=clock_timestamp() WHERE id=$1`, [order.id, reason]);
      }
      step(onStep, "before_commit");
      return { outcome: "review", reason };
    }
    if (["refunded", "charged_back"].includes(observation.status)) {
      await client.query(`UPDATE orders SET payment_state=$2, review_reason=$2,
        version=version+1, updated_at=clock_timestamp() WHERE id=$1`, [order.id, observation.status]);
      step(onStep, "before_commit");
      return { outcome: "financial_reversal" }; // Nunca repone inventario automáticamente.
    }
    if (observation.status !== "approved") {
      if (order.payment_state !== "approved") {
        await client.query(`UPDATE orders SET payment_state=$2, version=version+1,
          updated_at=clock_timestamp() WHERE id=$1`, [order.id, observation.status]);
        if (["rejected", "cancelled"].includes(observation.status)) {
          await client.query(`UPDATE inventory_reservations SET state='released', reason=$2,
            updated_at=clock_timestamp() WHERE order_id=$1 AND state='active'`, [order.id, observation.status]);
          await client.query(`UPDATE orders SET fulfillment_state='unallocated', version=version+1,
            updated_at=clock_timestamp() WHERE id=$1 AND fulfillment_state='reserved'`, [order.id]);
        }
      }
      step(onStep, "before_commit");
      return { outcome: "recorded" };
    }
    const priorSale = (await client.query(`SELECT 1 FROM inventory_movements
      WHERE order_id=$1 AND kind='sale' LIMIT 1`, [order.id])).rowCount > 0;
    if (priorSale || order.payment_state === "approved") {
      await client.query(`UPDATE orders SET payment_state='approved', review_reason='double_payment',
        version=version+1, updated_at=clock_timestamp() WHERE id=$1`, [order.id]);
      step(onStep, "before_commit");
      return { outcome: "double_payment" };
    }
    const lines = (await client.query(`SELECT sku, quantity FROM order_items
      WHERE order_id=$1 ORDER BY sku`, [order.id])).rows;
    if (!lines.length) throw new Error("Orden sin líneas persistidas");
    const skus = lines.map(line => line.sku);
    const now = (await client.query("SELECT clock_timestamp() AS at")).rows[0].at;
    const stock = (await client.query(`SELECT sku,on_hand FROM inventory
      WHERE sku=ANY($1::text[]) ORDER BY sku FOR UPDATE`, [skus])).rows;
    const held = (await client.query(`SELECT sku,sum(quantity)::bigint AS quantity
      FROM inventory_reservations WHERE sku=ANY($1::text[]) AND order_id<>$2
      AND state='active' AND expires_at>$3 GROUP BY sku`, [skus, order.id, now])).rows;
    const onHand = new Map(stock.map(row => [row.sku, BigInt(row.on_hand)]));
    const reserved = new Map(held.map(row => [row.sku, BigInt(row.quantity)]));
    const canAllocate = lines.every(line => BigInt(line.quantity) <=
      (onHand.get(line.sku) || 0n) - (reserved.get(line.sku) || 0n));
    // El pago verificado se conserva: queda aprobado, sin venta ni surtido, para revisión humana.
    const paidUnallocated = async reason => {
      await client.query(`UPDATE inventory_reservations SET state='released', reason='paid_unallocated',
        updated_at=clock_timestamp() WHERE order_id=$1 AND state='active'`, [order.id]);
      await client.query(`UPDATE orders SET payment_state='approved', fulfillment_state='paid_unallocated',
        review_reason=$2, version=version+1, updated_at=clock_timestamp() WHERE id=$1`, [order.id, reason]);
      step(onStep, "before_commit");
      return { outcome: "paid_unallocated", reason };
    };
    if (!canAllocate) return paidUnallocated("stock_unavailable");
    // El chequeo anterior no es garantía: cada descuento debe tocar exactamente una fila. Si uno
    // no lo hace (fila ausente, stock movido fuera del lock, un trigger), se deshace el descuento
    // de TODAS las líneas y la orden queda pagada sin asignar, como cuando no hay stock.
    await client.query("SAVEPOINT allocate_stock");
    for (const line of lines) {
      const { rowCount } = await client.query(`UPDATE inventory SET on_hand=on_hand-$2, version=version+1,
        updated_at=clock_timestamp() WHERE sku=$1 AND on_hand>=$2`, [line.sku, line.quantity]);
      if (rowCount !== 1) {
        await client.query("ROLLBACK TO SAVEPOINT allocate_stock");
        return paidUnallocated("stock_write_conflict");
      }
    }
    await client.query("RELEASE SAVEPOINT allocate_stock");
    step(onStep, "after_stock_decrement");
    for (const line of lines) {
      await client.query(`INSERT INTO inventory_movements
        (id,sku,order_id,kind,delta,operation_key) VALUES ($1,$2,$3,'sale',$4,$5)`,
      [crypto.randomUUID(), line.sku, order.id, -line.quantity, `sale:${order.id}:${line.sku}`]);
    }
    // La venta consume la mercancía de la orden: también la reserva ya vencida de un pago tardío.
    await client.query(`UPDATE inventory_reservations SET state='consumed',
      updated_at=clock_timestamp() WHERE order_id=$1 AND state='active'`, [order.id]);
    await client.query(`UPDATE orders SET payment_state='approved', fulfillment_state='allocated',
      review_reason=NULL, version=version+1, updated_at=clock_timestamp() WHERE id=$1`, [order.id]);
    step(onStep, "before_commit");
    return { outcome: "allocated" };
}

module.exports = { applyVerifiedPayment, applyVerifiedPaymentTx };
