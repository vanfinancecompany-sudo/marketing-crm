-- Vansco Email Studio: read-only UK-day email submission totals for Content Operations.
-- No customer, message, provider or existing VFC/R2B send records are modified.
-- Tracking-only by default; an explicit daily target can be configured later.
alter table public.marketing_daily_target_schedules
  add column if not exists vansco_emails_sent integer not null default 0
  check (vansco_emails_sent >= 0);
alter table public.marketing_daily_target_overrides
  add column if not exists vansco_emails_sent integer not null default 0
  check (vansco_emails_sent >= 0);

-- Production only, confirmed provider IDs only. A later webhook update
-- (delivered/opened/clicked/bounced) must not remove an already sent email
-- from the historical total. Queued/skipped/unknown/internal tests are excluded.
create or replace function public.vansco_email_daily_sent_counts(
  p_start_date date, p_end_date date
) returns table(activity_date date, sent_count bigint)
language sql stable security invoker set search_path='public' as $$
  select (s.created_at at time zone 'Europe/London')::date as activity_date,
         count(distinct s.id)::bigint as sent_count
  from public.marketing_vansco_email_sends s
  where p_start_date is not null and p_end_date is not null
    and p_end_date>=p_start_date and p_end_date-p_start_date<=365
    and s.created_at >= (p_start_date::timestamp at time zone 'Europe/London')
    and s.created_at < ((p_end_date+1)::timestamp at time zone 'Europe/London')
    and s.send_type='production'
    and s.provider_message_id is not null and s.provider_message_id<>''
    and s.status in ('accepted','sent','delivered','opened','clicked','bounced')
  group by (s.created_at at time zone 'Europe/London')::date
  order by activity_date;
$$;
revoke all on function public.vansco_email_daily_sent_counts(date,date) from PUBLIC, anon, authenticated;
grant execute on function public.vansco_email_daily_sent_counts(date,date) to service_role;
