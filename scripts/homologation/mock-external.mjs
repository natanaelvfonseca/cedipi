import http from "node:http";

const sentMessages = [];
let modelCalls = 0;
const respond = (res, status, value) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
};
async function jsonBody(req) {
  let raw = "";
  for await (const part of req) {
    raw += part;
    if (raw.length > 100_000) throw new Error("oversized");
  }
  return JSON.parse(raw || "{}");
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://mock");
  if (req.method === "GET" && url.pathname === "/test/status") {
    return respond(res, 200, {
      modelCalls,
      outbound: sentMessages.map((m) => ({
        phone: m.number, text: m.text, id: m.id,
      })),
    });
  }
  if (req.method !== "POST") return respond(res, 404, { error: "not_found" });
  try {
    if (url.pathname === "/openai/v1/responses") {
      const input = await jsonBody(req);
      if (input.store !== false || input.model !== "homologation-mock") {
        return respond(res, 400, { error: "invalid_request" });
      }
      modelCalls++;
      return respond(res, 200, {
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text",
          text: "Segundo a base de teste, a clínica fictícia fica na Rua Simulação, 100.",
        }] }],
      });
    }
    if (url.pathname === "/evolution/message/sendText/Cedipi") {
      const input = await jsonBody(req);
      if (!/^[0-9]{12,13}$/.test(input.number ?? "") ||
          typeof input.text !== "string") {
        return respond(res, 400, { error: "invalid_phone_or_text" });
      }
      if (input.number === "5511888888888") {
        return respond(res, 502, { error: "mock_delivery_uncertain" });
      }
      const id = "mock-wa-" + (sentMessages.length + 1);
      sentMessages.push({ number: input.number, text: input.text, id });
      return respond(res, 200, { key: { id } });
    }
    return respond(res, 404, { error: "not_found" });
  } catch {
    return respond(res, 400, { error: "invalid_json" });
  }
});
server.listen(4000, "0.0.0.0");
