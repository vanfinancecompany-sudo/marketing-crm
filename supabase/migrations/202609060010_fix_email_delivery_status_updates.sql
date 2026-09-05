-- Keep SendGrid delivery-state updates compatible with the live recipient audit table.
-- This records the production repair made on 2026-09-06 so future environments
-- do not reintroduce the same schema/trigger drift.

alter table public.marketing_email_send_recipients
  drop constraint if exists marketing_email_send_recipients_status_check;

alter table public.marketing_email_send_recipients
  add constraint marketing_email_send_recipients_status_check
  check (
    status = any (array[
      'pending'::text,
      'accepted'::text,
      'sent'::text,
      'delivered'::text,
      'opened'::text,
      'clicked'::text,
      'soft_bounced'::text,
      'hard_bounced'::text,
      'blocked'::text,
      'complained'::text,
      'unsubscribed'::text,
      'deferred'::text,
      'failed'::text,
      'submission_unknown'::text,
      'skipped_suppressed'::text,
      'skipped_duplicate'::text
    ])
  );

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

  -- Provider webhooks update delivery state/timestamps on an already-reserved
  -- recipient. Do not rerun the seven-day reservation guard for status-only
  -- updates, otherwise legitimate delivery events can be rejected as duplicates.
  if tg_op = 'UPDATE'
    and new.campaign_id is not distinct from old.campaign_id
    and lower(trim(new.email)) is not distinct from lower(trim(old.email))
    and new.send_type is not distinct from old.send_type then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('marketing-email:' || lower(trim(new.email))));

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
