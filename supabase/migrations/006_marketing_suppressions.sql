-- Marketing CRM suppression centre foundation
-- Additive customer safety metadata plus mandatory campaign-batch exclusion.

alter table public.marketing_contacts
  add column if not exists suppression jsonb not null default '{}'::jsonb,
  add column if not exists suppression_history jsonb not null default '[]'::jsonb;

create index if not exists marketing_contacts_marketing_status_idx
  on public.marketing_contacts (marketing_status);

create index if not exists marketing_contacts_suppression_gin_idx
  on public.marketing_contacts using gin (suppression);

create or replace function public.marketing_suppression_is_active(p_entry jsonb)
returns boolean
language sql
immutable
as $$
  select p_entry is not null
    and jsonb_typeof(p_entry) = 'object'
    and coalesce((p_entry ->> 'active')::boolean, true);
$$;

create or replace function public.marketing_contact_is_suppressed(
  p_marketing_status text,
  p_suppression jsonb
)
returns boolean
language sql
stable
as $$
  select coalesce(p_marketing_status, 'active') <> 'active'
    or exists (
      select 1
      from jsonb_each(coalesce(p_suppression, '{}'::jsonb)) as entry(type, value)
      where public.marketing_suppression_is_active(entry.value)
    );
$$;

create or replace function public.marketing_channel_suppressed(
  p_suppression jsonb,
  p_channel text
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from jsonb_each(coalesce(p_suppression, '{}'::jsonb)) as entry(type, value)
    where public.marketing_suppression_is_active(entry.value)
      and (
        entry.type in ('manual_suppression', 'global_do_not_contact')
        or (p_channel = 'email' and entry.type in ('email_unsubscribed', 'email_bounced'))
        or (p_channel = 'sms' and entry.type = 'sms_opt_out')
        or (p_channel = 'facebook' and entry.type = 'facebook_excluded')
      )
  );
$$;

