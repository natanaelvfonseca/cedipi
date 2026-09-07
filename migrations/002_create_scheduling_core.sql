CREATE TABLE doctors (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  google_calendar_id TEXT,
  appointment_duration_minutes INTEGER NOT NULL DEFAULT 20,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT doctors_duration_positive CHECK (appointment_duration_minutes > 0)
);

CREATE TABLE doctor_availability (
  id UUID PRIMARY KEY,
  doctor_id UUID NOT NULL REFERENCES doctors(id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'available',
  source VARCHAR(50) NOT NULL DEFAULT 'panel',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT doctor_availability_valid_period CHECK (ends_at > starts_at),
  CONSTRAINT doctor_availability_valid_status CHECK (status IN ('available', 'blocked', 'unavailable')),
  CONSTRAINT doctor_availability_doctor_start_unique UNIQUE (doctor_id, starts_at)
);

CREATE TABLE patients (
  id UUID PRIMARY KEY,
  name VARCHAR(255),
  phone VARCHAR(30) NOT NULL UNIQUE,
  email VARCHAR(320),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT patients_phone_digits_only CHECK (phone ~ '^[0-9]+$')
);

CREATE TABLE appointments (
  id UUID PRIMARY KEY,
  patient_id UUID REFERENCES patients(id),
  doctor_id UUID NOT NULL REFERENCES doctors(id),
  exam_name VARCHAR(255),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'scheduled',
  source VARCHAR(50) NOT NULL,
  external_provider VARCHAR(100),
  external_event_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT appointments_valid_period CHECK (ends_at > starts_at),
  CONSTRAINT appointments_valid_status CHECK (status IN ('scheduled', 'cancelled', 'completed', 'no_show')),
  CONSTRAINT appointments_valid_source CHECK (source IN ('panel', 'lara', 'import')),
  CONSTRAINT appointments_external_reference_complete CHECK (
    external_event_id IS NULL OR external_provider IS NOT NULL
  )
);

CREATE INDEX doctor_availability_lookup_idx
  ON doctor_availability (doctor_id, starts_at, status);
CREATE INDEX appointments_doctor_start_idx ON appointments (doctor_id, starts_at);
CREATE INDEX appointments_patient_idx ON appointments (patient_id);
CREATE INDEX appointments_status_start_idx ON appointments (status, starts_at);
CREATE UNIQUE INDEX appointments_external_event_unique_idx
  ON appointments (external_provider, external_event_id)
  WHERE external_event_id IS NOT NULL;

INSERT INTO doctors (id, name, google_calendar_id, appointment_duration_minutes)
VALUES
  (
    'a2bda31d-618b-49f1-9aa5-b1bab002fcbd',
    'Danilo',
    '3897da8771a694909abeaa3e77b628fabb9ae4508c953f9708506727a641ef46@group.calendar.google.com',
    20
  ),
  (
    '8418eb24-bb4a-45e6-89ec-5cfaf22cf446',
    'Wagner',
    'aa05bd13d02a5f9a44b1516af6f6c37d63352d370435ab87546fdc6d0ff60c03@group.calendar.google.com',
    20
  ),
  (
    'c021cd87-8368-4d41-9ef7-2e0a68c82944',
    'Deison',
    'c3b3a186b4a670450a36c6b717d3262124377e5a498655a0b9308ba542fb129d@group.calendar.google.com',
    20
  );

WITH slots (doctor_name, starts_local) AS (
  VALUES
    ('Wagner', TIMESTAMP '2026-09-08 10:40'),
    ('Wagner', TIMESTAMP '2026-09-08 11:00'),
    ('Wagner', TIMESTAMP '2026-09-08 11:20'),
    ('Wagner', TIMESTAMP '2026-09-09 14:00'),
    ('Wagner', TIMESTAMP '2026-09-09 14:20'),
    ('Wagner', TIMESTAMP '2026-09-09 14:40'),
    ('Wagner', TIMESTAMP '2026-09-09 15:00'),
    ('Wagner', TIMESTAMP '2026-09-09 15:20'),
    ('Wagner', TIMESTAMP '2026-09-09 15:40'),
    ('Wagner', TIMESTAMP '2026-09-09 16:00'),
    ('Wagner', TIMESTAMP '2026-09-11 09:00'),
    ('Wagner', TIMESTAMP '2026-09-11 09:20'),
    ('Wagner', TIMESTAMP '2026-09-11 09:40'),
    ('Wagner', TIMESTAMP '2026-09-11 10:00'),
    ('Wagner', TIMESTAMP '2026-09-11 10:20'),
    ('Wagner', TIMESTAMP '2026-09-11 10:40'),
    ('Wagner', TIMESTAMP '2026-09-11 11:00'),
    ('Wagner', TIMESTAMP '2026-09-11 11:20'),
    ('Danilo', TIMESTAMP '2026-09-08 14:00'),
    ('Danilo', TIMESTAMP '2026-09-09 09:00'),
    ('Danilo', TIMESTAMP '2026-09-10 10:40'),
    ('Danilo', TIMESTAMP '2026-09-10 15:40'),
    ('Danilo', TIMESTAMP '2026-09-10 16:40'),
    ('Danilo', TIMESTAMP '2026-09-11 14:00'),
    ('Danilo', TIMESTAMP '2026-09-11 16:00'),
    ('Danilo', TIMESTAMP '2026-09-11 16:20'),
    ('Danilo', TIMESTAMP '2026-09-11 16:40'),
    ('Deison', TIMESTAMP '2026-09-09 14:20'),
    ('Deison', TIMESTAMP '2026-09-09 15:00'),
    ('Deison', TIMESTAMP '2026-09-09 15:20'),
    ('Deison', TIMESTAMP '2026-09-09 15:40'),
    ('Deison', TIMESTAMP '2026-09-11 14:20'),
    ('Deison', TIMESTAMP '2026-09-11 15:00'),
    ('Deison', TIMESTAMP '2026-09-11 15:20'),
    ('Deison', TIMESTAMP '2026-09-11 15:40')
)
INSERT INTO doctor_availability (
  id,
  doctor_id,
  starts_at,
  ends_at,
  status,
  source
)
SELECT
  md5(doctors.id::text || slots.starts_local::text)::uuid,
  doctors.id,
  slots.starts_local AT TIME ZONE 'America/Sao_Paulo',
  (slots.starts_local + INTERVAL '20 minutes') AT TIME ZONE 'America/Sao_Paulo',
  'available',
  'import'
FROM slots
JOIN doctors ON doctors.name = slots.doctor_name
ON CONFLICT (doctor_id, starts_at) DO NOTHING;
