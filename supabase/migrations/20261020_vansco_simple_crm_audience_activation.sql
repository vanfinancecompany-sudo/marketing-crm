-- Vansco-only one-time, operator-attested activation for its existing imported CRM list.
-- Marketing eligibility still requires a positive operator confirmation and all shared opt-outs remain effective.
create or replace function public.vansco_email_confirm_crm_audience(p_basis text, p_confirm boolean)
returns jsonb language plpgsql security invoker set search_path='public' as $$
declare v_basis text;v_notes text;v_count integer;v_eligible integer;
begin
 if p_confirm is distinct from true or p_basis not in ('existing_customer','consent') then
   raise exception 'Confirm the actual Vansco customer marketing permission before activating the list';
 end if;
 v_basis := case when p_basis='consent' then 'consent' else 'legitimate_interest' end;
 v_notes := case when p_basis='consent' then
  'Vansco operator attests that these imported CRM contacts have an existing recorded marketing consent that has not been withdrawn; a recipient-level audit is maintained in the original CRM.'
 else
  'Vansco operator attests existing customer or enquiry relationships, comparable vans marketing, an opt-out offered when details were collected, and no subsequent marketing objection; original CRM maintains the underlying evidence.'
 end;
 with updated as (
  update public.marketing_vansco_email_contacts
   set status='ready',marketing_basis=v_basis,reviewed_at=now(),
       permission_notes=v_notes,updated_at=now()
   where status='pending_review' and source in ('VANSCO','vansco_customer_export_20261012')
     and lower(coalesce(verifalia_classification,'')) in ('deliverable','risky')
   returning source
 ), audit as (
  insert into public.marketing_vansco_email_review_audit
    (source,reviewed_by,evidence_reference,marketing_basis,include_risky,approved_count,notes)
  select source,'Authenticated Vansco Email Studio operator',
    'One-time operator confirmation; underlying original Vansco CRM records',
    v_basis,true,count(*)::integer,v_notes
  from updated group by source
  returning approved_count
 )
 select coalesce(sum(approved_count),0)::integer into v_count from audit;
 select count(*)::integer into v_eligible from public.marketing_vansco_email_eligibility where eligible;
 return jsonb_build_object('activated',v_count,'eligible_now',v_eligible,
   'note','Existing global suppressions, bounces, opt-outs and sending-frequency locks continue to apply.');
end;
$$;
revoke all on function public.vansco_email_confirm_crm_audience(text,boolean) from public,anon,authenticated;
grant execute on function public.vansco_email_confirm_crm_audience(text,boolean) to service_role;
