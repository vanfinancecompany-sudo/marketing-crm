alter table public.dealerkit_review_manual_media
  drop constraint dealerkit_review_manual_media_site_scope_check,
  drop constraint dealerkit_review_manual_media_purpose_check,
  add constraint dealerkit_review_manual_media_scope_purpose_check check (
    (site_scope = 'van_finance' and purpose = 'van_finance_replacement') or
    (site_scope = 'rent2buy' and purpose = 'rent2buy_template') or
    (site_scope = 'cars' and purpose = 'cars_replacement')
  );
