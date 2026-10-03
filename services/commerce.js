"use strict";

const crypto = require("node:crypto");
const { withTransaction } = require("../db/transaction");
const { prepareCheckoutTx, getOrder } = require("./orders");
const { applyVerifiedPaymentTx } = require("./payments");
const { lockInventory } = require("./inventory");

const uuid = () => crypto.randomUUID();
async function enqueue(client, { orderId, eventId, version = 1, type, channel = "notice", key, data = {} }) {
  await client.query(`INSERT INTO outbox(id,order_id,payment_event_id,entity_version,event_type,channel,dedupe_key,event_data)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(dedupe_key) DO NOTHING`,
  [uuid(), orderId || null, orderId ? null : eventId, version, type, channel, key, data]);
}

// TX1: pedido, líneas, reserva, intent y snapshot interno; nunca llama a la red.
async function prepare(pool, options, { shipping, expiresAt }) {
  return withTransaction(pool, async client => {
    const result = await prepareCheckoutTx(client, { ...options, reuseActive: true });
    if (!result.ok || result.repeated) return result;
    await client.query("UPDATE orders SET shipping_quote=$2 WHERE id=$1", [result.orderId, shipping]);
    await client.query("UPDATE payment_attempts SET expires_at=$2 WHERE id=$1", [result.attemptId, expiresAt]);
    return result;
  });
}

async function attempt(pool, id) {
  return (await pool.query("SELECT * FROM payment_attempts WHERE id=$1", [id])).rows[0];
}

// Lease SQL: dos procesos no crean preferencias al mismo tiempo. No se presupone
// idempotencia externa del endpoint Preferences: un POST incierto NO se repite.
async function claimPreference(pool, id) {
  return withTransaction(pool, async client => {
    const row = (await client.query(`SELECT a.*,o.payment_state FROM payment_attempts a
      JOIN orders o ON o.id=a.order_id WHERE a.id=$1 FOR UPDATE OF a`, [id])).rows[0];
    if (!row || !["pending", "in_process", "authorized"].includes(row.payment_state)) return { closed: true };
    if (!row.expires_at || row.expires_at <= new Date() || row.state === "failed") {
      return { closed: true, uncertain: ["creating", "uncertain"].includes(row.state) };
    }
    if (row.state === "ready") return { ready: true, attempt: row };
    if (row.state !== "prepared" || row.retry_count > 0) {
      await client.query(`UPDATE payment_attempts SET state='uncertain',lease_until=NULL,
        next_check_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
        WHERE id=$1 AND (lease_until IS NULL OR lease_until<clock_timestamp())`, [id]);
      return { closed: true, uncertain: true }; // diagnóstico para texto HTTP; jamás POST ciego.
    }
    const claimed = await client.query(`UPDATE payment_attempts SET state='creating',
      lease_until=clock_timestamp()+interval '30 seconds', lease_generation=lease_generation+1,
      retry_count=retry_count+1, version=version+1, updated_at=clock_timestamp()
      WHERE id=$1 AND (lease_until IS NULL OR lease_until<clock_timestamp()) RETURNING *`, [id]);
    return claimed.rowCount ? { claimed: true, attempt: claimed.rows[0] } : { busy: true, uncertain: true };
  });
}

// TX2: asociación de la preferencia + aviso durable. Compare-and-set con fencing.
async function attachPreference(pool, leased, data) {
  return withTransaction(pool, async client => {
    const updated = await client.query(`UPDATE payment_attempts SET preference_id=$2,checkout_url=$3,
      state='ready',lease_until=NULL,next_check_at=NULL,version=version+1,updated_at=clock_timestamp()
      WHERE id=$1 AND state='creating' AND lease_generation=$4 RETURNING order_id`,
    [leased.id, data.id, data.init_point, leased.lease_generation]);
    if (updated.rowCount !== 1) throw new Error("preference_fence");
    await enqueue(client, { orderId: leased.order_id, type: "pago_iniciado",
      key: `checkout:${leased.id}`, data: {} });
  });
}

async function failPreference(pool, leased, definitive) {
  return withTransaction(pool, async client => {
    await lockInventory(client);
    const updated = await client.query(`UPDATE payment_attempts SET state=$2,lease_until=NULL,
      next_check_at=clock_timestamp()+interval '1 minute',version=version+1,updated_at=clock_timestamp()
      WHERE id=$1 AND state='creating' AND lease_generation=$3 RETURNING order_id`,
    [leased.id, definitive ? "failed" : "uncertain", leased.lease_generation]);
    if (definitive && updated.rowCount) {
      await client.query(`UPDATE inventory_reservations SET state='released',reason='preference_failed',
        updated_at=clock_timestamp() WHERE order_id=$1 AND state='active'`, [leased.order_id]);
      await client.query(`UPDATE orders SET fulfillment_state='unallocated',version=version+1,
        updated_at=clock_timestamp() WHERE id=$1 AND payment_state<>'approved' AND fulfillment_state='reserved'`, [leased.order_id]);
    }
  });
}

