alter table public.vansco_vehicle_cache
  add column if not exists advertised_price numeric,
  add column if not exists vat_status text not null default 'unknown',
  add column if not exists advertised_price_text text;

alter table public.vansco_vehicle_cache
  drop constraint if exists vansco_vehicle_cache_vat_status_check;

alter table public.vansco_vehicle_cache
  add constraint vansco_vehicle_cache_vat_status_check
  check (vat_status in ('plus_vat', 'no_vat', 'vat_included', 'unknown'));

create index if not exists vansco_vehicle_cache_advertised_price_idx
  on public.vansco_vehicle_cache (advertised_price)
  where advertised_price is not null;

comment on column public.vansco_vehicle_cache.advertised_price is
  'Numeric advertised cash price extracted from the Vansco vehicle detail page. No VAT arithmetic is applied.';

comment on column public.vansco_vehicle_cache.vat_status is
  'VAT wording classified from the Vansco vehicle detail page: plus_vat, no_vat, vat_included or unknown.';

comment on column public.vansco_vehicle_cache.advertised_price_text is
  'Original Vansco price wording retained for read-only comparison evidence.';
