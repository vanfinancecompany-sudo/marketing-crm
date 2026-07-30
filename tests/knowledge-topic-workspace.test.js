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
  const topic = { title: "Rent2Buy mileage limits", intent: "What mileage is allowed?", category: "Rent2Buy", status: "idea", priority: 5 };
  assert.equal(topicMatchesFilters(topic, { search: "mileage", category: "Rent2Buy", status: "idea", priority: "5" }), true);
  assert.equal(topicMatchesFilters(topic, { category: "Van Finance" }), false);
});

test("strict finder prompt and safe bulk boundaries are present", async () => {
  const api = await read("../api/knowledge-topic-workspace.js");
  assert.match(api, /Additional Brief defines the strict subject boundary/);
  assert.match(api, /Do not infer extra categories/);
  assert.match(api, /return fewer ideas/i);
  assert.match(api, /knowledge_articles.*topic_id/s);
  assert.match(api, /Every selected topic has article history and was left untouched/);
  assert.match(api, /selection_mode === "filtered"/);
  assert.doesNotMatch(api, /from\("knowledge_articles"\)\.delete/);
  assert.doesNotMatch(api, /from\("knowledge_business/);
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

test("modal backdrop exists only behind active modal state", async () => {
  const component = await read("../components/KnowledgeHubTopicWorkspace.jsx");
  assert.equal((component.match(/className="modal-backdrop"/g) || []).length, 1);
  assert.match(component, /\(modal\?\.type === "delete" \|\| modal\?\.type === "deleteDuplicates"\) \? <Modal/);
  assert.match(component, /modal\?\.type === "status" \? <Modal/);
  assert.match(component, /modal\?\.type === "category" \? <Modal/);
  assert.doesNotMatch(component, /<Modal[^?]*:\s*<Modal/s);
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
