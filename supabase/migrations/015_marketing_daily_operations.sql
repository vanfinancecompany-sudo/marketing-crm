-- Daily marketing command centre, effective-dated targets and durable activity events.

create table if not exists public.marketing_daily_target_schedules (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null,
  weekday smallint not null check (weekday between 0 and 6),
  van_finance_facebook_post integer not null default 10 check (van_finance_facebook_post >= 0),
  rent2buy_facebook_post integer not null default 10 check (rent2buy_facebook_post >= 0),
  van_finance_reel integer not null default 10 check (van_finance_reel >= 0),
  rent2buy_reel integer not null default 10 check (rent2buy_reel >= 0),
  emails_sent integer not null default 200 check (emails_sent >= 0),
  off_day boolean not null default false,
  created_at timestamptz not null default now(),
  unique (effective_from, weekday)
);

create table if not exists public.marketing_daily_target_overrides (
  activity_date date primary key,
  van_finance_facebook_post integer not null default 10 check (van_finance_facebook_post >= 0),
  rent2buy_facebook_post integer not null default 10 check (rent2buy_facebook_post >= 0),
  van_finance_reel integer not null default 10 check (van_finance_reel >= 0),
  rent2buy_reel integer not null default 10 check (rent2buy_reel >= 0),
  emails_sent integer not null default 200 check (emails_sent >= 0),
  off_day boolean not null default false,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_daily_activity_events (
  id uuid primary key default gen_random_uuid(),
  activity_date date not null,
  activity_type text not null check (activity_type in (
    'van_finance_facebook_post', 'rent2buy_facebook_post',
    'van_finance_reel', 'rent2buy_reel'
  )),
  quantity integer not null default 1 check (quantity > 0),
  source text not null default 'manual',
  source_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists marketing_daily_activity_source_identity
  on public.marketing_daily_activity_events (activity_type, source, source_id)
  where source_id is not null and source_id <> '';

create index if not exists marketing_daily_activity_date_idx
  on public.marketing_daily_activity_events (activity_date, activity_type);

create index if not exists marketing_daily_target_schedule_lookup_idx
  on public.marketing_daily_target_schedules (weekday, effective_from desc);

drop trigger if exists marketing_daily_target_overrides_set_updated_at on public.marketing_daily_target_overrides;
create trigger marketing_daily_target_overrides_set_updated_at
before update on public.marketing_daily_target_overrides
for each row execute function public.set_marketing_updated_at();

insert into public.marketing_daily_target_schedules (
  effective_from, weekday, van_finance_facebook_post, rent2buy_facebook_post,
  van_finance_reel, rent2buy_reel, emails_sent, off_day
)
select (now() at time zone 'Europe/London')::date, weekday, 10, 10, 10, 10, 200, false
from generate_series(0, 6) as weekday
on conflict (effective_from, weekday) do nothing;

alter table public.marketing_daily_target_schedules enable row level security;
alter table public.marketing_daily_target_overrides enable row level security;
alter table public.marketing_daily_activity_events enable row level security;

revoke all on public.marketing_daily_target_schedules from anon, authenticated;
revoke all on public.marketing_daily_target_overrides from anon, authenticated;
revoke all on public.marketing_daily_activity_events from anon, authenticated;

