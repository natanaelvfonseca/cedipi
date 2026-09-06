import { checkDatabaseConnection } from "./database.js";

export function createDatabaseHealthHandler(checkConnection = checkDatabaseConnection) {
  return async function databaseHealthHandler(_request, response) {
    try {
      await checkConnection();
      response.status(200).json({ ok: true, database: "connected" });
    } catch (error) {
      console.error("Falha no health check do PostgreSQL:", error);
      response.status(503).json({ ok: false, database: "disconnected" });
    }
  };
}
