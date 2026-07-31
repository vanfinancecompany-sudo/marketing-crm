import test from "node:test";
import assert from "node:assert/strict";
import {
  isSharedKnowledgeHubUrl,
  resolveWixLiveArticleUrl,
} from "../lib/aiVisibilityLiveConnections.js";

const root = "https://www.vanfinancecompany.co.uk/knowledge-hub/";

test("authoritative Wix dynamic-page link wins over shared Knowledge Hub URL", () => {
  const result = resolveWixLiveArticleUrl({
    id: "wix-1",
    data: {
      url: root,
      slug: "annual-mileage-rent2buy",
      "link-knowledge-hub-title": "/knowledge-hub/annual-mileage-rent2buy",
    },
  });

  assert.equal(
    result.url,
    "https://www.vanfinancecompany.co.uk/knowledge-hub/annual-mileage-rent2buy",
  );
  assert.equal(result.source, "wix_dynamic_link_field");
  assert.equal(result.source_field, "link-knowledge-hub-title");
  assert.equal(isSharedKnowledgeHubUrl(result.url), false);
});

test("authoritative Wix slug replaces the shared Knowledge Hub root", () => {
  const result = resolveWixLiveArticleUrl({
    id: "wix-2",
    data: {
      url: root,
      slug: "rent2buy-mileage-allowance",
    },
  });

  assert.equal(
    result.url,
    "https://www.vanfinancecompany.co.uk/knowledge-hub/rent2buy-mileage-allowance",
  );
  assert.equal(result.source, "wix_slug_route");
  assert.equal(result.source_field, "slug");
});

test("two different Wix items cannot resolve to the shared Knowledge Hub root", () => {
  const first = resolveWixLiveArticleUrl({
    id: "wix-1",
    data: { url: root, slug: "first-article" },
  });
  const second = resolveWixLiveArticleUrl({
    id: "wix-2",
    data: { url: root, slug: "second-article" },
  });

  assert.notEqual(first.url, second.url);
  assert.equal(isSharedKnowledgeHubUrl(first.url), false);
  assert.equal(isSharedKnowledgeHubUrl(second.url), false);
});

test("a shared root with no authoritative dynamic link or slug is rejected", () => {
  const result = resolveWixLiveArticleUrl({
    id: "wix-3",
    data: { url: root },
  });

  assert.equal(result.url, "");
  assert.equal(result.source, "unavailable");
});
