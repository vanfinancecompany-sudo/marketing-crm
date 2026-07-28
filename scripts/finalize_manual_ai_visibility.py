from pathlib import Path


def replace(path, old, new):
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"marker not found in {path}: {old[:80]!r}")
    file.write_text(text.replace(old, new), encoding="utf-8")


# Completed manual outcomes participate in checked-platform and visibility-rate calculations.
replace(
    "lib/aiVisibility.js",
    '  "not_detected",\n  "error",\n]);',
    '  "not_detected",\n  "inconclusive",\n  "error",\n]);',
)
replace(
    "lib/aiVisibility.js",
    '  "not_detected",\n]);\nexport const DETECTION_STATUSES',
    '  "not_detected",\n  "inconclusive",\n]);\nexport const DETECTION_STATUSES',
)

# Manual evidence accepts an editable query without requiring a pre-created monitoring prompt.
replace(
    "api/marketing-ai-visibility.js",
    '  "not_detected",\n]);',
    '  "not_detected",\n  "inconclusive",\n]);',
)
replace(
    "api/marketing-ai-visibility.js",
    'function validateManualResult(provider, status, promptId, evidence, sourceUrl) {',
    'function validateManualResult(provider, status, promptId, evidence, sourceUrl, structuredEvidence = {}) {',
)
replace(
    "api/marketing-ai-visibility.js",
    '''  if (AI_PROVIDER_KEYS.has(provider) && !promptId) {
    throw new ApiError(400, "Select the monitored prompt that produced this AI result.");
  }
  if (DETECTION_STATUSES.has(status) && !clean(evidence)) {''',
    '''  const queryUsed = clean(structuredEvidence.query_used, 500);
  if (AI_PROVIDER_KEYS.has(provider) && !promptId && !queryUsed) {
    throw new ApiError(400, "Record the public query used for this manual AI check.");
  }
  if (status === "detected" && structuredEvidence.detection_verified !== true) {
    throw new ApiError(400, "Detected may only be saved after the public result has been explicitly verified.");
  }
  if (DETECTION_STATUSES.has(status) && !clean(evidence)) {''',
)
replace(
    "api/marketing-ai-visibility.js",
    '  validateManualResult(provider, status, promptId, evidence, entry.source_url);',
    '''  const structuredEvidence =
    entry.structured_evidence && typeof entry.structured_evidence === "object"
      ? entry.structured_evidence
      : {};
  validateManualResult(provider, status, promptId, evidence, entry.source_url, structuredEvidence);''',
)
replace(
    "api/marketing-ai-visibility.js",
    '''        structured_evidence:
          entry.structured_evidence && typeof entry.structured_evidence === "object"
            ? entry.structured_evidence
            : {},''',
    '        structured_evidence: structuredEvidence,',
)

# Provider card wording uses supported-manual states rather than configuration errors.
replace(
    "pages/AIVisibilityPage.jsx",
    '  not_detected: "Not detected",\n  error: "Error",',
    '  not_detected: "Not detected",\n  inconclusive: "Inconclusive",\n  manual_check_required: "Manual check required",\n  error: "Error",',
)
replace(
    "pages/AIVisibilityPage.jsx",
    '{provider.connection_status.replaceAll("_", " ")}',
    '{STATUS_LABELS[provider.connection_status] || provider.connection_status.replaceAll("_", " ")}',
)

