import assert from "node:assert/strict";
import test from "node:test";
import { createNativeLiveAvailabilityHandler } from "../server/native-availability-handler.js";
import { readOpenAiApiKey } from "../server/openai-credentials.js";

function response() {
  return {
    statusCode:200,body:null,
    status(n){this.statusCode=n;return this;},
    json(data){this.body=data;return this;},
  };
}
test("native live availability uses same slots as CEDIPI panel, never n8n",async()=>{
  const available=[
    {id:"slot-1",doctor:{name:"Wagner"},status:"available",
      startsAtLocal:"2026-11-17T09:00:00",startsAt:"2026-11-17T12:00:00.000Z",
      endsAt:"2026-11-17T12:20:00.000Z"},
    {id:"slot-2",doctor:{name:"Wagner"},status:"booked",
      startsAtLocal:"2026-11-17T09:20:00",startsAt:"2026-11-17T12:20:00.000Z",
      endsAt:"2026-11-17T12:40:00.000Z"},
  ];
  const route=createNativeLiveAvailabilityHandler(async ({date,doctor})=>{
    assert.equal(date,"2026-11-17");assert.equal(doctor,"Wagner");
    return available;
  });
  const reply=response();
  await route({query:{date:"2026-11-17",doctor:"Wagner"}},reply);
  assert.equal(reply.statusCode,200);
  assert.deepEqual(reply.body.availability.slots.map(x=>x.slotId),["slot-1"]);
  assert.equal(reply.body.availability.available,true);
});

test("OpenAI key can be read from Docker secret without env value",()=>{
  assert.equal(readOpenAiApiKey({envKey:"  test-key ",secretPath:"/nonexistent"}),"test-key");
  assert.equal(readOpenAiApiKey({envKey:"",secretPath:"/nonexistent"}),null);
});
