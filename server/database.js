import pg from "pg";

const { Pool } = pg;

let pool;

export function getDatabasePool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL não está configurada.");
  }

  pool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  return pool;
}

export async function checkDatabaseConnection() {
  await getDatabasePool().query("SELECT 1;");
}

export async function closeDatabasePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
