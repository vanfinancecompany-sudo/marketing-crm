-- APPLIED TO EXISTING SUPABASE PROJECT ON 2026-10-24. No deal rows were inserted or activated.
-- The promotional feature flags remain OFF; this migration only installs secure storage.
-- The four protected offers are already enforced by the source-code map, not copied.
CREATE TABLE IF NOT EXISTS public.rent2buy_special_deals(
 registration text PRIMARY KEY CHECK(registration ~ '^[A-Z]{2}[0-9]{2}[A-Z]{3}$'),
 monthly_ex_vat numeric(12,2) NOT NULL CHECK(monthly_ex_vat>0),
 initial_ex_vat numeric(12,2) NOT NULL CHECK(initial_ex_vat>=1000),
 term_months smallint NOT NULL CHECK(term_months IN (12,18,24,30,36,42,48)),
 enabled boolean NOT NULL DEFAULT false,
 source_stock_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rent2buy_special_deals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rent2buy_special_deals FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.rent2buy_special_deals TO service_role;
-- service_role only. No anon policies; public reads go via an intentionally limited API.
