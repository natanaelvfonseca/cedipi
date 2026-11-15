import { createApp } from "./app.js";
import { closeDatabasePool } from "./database.js";
import { createAuthService } from "./auth-service.js";
import { getGlobalAiEnabled } from "./ai-control-repository.js";
import { startLaraTestMode } from "./lara-test-mode.js";
import { startLaraProductionMode } from "./lara-production-mode.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const authService = createAuthService();
try {
  const bootstrap = await authService.bootstrapInitialAdmin();
  if (bootstrap.created) console.log("Administrador inicial CEDIPI criado; troca de senha obrigatória.");
} catch (error) {
  console.error("Não foi possível inicializar a autenticação.");
  await closeDatabasePool();
  process.exit(1);
}
const app = createApp({ authService });

let stopTestMode = () => {};
if (process.env.LARA_PRODUCTION_MODE === "true") {
  try {
    if (await getGlobalAiEnabled() !== true)
      throw new Error("AI global switch is paused");
    stopTestMode = startLaraProductionMode();
  } catch (error) {
    console.error("Lara production startup blocked: ", error.message);
    await closeDatabasePool();
    process.exit(1);
  }
} else if (process.env.LARA_TEST_MODE === "true") {
  try {
    stopTestMode = startLaraTestMode();
  } catch {
    console.error("Modo de teste Lara inválido; encerrando para não afetar pacientes.");
    await closeDatabasePool();
    process.exit(1);
  }
}

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Servidor CEDIPI disponível na porta ${port}.`);
});

async function shutdown(signal) {
  stopTestMode();
  console.log(`${signal} recebido; encerrando o servidor.`);
  server.close(async () => {
    try {
      await closeDatabasePool();
      process.exit(0);
    } catch (error) {
      console.error("Erro ao encerrar a conexão PostgreSQL:", error);
      process.exit(1);
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
