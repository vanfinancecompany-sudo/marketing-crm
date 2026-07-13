-- Marketing CRM Brevo email sending foundation
-- Additive only. Do not apply until PR review approves production email infrastructure.

create extension if not exists pgcrypto;

create table if not exists public.marketing_email_sends (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marketing_campaigns(id),
  send_type text not null check (send_type in ('test', 'production')),
  status text not null default 'preparing'
    check (status in ('preparing', 'sending', 'completed', 'partially_failed', 'failed', 'cancelled')),
  provider text not null default 'brevo' check (provider in ('brevo')),
  requested_count integer not null default 0 check (requested_count >= 0),
  eligible_count integer not null default 0 check (eligible_count >= 0),
  suppressed_count integer not null default 0 check (suppressed_count >= 0),
  sent_count integer not null default 0 check (sent_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  skipped_duplicate_count integer not null default 0 check (skipped_duplicate_count >= 0),
  created_by text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  confirmation_token_hash text,
  frozen_subject text not null default '',
  frozen_preview_text text not null default '',
  frozen_html_hash text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  error_summary text,
  constraint marketing_email_sends_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.marketing_email_send_recipients (
  id uuid primary key default gen_random_uuid(),
  send_id uuid not null references public.marketing_email_sends(id) on delete cascade,
  campaign_id uuid not null references public.marketing_campaigns(id),
  send_type text not null check (send_type in ('test', 'production')),
  customer_id text,
  email text not null,
  status text not null default 'pending'
    check (status in (
      'pending',
      'accepted',
      'sent',
      'delivered',
      'opened',
      'clicked',
      'soft_bounced',
      'hard_bounced',
      'blocked',
      'complained',
      'unsubscribed',
      'failed',
      'skipped_suppressed',
      'skipped_duplicate'
    )),
  provider_message_id text,
  provider_event_id text,
  failure_reason text,
  first_sent_at timestamptz,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint marketing_email_send_recipients_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

drop trigger if exists marketing_email_sends_set_updated_at on public.marketing_email_sends;
create trigger marketing_email_sends_set_updated_at
before update on public.marketing_email_sends
for each row execute function public.set_marketing_updated_at();

drop trigger if exists marketing_email_send_recipients_set_updated_at on public.marketing_email_send_recipients;
create trigger marketing_email_send_recipients_set_updated_at
before update on public.marketing_email_send_recipients
for each row execute function public.set_marketing_updated_at();

create index if not exists marketing_email_sends_campaign_id_idx
  on public.marketing_email_sends (campaign_id);

create index if not exists marketing_email_sends_type_status_idx
  on public.marketing_email_sends (send_type, status);

create index if not exists marketing_email_sends_created_at_idx
  on public.marketing_email_sends (created_at desc);

create index if not exists marketing_email_send_recipients_send_id_idx
  on public.marketing_email_send_recipients (send_id);

create index if not exists marketing_email_send_recipients_campaign_id_idx
  on public.marketing_email_send_recipients (campaign_id);

create index if not exists marketing_email_send_recipients_customer_id_idx
  on public.marketing_email_send_recipients (customer_id);

create index if not exists marketing_email_send_recipients_email_idx
  on public.marketing_email_send_recipients (lower(email));

create index if not exists marketing_email_send_recipients_status_idx
  on public.marketing_email_send_recipients (status);

create index if not exists marketing_email_send_recipients_provider_message_id_idx
  on public.marketing_email_send_recipients (provider_message_id)
  where provider_message_id is not null;

create unique index if not exists marketing_email_send_recipients_one_production_delivery_idx
  on public.marketing_email_send_recipients (campaign_id, customer_id)
  where send_type = 'production'
    and customer_id is not null
    and status in ('pending', 'accepted', 'sent', 'delivered', 'opened', 'clicked');

alter table public.marketing_email_sends enable row level security;
alter table public.marketing_email_send_recipients enable row level security;

-- No permissive public policies are created here.
-- Protected Vercel API routes use the Supabase service-role key.
