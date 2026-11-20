create table public.dealerkit_publish_recovery_audit (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  registration text not null,
  product text not null check (product in ('finance', 'rent2buy', 'cars')),
  event text not null check (event in (
    'approved', 'verified', 'failed', 'publish_started', 'record_reconciled',
    'status_started', 'status_verified', 'status_rejected', 'publish_verified', 'publish_interrupted'
  )),
  approval text check (approval ~ '^[a-f0-9]{64}$'),
  details jsonb not null,
  check (event not in ('approved', 'verified', 'failed', 'status_started', 'status_verified', 'status_rejected') or approval is not null)
);

alter table public.dealerkit_publish_recovery_audit enable row level security;
revoke all on table public.dealerkit_publish_recovery_audit from public, anon, authenticated, service_role;
grant select, insert on table public.dealerkit_publish_recovery_audit to service_role;

create unique index dealerkit_publish_recovery_claim
  on public.dealerkit_publish_recovery_audit (approval)
  where event in ('approved', 'status_started');

create index dealerkit_publish_recovery_history
  on public.dealerkit_publish_recovery_audit (registration, product, occurred_at desc);


create table public.dealerkit_publish_leases (
  registration text primary key,
  owner uuid not null,
  expires_at timestamptz not null
);

alter table public.dealerkit_publish_leases enable row level security;
revoke all on table public.dealerkit_publish_leases from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.dealerkit_publish_leases to service_role;

-- The lease outlasts a single Vercel function execution. An abandoned
-- lease can be replaced, and a delayed request can only release its own.
create function public.dealerkit_acquire_publish_lease(p_registration text, p_owner uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with claim as (
    insert into public.dealerkit_publish_leases as lease (registration, owner, expires_at)
    values (p_registration, p_owner, clock_timestamp() + interval '15 minutes')
    on conflict (registration) do update
      set owner = excluded.owner, expires_at = excluded.expires_at
      where lease.expires_at <= clock_timestamp()
    returning 1
  )
  select exists (select 1 from claim);
$$;

revoke all on function public.dealerkit_acquire_publish_lease(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.dealerkit_acquire_publish_lease(text, uuid) to service_role;
