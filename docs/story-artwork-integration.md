# Approved Story artwork integration (#699 / draft #700)

This branch depends on #698 and leaves its approved templates byte-for-byte unchanged.
No deployment, activation, migrations, stock writes, channels or credentials are added.

## Default-off rollout
Each existing worker opts in only when its respective existing deployment environment has:
- STORY_ARTWORK_VFC_ENABLED=true
- STORY_ARTWORK_RENT2BUY_ENABLED=true
- STORY_ARTWORK_VANSCO_ENABLED=true

No flags are set in this PR. False/missing values retain current publishing behaviour.
Vercel automatic deployment is explicitly disabled for this branch. Review / merge /
deployment / enabling any flag require separate owner approval. Leave #700 draft.

## First-image and current vehicle contract
Existing workers still select the same slots, candidates, quotas, dates and channels.
VFC/Rent2Buy read their own published vehicle page's Vehicle.image[0]. Repository
inspection confirms both pages pass the same ordered van.images array to StockGallery
and JSON-LD (VFC app/vans/[registration]/page.jsx; standalone Rent2Buy
app/van-pages/[registration]/page.jsx). This preserves each brand's actual gallery
order; it never substitutes the public image-suite/DealerKit order. Current
DealerKit snapshot + exact detail must uniquely agree on registration, supplier
stock ID and available status. Reserved/deposit/sold/due-in stock is held.
Missing/ambiguous primary, unsupported media or any validation failure holds that
candidate without reverting to secondary photos or old caption pricing.

Vansco keeps the existing preferLiveMetaImages:true selection. An opt-in source
proof captures the normalized live Meta index 0 and supplier ID before hydration.
Artwork requires that exact primary to survive hydration/enrichment; absent or
conflicting proof holds the candidate. Old saved galleries cannot become the
artwork's first image. Feed/Instagram/Reel image selection remains unchanged.

Approved SVG layouts are imported directly. The native renderer uses existing
Inter/opentype/resvg dependencies and saved genuine Vansco PNG. VFC and Rent2Buy
use text branding. Output: 1080x1920 PNG, max 4,000,000 bytes, unchanged safe areas.

## Pricing
VFC displays only page-verified cash price with an exact retail-price VAT label;
no monthly/APR/approval/guarantee is inferred. Missing evidence uses approved
generic finance copy. Vansco requires its own current feed price, explicit VAT,
canonical branch and canonical phone in the model/caption; unknown/conflicting
values hold. The approved design itself remains unchanged.

Rent2Buy's four protected offers are taken directly from the authoritative protected
table before any matrix context; no inferred mileage. Other stock uses approved
generic rental copy because existing Story candidates carry no signed current quote.
The optional internal signed-quote context accepts only the existing signing secret,
verifier gate and loadRent2BuyPricingSource manual-special/current-source checks,
then the existing signature and source-revision verifiers. Unsigned post captions,
imported prices or caller-provided amounts never supply ordinary Story prices.
No pricing calculator, stock record or website is modified.

## Media hosting and lifecycle
Reuse the existing @vercel/blob store and conventions; no new service/credentials.
story-artwork/v1/{brand}/{registration}/{sha256(supplierId)}/{sha256(PNG)}.png is
immutable, public HTTPS. Verify full returned bytes, SHA256, PNG dimensions and size
before handing the URL to Buffer. Store bounded public vehicle/source provenance
alongside it and immutable per-vehicle/day retention leases. No customer data,
tokens or secrets appear in those records. Head/inventory/upload/verification failures
hold publishing, and never trigger Buffer writes.

Per-brand namespace cap: 1,000 total objects including provenance/leases and 1 GB,
with upload headroom; streaming source max 8 MB, page max 6 MB, 15s whole-body
timeout, source max 24 megapixels / 12,000px edge. Approved exact hosts only,
HTTPS, no credentials/nonstandard ports/unsafe redirects. The cap follows existing
inventory conventions; it is an operational hard stop, not a distributed quota service.
Retention is at least 90 days after scheduled day. There is NO automatic deletion
or expiry: owner-reviewed cleanup must check all scheduled/recovery Buffer references
and leases before removal. A full store holds new work rather than deleting old media.

The existing VFC Instagram mirror recognises only the exact-registration owned
Story namespace, verifies full artwork bytes and preserves it without a raw-image
fallback, even after a flag is disabled. Other Stories/feed/Reels retain existing
selection. Wrong-brand/vehicle artwork is held. No Instagram channel is created.

## Review proof
GitHub Actions runs module-mocked Buffer/storage/source tests plus existing pricing,
Story, Instagram, Vansco and image-handoff regressions. The separate review workflow
has contents:read, no credentials and no publishing calls.

node tools/story-previews/integration-review.mjs produces three distinct real
vehicle samples from public brand pages/current filtered DealerKit Google feed.
It uses the production composer in dryRun mode (host callback must not be called).
Artifact includes PNG/SVG, safe guides, source/provenance JSON and contact sheet.

**Evidence boundary:** credential-free CI cannot read the private DealerKit Meta
catalogue. Its Vansco rehearsal explicitly uses the public Google-feed primary and
does not claim that this proves live Meta ordering. Module tests prove live Meta
index-0 behaviour with two different photos and stale-gallery conflict cases.
Before activation, run the same script with --authoritative in an approved server
environment using EXISTING credentials; it calls the real current stock / Meta
loaders but remains read-only (no Blob uploads or Buffer mutations). This is a
remaining live-source rollout check, not a new system or permission to activate.
