import { getDatabasePool } from "./database.js";

export async function getMediaAnalysis(instance,messageId,phone,pool=getDatabasePool()) {
 const result=await pool.query(
  "SELECT instance_name,message_id,phone,media_type,status,category,summary,"
  +"exam_names,readable,review_required,analyzed_at"
  +" FROM lara_media_analyses WHERE instance_name=$1 AND message_id=$2 AND phone=$3;",
  [instance,messageId,phone],
 );
 return result.rows[0]??null;
}

export async function claimMediaAnalysis({instance,messageId,phone,mediaType},
  pool=getDatabasePool()) {
 const result=await pool.query(
  "INSERT INTO lara_media_analyses(instance_name,message_id,phone,media_type,status)"
  +" VALUES($1,$2,$3,$4,'processing')"
  +" ON CONFLICT(instance_name,message_id) DO UPDATE"
  +" SET status='processing',failure_code=NULL,created_at=NOW()"
  +" WHERE (lara_media_analyses.status='failed'"
  +" OR (lara_media_analyses.status='processing' AND"
  +" lara_media_analyses.created_at<NOW()-interval '10 minutes'))"
  +" AND lara_media_analyses.phone=EXCLUDED.phone RETURNING message_id;",
  [instance,messageId,phone,mediaType],
 );
 return result.rowCount===1;
}
export async function saveMediaAnalysis({instance,messageId,phone,analysis},
  pool=getDatabasePool()){
 const result=await pool.query(
  "UPDATE lara_media_analyses SET status='done',category=$4,summary=$5,"
  +"exam_names=$6,readable=$7,review_required=TRUE,analyzed_at=NOW()"
  +" WHERE instance_name=$1 AND message_id=$2 AND phone=$3"
  +" AND status='processing' RETURNING status,category,summary,exam_names,readable,review_required,analyzed_at;",
  [instance,messageId,phone,analysis.category,analysis.summary,
    analysis.examNames,analysis.readable],
 );
 return result.rows[0]??null;
}
export async function failMediaAnalysis({instance,messageId,phone,code},
  pool=getDatabasePool()) {
 await pool.query(
  "UPDATE lara_media_analyses SET status='failed',failure_code=$4,analyzed_at=NOW()"
  +" WHERE instance_name=$1 AND message_id=$2 AND phone=$3 AND status='processing';",
  [instance,messageId,phone,code.slice(0,60)],
 );
}
export async function purgeOldMediaAnalyses(pool=getDatabasePool()){
 const result=await pool.query(
  "DELETE FROM lara_media_analyses WHERE created_at < NOW()-interval '30 days';"
 );
 return result.rowCount;
}
