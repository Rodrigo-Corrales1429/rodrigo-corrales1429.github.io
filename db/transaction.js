"use strict";

async function withTransaction(pool, work) {
  const client = await pool.connect();
  let begun = false;
  let committing = false;
  let discard = false;
  // pg también emite 'error' en clientes prestados al cortarse el socket. El
  // listener del pool sólo protege los inactivos; no tumbar el proceso durante TX.
  const disconnected = () => { discard = true; };
  client.on("error", disconnected);
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
    client.removeListener("error", disconnected);
  }
}

module.exports = { withTransaction };
