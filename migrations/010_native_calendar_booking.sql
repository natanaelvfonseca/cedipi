-- CEDIPI native PostgreSQL scheduler: the database, not Google, is the sole
-- availability/booking source of truth. Enforce no overlaps for each doctor.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE appointments ADD COLUMN exam_code TEXT REFERENCES cedipi_exam_catalog(code);
ALTER TABLE appointments ADD COLUMN hold_expires_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

ALTER TABLE appointments ADD CONSTRAINT cedipi_doctor_no_active_overlap
  EXCLUDE USING gist (
    doctor_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('pending','confirmed','scheduled'));

ALTER TABLE lara_booking_requests
  ADD COLUMN appointment_id UUID REFERENCES appointments(id),
  ADD COLUMN medical_approved_at TIMESTAMPTZ,
  ADD COLUMN payment_verified_at TIMESTAMPTZ,
  ADD COLUMN completed_at TIMESTAMPTZ;
CREATE UNIQUE INDEX lara_request_appointment_unique ON lara_booking_requests(appointment_id)
  WHERE appointment_id IS NOT NULL;

CREATE TABLE cedipi_appointment_events (
  id BIGSERIAL PRIMARY KEY,
  appointment_id UUID NOT NULL REFERENCES appointments(id),
  event_type VARCHAR(60) NOT NULL,
  actor VARCHAR(100) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX cedipi_appointment_events_by_appointment
  ON cedipi_appointment_events(appointment_id, created_at DESC);
