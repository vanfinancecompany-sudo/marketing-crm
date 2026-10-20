
-- Vansco-only audit trail for documentary, source-level marketing permission decisions.
create table if not exists public.marketing_vansco_email_review_audit (
 id uuid primary key default gen_random_uuid(),
 source text not null,
 reviewed_by text not null,
 evidence_reference text not null,
 marketing_basis text not null check(marketing_basis in ('consent','legitimate_interest')),
 include_risky boolean not null default false,
 approved_count integer not null default 0,
 notes text not null,
 reviewed_at timestamptz not null default now()
);
alter table public.marketing_vansco_email_review_audit enable row level security;
revoke all on public.marketing_vansco_email_review_audit from public,anon,authenticated;
create or replace function public.vansco_email_approve_source(
 p_source text,p_reviewer text,p_evidence text,p_basis text,p_notes text,p_include_risky boolean
) returns jsonb language plpgsql set search_path='public' as $$
declare v_ids uuid[];v_n integer;v_remaining integer;v_now timestamptz:=now();
begin
 if nullif(trim(p_source),'') is null or length(trim(p_reviewer))<3
    or length(trim(p_evidence))<8 or length(trim(p_notes))<50
    or p_basis not in ('consent','legitimate_interest') then
  raise exception 'Verified source, reviewer, evidence reference, marketing basis and 50-character permission assessment are required';
 end if;
 select array_agg(id) into v_ids from (
  select id from public.marketing_vansco_email_contacts
  where source=p_source and status='pending_review'
  and (coalesce(p_include_risky,false) or lower(coalesce(verifalia_classification,''))<>'risky')
  order by created_at,id limit 500 for update skip locked
 ) picked;
 v_n:=coalesce(array_length(v_ids,1),0);
 if v_n>0 then
  update public.marketing_vansco_email_contacts
   set status='ready', marketing_basis=p_basis,
   permission_notes=left('Reviewed by '||p_reviewer||'; evidence: '||p_evidence||'; source: '||p_source||'; '||p_notes,4000),
   reviewed_at=v_now,updated_at=v_now
   where id=any(v_ids) and status='pending_review';
  insert into public.marketing_vansco_email_review_audit
   (source,reviewed_by,evidence_reference,marketing_basis,include_risky,approved_count,notes,reviewed_at)
  values(p_source,p_reviewer,p_evidence,p_basis,p_include_risky,v_n,p_notes,v_now);
 end if;
 select count(*) into v_remaining from public.marketing_vansco_email_contacts
  where source=p_source and status='pending_review'
  and (p_include_risky or lower(coalesce(verifalia_classification,''))<>'risky');
 return jsonb_build_object('approved',v_n,'more_pending',v_remaining>0,'remaining_for_selection',v_remaining);
end;
$$;
revoke all on function public.vansco_email_approve_source(text,text,text,text,text,boolean) from public,anon,authenticated;
