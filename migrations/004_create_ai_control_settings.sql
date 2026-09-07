CREATE TABLE ai_control_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  global_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO ai_control_settings (id, global_enabled)
VALUES (1, TRUE)
ON CONFLICT (id) DO NOTHING;
