# Branded Story artwork — isolated review

This directory is a standalone proposal. Nothing in the application or its publishing workers imports it. Do not integrate it into publishing without explicit owner approval.

## Review output

The **Story preview review** PR check produces the `branded-story-previews` artifact:

- `index.html`: offline preview of all three brands, with a safe-area toggle and PNG downloads.
- `vanFinance.png`, `rent2buy.png`, `vansco.png`: self-contained 1080 × 1920 adverts.
- Matching `*-safe.png` guide images and editable, self-contained SVGs.
- `sources.json`: exact registrations, source URLs, retrieval time, gallery identities, displayed facts and file sizes.
- `contact-sheet.png`: quick visual comparison.

Download the artifact and open `index.html`. No deployed preview, public API addition or website changes are required. Artifacts expire after 30 days; retain the reviewed PNGs and evidence with any future implementation.

## Existing channels found in the code

| Brand | Facebook Stories | Instagram Stories |
|---|---|---|
| Van Finance Company | Existing `api/buffer-facebook-story-automation.js` reuses same-day classified image posts; up to three slots, queue/preflight/catch-up guards, smaller same-vehicle Wix fallback | Existing `api/buffer-instagram-mirror.js` mirrors VFC Facebook media including Stories, with configured delay and active-stock checks |
| Rent2Buy Vans | Same existing Facebook Story worker, separate Rent2Buy channel and offset | No Rent2Buy Instagram Story path found |
| Vansco | Existing `api/vansco-facebook-story-automation-worker.js`, four configured slots, resolved VAT/branch and existing image handoff | Existing Instagram automation uses `mediaKind: "image"` (feed posts); no Vansco Instagram Story creator found |

These are code-supported paths, not a claim that every connected channel is currently enabled or publishing successfully. Live Buffer state was not queried. No new channels are created.

Existing cron configuration and publishing files are unchanged. In particular, VFC's Instagram mirror currently prefers original CRM images over the Facebook asset. A future approved integration must account for that behavior; changing the Facebook image alone would not guarantee identical Instagram artwork. This PR deliberately does not change it.

## Designs and data

All designs keep critical copy within x=72…1008 and y=250…1580, leaving 250px above and 340px below for Story UI. These are conservative design margins, not a platform guarantee. Photos use `meet` (contain), preserving the entire vehicle. Exact-registration raw gallery photographs are visually reviewed and never retouched. Missing price, VAT, branch or verified photograph holds rendering. Text wraps at complete words and uses measured Inter font widths, with glyph paths for reliable rasterisation; an overlong value is held for review.

- **VFC:** large brand-name lockup, red/navy editorial layout, verified vehicle cash price/VAT and specifications. No monthly finance, deposit, APR, acceptance or approval claims.
- **Rent2Buy:** large brand-name lockup, red/charcoal layout, prominent fixed monthly rental and initial rental/term. The real example FV74 BBJ is a protected special: £545 + VAT monthly, £2,000 + VAT initially, 48 months. No contractual mileage allowance is inferred. All four protected registrations bypass the matrix. Ordinary rental amounts are only displayed when the existing current-source quote verifier passes and the caller confirms no manual special applies; otherwise the image directs customers to current rental terms. No old caption/monthly field is reused.
- **Vansco:** established charcoal/red palette, precise feed price, explicit vehicle VAT and canonical branch name/telephone. Unknown or conflicting price/VAT/branch holds rendering.

Examples use existing published vehicle pages and the existing public DealerKit gallery route. Vansco's existing full Google vehicle feed supplies its own current stock price and branch. Its VAT evidence is joined to the exact registration's explicit published retail-price label, verified against that page's structured cash price. Each brand retains its own published price; cross-brand prices are not substituted. This is preview evidence, not a replacement for the existing production stock/eligibility checks.

The earlier legacy Wix image feed GETs returned HTTP 500 and direct Vansco pages returned a website-protection challenge. No workaround service was introduced. The renderer uses existing readable public data routes and records their provenance.

The CTA is visible artwork with a website address. It does not create a tappable Story link/sticker; no supported sticker-publishing path was established in the inspected code.

## Safety and proposed implementation

`sources.mjs` validates public retail VAT evidence; `template.mjs` builds a validated view model and SVG; `review.mjs` reads the public examples, embeds exact-registration photographs and rasterises using the repository's existing Resvg/Inter dependencies. It writes only runner-local review files, then GitHub Actions retains an artifact. It has no production credentials, Buffer call, Blob upload or database client.

A later approved integration could pass the existing selected vehicle's current verified facts and photo to this renderer, then supply its resulting image through the existing media handoff. That integration and all publishing changes are excluded here.

The only edit outside this tool, its tests and its review workflow is `vercel.json`: automatic deployment is disabled for **codex/branded-story-previews** only, following the existing per-branch pattern. Cron entries, project identity, routes, Production settings and other branches are unchanged.

## Checks

The PR workflow installs locked dependencies without package scripts, runs focused template/pricing tests plus the existing Facebook/Instagram safety suites, and generates real previews. Output is rejected unless each PNG is 1080 × 1920 and below the existing Facebook worker's 4,000,000-byte limit. No website build/deploy command is added to this workflow. Existing repository PR checks remain in place.
