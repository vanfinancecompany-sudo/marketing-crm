# VFC Marketplace Helper

This Chrome extension is the local browser bridge between the Marketing CRM and Facebook Marketplace.

## Controlled workflow

1. In Marketing CRM → Facebook Marketplace, choose an eligible Rent2Buy van and press **Advertise on Marketplace**.
2. The CRM validates DealerKit vehicle data, Rent2Buy monthly price and the ordered Rent2Buy CMS image gallery.
3. The extension stores that one pending job and Facebook Marketplace opens.
4. The extension fills the vehicle form and uploads the ordered CMS images.
5. The user reviews the advert and clicks Facebook's **Publish** button manually.
6. A listing is only reported back as published when the helper saw that manual Publish click and the same Facebook tab then navigated to a real `/marketplace/item/...` URL.
7. The CRM records the confirmed advert and removes that van from the Marketplace to-do list.

The extension never clicks Publish, never handles Facebook credentials, and contains no CAPTCHA, stealth, fingerprint or enforcement-bypass behaviour.

## Marketplace rules

- Vehicle type: `Car/Truck`
- Price: numeric Rent2Buy monthly amount only
- Model: `[model] - Visit us at Rent2BuyVans.co.uk`
- Body style: `Other`
- Condition: `Very good`
- Location: shuffled controlled Rent2Buy town rotation
- Interior colour: left blank
- Clean title: untouched
- Description: current CRM Marketplace copy with `Visit us at Rent2BuyVans.co.uk` near the top
- Images: CMS order only, lead CMS image first, never reshuffled. Facebook upload is capped at 20 and the CRM preflight stops if the CMS lead image/gallery is missing.

## Install locally

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Remove/disable the old V6 test helper.
4. Choose **Load unpacked**.
5. Select this `browser-extension/marketplace-helper` directory from a local checkout/export of the approved branch/release.

The extension is scoped to the production Marketing CRM and Facebook Marketplace vehicle creation pages.
