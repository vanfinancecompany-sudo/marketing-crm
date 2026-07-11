-- Marketing CRM campaign batch engine foundation
-- Additive only: does not modify existing customer or campaign records.

create extension if not exists pgcrypto;

create table if not exists public.marketing_campaign_batches (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marketing_campaigns(id),
  batch_number integer not null,
  status text not null default 'pending'
    check (status in ('pending', 'exported', 'sent', 'cancelled')),
  requested_size integer not null check (requested_size > 0),
  customer_count integer not null default 0 check (customer_count >= 0),
  audience_rules jsonb not null default '{}'::jsonb,
  audience_calculated_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  exported_at timestamptz,
  sent_at timestamptz,
  cancelled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique (campaign_id, batch_number)
);

drop trigger if exists marketing_campaign_batches_set_updated_at on public.marketing_campaign_batches;
create trigger marketing_campaign_batches_set_updated_at
before update on public.marketing_campaign_batches
for each row execute function public.set_marketing_updated_at();

create index if not exists marketing_campaign_batches_campaign_id_idx
  on public.marketing_campaign_batches (campaign_id);

create index if not exists marketing_campaign_batches_status_idx
  on public.marketing_campaign_batches (status);

create index if not exists marketing_campaign_batches_created_at_idx
  on public.marketing_campaign_batches (created_at desc);

create table if not exists public.marketing_campaign_batch_customers (
  batch_id uuid not null references public.marketing_campaign_batches(id),
  campaign_id uuid not null references public.marketing_campaigns(id),
  customer_id uuid not null references public.marketing_contacts(id),
  added_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (batch_id, customer_id),
  unique (campaign_id, customer_id)
);

create index if not exists marketing_campaign_batch_customers_campaign_id_idx
  on public.marketing_campaign_batch_customers (campaign_id);

create index if not exists marketing_campaign_batch_customers_customer_id_idx
  on public.marketing_campaign_batch_customers (customer_id);

create index if not exists marketing_campaign_batch_customers_batch_id_idx
  on public.marketing_campaign_batch_customers (batch_id);

alter table public.marketing_campaign_batches enable row level security;
alter table public.marketing_campaign_batch_customers enable row level security;

