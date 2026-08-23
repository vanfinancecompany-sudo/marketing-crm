import { createClient } from "@supabase/supabase-js";

const WIX_FINANCE_CMS_ENDPOINT = "https://www.vanfinancecompany.co.uk/_functions/marketingVanFinanceImages";

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function registrationKey(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function extractRegistration(...values) {
  const text = values.map(clean).join(" ").toUpperCase();
  const match = text.match(/\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/);
  return match ? registrationKey(match[1]) : "";
}

function mileageFrom(...values) {
  const text = values.map(clean).join(" ");
  const match = text.match(/(?:MILEAGE|MILES?)\s*[:\-]?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})/i)
    || text.match(/\b([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})\s*(?:MILES?|MLS)\b/i);
  return match ? match[1].replace(/,/g, "") : "";
}

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables.");
  return createClient(url, key, { auth: { persistSession: false } });
}

export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ ok: false });
  try {
    const supabase = getSupabase();
    const [stock, wixResponse] = await Promise.all([
      supabase.from("facebook_adverts")
        .select("id,title,picture,price,vat,salePrice,vanDescription,vanSpec,weblink,is_active")
        .eq("is_active", true)
        .limit(12),
      fetch(WIX_FINANCE_CMS_ENDPOINT, { headers: { Accept: "application/json" }, cache: "no-store" }),
    ]);
    if (stock.error) throw stock.error;
    if (!wixResponse.ok) throw new Error(`Wix HTTP ${wixResponse.status}`);
    const wixPayload = await wixResponse.json();
    const wixMap = new Map((wixPayload.items || []).map(item => [registrationKey(item.registration), item]));
    const samples = (stock.data || []).map(row => {
      const registration = extractRegistration(row.title, row.weblink, row.vanDescription);
      const wix = wixMap.get(registration) || null;
      return {
        registration,
        crm: {
          title: row.title,
          price: row.price,
          vat: row.vat,
          vanDescription: row.vanDescription,
          vanSpec: row.vanSpec,
          weblink: row.weblink,
          picture: row.picture,
        },
        parsedMileage: mileageFrom(row.vanSpec, row.vanDescription, row.title),
        wix: wix ? {
          registration: wix.registration,
          title: wix.title,
          price: wix.price,
          monthly: wix.monthly,
          imageCount: wix.imageCount,
          firstImages: (wix.images || []).slice(0, 3),
          keys: Object.keys(wix),
        } : null,
      };
    });
    response.setHeader("Cache-Control", "no-store");
    return response.status(200).json({ ok: true, stockCount: stock.data?.length || 0, wixCount: wixMap.size, samples });
  } catch (error) {
    return response.status(500).json({ ok: false, error: error?.message || String(error) });
  }
}
