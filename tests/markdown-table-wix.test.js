import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  parseMarkdownTable,
  renderKnowledgePreviewHtml,
  splitMarkdownTableSegments,
} from "../lib/markdownTables.js";
import {
  buildWixPlainTextContent,
  buildWixRichContent,
  collectMarkdownTableWarnings,
} from "../lib/wixPublishing.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const standard = `## Comparison

| Feature | Option A | Option B |
| --- | --- | --- |
| Deposit | £500 | £750 |
| Term | 36 months | 48 months |

Final paragraph.`;

test("standard Markdown table becomes responsive Wix rich content", () => {
  const rich = buildWixRichContent(standard);
  const htmlNode = rich.nodes.find((node) => node.type === "HTML");
  assert.ok(htmlNode);
  assert.match(htmlNode.htmlData.html, /<table>/);
  assert.match(htmlNode.htmlData.html, /kh-responsive-table__mobile/);
  assert.match(htmlNode.htmlData.html, /Deposit/);
  assert.doesNotMatch(htmlNode.htmlData.html, /\|\s*---\s*\|/);
});

test("two-column comparison uses first cell as mobile row heading", () => {
  const markdown = `| Vehicle | Best for |\n| --- | --- |\n| Small van | City work |`;
  const rich = buildWixRichContent(markdown);
  const html = rich.nodes.find((node) => node.type === "HTML").htmlData.html;
  assert.match(html, /<h4>Small van<\/h4>/);
  assert.match(html, /<strong>Best for<\/strong>/);
});

test("multi-column and empty cells are preserved", () => {
  const markdown = `| Van | Payload | Notes |\n| --- | --- | --- |\n| Transit | 1,200kg | |`;
  const parsed = parseMarkdownTable(markdown.split("\n"), 0);
  assert.equal(parsed.headers.length, 3);
  assert.equal(parsed.rows[0][2], "");
  const rich = buildWixRichContent(markdown);
  assert.match(rich.nodes.find((node) => node.type === "HTML").htmlData.html, /Transit/);
});

test("multiple tables are converted independently", () => {
  const markdown = `${standard}\n\n## Second\n\n| Item | Value |\n| --- | --- |\n| One | Two |`;
  const rich = buildWixRichContent(markdown);
  assert.equal(rich.nodes.filter((node) => node.type === "HTML").length, 2);
});

test("bold text and links inside cells remain meaningful", () => {
  const markdown = `| Item | Details |\n| --- | --- |\n| **Transit** | [View vans](/vans) |`;
  const html = buildWixRichContent(markdown).nodes.find((node) => node.type === "HTML").htmlData.html;
  assert.match(html, /<strong>Transit<\/strong>/);
  assert.match(html, /href="\/vans"/);
});

test("malformed table falls back to readable blocks and records warning", () => {
  const malformed = `Before\n\n| Vehicle | Best for |\n| Transit | Builders |\n\nAfter`;
  const { segments, warnings } = splitMarkdownTableSegments(malformed);
  assert.equal(warnings.length, 1);
  assert.ok(segments.some((segment) => segment.type === "table_fallback"));
  const rich = buildWixRichContent(malformed);
  const html = rich.nodes.find((node) => node.type === "HTML").htmlData.html;
  assert.match(html, /kh-table-fallback/);
  assert.doesNotMatch(html, /\| Vehicle \|/);
  assert.equal(collectMarkdownTableWarnings(malformed).length, 1);
});

test("plain-text Wix fields receive stacked table content without pipe syntax", () => {
  const text = buildWixPlainTextContent(standard);
  assert.match(text, /Deposit\nOption A: £500\nOption B: £750/);
  assert.doesNotMatch(text, /\|\s*---\s*\|/);
});

test("converted tables inherit surrounding article typography", () => {
  const html = buildWixRichContent(standard).nodes.find((node) => node.type === "HTML").htmlData.html;
  assert.match(html, /font-family:inherit/);
  assert.match(html, /font-size:inherit/);
  assert.match(html, /line-height:inherit/);
  assert.match(html, /color:inherit/);
  assert.doesNotMatch(html, /font-family\s*:\s*(?!inherit)/);
  assert.doesNotMatch(html, /font-size\s*:\s*\d+(?:\.\d+)?px/);
});

test("desktop table and mobile cards share the same typography rules", () => {
  const html = buildWixRichContent(standard).nodes.find((node) => node.type === "HTML").htmlData.html;
  assert.match(html, /\.kh-responsive-table,\.kh-responsive-table \*,\.kh-table-fallback,\.kh-table-fallback \*\{font-family:inherit;font-size:inherit;line-height:inherit;color:inherit\}/);
  assert.match(html, /\.kh-responsive-table th,\.kh-responsive-table h4,\.kh-responsive-table strong/);
  assert.match(html, /font-weight:600/);
  assert.match(html, /font-weight:400/);
});

test("malformed-table fallback inherits article typography", () => {
  const malformed = `| Vehicle | Best for |\n| Transit | Builders |`;
  const html = buildWixRichContent(malformed).nodes.find((node) => node.type === "HTML").htmlData.html;
  assert.match(html, /kh-table-fallback/);
  assert.match(html, /font-family:inherit/);
  assert.match(html, /font-size:inherit/);
  assert.match(html, /line-height:inherit/);
});

test("preview and Wix rich content use the same responsive table renderer and typography", () => {
  const preview = renderKnowledgePreviewHtml(standard);
  const rich = buildWixRichContent(standard);
  const wixHtml = rich.nodes.find((node) => node.type === "HTML").htmlData.html;
  assert.match(preview.html, /kh-responsive-table/);
  assert.match(wixHtml, /kh-responsive-table/);
  assert.match(preview.html, /kh-table-card__field/);
  assert.match(preview.html, /font-family:inherit/);
  assert.match(wixHtml, /font-family:inherit/);
  assert.match(preview.html, /font-size:inherit/);
  assert.match(wixHtml, /font-size:inherit/);
});

test("stored Markdown is never mutated", () => {
  const original = standard;
  buildWixRichContent(original);
  buildWixPlainTextContent(original);
  renderKnowledgePreviewHtml(original);
  assert.equal(original, standard);
});

test("Wix export remains draft-only", async () => {
  const api = await read("../api/marketing-wix-publishing.js");
  const lib = await read("../lib/wixPublishing.js");
  assert.match(api, /content_status:"Draft"/);
  assert.match(api, /published:false/);
  assert.match(lib, /syncStatus: "Draft"/);
  assert.doesNotMatch(`${api}\n${lib}`, /publishLive|livePublish|status:\s*["']published["']/);
});
