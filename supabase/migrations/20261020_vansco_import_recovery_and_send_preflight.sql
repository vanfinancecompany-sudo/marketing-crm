
-- Vansco-only import recovery, metadata retention and conservative frequency preflight.
-- Existing customer permission, shared CRM, VFC and R2B tables are not modified.
alter table public.marketing_vansco_email_contacts
  add column if not exists company text,
  add column if not exists pipeline text,
  add column if not exists tags text,
  add column if not exists notes text,
  add column if not exists brand text,
  add column if not exists verifalia_classification text,
  add column if not exists verifalia_status text,
  add column if not exists imported_at timestamptz default now();

-- Incoming legacy imports are only candidates for marketing permission assessment.
alter table public.marketing_vansco_email_contacts drop constraint if exists marketing_vansco_email_contacts_marketing_basis_check;
alter table public.marketing_vansco_email_contacts add constraint marketing_vansco_email_contacts_marketing_basis_check
 check (marketing_basis in ('unverified','consent','legitimate_interest'));

create table if not exists public.marketing_vansco_email_import_jobs (
 id uuid primary key default gen_random_uuid(),
 fingerprint text not null unique,
 filename text not null,
 total_rows integer not null check (total_rows >= 0),
 processed_rows integer not null default 0 check (processed_rows >= 0),
 newly_imported integer not null default 0,
 already_existing integer not null default 0,
 invalid_rows integer not null default 0,
 suppressed_rows integer not null default 0,
 status text not null default 'in_progress' check(status in ('in_progress','complete','failed')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.marketing_vansco_email_import_jobs enable row level security;
revoke all on public.marketing_vansco_email_import_jobs from public, anon, authenticated;

create or replace view public.marketing_vansco_email_eligibility as
select c.id,c.email_normalized,c.status,c.source,c.marketing_basis,c.reviewed_at,c.permission_notes,
 h.attempted_7d,h.attempted_30d,h.attempted_this_month,h.last_attempt_at,
 (c.status='suppressed' or blocks.globally_blocked or blocks.legacy_blocked) as suppressed,
 (
  c.status='ready' and c.reviewed_at is not null
  and length(coalesce(c.permission_notes,''))>=15
  and c.marketing_basis in ('consent','legitimate_interest')
  and lower(coalesce(c.verifalia_classification,''))='deliverable'
  and c.email_normalized ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  and not blocks.globally_blocked and not blocks.legacy_blocked
  and h.attempted_7d=0 and h.attempted_30d<4 and h.attempted_this_month<4
 ) as eligible
from public.marketing_vansco_email_contacts c
cross join lateral (
 select count(*) filter (where s.created_at>now()-interval '7 days')::integer as attempted_7d,
 count(*) filter (where s.created_at>now()-interval '30 days')::integer as attempted_30d,
 count(*) filter (where s.created_at>=date_trunc('month',now()))::integer as attempted_this_month,
 max(s.created_at) as last_attempt_at
 from public.marketing_vansco_email_sends s
 where s.email_normalized=c.email_normalized and s.send_type='production' and s.status<>'skipped'
) h
cross join lateral (
 select
 exists(select 1 from public.marketing_suppression_identities g where g.email_normalized=c.email_normalized) as globally_blocked,
 exists(select 1 from public.marketing_contacts m where m.email_normalized=c.email_normalized
  and (m.marketing_status is distinct from 'active'
    or m.lifecycle_status is distinct from 'active'
    or coalesce((m.suppression->'email_unsubscribed'->>'active')::boolean,false)
    or coalesce((m.suppression->'email_bounced'->>'active')::boolean,false)
    or coalesce((m.suppression->'manual_suppression'->>'active')::boolean,false)
    or coalesce((m.suppression->'global_do_not_contact'->>'active')::boolean,false))
 ) as legacy_blocked
) blocks;

create or replace function public.vansco_email_audience_summary()
returns jsonb language sql stable set search_path='public'
as $$
select jsonb_build_object(
 'total',count(*),'approved',count(*) filter(where status='ready'),
 'pending_review',count(*) filter(where status='pending_review'),
 'suppressed',count(*) filter(where suppressed),
 'risky',count(*) filter(where lower(coalesce(c.verifalia_classification,''))='risky'),
 'unverified_delivery',count(*) filter(where coalesce(c.verifalia_classification,'')=''),
 'locked_7d',count(*) filter(where e.status='ready' and not suppressed and attempted_7d>0),
 'monthly_cap',count(*) filter(where e.status='ready' and not suppressed and attempted_7d=0 and (attempted_30d>=4 or attempted_this_month>=4)),
 'eligible',count(*) filter(where eligible),'remaining',count(*) filter(where eligible),
 'queued',count(*) filter(where exists(select 1 from public.marketing_vansco_email_sends s where s.contact_id=e.id and s.send_type='production' and s.status in ('queued','attempting')))
) from public.marketing_vansco_email_eligibility e
join public.marketing_vansco_email_contacts c on c.id=e.id;
$$;

-- Atomic final check. Locks the contact, excluding only the already-claimed current send.
create or replace function public.vansco_email_preflight_claim(p_send uuid)
returns boolean language plpgsql set search_path='public' as $$
declare v_send public.marketing_vansco_email_sends%rowtype;
v_contact public.marketing_vansco_email_contacts%rowtype;
v_7d integer;v_30d integer;v_month integer;
begin
 select * into v_send from public.marketing_vansco_email_sends where id=p_send and send_type='production' and status='attempting';
 if not found then return false; end if;
 select * into v_contact from public.marketing_vansco_email_contacts where id=v_send.contact_id for update;
 if not found or v_contact.email_normalized<>v_send.email_normalized
    or v_contact.status<>'ready' or v_contact.reviewed_at is null
    or length(coalesce(v_contact.permission_notes,''))<15
    or v_contact.marketing_basis not in ('consent','legitimate_interest')
    or lower(coalesce(v_contact.verifalia_classification,''))<>'deliverable' then return false; end if;
 if exists(select 1 from public.marketing_suppression_identities where email_normalized=v_send.email_normalized) then return false; end if;
 if exists(select 1 from public.marketing_contacts m where m.email_normalized=v_send.email_normalized
  and (m.marketing_status is distinct from 'active' or m.lifecycle_status is distinct from 'active'
  or coalesce((m.suppression->'email_unsubscribed'->>'active')::boolean,false)
  or coalesce((m.suppression->'email_bounced'->>'active')::boolean,false)
  or coalesce((m.suppression->'manual_suppression'->>'active')::boolean,false)
  or coalesce((m.suppression->'global_do_not_contact'->>'active')::boolean,false))) then return false; end if;
 select count(*) filter(where created_at>now()-interval '7 days')::integer,
        count(*) filter(where created_at>now()-interval '30 days')::integer,
        count(*) filter(where created_at>=date_trunc('month',now()))::integer
 into v_7d,v_30d,v_month
 from public.marketing_vansco_email_sends where email_normalized=v_send.email_normalized and send_type='production' and status<>'skipped' and id<>p_send;
 return v_7d=0 and v_30d<4 and v_month<4;
end;
$$;
revoke all on function public.vansco_email_preflight_claim(uuid) from public,anon,authenticated;
revoke all on function public.vansco_email_audience_summary() from public,anon,authenticated;
