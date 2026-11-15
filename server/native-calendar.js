import { randomUUID } from "node:crypto";
import { getDatabasePool } from "./database.js";

const zone = "America/Sao_Paulo";
const validPhone = /^55\d{10,11}$/;
const validDate = /^20\d\d-\d\d-\d\d$/;
const active = ["pending", "confirmed", "scheduled"];

export class NativeCalendarError extends Error {
  constructor(code, status = 409) {
    super(code);
    this.name = "NativeCalendarError";
    this.code = code;
    this.status = status;
  }
}

export async function expireNativeHolds(pool = getDatabasePool()) {
  await pool.query(
    "WITH expired AS (UPDATE appointments SET status='cancelled',revision=revision+1,"
    + "updated_at=NOW() WHERE status='pending' AND hold_expires_at IS NOT NULL"
    + " AND hold_expires_at<NOW() RETURNING id)"
    + " UPDATE lara_booking_requests r SET status='cancelled',updated_at=NOW()"
    + " FROM expired e WHERE r.appointment_id=e.id AND r.status NOT IN ('cancelled','completed');"
  );
}

// Native reservation: doctor row lock serializes with panel booking / blocks.
// Exclusion constraint on appointments remains the final concurrent safety net.
export async function reserveNativeClinicAppointment({
  phone,exam,date,start,doctor,patientName,
}, pool=getDatabasePool()) {
  if (!validPhone.test(phone ?? "") || !exam?.code ||
    !Number.isInteger(exam.duration_minutes) || exam.duration_minutes < 1 ||
    !validDate.test(date ?? "") || !Number.isFinite(Date.parse(start)) ||
    typeof doctor!=="string" || typeof patientName!=="string" ||
    patientName.trim().length<3 || patientName.length>110 ||
    exam.add_on_only || exam.doctor_review && !exam.medical_approval) {
    throw new NativeCalendarError("invalid_reservation",422);
  }
  await expireNativeHolds(pool);
  const client=await pool.connect();
  try {
    await client.query("BEGIN;");
    const dr=await client.query(
      "SELECT id,name FROM doctors WHERE name=$1 AND active=TRUE FOR UPDATE;",
      [doctor],
    );
    const d=dr.rows[0];
    if(!d || !exam.doctor_names.includes(d.name)) throw new NativeCalendarError("doctor_unavailable");
    const checks=await client.query(
      "SELECT $1::timestamptz AS start_time,"
      + " $1::timestamptz+make_interval(mins=>$2::int) AS end_time,"
      + " ($1::timestamptz AT TIME ZONE $3)::date AS local_date,"
      + " ($1::timestamptz AT TIME ZONE $3)::time AS local_time;",
      [start,exam.duration_minutes,zone],
    );
    const time=checks.rows[0];
    if(!time || time.local_date.toISOString().slice(0,10)!==date ||
       time.start_time.getTime() < Date.now()+2*3600000 ||
       time.start_time.getTime() > Date.now()+45*86400000) {
      throw new NativeCalendarError("time_out_of_range",422);
    }
    const schedule=await client.query(
      "SELECT 1 FROM doctor_weekly_schedules s WHERE s.doctor_id=$1 AND s.active"
      + " AND s.weekday=EXTRACT(ISODOW FROM $2::date)"
      + " AND $3::time>=s.starts_at"
      + " AND ($3::time+make_interval(mins=>$4::int))<=s.ends_at"
      + " AND MOD(EXTRACT(EPOCH FROM ($3::time-s.starts_at))::integer,"
      + " s.slot_duration_minutes*60)=0 LIMIT 1;",
      [d.id,date,time.local_time,exam.duration_minutes],
    );
    if(!schedule.rowCount)throw new NativeCalendarError("outside_medical_schedule");
    const conflicts=await client.query(
      "SELECT EXISTS(SELECT 1 FROM doctor_schedule_blocks b"
      + " WHERE b.doctor_id=$1 AND b.removed_at IS NULL"
      + " AND b.starts_at<$3 AND b.ends_at>$2) AS blocked,"
      + " EXISTS(SELECT 1 FROM doctor_availability a"
      + " WHERE a.doctor_id=$1 AND a.status<>'available'"
      + " AND a.starts_at<$3 AND a.ends_at>$2) AS unavailable,"
      + " EXISTS(SELECT 1 FROM appointments a"
      + " WHERE a.doctor_id=$1 AND a.status=ANY($4::varchar[])"
      + " AND a.starts_at<$3 AND a.ends_at>$2) AS occupied;",
      [d.id,time.start_time,time.end_time,active],
    );
    if(Object.values(conflicts.rows[0]).some(Boolean))
      throw new NativeCalendarError("slot_already_occupied");

    const patient=await client.query(
      "INSERT INTO patients(id,name,phone) VALUES($1,$2,$3)"
      + " ON CONFLICT(phone) DO UPDATE SET name=EXCLUDED.name,updated_at=NOW()"
      + " RETURNING id;",
      [randomUUID(),patientName.trim(),phone],
    );
    const needsApproval=exam.medical_approval===true;
    const needsPayment=exam.price_cents>=40000;
    const status=needsApproval?"awaiting_medical_approval":needsPayment
      ?"awaiting_payment_proof":"confirmed";
    const appointmentStatus=status==="confirmed"?"confirmed":"pending";
    const ap=await client.query(
      "INSERT INTO appointments"
      + "(id,patient_id,doctor_id,exam_code,exam_name,starts_at,ends_at,"
      + "status,source,hold_expires_at)"
      + " VALUES($1,$2,$3,$4,$5,$6,$7,$8,'lara',"
      + " CASE WHEN $8='pending' THEN LEAST(NOW()+interval '24 hours',$6::timestamptz)"
      + " ELSE NULL END) RETURNING id,status,starts_at,ends_at;",
      [randomUUID(),patient.rows[0].id,d.id,exam.code,exam.name,time.start_time,
        time.end_time,appointmentStatus],
    );
    const req=await client.query(
      "INSERT INTO lara_booking_requests"
      + "(phone,exam_code,preferred_date,preferred_start,doctor_name,"
      + "patient_name,status,appointment_id)"
      + " VALUES($1,$2,$3,$4,$5,$6,$7,$8)"
      + " RETURNING id,status,appointment_id;",
      [phone,exam.code,date,time.start_time,doctor,patientName.trim(),status,ap.rows[0].id],
    );
    await client.query(
      "INSERT INTO cedipi_appointment_events(appointment_id,event_type,actor,details)"
      + " VALUES($1,$2,'lara',$3::jsonb);",
      [ap.rows[0].id,"created",JSON.stringify({status,exam:exam.code})],
    );
    await client.query("COMMIT;");
    return {
      id:req.rows[0].id, appointmentId:ap.rows[0].id,
      status,doctor:d.name,examName:exam.name,
      start:time.start_time.toISOString(),end:time.end_time.toISOString(),
      depositCents:needsPayment?Math.round(exam.price_cents*0.2):0,
      holdExpiresAt:appointmentStatus==="pending"
        ?new Date(Math.min(Date.now()+86400000,time.start_time.getTime())).toISOString():null,
    };
  } catch(error) {
    await client.query("ROLLBACK;").catch(()=>{});
    if(error.code==="23P01" || error.code==="23505")
      throw new NativeCalendarError("slot_already_occupied",409);
    throw error;
  } finally {client.release()}
}

