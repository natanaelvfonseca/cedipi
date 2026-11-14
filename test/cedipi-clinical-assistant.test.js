import assert from "node:assert/strict";
import test from "node:test";
import {
  createCedipiClinicalAssistant, findOfficialExamMatches,
  parseDay, examOverview,
} from "../server/cedipi-clinical-assistant.js";

const knownDate=new Date("2026-11-14T12:00:00Z");
const exam={
  code:"ultrassom-de-tireoide",name:"Ultrassom de tireoide",
  category:"ultrasound",price_cents:21000,duration_minutes:15,
  doctor_names:["Danilo","Wagner"],medical_approval:false,
  doctor_review:false,add_on_only:false,preparation:"Não necessita de preparo",
  notes:null,
};
const doppler={...exam,code:"ultrassom-de-tireoide-com-doppler",
  name:"Ultrassom de tireoide com doppler",price_cents:26000,duration_minutes:20};
const morfo={...exam,code:"ultrassom-obstetrico-morfologico-2o-trimestre",
  name:"Ultrassom obstétrico morfológico 2º trimestre",price_cents:45000,
  duration_minutes:40,doctor_names:["Danilo"]};
const paaf={...exam,code:"paaf-de-tireoide",name:"PAAF de tireoide",
  category:"procedure",price_cents:64000,duration_minutes:20,
  doctor_names:["Danilo"],medical_approval:true,doctor_review:true};
const unknown={...paaf,code:"core-biopsy-de-partes-moles",
  name:"Core-Biopsy de partes moles",duration_minutes:null,price_cents:86000};
const all=[exam,doppler,morfo,paaf,unknown];

function testAssistant() {
 const sessions=new Map(),requests=[];
 const calls={slotQueries:0};
 const fakeRepo={
  listOfficialExams:async()=>all,
  readLaraSession:async(phone)=>sessions.get(phone)??{phone,state:"idle"},
  saveLaraSession:async(phone,state)=>{sessions.set(phone,{...state,updated_at:new Date()});return state;},
  listProposedExamTimes:async(input)=>{
   calls.slotQueries++;
   assert.equal(input.exam.code,exam.code);
   assert.equal(input.date,"2026-11-17");
   return [
     {doctor:"Danilo",start:"2026-11-17T12:00:00.000Z",end:"2026-11-17T12:15:00.000Z",verified:false},
     {doctor:"Wagner",start:"2026-11-17T13:00:00.000Z",end:"2026-11-17T13:15:00.000Z",verified:false},
   ];
  },
  createBookingRequest:async(r)=>{requests.push(r);return {id:"id",status:r.status};},
  readOfficialDocument:async()=>"Agenda Dr Danilo...",
 };
 const assistant=createCedipiClinicalAssistant({repo:fakeRepo,now:()=>knownDate});
 const ask=(text,phone="5511999999999")=>assistant.answer({phone,batch:[{body:text}]});
 return {ask,sessions,requests,calls};
}

test("catalog matcher distinguishes Doppler, PAAF and morphology precisely",()=>{
 assert.deepEqual(findOfficialExamMatches("Qual o valor ultrassom de tireoide?",all).map(e=>e.code),[exam.code]);
 assert.deepEqual(findOfficialExamMatches("Preço do ultrassom de tireoide com doppler",all).map(e=>e.code),[doppler.code]);
 assert.deepEqual(findOfficialExamMatches("PAAF de tireoide",all).map(e=>e.code),[paaf.code]);
 assert.deepEqual(findOfficialExamMatches("ultrassom morfológico 2º trimestre",all).map(e=>e.code),[morfo.code]);
 assert.equal(findOfficialExamMatches("Qual é o endereço?",all).length,0);
});

test("clinic calendar parses explicit date, tomorrow, rejects invalid and out of range",()=>{
 assert.equal(parseDay("17/11/2026",knownDate),"2026-11-17");
 assert.equal(parseDay("amanhã",knownDate),"2026-11-15");
 assert.equal(parseDay("40/11/2026",knownDate),null);
 assert.equal(parseDay("21/12/2027",knownDate),null);
});

