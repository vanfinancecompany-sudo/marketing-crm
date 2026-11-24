-- Conversations & AI monitoring centre (24 Nov 2026). Additive only.
-- Written by the CRM's server functions with the service role; never exposed
-- to the browser directly (row level security on, no policies).

-- Latest heartbeat / status snapshot per channel (pushed by the local
-- Facebook Marketplace assistant; the hosted CRM cannot reach localhost).
create table if not exists public.conversation_channel_status (
  channel text primary key check (channel in ('facebook_marketplace', 'facebook_page', 'whatsapp')),
  last_heartbeat_at timestamptz,
  status jsonb not null default '{}'::jsonb check (jsonb_typeof(status) = 'object'),
  updated_at timestamptz not null default now()
);

-- Conversation activity reported by channels, and failures recorded by Ask Me.
-- source_id makes repeated pushes idempotent. Excerpts are short and redacted.
create table if not exists public.conversation_events (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('facebook_marketplace', 'facebook_page', 'whatsapp', 'ask_me')),
  source_id text not null unique,
  kind text not null check (kind in ('received', 'answered', 'needs_human', 'send_failed', 'ai_failed')),
  occurred_at timestamptz not null,
  product text check (product in ('finance', 'rent2buy')),
  conversation_ref text,
  question_excerpt text,
  reply_excerpt text,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists conversation_events_occurred_idx on public.conversation_events (occurred_at desc);
create index if not exists conversation_events_channel_kind_idx on public.conversation_events (channel, kind, occurred_at desc);

-- Monitor alerts, one row per problem (fingerprint) so alerts never duplicate.
create table if not exists public.conversation_monitor_alerts (
  fingerprint text primary key,
  channel text not null,
  severity text not null check (severity in ('critical', 'warning', 'info')),
  title text not null,
  detail text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  occurrences integer not null default 1,
  emailed_at timestamptz,
  recovery_emailed_at timestamptz
);
create index if not exists conversation_monitor_alerts_status_idx on public.conversation_monitor_alerts (status, last_seen_at desc);

alter table public.conversation_channel_status enable row level security;
alter table public.conversation_events enable row level security;
alter table public.conversation_monitor_alerts enable row level security;
