import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDatabasePool, closeDatabasePool } from "../server/database.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.resolve(scriptDirectory, "../migrations");
const migrationPattern = /^\d+[-_].+\.sql$/;

async function runMigrations() {
  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => migrationPattern.test(filename))
    .sort((left, right) => left.localeCompare(right));
  const client = await getDatabasePool().connect();

  try {
    await client.query("BEGIN;");
    await client.query("SELECT pg_advisory_xact_lock($1);", [20260906]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id BIGSERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const appliedResult = await client.query("SELECT filename FROM schema_migrations;");
    const applied = new Set(appliedResult.rows.map((row) => row.filename));

    for (const filename of filenames) {
      if (applied.has(filename)) {
        console.log(`Migration já aplicada: ${filename}`);
        continue;
      }

      const sql = await readFile(path.join(migrationsDirectory, filename), "utf8");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1);",
        [filename],
      );
      console.log(`Migration aplicada: ${filename}`);
    }

    await client.query("COMMIT;");
    console.log("Migrations concluídas.");
  } catch (error) {
    await client.query("ROLLBACK;").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

try {
  await runMigrations();
} catch (error) {
  console.error("Falha ao executar migrations:", error);
  process.exitCode = 1;
} finally {
  await closeDatabasePool();
}
