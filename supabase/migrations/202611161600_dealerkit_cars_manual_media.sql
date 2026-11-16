alter table public.dealerkit_review_manual_media
  add column if not exists selected_at timestamptz,
  drop constraint dealerkit_review_manual_media_site_scope_check,
  drop constraint dealerkit_review_manual_media_purpose_check,
  add constraint dealerkit_review_manual_media_scope_purpose_check check (
    (site_scope = 'van_finance' and purpose = 'van_finance_replacement') or
    (site_scope = 'rent2buy' and purpose = 'rent2buy_template') or
    (site_scope = 'cars' and purpose = 'cars_replacement')
  );

-- Keep the previous primary if the candidate is no longer ready or owned.
create function public.dealerkit_select_cars_primary(
  p_media_id uuid, p_stock_id text, p_registration text, p_site_id text
) returns public.dealerkit_review_manual_media
language plpgsql security invoker set search_path = ''
as $$
declare
  selected public.dealerkit_review_manual_media;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_stock_id || ':' || p_site_id, 0)
  );
  select m.* into strict selected
  from public.dealerkit_review_manual_media m
  where m.id = p_media_id and m.supplier_stock_id = p_stock_id
    and m.registration = p_registration and m.wix_site_id = p_site_id
    and m.site_scope = 'cars' and m.purpose = 'cars_replacement'
    and m.operation_status = 'READY'
  for update;

  update public.dealerkit_review_manual_media m
    set selected_at = null
    where m.supplier_stock_id = p_stock_id and m.registration = p_registration
      and m.site_scope = 'cars' and m.purpose = 'cars_replacement'
      and m.wix_site_id = p_site_id and m.selected_at is not null;

  update public.dealerkit_review_manual_media m
    set selected_at = pg_catalog.now(), updated_at = pg_catalog.now()
    where m.id = selected.id
    returning m.* into selected;
  return selected;
end;
$$;

revoke all on function public.dealerkit_select_cars_primary(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.dealerkit_select_cars_primary(uuid,text,text,text) to service_role;
