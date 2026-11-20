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
