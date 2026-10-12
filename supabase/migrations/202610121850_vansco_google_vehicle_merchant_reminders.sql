-- Add Merchant Center follow-up ledger to the existing Vansco-only selection.
-- DealerKit Stock Watch and its source-state tables are not modified.
alter table public.vansco_google_vehicle_ads_selection
  add column if not exists merchant_actions jsonb not null default '[]'::jsonb,
  add column if not exists blocked_sold_ids text[] not null default '{}';
comment on column public.vansco_google_vehicle_ads_selection.merchant_actions is
  'Vansco Google Vehicle Ads removal reminders and operator Merchant Center confirmations.';
comment on column public.vansco_google_vehicle_ads_selection.blocked_sold_ids is
  'Google vehicle IDs manually marked sold or confirmed sold, blocked from re-selection.';
