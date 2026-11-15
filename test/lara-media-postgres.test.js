import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {getDatabasePool,closeDatabasePool} from "../server/database.js";
import {
 claimMediaAnalysis,getMediaAnalysis,saveMediaAnalysis,failMediaAnalysis,
} from "../server/lara-media-repository.js";

test("media analysis PostgreSQL is idempotent, scoped to phone, never persists raw binary",{
 skip:!process.env.DATABASE_URL,timeout:20000,
},async()=>{
 const pool=getDatabasePool();
 const id="CI-MEDIA-"+randomUUID();
 const phone="5511988888877", instance="Cedipi";
 const input={instance,messageId:id,phone,mediaType:"pdf"};
 try{
  assert.equal(await claimMediaAnalysis(input,pool),true);
  assert.equal(await claimMediaAnalysis(input,pool),false);
  assert.equal(await getMediaAnalysis(instance,id,"5511999999990",pool),null);
  const saved=await saveMediaAnalysis({
   instance,messageId:id,phone,
   analysis:{category:"medical_order",readable:true,
    summary:"Pedido de exame: ultrassom de tireoide.",examNames:["Ultrassom de tireoide"]},
  },pool);
  assert.equal(saved.status,"done");
  const fromDb=await getMediaAnalysis(instance,id,phone,pool);
  assert.deepEqual(fromDb.exam_names,["Ultrassom de tireoide"]);
  assert.equal(fromDb.review_required,true);
  const cols=await pool.query(
   "SELECT column_name FROM information_schema.columns"
   +" WHERE table_name='lara_media_analyses'");
  assert.equal(cols.rows.some(r=>/buffer|base64|content|binary/i.test(r.column_name)),false);
  assert.equal(await claimMediaAnalysis(input,pool),false);
  await failMediaAnalysis({instance,messageId:id,phone,code:"not_running"},pool);
  assert.equal((await getMediaAnalysis(instance,id,phone,pool)).status,"done");
 }finally {
  await pool.query("DELETE FROM lara_media_analyses WHERE instance_name=$1 AND message_id=$2",
   [instance,id]);
  await closeDatabasePool();
 }
});
