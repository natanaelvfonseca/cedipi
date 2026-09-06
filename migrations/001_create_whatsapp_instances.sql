CREATE TABLE whatsapp_instances (
  id UUID PRIMARY KEY,
  provider VARCHAR(50) NOT NULL DEFAULT 'evolution',
  instance_name VARCHAR(255) NOT NULL UNIQUE,
  external_instance_id VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'unknown',
  phone_number VARCHAR(50),
  profile_name VARCHAR(255),
  integration_type VARCHAR(100),
  last_checked_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ,
  disconnected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
