-- Marketing CRM Brevo webhook events and campaign reporting foundation
-- Additive only. Do not apply until PR review approves the reporting infrastructure.

create extension if not exists pgcrypto;

create table if not exists public.marketing_email_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'brevo' check (provider in ('brevo')),
  provider_event_id text not null,
  provider_message_id text,
  campaign_id uuid references public.marketing_campaigns(id) on delete set null,
  send_id uuid references public.marketing_email_sends(id) on delete set null,
  recipient_id uuid references public.marketing_email_send_recipients(id) on delete set null,
  customer_id text,
  email_normalized text,
  event_type text not null check (event_type in (
    'accepted',
    'delivered',
    'opened',
    'clicked',
    'soft_bounce',
    'hard_bounce',
    'deferred',
    'complaint',
    'unsubscribed',
    'blocked',
    'invalid_email',
    'error',
    'unknown'
  )),
  event_at timestamptz not null default now(),
  link_url text,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint marketing_email_events_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

alter table public.marketing_email_send_recipients
  add column if not exists delivered_at timestamptz,
  add column if not exists opened_at timestamptz,
  add column if not exists clicked_at timestamptz,
  add column if not exists soft_bounced_at timestamptz,
  add column if not exists hard_bounced_at timestamptz,
  add column if not exists complained_at timestamptz,
  add column if not exists unsubscribed_at timestamptz,
  add column if not exists blocked_at timestamptz,
  add column if not exists deferred_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists last_event_type text,
  add column if not exists last_event_reason text;

create unique index if not exists marketing_email_events_provider_event_id_uidx
  on public.marketing_email_events (provider, provider_event_id);

create index if not exists marketing_email_events_campaign_id_idx
  on public.marketing_email_events (campaign_id, event_at desc);

create index if not exists marketing_email_events_send_id_idx
  on public.marketing_email_events (send_id, event_at desc);

create index if not exists marketing_email_events_recipient_id_idx
  on public.marketing_email_events (recipient_id, event_at desc);

create index if not exists marketing_email_events_provider_message_id_idx
  on public.marketing_email_events (provider_message_id)
  where provider_message_id is not null;

create index if not exists marketing_email_events_type_time_idx
  on public.marketing_email_events (event_type, event_at desc);

create index if not exists marketing_email_events_link_url_idx
  on public.marketing_email_events (link_url)
  where link_url is not null;

alter table public.marketing_email_events enable row level security;

-- No permissive public policies are created here.
-- Protected Vercel API routes use the Supabase service-role key.
-- The Brevo webhook endpoint is protected by a server-only webhook secret.