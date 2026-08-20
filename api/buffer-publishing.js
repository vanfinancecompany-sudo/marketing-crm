import {
  BUFFER_API_URL,
  BUFFER_CREATE_POST_MUTATION,
  bufferDestinationForProduct,
  buildBufferCreatePostInput,
  parseBufferCreatePostPayload,
} from "../lib/bufferPublishing.js";

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

async function createBufferDraft({ destination, text, mediaUrl, mediaKind }) {
  const token = clean(process.env.BUFFER_API_KEY);
  if (!token) throw new Error("BUFFER_API_KEY is not configured on the server.");

  const input = buildBufferCreatePostInput({
    destination,
    text,
    mediaUrl,
    mediaKind,
    draft: true,
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
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const action = clean(body.action);

    let destination = clean(body.destination);
    let mediaKind = "image";

    if (action === "createFacebookReelDraft") {
      destination = bufferDestinationForProduct(clean(body.productKey));
      mediaKind = "video";
    } else if (action !== "createFacebookImageDraft") {
      sendJson(response, 400, { ok: false, error: "Unsupported Buffer publishing action." });
      return;
    }

    const post = await createBufferDraft({
      destination,
      text: body.text,
      mediaUrl: body.mediaUrl,
      mediaKind,
    });

    sendJson(response, 200, {
      ok: true,
      mode: "draft",
      destination,
      bufferPostId: post.id,
      status: post.status || "draft",
      text: post.text || clean(body.text),
      assets: post.assets || [],
    });
  } catch (error) {
    console.error("[buffer-publishing] draft failed", {
      message: error?.message || String(error),
    });
    sendJson(response, 500, {
      ok: false,
      error: error?.message || "Buffer draft creation failed.",
    });
  }
}
