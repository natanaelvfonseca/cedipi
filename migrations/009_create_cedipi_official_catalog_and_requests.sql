-- Source of truth imported from six verified clinic-owned DOCX files.
-- The sensitive documents and payment details are NEVER stored in source control.
CREATE TABLE cedipi_official_documents (
  source_number SMALLINT PRIMARY KEY CHECK (source_number BETWEEN 1 AND 6),
  filename TEXT NOT NULL,
  source_sha256 VARCHAR(64) NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  content TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE cedipi_exam_catalog (
  code TEXT PRIMARY KEY,
  name VARCHAR(300) NOT NULL UNIQUE,
  category VARCHAR(30) NOT NULL CHECK (category IN ('ultrasound','procedure')),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  duration_minutes INTEGER CHECK (duration_minutes > 0 AND duration_minutes <= 240),
  doctor_names TEXT[] NOT NULL,
  preparation TEXT,
  notes TEXT,
  medical_approval BOOLEAN NOT NULL DEFAULT FALSE,
  doctor_review BOOLEAN NOT NULL DEFAULT FALSE,
  add_on_only BOOLEAN NOT NULL DEFAULT FALSE,
  source_number SMALLINT NOT NULL REFERENCES cedipi_official_documents(source_number),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX cedipi_exams_search ON cedipi_exam_catalog
  USING GIN (to_tsvector('portuguese', name));

CREATE TABLE lara_booking_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(30) NOT NULL CHECK (phone ~ '^[0-9]{10,30}$'),
  exam_code TEXT NOT NULL REFERENCES cedipi_exam_catalog(code),
  preferred_date DATE,
  preferred_start TIMESTAMPTZ,
  doctor_name VARCHAR(100),
  patient_name VARCHAR(255),
  status VARCHAR(35) NOT NULL DEFAULT 'needs_verification'
    CHECK(status IN ('needs_verification','awaiting_medical_approval','awaiting_payment_proof','confirmed','cancelled','completed')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX lara_requests_review_idx ON lara_booking_requests(status,created_at DESC);

CREATE TABLE lara_conversation_state (
  phone VARCHAR(30) PRIMARY KEY CHECK (phone ~ '^[0-9]{10,30}$'),
  state VARCHAR(30) NOT NULL DEFAULT 'idle'
    CHECK (state IN ('idle','awaiting_exam','awaiting_date','awaiting_slot','awaiting_name','awaiting_confirmation')),
  exam_code TEXT REFERENCES cedipi_exam_catalog(code),
  selected_day DATE,
  selected_start TIMESTAMPTZ,
  selected_doctor_name TEXT,
  offered_options JSONB,
  patient_name VARCHAR(255),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
