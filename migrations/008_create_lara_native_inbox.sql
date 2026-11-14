-- Lara native: durable ingestion, single-conversation leases and knowledge.
CREATE TABLE lara_inbound_messages (
  id BIGSERIAL PRIMARY KEY,
  instance_name VARCHAR(100) NOT NULL,
  message_id VARCHAR(200) NOT NULL,
  phone VARCHAR(30) NOT NULL CHECK (phone ~ '^[0-9]{10,30}$'),
  remote_jid TEXT NOT NULL,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4096),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','sending','sent','manual_review')),
  claim_id UUID,
  attempts INTEGER NOT NULL DEFAULT 0,
  response_text TEXT,
  outbound_id TEXT,
  failure_code VARCHAR(80),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE (instance_name, message_id)
);
CREATE INDEX lara_inbound_pending_phone ON lara_inbound_messages (phone, received_at)
  WHERE status = 'pending';
CREATE INDEX lara_inbound_sent_at ON lara_inbound_messages (processed_at)
  WHERE processed_at IS NOT NULL;

CREATE TABLE lara_conversation_jobs (
  phone VARCHAR(30) PRIMARY KEY CHECK (phone ~ '^[0-9]{10,30}$'),
  run_after TIMESTAMPTZ NOT NULL,
  lease_id UUID,
  lease_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX lara_jobs_due ON lara_conversation_jobs (run_after, lease_until);

CREATE TABLE lara_history (
  id BIGSERIAL PRIMARY KEY,
  phone VARCHAR(30) NOT NULL,
  role VARCHAR(12) NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4096),
  inbound_id BIGINT UNIQUE REFERENCES lara_inbound_messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX lara_history_phone ON lara_history (phone, id DESC);

CREATE TABLE lara_knowledge_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 40000),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX lara_knowledge_search_idx ON lara_knowledge_sources
  USING GIN (to_tsvector('portuguese', content));

CREATE TABLE lara_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(30) NOT NULL,
  reason VARCHAR(80) NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX lara_handoff_one_open_per_phone ON lara_handoffs(phone) WHERE status = 'open';
