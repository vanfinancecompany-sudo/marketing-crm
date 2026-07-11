-- Marketing CRM campaign batch export lifecycle
-- Additive only: does not modify existing customer records or previous migrations.

alter table public.marketing_campaign_batches
  add column if not exists exported_at timestamptz,
  add column if not exists exported_by text,
  add column if not exists export_filename text,
  add column if not exists export_count integer not null default 0 check (export_count >= 0);

create index if not exists marketing_campaign_batches_exported_at_idx
  on public.marketing_campaign_batches (exported_at desc)
  where exported_at is not null;
