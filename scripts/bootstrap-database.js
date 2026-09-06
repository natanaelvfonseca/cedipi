import pg from "pg";

const { Client } = pg;
const databaseName = "cedipi_core";
const adminUrl = process.env.POSTGRES_ADMIN_URL;

if (!adminUrl) {
  console.error(
    "POSTGRES_ADMIN_URL não está configurada. Informe HOST, porta, usuário postgres e senha no ambiente.",
  );
  process.exit(1);
}

const client = new Client({
  connectionString: adminUrl,
  connectionTimeoutMillis: 10_000,
});

try {
  await client.connect();
  console.log("Conexão com PostgreSQL realizada.");

  const result = await client.query(
    "SELECT 1 FROM pg_database WHERE datname = $1;",
    [databaseName],
  );

  if (result.rowCount > 0) {
    console.log("cedipi_core já existia.");
  } else {
    await client.query('CREATE DATABASE "cedipi_core";');
    console.log("cedipi_core criado.");
  }
} catch (error) {
  console.error("Não foi possível inicializar cedipi_core:", error);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
