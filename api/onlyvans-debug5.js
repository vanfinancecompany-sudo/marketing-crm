const TARGETS = ["SJ71HSK", "NX18YGL", "BG74MWY", "LC68YKZ", "GF71OMG"];

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function wixConfig() {
  const apiKey = clean(process.env.WIX_API_KEY);
  const siteId = clean(process.env.WIX_SITE_ID);
  if (!apiKey || !siteId) throw new Error("Missing Wix API configuration");
  return { apiKey, siteId };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const { apiKey, siteId } = wixConfig();
    const response = await fetch("https://www.wixapis.com/wix-data/v2/items/query", {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "wix-site-id": siteId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dataCollectionId: "VANFINANCEPAGES",
        query: {
          filter: { title: { $in: TARGETS } },
          paging: { limit: 20 },
          fields: [
            "title","titleText","year","mileage","priceVat","descriptionLine",
            "vehicleDescriptionTextClick","vehicleSpecificationText","mainImages"
          ],
        },
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.message || `Wix HTTP ${response.status}`);
    const matches = (payload.dataItems || []).map(({ data }) => ({
      title: data?.title,
      titleText: data?.titleText,
      year: data?.year,
      mileage: data?.mileage,
      priceVat: data?.priceVat,
      descriptionLine: data?.descriptionLine,
      vehicleDescriptionTextClick: data?.vehicleDescriptionTextClick,
      vehicleSpecificationText: data?.vehicleSpecificationText,
      imagesCount: Array.isArray(data?.mainImages) ? data.mainImages.length : 0,
    }));
    return res.status(200).json({ ok: true, matches });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || String(error) });
  }
}
