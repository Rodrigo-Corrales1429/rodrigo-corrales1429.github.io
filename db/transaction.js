"use strict";

async function withTransaction(pool, work) {
  const client = await pool.connect();
  let begun = false;
  let committing = false;
  let discard = false;
  try {
    await client.query("BEGIN");
    begun = true;
    const result = await work(client);
    committing = true;
    await client.query("COMMIT");
    committing = false;
    begun = false;
    return result;
  } catch (error) {
    if (!begun || committing) discard = true;
    if (begun) {
      try { await client.query("ROLLBACK"); } catch { discard = true; }
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

module.exports = { withTransaction };
