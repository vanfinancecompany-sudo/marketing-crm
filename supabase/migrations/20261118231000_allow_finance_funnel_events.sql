begin;

set local lock_timeout = '3s';

-- The existing validated check already establishes that historical rows are
-- valid under the wider allowlist. Enforce the replacement for new writes
-- immediately and validate the historical rows separately.
lock table public.site_analytics_events in access exclusive mode;

do $$
declare
  previous_names text[] := array[
    'session_start', 'session_activity', 'session_end', 'page_view',
    'engagement', 'vehicle_view', 'finance_application_reached',
    'finance_application_completed', 'rent2buy_postcode_gate_reached',
    'rent2buy_postcode_pass', 'rent2buy_postcode_fail',
    'rent2buy_full_application_opened', 'rent2buy_application_completed',
    'part_exchange_started', 'part_exchange_completed'
  ];
  expected_definition text;
  existing_definition text;
  existing_validated boolean;
begin
  select 'CHECK ((event_name = ANY (ARRAY[' ||
    string_agg(quote_literal(name) || '::text', ', ' order by position) || '])))'
    into expected_definition
    from unnest(previous_names) with ordinality as names(name, position);

  select pg_get_constraintdef(oid), convalidated
    into existing_definition, existing_validated
    from pg_constraint
    where conrelid = 'public.site_analytics_events'::regclass
      and conname = 'site_analytics_events_event_name_check';

  if existing_definition is distinct from expected_definition
    or existing_validated is distinct from true then
    raise exception 'Unexpected site analytics event allowlist. Review the current constraint before widening it.';
  end if;

  alter table public.site_analytics_events
    drop constraint site_analytics_events_event_name_check,
    add constraint site_analytics_events_event_name_check check (event_name in (
      'session_start', 'session_activity', 'session_end', 'page_view',
      'engagement', 'vehicle_view', 'finance_application_reached',
      'finance_application_completed', 'rent2buy_postcode_gate_reached',
      'rent2buy_postcode_pass', 'rent2buy_postcode_fail',
      'rent2buy_full_application_opened', 'rent2buy_application_completed',
      'part_exchange_started', 'part_exchange_completed',
      'finance_application_started', 'finance_application_step_viewed',
      'finance_application_step_blocked', 'finance_application_submit_attempted',
      'finance_application_submit_failed'
    )) not valid;
end $$;

commit;
