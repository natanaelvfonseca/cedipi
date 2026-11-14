import { getDatabasePool } from "./database.js";

const timezone = "America/Sao_Paulo";
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export async function listOfficialExams(pool = getDatabasePool()) {
  const result = await pool.query(
    "SELECT code,name,category,price_cents,duration_minutes,doctor_names,"
    + "preparation,notes,medical_approval,doctor_review,add_on_only"
    + " FROM cedipi_exam_catalog WHERE active=TRUE ORDER BY name;"
  );
  return result.rows;
}

export async function listClinicCatalogOverview(pool = getDatabasePool()) {
  const [exams, documents, doctors] = await Promise.all([
    listOfficialExams(pool),
    pool.query("SELECT source_number,filename,source_sha256,imported_at"
      + " FROM cedipi_official_documents ORDER BY source_number;"),
    pool.query("SELECT name,active FROM doctors ORDER BY name;"),
  ]);
  return { exams, documents: documents.rows, doctors: doctors.rows };
}

export async function readLaraSession(phone, pool = getDatabasePool()) {
  const { rows } = await pool.query(
    "SELECT phone,state,exam_code,selected_day,selected_start,"
    + "selected_doctor_name,offered_options,patient_name,updated_at"
    + " FROM lara_conversation_state WHERE phone=$1;", [phone],
  );
  const state = rows[0];
  if (!state || Date.now() - new Date(state.updated_at).getTime() > 48 * 3600000) {
    return { phone, state: "idle" };
  }
  return state;
}

export async function saveLaraSession(phone, changes, pool = getDatabasePool()) {
  if (!/^\d{10,30}$/.test(phone)) throw new Error("invalid_phone");
  const result = await pool.query(
    "INSERT INTO lara_conversation_state "
    + "(phone,state,exam_code,selected_day,selected_start,selected_doctor_name,"
    + " offered_options,patient_name) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)"
    + " ON CONFLICT(phone) DO UPDATE SET state=EXCLUDED.state,"
    + " exam_code=EXCLUDED.exam_code,selected_day=EXCLUDED.selected_day,"
    + " selected_start=EXCLUDED.selected_start,"
    + " selected_doctor_name=EXCLUDED.selected_doctor_name,"
    + " offered_options=EXCLUDED.offered_options,patient_name=EXCLUDED.patient_name,"
    + " updated_at=NOW() RETURNING state;",
    [phone,changes.state ?? "idle",changes.exam_code ?? null,changes.selected_day ?? null,
      changes.selected_start ?? null,changes.selected_doctor_name ?? null,
      JSON.stringify(changes.offered_options ?? null),changes.patient_name ?? null],
  );
  return result.rows[0];
}

