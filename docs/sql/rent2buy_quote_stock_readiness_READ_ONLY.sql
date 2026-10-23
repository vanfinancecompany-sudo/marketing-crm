-- READ ONLY. Audit existing DealerKit monitor without triggering a stock refresh.
-- This query must not be scheduled to increase DealerKit traffic.
-- "theoretical_90s_coverage_pct" is a schedule-derived UPPER BOUND,
-- NOT an uptime measurement and NOT proof an individual advert remains current.
WITH runs AS (
  SELECT started_at, completed_at, status,
    snapshot #>> '{provider,complete}' AS source_complete,
    snapshot #>> '{provider,diagnostics,complete}' AS diagnostics_complete,
    snapshot #>> '{provider,diagnostics,stableReportedTotal}' AS stable_total,
    snapshot #>> '{provider,refresh,status}' AS refresh_status,
    LAG(started_at) OVER (ORDER BY started_at) AS previous_started_at
  FROM public.stock_watch_monitor_runs
  WHERE provider_id='dealerkit' AND started_at >= now()-INTERVAL '24 hours'
), measured AS (
  SELECT *,
    EXTRACT(EPOCH FROM started_at-previous_started_at) AS cadence_seconds,
    EXTRACT(EPOCH FROM completed_at-started_at) AS duration_seconds
  FROM runs
)
SELECT count(*) AS monitor_runs,
  count(*) FILTER (
    WHERE status='complete' AND source_complete='true'
      AND diagnostics_complete='true' AND stable_total='true'
      AND refresh_status='complete'
  ) AS verified_complete_runs,
  round(avg(cadence_seconds)::numeric,1) AS average_cadence_seconds,
  round((percentile_cont(0.95) WITHIN GROUP (ORDER BY cadence_seconds))::numeric,1) AS p95_cadence_seconds,
  round(avg(duration_seconds)::numeric,2) AS avg_monitor_duration_seconds,
  round(max(duration_seconds)::numeric,2) AS max_monitor_duration_seconds,
  CASE WHEN percentile_cont(0.95) WITHIN GROUP (ORDER BY cadence_seconds)>0
    THEN round((100*least(1,90/(percentile_cont(0.95) WITHIN GROUP (ORDER BY cadence_seconds))))::numeric,2)
    ELSE NULL END AS theoretical_90s_coverage_pct
FROM measured;
