import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { getDatabasePool, closeDatabasePool } from "../server/database.js";
import {
  reserveNativeClinicAppointment, applyNativeBookingAction,
  expireNativeHolds, NativeCalendarError,
} from "../server/native-calendar.js";
import { listProposedExamTimes } from "../server/cedipi-clinic-repository.js";

function futureTuesday() {
  const local=new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Sao_Paulo",
    year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const base=Date.parse(local+"T12:00:00Z");
  for(let i=2;i<=10;i++){
    const next=new Date(base+i*86400000);
    if(next.getUTCDay()===2)return next.toISOString().slice(0,10);
  }
  throw Error("tuesday_missing");
}

test("Native CEDIPI calendar: concurrent overlaps, medical/payment gates, expiration",{
  skip:!process.env.DATABASE_URL,
  timeout:50000,
},async()=>{
  const pool=getDatabasePool();
  const date=futureTuesday();
  const startMs=Date.parse(date+"T12:00:00Z");
  const phone1="5511999900001",phone2="5511999900002",phone3="5511999900003";
  const code="ci-native-"+randomUUID();
  const paidCode="ci-paid-"+randomUUID();
  const medicalCode="ci-medical-"+randomUUID();
  const exam={code,name:"CI Native Safe Test",doctor_names:["Wagner"],
    duration_minutes:20,price_cents:20000,medical_approval:false,doctor_review:false,add_on_only:false};
  const paidExam={...exam,code:paidCode,price_cents:45000};
  const medicalExam={...exam,code:medicalCode,price_cents:64000,
    medical_approval:true,doctor_review:true};
  const start=(min)=>new Date(startMs+min*60000).toISOString();
  const ids=[];
  try{
    await pool.query("INSERT INTO cedipi_official_documents"
      +"(source_number,filename,source_sha256,content)"
      +" VALUES(3,'ci-synthetic',repeat('0',64),'CI synthetic facts')"
      +" ON CONFLICT(source_number) DO NOTHING");
    for (const fixture of [exam,paidExam,medicalExam]) {
      await pool.query("INSERT INTO cedipi_exam_catalog"
        +"(code,name,category,price_cents,duration_minutes,doctor_names,"
        +"medical_approval,doctor_review,source_number)"
        +" VALUES($1,$2,$3,$4,$5,$6,$7,$8,3)",
        [fixture.code,"CI "+fixture.code,fixture.medical_approval?"procedure":"ultrasound",
         fixture.price_cents,fixture.duration_minutes,fixture.doctor_names,
         fixture.medical_approval,fixture.doctor_review??false]);
    }
    const base={exam,date,doctor:"Wagner",patientName:"Teste CEDIPI"};
    const results=await Promise.allSettled([
      reserveNativeClinicAppointment({...base,phone:phone1,start:start(0)}),
      reserveNativeClinicAppointment({...base,phone:phone2,start:start(0)}),
    ]);
    const winners=results.filter(x=>x.status==="fulfilled");
    const losers=results.filter(x=>x.status==="rejected");
    assert.equal(winners.length,1);
    assert.equal(losers.length,1);
    assert.ok(losers[0].reason instanceof NativeCalendarError);
    assert.equal(losers[0].reason.code,"slot_already_occupied");
    const first=winners[0].value;ids.push(first.appointmentId);
    assert.equal(first.status,"confirmed");

    const slots=await listProposedExamTimes({exam,date,limit:5},pool);
    assert.ok(slots.length>0);
    assert.ok(!slots.some(x=>x.start===start(0)),"busy slot must not reappear");

    const paid=await reserveNativeClinicAppointment({...base,phone:phone2,
      exam:paidExam,start:start(20)});
    ids.push(paid.appointmentId);
    assert.equal(paid.status,"awaiting_payment_proof");
    assert.equal(paid.depositCents,9000);
    await assert.rejects(
      applyNativeBookingAction({id:paid.id,action:"approve_medical"}),
      e=>e.code==="approval_not_applicable");
    assert.equal((await applyNativeBookingAction({
      id:paid.id,action:"verify_payment",
    })).status,"confirmed");

    const medical=await reserveNativeClinicAppointment({...base,phone:phone3,
      exam:medicalExam,start:start(40)});
    ids.push(medical.appointmentId);
    assert.equal(medical.status,"awaiting_medical_approval");
    await assert.rejects(
      applyNativeBookingAction({id:medical.id,action:"verify_payment"}),
      e=>e.code==="payment_not_awaited");
    assert.equal((await applyNativeBookingAction({
      id:medical.id,action:"approve_medical",
    })).status,"awaiting_payment_proof");
    assert.equal((await applyNativeBookingAction({
      id:medical.id,action:"verify_payment",
    })).status,"confirmed");
    assert.equal((await applyNativeBookingAction({
      id:medical.id,action:"cancel",
    })).status,"cancelled");

    // Expiration frees a pending reservation for reuse, never falsely
    // confirming an unverified Pix.
    const pending=await reserveNativeClinicAppointment({...base,phone:phone3,
      exam:paidExam,start:start(60)});
    ids.push(pending.appointmentId);
    await pool.query("UPDATE appointments SET hold_expires_at=NOW()-interval '1 minute' WHERE id=$1",
      [pending.appointmentId]);
    await expireNativeHolds(pool);
    assert.equal((await pool.query("SELECT status FROM appointments WHERE id=$1",
      [pending.appointmentId])).rows[0].status,"cancelled");
    assert.equal((await pool.query("SELECT status FROM lara_booking_requests WHERE id=$1",
      [pending.id])).rows[0].status,"cancelled");

  } finally {
    if(ids.length) {
      await pool.query("DELETE FROM cedipi_appointment_events WHERE appointment_id=ANY($1::uuid[])",[ids]);
      await pool.query("DELETE FROM lara_booking_requests WHERE appointment_id=ANY($1::uuid[])",[ids]);
      await pool.query("DELETE FROM appointments WHERE id=ANY($1::uuid[])",[ids]);
    }
    await pool.query("DELETE FROM patients WHERE phone=ANY($1::text[])",
      [[phone1,phone2,phone3]]);
    await pool.query("DELETE FROM cedipi_exam_catalog WHERE code=ANY($1::text[])",
      [[code,paidCode,medicalCode]]);
    await pool.query("DELETE FROM cedipi_official_documents WHERE source_number=3 AND filename='ci-synthetic'");
    await closeDatabasePool();
  }
});
