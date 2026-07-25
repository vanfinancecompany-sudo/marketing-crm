import { useEffect, useState } from "react";
import { WEBSITE_INDEX_CATEGORIES } from "../lib/internalLinking.js";

const EMPTY_ENTRY = {
  title: "",
  url: "",
  category: "Products",
  keywords: [],
  vehicle_types: [],
  customer_intent: [],
  status: "Active",
  priority: 3,
  description: "",
  knowledge_article_id: "",
};

const titleCase = (value) =>
  String(value || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const listText = (value) => (Array.isArray(value) ? value.join(", ") : value || "");
const parseList = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export function WebsiteIndexPanel({
  entries,
  approvedArticles,
  onSave,
  busy,
}) {
  const [form, setForm] = useState(EMPTY_ENTRY);
  const [lists, setLists] = useState({
    keywords: "",
    vehicle_types: "",
    customer_intent: "",
  });

  function edit(entry = EMPTY_ENTRY) {
    setForm({ ...EMPTY_ENTRY, ...entry });
    setLists({
      keywords: listText(entry.keywords),
      vehicle_types: listText(entry.vehicle_types),
      customer_intent: listText(entry.customer_intent),
    });
  }

  async function save() {
    const saved = await onSave({
      ...form,
      keywords: parseList(lists.keywords),
      vehicle_types: parseList(lists.vehicle_types),
      customer_intent: parseList(lists.customer_intent),
    });
    if (saved) edit();
  }

  return (
    <>
      <section className="panel">
        <div className="panel__header">
          <div>
            <div className="eyebrow">Approved destinations</div>
            <h3>Website Index</h3>
            <p>
              Internal-link suggestions may use only active destinations in this index.
              The sync fields are ready for a future Wix CMS integration, but this feature
              does not call Wix.
            </p>
          </div>
          {form.id ? (
            <button className="button button--ghost" type="button" onClick={() => edit()}>
              New destination
            </button>
          ) : null}
        </div>
        <div className="field-grid">
          <label className="field">
            <span className="field__label">Title</span>
            <input className="field__input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">URL</span>
            <input className="field__input" placeholder="/van-finance" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">Category</span>
            <select className="field__input" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
              {WEBSITE_INDEX_CATEGORIES.map((category) => <option key={category}>{category}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Status</span>
            <select className="field__input" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              <option>Active</option>
              <option>Hidden</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">Priority</span>
            <select className="field__input" value={form.priority} onChange={(event) => setForm({ ...form, priority: Number(event.target.value) })}>
              {[5, 4, 3, 2, 1].map((priority) => <option key={priority} value={priority}>{priority} star{priority === 1 ? "" : "s"}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Knowledge Hub article</span>
            <select className="field__input" value={form.knowledge_article_id || ""} onChange={(event) => setForm({ ...form, knowledge_article_id: event.target.value })}>
              <option value="">Website page</option>
              {approvedArticles.map((article) => <option key={article.id} value={article.id}>{article.title}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Keywords</span>
            <input className="field__input" placeholder="Comma separated" value={lists.keywords} onChange={(event) => setLists({ ...lists, keywords: event.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">Vehicle types</span>
            <input className="field__input" placeholder="Small vans, Pickups" value={lists.vehicle_types} onChange={(event) => setLists({ ...lists, vehicle_types: event.target.value })} />
          </label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span className="field__label">Customer intent</span>
            <input className="field__input" placeholder="Applying, Documents, Van finance" value={lists.customer_intent} onChange={(event) => setLists({ ...lists, customer_intent: event.target.value })} />
          </label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span className="field__label">Description</span>
            <textarea className="field__input" rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </label>
        </div>
        <div className="card-actions">
          <button className="button button--primary" type="button" disabled={busy || !form.title.trim() || !form.url.trim()} onClick={save}>
            {form.id ? "Save Destination" : "Add Destination"}
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <div><h3>Indexed destinations</h3><p>{entries.length} approved destination record{entries.length === 1 ? "" : "s"}.</p></div>
        </div>
        <div className="knowledge-table-wrap">
          <table className="knowledge-table">
            <thead><tr><th>Destination</th><th>Category</th><th>Intent & vehicle types</th><th>Priority</th><th>Status</th><th /></tr></thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td><strong>{entry.title}</strong><br /><small>{entry.url}</small></td>
                  <td>{entry.category}</td>
                  <td>{[...(entry.customer_intent || []), ...(entry.vehicle_types || [])].join(", ") || "—"}</td>
                  <td>{"★".repeat(entry.priority || 0)}</td>
                  <td>{entry.status || (entry.active ? "Active" : "Hidden")}</td>
                  <td><button className="button button--ghost" type="button" onClick={() => edit(entry)}>Edit</button></td>
                </tr>
              ))}
              {!entries.length ? <tr><td colSpan="6">No approved destinations have been indexed yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function LinkSuggestion({ suggestion, busy, onDecision }) {
  const [anchorText, setAnchorText] = useState(suggestion.anchor_text || "");
  useEffect(() => setAnchorText(suggestion.anchor_text || ""), [suggestion.id, suggestion.anchor_text]);
  const changed = anchorText.trim() !== (suggestion.anchor_text || "").trim();
  return (
    <div className="notice">
      <div className="panel__header">
        <div>
          <strong>{suggestion.destination_title}</strong>
          <p>{suggestion.destination_url}</p>
        </div>
        <span className="knowledge-score-badge">{suggestion.confidence_score}% match</span>
      </div>
      <p>{suggestion.reason}</p>
      {suggestion.context ? <small>{suggestion.context}</small> : null}
      <label className="field" style={{ marginTop: 10 }}>
        <span className="field__label">Anchor text</span>
        <input className="field__input" value={anchorText} disabled={suggestion.status === "rejected"} onChange={(event) => setAnchorText(event.target.value)} />
      </label>
      <div className="card-actions">
        {suggestion.status === "pending" ? (
          <>
            <button className="button button--success" type="button" disabled={busy || anchorText.trim().length < 2} onClick={() => onDecision(suggestion.id, "accept", anchorText)}>
              Accept
            </button>
            <button className="button button--danger" type="button" disabled={busy} onClick={() => onDecision(suggestion.id, "reject", anchorText || suggestion.anchor_text)}>
              Reject
            </button>
          </>
        ) : <span><strong>{titleCase(suggestion.status)}</strong></span>}
        {changed && suggestion.status !== "rejected" ? (
          <button className="button button--ghost" type="button" disabled={busy || anchorText.trim().length < 2} onClick={() => onDecision(suggestion.id, "edit_anchor", anchorText)}>
            Save anchor
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function InternalLinkReviewPanel({
  suggestions,
  events = [],
  onDecision,
  onRefresh,
  busy,
}) {
  const visible = suggestions.filter((item) => item.status !== "superseded");
  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <h3>Contextual Internal Links</h3>
          <p>
            Intent-matched suggestions from the approved Website Index. Accepting a
            suggestion records the decision; it never inserts or publishes a link.
          </p>
        </div>
        <button className="button button--ghost" type="button" disabled={busy} onClick={onRefresh}>
          Refresh Suggestions
        </button>
      </div>
      <div className="knowledge-business-grid">
        {visible.map((suggestion) => (
          <LinkSuggestion
            key={suggestion.id}
            suggestion={suggestion}
            busy={busy}
            onDecision={onDecision}
          />
        ))}
        {!visible.length ? (
          <div className="notice">No approved Website Index destination currently meets the relevance safeguards.</div>
        ) : null}
      </div>
      {events.length ? (
        <details style={{ marginTop: 14 }}>
          <summary>Recent internal-link audit history</summary>
          {events.slice(0, 8).map((event) => (
            <div className="notice" key={event.id} style={{ marginTop: 8 }}>
              <strong>{titleCase(event.action)}</strong> · {event.reason}
              <br /><small>{new Date(event.created_at).toLocaleString("en-GB")}</small>
            </div>
          ))}
        </details>
      ) : null}
    </section>
  );
}
