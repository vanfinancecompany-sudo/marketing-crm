# Story artwork diagnosis — 2 November 2026

PR #701 remains draft. Do not merge, deploy to production or enable artwork.

## Verified state

- Production alias resolves to `dpl_5uPssTesBoF4U2qqp6BNEcSFQWXL`, commit `677216f59b6cf9cdd313e967ca96b0b0b1b5c6db`.
- Production VFC and Rent2Buy artwork flags are `false`; Vansco flag is absent (default off).
- No production configuration, stock, Buffer queue, schedules or artwork storage was changed during this investigation.

## Findings

1. VFC's published Vehicle URL uses the exact same-registration `https://vanfinance.co/vans/` canonical. The deployed strict URL comparison rejects it. PR #701's existing alias check is appropriately narrow; wrong registration/domain/route and cross-brand aliases remain rejected.
2. A second, independent failure is reproducible in the native renderer. CA74 WVU's current public title is `Ford Transit Custom 2.0 320 EcoBlue Limited Kombi Double Cab 5dr Diesel Manual L2 H1 Euro 6 (s/s) (136 ps)` (106 characters). Both VFC and Rent2Buy layouts reject it with `Story text cannot fit safely. Review the vehicle title.` The generic long-title unit test exercises a three-line helper, whereas these actual layouts permit one line. A new integration regression reproduces the real failure and proves no upload occurs. This is a diagnosed hold, not a layout fix. The approved layout is unchanged.
3. Rent2Buy public image sources tested successfully: FV74 BEO and FV74 BBJ (protected specials), EA21 TTE (ordinary rental/generic copy). The Wix URL's `enc_avif` fragment does not itself prove unsupported image bytes: the production fetch Accept header returned supported PNG/JPEG for these samples. No new Rent2Buy-specific persistent failure was reproduced in these three examples. This does not establish the historical cause of all Rent2Buy holds.
4. Public rehearsal deliberately preserves each brand's first image, including the owner's approved existing promotional banners. VFC/Rent2Buy gallery order differs from DealerKit public gallery order for the examples; substituting the DealerKit photo would violate the source requirement.
5. Vansco private live-Meta index-0 verification remains outstanding. Public Google-feed order is not proof of private Meta order. The credentials are sensitive and are not returned by Vercel's environment read APIs; an authoritative local run stopped before any stock request due to unavailable credentials. No credentials were changed or persisted to disk. Existing mocked source/order/conflict tests pass.
6. Runtime hold logs were not recovered: the broad query timed out and narrower deployment/time queries returned no matching entries. Therefore these findings do not assign a historical error count or claim the title failure explains every missed Story.

## Safe validation

At PR head `9d1ac27942559f656a164ceb111a43fde7e9776d`, the existing workflow's 11 test files passed: 171 tests, zero failures. They cover source identity, default-off behavior, signed rental pricing, protected specials, corrupt/oversized media, storage errors/caps, mocked Buffer handoff, Instagram mirroring, Vansco and ordinary publishing regressions.

`node tools/story-previews/integration-review.mjs` completed with no uploads or Buffer calls. All three PNGs are 1080×1920:

| Brand | Registration | PNG bytes | Evidence boundary |
| --- | --- | ---: | --- |
| VFC | YR73 ORV | 1,958,729 | Public brand image[0] + eligible public supplier-feed match |
| Rent2Buy | FV74 BEO | 1,464,663 | Public brand image[0] + eligible public supplier-feed match |
| Vansco | FV74 BBJ | 1,339,558 | Public Google-feed first image only; private Meta unverified |

Additional public first-image native renders: EA21 TTE, 1,777,889 bytes (JPEG source); FV74 BBJ Rent2Buy, 1,381,879 bytes (PNG source). These extra renders test public source/rendering only, without authoritative current-stock verification. All outputs remain below the 4,000,000-byte artwork ceiling. The contact sheet was visually inspected; image order and existing banners are preserved.

## Before any activation

- Agree a bounded way to present long titles within the approved design, then test the actual native renderer against those source examples. Do not silently crop text or switch photographs.
- Run a read-only authoritative rehearsal in an existing server environment where the current private stock and Meta credentials are available. Verify available status and exact supplier identity for every brand, including Vansco's private Meta primary through hydration.
- Verify Blob hosting/download integrity using approved non-production storage and mocked Buffer writes. Real Blob/Buffer credentials were intentionally not used here; successful real queue acceptance/publication is not established.
- Check the full worker time budget with multiple held candidates: its current loop reloads stock and detail per candidate. This is a code-review performance risk, not a confirmed historical timeout from this run.
- Keep restored publishing and all artwork flags off until all checks are reviewed and production release is explicitly authorised.
