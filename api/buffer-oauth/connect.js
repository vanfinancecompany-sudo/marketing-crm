export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Content-Type", "text/html; charset=utf-8");

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).send("Method not allowed.");
    return;
  }

  response.status(200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Connect Buffer | VFC Marketing CRM</title>
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
      width: min(580px, 100%);
      padding: 32px;
      border: 1px solid #2a2a2a;
      border-radius: 18px;
      background: #171717;
      box-shadow: 0 22px 70px rgba(0,0,0,.35);
    }
    .eyebrow { color: #f87171; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 8px 0 12px; font-size: 30px; }
    p { color: #cbd5e1; line-height: 1.6; }
    .field { display: none; margin-top: 18px; }
    label { display: block; margin-bottom: 8px; font-weight: 700; }
    input {
      width: 100%;
      padding: 12px 14px;
      border: 1px solid #3a3a3a;
      border-radius: 10px;
      background: #0f0f0f;
      color: #fff;
      font: inherit;
    }
    button {
      margin-top: 20px;
      width: 100%;
      padding: 13px 16px;
      border: 0;
      border-radius: 10px;
      background: #dc2626;
      color: #fff;
      font: inherit;
      font-weight: 800;
      cursor: pointer;
    }
    button:disabled { opacity: .55; cursor: wait; }
    .status { min-height: 24px; margin-top: 14px; color: #fca5a5; }
    .fine { margin-top: 18px; font-size: 13px; color: #94a3b8; }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">Buffer recovery</div>
    <h1>Connect the VFC Buffer App Client</h1>
    <p>This authorizes the Marketing CRM against the new App Client. Your Buffer Client Secret stays on the server and is never shown in this page.</p>
    <div class="field" id="keyField">
      <label for="accessKey">Marketing CRM access key</label>
      <input id="accessKey" type="password" autocomplete="current-password" />
    </div>
    <button id="connectButton" type="button">Connect Buffer</button>
    <div class="status" id="status" aria-live="polite"></div>
    <p class="fine">If this browser is already unlocked for the Marketing CRM, the saved access key is used automatically.</p>
  </main>
  <script>
    const STORAGE_KEY = "marketingCustomerDatabaseApiKey";
    const button = document.getElementById("connectButton");
    const field = document.getElementById("keyField");
    const input = document.getElementById("accessKey");
    const status = document.getElementById("status");

    function storedKey() {
      try {
        return String(localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY) || "").trim();
      } catch {
        return "";
      }
    }

    if (!storedKey()) field.style.display = "block";

    button.addEventListener("click", async () => {
      const key = storedKey() || String(input.value || "").trim();
      if (!key) {
        field.style.display = "block";
        status.textContent = "Enter the same access key you use to unlock the Marketing CRM.";
        return;
      }

      button.disabled = true;
      button.textContent = "Opening Buffer…";
      status.textContent = "";

      try {
        const result = await fetch("/api/buffer-oauth/start", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-marketing-customer-database-key": key,
          },
          body: "{}",
        });
        const payload = await result.json().catch(() => ({}));
        if (!result.ok || !payload.authorize_url) {
          throw new Error(payload.error || "Could not start Buffer authorization.");
        }
        window.location.assign(payload.authorize_url);
      } catch (error) {
        button.disabled = false;
        button.textContent = "Connect Buffer";
        status.textContent = error.message || "Could not start Buffer authorization.";
      }
    });
  </script>
</body>
</html>`);
}
