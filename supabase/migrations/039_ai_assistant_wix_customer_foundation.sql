-- Phase 1 Wix customer integration foundation.
-- Server-only anonymous sessions and rate-limit counters; no customer/application records.

create table if not exists public.ai_customer_sessions (
  id uuid primary key default gen_random_uuid(),
  public_token_hash text not null unique,
  page_type text not null check (page_type in ('finance_vehicle', 'finance_general', 'rent2buy_general', 'homepage')),
  product_lock text check (product_lock in ('finance', 'rent2buy')),
  vehicle_context jsonb not null default '{}'::jsonb check (jsonb_typeof(vehicle_context) = 'object'),
  conversation_history jsonb not null default '[]'::jsonb check (jsonb_typeof(conversation_history) = 'array'),
  remembered_facts jsonb not null default '{}'::jsonb check (jsonb_typeof(remembered_facts) = 'object'),
  journey_state jsonb not null default '{}'::jsonb check (jsonb_typeof(journey_state) = 'object'),
  application_readiness text,
  budget text,
  employment text,
  message_count integer not null default 0 check (message_count between 0 and 100),
  last_competence_result_id uuid references public.knowledge_competence_results(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'closed', 'expired')),
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists ai_customer_sessions_active_expiry_idx
  on public.ai_customer_sessions (expires_at)
  where status = 'active';

create table if not exists public.ai_assistant_rate_limits (
  key_hash text not null,
  scope text not null check (scope in ('minute', 'day')),
  window_start timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (key_hash, scope, window_start)
);

create index if not exists ai_assistant_rate_limits_cleanup_idx
  on public.ai_assistant_rate_limits (window_start);

alter table public.ai_customer_sessions enable row level security;
alter table public.ai_assistant_rate_limits enable row level security;

revoke all on table public.ai_customer_sessions from anon, authenticated;
revoke all on table public.ai_assistant_rate_limits from anon, authenticated;

create or replace function public.consume_ai_assistant_rate_limit(
  p_key_hash text,
  p_scope text,
  p_window_start timestamptz,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  next_count integer;
begin
  if p_scope not in ('minute', 'day') or p_limit < 1 or length(coalesce(p_key_hash, '')) < 32 then
    return false;
  end if;

  insert into public.ai_assistant_rate_limits (key_hash, scope, window_start, request_count)
  values (p_key_hash, p_scope, p_window_start, 1)
  on conflict (key_hash, scope, window_start)
  do update set
    request_count = public.ai_assistant_rate_limits.request_count + 1,
    updated_at = now()
  returning request_count into next_count;

  return next_count <= p_limit;
end;
$$;

revoke all on function public.consume_ai_assistant_rate_limit(text, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_assistant_rate_limit(text, text, timestamptz, integer) to service_role;

comment on table public.ai_customer_sessions is
  'Anonymous, expiring website assistant state. Contains no application or customer contact record.';

comment on table public.ai_assistant_rate_limits is
  'Hashed server-side abuse-prevention counters for the public AI assistant endpoint.';
