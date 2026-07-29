# Issue 121 implementation notes

- Wix LIVE fetch is validated before any deactivation pass can run.
- Existing Wix Knowledge Hub records absent from the successful LIVE set are marked inactive/not live rather than deleted.
- Historical visibility evidence remains unchanged.
- Stable Wix item ID, canonical URL and slug matching are used; title-only matching is not used.
- Re-published records are reactivated in place.
- Dashboard and provider checks continue to use verified-live publication state.
- Migration `026_ai_visibility_wix_article_lifecycle.sql` must be applied before or alongside deployment.
