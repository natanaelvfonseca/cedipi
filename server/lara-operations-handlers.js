import { getDatabasePool } from "./database.js";
import { getLaraProductionStatus } from "./lara-production-mode.js";

export function createLaraOperationsHandler({
  pool = null,
  runtime = getLaraProductionStatus,
} = {}) {
  return async (_req,res) => {
    try {
      const db = pool ?? getDatabasePool();
      const [queue, handoffs, bookings, control, latest] = await Promise.all([
        db.query(
          "SELECT status,count(*)::integer AS count FROM lara_inbound_messages " +
          "GROUP BY status"
        ),
        db.query("SELECT count(*)::integer AS count FROM lara_handoffs WHERE status='open'"),
        db.query("SELECT status,count(*)::integer AS count FROM lara_booking_requests " +
          "WHERE status IN ('awaiting_medical_approval','awaiting_payment_proof'," +
          "'needs_verification') GROUP BY status"),
        db.query("SELECT global_enabled FROM ai_control_settings WHERE id=1"),
        db.query("SELECT max(received_at) AS last_received FROM lara_inbound_messages"),
      ]);
      const pending = await db.query(
        "SELECT count(*)::integer AS count FROM lara_inbound_messages " +
        "WHERE status IN ('pending','processing') AND received_at < NOW()-interval '3 minutes';"
      );
      const uncertain = await db.query(
        "SELECT count(*)::integer AS count FROM lara_inbound_messages " +
        "WHERE status='sending' AND received_at < NOW()-interval '3 minutes';"
      );
      res.set("Cache-Control","no-store");
      res.status(200).json({
        ok:true,
        runtime:runtime(),
        globalAiEnabled:control.rows[0]?.global_enabled===true,
        queue:Object.fromEntries(queue.rows.map(row=>[row.status,row.count])),
        openHandoffs:handoffs.rows[0]?.count??0,
        pendingBookings:Object.fromEntries(bookings.rows.map(row=>[row.status,row.count])),
        overdueMessages:pending.rows[0]?.count??0,
        uncertainDeliveries:uncertain.rows[0]?.count??0,
        lastReceivedAt:latest.rows[0]?.last_received??null,
      });
    } catch {
      res.status(503).json({ok:false,error:"lara_operations_unavailable"});
    }
  };
}
