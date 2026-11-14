import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import pg from "pg";

// Do not allow this script to run against an actual clinic DB or WhatsApp API.
assert.equal(process.env.NODE_ENV, "homologation");
assert.equal(process.env.EVOLUTION_API_URL, "http://mock:4000/evolution");
assert.equal(process.env.LARA_OPENAI_ENDPOINT, "http://mock:4000/openai/v1/responses");
assert.equal(process.env.OPENAI_API_KEY, "dummy-staging-only-do-not-use");
assert.match(process.env.DATABASE_URL ?? "", /@db:5432\/cedipi_core$/);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const base = "http://127.0.0.1:3000/api/webhooks/evolution/lara";
const mockBase = "http://mock:4000/test/status";
const headerSecret = process.env.LARA_WEBHOOK_SECRET;
assert.ok(typeof headerSecret === "string" && headerSecret.length >= 32);
const number = randomInt(10_000_000, 99_999_000);
const phone = (step) => "55119" + String(number + step).padStart(8, "0");
const testRun = randomUUID().slice(0,8);

async function event(phoneNumber, id, text, fromMe = false, secret = headerSecret) {
  const response = await fetch(base, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cedipi-webhook-secret": secret },
    body: JSON.stringify({
      instance: "Cedipi", event: "messages.upsert",
      data: {
        key: { id, fromMe, remoteJid: phoneNumber + "@s.whatsapp.net" },
        message: { conversation: text },
      },
    }),
  });
  return { status: response.status, body: await response.json() };
}
async function statusForMessage(id) {
  const result = await client.query(
    "SELECT status, failure_code FROM lara_inbound_messages WHERE message_id=$1;",
    [id],
  );
  return result.rows[0] ?? null;
}
async function mockStatus() {
  const response = await fetch(mockBase);
  assert.equal(response.status, 200);
  return response.json();
}
async function until(fn, { attempts = 95, pauseMs = 400 } = {}) {
  for (let i=0;i<attempts;i++) {
    const found=await fn();
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve,pauseMs));
  }
  throw new Error("HOMOLOG_TIMEOUT");
}
try {
  const health=await fetch("http://127.0.0.1:3000/api/health/database");
  assert.equal(health.status,200);
  assert.equal((await health.json()).database,"connected");
  console.log("PASS health");

  await client.query(
    "INSERT INTO lara_knowledge_sources (title,content) VALUES ($1,$2);",
    ["Fonte fictícia "+testRun,
      "Onde fica a clínica fictícia? A clínica fica na Rua Simulação, número 100. Apenas dados de teste."],
  );

  const unauthorized=await event(phone(1),testRun+"-bad","Onde fica?",false,"invalid");
  assert.equal(unauthorized.status,401);
  console.log("PASS webhook authentication");

  const id=testRun+"-single";
  const first=await event(phone(1),id,"Onde fica a clínica?");
  const repeated=await event(phone(1),id,"Onde fica a clínica?");
  assert.deepEqual([first.status,repeated.status],[202,202]);
  assert.equal(first.body.duplicate,false);
  assert.equal(repeated.body.duplicate,true);
  await until(async()=> (await statusForMessage(id))?.status==="sent");
  const output1=(await mockStatus()).outbound.filter((item)=>item.phone===phone(1));
  assert.equal(output1.length,1);
  assert.match(output1[0].text,/Rua Simulação/);
  console.log("PASS grounded single response and duplicate webhook");

  const batchPhone=phone(2);
  const b1=testRun+"-batch-1", b2=testRun+"-batch-2";
  await event(batchPhone,b1,"Onde fica a clínica?");
  await event(batchPhone,b2,"Pode informar o endereço?");
  await until(async()=> (await statusForMessage(b1))?.status==="sent" &&
    (await statusForMessage(b2))?.status==="sent");
  assert.equal((await mockStatus()).outbound.filter((item)=>item.phone===batchPhone).length,1);
  const history=await client.query(
    "SELECT role FROM lara_history WHERE phone=$1 ORDER BY id;",[batchPhone]);
  assert.deepEqual(history.rows.map((item)=>item.role),["user","user","assistant"]);
  console.log("PASS batching and history");

  const handoffPhone=phone(3);
  const h1=testRun+"-handoff";
  await event(handoffPhone,h1,"Quero agendar um exame");
  await until(async()=> (await statusForMessage(h1))?.status==="sent");
  const handoffs=await client.query(
    "SELECT reason FROM lara_handoffs WHERE phone=$1 AND status='open';",[handoffPhone]);
  assert.equal(handoffs.rows.length,1);
  assert.equal(handoffs.rows[0].reason,"scheduling");
  const aiStatus=await client.query(
    "SELECT enabled FROM ai_conversation_control WHERE phone=$1;",[handoffPhone]);
  assert.equal(aiStatus.rows[0].enabled,false);
  const before=(await mockStatus()).outbound.filter((item)=>item.phone===handoffPhone).length;
  assert.equal(before,1);
  const h2=testRun+"-after-handoff";
  await event(handoffPhone,h2,"Onde fica a clínica?");
  await until(async()=> (await statusForMessage(h2))?.status==="manual_review");
  assert.equal((await mockStatus()).outbound.filter((item)=>item.phone===handoffPhone).length,1);
  console.log("PASS human handoff, pause and no additional auto-response");

  const outgoing=await event(phone(4),testRun+"-outbound","Simulação",true);
  assert.equal(outgoing.status,202);
  assert.equal(outgoing.body.ignored,true);
  assert.equal(await statusForMessage(testRun+"-outbound"),null);
  console.log("PASS ignore own outbound events");

  const failedPhone="5511888888888";
  const failId=testRun+"-uncertain";
  await client.query(
    "INSERT INTO ai_conversation_control(phone,enabled) VALUES($1,TRUE)"
    +" ON CONFLICT(phone) DO UPDATE SET enabled=TRUE;",[failedPhone]);
  await event(failedPhone,failId,"Onde fica a clínica?");
  await until(async()=> (await statusForMessage(failId))?.status==="manual_review");
  assert.equal((await statusForMessage(failId)).failure_code,"delivery_uncertain");
  const failedStatus=await client.query(
    "SELECT enabled FROM ai_conversation_control WHERE phone=$1;",[failedPhone]);
  assert.equal(failedStatus.rows[0].enabled,false);
  console.log("PASS uncertain delivery quarantined and paused");

  console.log("HOMOLOGATION_SMOKE_SUCCESS");
} finally {
  await client.end();
}
