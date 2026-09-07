CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(160) NOT NULL,
  email VARCHAR(320) NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT users_email_normalized CHECK (email = lower(btrim(email))),
  CONSTRAINT users_role_valid CHECK (role IN ('admin', 'attendant'))
);

CREATE UNIQUE INDEX users_email_unique_idx ON users (lower(email));
CREATE INDEX users_active_role_idx ON users (active, role);

CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_agent VARCHAR(500),
  ip_address INET
);

CREATE INDEX user_sessions_user_idx ON user_sessions (user_id);
CREATE INDEX user_sessions_expiry_idx ON user_sessions (expires_at);

CREATE TABLE auth_audit_log (
  id BIGSERIAL PRIMARY KEY,
  event VARCHAR(50) NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  subject_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ip_address INET,
  user_agent VARCHAR(500),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX auth_audit_log_created_idx ON auth_audit_log (created_at DESC);
CREATE INDEX auth_audit_log_actor_idx ON auth_audit_log (actor_user_id, created_at DESC);
