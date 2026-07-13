-- Marketing Campaign Foundation compatibility fields.
--
-- This migration is additive and intentionally leaves existing campaign rows unchanged.
-- Existing audience/batch/export campaigns may have objectives such as promotion or
-- re_engagement and statuses such as running, paused or completed, so template-campaign
-- fields remain nullable for legacy rows.
--
-- Rollback notes, if needed before dependent code is deployed:
--   drop index if exists public.marketing_campaigns_template_source_idx;
--   drop index if exists public.marketing_campaigns_campaign_type_idx;
--   drop index if exists public.marketing_campaigns_template_id_idx;
--   drop index if exists public.marketing_campaigns_updated_at_idx;
--   alter table public.marketing_campaigns drop constraint if exists marketing_campaigns_campaign_type_check;
--   alter table public.marketing_campaigns drop constraint if exists marketing_campaigns_template_snapshot_object_check;
--   alter table public.marketing_campaigns drop constraint if exists marketing_campaigns_audience_snapshot_object_check;
--   alter table public.marketing_campaigns drop column if exists campaign_type;
--   alter table public.marketing_campaigns drop column if exists template_id;
--   alter table public.marketing_campaigns drop column if exists template_name;
--   alter table public.marketing_campaigns drop column if exists template_snapshot;
--   alter table public.marketing_campaigns drop column if exists subject_line;
--   alter table public.marketing_campaigns drop column if exists preview_text;
--   alter table public.marketing_campaigns drop column if exists audience_snapshot;

alter table public.marketing_campaigns
  add column if not exists campaign_type text null,
  add column if not exists template_id uuid null,
  add column if not exists template_name text not null default '',
  add column if not exists template_snapshot jsonb null,
  add column if not exists subject_line text not null default '',
  add column if not exists preview_text text not null default '',
  add column if not exists audience_snapshot jsonb null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'marketing_campaigns_campaign_type_check'
  ) then
    alter table public.marketing_campaigns
      add constraint marketing_campaigns_campaign_type_check
      check (
        campaign_type is null
        or campaign_type in ('new_stock', 'finance_offer', 'rent2buy', 'newsletter', 'custom')
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'marketing_campaigns_template_snapshot_object_check'
  ) then
    alter table public.marketing_campaigns
      add constraint marketing_campaigns_template_snapshot_object_check
      check (template_snapshot is null or jsonb_typeof(template_snapshot) = 'object');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'marketing_campaigns_audience_snapshot_object_check'
  ) then
    alter table public.marketing_campaigns
      add constraint marketing_campaigns_audience_snapshot_object_check
      check (audience_snapshot is null or jsonb_typeof(audience_snapshot) = 'object');
  end if;
end $$;

create index if not exists marketing_campaigns_template_source_idx
  on public.marketing_campaigns ((metadata->>'source'))
  where metadata->>'source' = 'template_campaign_foundation';

create index if not exists marketing_campaigns_campaign_type_idx
  on public.marketing_campaigns (campaign_type)
  where metadata->>'source' = 'template_campaign_foundation';

create index if not exists marketing_campaigns_template_id_idx
  on public.marketing_campaigns (template_id)
  where metadata->>'source' = 'template_campaign_foundation';

create index if not exists marketing_campaigns_updated_at_idx
  on public.marketing_campaigns (updated_at desc)
  where metadata->>'source' = 'template_campaign_foundation';
