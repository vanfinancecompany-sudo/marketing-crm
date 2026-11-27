alter table public.rent2buy_group_renewal_settings
  add column if not exists background_token_hash text,
  add column if not exists background_test_date date;
