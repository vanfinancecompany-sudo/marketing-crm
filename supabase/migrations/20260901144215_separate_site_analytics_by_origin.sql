alter table public.site_analytics_sessions
  add column if not exists site_origin text;

alter table public.site_analytics_events
  add column if not exists site_origin text;

update public.site_analytics_sessions
set site_origin = 'https://www.vanfinancecompany.co.uk'
where site_origin is null or btrim(site_origin) = '';

update public.site_analytics_events
set site_origin = case
  when lower(page_url) like 'https://www.rent2buyvans.co.uk/%'
    or lower(page_url) like 'https://rent2buyvans.co.uk/%'
    then 'https://www.rent2buyvans.co.uk'
  else 'https://www.vanfinancecompany.co.uk'
end
where site_origin is null or btrim(site_origin) = '';

alter table public.site_analytics_sessions
  alter column site_origin set default 'https://www.vanfinancecompany.co.uk',
  alter column site_origin set not null;

alter table public.site_analytics_events
  alter column site_origin set default 'https://www.vanfinancecompany.co.uk',
  alter column site_origin set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'site_analytics_sessions_site_origin_check'
      and conrelid = 'public.site_analytics_sessions'::regclass
  ) then
    alter table public.site_analytics_sessions
      add constraint site_analytics_sessions_site_origin_check
      check (site_origin in (
        'https://www.vanfinancecompany.co.uk',
        'https://www.rent2buyvans.co.uk'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'site_analytics_events_site_origin_check'
      and conrelid = 'public.site_analytics_events'::regclass
  ) then
    alter table public.site_analytics_events
      add constraint site_analytics_events_site_origin_check
      check (site_origin in (
        'https://www.vanfinancecompany.co.uk',
        'https://www.rent2buyvans.co.uk'
      ));
  end if;
end
$$;

create index if not exists site_analytics_sessions_site_started_idx
  on public.site_analytics_sessions (site_origin, started_at desc);

create index if not exists site_analytics_events_site_occurred_idx
  on public.site_analytics_events (site_origin, occurred_at desc);

create or replace function public.ingest_site_analytics_event(
  p_event_id uuid,
  p_session_id text,
  p_visitor_id text,
  p_event_name text,
  p_occurred_at timestamptz,
  p_path text,
  p_page_url text,
  p_landing_path text,
  p_site_origin text,
  p_referrer text default null,
  p_source text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_device_category text default null,
  p_browser_category text default null,
  p_viewport_width integer default null,
  p_vehicle_registration text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted_rows integer := 0;
  is_page_view integer := case when p_event_name = 'page_view' then 1 else 0 end;
  is_meaningful integer := case when p_event_name in (
    'engagement', 'vehicle_view', 'finance_application_reached',
    'finance_application_completed', 'rent2buy_postcode_gate_reached',
    'rent2buy_postcode_pass', 'rent2buy_postcode_fail',
    'rent2buy_full_application_opened', 'rent2buy_application_completed',
    'part_exchange_started', 'part_exchange_completed'
  ) then 1 else 0 end;
begin
  if p_site_origin not in (
    'https://www.vanfinancecompany.co.uk',
    'https://www.rent2buyvans.co.uk'
  ) then
    raise exception 'Unsupported analytics site origin.' using errcode = '22023';
  end if;

  insert into public.site_analytics_sessions (
    session_id, visitor_id, started_at, last_activity_at, ended_at,
    landing_path, last_path, page_view_count, meaningful_event_count,
    referrer, source, utm_source, utm_medium, utm_campaign,
    device_category, browser_category, viewport_width, site_origin
  ) values (
    p_session_id, p_visitor_id, p_occurred_at, p_occurred_at,
    case when p_event_name = 'session_end' then p_occurred_at else null end,
    p_landing_path, p_path, 0, 0,
    p_referrer, p_source, p_utm_source, p_utm_medium, p_utm_campaign,
    p_device_category, p_browser_category, p_viewport_width, p_site_origin
  )
  on conflict (session_id) do nothing;

  if exists (
    select 1 from public.site_analytics_sessions
    where session_id = p_session_id and site_origin <> p_site_origin
  ) then
    raise exception 'Analytics session site origin mismatch.' using errcode = '22023';
  end if;

  insert into public.site_analytics_events (
    event_id, session_id, visitor_id, event_name, occurred_at,
    path, page_url, vehicle_registration, metadata, site_origin
  ) values (
    p_event_id, p_session_id, p_visitor_id, p_event_name, p_occurred_at,
    p_path, p_page_url, p_vehicle_registration, coalesce(p_metadata, '{}'::jsonb), p_site_origin
  )
  on conflict (event_id) do nothing;

  get diagnostics inserted_rows = row_count;
  if inserted_rows = 0 then
    delete from public.site_analytics_sessions session_row
    where session_row.session_id = p_session_id
      and not exists (
        select 1 from public.site_analytics_events event_row
        where event_row.session_id = session_row.session_id
      );
    return false;
  end if;

  update public.site_analytics_sessions
  set
    visitor_id = p_visitor_id,
    started_at = least(started_at, p_occurred_at),
    last_path = case when p_occurred_at >= last_activity_at then p_path else last_path end,
    last_activity_at = greatest(last_activity_at, p_occurred_at),
    ended_at = case when p_event_name = 'session_end' then greatest(coalesce(ended_at, p_occurred_at), p_occurred_at) else ended_at end,
    page_view_count = page_view_count + is_page_view,
    meaningful_event_count = meaningful_event_count + is_meaningful,
    source = coalesce(source, p_source),
    utm_source = coalesce(utm_source, p_utm_source),
    utm_medium = coalesce(utm_medium, p_utm_medium),
    utm_campaign = coalesce(utm_campaign, p_utm_campaign),
    referrer = coalesce(referrer, p_referrer),
    device_category = coalesce(device_category, p_device_category),
    browser_category = coalesce(browser_category, p_browser_category),
    viewport_width = coalesce(viewport_width, p_viewport_width),
    updated_at = now()
  where session_id = p_session_id
    and site_origin = p_site_origin;

  return true;
end;
$$;

revoke all on function public.ingest_site_analytics_event(
  uuid, text, text, text, timestamptz, text, text, text, text,
  text, text, text, text, text, text, text, integer, text, jsonb
) from public, anon, authenticated;

grant execute on function public.ingest_site_analytics_event(
  uuid, text, text, text, timestamptz, text, text, text, text,
  text, text, text, text, text, text, text, integer, text, jsonb
) to service_role;
