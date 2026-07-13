create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  campaign_type text not null,
  status text not null default 'draft',
  template_id uuid null,
  template_name text not null default '',
  template_snapshot jsonb not null,
  subject_line text not null default '',
  preview_text text not null default '',
  audience_snapshot jsonb null,
  created_by text not null default 'Marketing CRM',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  constraint marketing_campaigns_campaign_type_check
    check (campaign_type in ('new_stock', 'finance_offer', 'rent2buy', 'newsletter', 'custom')),
  constraint marketing_campaigns_status_check
    check (status in ('draft', 'ready', 'archived')),
  constraint marketing_campaigns_template_snapshot_object_check
    check (jsonb_typeof(template_snapshot) = 'object'),
  constraint marketing_campaigns_audience_snapshot_object_check
    check (audience_snapshot is null or jsonb_typeof(audience_snapshot) = 'object'),
  constraint marketing_campaigns_archive_consistency_check
    check (
      (status = 'archived' and archived_at is not null)
      or
      (status <> 'archived' and archived_at is null)
    )
);

create index if not exists marketing_campaigns_status_idx
  on public.marketing_campaigns (status);

create index if not exists marketing_campaigns_campaign_type_idx
  on public.marketing_campaigns (campaign_type);

create index if not exists marketing_campaigns_updated_at_idx
  on public.marketing_campaigns (updated_at desc);

create or replace function public.set_marketing_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_marketing_campaigns_updated_at on public.marketing_campaigns;
create trigger set_marketing_campaigns_updated_at
before update on public.marketing_campaigns
for each row
execute function public.set_marketing_updated_at();
