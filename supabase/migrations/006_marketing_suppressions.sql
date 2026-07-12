-- Marketing CRM suppression centre foundation
-- Additive customer safety metadata plus mandatory campaign-batch exclusion.

alter table public.marketing_contacts
  add column if not exists suppression jsonb not null default '{}'::jsonb,
  add column if not exists suppression_history jsonb not null default '[]'::jsonb;

create index if not exists marketing_contacts_marketing_status_idx
  on public.marketing_contacts (marketing_status);

create index if not exists marketing_contacts_suppression_gin_idx
  on public.marketing_contacts using gin (suppression);

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

revoke all on function public.marketing_campaign_batch_eligible_customer_ids(uuid, boolean) from public;
revoke all on function public.marketing_campaign_batch_eligible_customer_ids(uuid, boolean) from anon;
revoke all on function public.marketing_campaign_batch_eligible_customer_ids(uuid, boolean) from authenticated;
grant execute on function public.marketing_campaign_batch_eligible_customer_ids(uuid, boolean) to service_role;
