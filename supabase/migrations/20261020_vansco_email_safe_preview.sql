
-- Audience preview uses exactly the same ordering and eligibility filter as the atomic batch reservation.
create or replace function public.vansco_email_preview_batch(p_campaign uuid,p_limit integer)
returns jsonb language plpgsql stable set search_path='public' as $$
declare v_total integer;v_risky integer;v_samples jsonb;
begin
 if p_limit<1 or p_limit>500 then raise exception 'Preview size must be 1 to 500'; end if;
 if not exists(select 1 from public.marketing_vansco_email_campaigns where id=p_campaign and status='draft')
 then raise exception 'Choose an active Vansco campaign draft';end if;
 with preview as (
  select c.id,c.email_normalized,c.verifalia_classification,row_number() over(order by c.created_at,c.id) rn
  from public.marketing_vansco_email_contacts c
  join public.marketing_vansco_email_eligibility e on e.id=c.id
  where e.eligible
    and not exists(select 1 from public.marketing_vansco_email_sends s
      where s.campaign_id=p_campaign and s.contact_id=c.id and s.send_type='production')
  order by c.created_at,c.id limit p_limit
 ) select count(*)::integer,
  count(*) filter(where lower(coalesce(verifalia_classification,''))='risky')::integer,
  coalesce(jsonb_agg(email_normalized order by rn) filter(where rn<=10),'[]'::jsonb)
 into v_total,v_risky,v_samples from preview;
 return jsonb_build_object('count',v_total,'risky_count',v_risky,'sample',v_samples,'requested',p_limit);
end;
$$;
revoke all on function public.vansco_email_preview_batch(uuid,integer) from public,anon,authenticated;
grant execute on function public.vansco_email_preview_batch(uuid,integer) to service_role;
grant execute on function public.vansco_email_preflight_claim(uuid) to service_role;
grant execute on function public.vansco_email_audience_summary() to service_role;
grant execute on function public.vansco_email_approve_source(text,text,text,text,text,boolean) to service_role;
