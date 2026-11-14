import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../server/app.js";
import { normalizeEvolutionMessage } from "../server/lara-event-normalizer.js";
import { createLaraWebhookHandler } from "../server/lara-webhook.js";
import { enqueueLaraMessage } from "../server/lara-inbox-repository.js";
import {
  identifyLaraIntent, createLaraModel, composeLaraReply, LaraModelError,
} from "../server/lara-response.js";
import { createLaraWorker } from "../server/lara-worker-service.js";

const phone = "5511999999999";
const payload = {
  event: "messages.upsert",
  instance: "Cedipi",
  data: {
    key: { id: "ABC-123", fromMe: false, remoteJid: phone + "@s.whatsapp.net" },
    message: { conversation: "Olá, bom dia" },
  },
};
const secret = "test-secret-".repeat(5);
function recorder() {
  return {
    statusCode: 0, jsonBody: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; return this; },
  };
}
function request(body = payload, key = secret) {
  return { body, get(header) { return header === "x-cedipi-webhook-secret" ? key : null; } };
}
const event = {
  instance: "Cedipi", phone, remoteJid: phone + "@s.whatsapp.net",
  messageId: "ABC-123", text: "Olá, bom dia",
};
const batch = [{
  id: 1, body: "Gostaria do endereço", message_id: "mid-1",
  remote_jid: phone + "@s.whatsapp.net", attempts: 1,
}];

test("Evolution normalizer accepts only inbound individual texts for Cedipi", () => {
  assert.deepEqual(normalizeEvolutionMessage(payload), event);
  assert.equal(normalizeEvolutionMessage({ ...payload, instance: "Other" }), null);
  assert.equal(normalizeEvolutionMessage({ ...payload, event: "messages.update" }), null);
  assert.equal(normalizeEvolutionMessage({
    ...payload, data: { ...payload.data, key: { ...payload.data.key, fromMe: true } },
  }), null);
  assert.equal(normalizeEvolutionMessage({
    ...payload, data: { ...payload.data,
      key: { ...payload.data.key, remoteJid: "5511999@g.us" } },
  }), null);
  assert.equal(normalizeEvolutionMessage({
    ...payload, data: { ...payload.data, message: { audioMessage: {} } },
  }), null);
  assert.equal(normalizeEvolutionMessage({
    ...payload, data: { ...payload.data, message: {
      extendedTextMessage: { text: "  Onde fica?  " },
    } },
  }).text, "Onde fica?");
});

test("webhook fails closed when disabled and rejects invalid secret", async () => {
  let calls = 0;
  const enqueue = async () => { calls++; return { duplicate: false }; };
  const disabled = recorder();
  await createLaraWebhookHandler({ enabled: false, secret, enqueue })(request(), disabled);
  assert.equal(disabled.statusCode, 503);
  const unauthorized = recorder();
  await createLaraWebhookHandler({ enabled: true, secret, enqueue })(
    request(payload, "wrong-token"), unauthorized,
  );
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(calls, 0);
});

test("webhook handles duplicates and ignores outbound events", async () => {
  let calls = 0;
  const handler = createLaraWebhookHandler({
    enabled: true, secret,
    enqueue: async (entry) => {
      assert.deepEqual(entry, event);
      calls++;
      return { duplicate: calls > 1 };
    },
  });
  for (const duplicate of [false, true]) {
    const response = recorder();
    await handler(request(), response);
    assert.equal(response.statusCode, 202);
    assert.deepEqual(response.jsonBody, { ok: true, duplicate });
  }
  const ignored = recorder();
  await handler(request({ ...payload, instance: "Other" }), ignored);
  assert.deepEqual(ignored.jsonBody, { ok: true, ignored: true });
  assert.equal(calls, 2);
});

test("webhook signals retry when database is unavailable without exposing details", async () => {
  const response = recorder();
  await createLaraWebhookHandler({
    enabled: true, secret,
    enqueue: async () => { throw new Error("postgres://private-host:password"); },
  })(request(), response);
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.stringify(response.jsonBody).includes("private-host"), false);
});

