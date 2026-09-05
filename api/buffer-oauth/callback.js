import { exchangeBufferOAuthCode } from "../../lib/bufferOAuth.js";

function firstQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderPage({ ok, title, message }) {
  const accent = ok ? "#22c55e" : "#ef4444";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      background: #101010;
      color: #f8fafc;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(560px, 100%);
      padding: 32px;
      border: 1px solid #2a2a2a;
      border-radius: 18px;
      background: #171717;
      box-shadow: 0 22px 70px rgba(0,0,0,.35);
    }
    .dot { width: 12px; height: 12px; border-radius: 999px; background: ${accent}; margin-bottom: 18px; }
    h1 { margin: 0 0 12px; font-size: 28px; }
    p { margin: 0; color: #cbd5e1; line-height: 1.6; }
    a { display: inline-block; margin-top: 22px; color: #fff; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <div class="dot"></div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <a href="/">Return to Marketing CRM</a>
  </main>
</body>
</html>`;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Content-Type", "text/html; charset=utf-8");

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).send(renderPage({
      ok: false,
      title: "Method not allowed",
      message: "Open this callback through the Buffer authorization flow.",
    }));
    return;
  }

  const providerError = firstQueryValue(request.query?.error);
  if (providerError) {
    response.status(400).send(renderPage({
      ok: false,
      title: "Buffer connection cancelled",
      message: "Buffer did not authorize the Marketing CRM. Nothing was changed.",
    }));
    return;
  }

  try {
    const result = await exchangeBufferOAuthCode({
      code: firstQueryValue(request.query?.code),
      state: firstQueryValue(request.query?.state),
    });
    response.status(200).send(renderPage({
      ok: true,
      title: "Buffer connected",
      message: `VFC Marketing CRM is authorized through the new Buffer App Client. Access is active until ${result.expiresAt ? new Date(result.expiresAt).toLocaleString("en-GB") : "the next token refresh"}, and will refresh automatically.`,
    }));
  } catch (error) {
    console.error("[buffer-oauth] callback failed", {
      message: error?.message || String(error),
      code: error?.code || null,
    });
    response.status(400).send(renderPage({
      ok: false,
      title: "Buffer connection failed",
      message: "The Marketing CRM could not verify this Buffer authorization. Please return to the CRM and start the connection again.",
    }));
  }
}
