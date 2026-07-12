-- Marketing CRM email template persisted design metadata
-- Additive only. No sending, provider or automation integration.

alter table public.marketing_email_templates
  add column if not exists company_name text not null default 'Van Finance Company',
  add column if not exists secondary_colour text not null default '#eef2ff',
  add column if not exists social_links text not null default '',
  add column if not exists master_layout text not null default 'custom_blank';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'marketing_email_templates_master_layout_check'
      and conrelid = 'public.marketing_email_templates'::regclass
  ) then
    alter table public.marketing_email_templates
      add constraint marketing_email_templates_master_layout_check
      check (master_layout in ('new_stock', 'finance_offer', 'rent2buy', 'weekend_offer', 're_engagement', 'newsletter', 'custom_blank'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'marketing_email_templates_company_name_required'
      and conrelid = 'public.marketing_email_templates'::regclass
  ) then
    alter table public.marketing_email_templates
      add constraint marketing_email_templates_company_name_required
      check (length(trim(company_name)) > 0 and length(company_name) <= 200);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'marketing_email_templates_secondary_colour_check'
      and conrelid = 'public.marketing_email_templates'::regclass
  ) then
    alter table public.marketing_email_templates
      add constraint marketing_email_templates_secondary_colour_check
      check (secondary_colour ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'marketing_email_templates_social_links_length_check'
      and conrelid = 'public.marketing_email_templates'::regclass
  ) then
    alter table public.marketing_email_templates
      add constraint marketing_email_templates_social_links_length_check
      check (length(social_links) <= 1000);
  end if;
end;
$$;

create index if not exists marketing_email_templates_master_layout_idx
  on public.marketing_email_templates (master_layout);