create or replace function public.marketing_suppression_overview(
  p_recent_limit integer default 10,
  p_history_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_contacts integer;
  v_suppressed_contacts integer;
  v_totals jsonb := jsonb_build_object(
    'email_unsubscribed', 0,
    'email_bounced', 0,
    'sms_opt_out', 0,
    'facebook_excluded', 0,
    'manual_suppression', 0,
    'global_do_not_contact', 0
  );
  v_recent jsonb;
  v_history jsonb;
  v_reason record;
begin
  select count(*)::integer into v_total_contacts
  from public.marketing_contacts;

  select count(*)::integer into v_suppressed_contacts
  from public.marketing_contacts c
  where public.marketing_contact_is_suppressed(c.marketing_status, c.suppression);

  for v_reason in
    select entry.type, count(distinct c.id)::integer as reason_count
    from public.marketing_contacts c
    cross join lateral jsonb_each(coalesce(c.suppression, '{}'::jsonb)) as entry(type, value)
    where entry.type in ('email_unsubscribed', 'email_bounced', 'sms_opt_out', 'facebook_excluded', 'manual_suppression', 'global_do_not_contact')
      and public.marketing_suppression_is_active(entry.value)
    group by entry.type
  loop
    v_totals := jsonb_set(v_totals, array[v_reason.type], to_jsonb(v_reason.reason_count), true);
  end loop;

  v_totals := jsonb_set(
    v_totals,
    '{manual_suppression}',
    to_jsonb(
      ((v_totals ->> 'manual_suppression')::integer + (
        select count(*)::integer
        from public.marketing_contacts c
        where coalesce(c.marketing_status, 'active') <> 'active'
          and not exists (
            select 1
            from jsonb_each(coalesce(c.suppression, '{}'::jsonb)) as entry(type, value)
            where public.marketing_suppression_is_active(entry.value)
          )
      ))
    ),
    true
  );

  select coalesce(jsonb_agg(to_jsonb(recent_row)), '[]'::jsonb) into v_recent
  from (
    select
      c.id,
      c.customer_id,
      c.first_name,
      c.last_name,
      c.company,
      c.email,
      c.phone,
      c.postcode,
      c.pipeline,
      c.source,
      c.marketing_status,
      c.email_ready,
      c.sms_ready,
      c.facebook_ready,
      c.suppression,
      c.suppression_history,
      c.created_at,
      c.updated_at,
      public.marketing_contact_is_suppressed(c.marketing_status, c.suppression) as is_suppressed
    from public.marketing_contacts c
    where public.marketing_contact_is_suppressed(c.marketing_status, c.suppression)
    order by c.updated_at desc nulls last, c.created_at desc nulls last
    limit greatest(1, least(coalesce(p_recent_limit, 10), 50))
  ) recent_row;

  select coalesce(jsonb_agg(history_row.payload order by history_row.event_at desc nulls last), '[]'::jsonb) into v_history
  from (
    select
      nullif(history.entry ->> 'added_at', '')::timestamptz as event_at,
      jsonb_build_object(
        'customer', trim(concat_ws(' ', c.first_name, c.last_name)),
        'customer_id', c.customer_id,
        'action', history.entry ->> 'action',
        'type', history.entry ->> 'type',
        'label', history.entry ->> 'label',
        'reason', history.entry ->> 'reason',
        'added_at', history.entry ->> 'added_at',
        'added_by', history.entry ->> 'added_by',
        'notes', history.entry ->> 'notes',
        'previous_reason', history.entry ->> 'previous_reason'
      ) as payload
    from public.marketing_contacts c
    cross join lateral jsonb_array_elements(coalesce(c.suppression_history, '[]'::jsonb)) as history(entry)
    where history.entry ->> 'type' in ('email_unsubscribed', 'email_bounced', 'sms_opt_out', 'facebook_excluded', 'manual_suppression', 'global_do_not_contact')
    order by nullif(history.entry ->> 'added_at', '')::timestamptz desc nulls last
    limit greatest(1, least(coalesce(p_history_limit, 100), 250))
  ) history_row;

  return jsonb_build_object(
    'overview', jsonb_build_object(
      'total_contacts', v_total_contacts,
      'suppressed_contacts', v_suppressed_contacts,
      'active_contacts', greatest(0, v_total_contacts - v_suppressed_contacts)
    ),
    'totals', v_totals,
    'recent', v_recent,
    'history', v_history,
    'labels', jsonb_build_object(
      'email_unsubscribed', 'Email Unsubscribed',
      'email_bounced', 'Email Bounced',
      'sms_opt_out', 'SMS Opt-out',
      'facebook_excluded', 'Facebook Excluded',
      'manual_suppression', 'Manual Suppression',
      'global_do_not_contact', 'Global Do Not Contact'
    )
  );
end;
$$;

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
begin
  if v_type not in ('email_unsubscribed', 'email_bounced', 'sms_opt_out', 'facebook_excluded', 'manual_suppression', 'global_do_not_contact') then
    raise exception 'Unsupported suppression type.';
  end if;

  select * into v_contact
  from public.marketing_contacts
  where id = p_contact_id
  for update;

  if not found then
    raise exception 'Contact not found.';
  end if;

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
  set
    suppression = coalesce(v_contact.suppression, '{}'::jsonb) || jsonb_build_object(v_type, v_entry),
    suppression_history = jsonb_build_array(v_history_entry) || coalesce(v_contact.suppression_history, '[]'::jsonb),
    updated_at = v_now
  where id = v_contact.id
  returning * into v_contact;

  return next v_contact;
end;
$$;

create or replace function public.marketing_remove_suppression(
  p_contact_id uuid,
  p_type text,
  p_reason text default 'Suppression removed',
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
  v_removed jsonb;
  v_history_entry jsonb;
begin
  if v_type not in ('email_unsubscribed', 'email_bounced', 'sms_opt_out', 'facebook_excluded', 'manual_suppression', 'global_do_not_contact') then
    raise exception 'Unsupported suppression type.';
  end if;

  select * into v_contact
  from public.marketing_contacts
  where id = p_contact_id
  for update;

  if not found then
    raise exception 'Contact not found.';
  end if;

  v_removed := coalesce(v_contact.suppression, '{}'::jsonb) -> v_type;

  v_history_entry := jsonb_build_object(
    'action', 'removed',
    'type', v_type,
    'label', case v_type
      when 'email_unsubscribed' then 'Email Unsubscribed'
      when 'email_bounced' then 'Email Bounced'
      when 'sms_opt_out' then 'SMS Opt-out'
      when 'facebook_excluded' then 'Facebook Excluded'
      when 'manual_suppression' then 'Manual Suppression'
      when 'global_do_not_contact' then 'Global Do Not Contact'
    end,
    'reason', left(trim(coalesce(nullif(p_reason, ''), 'Suppression removed')), 500),
    'added_at', v_now,
    'added_by', left(trim(coalesce(nullif(p_added_by, ''), 'Marketing CRM')), 500),
    'notes', left(trim(coalesce(p_notes, '')), 500),
    'previous_reason', coalesce(v_removed ->> 'reason', '')
  );

  update public.marketing_contacts
  set
    suppression = coalesce(v_contact.suppression, '{}'::jsonb) - v_type,
    suppression_history = jsonb_build_array(v_history_entry) || coalesce(v_contact.suppression_history, '[]'::jsonb),
    updated_at = v_now
  where id = v_contact.id
  returning * into v_contact;

  return next v_contact;
end;
$$;

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
  select * into v_campaign
  from public.marketing_campaigns
  where id = p_campaign_id;

  if not found then
    raise exception 'Campaign not found.';
  end if;

  if v_campaign.status = 'archived' then
    raise exception 'Archived campaigns cannot generate batches.';
  end if;

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

  if v_pipeline not in ('all', 'finance', 'rent2buy', 'both') then
    raise exception 'Unsupported audience pipeline filter.';
  end if;

  if v_last_seen_period not in ('all', 'last30', 'last90', 'last180', 'last365', 'more_than_180') then
    raise exception 'Unsupported last seen filter.';
  end if;

  if v_created_period not in ('all', 'today', 'last7', 'last30', 'last90', 'this_year') then
    raise exception 'Unsupported created date filter.';
  end if;

  select coalesce(array_agg(value), '{}') into v_required_tags
  from jsonb_array_elements_text(coalesce(v_rules -> 'required_tags', '[]'::jsonb)) as value;

  select coalesce(array_agg(value), '{}') into v_exclude_tags
  from jsonb_array_elements_text(coalesce(v_rules -> 'exclude_tags', '[]'::jsonb)) as value;

  return query
  select c.id, c.last_seen_at, c.created_at
  from public.marketing_contacts c
  where
    c.marketing_status = 'active'
    and not public.marketing_channel_suppressed(c.suppression, v_campaign.channel)
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
        where bcx.campaign_id = p_campaign_id
          and bcx.customer_id = c.id
      )
    );
