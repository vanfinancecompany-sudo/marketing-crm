-- Marketing CRM email template content blocks foundation
-- Additive only. No sending, provider or automation integration.

alter table public.marketing_email_templates
  add column if not exists content_blocks jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'marketing_email_templates_content_blocks_array_check'
      and conrelid = 'public.marketing_email_templates'::regclass
  ) then
    alter table public.marketing_email_templates
      add constraint marketing_email_templates_content_blocks_array_check
      check (jsonb_typeof(content_blocks) = 'array');
  end if;
end;
$$;
