import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  duplicateTopicRisk,
  findTopicDuplicateGroups,
  normalizeTopicText,
  topicMatchesFilters,
} from "../lib/knowledgeTopicWorkspace.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("topic normalisation uses title and customer intent rather than title alone", () => {
  assert.equal(normalizeTopicText("  Rent2Buy: Mileage—Limits! "), "rent2buy mileage limits");
  assert.equal(
    duplicateTopicRisk(
      { title: "Rent2Buy mileage allowance", intent: "How many miles can I drive on Rent2Buy?" },
      { title: "Mileage limits on Rent2Buy vans", intent: "How many miles may a Rent2Buy customer drive?" },
    ).risk,
    "likely_duplicate",
  );
  assert.equal(
    duplicateTopicRisk(
      { title: "Rent2Buy mileage limits", intent: "What is the mileage limit?" },
      { title: "Van servicing guide", intent: "When should a van be serviced?" },
    ).risk,
    "clear",
  );
});

test("duplicate groups include similar intent and preserve unrelated records", () => {
  const groups = findTopicDuplicateGroups([
    { id: "1", title: "Rent2Buy mileage limits", intent: "What mileage is allowed?" },
    { id: "2", title: "Mileage allowance for Rent2Buy", intent: "What mileage is allowed?" },
    { id: "3", title: "Self-employed proof of income", intent: "Which income documents are needed?" },
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map((item) => item.id), ["1", "2"]);
});

test("filtered selection matches search, category, status and priority", () => {
  const topic = {
    title: "Rent2Buy mileage limits",
    intent: "What mileage is allowed?",
    category: "Rent2Buy",
    status: "idea",
    priority: 5,
  };
  assert.equal(topicMatchesFilters(topic, {
    search: "mileage",
    category: "Rent2Buy",
    status: "idea",
    priority: "5",
  }), true);
  assert.equal(topicMatchesFilters(topic, { category: "Van Finance" }), false);
});

test("strict finder prompt and safe bulk boundaries are present", async () => {
  const api = await read("../api/knowledge-topic-workspace.js");
  assert.match(api, /The Additional Brief below is a strict instruction, not loose inspiration/);
  assert.match(api, /Do not broaden into adjacent subjects/);
  assert.match(api, /Do not infer or add another category/);
  assert.match(api, /Return fewer rather than weak, repetitive or off-brief ideas/);
  assert.match(api, /knowledge_articles.*topic_id/s);
  assert.match(api, /Every selected topic has article history and was left untouched/);
  assert.match(api, /selection_mode === "filtered"/);
  assert.doesNotMatch(api, /from\("knowledge_articles"\)\.delete/);
  assert.doesNotMatch(api, /from\("knowledge_business/);
});

test("workspace API reuses the established authenticated handler without a protected preview self-fetch", async () => {
  const api = await read("../api/knowledge-topic-workspace.js");
  assert.match(api, /import marketingKnowledgeHubHandler from "\.\/marketing-knowledge-hub\.js"/);
  assert.match(api, /await marketingKnowledgeHubHandler\(/);
  assert.match(api, /headers: request\.headers/);
  assert.match(api, /body: \{ action, \.\.\.payload \}/);
  assert.match(api, /requestEstablishedKnowledgeHub\(request, "load"\)/);
  assert.match(api, /requestEstablishedKnowledgeHub\(request, "findTopics"/);
  assert.match(api, /requestEstablishedKnowledgeHub\(request, "saveTopicIdeas"/);
  assert.doesNotMatch(api, /fetch\(`/);
  assert.doesNotMatch(api, /x-forwarded-host/);
});

test("workspace API only returns 401 when its own access-key validation fails", async () => {
  const api = await read("../api/knowledge-topic-workspace.js");
  assert.match(api, /if \(!authorize\(request\)\)/);
  assert.match(api, /code: "ACCESS_DENIED"/);
  assert.doesNotMatch(api, /throw new ApiError\(\s*response\.status/);
});

test("workspace API returns safe structured errors and request diagnostics", async () => {
  const api = await read("../api/knowledge-topic-workspace.js");
  assert.match(api, /TOPIC_LOAD_FAILED/);
  assert.match(api, /TOPIC_FIND_FAILED/);
  assert.match(api, /TOPIC_SAVE_FAILED/);
  assert.match(api, /TOPIC_STATUS_UPDATE_FAILED/);
  assert.match(api, /TOPIC_CATEGORY_UPDATE_FAILED/);
  assert.match(api, /request_id/);
  assert.match(api, /X-Topic-Workspace-Request-Id/);
  assert.match(api, /request\.method === "OPTIONS"/);
  assert.doesNotMatch(api, /process\.env[^\n]+json/);
  assert.doesNotMatch(api, /stack:/);
});

test("review UI exposes required selection and bulk actions", async () => {
  const component = await read("../components/KnowledgeHubTopicWorkspace.jsx");
  for (const label of [
    "Select All",
    "Deselect All",
    "Save Selected to Topic Planner",
    "Reject Selected",
    "Select all visible rows",
    "Select all filtered results",
    "Delete Selected",
    "Change Status",
    "Change Category",
    "Clear Selection",
    "Review Duplicates",
    "Delete Selected Duplicates",
  ]) assert.match(component, new RegExp(label));
  assert.match(component, /This deletes Topic Planner suggestions only/);
  assert.match(component, /setSelected\(\[\]\)/);
});

test("individual row actions call real handlers and established services", async () => {
  const component = await read("../components/KnowledgeHubTopicWorkspace.jsx");
  assert.match(component, /function handleGenerateTopic\(topic\)/);
  assert.match(component, /function handleEditTopic\(topic\)/);
  assert.match(component, /function handleDeleteTopic\(topic\)/);
  assert.match(component, /generateKnowledgeArticle\(generationTopic, generation\)/);
  assert.match(component, /saveKnowledgeTopic\(editingTopic\)/);
  assert.match(component, /request\("bulk", \{ operation/);
  assert.match(component, /if \(topic\?\.id\) return true/);
  assert.match(component, /active .* article/);
  assert.match(component, /Topics with article history will be blocked and left untouched/);
  assert.doesNotMatch(component, /querySelectorAll\("tbody tr"\)/);
});

test("generated drafts are complete, analysed and exposed with article identity", async () => {
  const component = await read("../components/KnowledgeHubTopicWorkspace.jsx");
  assert.match(component, /analyseEditorialArticle\(generated\.id\)/);
  assert.match(component, /generated\?\.id/);
  assert.match(component, /generated\.content_markdown \|\| generated\.content_html/);
  assert.match(component, /generated\.status !== "draft"/);
  assert.match(component, /Article generated successfully/);
  assert.match(component, /data-topic-active-article="true"/);
  assert.match(component, /Article ID:/);
  assert.match(component, /Article type:/);
  assert.match(component, /Open Article/);
  assert.match(component, /setTopics\(\(current\) => current\.map/);
  assert.match(component, /setActiveArticle\(generated\)/);
});

test("existing active articles can be repaired, refreshed and opened in Approval Queue", async () => {
  const component = await read("../components/KnowledgeHubTopicWorkspace.jsx");
  assert.match(component, /setActiveArticle\(existingArticle\)/);
  assert.match(component, /activeArticle\.status === "draft" && !activeArticleAnalysed/);
  assert.match(component, /analyseEditorialArticle\(activeArticle\.id\)/);
  assert.match(component, /knowledgeHubPendingOpenArticle/);
  assert.match(component, /Approval Queue/);
  assert.match(component, /button\.knowledge-title-button/);
  assert.match(component, /window\.location\.reload\(\)/);
});

test("eligible idea topics open a visible inline generation workflow", async () => {
  const component = await read("../components/KnowledgeHubTopicWorkspace.jsx");
  assert.match(component, /data-topic-generation-panel="true"/);
  assert.match(component, /setGenerationTopic\(topic\)/);
  assert.match(component, /Generation settings opened for/);
  assert.match(component, /generationPanelRef\.current\?\.scrollIntoView/);
  assert.match(component, /!templates\.length/);
  assert.match(component, /no active Knowledge Hub template is available/);
  assert.match(component, /String\(item\.topic_id\) === String\(topic\.id\)/);
  assert.match(component, /Generate Draft/);
  assert.match(component, /Generating…/);
  assert.doesNotMatch(component, /generationTopic \? <Modal/);
});

test("Approval Queue includes every draft regardless of whether analysis exists", async () => {
  const intelligence = await read("../lib/editorialIntelligence.js");
  assert.match(intelligence, /\.filter\(\(article\) => article\.status === "draft"\)/);
  assert.match(intelligence, /const assessment = latest\.get\(article\.id\)/);
  assert.match(intelligence, /Number\(assessment\?\.overall_score\) \|\| 0/);
});

test("modal backdrop exists only behind active edit and bulk modal state", async () => {
  const component = await read("../components/KnowledgeHubTopicWorkspace.jsx");
  assert.equal((component.match(/className="modal-backdrop"/g) || []).length, 1);
  assert.match(component, /editingTopic \? <Modal/);
  assert.match(component, /\(modal\?\.type === "delete" \|\| modal\?\.type === "deleteDuplicates"\) \? <Modal/);
  assert.match(component, /modal\?\.type === "status" \? <Modal/);
  assert.match(component, /modal\?\.type === "category" \? <Modal/);
});

test("workspace mount ignores its own rendered headings and installs once", async () => {
  const component = await read("../components/KnowledgeHubTopicWorkspace.jsx");
  assert.match(component, /!heading\.closest\("\[data-knowledge-topic-workspace-host\]"\)/);
  assert.match(component, /if \(window\[INSTALL_KEY\]\) return/);
  assert.match(component, /root\.unmount\(\)/);
  assert.match(component, /host\.remove\(\)/);
  assert.match(component, /host\.style\.position = "static"/);
  assert.match(component, /host\.style\.pointerEvents = "auto"/);
  assert.doesNotMatch(component, /appendChild\(host\)/);
});
