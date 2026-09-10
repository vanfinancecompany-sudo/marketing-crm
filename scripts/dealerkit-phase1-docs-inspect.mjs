const DOCS_URL = "https://developers.dealerkit.co.uk/";
const POSTMAN_URL = "https://www.postman.com/dealerkit/dealerkit-integrator-api/overview";
const MAX_HTML = 500000;
const MAX_SCRIPT = 700000;
const MAX_SCRIPTS = 10;

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

async function fetchText(url, maxChars = MAX_HTML) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 DealerKitPhase1Inspection/1.0",
      },
    });
    const text = (await response.text()).slice(0, maxChars);
    return { ok: response.ok, status: response.status, finalUrl: response.url, contentType: response.headers.get("content-type") || "", text };
  } finally {
    clearTimeout(timeout);
  }
}

function toAbsolute(value, base) {
  try { return new URL(value, base).toString(); } catch { return ""; }
}

function metadata(html, base) {
  const title = compact(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const scripts = [];
  const links = [];
  let match;
  const scriptPattern = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  while ((match = scriptPattern.exec(html)) && scripts.length < 50) {
    const url = toAbsolute(match[1], base);
    if (url && !scripts.includes(url)) scripts.push(url);
  }
  const linkPattern = /<(?:a|link)\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi;
  while ((match = linkPattern.exec(html)) && links.length < 100) {
    const url = toAbsolute(match[1], base);
    if (url && !links.includes(url)) links.push(url);
  }
  return { title, scripts, links };
}

function clues(source) {
  const text = String(source || "");
  const urls = Array.from(new Set((text.match(/https?:\/\/[^\s"'<>\\)]+/gi) || [])
    .map((url) => url.replace(/[\],};]+$/g, ""))
    .filter((url) => /dealerkit|api/i.test(url))))
    .slice(0, 80);

  const pathMatches = text.match(/["'`](\/(?:api|integrator|integrators|stock|vehicle|vehicles|dealer|dealers)[A-Za-z0-9_?&=./:{}-]*)["'`]/gi) || [];
  const paths = Array.from(new Set(pathMatches.map((value) => value.slice(1, -1)).filter((value) => value.length <= 220))).slice(0, 80);

  const snippets = [];
  const rx = /(authorization|bearer|api[-_ ]?key|api[-_ ]?secret|dealer[-_ ]?id|stock|vehicles?|pagination|webhooks?|rate[-_ ]?limit)/gi;
  let match;
  while ((match = rx.exec(text)) && snippets.length < 50) {
    snippets.push(compact(text.slice(Math.max(0, match.index - 100), Math.min(text.length, match.index + 220))).slice(0, 320));
  }
  return { urls, paths, snippets: Array.from(new Set(snippets)).slice(0, 30) };
}

function printSection(label, value) {
  console.log(`\n[DealerKit Phase 1] ${label}`);
  console.log(JSON.stringify(value, null, 2));
}

async function inspectPage(label, url) {
  try {
    const result = await fetchText(url);
    const meta = metadata(result.text, result.finalUrl || url);
    printSection(`${label} page`, {
      ok: result.ok,
      status: result.status,
      finalUrl: result.finalUrl,
      contentType: result.contentType,
      title: meta.title,
      links: meta.links.slice(0, 40),
      scripts: meta.scripts.slice(0, 20),
      inlineClues: clues(result.text),
    });
    return { result, meta };
  } catch (error) {
    printSection(`${label} page error`, { name: error?.name || "Error", message: compact(error?.message || "fetch failed") });
    return null;
  }
}

export async function inspectDealerKitPublicDocs() {
  console.log("\n[DealerKit Phase 1] Starting read-only documentation inspection.");
  console.log(JSON.stringify({
    vercelEnv: process.env.VERCEL_ENV || "",
    gitRef: process.env.VERCEL_GIT_COMMIT_REF || "",
    secretConfigured: Boolean(process.env.DEALERKIT_API_SECRET),
    dealerIdConfigured: Boolean(process.env.DEALERKIT_DEALER_ID),
    secretValueLogged: false,
    dealerApiCalled: false,
  }, null, 2));

  const docs = await inspectPage("Developer docs", DOCS_URL);
  await inspectPage("Postman workspace", POSTMAN_URL);

  if (docs?.meta?.scripts?.length) {
    const sameOriginScripts = docs.meta.scripts.filter((url) => {
      try { return new URL(url).origin === new URL(docs.result.finalUrl || DOCS_URL).origin; } catch { return false; }
    }).slice(0, MAX_SCRIPTS);

    for (const scriptUrl of sameOriginScripts) {
      try {
        const script = await fetchText(scriptUrl, MAX_SCRIPT);
        printSection("Docs script clues", {
          url: scriptUrl,
          ok: script.ok,
          status: script.status,
          contentType: script.contentType,
          clues: script.ok ? clues(script.text) : { urls: [], paths: [], snippets: [] },
        });
      } catch (error) {
        printSection("Docs script error", { url: scriptUrl, name: error?.name || "Error", message: compact(error?.message || "fetch failed") });
      }
    }
  }

  console.log("\n[DealerKit Phase 1] Documentation inspection complete. No DealerKit API request was made.\n");
}
