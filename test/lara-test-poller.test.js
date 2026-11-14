import assert from "node:assert/strict";
import test from "node:test";
import { createLaraTestPoller } from "../server/lara-test-poller.js";

const phone="5511999999999";
const lid="123456789012345@lid";
function record(id, timestamp, fromMe, number=phone) {
  return {
    key: { id, fromMe, remoteJid: lid, remoteJidAlt: number+"@s.whatsapp.net" },
    message: { conversation: "Oi" },
    messageTimestamp: timestamp,
  };
}
const minTimestamp=1700000000;

test("test poller handles real Evolution LID chats and never enqueues any other contact", async () => {
  const accepted=[];
  const m=createLaraTestPoller({
    phone, remoteJid:lid, minTimestamp,
    client:{ findMessages: async (jid,opts)=>{
      assert.equal(jid,lid);
      assert.deepEqual(opts,{page:1,offset:30});
      return {messages:{records:[
        record("today", minTimestamp+3, false),
        record("outgoing",minTimestamp+1,true),
        record("other",minTimestamp+5,false,"5511888888888"),
        record("old",minTimestamp-1,false),
        record("today2", minTimestamp+4,false),
      ]}};
    }},
    enqueue:async e=>{accepted.push(e);return {duplicate:false};},
  });
  const r=await m.pollOnce();
  assert.deepEqual(r,{accepted:2,duplicates:0});
  assert.deepEqual(accepted.map(x=>x.messageId),["today","today2"]);
  assert.ok(accepted.every(x=>x.phone===phone));
});

test("test poller fails closed if phone, jid or timestamp is missing",()=>{
  const client={findMessages:async()=>({messages:{records:[]}})};
  assert.throws(()=>createLaraTestPoller({phone:"bad",remoteJid:lid,minTimestamp,client}));
  assert.throws(()=>createLaraTestPoller({phone,remoteJid:"12345@g.us",minTimestamp,client}));
  assert.throws(()=>createLaraTestPoller({phone,remoteJid:lid,minTimestamp:0,client}));
});

test("poller does not answer an inbound text already answered by n8n or human",async()=>{
  const enqueued=[];
  const poller=createLaraTestPoller({
    phone, remoteJid:lid, minTimestamp,
    client:{findMessages:async()=>({messages:{records:[
      record("already-answered",minTimestamp+2,false),
      record("human-outbound",minTimestamp+3,true),
      record("unanswered",minTimestamp+4,false),
    ]}})},
    enqueue:async e=>{enqueued.push(e.messageId);return {duplicate:false};},
  });
  const result=await poller.pollOnce();
  assert.deepEqual(enqueued,["unanswered"]);
  assert.equal(result.accepted,1);
});