export async function listProposedExamTimes({ exam, date, doctorName, limit = 3 },
  pool = getDatabasePool()) {
  if (!datePattern.test(date) || !exam?.duration_minutes ||
      !Array.isArray(exam.doctor_names) || !exam.doctor_names.length) return [];
  // The local schedule is not a verified external Google Calendar reservation.
  const sql = [
    "WITH proposed AS (",
    " SELECT d.id AS doctor_id,d.name AS doctor_name,",
    " (($1::date + s.starts_at + offset_n * interval '20 minutes') AT TIME ZONE $4) AS starts_at,",
    " (($1::date + s.starts_at + offset_n * interval '20 minutes'",
    " + make_interval(mins => $3::int)) AT TIME ZONE $4) AS ends_at",
    " FROM doctor_weekly_schedules s",
    " JOIN doctors d ON d.id=s.doctor_id AND d.active=TRUE",
    " CROSS JOIN LATERAL generate_series(0,greatest(-1,floor((",
    " EXTRACT(EPOCH FROM(s.ends_at-s.starts_at))/60 - $3::int)/20)::integer)) AS offset_n",
    " WHERE s.weekday=EXTRACT(ISODOW FROM $1::date) AND s.active=TRUE",
    " AND d.name=ANY($2::text[]) AND ($5::text IS NULL OR d.name=$5::text)",
    " AND $1::date >= (NOW() AT TIME ZONE $4)::date",
    " AND $1::date <= (NOW() AT TIME ZONE $4)::date + 45",
    ") SELECT p.doctor_name,p.starts_at,p.ends_at FROM proposed p",
    " WHERE p.starts_at > NOW()+interval '2 hours'",
    " AND NOT EXISTS (SELECT 1 FROM doctor_schedule_blocks b",
    "   WHERE b.doctor_id=p.doctor_id AND b.removed_at IS NULL",
    "   AND b.starts_at<p.ends_at AND b.ends_at>p.starts_at)",
    " AND NOT EXISTS (SELECT 1 FROM doctor_availability a",
    "   WHERE a.doctor_id=p.doctor_id AND a.status<>'available'",
    "   AND a.starts_at<p.ends_at AND a.ends_at>p.starts_at)",
    " AND NOT EXISTS (SELECT 1 FROM appointments a",
    "   WHERE a.doctor_id=p.doctor_id",
    "   AND a.status IN ('pending','confirmed','scheduled')",
    "   AND a.starts_at<p.ends_at AND a.ends_at>p.starts_at)",
    " AND NOT EXISTS (SELECT 1 FROM lara_booking_requests r",
    "   JOIN cedipi_exam_catalog e ON e.code=r.exam_code",
    "   WHERE r.doctor_name=p.doctor_name",
    "   AND r.status IN ('needs_verification','awaiting_medical_approval',",
    "     'awaiting_payment_proof','confirmed')",
    "   AND r.preferred_start<p.ends_at",
    "   AND r.preferred_start+make_interval(mins=>e.duration_minutes)>p.starts_at)",
    " ORDER BY p.starts_at,p.doctor_name LIMIT $6::int;"
  ].join(" ");
  const result=await pool.query(sql,[date,exam.doctor_names,exam.duration_minutes,
    timezone,doctorName??null,Math.min(5,Math.max(1,limit))]);
  return result.rows.map(row=>({
    doctor:row.doctor_name,start:row.starts_at.toISOString(),
    end:row.ends_at.toISOString(),verified:false,
  }));
}

export async function createBookingRequest({
  phone, exam, date, start, doctor, patientName, status,
}, pool = getDatabasePool()) {
  if (!/^\d{10,30}$/.test(phone) || !exam?.code ||
      !["needs_verification","awaiting_medical_approval"].includes(status) ||
      !datePattern.test(date) || typeof patientName!=="string" ||
      patientName.length<3 || patientName.length>110) {
    throw new Error("invalid_booking_request");
  }
  const result = await pool.query(
    "INSERT INTO lara_booking_requests"
    + "(phone,exam_code,preferred_date,preferred_start,doctor_name,patient_name,status)"
    + " VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,status,created_at;",
    [phone,exam.code,date,start,doctor,patientName,status],
  );
  return result.rows[0];
}

export async function listPendingBookingRequests(pool = getDatabasePool()) {
  const result=await pool.query(
    "SELECT r.id,r.phone,r.exam_code,e.name AS exam_name,"
    + "r.preferred_date,r.preferred_start,r.doctor_name,r.patient_name,"
    + "r.status,r.created_at FROM lara_booking_requests r"
    + " JOIN cedipi_exam_catalog e ON e.code=r.exam_code"
    + " WHERE r.status IN ('needs_verification','awaiting_medical_approval',"
    + "'awaiting_payment_proof') ORDER BY r.created_at ASC LIMIT 100;"
  );
  return result.rows;
}

export async function readOfficialDocument(sourceNumber,pool=getDatabasePool()) {
  const r=await pool.query(
    "SELECT content FROM cedipi_official_documents WHERE source_number=$1;",
    [sourceNumber],
  );
  return r.rows[0]?.content??null;
}
