import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { KNOWLEDGE_CATEGORIES, KNOWLEDGE_TOPIC_STATUSES } from "../lib/knowledgeHub.js";
import {
  generateKnowledgeArticle,
  loadKnowledgeHub,
  saveKnowledgeTopic,
} from "../services/knowledgeHub.js";
import { buildMarketingAccessHeaders, parseMarketingJsonResponse } from "../services/marketingAccess.js";
import { findTopicDuplicateGroups, topicMatchesFilters } from "../lib/knowledgeTopicWorkspace.js";

const ROUTE = "/api/knowledge-topic-workspace";
const PAGE_SIZE = 25;
const INSTALL_KEY = "__knowledgeHubTopicWorkspaceInstaller";
const EMPTY_GENERATION = {
  templateKey: "faq",
  targetAudience: "UK van buyers",
  tone: "Helpful, clear and factual",
  instructions: "",
  approximateLength: 1000,
};

async function request(action, payload = {}) {
  const response = await fetch(ROUTE, {
    method: "POST",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ action, ...payload }),
  });
  return parseMarketingJsonResponse(response, "Topic workspace request failed.");
}

export function Modal({ title, children, confirmLabel, busy, onConfirm, onClose, danger = false }) {
  return (
    <div className="modal-backdrop" data-topic-workspace-modal="true" role="presentation">
      <div className="panel" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: 640, margin: "8vh auto" }}>
        <div className="panel__header"><div><h3>{title}</h3></div></div>
        {children}
        <div className="card-actions">
          <button className={`button ${danger ? "button--danger" : "button--primary"}`} disabled={busy} onClick={onConfirm}>{busy ? "Working…" : confirmLabel}</button>
          <button className="button button--ghost" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function FinderWorkspace() {
  const [categories, setCategories] = useState(["Rent2Buy"]);
  const [quantity, setQuantity] = useState(5);
  const [brief, setBrief] = useState("");
  const [ideas, setIdeas] = useState([]);
  const [selected, setSelected] = useState([]);
  const [resultMessage, setResultMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function find() {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await request("find", { categories, quantity: Number(quantity), brief });
      const next = result.finder?.ideas || [];
      setIdeas(next); setSelected([]);
      setResultMessage(result.finder?.result_message || `${next.length} strong distinct topic(s) found.`);
    } catch (caught) { setError(caught.message || "Topics could not be generated."); }
    finally { setBusy(false); }
  }

  async function saveIndexes(indexes) {
    const chosen = ideas.filter((_, index) => indexes.includes(index));
    if (!chosen.length || busy) return;
    setBusy(true); setError("");
    try {
      const result = await request("saveSelected", { ideas: chosen });
      const saved = result.finder?.topics || [];
      const savedTitles = new Set(saved.map((item) => item.title));
      setIdeas((current) => current.filter((idea) => !savedTitles.has(idea.title)));
      setSelected([]);
      setMessage(`${saved.length} selected topic${saved.length === 1 ? "" : "s"} saved to Topic Planner${result.finder?.skipped?.length ? `; ${result.finder.skipped.length} duplicate(s) skipped` : ""}.`);
      window.dispatchEvent(new CustomEvent("knowledge-topic-workspace-updated"));
    } catch (caught) { setError(caught.message || "Selected suggestions could not be saved."); }
    finally { setBusy(false); }
  }

  function reject(indexes) {
    setIdeas((current) => current.filter((_, index) => !indexes.includes(index)));
    setSelected([]);
    setMessage(`${indexes.length} suggestion${indexes.length === 1 ? "" : "s"} rejected. Nothing was saved.`);
  }

  return <section className="page-stack" data-topic-workspace="finder">
    <div className="panel knowledge-form-panel">
      <div className="panel__header"><div><h3>AI Topic Finder</h3><p>The Additional Brief is a strict subject boundary. Suggestions remain temporary until selected and saved.</p></div></div>
      <div className="field-grid">
        <label className="field"><span className="field__label">Maximum number of ideas</span><input className="field__input" type="number" min="1" max="30" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
        <label className="field" style={{ gridColumn: "1 / -1" }}><span className="field__label">Additional Brief — strict boundary</span><textarea className="field__input" rows={6} value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="Example: Suggest customer questions specifically about Rent2Buy mileage limits. Do not suggest affordability, ownership, servicing or traditional finance." /></label>
      </div>
      <div className="knowledge-category-picker">{KNOWLEDGE_CATEGORIES.map((category) => <label key={category}><input type="checkbox" checked={categories.includes(category)} onChange={() => setCategories((current) => current.includes(category) ? current.filter((item) => item !== category) : [...current, category])} />{category}</label>)}</div>
      <div className="card-actions"><button type="button" className="button button--primary" disabled={busy || !brief.trim() || !categories.length} onClick={find}>{busy ? "Finding…" : "Find Topic Ideas"}</button></div>
    </div>
    {error ? <div className="notice notice--error">{error}</div> : null}
    {message ? <div className="notice knowledge-notice-success">{message}</div> : null}
    {ideas.length ? <div className="panel">
      <div className="panel__header"><div><h3>Review suggestions</h3><p>{resultMessage}</p></div></div>
      <div className="card-actions" style={{ marginBottom: 14 }}>
        <button type="button" className="button button--ghost" onClick={() => setSelected(ideas.map((_, index) => index))}>Select All</button>
        <button type="button" className="button button--ghost" onClick={() => setSelected([])}>Deselect All</button>
        <button type="button" className="button button--primary" disabled={busy || !selected.length} onClick={() => saveIndexes(selected)}>Save Selected to Topic Planner</button>
        <button type="button" className="button button--danger" disabled={busy || !selected.length} onClick={() => reject(selected)}>Reject Selected</button>
      </div>
      <div className="knowledge-finder-grid">{ideas.map((idea, index) => <article className="knowledge-finder-card" key={`${idea.title}-${index}`}>
        <label className="knowledge-select-row"><input type="checkbox" checked={selected.includes(index)} onChange={() => setSelected((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index])} />Select suggestion</label>
        <h4>{idea.title}</h4><p><strong>{idea.category}</strong></p>
        <p><strong>Customer question/search intent:</strong> {idea.intent}</p>
        <p><strong>Why it matches:</strong> {idea.rationale}</p>
        {idea.overlap_warning ? <div className="notice">{idea.overlap_warning}</div> : null}
        <div className="card-actions"><button type="button" className="button button--primary" disabled={busy} onClick={() => saveIndexes([index])}>Save to Topic Planner</button><button type="button" className="button button--danger" disabled={busy} onClick={() => reject([index])}>Reject</button></div>
      </article>)}</div>
    </div> : null}
  </section>;
}

