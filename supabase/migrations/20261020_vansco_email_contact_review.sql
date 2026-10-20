
create or replace function public.vansco_email_approve_contact(
 p_contact uuid,p_reviewer text,p_evidence text,p_basis text,p_notes text,p_include_risky boolean
) returns jsonb language plpgsql set search_path='public' as $$
declare v_contact public.marketing_vansco_email_contacts%rowtype;v_time timestamptz:=now();
begin
 if length(trim(coalesce(p_reviewer,'')))<3 or length(trim(coalesce(p_evidence,'')))<8
 or length(trim(coalesce(p_notes,'')))<50 or p_basis not in ('consent','legitimate_interest') then
  raise exception 'Reviewer, evidence reference, permission basis and assessment notes are required';
 end if;
 select * into v_contact from public.marketing_vansco_email_contacts where id=p_contact for update;
 if not found or v_contact.status<>'pending_review' then raise exception 'Contact unavailable for review'; end if;
 if lower(coalesce(v_contact.verifalia_classification,''))='risky' and not coalesce(p_include_risky,false)
 then raise exception 'Confirm inclusion of this risky-classification contact'; end if;
 update public.marketing_vansco_email_contacts
 set status='ready',marketing_basis=p_basis,reviewed_at=v_time,updated_at=v_time,
 permission_notes=left('Reviewed by '||p_reviewer||'; evidence: '||p_evidence||'; '||p_notes,4000)
 where id=p_contact and status='pending_review';
 insert into public.marketing_vansco_email_review_audit
 (source,reviewed_by,evidence_reference,marketing_basis,include_risky,approved_count,notes,reviewed_at)
 values('individual:'||p_contact,p_reviewer,p_evidence,p_basis,p_include_risky,1,p_notes,v_time);
 return jsonb_build_object('approved',1,'id',p_contact);
end;
$$;
revoke all on function public.vansco_email_approve_contact(uuid,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.vansco_email_approve_contact(uuid,text,text,text,text,boolean) to service_role;
