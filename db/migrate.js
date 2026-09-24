"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createPool } = require("./pool");
const { withTransaction } = require("./transaction");

const DEFAULT_DIRECTORY = path.join(__dirname, "migrations");
const MIGRATION_FILE = /^\d{3}_[a-z0-9_]+\.sql$/;
const LOCK_KEY = "842034055317201";

async function migrate(pool, directory = DEFAULT_DIRECTORY) {
  const names = (await fs.readdir(directory)).filter(name => MIGRATION_FILE.test(name)).sort();
  if (!names.length) throw new Error("No hay migraciones SQL");
  const versions = names.map(name => name.slice(0, 3));
  if (new Set(versions).size !== versions.length) throw new Error("Versiones de migración duplicadas");
  const files = await Promise.all(names.map(async name => {
    const bytes = await fs.readFile(path.join(directory, name));
    return { name, version: name.slice(0, 3), sql: bytes.toString("utf8"),
      checksum: crypto.createHash("sha256").update(bytes).digest("hex") };
  }));

  return withTransaction(pool, async client => {
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY CHECK (version ~ '^[0-9]{3}$'),
      name text NOT NULL,
      checksum char(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const existing = new Map((await client.query("SELECT version, name, checksum FROM schema_migrations")).rows.map(row => [row.version, row]));
    for (const version of existing.keys()) {
      if (!versions.includes(version)) throw new Error(`Migración aplicada ${version} ausente del código`);
    }
    const latestApplied = [...existing.keys()].sort().at(-1);
    let applied = 0;
    for (const file of files) {
      const previous = existing.get(file.version);
      if (previous) {
        if (previous.name !== file.name || previous.checksum !== file.checksum) {
          throw new Error(`Checksum o nombre cambió para migración ${file.version}`);
        }
        continue;
      }
      if (latestApplied && file.version < latestApplied) {
        throw new Error(`Migración ${file.version} agregada antes de una versión aplicada`);
      }
      await client.query(file.sql);
      await client.query("INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
        [file.version, file.name, file.checksum]);
      applied++;
    }
    return { applied, total: files.length };
  });
}

if (require.main === module) {
  const pool = createPool();
  migrate(pool)
    .then(result => process.stdout.write(`Migraciones aplicadas: ${result.applied}; verificadas: ${result.total}\n`))
    .catch(() => { process.stderr.write("Migración fallida; comprueba el esquema y la configuración de PostgreSQL.\n"); process.exitCode = 1; })
    .finally(() => pool.end());
}

module.exports = { migrate };
