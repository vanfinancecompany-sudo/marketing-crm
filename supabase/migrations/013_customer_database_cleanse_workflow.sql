-- Safe customer database cleanse, restore and permanent suppression identities.
-- Additive/backward-compatible: no customer, campaign, recipient or event rows are deleted.

alter table public.marketing_contacts
  add column if not exists lifecycle_status text not null default 'active',
  add column if not exists lifecycle_changed_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'marketing_contacts_lifecycle_status_check'
      and conrelid = 'public.marketing_contacts'::regclass
  ) then
    alter table public.marketing_contacts
      add constraint marketing_contacts_lifecycle_status_check
      check (lifecycle_status in ('active', 'awaiting_verification', 'archived', 'suppressed'));
  end if;
end $$;

create index if not exists marketing_contacts_lifecycle_status_idx
  on public.marketing_contacts (lifecycle_status);

alter table public.marketing_imports
  add column if not exists restored_customers integer not null default 0,
  add column if not exists suppressed_emails integer not null default 0,
  add column if not exists invalid_emails integer not null default 0;

create table if not exists public.marketing_suppression_identities (
  id uuid primary key default gen_random_uuid(),
  email_normalized text not null unique,
  suppression_type text not null,
  reason text not null default '',
  provider text not null default 'Marketing CRM',
  campaign_id uuid references public.marketing_campaigns(id) on delete set null,
  contact_id uuid references public.marketing_contacts(id) on delete set null,
  suppressed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint marketing_suppression_identities_email_check
    check (email_normalized = lower(trim(email_normalized)) and email_normalized <> ''),
  constraint marketing_suppression_identities_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists marketing_suppression_identities_date_idx
  on public.marketing_suppression_identities (suppressed_at desc);

alter table public.marketing_suppression_identities enable row level security;

create table if not exists public.marketing_database_clear_audit (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'prepared'
    check (status in ('prepared', 'completed', 'cancelled')),
  active_count integer not null default 0,
  awaiting_verification_count integer not null default 0,
  suppressed_count integer not null default 0,
  full_export_count integer not null default 0,
  delivered_export_count integer not null default 0,
  suppression_export_count integer not null default 0,
  cleared_count integer not null default 0,
  prepared_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by text not null default 'Marketing CRM',
  metadata jsonb not null default '{}'::jsonb,
  constraint marketing_database_clear_audit_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

alter table public.marketing_database_clear_audit enable row level security;

-- Backfill immutable email identities from the existing JSON suppression state.
insert into public.marketing_suppression_identities (
  email_normalized, suppression_type, reason, provider, contact_id, suppressed_at, metadata
)
select distinct on (lower(trim(coalesce(c.email_normalized, c.email))))
  lower(trim(coalesce(c.email_normalized, c.email))),
  entry.type,
  coalesce(nullif(entry.value ->> 'reason', ''), entry.type),
  coalesce(nullif(entry.value ->> 'added_by', ''), 'Marketing CRM'),
  c.id,
  coalesce(c.updated_at, now()),
  jsonb_build_object(
    'backfilled_from', 'marketing_contacts.suppression',
    'original_added_at', coalesce(entry.value ->> 'added_at', '')
  )
from public.marketing_contacts c
cross join lateral jsonb_each(
  case when jsonb_typeof(c.suppression) = 'object' then c.suppression else '{}'::jsonb end
) as entry(type, value)
where nullif(lower(trim(coalesce(c.email_normalized, c.email))), '') is not null
  and entry.type in ('email_unsubscribed', 'email_bounced', 'manual_suppression', 'global_do_not_contact')
  and jsonb_typeof(entry.value) = 'object'
  and coalesce(lower(entry.value ->> 'active'), 'true') not in ('false', 'f', '0', 'no', 'off')
order by lower(trim(coalesce(c.email_normalized, c.email))), coalesce(c.updated_at, now()) desc
on conflict (email_normalized) do nothing;

-- Older records may carry only the pre-Suppression-Centre marketing status.
insert into public.marketing_suppression_identities (
  email_normalized, suppression_type, reason, provider, contact_id, suppressed_at, metadata
)
select
  lower(trim(coalesce(c.email_normalized, c.email))),
  case when c.marketing_status = 'unsubscribed' then 'email_unsubscribed' else 'global_do_not_contact' end,
  'Backfilled from marketing status: ' || c.marketing_status,
  'Marketing CRM migration',
  c.id,
  coalesce(c.updated_at, now()),
  jsonb_build_object('backfilled_from', 'marketing_contacts.marketing_status')
from public.marketing_contacts c
where c.marketing_status in ('unsubscribed', 'suppressed')
  and nullif(lower(trim(coalesce(c.email_normalized, c.email))), '') is not null
on conflict (email_normalized) do nothing;

-- Existing terminal email suppressions must disappear from the active database immediately.
update public.marketing_contacts c
set lifecycle_status = 'suppressed', lifecycle_changed_at = coalesce(c.updated_at, now())
where c.lifecycle_status = 'active'
  and (
    c.marketing_status in ('unsubscribed', 'suppressed')
    or exists (
      select 1
      from jsonb_each(
        case when jsonb_typeof(c.suppression) = 'object' then c.suppression else '{}'::jsonb end
      ) as entry(type, value)
      where entry.type in ('email_unsubscribed', 'email_bounced', 'manual_suppression', 'global_do_not_contact')
        and jsonb_typeof(entry.value) = 'object'
        and coalesce(lower(entry.value ->> 'active'), 'true') not in ('false', 'f', '0', 'no', 'off')
    )
  );

-- Enforce permanent suppression at the database boundary as well as in API imports.
create or replace function public.marketing_guard_active_suppressed_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email_normalized text;
begin
  v_email_normalized := nullif(lower(trim(coalesce(new.email_normalized, new.email))), '');
  if new.lifecycle_status = 'active' then
    if new.marketing_status in ('unsubscribed', 'suppressed')
      or exists (
        select 1
        from jsonb_each(
          case when jsonb_typeof(new.suppression) = 'object' then new.suppression else '{}'::jsonb end
        ) as entry(type, value)
        where entry.type in ('email_unsubscribed', 'email_bounced', 'manual_suppression', 'global_do_not_contact')
          and public.marketing_suppression_is_active(entry.value)
      )
      or (
        v_email_normalized is not null
        and exists (
          select 1 from public.marketing_suppression_identities si
          where si.email_normalized = v_email_normalized
        )
      ) then
      raise exception using errcode = '23514', message = 'Suppressed contacts and email identities cannot be activated.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists marketing_contacts_guard_active_suppressed_email on public.marketing_contacts;
create trigger marketing_contacts_guard_active_suppressed_email
before insert or update of email, email_normalized, lifecycle_status, marketing_status, suppression
on public.marketing_contacts
for each row execute function public.marketing_guard_active_suppressed_email();

create or replace function public.marketing_hide_suppressed_email_contacts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.marketing_contacts
  set lifecycle_status = 'suppressed', lifecycle_changed_at = greatest(coalesce(lifecycle_changed_at, '-infinity'::timestamptz), new.suppressed_at)
  where lower(trim(coalesce(email_normalized, email))) = new.email_normalized
    and lifecycle_status <> 'suppressed';
  return new;
end;
$$;

drop trigger if exists marketing_suppression_identity_hide_contacts on public.marketing_suppression_identities;
create trigger marketing_suppression_identity_hide_contacts
after insert or update of email_normalized, suppressed_at
on public.marketing_suppression_identities
for each row execute function public.marketing_hide_suppressed_email_contacts();

update public.marketing_contacts c
set lifecycle_status = 'suppressed', lifecycle_changed_at = now()
where c.lifecycle_status <> 'suppressed'
  and exists (
    select 1 from public.marketing_suppression_identities si
    where si.email_normalized = lower(trim(coalesce(c.email_normalized, c.email)))
  );

-- Keep the existing five-argument RPC signature used by both provider webhooks,
-- the unsubscribe endpoint and the Suppression Centre.
create or replace function public.marketing_apply_suppression(
  p_contact_id uuid,
  p_type text,
  p_reason text default '',
  p_added_by text default 'Marketing CRM',
  p_notes text default ''
)
returns setof public.marketing_contacts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact public.marketing_contacts%rowtype;
  v_type text := lower(trim(coalesce(p_type, '')));
  v_now timestamptz := now();
  v_entry jsonb;
  v_history_entry jsonb;
  v_permanent_email boolean;
  v_campaign_text text;
  v_campaign_id uuid;
  v_note_email text;
  v_recipient_text text;
  v_recipient_id uuid;
  v_identity_email text;
begin
  if v_type not in ('email_unsubscribed', 'email_bounced', 'sms_opt_out', 'facebook_excluded', 'manual_suppression', 'global_do_not_contact') then
    raise exception 'Unsupported suppression type.';
  end if;

  select * into v_contact
  from public.marketing_contacts
  where id = p_contact_id
  for update;

  if not found then raise exception 'Contact not found.'; end if;

  v_permanent_email := v_type in ('email_unsubscribed', 'email_bounced', 'manual_suppression', 'global_do_not_contact');
  v_entry := jsonb_build_object(
    'type', v_type,
    'label', case v_type
      when 'email_unsubscribed' then 'Email Unsubscribed'
      when 'email_bounced' then 'Email Bounced'
      when 'sms_opt_out' then 'SMS Opt-out'
      when 'facebook_excluded' then 'Facebook Excluded'
      when 'manual_suppression' then 'Manual Suppression'
      when 'global_do_not_contact' then 'Global Do Not Contact'
    end,
    'reason', left(trim(coalesce(nullif(p_reason, ''), v_type)), 500),
    'added_at', v_now,
    'added_by', left(trim(coalesce(nullif(p_added_by, ''), 'Marketing CRM')), 500),
    'notes', left(trim(coalesce(p_notes, '')), 500),
    'active', true
  );
  v_history_entry := jsonb_build_object('action', 'suppressed') || v_entry;

  update public.marketing_contacts
  set suppression = coalesce(v_contact.suppression, '{}'::jsonb) || jsonb_build_object(v_type, v_entry),
      suppression_history = jsonb_build_array(v_history_entry) || coalesce(v_contact.suppression_history, '[]'::jsonb),
      lifecycle_status = case when v_permanent_email then 'suppressed' else lifecycle_status end,
      lifecycle_changed_at = case when v_permanent_email then v_now else lifecycle_changed_at end,
      updated_at = v_now
  where id = v_contact.id
  returning * into v_contact;

  -- Provider webhooks may be processing an event for an older recipient address
  -- after the customer card email changed. Only those trusted server callers may
  -- override the card's current email identity through the notes field.
  if p_added_by in ('Brevo webhook', 'SMTP2GO webhook') then
    v_note_email := substring(coalesce(p_notes, '') from 'email:([^[:space:]]+)');
    v_recipient_text := substring(coalesce(p_notes, '') from 'recipient:([0-9a-fA-F-]{36})');
    if v_recipient_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_recipient_id := v_recipient_text::uuid;
    end if;
    if v_note_email is not null
      and lower(trim(v_note_email)) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      v_note_email := null;
    end if;
    if v_note_email is not null
      and not exists (
        select 1
        from public.marketing_email_send_recipients recipient
        where recipient.id = v_recipient_id
          and recipient.customer_id = v_contact.customer_id
          and lower(trim(recipient.email)) = lower(trim(v_note_email))
      ) then
      v_note_email := null;
    end if;
  end if;
  v_identity_email := nullif(lower(trim(coalesce(nullif(v_note_email, ''), v_contact.email_normalized, v_contact.email))), '');
  if v_permanent_email and v_identity_email is not null then
    v_campaign_text := substring(coalesce(p_notes, '') from 'campaign:([0-9a-fA-F-]{36})');
    if v_campaign_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_campaign_id := v_campaign_text::uuid;
    end if;

    insert into public.marketing_suppression_identities (
      email_normalized, suppression_type, reason, provider, campaign_id, contact_id, suppressed_at, metadata
    ) values (
      v_identity_email,
      v_type,
      left(trim(coalesce(nullif(p_reason, ''), v_type)), 500),
      left(trim(coalesce(nullif(p_added_by, ''), 'Marketing CRM')), 500),
      v_campaign_id,
      v_contact.id,
      v_now,
      jsonb_build_object('notes', left(trim(coalesce(p_notes, '')), 500))
    )
    on conflict (email_normalized) do update
      set suppression_type = excluded.suppression_type,
          reason = excluded.reason,
          provider = excluded.provider,
          campaign_id = coalesce(excluded.campaign_id, marketing_suppression_identities.campaign_id),
          contact_id = coalesce(marketing_suppression_identities.contact_id, excluded.contact_id),
          suppressed_at = greatest(marketing_suppression_identities.suppressed_at, excluded.suppressed_at),
          metadata = marketing_suppression_identities.metadata || excluded.metadata;
  end if;

  return next v_contact;
end;
$$;

create or replace function public.marketing_clear_active_customer_database(
  p_operation_id uuid,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.marketing_database_clear_audit%rowtype;
  v_cleared integer := 0;
  v_current_active integer := 0;
begin
  if p_confirmation <> 'CLEAR ACTIVE CUSTOMER DATABASE' then
    raise exception 'Typed confirmation does not match.';
  end if;

  select * into v_operation
  from public.marketing_database_clear_audit
  where id = p_operation_id
  for update;

  if not found or v_operation.status <> 'prepared' then
    raise exception 'A current prepared clear operation is required.';
  end if;

  if v_operation.prepared_at < now() - interval '30 minutes' then
    update public.marketing_database_clear_audit set status = 'cancelled' where id = p_operation_id;
    return jsonb_build_object(
      'operation_id', p_operation_id,
      'cancelled', true,
      'error', 'The prepared clear operation has expired. Prepare the exports again.'
    );
  end if;

  -- Block concurrent contact writes between the count check and lifecycle update.
  lock table public.marketing_contacts in share row exclusive mode;

  select count(*)::integer into v_current_active
  from public.marketing_contacts
  where lifecycle_status = 'active';
  if v_current_active <> v_operation.active_count then
    update public.marketing_database_clear_audit set status = 'cancelled' where id = p_operation_id;
    return jsonb_build_object(
      'operation_id', p_operation_id,
      'cancelled', true,
      'expected_active_count', v_operation.active_count,
      'current_active_count', v_current_active,
      'error', 'Active customer count changed after the safety exports. Download fresh exports and prepare again.'
    );
  end if;

  update public.marketing_contacts
  set lifecycle_status = 'awaiting_verification', lifecycle_changed_at = now()
  where lifecycle_status = 'active';
  get diagnostics v_cleared = row_count;

  update public.marketing_database_clear_audit
  set status = 'completed', completed_at = now(), cleared_count = v_cleared
  where id = p_operation_id;

  return jsonb_build_object('operation_id', p_operation_id, 'cleared_count', v_cleared);
end;
$$;

-- Protect production sends by normalized email as well as the existing customer ID index.
-- A trigger is used so pre-existing historical duplicates do not make this migration fail.
create index if not exists marketing_email_send_recipients_campaign_email_idx
  on public.marketing_email_send_recipients (campaign_id, lower(email));

create or replace function public.marketing_prevent_duplicate_campaign_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.send_type <> 'production'
    or new.status not in ('pending', 'accepted', 'sent', 'delivered', 'opened', 'clicked', 'submission_unknown') then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext(new.campaign_id::text || ':' || lower(trim(new.email))));
  if exists (
    select 1
    from public.marketing_email_send_recipients existing
    where existing.campaign_id = new.campaign_id
      and lower(trim(existing.email)) = lower(trim(new.email))
      and existing.send_type = 'production'
      and existing.status in ('pending', 'accepted', 'sent', 'delivered', 'opened', 'clicked', 'submission_unknown')
      and existing.id <> new.id
  ) then
    raise exception using errcode = '23505', message = 'Campaign already has a production recipient for this normalized email.';
  end if;
  return new;
end;
$$;

drop trigger if exists marketing_email_recipient_prevent_duplicate_email on public.marketing_email_send_recipients;
create trigger marketing_email_recipient_prevent_duplicate_email
before insert or update of campaign_id, email, send_type, status
on public.marketing_email_send_recipients
for each row execute function public.marketing_prevent_duplicate_campaign_email();

-- Replace the legacy batch eligibility function with the same contract plus lifecycle safety.
create or replace function public.marketing_campaign_batch_eligible_customer_ids(
  p_campaign_id uuid,
  p_exclude_batched boolean default true
)
returns table(customer_id uuid, last_seen_at timestamptz, created_at timestamptz)
language plpgsql
as $$
declare
  v_campaign record;
  v_rules jsonb;
  v_pipeline text;
  v_source text;
  v_required_tags text[];
  v_exclude_tags text[];
  v_last_seen_period text;
  v_created_period text;
  v_exclude_unknown_pipeline boolean;
begin
  select * into v_campaign from public.marketing_campaigns where id = p_campaign_id;
  if not found then raise exception 'Campaign not found.'; end if;
  if v_campaign.status = 'archived' then raise exception 'Archived campaigns cannot generate batches.'; end if;

  v_rules := v_campaign.metadata #> '{audience,rules}';
  if v_rules is null or jsonb_typeof(v_rules) <> 'object' then
    raise exception 'Configure and save an audience before generating a batch.';
  end if;
  if nullif(v_campaign.metadata #>> '{audience,calculated_at}', '') is null then
    raise exception 'Preview and save the audience before generating a batch.';
  end if;

  v_pipeline := coalesce(nullif(v_rules ->> 'pipeline', ''), 'all');
  v_source := coalesce(nullif(v_rules ->> 'source', ''), 'all');
  v_last_seen_period := coalesce(nullif(v_rules ->> 'last_seen_period', ''), 'all');
  v_created_period := coalesce(nullif(v_rules ->> 'created_period', ''), 'all');
  v_exclude_unknown_pipeline := coalesce((v_rules ->> 'exclude_unknown_pipeline')::boolean, false);
  if v_pipeline not in ('all', 'finance', 'rent2buy', 'both') then raise exception 'Unsupported audience pipeline filter.'; end if;
  if v_last_seen_period not in ('all', 'last30', 'last90', 'last180', 'last365', 'more_than_180') then raise exception 'Unsupported last seen filter.'; end if;
  if v_created_period not in ('all', 'today', 'last7', 'last30', 'last90', 'this_year') then raise exception 'Unsupported created date filter.'; end if;

  select coalesce(array_agg(value), '{}') into v_required_tags
  from jsonb_array_elements_text(coalesce(v_rules -> 'required_tags', '[]'::jsonb)) as value;
  select coalesce(array_agg(value), '{}') into v_exclude_tags
  from jsonb_array_elements_text(coalesce(v_rules -> 'exclude_tags', '[]'::jsonb)) as value;

  return query
  select c.id, c.last_seen_at, c.created_at
  from public.marketing_contacts c
  where c.lifecycle_status = 'active'
    and c.marketing_status = 'active'
    and not public.marketing_channel_suppressed(c.suppression, v_campaign.channel)
    and (
      v_campaign.channel <> 'email'
      or not exists (
        select 1 from public.marketing_suppression_identities si
        where si.email_normalized = lower(trim(coalesce(c.email_normalized, c.email)))
      )
    )
    and (
      (v_campaign.channel = 'email' and c.email_ready = true)
      or (v_campaign.channel = 'sms' and c.sms_ready = true)
      or (v_campaign.channel = 'facebook' and c.facebook_ready = true)
    )
    and (v_pipeline = 'all' or c.pipeline = v_pipeline)
    and (v_source = 'all' or c.source = v_source)
    and (not v_exclude_unknown_pipeline or coalesce(c.pipeline, '') not in ('', 'unknown'))
    and (coalesce(array_length(v_required_tags, 1), 0) = 0 or c.tags && v_required_tags)
    and (coalesce(array_length(v_exclude_tags, 1), 0) = 0 or not (c.tags && v_exclude_tags))
    and (
      v_last_seen_period = 'all'
      or (v_last_seen_period = 'last30' and c.last_seen_at >= now() - interval '30 days')
      or (v_last_seen_period = 'last90' and c.last_seen_at >= now() - interval '90 days')
      or (v_last_seen_period = 'last180' and c.last_seen_at >= now() - interval '180 days')
      or (v_last_seen_period = 'last365' and c.last_seen_at >= now() - interval '365 days')
      or (v_last_seen_period = 'more_than_180' and c.last_seen_at < now() - interval '180 days')
    )
    and (
      v_created_period = 'all'
      or (v_created_period = 'today' and c.created_at >= (date_trunc('day', now() at time zone 'Europe/London') at time zone 'Europe/London'))
      or (v_created_period = 'last7' and c.created_at >= now() - interval '7 days')
      or (v_created_period = 'last30' and c.created_at >= now() - interval '30 days')
      or (v_created_period = 'last90' and c.created_at >= now() - interval '90 days')
      or (v_created_period = 'this_year' and c.created_at >= date_trunc('year', now()))
    )
    and (
      not p_exclude_batched
      or not exists (
        select 1
        from public.marketing_campaign_batch_customers bcx
        join public.marketing_contacts prior_contact on prior_contact.id = bcx.customer_id
        where bcx.campaign_id = p_campaign_id
          and (
            bcx.customer_id = c.id
            or (
              nullif(lower(trim(coalesce(c.email_normalized, c.email))), '') is not null
              and lower(trim(coalesce(prior_contact.email_normalized, prior_contact.email))) = lower(trim(coalesce(c.email_normalized, c.email)))
            )
          )
      )
    );
end;
$$;

revoke all on table public.marketing_suppression_identities from public, anon, authenticated;
revoke all on table public.marketing_database_clear_audit from public, anon, authenticated;
grant all on table public.marketing_suppression_identities to service_role;
grant all on table public.marketing_database_clear_audit to service_role;
revoke all on function public.marketing_clear_active_customer_database(uuid, text) from public, anon, authenticated;
grant execute on function public.marketing_clear_active_customer_database(uuid, text) to service_role;
revoke all on function public.marketing_prevent_duplicate_campaign_email() from public, anon, authenticated;
grant execute on function public.marketing_prevent_duplicate_campaign_email() to service_role;
revoke all on function public.marketing_guard_active_suppressed_email() from public, anon, authenticated;
revoke all on function public.marketing_hide_suppressed_email_contacts() from public, anon, authenticated;