end;
$$;

revoke all on function public.marketing_suppression_is_active(jsonb) from public;
revoke all on function public.marketing_suppression_is_active(jsonb) from anon;
revoke all on function public.marketing_suppression_is_active(jsonb) from authenticated;
grant execute on function public.marketing_suppression_is_active(jsonb) to service_role;

revoke all on function public.marketing_contact_is_suppressed(text, jsonb) from public;
revoke all on function public.marketing_contact_is_suppressed(text, jsonb) from anon;
revoke all on function public.marketing_contact_is_suppressed(text, jsonb) from authenticated;
grant execute on function public.marketing_contact_is_suppressed(text, jsonb) to service_role;

revoke all on function public.marketing_channel_suppressed(jsonb, text) from public;
revoke all on function public.marketing_channel_suppressed(jsonb, text) from anon;
revoke all on function public.marketing_channel_suppressed(jsonb, text) from authenticated;
grant execute on function public.marketing_channel_suppressed(jsonb, text) to service_role;

revoke all on function public.marketing_suppression_overview(integer, integer) from public;
revoke all on function public.marketing_suppression_overview(integer, integer) from anon;
revoke all on function public.marketing_suppression_overview(integer, integer) from authenticated;
grant execute on function public.marketing_suppression_overview(integer, integer) to service_role;

revoke all on function public.marketing_apply_suppression(uuid, text, text, text, text) from public;
revoke all on function public.marketing_apply_suppression(uuid, text, text, text, text) from anon;
revoke all on function public.marketing_apply_suppression(uuid, text, text, text, text) from authenticated;
grant execute on function public.marketing_apply_suppression(uuid, text, text, text, text) to service_role;

revoke all on function public.marketing_remove_suppression(uuid, text, text, text, text) from public;
revoke all on function public.marketing_remove_suppression(uuid, text, text, text, text) from anon;
revoke all on function public.marketing_remove_suppression(uuid, text, text, text, text) from authenticated;
grant execute on function public.marketing_remove_suppression(uuid, text, text, text, text) to service_role;

revoke all on function public.marketing_campaign_batch_eligible_customer_ids(uuid, boolean) from public;
revoke all on function public.marketing_campaign_batch_eligible_customer_ids(uuid, boolean) from anon;
revoke all on function public.marketing_campaign_batch_eligible_customer_ids(uuid, boolean) from authenticated;
grant execute on function public.marketing_campaign_batch_eligible_customer_ids(uuid, boolean) to service_role;
