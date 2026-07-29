# Vansco advertised price and VAT cache

This change extends the existing advisory Vansco cache refresh only.

## Stored fields

- `advertised_price`: numeric cash price shown on the Vansco vehicle detail page
- `vat_status`: `plus_vat`, `no_vat`, `vat_included`, or `unknown`
- `advertised_price_text`: original matched price wording retained as evidence

No VAT arithmetic is performed. The values are read-only and are not written to Wix, CRM stock, Facebook, or Vansco.

## Extraction safeguards

- Prefer structured vehicle-offer price data when present.
- Otherwise inspect dedicated price-like HTML elements.
- Use a bounded visible-text fallback only when the amount appears with explicit VAT wording.
- Reject monthly, weekly, deposit, repayment, saving, and finance-payment wording.
- `NO VAT` takes priority over generic VAT mentions.
- Missing or ambiguous prices remain null/unknown rather than being guessed.

## Rollout

1. Apply migration `030_vansco_price_vat_cache.sql`.
2. Deploy the parser/cache refresh changes.
3. Run the existing manual Vansco cache refresh.
4. Inspect several plus-VAT, no-VAT, reserved, sold, and missing-price records before building the Wix comparison tab.
