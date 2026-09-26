-- Add Google Business vehicle posting targets and durable activity tracking.

alter table public.marketing_daily_target_schedules
  add column if not exists van_finance_google_business_post integer not null default 6
  check (van_finance_google_business_post >= 0),
  add column if not exists rent2buy_google_business_post integer not null default 4
  check (rent2buy_google_business_post >= 0);

alter table public.marketing_daily_target_overrides
  add column if not exists van_finance_google_business_post integer not null default 6
  check (van_finance_google_business_post >= 0),
  add column if not exists rent2buy_google_business_post integer not null default 4
  check (rent2buy_google_business_post >= 0);

alter table public.marketing_daily_activity_events
  drop constraint if exists marketing_daily_activity_events_activity_type_check;

alter table public.marketing_daily_activity_events
  add constraint marketing_daily_activity_events_activity_type_check
  check (activity_type in (
    'van_finance_facebook_post',
    'rent2buy_facebook_post',
    'van_finance_google_business_post',
    'rent2buy_google_business_post',
    'van_finance_groups_post',
    'rent2buy_groups_post',
    'van_finance_marketplace_post',
    'rent2buy_marketplace_post',
    'van_finance_reel',
    'rent2buy_reel',
    'knowledge_hub_article'
  ));
