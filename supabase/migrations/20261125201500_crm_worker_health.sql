-- Latest receipt per scheduled worker; never stores customer payloads.
create table if not exists public.crm_worker_health (
 worker_key text primary key,
 started_at timestamptz not null,
 completed_at timestamptz not null,
 last_success_at timestamptz,
 outcome text not null check(outcome in ('success','failed','warning','idle','disabled')),
 http_status integer not null,
 detail text not null
);
alter table public.crm_worker_health enable row level security;
revoke all on public.crm_worker_health from public, anon, authenticated;
grant select,insert,update on public.crm_worker_health to service_role;
create or replace function public.record_crm_worker_health(
 p_worker_key text,p_started_at timestamptz,p_completed_at timestamptz,
 p_outcome text,p_http_status integer,p_detail text
) returns void language sql security invoker set search_path = '' as $$
 insert into public.crm_worker_health as h(worker_key,started_at,completed_at,last_success_at,outcome,http_status,detail)
 values(p_worker_key,p_started_at,p_completed_at,case when p_outcome='success' then p_completed_at else null end,p_outcome,p_http_status,left(p_detail,300))
 on conflict(worker_key) do update set
 started_at=excluded.started_at,completed_at=excluded.completed_at,last_success_at=coalesce(excluded.last_success_at,h.last_success_at),
 outcome=excluded.outcome,http_status=excluded.http_status,detail=excluded.detail
 where excluded.started_at>=h.started_at;
$$;
revoke all on function public.record_crm_worker_health(text,timestamptz,timestamptz,text,integer,text) from public, anon, authenticated;
grant execute on function public.record_crm_worker_health(text,timestamptz,timestamptz,text,integer,text) to service_role;
