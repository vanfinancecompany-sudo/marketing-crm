-- Add Knowledge Hub article targets and activity events without changing existing target rows.

alter table public.marketing_daily_target_schedules
  add column if not exists knowledge_hub_article integer not null default 2
  check (knowledge_hub_article >= 0);

alter table public.marketing_daily_target_overrides
  add column if not exists knowledge_hub_article integer not null default 2
  check (knowledge_hub_article >= 0);

alter table public.marketing_daily_activity_events
  drop constraint if exists marketing_daily_activity_events_activity_type_check;

alter table public.marketing_daily_activity_events
  add constraint marketing_daily_activity_events_activity_type_check
  check (activity_type in (
    'van_finance_facebook_post',
    'rent2buy_facebook_post',
    'van_finance_reel',
    'rent2buy_reel',
    'knowledge_hub_article'
  ));