export async function applyNativeBookingAction({
  id,action,actor="admin",
},pool=getDatabasePool()) {
  if(!/^[a-f0-9-]{36}$/i.test(id??"") ||
    !["approve_medical","verify_payment","cancel"].includes(action))
    throw new NativeCalendarError("invalid_action",422);
  const client=await pool.connect();
  try {
    await client.query("BEGIN;");
    const rows=await client.query(
      "SELECT r.id,r.status,r.appointment_id,r.medical_approved_at,"
      + "r.payment_verified_at,e.price_cents,e.medical_approval,"
      + "a.status AS appointment_status,a.hold_expires_at"
      + " FROM lara_booking_requests r JOIN cedipi_exam_catalog e ON e.code=r.exam_code"
      + " JOIN appointments a ON a.id=r.appointment_id WHERE r.id=$1 FOR UPDATE OF r,a;",
      [id],
    );
    const r=rows.rows[0];
    if(!r)throw new NativeCalendarError("request_not_found",404);
    if(!["pending","confirmed"].includes(r.appointment_status) ||
      ["cancelled","completed"].includes(r.status))
      throw new NativeCalendarError("booking_not_active");
    if(action!=="cancel" && r.hold_expires_at &&
       new Date(r.hold_expires_at)<new Date())
      throw new NativeCalendarError("booking_hold_expired");
    let status=r.status;
    if(action==="cancel")status="cancelled";
    else if(action==="approve_medical"){
      if(!r.medical_approval || r.status!=="awaiting_medical_approval")
        throw new NativeCalendarError("approval_not_applicable");
      status=r.price_cents>=40000 && !r.payment_verified_at
        ?"awaiting_payment_proof":"confirmed";
    }else{
      if(r.status!=="awaiting_payment_proof")
        throw new NativeCalendarError("payment_not_awaited");
      if(r.medical_approval && !r.medical_approved_at)
        throw new NativeCalendarError("medical_approval_missing");
      status="confirmed";
    }
    const update=await client.query(
      "UPDATE lara_booking_requests SET status=$2,"
      + "medical_approved_at=CASE WHEN $3='approve_medical' THEN NOW() ELSE medical_approved_at END,"
      + "payment_verified_at=CASE WHEN $3='verify_payment' THEN NOW() ELSE payment_verified_at END,"
      + "completed_at=CASE WHEN $2 IN ('confirmed','cancelled') THEN NOW() ELSE completed_at END,"
      + "updated_at=NOW() WHERE id=$1 RETURNING id,status;",
      [id,status,action],
    );
    if(status==="confirmed" || status==="cancelled") {
      await client.query(
        "UPDATE appointments SET status=$2,hold_expires_at=NULL,"
        + "revision=revision+1,updated_at=NOW() WHERE id=$1;",
        [r.appointment_id,status],
      );
    }
    await client.query(
      "INSERT INTO cedipi_appointment_events(appointment_id,event_type,actor,details)"
      + " VALUES($1,$2,$3,$4::jsonb);",
      [r.appointment_id,action,actor,JSON.stringify({status})],
    );
    await client.query("COMMIT;");
    return update.rows[0];
  } catch(e){await client.query("ROLLBACK;").catch(()=>{});throw e;}
  finally{client.release()}
}
