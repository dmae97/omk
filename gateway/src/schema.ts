export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  label text NOT NULL,
  plan text NOT NULL DEFAULT 'A',
  allow_max_effort boolean NOT NULL DEFAULT false,
  allowed_models jsonb,
  monthly_cap_override bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS api_keys (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS usage_events (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  key_id text NOT NULL,
  request_id text NOT NULL,
  ts_start timestamptz NOT NULL,
  ts_end timestamptz NOT NULL,
  month text NOT NULL,
  model_public text NOT NULL,
  model_upstream text NOT NULL,
  stream boolean NOT NULL,
  prompt_tokens integer NOT NULL,
  cache_hit_tokens integer NOT NULL,
  cache_miss_tokens integer NOT NULL,
  completion_tokens integer NOT NULL,
  reasoning_tokens integer NOT NULL,
  answer_tokens integer NOT NULL,
  total_tokens integer NOT NULL,
  finish_reason text,
  peak boolean NOT NULL,
  price_table_version text NOT NULL,
  billed_cost_nano_usd bigint NOT NULL,
  upstream_cost_nano_usd bigint NOT NULL,
  estimated boolean NOT NULL DEFAULT false,
  end_reason text NOT NULL,
  usage_anomaly boolean NOT NULL DEFAULT false,
  upstream_usage_json jsonb
);
CREATE INDEX IF NOT EXISTS usage_events_user_month ON usage_events(user_id, month);
CREATE TABLE IF NOT EXISTS usage_monthly (
  user_id text NOT NULL,
  month text NOT NULL,
  tokens bigint NOT NULL DEFAULT 0,
  reasoning_tokens bigint NOT NULL DEFAULT 0,
  billed_cost_nano_usd bigint NOT NULL DEFAULT 0,
  upstream_cost_nano_usd bigint NOT NULL DEFAULT 0,
  requests integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);
CREATE TABLE IF NOT EXISTS reservations (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  month text NOT NULL,
  tokens bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS denied_events (
  id text PRIMARY KEY,
  ts timestamptz NOT NULL,
  user_id text,
  key_id text,
  request_id text NOT NULL,
  code text NOT NULL,
  model text
);
CREATE TABLE IF NOT EXISTS polar_outbox (
  id bigserial PRIMARY KEY,
  external_id text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
`;
