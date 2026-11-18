create table public.marketing_crm_contact_receipts (
  delivery_key text primary key,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  receipt jsonb
);

create table public.marketing_crm_email_event_outbox (
  event_key text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  due_at timestamptz not null default now(),
  attempts integer not null default 0,
  claim_id uuid,
  status text not null default 'pending' check (status in ('pending','complete','needs_review')),
  last_error text
);
create index on public.marketing_crm_email_event_outbox(due_at) where status = 'pending';

alter table public.marketing_crm_contact_receipts enable row level security;
alter table public.marketing_crm_email_event_outbox enable row level security;
revoke all on public.marketing_crm_contact_receipts, public.marketing_crm_email_event_outbox
  from public, anon, authenticated;
grant select, insert, update on public.marketing_crm_contact_receipts, public.marketing_crm_email_event_outbox
  to service_role;

create function public.marketing_claim_crm_email_event(p_event_key text default null)
returns setof public.marketing_crm_email_event_outbox
language sql set search_path = '' as $$
  update public.marketing_crm_email_event_outbox
    set status = 'needs_review', claim_id = null, last_error = 'retry_limit_reached'
    where status = 'pending' and due_at <= now() and attempts >= 12
      and (p_event_key is null or event_key = p_event_key);
  update public.marketing_crm_email_event_outbox
    set attempts = attempts + 1, claim_id = gen_random_uuid(), due_at = now() + interval '1 minute'
    where event_key = (
      select event_key from public.marketing_crm_email_event_outbox
      where status = 'pending' and due_at <= now() and attempts < 12
        and (p_event_key is null or event_key = p_event_key)
      order by due_at, event_key for update skip locked limit 1
    )
    returning *;
$$;
revoke all on function public.marketing_claim_crm_email_event(text) from public, anon, authenticated;
grant execute on function public.marketing_claim_crm_email_event(text) to service_role;
