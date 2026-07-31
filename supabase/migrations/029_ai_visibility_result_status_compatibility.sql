-- Align the production AI Visibility result-status constraint with every status
-- currently written and read by the Marketing CRM.
--
-- This migration is additive to the permitted value set only. It does not
-- update, delete or otherwise rewrite historical evidence rows.

begin;

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
  ) not valid;

-- Validate all existing rows against the authoritative application status set.
-- PostgreSQL preserves the rows while validating; the transaction rolls back
-- rather than silently changing evidence if an unexpected historical value is
-- present.
alter table public.knowledge_visibility_results
  validate constraint knowledge_visibility_results_result_status_check;

commit;
