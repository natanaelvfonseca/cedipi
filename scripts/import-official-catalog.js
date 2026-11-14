// Import private, verified clinical documents only on the clinic's VPS.
import { readFile } from "node:fs/promises";
import { getDatabasePool, closeDatabasePool } from "../server/database.js";

export async function importOfficialCatalog(filePath, pool = getDatabasePool()) {
  if (!filePath) throw new Error("official_catalog_path_missing");
  const payload = JSON.parse(await readFile(filePath, "utf8"));
  if (!Array.isArray(payload.documents) || payload.documents.length !== 6 ||
      !Array.isArray(payload.exams) || payload.exams.length !== 47 ||
      new Set(payload.exams.map((x) => x.id)).size !== 47) {
    throw new Error("official_catalog_incomplete");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN;");
    await client.query("SELECT pg_advisory_xact_lock($1);", [2026111409]);
    for (const source of payload.documents) {
      if (!Number.isInteger(source.source_number) ||
          !/^[a-f0-9]{64}$/.test(source.sha256) ||
          !Array.isArray(source.paragraphs) || !source.paragraphs.length) {
        throw new Error("official_document_invalid");
      }
      await client.query(
        "INSERT INTO cedipi_official_documents(source_number,filename,source_sha256,content)"
        + " VALUES($1,$2,$3,$4) ON CONFLICT(source_number) DO UPDATE SET"
        + " filename=EXCLUDED.filename,source_sha256=EXCLUDED.source_sha256,"
        + " content=EXCLUDED.content,imported_at=NOW();",
        [source.source_number,source.filename,source.sha256,source.paragraphs.join("\n")],
      );
    }
    for (const exam of payload.exams) {
      if (!exam.id || !exam.name || !Number.isSafeInteger(exam.price_cents) ||
          !Array.isArray(exam.doctors) || !exam.doctors.length ||
          ![2,3].includes(exam.source_number)) throw new Error("official_exam_invalid");
      await client.query(
        "INSERT INTO cedipi_exam_catalog"
        + "(code,name,category,price_cents,duration_minutes,doctor_names,"
        + " preparation,notes,medical_approval,doctor_review,add_on_only,source_number)"
        + " VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)"
        + " ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,category=EXCLUDED.category,"
        + " price_cents=EXCLUDED.price_cents,duration_minutes=EXCLUDED.duration_minutes,"
        + " doctor_names=EXCLUDED.doctor_names,preparation=EXCLUDED.preparation,notes=EXCLUDED.notes,"
        + " medical_approval=EXCLUDED.medical_approval,doctor_review=EXCLUDED.doctor_review,"
        + " add_on_only=EXCLUDED.add_on_only,source_number=EXCLUDED.source_number,imported_at=NOW();",
        [exam.id,exam.name,exam.category,exam.price_cents,exam.duration_minutes,
          exam.doctors,exam.preparation,exam.notes,exam.medical_approval,exam.doctor_review,
          exam.add_on_only,exam.source_number],
      );
    }
    // Non-sensitive, formally approved entries for language-model retrieval.
    // Payment PIX and detailed medicinal preparation are NOT available in
    // general semantic search: release only through the approved workflow.
    const doctors = payload.documents[0];
    const doctorText = doctors.paragraphs.join("\n");
    await client.query(
      "DELETE FROM lara_knowledge_sources WHERE title LIKE '[CEDIPI OFICIAL] %';"
    );
    await client.query(
      "INSERT INTO lara_knowledge_sources(title,content) VALUES($1,$2);",
      ["[CEDIPI OFICIAL] Agenda dos médicos", doctorText.slice(0,40000)],
    );
    for (const exam of payload.exams) {
      const text = [exam.name,
        "Preço: R$ " + (exam.price_cents / 100).toFixed(2).replace(".",","),
        "Duração: " + (exam.duration_minutes == null
          ? "não informada; confirmar com a recepção" : exam.duration_minutes + " minutos"),
        "Médico(s): " + exam.doctors.join(", "),
        exam.preparation ? "Preparo: " + exam.preparation : "Preparo: confirmar com a equipe",
        exam.notes ? "Observações: " + exam.notes : "",
        exam.medical_approval ? "Confirmação somente após aprovação médica" : "",
      ].filter(Boolean).join("\n");
      await client.query(
        "INSERT INTO lara_knowledge_sources(title,content) VALUES($1,$2);",
        ["[CEDIPI OFICIAL] " + exam.name.slice(0,178),text.slice(0,40000)],
      );
    }
    await client.query("COMMIT;");
    return { documents:payload.documents.length, exams:payload.exams.length,
      officialKnowledge:payload.exams.length + 1 };
  } catch(error) {
    await client.query("ROLLBACK;").catch(()=>{});
    throw error;
  } finally { client.release(); }
}

if (process.argv[1]?.endsWith("/import-official-catalog.js")) {
  try {
    const result = await importOfficialCatalog(process.argv[2]);
    console.log("CEDIPI OFFICIAL IMPORT VERIFIED",result);
  } catch (error) {
    console.error("CEDIPI OFFICIAL IMPORT FAILED",error.message);
    process.exitCode=1;
  } finally { await closeDatabasePool(); }
}
