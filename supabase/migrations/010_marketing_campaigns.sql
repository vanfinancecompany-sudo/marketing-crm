alter table public.marketing_campaigns
  add column if not exists campaign_type text,
  add column if not exists template_id uuid null,
  add column if not exists template_name text not null default '',
  add column if not exists template_snapshot jsonb,
  add column if not exists subject_line text not null default '',
  add column if not exists preview_text text not null default '',
  add column if not exists audience_snapshot jsonb null;

update public.marketing_campaigns
set campaign_type = coalesce(campaign_type, objective, 'custom')
where campaign_type is null;

update public.marketing_campaigns
set template_snapshot = jsonb_build_object(
  'snapshot_version', 1,
  'source_template_id', '',
  'source_template_updated_at', '',
  'name', name,
  'category', coalesce(objective, 'custom'),
  'default_subject', coalesce(subject_line, name, ''),
  'preview_text', coalesce(preview_text, description, ''),
  'header_logo', '',
  'hero_heading', name,
  'intro_text', description,
  'main_body', '',
  'cta_text', '',
  'cta_url', '',
  'footer', '',
  'brand_colour', '#2563eb',
  'secondary_colour', '#eef2ff',
  'company_name', 'Van Finance Company',
  'social_links', '',
  'master_layout', 'custom_blank',
  'content_blocks', '[]'::jsonb
)
where template_snapshot is null;

alter table public.marketing_campaigns
  alter column campaign_type set default 'custom',
  alter column campaign_type set not null,
  alter column template_snapshot set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'marketing_campaigns_campaign_type_check'
  ) then
    alter table public.marketing_campaigns
      add constraint marketing_campaigns_campaign_type_check
      check (campaign_type in ('new_stock', 'finance_offer', 'rent2buy', 'newsletter', 'custom'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'marketing_campaigns_template_snapshot_object_check'
  ) then
    alter table public.marketing_campaigns
      add constraint marketing_campaigns_template_snapshot_object_check
      check (jsonb_typeof(template_snapshot) = 'object');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'marketing_campaigns_audience_snapshot_object_check'
  ) then
    alter table public.marketing_campaigns
      add constraint marketing_campaigns_audience_snapshot_object_check
      check (audience_snapshot is null or jsonb_typeof(audience_snapshot) = 'object');
  end if;
end $$;

create index if not exists marketing_campaigns_campaign_type_idx
  on public.marketing_campaigns (campaign_type);

create index if not exists marketing_campaigns_template_id_idx
  on public.marketing_campaigns (template_id);

create index if not exists marketing_campaigns_updated_at_idx
  on public.marketing_campaigns (updated_at desc);
