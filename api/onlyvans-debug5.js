const WIX_FEED = "https://www.vanfinancecompany.co.uk/_functions/marketingVanFinanceImages";

const TARGETS = new Set(["CV69WKD", "BL71PNF", "YG73AMF", "BU72XZC", "DT18TVU", "FL19OFN"]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function regKey(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const response = await fetch(WIX_FEED, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error(`Wix feed HTTP ${response.status}`);
    const payload = await response.json();
    const matches = (payload.items || [])
      .filter((item) => TARGETS.has(regKey(item.registration)))
      .map((item) => ({
        registration: item.registration,
        keys: Object.keys(item).sort(),
        title: item.title,
        year: item.year,
        mileage: item.mileage,
        priceVat: item.priceVat,
        descriptionLine: item.descriptionLine,
        vehicleDescriptionTextClick: item.vehicleDescriptionTextClick,
        vehicleSpecificationText: item.vehicleSpecificationText,
        imagesCount: Array.isArray(item.images) ? item.images.length : null,
      }));
    res.status(200).json({ ok: true, count: payload.items?.length || 0, matches });
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || String(error) });
  }
}
