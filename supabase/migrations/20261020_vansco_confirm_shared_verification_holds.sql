-- Allow a separately confirmed Vansco CRM relationship to clear only the shared
-- marketing CRM's "awaiting_verification" lifecycle hold.
-- Do NOT modify shared marketing_contacts, or any unsubscribes, bounces, DNCs,
-- other suppressions, or existing seven-day/monthly mailing limits.
alter table public.marketing_vansco_email_contacts
  add column if not exists vansco_verification_confirmed_at timestamptz;

create table if not exists public.marketing_vansco_verification_confirmations (
 id uuid primary key default gen_random_uuid(),
 confirmed_at timestamptz not null default now(),
 confirmed_count integer not null check (confirmed_count>=0),
 basis_statement text not null
);
alter table public.marketing_vansco_verification_confirmations enable row level security;
revoke all on public.marketing_vansco_verification_confirmations from PUBLIC,anon,authenticated;
grant select,insert on public.marketing_vansco_verification_confirmations to service_role;

create or replace view public.marketing_vansco_email_eligibility
with (security_invoker=true) as
select c.id,c.email_normalized,c.status,c.source,c.marketing_basis,c.reviewed_at,c.permission_notes,
 h.attempted_7d,h.attempted_30d,h.attempted_this_month,h.last_attempt_at,
 (c.status='suppressed' or blocks.globally_blocked or blocks.legacy_blocked) as suppressed,
 (c.status='ready'
    and c.reviewed_at is not null
    and length(coalesce(c.permission_notes,''))>=15
    and c.marketing_basis in ('consent','legitimate_interest')
    and lower(coalesce(c.verifalia_classification,'')) in ('deliverable','risky')
    and c.email_normalized ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and not blocks.globally_blocked and not blocks.legacy_blocked
    and h.attempted_7d=0 and h.attempted_30d<4 and h.attempted_this_month<4) as eligible
from public.marketing_vansco_email_contacts c
cross join lateral (
 select count(*) filter(where s.created_at>now()-interval '7 days')::integer as attempted_7d,
 count(*) filter(where s.created_at>now()-interval '30 days')::integer as attempted_30d,
 count(*) filter(where s.created_at>=date_trunc('month',now()))::integer as attempted_this_month,
 max(s.created_at) as last_attempt_at
 from public.marketing_vansco_email_sends s
 where s.email_normalized=c.email_normalized and s.send_type='production' and s.status <> 'skipped'
) h
cross join lateral (
 select
 exists(select 1 from public.marketing_suppression_identities g
   where g.email_normalized=c.email_normalized) as globally_blocked,
 exists(select 1 from public.marketing_contacts m
   where m.email_normalized=c.email_normalized
    and (m.marketing_status is distinct from 'active'
      or (
        m.lifecycle_status is distinct from 'active'
        and not (m.lifecycle_status='awaiting_verification'
                 and c.vansco_verification_confirmed_at is not null)
      )
      or coalesce((m.suppression->'email_unsubscribed'->>'active')::boolean,false)
      or coalesce((m.suppression->'email_bounced'->>'active')::boolean,false)
      or coalesce((m.suppression->'manual_suppression'->>'active')::boolean,false)
      or coalesce((m.suppression->'global_do_not_contact'->>'active')::boolean,false)
    )) as legacy_blocked
) blocks;
revoke all on public.marketing_vansco_email_eligibility from PUBLIC,anon,authenticated;
grant select on public.marketing_vansco_email_eligibility to service_role;

create or replace function public.vansco_email_verification_hold_summary()
returns jsonb language sql stable security invoker set search_path=public as $$
select jsonb_build_object(
 'pending',count(distinct c.id) filter(where c.vansco_verification_confirmed_at is null),
 'confirmed',count(distinct c.id) filter(where c.vansco_verification_confirmed_at is not null)
) from public.marketing_vansco_email_contacts c
join public.marketing_contacts m on m.email_normalized=c.email_normalized
where c.source in ('VANSCO','vansco_customer_export_20261012')
 and c.status='ready' and c.reviewed_at is not null
 and c.marketing_basis in ('consent','legitimate_interest')
 and lower(coalesce(c.verifalia_classification,'')) in ('deliverable','risky')
 and m.lifecycle_status='awaiting_verification'
 and m.marketing_status='active';
$$;
revoke all on function public.vansco_email_verification_hold_summary() from PUBLIC,anon,authenticated;
grant execute on function public.vansco_email_verification_hold_summary() to service_role;

create or replace function public.vansco_email_confirm_verification_holds(p_confirm boolean)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_count integer :=0;v_statement text :=
 'Authenticated Vansco Email Studio operator confirms that Vansco CRM customer/enquiry marketing permission has been established for these separately imported contacts. This does not affect unsubscribes, bounces or other shared suppressions.';
begin
 if p_confirm is distinct from true then
  raise exception 'Confirm the Vansco CRM marketing basis before lifting verification holds';
 end if;
 with cleared as (
  update public.marketing_vansco_email_contacts c
   set vansco_verification_confirmed_at=now(),updated_at=now()
  where c.source in ('VANSCO','vansco_customer_export_20261012')
    and c.vansco_verification_confirmed_at is null
    and c.status='ready'
    and c.reviewed_at is not null
    and length(coalesce(c.permission_notes,''))>=15
    and c.marketing_basis in ('consent','legitimate_interest')
    and lower(coalesce(c.verifalia_classification,'')) in ('deliverable','risky')
    and exists(select 1 from public.marketing_contacts m
      where m.email_normalized=c.email_normalized
      and m.lifecycle_status='awaiting_verification'
      and m.marketing_status='active')
    and not exists(select 1 from public.marketing_suppression_identities g
      where g.email_normalized=c.email_normalized)
    and not exists(select 1 from public.marketing_contacts m
      where m.email_normalized=c.email_normalized
      and (m.marketing_status is distinct from 'active'
       or m.lifecycle_status not in ('active','awaiting_verification')
       or m.lifecycle_status is null
       or coalesce((m.suppression->'email_unsubscribed'->>'active')::boolean,false)
       or coalesce((m.suppression->'email_bounced'->>'active')::boolean,false)
       or coalesce((m.suppression->'manual_suppression'->>'active')::boolean,false)
       or coalesce((m.suppression->'global_do_not_contact'->>'active')::boolean,false)))
  returning c.id
 )
 select count(*)::integer into v_count from cleared;
 if v_count>0 then
  insert into public.marketing_vansco_verification_confirmations(confirmed_count,basis_statement)
   values(v_count,v_statement);
 end if;
 return jsonb_build_object('confirmed',v_count,'unsubscribes_and_bounces_still_blocked',true);
end;
$$;
revoke all on function public.vansco_email_confirm_verification_holds(boolean) from PUBLIC,anon,authenticated;
grant execute on function public.vansco_email_confirm_verification_holds(boolean) to service_role;
