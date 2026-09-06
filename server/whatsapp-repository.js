import { randomUUID } from "node:crypto";
import { getDatabasePool } from "./database.js";

export async function saveWhatsAppInstance(instance) {
  const result = await getDatabasePool().query(
    `
      INSERT INTO whatsapp_instances (
        id, provider, instance_name, external_instance_id, status,
        phone_number, profile_name, integration_type, last_checked_at,
        connected_at, disconnected_at
      )
      VALUES (
        $1::uuid, 'evolution', $2::varchar, $3::varchar, $4::varchar,
        $5::varchar, $6::varchar, $7::varchar, $8::timestamptz,
        CASE WHEN $4::varchar = 'connected' THEN $8::timestamptz ELSE NULL END,
        CASE WHEN $4::varchar = 'disconnected' THEN $8::timestamptz ELSE NULL END
      )
      ON CONFLICT (instance_name) DO UPDATE SET
        external_instance_id = EXCLUDED.external_instance_id,
        status = EXCLUDED.status,
        phone_number = EXCLUDED.phone_number,
        profile_name = EXCLUDED.profile_name,
        integration_type = EXCLUDED.integration_type,
        last_checked_at = EXCLUDED.last_checked_at,
        connected_at = CASE
          WHEN EXCLUDED.status = 'connected' AND whatsapp_instances.status <> 'connected'
            THEN EXCLUDED.last_checked_at
          ELSE whatsapp_instances.connected_at
        END,
        disconnected_at = CASE
          WHEN EXCLUDED.status = 'connected' THEN NULL
          WHEN EXCLUDED.status = 'disconnected' AND whatsapp_instances.status <> 'disconnected'
            THEN EXCLUDED.last_checked_at
          ELSE whatsapp_instances.disconnected_at
        END,
        updated_at = NOW()
      RETURNING *;
    `,
    [
      randomUUID(),
      instance.name,
      instance.externalInstanceId,
      instance.status,
      instance.phoneNumber,
      instance.profileName,
      instance.integrationType,
      instance.lastCheckedAt,
    ],
  );
  return result.rows[0];
}
