ALTER TABLE appointments
  ADD COLUMN availability_id UUID REFERENCES doctor_availability(id),
  ADD COLUMN external_calendar_id TEXT;

ALTER TABLE appointments
  DROP CONSTRAINT appointments_valid_status,
  ADD CONSTRAINT appointments_valid_status CHECK (
    status IN (
      'pending',
      'confirmed',
      'failed',
      'scheduled',
      'cancelled',
      'completed',
      'no_show'
    )
  );

CREATE INDEX appointments_availability_idx ON appointments (availability_id);

CREATE UNIQUE INDEX appointments_active_availability_unique_idx
  ON appointments (availability_id)
  WHERE availability_id IS NOT NULL
    AND status IN ('pending', 'confirmed', 'scheduled');
