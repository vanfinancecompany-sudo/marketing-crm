-- Hard rolling seven-day production-email lock for Marketing CRM Email Templates.
-- The existing recipient audit table remains the source of truth.

create index if not exists marketing_email_recipients_normalized_email_accepted_idx
  on public.marketing_email_send_recipients (lower(trim(email)), first_sent_at desc)
  where send_type = 'production' and first_sent_at is not null;

create or replace function public.marketing_prevent_duplicate_campaign_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_email_template_campaign boolean := false;
begin
  if new.send_type <> 'production'
    or new.status not in ('pending', 'accepted', 'sent', 'delivered', 'opened', 'clicked', 'submission_unknown') then
    return new;
  end if;

  -- Serialise production reservations by normalized email. A pending row protects
  -- the provider-call window; accepted first_sent_at evidence protects seven days.
  perform pg_advisory_xact_lock(hashtext('marketing-email:' || lower(trim(new.email))));

  -- Preserve the existing same-campaign duplicate protection for every workflow.
  if exists (
    select 1
    from public.marketing_email_send_recipients existing
    where existing.campaign_id = new.campaign_id
      and lower(trim(existing.email)) = lower(trim(new.email))
      and existing.send_type = 'production'
      and existing.status in ('pending', 'accepted', 'sent', 'delivered', 'opened', 'clicked', 'submission_unknown')
      and existing.id <> new.id
  ) then
    raise exception using errcode = '23505', message = 'Campaign already has a production recipient for this normalized email.';
  end if;

  select exists (
    select 1
    from public.marketing_campaigns campaign
    where campaign.id = new.campaign_id
      and campaign.metadata->>'source' = 'template_campaign_foundation'
  ) into v_is_email_template_campaign;

  if not v_is_email_template_campaign then
    return new;
  end if;

  if exists (
    select 1
    from public.marketing_email_send_recipients existing
    join public.marketing_campaigns campaign on campaign.id = existing.campaign_id
    where campaign.metadata->>'source' = 'template_campaign_foundation'
      and lower(trim(existing.email)) = lower(trim(new.email))
      and existing.send_type = 'production'
      and existing.id <> new.id
      and (
        existing.status = 'pending'
        or existing.first_sent_at > now() - interval '7 days'
      )
  ) then
    raise exception using errcode = '23505', message = 'Normalized email is protected by the seven-day production contact-frequency lock.';
  end if;

  return new;
end;
$$;

drop trigger if exists marketing_email_recipient_prevent_duplicate_email on public.marketing_email_send_recipients;
create trigger marketing_email_recipient_prevent_duplicate_email
before insert or update of campaign_id, email, send_type, status, first_sent_at
on public.marketing_email_send_recipients
for each row execute function public.marketing_prevent_duplicate_campaign_email();
