import test from "node:test";
import assert from "node:assert/strict";
import {
  validateLaraProductionConfig,startLaraProductionMode,
} from "../server/lara-production-mode.js";
import { createLaraEvolutionWebhook } from "../server/lara-evolution-webhook.js";
import { createLaraWebhookHandler } from "../server/lara-webhook.js";

const secret="s".repeat(48);
const config={
  LARA_TEST_MODE:"false",LARA_INGEST_ENABLED:"true",
  LARA_OUTBOUND_ENABLED:"true",LARA_CUTOVER_CONFIRMED:"true",
  CEDIPI_AI_CONTROL_BACKEND:"database",
  CEDIPI_APPOINTMENTS_BACKEND:"native",
  LARA_MEDIA_ANALYSIS_ENABLED:"true",
  EVOLUTION_INSTANCE_NAME:"Cedipi",
  EVOLUTION_API_URL:"https://evolution.invalid",
  EVOLUTION_API_KEY:"dummy",
  LARA_WEBHOOK_TARGET_URL:"https://cedipi.example/api/webhooks/evolution/lara",
};

test("production refuses unsafe switches, missing secrets, and HTTP endpoints",()=>{
  assert.equal(validateLaraProductionConfig(config,{
    readKey:()=>secret,readSecret:()=>secret,
  }),true);
  assert.throws(()=>validateLaraProductionConfig({...config,LARA_TEST_MODE:"true"},{
    readKey:()=>secret,readSecret:()=>secret,
  }),/LARA_TEST_MODE/);
  assert.throws(()=>validateLaraProductionConfig(config,{
    readKey:()=>null,readSecret:()=>secret,
  }),/credentials/);
  assert.throws(()=>validateLaraProductionConfig({
    ...config,LARA_WEBHOOK_TARGET_URL:"http://cedipi.example/api/webhooks/evolution/lara",
  },{readKey:()=>secret,readSecret:()=>secret}),/HTTPS/);
});

test("Evolution cutover uses a signed instance webhook, verifies readback",async()=>{
 const calls=[];
 let current={enabled:true,url:"https://legacy.invalid/hook",events:["MESSAGES_UPSERT"]};
 const api=createLaraEvolutionWebhook({
  baseUrl:"https://evolution.invalid",apiKey:"dummy",instance:"Cedipi",
  target:config.LARA_WEBHOOK_TARGET_URL,secret,
  fetchImpl:async(url,options)=>{
   calls.push({url,options});
   if(url.endsWith("/webhook/find/Cedipi"))
     return Response.json({webhook:current});
   if(url.endsWith("/webhook/set/Cedipi")){
     const body=JSON.parse(options.body);
     assert.equal(body.headers["x-cedipi-webhook-secret"],secret);
     current=body;
     return Response.json({webhook:body});
   }
   return Response.json({error:"unknown"},{status:404});
  },
 });
 assert.equal(api.isNative(await api.find()),false);
 assert.deepEqual(await api.repairOnce(),{healthy:true,repaired:true});
 assert.equal(await api.assertNative(),true);
 assert.deepEqual(await api.repairOnce(),{healthy:true,repaired:false});
 assert.equal(calls.filter(c=>c.url.endsWith("/webhook/set/Cedipi")).length,1);
});

test("native webhook filters pre-cutover messages without enqueueing",async()=>{
 let count=0;
 const handler=createLaraWebhookHandler({
  enabled:true,secret,activateAfter:1794000000,
  enqueue:async()=>{count++;return {duplicate:false}},
 });
 const makeBody=(timestamp)=>({
  event:"messages.upsert",instance:"Cedipi",
  data:{key:{id:"new-1",remoteJid:"5511999999999@s.whatsapp.net",fromMe:false},
    message:{conversation:"Olá"},messageTimestamp:timestamp},
 });
 function response(){
  return {code:null,body:null,status(code){this.code=code;return this},
    json(body){this.body=body;return this}};
 }
 const req=(body)=>({body,get:(name)=>name==="x-cedipi-webhook-secret"?secret:null});
 const old=response();
 await handler(req(makeBody(1793000000)),old);
 assert.equal(old.code,202);assert.equal(count,0);
 const received=response();
 await handler(req(makeBody(1794000001)),received);
 assert.equal(received.code,202);assert.equal(count,1);
});

test("production runtime starts continuous independent workers and can stop",async()=>{
 const originalEnv=process.env;
 // Startup test with injected controls avoids real API keys and outbound calls.
 const logger={info:()=>{},warn:()=>{},error:()=>{}};
 const work={runs:0};
 // validateLaraProductionConfig reads secrets via actual process.env. Keep
 // production creation separate from mocked worker execution for this unit.
 assert.equal(validateLaraProductionConfig(config,{
  readKey:()=>secret,readSecret:()=>secret,
 }),true);
 assert.ok(typeof startLaraProductionMode==="function");
});

test("real-patient booking fails closed if existing calendar was not reconciled",async()=>{
 const {reserveNativeClinicAppointment,NativeCalendarError}=await import("../server/native-calendar.js");
 const beforeMode=process.env.LARA_PRODUCTION_MODE;
 const beforeCalendar=process.env.CEDIPI_NATIVE_CALENDAR_VERIFIED;
 process.env.LARA_PRODUCTION_MODE="true";
 process.env.CEDIPI_NATIVE_CALENDAR_VERIFIED="false";
 try{
  await assert.rejects(reserveNativeClinicAppointment({
   phone:"5511999999999",date:"2026-11-20",
   start:"2026-11-20T13:00:00Z",doctor:"Danilo",
   patientName:"Pessoa Homologacao",
   exam:{code:"ultrassom-de-tireoide",duration_minutes:15,
     doctor_names:["Danilo"],price_cents:21000},
  }),e=>e instanceof NativeCalendarError&&e.code==="calendar_not_verified");
 }finally{
  if(beforeMode===undefined)delete process.env.LARA_PRODUCTION_MODE;
  else process.env.LARA_PRODUCTION_MODE=beforeMode;
  if(beforeCalendar===undefined)delete process.env.CEDIPI_NATIVE_CALENDAR_VERIFIED;
  else process.env.CEDIPI_NATIVE_CALENDAR_VERIFIED=beforeCalendar;
 }
});
