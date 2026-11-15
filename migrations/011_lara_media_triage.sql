-- Intake supports photographs and PDFs. Never store raw binary in Postgres.
ALTER TABLE lara_inbound_messages
  ADD COLUMN source_jid TEXT,
  ADD COLUMN media_kind VARCHAR(12)
  CHECK(media_kind IS NULL OR media_kind IN ('image','document','audio'));

CREATE TABLE lara_media_analyses (
  instance_name VARCHAR(100) NOT NULL,
  message_id VARCHAR(200) NOT NULL,
  phone VARCHAR(30) NOT NULL CHECK(phone ~ '^[0-9]{10,30}$'),
  media_type VARCHAR(10) NOT NULL CHECK(media_type IN ('image','pdf')),
  status VARCHAR(12) NOT NULL DEFAULT 'processing'
    CHECK(status IN ('processing','done','failed')),
  category VARCHAR(22) CHECK(category IN
    ('medical_order','payment_proof','other_document','unreadable')),
  summary TEXT CHECK(char_length(summary)<=900),
  exam_names TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  readable BOOLEAN,
  review_required BOOLEAN NOT NULL DEFAULT TRUE,
  failure_code VARCHAR(60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  analyzed_at TIMESTAMPTZ,
  PRIMARY KEY(instance_name,message_id)
);
CREATE INDEX lara_media_analyses_by_phone
  ON lara_media_analyses(phone,created_at DESC);
