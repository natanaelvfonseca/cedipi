CREATE TABLE doctor_weekly_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL,
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  slot_duration_minutes INTEGER NOT NULL DEFAULT 20,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT doctor_weekly_schedules_weekday_valid CHECK (weekday BETWEEN 1 AND 7),
  CONSTRAINT doctor_weekly_schedules_time_range_valid CHECK (ends_at > starts_at),
  CONSTRAINT doctor_weekly_schedules_duration_valid CHECK (slot_duration_minutes > 0),
  CONSTRAINT doctor_weekly_schedules_unique_range UNIQUE (doctor_id, weekday, starts_at, ends_at)
);

CREATE INDEX doctor_weekly_schedules_lookup_idx
  ON doctor_weekly_schedules (doctor_id, weekday, active);

CREATE TABLE doctor_schedule_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
  availability_id UUID NOT NULL REFERENCES doctor_availability(id) ON DELETE RESTRICT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  reason TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  removed_at TIMESTAMPTZ,
  CONSTRAINT doctor_schedule_blocks_time_range_valid CHECK (ends_at > starts_at),
  CONSTRAINT doctor_schedule_blocks_removal_valid CHECK (
    (removed_at IS NULL AND removed_by IS NULL)
    OR (removed_at IS NOT NULL AND removed_by IS NOT NULL)
  )
);

CREATE UNIQUE INDEX doctor_schedule_blocks_active_slot_unique_idx
  ON doctor_schedule_blocks (availability_id)
  WHERE removed_at IS NULL;

CREATE INDEX doctor_schedule_blocks_doctor_time_idx
  ON doctor_schedule_blocks (doctor_id, starts_at, ends_at)
  WHERE removed_at IS NULL;

WITH official_schedule (doctor_name, weekday, starts_at, ends_at) AS (
  VALUES
    ('Danilo', 1, '09:00'::time, '12:00'::time),
    ('Danilo', 1, '14:00'::time, '18:00'::time),
    ('Danilo', 2, '14:00'::time, '18:00'::time),
    ('Danilo', 3, '09:00'::time, '12:00'::time),
    ('Danilo', 4, '09:00'::time, '12:00'::time),
    ('Danilo', 4, '14:00'::time, '18:00'::time),
    ('Danilo', 5, '14:00'::time, '18:00'::time),
    ('Wagner', 2, '09:00'::time, '12:00'::time),
    ('Wagner', 3, '14:00'::time, '18:00'::time),
    ('Wagner', 5, '09:00'::time, '12:00'::time),
    ('Deison', 3, '15:00'::time, '16:40'::time),
    ('Deison', 5, '15:00'::time, '16:40'::time)
)
INSERT INTO doctor_weekly_schedules (
  doctor_id, weekday, starts_at, ends_at, slot_duration_minutes
)
SELECT doctors.id, official_schedule.weekday, official_schedule.starts_at,
       official_schedule.ends_at, 20
FROM official_schedule
JOIN doctors ON doctors.name = official_schedule.doctor_name
ON CONFLICT (doctor_id, weekday, starts_at, ends_at) DO NOTHING;
