const DOCS_URL = "https://developers.dealerkit.co.uk/";
const POSTMAN_URL = "https://www.postman.com/dealerkit/dealerkit-integrator-api/overview";
const FETCH_TIMEOUT_MS = 12000;
const MAX_HTML_CHARS = 500000;
const MAX_SCRIPT_BYTES = 750000;
const MAX_SCRIPTS = 12;

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function timeoutSignal(timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

async function fetchText(url, { maxChars = MAX_HTML_CHARS } = {}) {
  const timed = timeoutSignal();
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: timed.signal,
      headers: {
        accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 DealerKitPhase1Inspection/1.0",
      },
    });
    const text = (await response.text()).slice(0, maxChars);
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      contentType: response.headers.get("content-type") || "",
      text,
    };
  } finally {
    timed.clear();
  }
}

function absoluteUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
}

function extractHtmlMetadata(html, baseUrl) {
  const title = compact(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const scripts = [];
  const links = [];
  const scriptPattern = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  const linkPattern = /<(?:a|link)\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi;
  let match;

  while ((match = scriptPattern.exec(html)) && scripts.length < 50) {
    const url = absoluteUrl(match[1], baseUrl);
    if (url && !scripts.includes(url)) scripts.push(url);
  }
  while ((match = linkPattern.exec(html)) && links.length < 100) {
    const url = absoluteUrl(match[1], baseUrl);
    if (url && !links.includes(url)) links.push(url);
  }

  const absoluteUrls = Array.from(new Set((html.match(/https?:\/\/[^\s"'<>\\)]+/gi) || [])
    .map((value) => value.replace(/[\],};]+$/g, ""))
    .filter(Boolean)))
    .slice(0, 100);

  return { title, scripts, links, absoluteUrls };
}

function extractLikelyApiClues(text) {
  const source = String(text || "");
  const urls = Array.from(new Set((source.match(/https?:\/\/[^\s"'<>\\)]+/gi) || [])
    .map((value) => value.replace(/[\],};]+$/g, ""))
    .filter((url) => /dealerkit|api/i.test(url))))
    .slice(0, 100);

  const pathCandidates = Array.from(new Set((source.match(/["'`](\/(?:api|integrator|integrators|stock|vehicle|vehicles|dealer|dealers)[A-Za-z0-9_?&=./:{}-]*)["'`]/gi) || [])
    .map((value) => value.slice(1, -1))
    .filter((value) => value.length <= 220)))
    .slice(0, 100);

  const keywordSnippets = [];
  const keywordPattern = /(authorization|bearer|api[-_ ]?key|api[-_ ]?secret|dealer[-_ ]?id|stock|vehicles?|pagination|webhook|rate[-_ ]?limit)/gi;
  let match;
  while ((match = keywordPattern.exec(source)) && keywordSnippets.length < 60) {
    const start = Math.max(0, match.index - 120);
    const end = Math.min(source.length, match.index + match[0].length + 180);
    keywordSnippets.push(compact(source.slice(start, end)).slice(0, 360));
  }

  return { urls, pathCandidates, keywordSnippets: Array.from(new Set(keywordSnippets)).slice(0, 40) };
}

async function inspectScript(url) {
  try {
    const result = await fetchText(url, { maxChars: MAX_SCRIPT_BYTES });
    return {
      url,
      ok: result.ok,
      status: result.status,
      contentType: result.contentType,
      clues: result.ok ? extractLikelyApiClues(result.text) : { urls: [], pathCandidates: [], keywordSnippets: [] },
    };
  } catch (error) {
    return { url, ok: false, error: error?.name === "AbortError" ? "timeout" : compact(error?.message || "fetch failed") };
  }
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  try {
    const [docs, postman] = await Promise.all([
      fetchText(DOCS_URL),
      fetchText(POSTMAN_URL),
    ]);

    const docsMeta = extractHtmlMetadata(docs.text, docs.finalUrl || DOCS_URL);
    const postmanMeta = extractHtmlMetadata(postman.text, postman.finalUrl || POSTMAN_URL);
    const scriptResults = await Promise.all(docsMeta.scripts.slice(0, MAX_SCRIPTS).map(inspectScript));

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: true,
      environment: {
        vercelEnv: process.env.VERCEL_ENV || "",
        dealerKitSecretConfigured: Boolean(process.env.DEALERKIT_API_SECRET),
        dealerKitDealerIdConfigured: Boolean(process.env.DEALERKIT_DEALER_ID),
      },
      docs: {
        ok: docs.ok,
        status: docs.status,
        finalUrl: docs.finalUrl,
        contentType: docs.contentType,
        metadata: docsMeta,
        inlineClues: extractLikelyApiClues(docs.text),
        scripts: scriptResults,
      },
      postman: {
        ok: postman.ok,
        status: postman.status,
        finalUrl: postman.finalUrl,
        contentType: postman.contentType,
        metadata: postmanMeta,
        inlineClues: extractLikelyApiClues(postman.text),
      },
      safety: {
        readOnly: true,
        secretValueReturned: false,
        dealerIdValueReturned: false,
        dealerApiCalled: false,
      },
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      message: error?.name === "AbortError" ? "DealerKit documentation inspection timed out." : compact(error?.message || "DealerKit documentation inspection failed."),
    });
  }
}
