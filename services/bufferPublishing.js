import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "./marketingAccess.js";

const BUFFER_API_ROUTE = "/api/buffer-publishing";

async function requestBufferDraft(action, payload = {}) {
  const response = await fetch(BUFFER_API_ROUTE, {
    method: "POST",
    headers: buildMarketingAccessHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ action, ...payload }),
  });

  return parseMarketingJsonResponse(
    response,
    "Buffer draft creation failed.",
  );
}

export function createBufferFacebookImageDraft({
  destination,
  text,
  imageUrl,
  registration = "",
} = {}) {
  return requestBufferDraft("createFacebookImageDraft", {
    destination,
    text,
    mediaUrl: imageUrl,
    registration,
  });
}

export function createBufferFacebookReelDraft({
  productKey,
  text,
  videoUrl,
  registration = "",
} = {}) {
  return requestBufferDraft("createFacebookReelDraft", {
    productKey,
    text,
    mediaUrl: videoUrl,
    registration,
  });
}
