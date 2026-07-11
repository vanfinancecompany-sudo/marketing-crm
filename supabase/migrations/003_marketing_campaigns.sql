-- Marketing CRM campaign management foundation
-- Additive only: does not modify existing customer or CRM tables.

create extension if not exists pgcrypto;

create or replace function public.set_marketing_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  description text not null default '',
  channel text not null check (channel in ('email', 'sms', 'facebook')),
  objective text not null check (objective in ('new_stock', 'promotion', 'finance_offer', 'rent2buy', 're_engagement', 'custom')),
  status text not null default 'draft' check (status in ('draft', 'ready', 'running', 'paused', 'completed', 'archived')),
  tags text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (
    (status = 'archived' and archived_at is not null)
    or (status <> 'archived' and archived_at is null)
  )
);

drop trigger if exists marketing_campaigns_set_updated_at on public.marketing_campaigns;
create trigger marketing_campaigns_set_updated_at
before update on public.marketing_campaigns
for each row execute function public.set_marketing_updated_at();

create index if not exists marketing_campaigns_updated_at_idx
  on public.marketing_campaigns (updated_at desc);

create index if not exists marketing_campaigns_created_at_idx
  on public.marketing_campaigns (created_at desc);

create index if not exists marketing_campaigns_status_idx
  on public.marketing_campaigns (status);

create index if not exists marketing_campaigns_channel_idx
  on public.marketing_campaigns (channel);

create index if not exists marketing_campaigns_objective_idx
  on public.marketing_campaigns (objective);

create index if not exists marketing_campaigns_tags_gin_idx
  on public.marketing_campaigns using gin (tags);

alter table public.marketing_campaigns enable row level security;

-- No permissive public policies are created here.
-- The app accesses this table through protected server-side API routes.