test("enqueue is idempotent and debounces within bounded limits", async () => {
  const parameters = [];
  const pool = { async query(_sql, values) {
    parameters.push(values);
    return { rowCount: parameters.length === 1 ? 1 : 0 };
  } };
  assert.deepEqual(await enqueueLaraMessage(event, { pool, debounceMs: 5000 }),
    { accepted: true, duplicate: false });
  assert.deepEqual(await enqueueLaraMessage(event, { pool, debounceMs: 200000 }),
    { accepted: false, duplicate: true });
  assert.equal(parameters[0][5], 5000);
  assert.equal(parameters[1][5], 20000);
});

test("public webhook is not behind browser session but starts disabled", async () => {
  const server = createApp({
    authService: { authenticate: async () => null },
  }).listen(0, "127.0.0.1");
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const result = await fetch("http://127.0.0.1:" + server.address().port
      + "/api/webhooks/evolution/lara", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal(result.status, 503);
    assert.deepEqual(await result.json(), { ok: false, error: "lara_ingest_disabled" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("intent router sends scheduling, human and emergency requests to handoff", () => {
  assert.equal(identifyLaraIntent("Quero agendar um exame"), "scheduling");
  assert.equal(identifyLaraIntent("Prefiro falar com atendente"), "human");
  assert.equal(identifyLaraIntent("Estou com falta de ar"), "urgent");
  assert.equal(identifyLaraIntent("Qual é o endereço?"), "knowledge");
});

test("scheduling creates handoff and NEVER calls the model", async () => {
  const handoffs = [];
  const reply = await composeLaraReply({
    batch: [{ body: "Quero marcar um horário" }],
    model: { answer: () => assert.fail("no LLM for scheduling") },
    sources: [{ title: "Test", content: "ok" }],
    handoff: async (reason) => handoffs.push(reason),
  });
  assert.equal(reply.handoffReason, "scheduling");
  assert.equal(reply.text.includes("confirmado"), false);
  assert.deepEqual(handoffs, ["scheduling"]);
});

test("emergency message routes to urgent services and handoff", async () => {
  const handoffs = [];
  const reply = await composeLaraReply({
    batch: [{ body: "falta de ar" }],
    model: { answer: () => assert.fail("no clinical assessment") },
    handoff: async (reason) => handoffs.push(reason),
  });
  assert.match(reply.text, /192/);
  assert.deepEqual(handoffs, ["urgent"]);
});

test("empty knowledge creates human handoff without hallucinating clinic facts", async () => {
  const handoffs = [];
  const reply = await composeLaraReply({
    batch: [{ body: "Qual é o endereço da clínica?" }],
    sources: [], model: { answer: () => assert.fail("no source") },
    handoff: async (reason) => handoffs.push(reason),
  });
  assert.equal(reply.handoffReason, "unknown_information");
  assert.deepEqual(handoffs, ["unknown_information"]);
});

test("OpenAI Responses call uses store=false, grounded instructions and no tool execution", async () => {
  let sent;
  const model = createLaraModel({
    apiKey: "test-key",
    fetchImpl: async (_url, opts) => {
      sent = JSON.parse(opts.body);
      assert.equal(opts.headers.authorization, "Bearer test-key");
      return Response.json({
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text",
          text: "O endereço informado é Rua de Exemplo, 100." }] }],
      });
    },
  });
  const text = await model.answer({
    messages: [{ role: "user", content: "Qual o endereço?" }],
    sources: [{ title: "Endereço", content: "Rua de Exemplo, 100" }],
  });
  assert.match(text, /Rua de Exemplo/);
  assert.equal(sent.store, false);
  assert.equal(sent.tools, undefined);
  assert.equal(sent.input[0].role, "user");
  assert.match(sent.instructions, /Nao invente/);
  assert.match(sent.instructions, /Rua de Exemplo/);
});

test("OpenAI client rejects missing key and invalid response", async () => {
  const client = createLaraModel({ apiKey: "" });
  await assert.rejects(client.answer({ messages: [], sources: [{ title: "x", content: "x" }] }),
    (error) => error instanceof LaraModelError && error.status === 503);
  const broken = createLaraModel({
    apiKey: "mock",
    fetchImpl: async () => Response.json({ status: "completed", output: [] }),
  });
  await assert.rejects(broken.answer({
    messages: [], sources: [{ title: "x", content: "x" }],
  }), (error) => error.code === "lara_openai_invalid_response");
});

function fakeWorker(overrides = {}) {
  const calls = [];
  let claimed = false;
  const job = { phone, lease_id: "414a66cd-a1ad-4429-981b-f79ea161972e" };
  const repo = {
    claimNextLaraJob: async () => {
      if (claimed) return null;
      claimed = true;
      return job;
    },
    claimLaraBatch: async () => batch,
    latestLaraHistory: async () => [],
    relevantLaraKnowledge: async () => [{ title: "Endereço", content: "Rua Teste, 10" }],
    hasNewerPendingMessages: async () => false,
    countRecentLaraReplies: async () => 0,
    createLaraHandoff: async (number, reason) => calls.push(["handoff", number, reason]),
    prepareLaraSend: async () => { calls.push(["prepare"]); return true; },
    finishLaraDelivery: async (...args) => calls.push(["finish",args[3]]),
    releaseLaraLease: async () => calls.push(["release"]),
    markLaraSuppressed: async (_job, reason) => calls.push(["suppressed", reason]),
    markLaraDeliveryUncertain: async (_job, reason) => calls.push(["uncertain", reason]),
    requeueLaraBatch: async () => calls.push(["requeue"]),
    ...overrides.repo,
  };
  const model = { answer: async () => "Conforme o documento: Rua Teste, 10." };
  const worker = createLaraWorker({
    enabled: true, cutoverConfirmed: true, controlBackend: "database",
    repo,
    canReply: async () => true,
    setEnabled: async (...args) => calls.push(["pause",...args]),
    model,
    evolutionFactory: () => ({
      sendText: async (...args) => {
        calls.push(["send", ...args]);
        return { key: { id: "outbound-123" } };
      },
    }),
    ...overrides.worker,
  });
  return { worker, calls };
}

test("no outbound without explicit cutover and DB mode", async () => {
  for (const conf of [
    { enabled: false }, { cutoverConfirmed: false }, { controlBackend: "n8n" },
  ]) {
    const { worker, calls } = fakeWorker({ worker: conf });
    assert.equal((await worker.runOnce()).status, "disabled");
    assert.deepEqual(calls, []);
  }
});

test("native Lara replies once with known facts, records delivery and history", async () => {
  const { worker, calls } = fakeWorker();
  assert.equal((await worker.runOnce()).status, "sent");
  assert.equal(calls.filter((x) => x[0] === "send").length, 1);
  assert.equal(calls.filter((x) => x[0] === "finish").length, 1);
  assert.equal(calls.find((x) => x[0] === "finish")[1], "outbound-123");
  assert.equal((await worker.runOnce()).status, "idle");
});

test("worker respects pause, and never sends to paused contact", async () => {
  const { worker, calls } = fakeWorker({ worker: { canReply: async () => false } });
  assert.equal((await worker.runOnce()).status, "paused");
  assert.equal(calls.some((x) => x[0] === "send"), false);
  assert.ok(calls.some((x) => x[0] === "suppressed"));
});

test("worker defers stale response if patient sends again mid-generation", async () => {
  const { worker, calls } = fakeWorker({
    repo: { hasNewerPendingMessages: async () => true },
  });
  assert.equal((await worker.runOnce()).status, "deferred");
  assert.equal(calls.some((x) => x[0] === "send"), false);
  assert.ok(calls.some((x) => x[0] === "requeue"));
});

test("human handoff pauses before delivering acknowledgment", async () => {
  const { worker, calls } = fakeWorker({
    repo: {
      claimLaraBatch: async () => [{ ...batch[0], body: "Quero marcar consulta" }],
    },
  });
  assert.equal((await worker.runOnce()).status, "handed_off");
  assert.ok(calls.find((x) => x[0] === "handoff"));
  assert.ok(calls.findIndex((x) => x[0] === "pause") <
    calls.findIndex((x) => x[0] === "send"));
});

test("unknown WhatsApp send result is quarantined, never requeued", async () => {
  const { worker, calls } = fakeWorker({
    worker: {
      evolutionFactory: () => ({
        sendText: async () => { throw new Error("network timeout - uncertain"); },
      }),
    },
  });
  assert.equal((await worker.runOnce()).status, "manual_review");
  assert.ok(calls.find((x) => x[0] === "uncertain"));
  assert.equal(calls.some((x) => x[0] === "requeue"), false);
});

test("limiter suppresses repeat replies and alerts reception", async () => {
  const { worker, calls } = fakeWorker({
    repo: { countRecentLaraReplies: async () => 20 },
  });
  assert.equal((await worker.runOnce()).status, "rate_limited");
  assert.equal(calls.some((x) => x[0] === "send"), false);
  assert.ok(calls.some((x) => x[0] === "handoff"));
});

test("model errors requeue without sending to patient", async () => {
  const { worker, calls } = fakeWorker({
    worker: {
      model: { answer: async () => { throw new LaraModelError("lara_openai_unavailable"); } },
    },
  });
  assert.equal((await worker.runOnce()).status, "retry_pending");
  assert.equal(calls.some((x) => x[0] === "send"), false);
  assert.equal(calls.some((x) => x[0] === "requeue"), true);
});

test("hallucinated booking confirmations are replaced by a safe handoff", async () => {
  const handoffs = [];
  const result = await composeLaraReply({
    batch: [{ body: "Gostaria de saber como chegar" }],
    sources: [{ title: "Chegada", content: "Acesso pela portaria principal." }],
    handoff: async (reason) => handoffs.push(reason),
    model: { answer: async () => "Seu agendamento está confirmado para amanhã." },
  });
  assert.equal(result.handoffReason, "unsafe_generated_response");
  assert.equal(result.text.includes("confirmado"), false);
  assert.deepEqual(handoffs, ["unsafe_generated_response"]);
});

test("sendText without a WhatsApp message ID is quarantined", async () => {
  const { worker, calls } = fakeWorker({
    worker: {
      evolutionFactory: () => ({ sendText: async () => ({ status: "sent" }) }),
    },
  });
  assert.equal((await worker.runOnce()).status, "manual_review");
  assert.equal(calls.some((x) => x[0] === "finish"), false);
  assert.ok(calls.some((x) => x[0] === "uncertain"));
});

test("handoff pause failure prevents outbound WhatsApp", async () => {
  const { worker, calls } = fakeWorker({
    repo: { claimLaraBatch: async () => [{ ...batch[0], body: "Preciso agendar consulta" }] },
    worker: { setEnabled: async () => { throw new Error("DB down"); } },
  });
  assert.equal((await worker.runOnce()).status, "manual_review");
  assert.equal(calls.some((x) => x[0] === "send"), false);
});

test("uncertain WhatsApp delivery pauses Lara for that contact", async () => {
  const { worker, calls } = fakeWorker({
    worker: {
      evolutionFactory: () => ({
        sendText: async () => { throw new Error("simulated uncertainty"); },
      }),
    },
  });
  assert.equal((await worker.runOnce()).status, "manual_review");
  assert.ok(calls.some((item) => item[0] === "pause" && item[1] === phone && item[2] === false));
});