async function reconcile(pool, observation, expected, eventKey, methodType) {
  return withTransaction(pool, async client => {
    await lockInventory(client);
    const event = await client.query(`INSERT INTO payment_events(id,source,external_event_id,provider_payment_id)
      VALUES($1,'webhook',$2,$3) ON CONFLICT(provider,external_event_id)
      WHERE external_event_id IS NOT NULL DO NOTHING RETURNING id`, [uuid(), eventKey, observation.providerPaymentId]);
    if (!event.rowCount) return { outcome: "duplicate" };
    const eventId = event.rows[0].id;
    const result = await applyVerifiedPaymentTx(client, observation, expected);
    await client.query(`UPDATE payments SET method_type=$2 WHERE provider_payment_id=$1`,
      [observation.providerPaymentId, methodType]);
    const review = ["review", "association_conflict", "double_payment", "paid_unallocated", "financial_reversal"].includes(result.outcome);
    await client.query(`UPDATE payment_events SET outcome=$2,processed_at=clock_timestamp(),error_code=$3 WHERE id=$1`,
      [eventId, result.outcome === "duplicate" ? "duplicate" : review ? "review" : "applied", result.reason || (review ? result.outcome : null)]);
    if (result.outcome !== "duplicate") {
      const order = (await client.query("SELECT id,version FROM orders WHERE folio=$1", [observation.folio])).rows[0];
      const type = result.outcome === "allocated" ? "pago_aprobado" : result.outcome === "double_payment" ? "pago_duplicado" :
        review ? "pago_revision" : ["rejected", "cancelled"].includes(observation.status) ? "pago_rechazado" : "pago_pendiente";
      const data = { folio: observation.folio, pago_id: observation.providerPaymentId,
        total_centavos: Number(observation.amountCentavos), motivo: result.reason || result.outcome,
        metodo: methodType, estado: observation.status };
      if (result.outcome === "double_payment") {
        data.pago_duplicado = observation.providerPaymentId;
        data.pago_original = (await client.query(`SELECT provider_payment_id FROM payments
          WHERE order_id=$1 AND status='approved' AND provider_payment_id<>$2
          ORDER BY verified_at,id LIMIT 1`, [order.id, observation.providerPaymentId])).rows[0]?.provider_payment_id || "en revisión";
      }
      await enqueue(client, { orderId: order?.id, eventId, version: order?.version || 1, type,
        key: `payment:${eventKey}`, data });
      if (result.outcome === "allocated") await enqueue(client, { orderId: order.id, version: order.version,
        type, channel: "orders_webhook", key: `sale:${order.id}`, data });
      await client.query(`INSERT INTO audit_events(id,entity_type,entity_id,new_state,actor,correlation_id,reason)
        VALUES($1,'payment',$2,$3,'system',$4,$5)`,
        [uuid(), observation.providerPaymentId, observation.status, eventKey, result.reason || result.outcome]);
    }
    return result;
  });
}

// La entrega es at-least-once; los receptores deben deduplicar por outbox.id.
async function drainOutbox(pool, deliver, limit = 20) {
  for (let i = 0; i < limit; i++) {
    const row = await withTransaction(pool, async client => {
      const selected = (await client.query(`SELECT id FROM outbox WHERE
        ((state IN ('pending','failed') AND next_attempt_at<=clock_timestamp()) OR
          (state='sending' AND lease_until<clock_timestamp()))
        ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
      if (!selected) return null;
      return (await client.query(`UPDATE outbox SET state='sending',lease_until=clock_timestamp()+interval '30 seconds',
        lease_generation=lease_generation+1,retry_count=retry_count+1,updated_at=clock_timestamp()
        WHERE id=$1 RETURNING *`, [selected.id])).rows[0];
    });
    if (!row) break;
    let delivered = false;
    try {
      const order = row.order_id && (await pool.query("SELECT folio FROM orders WHERE id=$1", [row.order_id])).rows[0];
      delivered = await deliver(row, order ? await getOrder(pool, order.folio) : null) === true;
    } catch { /* No persistir mensaje, SQL ni PII del error. */ }
    await pool.query(`UPDATE outbox SET state=$2,lease_until=NULL,external_result_code=$3,
      next_attempt_at=clock_timestamp()+interval '1 minute',updated_at=clock_timestamp()
      WHERE id=$1 AND state='sending' AND lease_generation=$4`,
    [row.id, delivered ? "delivered" : "failed", delivered ? "delivered" : "delivery_failed", row.lease_generation]);
  }
}

module.exports = { prepare, attempt, claimPreference, attachPreference, failPreference, reconcile, drainOutbox };
