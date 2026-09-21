# VFC Marketplace Helper

This Chrome extension is the local browser bridge between the Marketing CRM and Facebook Marketplace.

## Controlled workflow

1. In Marketing CRM → Van Finance Marketplace or Rent2Buy Marketplace, choose an eligible van and press **Advertise on Marketplace**.
2. The CRM validates DealerKit vehicle data, the product-specific Marketplace price and the ordered product CMS image gallery.
3. The extension stores that one pending job and Facebook Marketplace opens.
4. The extension fills the vehicle form and uploads the ordered CMS images.
5. The user reviews the advert and clicks Facebook's **Publish** button manually.
6. A listing is only reported back as published when the helper saw that manual Publish click and the same Facebook tab then navigated to a real `/marketplace/item/...` URL.
7. The CRM records the confirmed advert and removes that van from the Marketplace to-do list.

The extension never clicks Publish, never handles Facebook credentials, and contains no CAPTCHA, stealth, fingerprint or enforcement-bypass behaviour.

## Marketplace rules

- Vehicle type: `Car/Truck`
- Rent2Buy price: numeric monthly amount.
- Van Finance price: numeric cash vehicle price; the Finance description carries the monthly example and VAT wording.
- Rent2Buy model/title hook: `[model] - Visit us at Rent2BuyVans.co.uk`.
- Van Finance model/title hook: `[model/derivative] - VANFINANCECOMPANY.co.uk | Deposit from £99`.
- Body style: `Other`.
- Condition: `Very good`.
- Location: separate shuffled rotations. Rent2Buy keeps the southern-area pool; Van Finance uses an England-wide major-town/city pool.
- Interior colour: left blank.
- Description: product-specific CRM copy.
- Images: product CMS order only, lead CMS image first, never reshuffled. Facebook upload is capped at 20 and the CRM preflight stops if the matching CMS gallery is missing.

## Install locally

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Remove/disable the old V6 test helper.
4. Choose **Load unpacked**.
5. Select this `browser-extension/marketplace-helper` directory from a local checkout/export of the approved branch/release.

The extension is scoped to the production Marketing CRM and Facebook Marketplace vehicle creation pages.
