import { supabase } from "./supabase.js";

function convertWixImage(url) {
  if (!url) return "";

  const value = String(url).trim();
  if (!value) return "";

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  const match = value.match(/wix:image:\/\/v1\/([^/]+)/);
  if (!match) return value;

  return `https://static.wixstatic.com/media/${match[1]}`;
}

function extractRegistration(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return "";

  const ukRegMatch = text.match(
    /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/
  );

  return ukRegMatch ? ukRegMatch[1].replace(/\s+/g, " ").trim() : "";
}

function valueOrFallback(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return value;
    }
  }
  return "";
}

function mapFinanceVehicleRow(row, index) {
  const imageUrl = convertWixImage(row.picture);
  const title = valueOrFallback(row.title, `finance-${index + 1}`);

  return {
    id: row.id || title || `finance-${index}`,
    title,
    name: title,
    reg: extractRegistration(title),
    picture: imageUrl,
    image: imageUrl,
    price: row.price || "",
    vat: row.vat || "",
    monthly: row.salePrice || "",
    salePrice: row.salePrice || "",
    vanDescription: row.vanDescription || "",
    description: row.vanDescription || "",
    vanSpec: row.vanSpec || "",
    spec: row.vanSpec || "",
    weblink: row.weblink || "",
    link: row.weblink || "",
    pipeline: "vanFinance",
  };
}

function mapRentVehicleRow(row, index) {
  const imageUrl = convertWixImage(row.picture);
  const registration = valueOrFallback(row.registration, `rent-${index + 1}`);

  return {
    id: row.id || registration || `rent-${index}`,
    title: registration,
    name: registration,
    reg: registration,
    picture: imageUrl,
    image: imageUrl,
    price: row.initialRental || "",
    monthly: row.monthly || "",
    week: row.week || "",
    initialRental: row.initialRental || "",
    vanDescription: row.vanDescription || "",
    description: row.vanDescription || "",
    vanSpec: row.vanSpec || "",
    spec: row.vanSpec || "",
    weblink: row.webLink || "",
    link: row.webLink || "",
    pipeline: "rent2buy",
  };
}

export async function fetchMarketingVehicles() {
  const [financeResult, rentResult] = await Promise.all([
    supabase
      .from("facebook_adverts")
      .select("id, title, picture, price, vat, salePrice, vanDescription, vanSpec, weblink, is_active")
      .eq("is_active", true),
    supabase
      .from("rent_vehicles")
      .select("id, registration, picture, monthly, week, initialRental, vanDescription, vanSpec, webLink, is_active")
      .eq("is_active", true),
  ]);

  if (financeResult.error) {
    throw new Error(`Failed to load finance vehicles: ${financeResult.error.message}`);
  }

  if (rentResult.error) {
    throw new Error(`Failed to load Rent2Buy vehicles: ${rentResult.error.message}`);
  }

  const financeVehicles = (financeResult.data || []).map(mapFinanceVehicleRow);
  const rentVehicles = (rentResult.data || []).map(mapRentVehicleRow);

  return [...financeVehicles, ...rentVehicles];
}
