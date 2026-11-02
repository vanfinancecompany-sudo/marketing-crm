# Story artwork fixes — verified in protected preview

This follow-up supersedes the outstanding title/font/private-Meta checks in
`story-artwork-diagnosis-20261102.md`. Production is unchanged and artwork remains off.

## Fixed

- VFC accepts only its exact same-registration `vanfinance.co/vans/` schema alias.
- Long descriptions use two complete readable subtitle lines within the existing
  header band. The main title makes room for descenders when needed; photographs,
  pricing panels and Story safe areas remain in place. Short titles retain their
  previous layout. Unreasonably long/unbreakable descriptions still hold.
- Vercel omitted the renderer's WOFF files because their names were computed.
  A real deployed rehearsal reproduced `story_font_asset_missing` /
  `MODULE_NOT_FOUND`. Three literal font references now allow dependency tracing;
  deployed VFC and Rent2Buy rendering subsequently passed.
- Provenance records the layout version, base approved layout and deployment SHA.
- Read-only preview rehearsal performs current stock/detail identity checks and
  the real Vansco Meta-primary capture, hydration and branch/VAT enrichment. It
  returns 404 in production/other projects/aliases and refuses mutation methods.

## Authoritative server rehearsal

Code commit: `24fcee4a9f175ea80da388a94eae6022acf7c31c`.
Protected deployment: `dpl_4z2j2VbrgkLEh93XHmm5wvcdXTZZ`.
The existing preview credentials were used in place; none were exposed or changed.

| Brand | Current vehicle | Result | PNG bytes |
| --- | --- | --- | ---: |
| VFC | CA74 WVU | Current stock + brand image[0] + full 106-character title rendered | 1,382,183 |
| Rent2Buy | FV74 BEO | Current stock + brand image[0] + protected special rendered | 1,464,663 |
| Vansco | CK24 NRO | Current stock + private live Meta index 0 verified through hydration + resolved commercial fields rendered | 1,658,301 |

All are 1080×1920 PNGs, below 4,000,000 bytes. Each rehearsal returned
`uploads: 0` and `bufferWrites: 0`. Vansco returned `metaPrimaryMatches: true`.
The successful VFC output's SHA256 matches the independently rendered local PNG.
Ordinary Rent2Buy EA21 TTE also passed on the previous font-fixed preview with
generic rental copy (`pricingMode: unavailable`), without inventing a monthly price.

Vansco FV74 BBJ and CA74 WVU passed exact current-stock/private-primary checks but
held on unresolved branch/VAT information. This is the required fail-closed
behavior. The existing worker excludes such unresolved candidates; no branch,
VAT treatment or price was guessed to force them through.

## Validation and release boundary

- 177 local tests pass; GitHub's Story integration, Story preview and recipient
  personalisation checks pass for the code commit.
- Tests exercise actual native rendering of the long title in all three layouts,
  unsafe-title holds, protected specials/current-source pricing, default-off paths,
  storage integrity/caps/failures, mocked Buffer handoff, Instagram mirroring and
  the preview-only guard/enrichment behavior.
- Updated public-source PNG/SVG/contact-sheet rehearsal completed separately.
  Its Vansco public Google-feed example is explicitly a visual rehearsal and is
  not the private-Meta verification recorded above.
- Production remains on commit `677216f59b6cf9cdd313e967ca96b0b0b1b5c6db`.
  VFC/Rent2Buy artwork flags are false; Vansco is absent/default off.
- No artwork was uploaded, no Buffer queue was changed, and no production release
  or activation occurred. Real storage upload and Buffer acceptance/publication
  must be checked in an explicitly authorised controlled rollout before claiming
  that the new templates are operating live. Mock handoff success is not proof of
  a live published Story.

The scoped release is ready for approval: merge/deploy with flags off, verify
controlled media hosting/Buffer acceptance, then enable each brand's existing
Story automation after its check passes. Preserve the existing schedules,
quotas, channels, first-image rules and availability/pricing guards.
