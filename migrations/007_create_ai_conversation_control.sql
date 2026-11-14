-- Persistent per-patient Lara overrides (no n8n / Redis).
CREATE TABLE ai_conversation_control (
  phone VARCHAR(30) PRIMARY KEY CHECK (phone ~ '^[0-9]{10,30}$'),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