-- No permissive public policies are created here.
-- The app accesses these tables through protected server-side API routes.

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
    (
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

create or replace function public.marketing_preview_next_campaign_batch(
  p_campaign_id uuid,
  p_requested_size integer
)
returns table(
  eligible_count integer,
  already_batched integer,
  remaining_count integer,
  requested_size integer,
  selected_count integer,
  next_batch_number integer,
  total_batches integer,
  total_customers_batched integer
)
language plpgsql
as $$
begin
  if p_requested_size is null or p_requested_size < 1 or p_requested_size > 5000 then
    raise exception 'Batch size must be between 1 and 5000.';
  end if;

  return query
  with eligible as (
    select customer_id from public.marketing_campaign_batch_eligible_customer_ids(p_campaign_id, false)
  ),
  remaining as (
    select customer_id from public.marketing_campaign_batch_eligible_customer_ids(p_campaign_id, true)
  ),
  batch_totals as (
    select
      count(*)::integer as total_batches,
      coalesce(sum(customer_count), 0)::integer as total_customers_batched,
      coalesce(max(batch_number), 0)::integer + 1 as next_batch_number
    from public.marketing_campaign_batches
    where campaign_id = p_campaign_id
  ),
  already as (
    select count(distinct customer_id)::integer as already_batched
    from public.marketing_campaign_batch_customers
    where campaign_id = p_campaign_id
  )
  select
    (select count(*)::integer from eligible),
    (select already_batched from already),
    (select count(*)::integer from remaining),
    p_requested_size,
    least(p_requested_size, (select count(*)::integer from remaining)),
    batch_totals.next_batch_number,
    batch_totals.total_batches,
    batch_totals.total_customers_batched
  from batch_totals;
end;
$$;

create or replace function public.marketing_generate_campaign_batch(
  p_campaign_id uuid,
  p_requested_size integer,
  p_created_by text default null
)
returns table(
  id uuid,
  campaign_id uuid,
  batch_number integer,
  status text,
  requested_size integer,
  customer_count integer,
  audience_calculated_at timestamptz,
  created_at timestamptz,
  total_batches integer,
  total_customers_batched integer
)
language plpgsql
as $$
declare
  v_campaign record;
  v_rules jsonb;
  v_audience_calculated_at timestamptz;
  v_batch_id uuid;
  v_batch_number integer;
  v_customer_ids uuid[];
  v_inserted_count integer;
begin
  if p_requested_size is null or p_requested_size < 1 or p_requested_size > 5000 then
    raise exception 'Batch size must be between 1 and 5000.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_campaign_id::text));

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

  v_audience_calculated_at := (v_campaign.metadata #>> '{audience,calculated_at}')::timestamptz;

  select coalesce(max(mcb.batch_number), 0) + 1 into v_batch_number
  from public.marketing_campaign_batches mcb
  where mcb.campaign_id = p_campaign_id;

  select coalesce(array_agg(candidate.customer_id order by candidate.last_seen_at asc, candidate.created_at asc, candidate.customer_id asc), '{}') into v_customer_ids
  from (
    select customer_id, last_seen_at, created_at
    from public.marketing_campaign_batch_eligible_customer_ids(p_campaign_id, true)
    order by last_seen_at asc, created_at asc, customer_id asc
    limit p_requested_size
  ) candidate;

  if coalesce(array_length(v_customer_ids, 1), 0) = 0 then
    raise exception 'No eligible customers remain for this campaign.';
  end if;

  insert into public.marketing_campaign_batches (
    campaign_id,
    batch_number,
    requested_size,
    customer_count,
    audience_rules,
    audience_calculated_at,
    created_by
  ) values (
    p_campaign_id,
    v_batch_number,
    p_requested_size,
    0,
    v_rules,
    v_audience_calculated_at,
    p_created_by
  )
  returning marketing_campaign_batches.id into v_batch_id;

  insert into public.marketing_campaign_batch_customers (batch_id, campaign_id, customer_id)
  select v_batch_id, p_campaign_id, unnest(v_customer_ids);

  get diagnostics v_inserted_count = row_count;

  update public.marketing_campaign_batches
  set customer_count = v_inserted_count
  where marketing_campaign_batches.id = v_batch_id;

  return query
  select
    b.id,
    b.campaign_id,
    b.batch_number,
    b.status,
    b.requested_size,
    b.customer_count,
    b.audience_calculated_at,
    b.created_at,
    (select count(*)::integer from public.marketing_campaign_batches where marketing_campaign_batches.campaign_id = p_campaign_id),
    (select coalesce(sum(customer_count), 0)::integer from public.marketing_campaign_batches where marketing_campaign_batches.campaign_id = p_campaign_id)
  from public.marketing_campaign_batches b
  where b.id = v_batch_id;
end;
$$;

revoke all on function public.marketing_campaign_batch_eligible_customer_ids(uuid, boolean) from public;
revoke all on function public.marketing_campaign_batch_eligible_customer_ids(uuid, boolean) from anon;
revoke all on function public.marketing_campaign_batch_eligible_customer_ids(uuid, boolean) from authenticated;
grant execute on function public.marketing_campaign_batch_eligible_customer_ids(uuid, boolean) to service_role;

revoke all on function public.marketing_preview_next_campaign_batch(uuid, integer) from public;
revoke all on function public.marketing_preview_next_campaign_batch(uuid, integer) from anon;
revoke all on function public.marketing_preview_next_campaign_batch(uuid, integer) from authenticated;
grant execute on function public.marketing_preview_next_campaign_batch(uuid, integer) to service_role;

revoke all on function public.marketing_generate_campaign_batch(uuid, integer, text) from public;
revoke all on function public.marketing_generate_campaign_batch(uuid, integer, text) from anon;
revoke all on function public.marketing_generate_campaign_batch(uuid, integer, text) from authenticated;
grant execute on function public.marketing_generate_campaign_batch(uuid, integer, text) to service_role;
