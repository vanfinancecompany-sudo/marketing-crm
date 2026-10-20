
create or replace function public.vansco_email_audience_summary()
returns jsonb language sql stable set search_path='public' as $$
select jsonb_build_object(
 'total',count(*),'approved',count(*) filter(where e.status='ready'),
 'pending_review',count(*) filter(where e.status='pending_review'),
 'suppressed',count(*) filter(where e.suppressed),
 'unsubscribed',count(*) filter(where exists(select 1 from public.marketing_suppression_identities s where s.email_normalized=e.email_normalized and s.suppression_type='email_unsubscribed')),
 'bounced',count(*) filter(where exists(select 1 from public.marketing_suppression_identities s where s.email_normalized=e.email_normalized and s.suppression_type='email_bounced')),
 'risky',count(*) filter(where lower(coalesce(c.verifalia_classification,''))='risky'),
 'unverified_delivery',count(*) filter(where coalesce(c.verifalia_classification,'')=''),
 'locked_7d',count(*) filter(where e.status='ready' and not e.suppressed and e.attempted_7d>0),
 'monthly_cap',count(*) filter(where e.status='ready' and not e.suppressed and e.attempted_7d=0 and (e.attempted_30d>=4 or e.attempted_this_month>=4)),
 'eligible',count(*) filter(where e.eligible),'remaining',count(*) filter(where e.eligible),
 'queued',count(*) filter(where exists(select 1 from public.marketing_vansco_email_sends s where s.contact_id=e.id and s.send_type='production' and s.status in ('queued','attempting')))
) from public.marketing_vansco_email_eligibility e
join public.marketing_vansco_email_contacts c on c.id=e.id;
$$;
revoke all on function public.vansco_email_audience_summary() from public,anon,authenticated;
grant execute on function public.vansco_email_audience_summary() to service_role;
