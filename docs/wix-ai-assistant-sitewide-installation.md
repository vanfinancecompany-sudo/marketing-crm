# Van Finance Company — Site-wide Live Chat

This is the preferred production installation for the Van Finance Company website.

It deliberately does **not** add AI Assistant code to the Finance or Rent2Buy dynamic vehicle page Velo. Those pages keep their existing custom gallery, popup and application code unchanged.

## Architecture

One Wix site-wide Custom Code snippet loads:

`/wix-ai-assistant/site-loader.js`

The loader:

- adds a fixed red Live Chat launcher above the existing WhatsApp control
- uses a Shadow DOM shell so it does not participate in Wix page layout
- opens the existing hosted assistant in a fixed iframe panel
- survives normal Wix pages without adding an HTML Component to each page
- resets page-specific chat context when Wix navigation changes the pathname
- stores only the opaque anonymous conversation ID in browser local storage
- sends the current page URL to `/api/ai-assistant-sitewide`

The site-wide endpoint resolves product and vehicle context on the server. On vehicle pages it reads the existing Wix CMS using server-only `WIX_API_KEY` and `WIX_SITE_ID` credentials.

### Finance vehicle pages

Route: `/van-finance/{registration}`

Collection: `VANFINANCEPAGES`

- registration: `title`
- vehicle title: `titleText`
- monthly Finance price: `mthPrice`
- retail price + VAT: `priceVat`

### Rent2Buy vehicle pages

Route: `/guaranteed-rent2buy-vans/{registration}`

Collection: `VANPAGES`

- registration: `title`
- vehicle title: `titleText`
- initial rental: `intialRentalCharge`
- monthly payments: `monthlyPayments`
- agreement term: `numberOfMonths`

If a Wix vehicle lookup fails, the assistant keeps the vehicle identity but receives no price values, so the existing pricing guard directs the customer to the vehicle page rather than estimating a price.

## Wix installation

In Wix Dashboard / Settings, open **Custom Code** and add one site-wide code item.

Use:

```html
<script src="https://marketing-crm-github-work.vercel.app/wix-ai-assistant/site-loader.js" defer></script>
```

Recommended settings:

- Add Code to Pages: **All pages**
- Place Code in: **Body - end**
- Load: once per page/site as Wix supports

Do not add a Wix HTML/Embed element for this installation.

Do not add `installDynamicVehicleAiAssistantWidget()` to Finance or Rent2Buy vehicle page code.

## Positioning

The launcher is fixed at the bottom-right and intentionally offset upward from WhatsApp:

- desktop: `bottom: 88px; right: 18px`
- mobile: `bottom: 84px; right: 12px`

The open panel uses the same lower-right anchor and overlays the page. It never pushes or resizes Wix content.

## Security and trust boundary

- browser code supplies only current page URL, customer message, product-button choice and opaque conversation ID
- browser-supplied vehicle/pricing context is ignored in site-wide mode
- product/vehicle context is derived server-side
- Wix API credentials remain server-only
- existing public endpoint origin validation, rate limiting, session limits, redaction, prompt-leakage protection and canonical assistant orchestration remain authoritative
- the chat never creates an application CTA; customers use the existing page **APPLY NOW** button

## Production prerequisites

Existing production variables must remain configured:

- `AI_ASSISTANT_SESSION_SECRET`
- `AI_ASSISTANT_ALLOWED_ORIGINS` (or the existing VFC defaults)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `WIX_API_KEY`
- `WIX_SITE_ID`

The Wix API key needs read access to the two vehicle collections in addition to any existing Knowledge Hub permissions.

## Smoke test

After the branch is deployed to Preview, temporarily use the Preview deployment origin in the script `src` on a Wix test site if required.

Before Production rollout, verify:

1. Live Chat launcher appears above WhatsApp and does not move page layout.
2. Open/Close works on desktop and mobile.
3. Homepage asks Finance or Rent2Buy.
4. Finance page is locked to Finance.
5. Rent2Buy page is locked to Rent2Buy.
6. Finance vehicle page can answer exact current-page monthly/retail price when CMS lookup succeeds.
7. Rent2Buy vehicle page can answer exact initial rental/monthly payment/term when CMS lookup succeeds.
8. Vehicle pages' custom mobile galleries and quick-look popups remain unchanged.
9. Application intent tells the customer to use the page APPLY NOW control.
10. Restart creates a fresh anonymous conversation.