# Focused tests for the manual workflow and evidence-only counters.
tests = Path("tests/ai-visibility-manual-workflow.test.js")
tests.write_text('''import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MANUAL_AI_PROVIDER_URLS,
  MANUAL_PROVIDER_EXPLANATION,
  manualProviderStatus,
  suggestedVisibilityQuery,
  visibilityProviderConnection,
} from "../lib/aiVisibilityProviders.js";
import { buildVisibilitySummary } from "../lib/aiVisibility.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const article = {
  id: "article-1",
  title: "Can I Get Van Finance with a County Court Judgment?",
  live_wix_url: "https://www.vanfinancecompany.co.uk/knowledge-hub-article/ccj",
  published_at: "2026-07-01T10:00:00Z",
  publication_verified_at: "2026-07-01T10:05:00Z",
  wix_sync_status: "live",
  wix_publication_status: "live",
};

test("Google remains automated while AI providers are supported manual workflows", () => {
  assert.equal(visibilityProviderConnection("google_search_console", { connection_status: "connected" }).connection_status, "connected");
  for (const provider of Object.keys(MANUAL_AI_PROVIDER_URLS)) {
    const connection = visibilityProviderConnection(provider, { connection_status: "configuration_required", last_error: "missing key" });
    assert.equal(connection.connection_status, "manual_check_required");
    assert.equal(connection.configuration_summary, MANUAL_PROVIDER_EXPLANATION);
    assert.equal(connection.last_error, "");
  }
});

test("manual provider destinations are the public provider websites", () => {
  assert.deepEqual(MANUAL_AI_PROVIDER_URLS, {
    chatgpt: "https://chatgpt.com/",
    gemini: "https://gemini.google.com/",
    perplexity: "https://www.perplexity.ai/",
    google_ai_overviews: "https://www.google.com/",
  });
});

test("suggested query is natural, editable and not overly branded", () => {
  const query = suggestedVisibilityQuery(article.title);
  assert.match(query, /van finance/i);
  assert.match(query, /CCJ/i);
  assert.match(query, /UK/i);
  assert.doesNotMatch(query, /Van Finance Company/i);
});

test("manual provider statuses follow stored evidence only", () => {
  assert.equal(manualProviderStatus(null), "Manual check required");
  assert.equal(manualProviderStatus({ result_status: "detected" }), "Checked — detected");
  assert.equal(manualProviderStatus({ result_status: "not_detected" }), "Checked — not detected");
  assert.equal(manualProviderStatus({ result_status: "inconclusive" }), "Checked — inconclusive");
});

test("verified detections update AI visible while topic similarity alone does not", () => {
  const detected = buildVisibilitySummary({ articles: [article], results: [{ id: "r1", article_id: article.id, provider: "chatgpt", checked_at: "2026-07-10T10:00:00Z", result_status: "detected", manually_verified: true }] });
  assert.equal(detected.ai_visible, 1);
  assert.equal(detected.total_verified_detections, 1);
  const inconclusive = buildVisibilitySummary({ articles: [article], results: [{ id: "r2", article_id: article.id, provider: "chatgpt", checked_at: "2026-07-10T10:00:00Z", result_status: "inconclusive", manually_verified: true, evidence_excerpt: "Generic answer only" }] });
  assert.equal(inconclusive.ai_visible, 0);
  assert.equal(inconclusive.visibility_rate_denominator, 1);
  assert.equal(inconclusive.visibility_rate, 0);
});

test("unchecked articles are excluded from visibility rate", () => {
  const summary = buildVisibilitySummary({ articles: [article], results: [] });
  assert.equal(summary.visibility_rate_denominator, 0);
  assert.equal(summary.visibility_rate, 0);
});

test("workflow exposes editable query, evidence states and public links without scraping", async () => {
  const component = await read("../components/AIVisibilityLiveConnections.jsx");
  assert.match(component, /Run Manual Check/);
  assert.match(component, /Copy Query/);
  assert.match(component, /Open Provider/);
  assert.match(component, /Add Evidence/);
  assert.match(component, /Detected/);
  assert.match(component, /Not detected/);
  assert.match(component, /Inconclusive/);
  assert.match(component, /target="_blank"/);
  assert.doesNotMatch(component, /scrape|puppeteer|playwright|automated public-visibility/);
});

test("API requires observed detection evidence and never infers detection from the query", async () => {
  const api = await read("../api/marketing-ai-visibility.js");
  assert.match(api, /detection_verified !== true/);
  assert.match(api, /Detected may only be saved/);
  assert.doesNotMatch(api, /topic similarity|semantic similarity/);
});

test("Google remains explicit and no AI generation API or live Wix publishing is introduced", async () => {
  const component = await read("../components/AIVisibilityLiveConnections.jsx");
  const providers = await read("../lib/aiVisibilityProviders.js");
  const wix = await read("../api/marketing-wix-publishing.js");
  assert.match(component, /Check Google for Published Pages/);
  assert.doesNotMatch(component, /useEffect\([^]*checkGoogleForPublishedPages/);
  assert.doesNotMatch(providers, /api\.openai\.com|generativelanguage\.googleapis|api\.perplexity/);
  assert.doesNotMatch(wix, /publishLive|livePublish/);
});

test("migration adds inconclusive without removing evidence", async () => {
  const migration = await read("../supabase/migrations/025_manual_ai_visibility_evidence.sql");
  assert.match(migration, /inconclusive/);
  assert.doesNotMatch(migration, /truncate|delete from|drop table/);
});
''', encoding="utf-8")
