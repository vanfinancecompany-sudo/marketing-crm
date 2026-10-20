alter view public.marketing_vansco_email_eligibility set (security_invoker=true);
revoke all on public.marketing_vansco_email_eligibility from public,anon,authenticated;
grant select on public.marketing_vansco_email_eligibility to service_role;
grant select,insert,update on public.marketing_vansco_email_import_jobs to service_role;
grant select,insert on public.marketing_vansco_email_review_audit to service_role;