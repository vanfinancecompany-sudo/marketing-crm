-- Marketing CRM Phase 4 indexes and Row Level Security
-- Additive only: does not modify existing CRM tables.

create unique index if not exists marketing_contacts_email_normalized_unique
  on public.marketing_contacts (email_normalized)
  where email_normalized is not null and email_normalized <> '';

create unique index if not exists marketing_contacts_phone_normalized_unique
  on public.marketing_contacts (phone_normalized)
  where phone_normalized is not null and phone_normalized <> '';

create index if not exists marketing_contacts_pipeline_idx
  on public.marketing_contacts (pipeline);

create index if not exists marketing_contacts_source_idx
  on public.marketing_contacts (source);

create index if not exists marketing_contacts_postcode_idx
  on public.marketing_contacts (postcode);

create index if not exists marketing_contacts_updated_at_idx
  on public.marketing_contacts (updated_at desc);

create index if not exists marketing_contacts_tags_gin_idx
  on public.marketing_contacts using gin (tags);

create index if not exists marketing_contacts_sources_gin_idx
  on public.marketing_contacts using gin (sources);

create index if not exists marketing_import_rows_import_id_idx
  on public.marketing_import_rows (import_id);

create index if not exists marketing_merge_log_primary_contact_idx
  on public.marketing_merge_log (primary_contact_id);

create index if not exists marketing_exports_created_at_idx
  on public.marketing_exports (created_at desc);

alter table public.marketing_contacts enable row level security;
alter table public.marketing_imports enable row level security;
alter table public.marketing_import_rows enable row level security;
alter table public.marketing_merge_log enable row level security;
alter table public.marketing_exports enable row level security;
alter table public.marketing_saved_audiences enable row level security;

-- No permissive public policies are created here.
-- The application must use authenticated policies or server-side functions.
-- Policies should be added only after the existing authentication model is audited.
