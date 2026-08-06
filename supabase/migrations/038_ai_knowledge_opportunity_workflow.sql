-- Internal AI Knowledge Opportunities workflow and traffic-light lifecycle.
-- Additive only: no prompt, retrieval, Wix or public endpoint changes.

alter table public.knowledge_assistant_opportunities
  drop constraint if exists knowledge_assistant_opportunities_status_check;

alter table public.knowledge_assistant_opportunities
  add constraint knowledge_assistant_opportunities_status_check check (status in (
    'new','reviewing','covered_existing','improve_business_brain','improve_existing_article',
    'create_faq','create_article','dismissed','completed','review_later','no_action_required',
    'draft_created','resolved','closed','reopened'
  ));

alter table public.knowledge_assistant_opportunities
  add column if not exists linked_topic_id uuid references public.knowledge_topics(id) on delete set null,
  add column if not exists cluster_fingerprint text not null default '',
  add column if not exists evidence_fingerprint text not null default '',
  add column if not exists closure_reason text not null default '',
  add column if not exists closed_at timestamptz,
  add column if not exists review_later_at timestamptz,
  add column if not exists no_action_at timestamptz,
  add column if not exists draft_created_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists reopened_at timestamptz,
  add column if not exists reopen_reason text not null default '';

update public.knowledge_assistant_opportunities
set cluster_fingerprint = lower(product || ':' || normalised_intent)
where cluster_fingerprint = '';

create index if not exists knowledge_assistant_opportunities_cluster_fingerprint_idx
  on public.knowledge_assistant_opportunities (cluster_fingerprint);

create index if not exists knowledge_assistant_opportunities_workflow_idx
  on public.knowledge_assistant_opportunities (status, updated_at desc);

comment on column public.knowledge_assistant_opportunities.cluster_fingerprint is
  'Stable product-and-intent cluster identity used to preserve closed workflow decisions.';
comment on column public.knowledge_assistant_opportunities.evidence_fingerprint is
  'Deterministic evidence snapshot used to prevent unchanged analysis from reopening closed opportunities.';
