-- Marketing CRM email template engine foundation
-- Additive template metadata only. No sending, provider or automation integration.

create table if not exists public.marketing_email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  category text not null default 'custom',
  default_subject text not null,
  preview_text text not null default '',
  header_logo text not null default '',
  hero_heading text not null default '',
  intro_text text not null default '',
  main_body text not null default '',
  cta_text text not null default '',
  cta_url text not null default '',
  footer text not null default '',
  brand_colour text not null default '#2563eb',
  status text not null default 'draft',
  created_by text not null default 'Marketing CRM',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint marketing_email_templates_category_check check (category in ('new_stock', 'finance_offer', 'rent2buy', 'weekend_offer', 're_engagement', 'custom')),
  constraint marketing_email_templates_status_check check (status in ('draft', 'active', 'archived')),
  constraint marketing_email_templates_name_required check (length(trim(name)) > 0),
  constraint marketing_email_templates_subject_required check (length(trim(default_subject)) > 0),
  constraint marketing_email_templates_archive_consistency check (
    (status = 'archived' and archived_at is not null)
    or (status <> 'archived' and archived_at is null)
  )
);

alter table public.marketing_email_templates enable row level security;

create index if not exists marketing_email_templates_status_idx
  on public.marketing_email_templates (status);

create index if not exists marketing_email_templates_category_idx
  on public.marketing_email_templates (category);

create index if not exists marketing_email_templates_updated_at_idx
  on public.marketing_email_templates (updated_at desc);

create or replace function public.set_marketing_email_templates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists marketing_email_templates_set_updated_at on public.marketing_email_templates;
create trigger marketing_email_templates_set_updated_at
before update on public.marketing_email_templates
for each row
execute function public.set_marketing_email_templates_updated_at();

revoke all on function public.set_marketing_email_templates_updated_at() from public;
revoke all on function public.set_marketing_email_templates_updated_at() from anon;
revoke all on function public.set_marketing_email_templates_updated_at() from authenticated;
grant execute on function public.set_marketing_email_templates_updated_at() to service_role;
