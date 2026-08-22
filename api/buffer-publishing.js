import { createClient } from "@supabase/supabase-js";
import {
  BUFFER_API_URL,
  BUFFER_CREATE_POST_MUTATION,
  bufferDestinationForProduct,
  buildBufferCreatePostInput,
  parseBufferCreatePostPayload,
} from "../lib/bufferPublishing.js";
import { buildAutomatedFacebookCaption } from "../lib/facebookAutomationContent.js";
import {
  mapFinanceVehicleRow,
  mapRentVehicleRow,
} from "../services/marketingVehicleContract.js";

const ACCESS_HEADER = "x-marketing-customer-database-key";

function sendJson(response, status, payload) {
  response.status(status).json(payload);
}

function authorize(request) {
  const expected = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const supplied = String(request.headers[ACCESS_HEADER] || "");
  const authorization = String(request.headers.authorization || "");
  return Boolean(
    expected &&
      (supplied === expected ||
        (authorization.startsWith("Bearer ") && authorization.slice(7) === expected)),
  );
}

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeRegistration(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function parseBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body);
    } catch {
      return {};
    }
  }
  return {};
}

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing server Supabase environment variables.");
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

async function loadVehicle(productKey, registration) {
  const wanted = normalizeRegistration(registration);
  if (!wanted) return null;
  const supabase = getSupabase();

  if (productKey === "rent2buy") {
    const result = await supabase
      .from("rent_vehicles")
      .select("id,created_at,registration,picture,monthly,week,initialRental,vanDescription,vanSpec,webLink,is_active")
      .eq("is_active", true)
      .limit(500);
    if (result.error) throw result.error;
    return (result.data || [])
      .map(mapRentVehicleRow)
      .find((vehicle) => normalizeRegistration(vehicle.registration || vehicle.reg) === wanted) || null;
  }

  const result = await supabase
    .from("facebook_adverts")
    .select("id,title,picture,price,vat,salePrice,vanDescription,vanSpec,weblink,is_active")
    .eq("is_active", true)
    .limit(500);
  if (result.error) throw result.error;
  return (result.data || [])
    .map(mapFinanceVehicleRow)
    .find((vehicle) => normalizeRegistration(vehicle.registration || vehicle.reg || vehicle.title) === wanted) || null;
}

async function canonicalCaption(body, destination, productKey) {
  const registration = normalizeRegistration(body.registration);
  if (!registration) return clean(body.text);

  const vehicle = await loadVehicle(productKey, registration);
  if (vehicle) return buildAutomatedFacebookCaption(vehicle, productKey);

  return buildAutomatedFacebookCaption({
    registration,
    reg: registration,
    title: clean(body.title) || registration,
    name: clean(body.title) || registration,
    vanDescription: clean(body.title) || registration,
  }, productKey);
}

async function createBufferPost({ destination, text, mediaUrl, mediaKind, draft }) {
  const token = clean(process.env.BUFFER_API_KEY);
  if (!token) throw new Error("BUFFER_API_KEY is not configured on the server.");

  const input = buildBufferCreatePostInput({
    destination,
    text,
    mediaUrl,
    mediaKind,
    draft,
  });

  const response = await fetch(BUFFER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      query: BUFFER_CREATE_POST_MUTATION,
      variables: { input },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.errors?.[0]?.message || `Buffer returned HTTP ${response.status}.`);
  }

  return parseBufferCreatePostPayload(payload);
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { ok: false, error: "Method not allowed." });
    return;
  }

  if (!authorize(request)) {
    sendJson(response, 401, { ok: false, error: "Marketing access key not recognised." });
    return;
  }

  try {
    const body = parseBody(request);
    const action = clean(body.action);

    let destination = clean(body.destination);
    let productKey = destination === "Rent2Buy Facebook" ? "rent2buy" : "vanFinance";
    let mediaKind = "image";
    let draft = true;

    if (action === "createFacebookReelDraft") {
      productKey = clean(body.productKey) === "rent2buy" ? "rent2buy" : "vanFinance";
      destination = bufferDestinationForProduct(productKey);
      mediaKind = "video";
    } else if (action === "createFacebookReelQueue") {
      if (body.confirmQueue !== true) {
        sendJson(response, 400, { ok: false, error: "Explicit Buffer queue confirmation is required." });
        return;
      }
      productKey = clean(body.productKey) === "rent2buy" ? "rent2buy" : "vanFinance";
      destination = bufferDestinationForProduct(productKey);
      mediaKind = "video";
      draft = false;
    } else if (action !== "createFacebookImageDraft") {
      sendJson(response, 400, { ok: false, error: "Unsupported Buffer publishing action." });
      return;
    }

    const text = await canonicalCaption(body, destination, productKey);
    const post = await createBufferPost({
      destination,
      text,
      mediaUrl: body.mediaUrl,
      mediaKind,
      draft,
    });

    const mode = draft ? "draft" : "queue";
    sendJson(response, 200, {
      ok: true,
      mode,
      destination,
      bufferPostId: post.id,
      status: post.status || (draft ? "draft" : "scheduled"),
      text: post.text || text,
      assets: post.assets || [],
    });
  } catch (error) {
    console.error("[buffer-publishing] request failed", {
      message: error?.message || String(error),
    });
    sendJson(response, 500, {
      ok: false,
      error: error?.message || "Buffer publishing request failed.",
    });
  }
}
