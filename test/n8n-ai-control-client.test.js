import assert from "node:assert/strict";
import test from "node:test";
import {
  createN8nAiControlClient,
  N8nAiControlError,
  normalizeIndividualAiControlResponse,
} from "../server/n8n-ai-control-client.js";

test("normaliza boolean e estados ativo/pausado do webhook", () => {
  assert.equal(normalizeIndividualAiControlResponse({ enabled: true }), true);
  assert.equal(normalizeIndividualAiControlResponse([{ status: "pausado" }]), false);
  assert.equal(normalizeIndividualAiControlResponse({ data: { value: "ativo" } }), true);
  assert.throws(
    () => normalizeIndividualAiControlResponse({ ok: true }),
    (error) => error instanceof N8nAiControlError && error.code === "ai_control_invalid_response",
  );
});

test("GET individual envia somente telefone e segredo apenas no header", async () => {
  let request;
  const client = createN8nAiControlClient({
    webhookUrl: "https://n8n.example/webhook/control",
    webhookSecret: "n8n-secret",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return Response.json({ enabled: true });
    },
  });

  assert.equal(await client.getStatus("5547999999999"), true);
  assert.equal(request.options.headers["x-cedipi-ai-control-secret"], "n8n-secret");
  assert.deepEqual(JSON.parse(request.options.body), { phone: "5547999999999" });
  assert.equal(request.options.body.includes("n8n-secret"), false);
});

for (const enabled of [false, true]) {
  test(`PATCH individual envia enabled=${enabled}`, async () => {
    let body;
    const client = createN8nAiControlClient({
      webhookUrl: "https://n8n.example/webhook/control",
      webhookSecret: "n8n-secret",
      fetchImpl: async (_url, options) => {
        body = JSON.parse(options.body);
        return Response.json({ enabled });
      },
    });

    assert.equal(await client.setEnabled("5547999999999", enabled), enabled);
    assert.deepEqual(body, { phone: "5547999999999", enabled });
  });
}

test("erro do webhook não inclui segredo", async () => {
  const client = createN8nAiControlClient({
    webhookUrl: "https://n8n.example/webhook/control",
    webhookSecret: "n8n-secret",
    fetchImpl: async () => new Response("n8n-secret", { status: 500 }),
  });

  await assert.rejects(client.getStatus("5547999999999"), (error) => {
    assert.equal(error instanceof N8nAiControlError, true);
    assert.equal(JSON.stringify(error).includes("n8n-secret"), false);
    return true;
  });
});
