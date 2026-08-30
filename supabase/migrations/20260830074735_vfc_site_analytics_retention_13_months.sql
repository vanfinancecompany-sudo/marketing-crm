create extension if not exists pg_cron;

do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'vfc_site_analytics_retention_13m'
  ) then
    perform cron.unschedule('vfc_site_analytics_retention_13m');
  end if;
end
$$;

select cron.schedule(
  'vfc_site_analytics_retention_13m',
  '17 3 * * *',
  $job$
    delete from public.site_analytics_sessions
    where started_at < now() - interval '13 months';
  $job$
);