function PlannerWorkspace() {
  const [topics, setTopics] = useState([]);
  const [articles, setArticles] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [settings, setSettings] = useState({});
  const [duplicates, setDuplicates] = useState([]);
  const [filters, setFilters] = useState({ search: "", category: "all", status: "all", priority: "all" });
  const [selected, setSelected] = useState([]);
  const [selectionMode, setSelectionMode] = useState("ids");
  const [page, setPage] = useState(1);
  const [reviewDuplicates, setReviewDuplicates] = useState(false);
  const [modal, setModal] = useState(null);
  const [editingTopic, setEditingTopic] = useState(null);
  const [generationTopic, setGenerationTopic] = useState(null);
  const [generation, setGeneration] = useState(EMPTY_GENERATION);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const result = await loadKnowledgeHub();
      const nextTopics = result.topics || [];
      setTopics(nextTopics);
      setArticles(result.articles || []);
      setTemplates(result.templates || []);
      setSettings(result.settings || {});
      setDuplicates(findTopicDuplicateGroups(nextTopics));
      setError("");
    } catch (caught) { setError(caught.message || "Topic Planner could not be loaded."); }
  }

  useEffect(() => {
    load();
    const listener = () => load();
    window.addEventListener("knowledge-topic-workspace-updated", listener);
    return () => window.removeEventListener("knowledge-topic-workspace-updated", listener);
  }, []);

  const filtered = useMemo(() => topics.filter((topic) => topicMatchesFilters(topic, filters)), [topics, filters]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); setSelected([]); setSelectionMode("ids"); }, [filters.search, filters.category, filters.status, filters.priority]);
  const selectedCount = selectionMode === "filtered" ? filtered.length : selected.length;
  const allVisibleSelected = visible.length > 0 && visible.every((topic) => selected.includes(topic.id));

  function requireTopic(topic, action) {
    if (topic?.id) return true;
    setError(`${action} could not start because this Topic Planner record has no valid ID.`);
    return false;
  }

  function handleGenerateTopic(topic) {
    if (!requireTopic(topic, "Article generation") || busy) return;
    const existingArticle = articles.find((item) => item.topic_id === topic.id && item.status !== "archived");
    if (existingArticle) {
      setError(`This topic already has an active article: “${existingArticle.title}”.`);
      return;
    }
    const templateKey = templates.some((item) => item.key === "faq") ? "faq" : templates[0]?.key || "faq";
    setGenerationTopic(topic);
    setGeneration({
      ...EMPTY_GENERATION,
      templateKey,
      targetAudience: settings.default_audience || EMPTY_GENERATION.targetAudience,
      tone: settings.default_tone || EMPTY_GENERATION.tone,
    });
    setError("");
    setMessage("");
  }

  async function confirmGenerateTopic() {
    if (!requireTopic(generationTopic, "Article generation") || busy) return;
    setBusy(true); setError("");
    try {
      const result = await generateKnowledgeArticle(generationTopic, generation);
      const generated = result.article;
      setArticles((current) => [generated, ...current]);
      setTopics((current) => current.map((item) => item.id === generationTopic.id ? { ...item, status: "generated" } : item));
      setGenerationTopic(null);
      setMessage(`Draft generated for “${generated.title}”. Open Approval Queue to review it.`);
      window.dispatchEvent(new CustomEvent("knowledge-topic-workspace-updated"));
    } catch (caught) { setError(caught.message || "Article generation failed. Your settings have been retained."); }
    finally { setBusy(false); }
  }

  function handleEditTopic(topic) {
    if (!requireTopic(topic, "Topic editing") || busy) return;
    setEditingTopic({ ...topic });
    setError("");
    setMessage("");
  }

  async function confirmEditTopic() {
    if (!requireTopic(editingTopic, "Topic editing") || busy) return;
    if (!String(editingTopic.title || "").trim()) { setError("Topic title is required."); return; }
    setBusy(true); setError("");
    try {
      const result = await saveKnowledgeTopic(editingTopic);
      setTopics((current) => current.map((item) => item.id === result.topic.id ? result.topic : item));
      setEditingTopic(null);
      setMessage(`“${result.topic.title}” updated successfully.`);
      window.dispatchEvent(new CustomEvent("knowledge-topic-workspace-updated"));
    } catch (caught) { setError(caught.message || "Topic could not be updated."); }
    finally { setBusy(false); }
  }

  function handleDeleteTopic(topic) {
    if (!requireTopic(topic, "Topic deletion") || busy) return;
    setSelectionMode("ids");
    setSelected([topic.id]);
    setModal({ type: "delete", topicTitle: topic.title });
    setError("");
  }

  async function applyBulk(operation, value = "") {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await request("bulk", { operation, value, topic_ids: selected, selection_mode: selectionMode, filters });
      const count = result.bulk?.affected_ids?.length || 0;
      const affected = new Set(result.bulk?.affected_ids || []);
      if (operation === "delete") setTopics((current) => current.filter((item) => !affected.has(item.id)));
      else setTopics((current) => current.map((item) => affected.has(item.id) ? { ...item, [operation]: value } : item));
      setSelected([]); setSelectionMode("ids"); setModal(null);
      await load();
      setMessage(operation === "delete" ? `${count} topics deleted successfully.${result.bulk?.protected_count ? ` ${result.bulk.protected_count} topic(s) with article history were left untouched.` : ""}` : `${count} topics updated successfully.`);
    } catch (caught) { setError(caught.message || "Bulk action failed. Your selection has been retained."); }
    finally { setBusy(false); }
  }

  return <section className="panel" data-topic-workspace="planner">
    <div className="panel__header"><div><h3>Topic Planner</h3><p>Bulk actions affect Topic Planner suggestions only. Articles, Wix CMS, editorial history and Business Brain records are not deleted.</p></div><button type="button" className="button button--ghost" onClick={() => setReviewDuplicates((current) => !current)}>Review Duplicates</button></div>
    {error ? <div className="notice notice--error">{error}</div> : null}{message ? <div className="notice knowledge-notice-success">{message}</div> : null}
    <div className="knowledge-filters">
      <input className="field__input" placeholder="Search title, keyword or intent…" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} />
      <select className="field__input" value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })}><option value="all">All categories</option>{KNOWLEDGE_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select>
      <select className="field__input" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="all">All statuses</option>{KNOWLEDGE_TOPIC_STATUSES.map((item) => <option key={item}>{item}</option>)}</select>
      <select className="field__input" value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })}><option value="all">All priorities</option>{[5,4,3,2,1].map((item) => <option key={item} value={item}>{item} stars</option>)}</select>
    </div>
    <div className="card-actions" style={{ margin: "14px 0" }}>
      <button type="button" className="button button--ghost" disabled={!visible.length} onClick={() => { setSelectionMode("ids"); setSelected(visible.map((topic) => topic.id)); }}>Select all visible rows</button>
      <button type="button" className="button button--ghost" disabled={!filtered.length} onClick={() => { setSelectionMode("filtered"); setSelected([]); }}>Select all filtered results</button>
      <button type="button" className="button button--danger" disabled={!selectedCount || busy} onClick={() => setModal({ type: "delete" })}>Delete Selected</button>
      <button type="button" className="button button--ghost" disabled={!selectedCount || busy} onClick={() => setModal({ type: "status", value: "idea" })}>Change Status</button>
      <button type="button" className="button button--ghost" disabled={!selectedCount || busy} onClick={() => setModal({ type: "category", value: KNOWLEDGE_CATEGORIES[0] })}>Change Category</button>
      <button type="button" className="button button--ghost" disabled={!selectedCount || busy} onClick={() => { setSelected([]); setSelectionMode("ids"); }}>Clear Selection</button>
    </div>
    {selectedCount ? <div className="notice"><strong>{selectedCount}</strong> {selectionMode === "filtered" ? "filtered topics" : "topics"} selected</div> : null}
    {reviewDuplicates ? <div className="panel panel--nested"><h4>Likely duplicate groups</h4>{duplicates.length ? duplicates.map((group, index) => <div className="notice" key={index}><strong>Group {index + 1}</strong>{group.map((topic) => <label className="knowledge-select-row" key={topic.id}><input type="checkbox" checked={selected.includes(topic.id)} onChange={() => { setSelectionMode("ids"); setSelected((current) => current.includes(topic.id) ? current.filter((id) => id !== topic.id) : [...current, topic.id]); }} />{topic.title} — {topic.intent || topic.canonical_intent || "No intent recorded"}</label>)}</div>) : <div className="notice">No likely duplicate groups found.</div>}<button type="button" className="button button--danger" disabled={!selected.length || busy} onClick={() => setModal({ type: "deleteDuplicates" })}>Delete Selected Duplicates</button></div> : null}
    <div className="knowledge-table-wrap"><table className="knowledge-table"><thead><tr><th><input aria-label="Select all visible rows" type="checkbox" checked={allVisibleSelected} onChange={(event) => { setSelectionMode("ids"); const ids = visible.map((topic) => topic.id); setSelected((current) => event.target.checked ? [...new Set([...current, ...ids])] : current.filter((id) => !ids.includes(id))); }} /></th><th>Topic</th><th>Priority</th><th>Category</th><th>Customer question/search intent</th><th>Status</th><th>Actions</th></tr></thead><tbody>{visible.map((topic) => <tr key={topic.id}><td><input type="checkbox" checked={selectionMode === "filtered" || selected.includes(topic.id)} onChange={(event) => { setSelectionMode("ids"); setSelected((current) => event.target.checked ? [...new Set([...current, topic.id])] : current.filter((id) => id !== topic.id)); }} /></td><td><strong>{topic.title}</strong><small>{topic.source === "ai_topic_finder" ? "AI Topic Finder" : "Manual"}</small></td><td>{topic.priority || 3}</td><td>{topic.category}</td><td>{topic.intent || topic.canonical_intent || "—"}</td><td>{topic.status}</td><td><div className="card-actions"><button type="button" className="button button--primary" disabled={busy} onClick={() => handleGenerateTopic(topic)}>Generate</button><button type="button" className="button button--ghost" disabled={busy} onClick={() => handleEditTopic(topic)}>Edit</button><button type="button" className="button button--danger" disabled={busy} onClick={() => handleDeleteTopic(topic)}>Delete</button></div></td></tr>)}</tbody></table></div>
    <div className="card-actions"><button type="button" className="button button--ghost" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button><span>Page {page} of {totalPages} · {filtered.length} filtered topics</span><button type="button" className="button button--ghost" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Next</button></div>

    {generationTopic ? <Modal title={`Generate article for “${generationTopic.title}”`} confirmLabel="Generate Draft" busy={busy} onConfirm={confirmGenerateTopic} onClose={() => setGenerationTopic(null)}>
      <div className="field-grid">
        <label className="field"><span className="field__label">Article type / template</span><select className="field__input" value={generation.templateKey} onChange={(event) => setGeneration({ ...generation, templateKey: event.target.value })}>{templates.map((template) => <option key={template.key} value={template.key}>{template.name}</option>)}</select></label>
        <label className="field"><span className="field__label">Approximate length</span><select className="field__input" value={generation.approximateLength} onChange={(event) => setGeneration({ ...generation, approximateLength: Number(event.target.value) })}>{[600,1000,1500,2000].map((length) => <option key={length} value={length}>About {length.toLocaleString()} words</option>)}</select></label>
        <label className="field"><span className="field__label">Target audience</span><input className="field__input" value={generation.targetAudience} onChange={(event) => setGeneration({ ...generation, targetAudience: event.target.value })} /></label>
        <label className="field"><span className="field__label">Tone</span><input className="field__input" value={generation.tone} onChange={(event) => setGeneration({ ...generation, tone: event.target.value })} /></label>
        <label className="field" style={{ gridColumn: "1 / -1" }}><span className="field__label">Optional instructions</span><textarea className="field__input" rows={4} value={generation.instructions} onChange={(event) => setGeneration({ ...generation, instructions: event.target.value })} /></label>
      </div>
      <div className="notice">This uses the established Knowledge Hub article-generation service. The result is saved as a draft for review.</div>
    </Modal> : null}

    {editingTopic ? <Modal title={`Edit “${editingTopic.title}”`} confirmLabel="Save Topic" busy={busy} onConfirm={confirmEditTopic} onClose={() => setEditingTopic(null)}>
      <div className="field-grid">
        <label className="field"><span className="field__label">Title</span><input className="field__input" value={editingTopic.title || ""} onChange={(event) => setEditingTopic({ ...editingTopic, title: event.target.value })} /></label>
        <label className="field"><span className="field__label">Category</span><select className="field__input" value={editingTopic.category || KNOWLEDGE_CATEGORIES[0]} onChange={(event) => setEditingTopic({ ...editingTopic, category: event.target.value })}>{KNOWLEDGE_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="field"><span className="field__label">Primary keyword</span><input className="field__input" value={editingTopic.primary_keyword || ""} onChange={(event) => setEditingTopic({ ...editingTopic, primary_keyword: event.target.value })} /></label>
        <label className="field"><span className="field__label">Customer/search intent</span><input className="field__input" value={editingTopic.intent || editingTopic.canonical_intent || ""} onChange={(event) => setEditingTopic({ ...editingTopic, intent: event.target.value, canonical_intent: event.target.value })} /></label>
        <label className="field"><span className="field__label">Status</span><select className="field__input" value={editingTopic.status || "idea"} onChange={(event) => setEditingTopic({ ...editingTopic, status: event.target.value })}>{KNOWLEDGE_TOPIC_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="field"><span className="field__label">Priority</span><input className="field__input" type="number" min="1" max="5" value={editingTopic.priority || 3} onChange={(event) => setEditingTopic({ ...editingTopic, priority: Number(event.target.value) })} /></label>
        <label className="field" style={{ gridColumn: "1 / -1" }}><span className="field__label">Notes</span><textarea className="field__input" rows={4} value={editingTopic.notes || ""} onChange={(event) => setEditingTopic({ ...editingTopic, notes: event.target.value })} /></label>
      </div>
    </Modal> : null}

    {(modal?.type === "delete" || modal?.type === "deleteDuplicates") ? <Modal title={modal.topicTitle ? `Delete “${modal.topicTitle}”?` : `Delete ${selectedCount} selected topics?`} confirmLabel="Delete Selected" busy={busy} danger onConfirm={() => applyBulk("delete")} onClose={() => setModal(null)}><p>This cannot be undone. This deletes Topic Planner suggestions only. It does not delete generated or approved articles, Wix CMS articles, editorial history or Business Brain records.</p><p>Topics with article history will be blocked and left untouched.</p></Modal> : null}
    {modal?.type === "status" ? <Modal title={`Change status for ${selectedCount} topics?`} confirmLabel="Change Status" busy={busy} onConfirm={() => applyBulk("status", modal.value)} onClose={() => setModal(null)}><label className="field"><span className="field__label">New status</span><select className="field__input" value={modal.value} onChange={(event) => setModal({ ...modal, value: event.target.value })}>{KNOWLEDGE_TOPIC_STATUSES.map((item) => <option key={item}>{item}</option>)}</select></label></Modal> : null}
    {modal?.type === "category" ? <Modal title={`Change category for ${selectedCount} topics?`} confirmLabel="Change Category" busy={busy} onConfirm={() => applyBulk("category", modal.value)} onClose={() => setModal(null)}><label className="field"><span className="field__label">New category</span><select className="field__input" value={modal.value} onChange={(event) => setModal({ ...modal, value: event.target.value })}>{KNOWLEDGE_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label></Modal> : null}
  </section>;
}

let root = null;
let host = null;
let hiddenPanel = null;
let mountedMode = null;
let observer = null;
let mountQueued = false;

function restoreLegacyPanel() {
  if (hiddenPanel?.isConnected) hiddenPanel.style.display = "";
  hiddenPanel = null;
}

function removeWorkspace() {
  if (root) root.unmount();
  root = null;
  mountedMode = null;
  if (host?.isConnected) host.remove();
  host = null;
  restoreLegacyPanel();
}

function findLegacyTarget() {
  return [...document.querySelectorAll(".panel h3")]
    .filter((heading) => !heading.closest("[data-knowledge-topic-workspace-host]"))
    .map((heading) => ({ heading, panel: heading.closest(".panel") }))
    .find(({ heading, panel }) => panel && !panel.dataset.topicWorkspace && ["Topic Planner", "AI Topic Finder"].includes(heading.textContent?.trim()));
}

function mount() {
  mountQueued = false;
  const target = findLegacyTarget();
  if (!target) { removeWorkspace(); return; }

  const { heading, panel } = target;
  const mode = heading.textContent.trim() === "Topic Planner" ? "planner" : "finder";
  if (hiddenPanel !== panel) {
    restoreLegacyPanel();
    hiddenPanel = panel;
    hiddenPanel.style.display = "none";
  }

  if (!host || !host.isConnected) {
    host = document.createElement("div");
    host.dataset.knowledgeTopicWorkspaceHost = "true";
    host.style.position = "static";
    host.style.inset = "auto";
    host.style.zIndex = "auto";
    host.style.width = "auto";
    host.style.minHeight = "0";
    host.style.pointerEvents = "auto";
    panel.insertAdjacentElement("afterend", host);
    root = createRoot(host);
  } else if (host.previousElementSibling !== panel) {
    panel.insertAdjacentElement("afterend", host);
  }

  if (mountedMode !== mode) {
    mountedMode = mode;
    root.render(mode === "finder" ? <FinderWorkspace /> : <PlannerWorkspace />);
  }
}

function queueMount() {
  if (mountQueued) return;
  mountQueued = true;
  queueMicrotask(mount);
}

export function installKnowledgeHubTopicWorkspace() {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  if (window[INSTALL_KEY]) return;
  window[INSTALL_KEY] = true;
  queueMount();
  observer = new MutationObserver(queueMount);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("beforeunload", () => {
    observer?.disconnect();
    observer = null;
    removeWorkspace();
    window[INSTALL_KEY] = false;
  }, { once: true });
}
