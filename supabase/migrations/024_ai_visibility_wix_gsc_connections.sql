-- Live Wix publication verification and Google Search Console evidence.
-- Additive and evidence-only. Existing manual evidence is preserved.

alter table public.knowledge_articles
  add column if not exists wix_publication_status text not null default 'unknown'
    check (wix_publication_status in ('unknown', 'draft', 'live', 'not_live', 'error')),
  add column if not exists last_wix_verification_at timestamptz;

alter table public.knowledge_visibility_results
  drop constraint if exists knowledge_visibility_results_result_status_check;

alter table public.knowledge_visibility_results
  add constraint knowledge_visibility_results_result_status_check check (
    result_status in (
      'not_checked',
      'checking',
      'indexed',
      'not_indexed',
      'performance_found',
      'detected',
      'mentioned',
      'cited',
      'not_detected',
      'error'
    )
  );

update public.knowledge_visibility_provider_connections
set
  configuration_summary = case
    when provider = 'google_search_console'
      then 'Google Search Console requires secure server OAuth credentials and a verified Search Console property.'
    else configuration_summary
  end,
  updated_at = now()
where provider = 'google_search_console';

create index if not exists knowledge_articles_wix_live_verification_idx
  on public.knowledge_articles (wix_publication_status, last_wix_verification_at desc)
  where wix_item_id is not null;

-- Tokens are never stored in these tables. Google OAuth credentials and refresh
-- tokens remain in server-side environment variables only.
