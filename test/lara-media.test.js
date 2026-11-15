import assert from "node:assert/strict";
import test from "node:test";
import {
  detectSafeAttachment,buildMediaRequest,createMediaAnalyzer,
  parseMediaResult,LaraMediaError,MEDIA_LIMITS,redactMediaText,
} from "../server/lara-media-analysis.js";
import {createLaraMediaService,replyForMediaAnalysis} from "../server/lara-media-service.js";
import {normalizeEvolutionMessage} from "../server/lara-event-normalizer.js";
import {createLaraWorker} from "../server/lara-worker-service.js";

const pdf=Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF");
const image=Buffer.from("89504e470d0a1a0a0000000d49484452","hex");
const phone="5511999999999",jid=phone+"@s.whatsapp.net";
const responseText=JSON.stringify({
 category:"medical_order",readable:true,
 summary:"Pedido médico com ultrassom de tireoide identificado.",
 examNames:["Ultrassom de tireoide"],
});
function openaiOk(text=responseText) {
 return Response.json({status:"completed",output:[{
  type:"message",content:[{type:"output_text",text}],
 }]});
}
test("PDF image inputs use Responses API correct multimodal content with store:false",()=>{
 const p=buildMediaRequest({buffer:pdf,contentType:"application/pdf",fileName:"pedido.pdf"});
 const i=buildMediaRequest({buffer:image,contentType:"image/png",fileName:"foto.png"});
 assert.equal(p.store,false);
 assert.equal(p.input[0].content[1].type,"input_file");
 assert.equal(p.input[0].content[1].filename,"pedido.pdf");
 assert.ok(p.input[0].content[1].file_data.startsWith("data:application/pdf;base64,"));
 assert.equal(i.input[0].content[1].type,"input_image");
 assert.ok(i.input[0].content[1].image_url.startsWith("data:image/png;base64,"));
 assert.equal(i.input[0].content[1].detail,"high");
});
test("MIME/magic mismatch, unsupported and oversize reject without sending to OpenAI",()=>{
 assert.equal(detectSafeAttachment({buffer:pdf,contentType:"application/pdf"}).type,"pdf");
 assert.equal(detectSafeAttachment({buffer:image,contentType:"image/png"}).type,"image");
 assert.throws(()=>detectSafeAttachment({buffer:pdf,contentType:"image/png"}),e=>e.status===415);
 assert.throws(()=>detectSafeAttachment({buffer:image,contentType:"application/zip"}),e=>e.status===415);
 assert.throws(()=>detectSafeAttachment({
  buffer:Buffer.alloc(MEDIA_LIMITS.image+1),contentType:"image/jpeg",
 }),e=>e instanceof LaraMediaError);
});
test("OpenAI image and PDF analyzer safely parses a minimized administrative result",async()=>{
 const calls=[];
 const model=createMediaAnalyzer({
  apiKey:"dummy-test-key",
  fetchImpl:async(url,options)=>{
   calls.push({url,body:JSON.parse(options.body)});
   return openaiOk();
  },
 });
 const result=await model.analyze({buffer:pdf,contentType:"application/pdf",fileName:"pedido.pdf"});
 assert.equal(result.category,"medical_order");
 assert.equal(result.reviewRequired,true);
 assert.deepEqual(result.examNames,["Ultrassom de tireoide"]);
 assert.equal(calls[0].body.store,false);
 assert.equal(calls[0].body.input[0].content[1].type,"input_file");
 assert.equal(calls[0].body.instructions.includes("Nao interprete exames"),true);
});
test("truncated or deceptive OpenAI responses fail safely",()=>{
 assert.throws(()=>parseMediaResult("not json"),e=>e.code==="media_invalid_ai_response");
 assert.throws(()=>parseMediaResult('{"category":"paid","summary":"pago","examNames":[],"readable":true}'),e=>e.code==="media_invalid_ai_response");
 assert.equal(parseMediaResult(JSON.stringify({
  category:"payment_proof",summary:"Comprovante recebido",examNames:[],readable:true,
 })).reviewRequired,true);
 const reply=replyForMediaAnalysis({
  status:"done",category:"payment_proof",readable:true,exam_names:[],
 });
 assert.equal(reply.handoffReason,"payment_proof_review");
 assert.doesNotMatch(reply.text,/pagamento confirmado|pix confirmado/i);
});
test("Evolution @lid PDF and image keeps verified sender and source address",()=>{
 const base={event:"messages.upsert",instance:"Cedipi",data:{
  key:{id:"abc123",fromMe:false,remoteJid:"123456789012345@lid",
    remoteJidAlt:jid},message:{documentMessage:{fileName:"pedido.pdf"}},
 }};
 const doc=normalizeEvolutionMessage(base);
 assert.equal(doc.phone,phone);assert.equal(doc.sourceJid,"123456789012345@lid");
 assert.equal(doc.mediaKind,"document");
 const pic=normalizeEvolutionMessage({...base,data:{
  ...base.data,message:{imageMessage:{mimetype:"image/png"}},
 }});
 assert.equal(pic.mediaKind,"image");
});
function mockMediaRepo(){
 const record=new Map();
 return {
  getMediaAnalysis:async(_instance,id,p)=>record.get(id+":"+p)??null,
  claimMediaAnalysis:async({messageId,phone,mediaType})=>{
   const key=messageId+":"+phone;if(record.get(key)?.status==="processing")return false;
   record.set(key,{status:"processing",media_type:mediaType});return true;
  },
  saveMediaAnalysis:async({messageId,phone,analysis})=>{
   const saved={status:"done",category:analysis.category,summary:analysis.summary,
    exam_names:analysis.examNames,readable:analysis.readable,review_required:true};
   record.set(messageId+":"+phone,saved);return saved;
  },
  failMediaAnalysis:async()=>{},
  purgeOldMediaAnalyses:async()=>0,
 };
}
test("media service deduplicates AI calls; a different conversation is blocked",async()=>{
 let calls=0;
 const service=createLaraMediaService({
  mediaClient:{getMedia:async()=>({buffer:pdf,contentType:"application/pdf",fileName:"doc.pdf"})},
  analyzer:{analyze:async()=>{calls++;return parseMediaResult(responseText)}},
  repo:mockMediaRepo(),
 });
 const input={messageId:"id-1",phone,sourceJid:jid};
 const first=await service.process(input);
 const second=await service.process(input);
 assert.deepEqual(first,second);
 assert.equal(calls,1);
 await assert.rejects(service.process({...input,sourceJid:"5588999999999@s.whatsapp.net"}),
  e=>e.code==="media_wrong_conversation");
});
test("worker reads media and sends document-request guidance with no diagnosis",async()=>{
 const actions=[];
 const job={phone,lease_id:"414a66cd-a1ad-4429-981b-f79ea161972e"};
 const rows=[{id:1,body:"Documento recebido (requer conferência humana)",
  message_id:"abc123",remote_jid:jid,source_jid:"123456789012345@lid",
  media_kind:"document",attempts:1}];
 const repo={
  claimNextLaraJob:async()=>job,claimLaraBatch:async()=>rows,
  hasNewerPendingMessages:async()=>false,countRecentLaraReplies:async()=>0,
  createLaraHandoff:async()=>assert.fail("No handoff for readable order"),
  prepareLaraSend:async()=>true,
  finishLaraDelivery:async()=>actions.push("finished"),
  releaseLaraLease:async()=>{},
 };
 const worker=createLaraWorker({
  enabled:true,cutoverConfirmed:true,controlBackend:"database",
  allowedPhone:phone,canReply:async()=>true,repo,
  mediaEnabled:true,
  mediaService:{process:async args=>{
   assert.equal(args.sourceJid,"123456789012345@lid");
   return {status:"done",category:"medical_order",readable:true,
    exam_names:["Ultrassom de tireoide"]};
  }},
  evolutionFactory:()=>({sendText:async(target,text)=>{
   assert.equal(target,phone);assert.match(text,/Quero agendar Ultrassom de tireoide/);
   return {key:{id:"sent-media-1"}};
  }}),
 });
 const result=await worker.runOnce();
 assert.equal(result.status,"sent");assert.deepEqual(actions,["finished"]);
});

test("patient identifiers are removed from summaries and never offered as exams",()=>{
 const privateReply=parseMediaResult(JSON.stringify({
  category:"medical_order",readable:true,
  summary:"Paciente CPF 123.456.789-00 email maria@exemplo.com contato 5511999999999",
  examNames:["Ultrassom de tireoide","123.456.789-00"],
 }));
 assert.equal(privateReply.summary.includes("123.456.789-00"),false);
 assert.equal(privateReply.summary.includes("maria@exemplo.com"),false);
 assert.equal(privateReply.summary.includes("5511999999999"),false);
 assert.deepEqual(privateReply.examNames,["Ultrassom de tireoide"]);
});
