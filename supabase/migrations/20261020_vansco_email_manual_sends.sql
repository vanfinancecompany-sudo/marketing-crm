-- Separate Vansco campaign sending and provider results; no changes to VFC CRM tables.
alter table public.marketing_vansco_email_contacts
  add column if not exists permission_notes text not null default '',
  add column if not exists reviewed_at timestamptz;

create table if not exists public.marketing_vansco_email_sends (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marketing_vansco_email_campaigns(id) on delete restrict,
  contact_id uuid references public.marketing_vansco_email_contacts(id) on delete restrict,
  email_normalized text not null,
  send_type text not null check (send_type in ('test', 'production')),
  status text not null check (status in ('attempting','accepted','submission_unknown','failed','delivered','opened','clicked','bounced','unsubscribed','complained')),
  provider_message_id text,
  failure_reason text,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((send_type='test' and contact_id is null) or (send_type='production' and contact_id is not null))
);
create unique index if not exists marketing_vansco_one_production_send_per_contact_campaign
  on public.marketing_vansco_email_sends(campaign_id, contact_id) where send_type='production';
create index if not exists marketing_vansco_sends_campaign_idx on public.marketing_vansco_email_sends(campaign_id, created_at desc);
create index if not exists marketing_vansco_sends_email_idx on public.marketing_vansco_email_sends(email_normalized);

create table if not exists public.marketing_vansco_email_events (
  id uuid primary key default gen_random_uuid(),
  send_id uuid not null references public.marketing_vansco_email_sends(id) on delete restrict,
  provider_event_id text not null unique,
  event_type text not null,
  event_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists marketing_vansco_events_send_idx on public.marketing_vansco_email_events(send_id);

alter table public.marketing_vansco_email_sends enable row level security;
alter table public.marketing_vansco_email_events enable row level security;
revoke all on public.marketing_vansco_email_sends from anon, authenticated;
revoke all on public.marketing_vansco_email_events from anon, authenticated;
grant select, insert, update on public.marketing_vansco_email_sends to service_role;
grant select, insert on public.marketing_vansco_email_events to service_role;
