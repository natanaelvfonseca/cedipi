import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLaraSearchQuery,relevantLaraKnowledge,
} from "../server/lara-inbox-repository.js";

test("fallback knowledge search keeps the exam topic, not the filler words",()=>{
  assert.equal(buildLaraSearchQuery(
    "Qual o valor e duração do ultrassom de tireoide?"
  ),"ultrassom OR tireoide");
  assert.equal(buildLaraSearchQuery("Pode me ajudar?"),"ajudar");
  assert.equal(buildLaraSearchQuery("a b ?"),"");
  assert.equal(buildLaraSearchQuery("PAAF de tireoide"),"paaf OR tireoide");
});
test("fallback executes only when complete Portuguese AND search misses",async()=>{
  const queries=[];
  const pool={query:async(sql,args)=>{
    queries.push({sql,args});
    if(queries.length===1) return {rows:[]};
    return {rows:[{title:"[CEDIPI OFICIAL] Ultrassom de tireoide",
      content:"Valor: R$ 210,00 e duração 15 minutos."}]};
  }};
  const answer=await relevantLaraKnowledge(
    "Qual o valor e duração do ultrassom de tireoide?",pool);
  assert.equal(queries.length,2);
  assert.match(queries[0].sql,/plainto_tsquery/);
  assert.match(queries[1].sql,/websearch_to_tsquery/);
  assert.equal(queries[1].args[0],"ultrassom OR tireoide");
  assert.equal(answer[0].content.includes("210,00"),true);
});
test("full match does not run the broader fallback",async()=>{
 const calls=[];
 const pool={query:async(sql)=>{
   calls.push(sql);return {rows:[{title:"Agenda Dr Danilo",content:"Terças-feiras"}]};
 }};
 const results=await relevantLaraKnowledge("Dr Danilo",pool);
 assert.equal(calls.length,1);
 assert.equal(results.length,1);
});
