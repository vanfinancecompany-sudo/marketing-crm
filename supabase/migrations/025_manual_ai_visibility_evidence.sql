-- Add an explicit completed manual-check outcome without changing existing evidence history.

alter table public.knowledge_visibility_results
  drop constraint if exists knowledge_visibility_results_result_status_check;

alter table public.knowledge_visibility_results
  add constraint knowledge_visibility_results_result_status_check
  check (
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
      'inconclusive',
      'error'
    )
  );

-- Existing rows and manually verified evidence are preserved unchanged.
