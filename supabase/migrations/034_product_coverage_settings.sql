-- Editable approved product-coverage rules for deterministic assistant evidence.
-- This adds no embeddings, vectors, article chunks or public assistant storage.

alter table public.knowledge_settings
  add column if not exists finance_covered_nations text[] not null default array['England', 'Wales', 'Scotland']::text[],
  add column if not exists rent2buy_base_postcode text not null default 'SO40 2NN',
  add column if not exists rent2buy_max_radius_miles numeric(6,2) not null default 100 check (rent2buy_max_radius_miles > 0),
  add column if not exists coverage_borderline_tolerance_miles numeric(5,2) not null default 10 check (coverage_borderline_tolerance_miles >= 0),
  add column if not exists coverage_distance_method text not null default 'straight_line' check (coverage_distance_method in ('straight_line'));

alter table public.knowledge_competence_results
  add column if not exists coverage_diagnostics jsonb not null default '{}'::jsonb check (jsonb_typeof(coverage_diagnostics) = 'object');

update public.knowledge_settings
set
  finance_covered_nations = array['England', 'Wales', 'Scotland']::text[],
  rent2buy_base_postcode = 'SO40 2NN',
  rent2buy_max_radius_miles = 100,
  coverage_borderline_tolerance_miles = 10,
  coverage_distance_method = 'straight_line'
where settings_key = 'default'
  and coalesce(array_length(finance_covered_nations, 1), 0) = 0;
