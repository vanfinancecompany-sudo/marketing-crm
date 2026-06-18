# Wix Cars Sync

This is the Wix/Velo equivalent of the existing Van Finance sync pattern.

Flow:

```text
Wix CARPAGES -> /sync-cars -> POST https://marketing-crm-six.vercel.app/api/sync-car-vehicles -> Supabase car_adverts
```

It does not write to `facebook_adverts`, `rent_vehicles`, `vansco_stock_watch`, or `vansco_vehicle_cache`.

## Backend Web Module

Create this in Wix as:

```text
backend/syncCars.web.js
```

```js
import wixData from "wix-data";
import { fetch } from "wix-fetch";
import { webMethod, Permissions } from "wix-web-module";

const WIX_COLLECTION = "CARPAGES";
const CRM_SYNC_URL = "https://marketing-crm-six.vercel.app/api/sync-car-vehicles";

// Set this to false if CARPAGES does not have a syncToCRM field yet.
const USE_SYNC_TO_CRM_FILTER = true;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function wixImageToUrl(value) {
  const raw = clean(value?.src || value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;

  const match = raw.match(/wix:image:\/\/v1\/([^/#?]+)/i);
  if (match && match[1]) {
    return `https://static.wixstatic.com/media/${match[1]}`;
  }

  return raw;
}

function pickImage(item) {
  const gallery = Array.isArray(item.gallery) ? item.gallery : [];
  const firstGallery = gallery[0]?.src || gallery[0];

  return wixImageToUrl(
    item.picture ||
    item.image ||
    item.image1 ||
    item.mainImage ||
    firstGallery
  );
}

function mapCarPage(item) {
  return {
    title: clean(item.vanDescription),
    registration: clean(item.title).toUpperCase().replace(/[^A-Z0-9]/g, ""),
    picture: pickImage(item.picture),
    price: clean(item.price),
    salePrice: clean(item.salePrice),
    description: clean(item.vanDescription),
    spec: clean(item.vanSpec),
    weblink: clean(item.webLink),
    is_active: true,
  };
}

async function fetchAllCarsFromWix() {
  const rows = [];
  let query = wixData.query(WIX_COLLECTION).limit(1000);

  if (USE_SYNC_TO_CRM_FILTER) {
    query = query.eq("syncToCRM", "Yes");
  }

  let result = await query.find({ suppressAuth: true });
  rows.push(...result.items);

  while (result.hasNext()) {
    result = await result.next();
    rows.push(...result.items);
  }

  return rows;
}

export const syncCarsToCRM = webMethod(Permissions.Admin, async () => {
  const sourceRows = await fetchAllCarsFromWix();
  const mappedRows = sourceRows
    .map(mapCarPage)
    .filter((row) => row.title && row.registration);

  const response = await fetch(CRM_SYNC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(mappedRows),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || `CRM sync failed with HTTP ${response.status}`);
  }

  return {
    ...payload,
    sourceCollection: WIX_COLLECTION,
    sourceRows: sourceRows.length,
    postedRows: mappedRows.length,
  };
});
```

## Page Code

Create a Wix page with slug:

```text
/sync-cars
```

Add:

- Button ID: `syncCarsButton`
- Text element ID: `syncCarsStatus`

Page code:

```js
import { syncCarsToCRM } from "backend/syncCars.web";

$w.onReady(() => {
  $w("#syncCarsStatus").text = "Ready to sync Cars into Marketing CRM.";

  $w("#syncCarsButton").onClick(async () => {
    $w("#syncCarsButton").disable();
    $w("#syncCarsStatus").text = "Syncing Cars from CARPAGES...";

    try {
      const result = await syncCarsToCRM();

      $w("#syncCarsStatus").text =
        `Cars sync complete.\n` +
        `Source rows: ${result.sourceRows}\n` +
        `Posted rows: ${result.postedRows}\n` +
        `Synced: ${result.synced}\n` +
        `Inserted: ${result.inserted}\n` +
        `Updated: ${result.updated}\n` +
        `Skipped: ${result.skipped}`;
    } catch (error) {
      $w("#syncCarsStatus").text = `Cars sync failed: ${error.message}`;
    } finally {
      $w("#syncCarsButton").enable();
    }
  });
});
```
