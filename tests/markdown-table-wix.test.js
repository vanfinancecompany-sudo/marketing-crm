import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  WIX_ARTICLE_BODY_TYPOGRAPHY,
  parseMarkdownTable,
  renderKnowledgePreviewHtml,
  splitMarkdownTableSegments,
  wixArticleBodyTypographyCss,
} from "../lib/markdownTables.js";
import {
  buildWixPlainTextContent,
  buildWixRichContent,
  collectMarkdownTableWarnings,
  wixArticleBodyTextStyle,
} from "../lib/wixPublishing.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const standard = `## Comparison

| Feature | Option A | Option B |
| --- | --- | --- |
| Deposit | £500 | £750 |
| Term | 36 months | 48 months |

Final paragraph.`;

function tableHtml(markdown = standard) {
  return buildWixRichContent(markdown).nodes.find((node) => node.type === "HTML").htmlData.html;
}

test("standard Markdown table becomes responsive Wix rich content", () => {
  const html = tableHtml();
  assert.match(html, /<table>/);
  assert.match(html, /kh-responsive-table__mobile/);
  assert.match(html, /Deposit/);
  assert.doesNotMatch(html, /\|\s*---\s*\|/);
});

test("two-column comparison uses first cell as mobile row heading", () => {
  const html = tableHtml(`| Vehicle | Best for |\n| --- | --- |\n| Small van | City work |`);
  assert.match(html, /<h4>Small van<\/h4>/);
  assert.match(html, /<strong>Best for<\/strong>/);
});

test("multi-column and empty cells are preserved", () => {
  const markdown = `| Van | Payload | Notes |\n| --- | --- | --- |\n| Transit | 1,200kg | |`;
  const parsed = parseMarkdownTable(markdown.split("\n"), 0);
  assert.equal(parsed.headers.length, 3);
  assert.equal(parsed.rows[0][2], "");
  assert.match(tableHtml(markdown), /Transit/);
});

test("multiple tables are converted independently", () => {
  const markdown = `${standard}\n\n## Second\n\n| Item | Value |\n| --- | --- |\n| One | Two |`;
  const rich = buildWixRichContent(markdown);
  assert.equal(rich.nodes.filter((node) => node.type === "HTML").length, 2);
});

test("bold text and links inside cells remain meaningful", () => {
  const html = tableHtml(`| Item | Details |\n| --- | --- |\n| **Transit** | [View vans](/vans) |`);
  assert.match(html, /<strong>Transit<\/strong>/);
  assert.match(html, /href="\/vans"/);
});

test("malformed table falls back to readable blocks and records warning", () => {
  const malformed = `Before\n\n| Vehicle | Best for |\n| Transit | Builders |\n\nAfter`;
  const { segments, warnings } = splitMarkdownTableSegments(malformed);
  assert.equal(warnings.length, 1);
  assert.ok(segments.some((segment) => segment.type === "table_fallback"));
  const html = tableHtml(malformed);
  assert.match(html, /kh-table-fallback/);
  assert.doesNotMatch(html, /\| Vehicle \|/);
  assert.equal(collectMarkdownTableWarnings(malformed).length, 1);
});

test("plain-text Wix fields receive stacked table content without pipe syntax", () => {
  const text = buildWixPlainTextContent(standard);
  assert.match(text, /Deposit\nOption A: £500\nOption B: £750/);
  assert.doesNotMatch(text, /\|\s*---\s*\|/);
});

test("standard Wix paragraph and table cells use the same explicit typography", () => {
  const rich = buildWixRichContent(`Normal paragraph.\n\n${standard}`);
  const paragraph = rich.nodes.find((node) => node.type === "PARAGRAPH" && node.nodes.some((child) => child.textData?.text === "Normal paragraph."));
  const html = rich.nodes.find((node) => node.type === "HTML").htmlData.html;
  const style = wixArticleBodyTextStyle();
  assert.deepEqual(paragraph.paragraphData.textStyle, style);
  assert.equal(style.fontFamily, WIX_ARTICLE_BODY_TYPOGRAPHY.fontFamily);
  assert.equal(style.fontSize, WIX_ARTICLE_BODY_TYPOGRAPHY.fontSize);
  assert.equal(style.lineHeight, WIX_ARTICLE_BODY_TYPOGRAPHY.lineHeight);
  assert.equal(style.color, WIX_ARTICLE_BODY_TYPOGRAPHY.color);
  assert.match(html, new RegExp(`font-family:${WIX_ARTICLE_BODY_TYPOGRAPHY.fontFamily.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(html, new RegExp(`font-size:${WIX_ARTICLE_BODY_TYPOGRAPHY.fontSize}`));
  assert.match(html, new RegExp(`line-height:${WIX_ARTICLE_BODY_TYPOGRAPHY.lineHeight}`));
  assert.match(html, new RegExp(`color:${WIX_ARTICLE_BODY_TYPOGRAPHY.color}`));
  assert.doesNotMatch(html, /font-size:inherit/);
});

test("labels keep article body size and line height with weight 600", () => {
  const html = tableHtml();
  const css = wixArticleBodyTypographyCss();
  assert.match(html, new RegExp(css.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /\.kh-responsive-table thead th,\.kh-responsive-table tbody th\{font-weight:600\}/);
  assert.match(html, /\.kh-table-card__field strong\{font-weight:600\}/);
  assert.doesNotMatch(html, /font-size\s*:\s*(?:small|smaller|\d+(?:\.\d+)?px)(?!18px)/);
});

test("desktop table, mobile cards and malformed fallback share article typography", () => {
  const html = tableHtml();
  assert.match(html, /\.kh-responsive-table,\.kh-responsive-table table,\.kh-responsive-table th,\.kh-responsive-table td,\.kh-responsive-table__mobile,\.kh-table-card,\.kh-table-card h4,\.kh-table-card__field,\.kh-table-card__field strong,\.kh-table-card__field span,\.kh-table-fallback/);
  const malformed = tableHtml(`| Vehicle | Best for |\n| Transit | Builders |`);
  assert.match(malformed, new RegExp(`font-size:${WIX_ARTICLE_BODY_TYPOGRAPHY.fontSize}`));
  assert.match(malformed, new RegExp(`line-height:${WIX_ARTICLE_BODY_TYPOGRAPHY.lineHeight}`));
});

test("preview and Wix rich content use identical explicit table typography", () => {
  const preview = renderKnowledgePreviewHtml(standard);
  const wixHtml = tableHtml();
  for (const value of Object.values(WIX_ARTICLE_BODY_TYPOGRAPHY)) {
    assert.ok(preview.html.includes(value));
    assert.ok(wixHtml.includes(value));
  }
  assert.match(preview.html, /kh-responsive-table/);
  assert.match(wixHtml, /kh-responsive-table/);
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
