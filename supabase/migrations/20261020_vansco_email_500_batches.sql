-- Isolated Vansco-only mailing ledger and audience guards.
-- VFC/Rent2Buy customer sending and automated emails remain unchanged.
create table if not exists public.marketing_vansco_email_batches (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marketing_vansco_email_campaigns(id) on delete restrict,
  status text not null default 'queued'
    check (status in ('queued','sending','completed','paused','cancelled')),
  requested_count integer not null check (requested_count between 1 and 500),
  reserved_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists vansco_only_one_active_customer_batch
  on public.marketing_vansco_email_batches ((true))
  where status in ('queued','sending','paused');
create index if not exists vansco_batches_recent on public.marketing_vansco_email_batches(created_at desc);
alter table public.marketing_vansco_email_batches enable row level security;
revoke all on public.marketing_vansco_email_batches from PUBLIC, anon, authenticated;
grant select,insert,update,delete on public.marketing_vansco_email_batches to service_role;

alter table public.marketing_vansco_email_sends
  add column if not exists batch_id uuid references public.marketing_vansco_email_batches(id) on delete restrict;
alter table public.marketing_vansco_email_sends
  drop constraint if exists marketing_vansco_email_sends_status_check;
alter table public.marketing_vansco_email_sends
  add constraint marketing_vansco_email_sends_status_check
  check (status in ('queued','attempting','accepted','submission_unknown','failed',
   'delivered','opened','clicked','bounced','unsubscribed','complained','skipped'));
create index if not exists vansco_sends_batch_status_idx
  on public.marketing_vansco_email_sends(batch_id,status,created_at);
create index if not exists vansco_sends_identity_date_idx
  on public.marketing_vansco_email_sends(email_normalized,created_at desc)
  where send_type='production';

-- This view is service-role-only. The server checks shared suppression and reviewed
-- marketing permission before exposing aggregates or preparing any recipients.
create or replace view public.marketing_vansco_email_eligibility
with (security_invoker=true) as
select c.id,c.email_normalized,c.status,c.source,c.marketing_basis,c.reviewed_at,c.permission_notes,
  h.attempted_7d,h.attempted_30d,h.attempted_this_month,h.last_attempt_at,
  case when c.status='suppressed' or coalesce(blocks.globally_blocked,false)
    or coalesce(blocks.legacy_blocked,false) then true else false end as suppressed,
  case when c.status='ready' and c.reviewed_at is not null
    and length(coalesce(c.permission_notes,''))>=15
    and c.marketing_basis in ('consent','legitimate_interest')
    and c.email_normalized ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and not coalesce(blocks.globally_blocked,false)
    and not coalesce(blocks.legacy_blocked,false)
    and h.attempted_7d=0 and h.attempted_30d<4 and h.attempted_this_month<4
    then true else false end as eligible
from public.marketing_vansco_email_contacts c
cross join lateral (
 select
  count(*) filter (where s.created_at>now()-interval '7 days')::integer as attempted_7d,
  count(*) filter (where s.created_at>now()-interval '30 days')::integer as attempted_30d,
  count(*) filter (where s.created_at>=date_trunc('month',now()))::integer as attempted_this_month,
  max(s.created_at) as last_attempt_at
 from public.marketing_vansco_email_sends s
 where s.email_normalized=c.email_normalized and s.send_type='production'
   and s.status <> 'skipped'
) h
cross join lateral (
 select
   exists(select 1 from public.marketing_suppression_identities g
       where g.email_normalized=c.email_normalized) as globally_blocked,
   exists(select 1 from public.marketing_contacts m
       where m.email_normalized=c.email_normalized
       and (m.marketing_status <> 'active' or m.lifecycle_status <> 'active'
         or coalesce((m.suppression->'email_unsubscribed'->>'active')::boolean,false)
         or coalesce((m.suppression->'email_bounced'->>'active')::boolean,false)
         or coalesce((m.suppression->'manual_suppression'->>'active')::boolean,false)
         or coalesce((m.suppression->'global_do_not_contact'->>'active')::boolean,false)
       )) as legacy_blocked
) blocks;
revoke all on public.marketing_vansco_email_eligibility from PUBLIC,anon,authenticated;
grant select on public.marketing_vansco_email_eligibility to service_role;

create or replace function public.vansco_email_audience_summary()
returns jsonb
language sql stable security invoker
set search_path=public as $$
select jsonb_build_object(
 'total',count(*),
 'approved',count(*) filter(where status='ready'),
 'pending_review',count(*) filter(where status='pending_review'),
 'suppressed',count(*) filter(where suppressed),
 'locked_7d',count(*) filter(where status='ready' and not suppressed and attempted_7d>0),
 'monthly_cap',count(*) filter(where status='ready' and not suppressed and attempted_7d=0
   and (attempted_30d>=4 or attempted_this_month>=4)),
 'eligible',count(*) filter(where eligible),
 'remaining',count(*) filter(where eligible)
) from public.marketing_vansco_email_eligibility;
$$;
revoke all on function public.vansco_email_audience_summary() from PUBLIC,anon,authenticated;
grant execute on function public.vansco_email_audience_summary() to service_role;

-- An atomic 500-recipient reservation under row locks. No other brand's
-- contacts or histories are inserted/updated here.
create or replace function public.vansco_email_reserve_batch(p_campaign uuid,p_limit integer)
returns jsonb
language plpgsql security invoker
set search_path=public as $$
declare v_id uuid; v_count integer; v_status text;
begin
 if p_limit < 1 or p_limit>500 then raise exception 'Vansco batch must contain 1–500 recipients'; end if;
 select status into v_status from public.marketing_vansco_email_campaigns where id=p_campaign;
 if v_status is distinct from 'draft' then raise exception 'Select a saved Vansco campaign draft'; end if;
 insert into public.marketing_vansco_email_batches(campaign_id,requested_count)
   values(p_campaign,p_limit) returning id into v_id;
 with picked as (
   select c.id,c.email_normalized
   from public.marketing_vansco_email_contacts c
   join public.marketing_vansco_email_eligibility e on e.id=c.id
   where e.eligible
     and not exists(select 1 from public.marketing_vansco_email_sends s
       where s.campaign_id=p_campaign and s.contact_id=c.id and s.send_type='production')
   order by c.created_at,c.id
   limit p_limit
   for update of c skip locked
 ), inserted as (
   insert into public.marketing_vansco_email_sends
      (batch_id,campaign_id,contact_id,email_normalized,send_type,status)
   select v_id,p_campaign,p.id,p.email_normalized,'production','queued' from picked p
   on conflict do nothing returning id
 )
 select count(*) into v_count from inserted;
 if v_count=0 then
   delete from public.marketing_vansco_email_batches where id=v_id;
   return jsonb_build_object('queued',false,'reserved',0,'message','No eligible contacts remain for this saved campaign.');
 end if;
 update public.marketing_vansco_email_batches set reserved_count=v_count,updated_at=now() where id=v_id;
 return jsonb_build_object('queued',true,'batch_id',v_id,'reserved',v_count,'requested',p_limit);
end;
$$;
revoke all on function public.vansco_email_reserve_batch(uuid,integer) from PUBLIC,anon,authenticated;
grant execute on function public.vansco_email_reserve_batch(uuid,integer) to service_role;