test("catalog answers prices from source and deposits without exposing Pix",async()=>{
 const {ask}=testAssistant();
 const response=await ask("Qual o preço do ultrassom de tireoide?");
 assert.match(response.text,/R\$\s?210,00/);
 assert.match(response.text,/15 minutos/);
 assert.doesNotMatch(response.text,/498\.836/);
 assert.match(examOverview(morfo),/R\$\s?90,00/);
 assert.match(examOverview(paaf),/aprovação médica/);
});

test("booking is conversational but never confirms an unverified Google Calendar",async()=>{
 const {ask,requests,calls,sessions}=testAssistant();
 let r=await ask("Quero agendar ultrassom de tireoide");
 assert.match(r.text,/qual.*data/i);
 r=await ask("17/11/2026");
 assert.match(r.text,/horários possíveis/);
 assert.equal(calls.slotQueries,1);
 assert.equal(sessions.get("5511999999999").state,"awaiting_slot");
 r=await ask("1");
 assert.match(r.text,/nome e sobrenome/);
 r=await ask("Maria Silva");
 assert.match(r.text,/ainda não está reservado/i);
 r=await ask("sim");
 assert.equal(r.handoffReason,"booking_review");
 assert.match(r.text,/ainda não é um agendamento confirmado/);
 assert.equal(requests.length,1);
 assert.equal(requests[0].status,"needs_verification");
 assert.equal(requests[0].patientName,"Maria Silva");
 assert.equal(requests[0].start,"2026-11-17T12:00:00.000Z");
});

test("medication, endometriosis prep and encaixes always go to human",async()=>{
 const {ask}=testAssistant();
 let r=await ask("Uso AAS, devo suspender antes da biópsia?");
 assert.equal(r.handoffReason,"medication_or_special_prep");
 assert.doesNotMatch(r.text,/suspenda|pare de tomar/i);
 r=await ask("Qual dose de macrogol para endometriose?");
 assert.equal(r.handoffReason,"medication_or_special_prep");
 r=await ask("preciso encaixar para amanhã");
 assert.equal(r.handoffReason,"scheduling_exception");
});

test("PAAF needs medical approval; unknown core biopsy duration cannot self-book",async()=>{
 const {ask}=testAssistant();
 let r=await ask("Qual o valor de PAAF de tireoide?");
 assert.match(r.text,/R\$\s?640,00/);
 r=await ask("Quero agendar Core-Biopsy de partes moles");
 assert.equal(r.handoffReason,"exam_needs_review");
});

test("Pix key is never disclosed on speculative booking or payment inquiry",async()=>{
 const {ask}=testAssistant();
 let r=await ask("Qual a chave pix para agendamento?");
 assert.doesNotMatch(r.text,/498\.836/);
 r=await ask("Quero agendar ultrassom de tireoide");
 r=await ask("17/11/2026");
 r=await ask("1");
 r=await ask("Maria Silva");
 r=await ask("sim");
 assert.doesNotMatch(r.text,/498\.836/);
});

test("audio/photo proof routes to reception without pretending to verify",async()=>{
 const {ask}=testAssistant();
 let r=await ask("Imagem recebida (requer conferência humana)");
 assert.equal(r.handoffReason,"document_review");
 r=await ask("Comprovante do pix anexado");
 assert.equal(r.handoffReason,"document_review");
});

test("free-form nonclinical questions may use grounded OpenAI fallback only with a key",async()=>{
 const {ask}=testAssistant();
 const noKey=await ask("Vocês têm estacionamento coberto?");
 assert.equal(noKey.handoffReason,"unknown_information");
 const assistant=createCedipiClinicalAssistant({
   modelConfigured:true,
   repo:{
     listOfficialExams:async()=>all,
     readLaraSession:async(phone)=>({phone,state:"idle"}),
   },
 });
 assert.equal(await assistant.answer({
   phone:"5511999999999",batch:[{body:"Vocês têm estacionamento coberto?"}],
 }),null);
});
