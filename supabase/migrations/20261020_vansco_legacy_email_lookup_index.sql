-- Add an index for correlated Vansco suppression checks involving already indexed
-- Marketing CRM identities. The existing partial unique index cannot always be
-- selected when the verification override is correlated with Vansco contacts.
-- This is additive and never changes shared CRM contact data or permissions.
create index if not exists marketing_contacts_email_lookup_vansco_idx
 on public.marketing_contacts (email_normalized);
