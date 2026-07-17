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

test("every Preview card, shell, wrapper and frame selector remains normal in-grid content", () => {
  const page = fs.readFileSync(new URL("../public/campaigns/index.html", import.meta.url), "utf8");
  const polish = fs.readFileSync(new URL("../public/campaigns/ui-preview-polish.js", import.meta.url), "utf8");
  const combined = `${page}\n${polish}`;
  const selectors = [".campaign-preview-column", "#previewFrameShell", ".preview-frame", ".preview-frame.mobile-mode", "#previewFrame", "#previewFrame.mobile"];

  for (const selector of selectors) {
    const declarations = selectorDeclarations(combined, selector);
    assert.ok(declarations.length > 0, `${selector} must have an explicit layout rule`);
    for (const rule of declarations) {
      assert.doesNotMatch(rule, /position\s*:\s*(?:fixed|absolute|sticky)/i, `${selector} must not escape normal flow`);
      assert.doesNotMatch(rule, /(?:^|;)\s*right\s*:/i, `${selector} must not use a right offset`);
      assert.doesNotMatch(rule, /transform\s*:/i, `${selector} must not use transforms`);
      assert.doesNotMatch(rule, /(?:width|max-width|min-width)\s*:[^;]*vw/i, `${selector} must not use viewport width`);
    }
  }

  assert.match(combined, /@media \(max-width:\s*1040px\)[\s\S]*?\.campaign-preview-column[^}]*position:\s*static/);
  assert.match(page, /id="togglePreview"[^>]*>Hide Preview<\/button>/);
  assert.match(page, /classList\.toggle\("preview-content-hidden"\)/);
});
