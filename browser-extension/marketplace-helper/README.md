# VFC Facebook Helper

This Chrome extension is the local browser bridge between the Marketing CRM and Facebook Marketplace / Facebook Groups.

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

Create the validated extension-only package from the repository root:

```sh
npm run package:marketplace-helper
```

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Remove/disable the old V6 test helper and any old `rent2buy-marketplace-helper-production` copy.
4. Choose **Load unpacked**.
5. Select `dist/marketplace-helper/VFC-Facebook-Helper-v1.2.6` from the approved branch/release.

The selected folder must contain `manifest.json` and `background.js` directly at its root. Do not select the ZIP itself or a parent folder. The generated ZIP is flat as well: after extraction, its destination folder is ready for **Load unpacked** without another nested extension directory.

The extension is scoped to the production Marketing CRM and Facebook Marketplace vehicle creation pages.


## Facebook Groups agent

The same extension also supports the separate **Rent2Buy Facebook Groups** and **Van Finance Groups & Classifieds** CRM pages.

- Discovery runs search Facebook Groups through the user's normal logged-in browser session and return candidate group URLs/names to the CRM.
- Live checks open a controlled batch of group About pages and record visible membership/posting access, privacy, approval and advertising/link-rule evidence.
- Rent2Buy and Van Finance use separate search plans and scoring.
- Group post preparation opens the selected group, attempts to fill the existing CRM caption and stock image, and stops before Facebook's final Post action.
- The helper never joins a group, requests membership, clicks the final Post button, bypasses CAPTCHA/security checks or attempts to hide automation.
- Discovery and inspection are deliberately batched rather than running as an unattended high-frequency crawler.

The Group agent stores its candidate/check history in the browser-side Marketing CRM state in this first release. No production customer, lead or stock records are altered.


## Group pipeline logic

The CRM separates groups into:
- **New & Testing**: new discoveries and groups with adverts waiting for visibility/approval checks.
- **Proven / Hot**: at least one advert has been confirmed visible/accepted.
- **Archived**: unavailable groups or groups whose visible rules explicitly prohibit commercial/dealer/promotional posting.

When the user manually clicks Facebook's **Post** button, the helper records that posting attempt back to the CRM. The CRM can then run an acceptance check against posted registrations. Proven groups default to a 7-day repeat interval (configurable per group) and appear in the **Due again** section when ready for another advert.
