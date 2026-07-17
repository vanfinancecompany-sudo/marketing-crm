import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { getOverview } from "../api/marketing-suppressions.js";

test("Suppression Centre nests exact non-zero lifecycle counts in the rendered overview contract", async () => {
  const counts = { active: 1195, awaiting_verification: 30901, suppressed: 149 };
  const supabase = {
    async rpc() {
      return { data: { overview: { total_contacts: 32245, suppressed_contacts: 149 }, totals: {} }, error: null };
    },
    from() {
      return {
        select() { return this; },
        async eq(column, status) {
          assert.equal(column, "lifecycle_status");
          return { data: null, count: counts[status], error: null };
        },
      };
    },
  };

  const result = await getOverview(supabase);
  assert.deepEqual(result.overview, {
    total_contacts: 32245,
    verified_active_contacts: 1195,
    awaiting_verification_contacts: 30901,
    suppressed_contacts: 149,
  });

  const page = fs.readFileSync(new URL("../public/suppression-centre/index.html", import.meta.url), "utf8");
  assert.match(page, /\["Verified \/ Active", overview\.verified_active_contacts\]/);
  assert.match(page, /\["Awaiting Verification", overview\.awaiting_verification_contacts\]/);
});

function selectorDeclarations(source, selector) {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1].split(",").map((item) => item.trim()).includes(selector))
    .map((match) => match[2]);
}

function campaignPublicSources() {
  const directory = new URL("../public/campaigns/", import.meta.url);
  return fs.readdirSync(directory)
    .filter((name) => /\.(?:html|js)$/.test(name))
    .map((name) => ({ name, source: fs.readFileSync(new URL(name, directory), "utf8") }));
}

function cssBlocks(name, source) {
  if (name.endsWith(".html")) return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]);
  return [...source.matchAll(/style\.(?:textContent|innerHTML)\s*=\s*`([\s\S]*?)`/g)].map((match) => match[1]);
}

test("all Campaign Preview layout comes from one static, non-pinned stylesheet", () => {
  const page = fs.readFileSync(new URL("../public/campaigns/index.html", import.meta.url), "utf8");
  const files = campaignPublicSources();
  const allCss = files.flatMap(({ name, source }) => cssBlocks(name, source));
  const pageCss = cssBlocks("index.html", page).join("\n");
  const selectors = [".campaign-preview-column", ".detail-grid > .card.detail-stack.campaign-preview-column", "#previewFrameShell", ".preview-frame", ".preview-frame.mobile-mode", "#previewFrame", "#previewFrame.mobile"];

  for (const selector of selectors) {
    const declarations = selectorDeclarations(pageCss, selector);
    assert.ok(declarations.length > 0, `${selector} must have an authoritative static rule`);
  }

  const previewSelector = /(?:campaign-preview-column|detail-grid\s*>\s*\.card\.detail-stack|previewFrameShell|\.preview-frame|#previewFrame)/i;
  for (const css of allCss) {
    const previewRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((match) => previewSelector.test(match[1]));
    for (const [, selector, rule] of previewRules) {
      assert.doesNotMatch(rule, /position\s*:\s*(?:fixed|absolute|sticky)/i, `${selector} must not escape normal flow`);
      assert.doesNotMatch(rule, /(?:^|;)\s*top\s*:/i, `${selector} must not use a top offset`);
      assert.doesNotMatch(rule, /(?:^|;)\s*right\s*:/i, `${selector} must not use a right offset`);
      for (const zIndex of rule.matchAll(/z-index\s*:\s*([^;]+)/gi)) {
        assert.match(zIndex[1].trim(), /^auto(?:\s*!important)?$/i, `${selector} must not use an elevated z-index`);
      }
    }
  }

  const previewCssOwners = files.filter(({ name, source }) => cssBlocks(name, source).some((css) => previewSelector.test(css))).map(({ name }) => name);
  assert.deepEqual(previewCssOwners, ["index.html"], "index.html must be the only authoritative Preview stylesheet");

  for (const { name, source } of files.filter(({ name }) => name.endsWith(".js"))) {
    for (const injected of cssBlocks(name, source)) {
      assert.doesNotMatch(injected, previewSelector, `${name} must not inject or reinject Preview layout CSS`);
    }
    for (const assignment of source.matchAll(/innerHTML\s*=\s*`([\s\S]*?)`/g)) {
      assert.ok(!(previewSelector.test(assignment[1]) && /\{[^}]*position\s*:/i.test(assignment[1])), `${name} must not inject Preview CSS through innerHTML`);
    }
  }

  assert.match(pageCss, /\.detail-grid > \.card\.detail-stack\.campaign-preview-column[^}]*position:\s*static[^}]*inset:\s*auto[^}]*transform:\s*none[^}]*z-index:\s*auto/);
  assert.match(pageCss, /@media \(max-width:\s*1040px\)\s*\{[^}]*\.detail-grid[^}]*grid-template-columns:\s*1fr/);
  assert.match(page, /id="togglePreview"[^>]*>Hide Preview<\/button>/);
  assert.match(page, /classList\.toggle\("preview-content-hidden"\)/);

  const includes = [...page.matchAll(/<script[^>]+src="([^"]*ui-preview-polish[^"]*)"[^>]*><\/script>/g)].map((match) => match[1]);
  assert.deepEqual(includes, ["/campaigns/ui-preview-polish-v2.js?v=20260717-no-preview-injector"]);
  const assetPath = includes[0].split("?")[0];
  assert.ok(fs.existsSync(new URL(`../public${assetPath}`, import.meta.url)), "cache-busted Preview polish URL must point to the current asset");
});
