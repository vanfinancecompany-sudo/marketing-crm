-- Add every current Content Operations placement card to daily targets and durable activity history.

alter table public.marketing_daily_target_schedules
  add column if not exists van_finance_facebook_story integer not null default 3 check (van_finance_facebook_story >= 0),
  add column if not exists van_finance_instagram_post integer not null default 20 check (van_finance_instagram_post >= 0),
  add column if not exists van_finance_instagram_story integer not null default 3 check (van_finance_instagram_story >= 0),
  add column if not exists van_finance_instagram_reel integer not null default 10 check (van_finance_instagram_reel >= 0),
  add column if not exists rent2buy_facebook_story integer not null default 3 check (rent2buy_facebook_story >= 0),
  add column if not exists vansco_facebook_post integer not null default 30 check (vansco_facebook_post >= 0),
  add column if not exists vansco_facebook_story integer not null default 5 check (vansco_facebook_story >= 0),
  add column if not exists vansco_333_google_business_post integer not null default 10 check (vansco_333_google_business_post >= 0),
  add column if not exists vansco_airport_google_business_post integer not null default 10 check (vansco_airport_google_business_post >= 0),
  add column if not exists vansco_new_forest_google_business_post integer not null default 10 check (vansco_new_forest_google_business_post >= 0);

alter table public.marketing_daily_target_overrides
  add column if not exists van_finance_facebook_story integer not null default 3 check (van_finance_facebook_story >= 0),
  add column if not exists van_finance_instagram_post integer not null default 20 check (van_finance_instagram_post >= 0),
  add column if not exists van_finance_instagram_story integer not null default 3 check (van_finance_instagram_story >= 0),
  add column if not exists van_finance_instagram_reel integer not null default 10 check (van_finance_instagram_reel >= 0),
  add column if not exists rent2buy_facebook_story integer not null default 3 check (rent2buy_facebook_story >= 0),
  add column if not exists vansco_facebook_post integer not null default 30 check (vansco_facebook_post >= 0),
  add column if not exists vansco_facebook_story integer not null default 5 check (vansco_facebook_story >= 0),
  add column if not exists vansco_333_google_business_post integer not null default 10 check (vansco_333_google_business_post >= 0),
  add column if not exists vansco_airport_google_business_post integer not null default 10 check (vansco_airport_google_business_post >= 0),
  add column if not exists vansco_new_forest_google_business_post integer not null default 10 check (vansco_new_forest_google_business_post >= 0);

alter table public.marketing_daily_activity_events
  drop constraint if exists marketing_daily_activity_events_activity_type_check;

alter table public.marketing_daily_activity_events
  add constraint marketing_daily_activity_events_activity_type_check
  check (activity_type in (
    'van_finance_facebook_post',
    'van_finance_facebook_story',
    'van_finance_instagram_post',
    'van_finance_instagram_story',
    'van_finance_instagram_reel',
    'rent2buy_facebook_post',
    'rent2buy_facebook_story',
    'vansco_facebook_post',
    'vansco_facebook_story',
    'vansco_333_google_business_post',
    'vansco_airport_google_business_post',
    'vansco_new_forest_google_business_post',
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
