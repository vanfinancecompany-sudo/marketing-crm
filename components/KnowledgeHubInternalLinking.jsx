import { useEffect, useState } from "react";
import { WEBSITE_INDEX_CATEGORIES } from "../lib/internalLinking.js";
import {
  approveWebsiteIndexCandidate,
  deleteWebsiteIndexCandidate,
  editWebsiteIndexCandidate,
  loadWebsiteIndexDiscovery,
  mergeWebsiteIndexCandidate,
  rejectWebsiteIndexCandidate,
  scanWebsiteIndex,
} from "../services/websiteIndexDiscovery.js";

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
  monitor_in_ai_visibility_when_published: true,
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
            <span className="field__label">Matching terms</span>
            <input className="field__input" placeholder="Medium vans, MWB, Transit Custom" value={lists.vehicle_types} onChange={(event) => setLists({ ...lists, vehicle_types: event.target.value })} />
          </label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span className="field__label">Customer intent</span>
            <input className="field__input" placeholder="Applying, Documents, Van finance" value={lists.customer_intent} onChange={(event) => setLists({ ...lists, customer_intent: event.target.value })} />
          </label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span className="field__label">Description</span>
            <textarea className="field__input" rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span className="toggle-row">
              <input
                type="checkbox"
                checked={form.monitor_in_ai_visibility_when_published !== false}
                onChange={(event) => setForm({ ...form, monitor_in_ai_visibility_when_published: event.target.checked })}
              />
              Monitor in AI Visibility when published
            </span>
            <small>This marks the destination as eligible only after publication; it does not run a provider check.</small>
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
            <thead><tr><th>Destination</th><th>Category</th><th>Intent & matching terms</th><th>Priority</th><th>Status</th><th /></tr></thead>
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

const DISCOVERY_ROOT = "https://www.vanfinancecompany.co.uk";
const CANDIDATE_LIST_FIELDS = [
  "suggested_keywords",
  "suggested_matching_terms",
  "suggested_customer_intent",
];
const MERGE_OPTIONS = [
  ["title", "Title"],
  ["url", "URL"],
  ["category", "Category"],
  ["priority", "Priority"],
  ["description", "Description"],
  ["keywords", "Keywords"],
  ["vehicle_types", "Matching terms"],
  ["customer_intent", "Customer intent"],
  ["monitor_in_ai_visibility_when_published", "AI Visibility monitoring preference"],
];

function DiscoverySummary({ run }) {
  if (!run) return <div className="notice">No discovery scan has been run yet.</div>;
  const metrics = [
    ["Pages scanned", run.pages_scanned],
    ["Candidates found", run.candidates_found],
    ["Existing records", run.existing_records],
    ["Duplicates", run.duplicates],
    ["Rejected", run.rejected],
    ["Pending review", run.pending_review],
    ["Categories without URLs", run.categories_without_urls],
    ["Broken links", run.broken_links],
  ];
  return (
    <div className="knowledge-stats-grid">
      {metrics.map(([label, value]) => (
        <div className="stat-card" key={label}>
          <span className="stat-card__label">{label}</span>
          <strong className="stat-card__value">{value ?? 0}</strong>
        </div>
      ))}
    </div>
  );
}

function CandidateEditor({ candidate, pages, busy, onSave, onMerge, onClose }) {
  const [form, setForm] = useState(candidate);
  const [lists, setLists] = useState(Object.fromEntries(
    CANDIDATE_LIST_FIELDS.map((field) => [field, listText(candidate[field])])
  ));
  const [existingPageId, setExistingPageId] = useState(candidate.existing_page_id || "");
  const [mergeFields, setMergeFields] = useState([]);
  const existing = pages.find((page) => page.id === existingPageId);
  const differences = existing
    ? [
        ["Title", existing.title, form.title],
        ["URL", existing.url, form.url],
        ["Category", existing.category, form.suggested_category],
        ["Matching terms", listText(existing.vehicle_types), lists.suggested_matching_terms],
      ]
    : [];
  return (
    <section className="panel">
      <div className="panel__header">
        <div><div className="eyebrow">Pending Review</div><h3>Edit discovered destination</h3></div>
        <button className="button button--ghost" type="button" onClick={onClose}>Close</button>
      </div>
      <div className="field-grid">
        <label className="field"><span className="field__label">Title</span><input className="field__input" value={form.title || ""} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
        <label className="field"><span className="field__label">URL</span><input className="field__input" placeholder="Required before approval" value={form.url || ""} onChange={(event) => setForm({ ...form, url: event.target.value })} /></label>
        <label className="field"><span className="field__label">Category</span><select className="field__input" value={form.suggested_category} onChange={(event) => setForm({ ...form, suggested_category: event.target.value })}>{WEBSITE_INDEX_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
        <label className="field"><span className="field__label">Priority</span><select className="field__input" value={form.suggested_priority} onChange={(event) => setForm({ ...form, suggested_priority: Number(event.target.value) })}>{[5, 4, 3, 2, 1].map((priority) => <option key={priority}>{priority}</option>)}</select></label>
        <label className="field"><span className="field__label">Keywords</span><input className="field__input" value={lists.suggested_keywords} onChange={(event) => setLists({ ...lists, suggested_keywords: event.target.value })} /></label>
        <label className="field"><span className="field__label">Matching terms</span><input className="field__input" value={lists.suggested_matching_terms} onChange={(event) => setLists({ ...lists, suggested_matching_terms: event.target.value })} /></label>
        <label className="field" style={{ gridColumn: "1 / -1" }}><span className="field__label">Customer intent</span><input className="field__input" value={lists.suggested_customer_intent} onChange={(event) => setLists({ ...lists, suggested_customer_intent: event.target.value })} /></label>
        <label className="field" style={{ gridColumn: "1 / -1" }}><span className="field__label">Description</span><textarea className="field__input" rows={3} value={form.suggested_description || ""} onChange={(event) => setForm({ ...form, suggested_description: event.target.value })} /></label>
        <label className="field" style={{ gridColumn: "1 / -1" }}><span className="toggle-row"><input type="checkbox" checked={form.monitor_in_ai_visibility_when_published !== false} onChange={(event) => setForm({ ...form, monitor_in_ai_visibility_when_published: event.target.checked })} />Monitor in AI Visibility when published</span><small>Default on. Monitoring remains dormant until the linked content has a verified publication URL.</small></label>
      </div>
      <div className="card-actions">
        <button className="button button--primary" type="button" disabled={busy} onClick={() => onSave(candidate.id, {
          ...form,
          ...Object.fromEntries(CANDIDATE_LIST_FIELDS.map((field) => [field, parseList(lists[field])])),
        })}>Save Review Changes</button>
      </div>
      <hr />
      <div className="panel__header"><div><h3>Merge Existing</h3><p>Selectively update an approved record. Unselected fields are preserved.</p></div></div>
      <label className="field"><span className="field__label">Existing destination</span><select className="field__input" value={existingPageId} onChange={(event) => { setExistingPageId(event.target.value); setMergeFields([]); }}><option value="">Select destination</option>{pages.map((page) => <option value={page.id} key={page.id}>{page.title}</option>)}</select></label>
      {differences.length ? (
        <div className="knowledge-table-wrap">
          <table className="knowledge-table"><thead><tr><th>Field</th><th>Approved value</th><th>Discovered value</th></tr></thead><tbody>{differences.map(([field, current, proposed]) => <tr key={field} className={String(current || "") !== String(proposed || "") ? "is-different" : ""}><td>{field}</td><td>{current || "—"}</td><td>{proposed || "—"}</td></tr>)}</tbody></table>
        </div>
      ) : null}
      {existing ? <div className="field-grid">{MERGE_OPTIONS.map(([field, label]) => <label className="toggle-row" key={field}><input type="checkbox" checked={mergeFields.includes(field)} onChange={(event) => setMergeFields(event.target.checked ? [...mergeFields, field] : mergeFields.filter((item) => item !== field))} />{label}</label>)}</div> : null}
      {existing ? <div className="card-actions"><button className="button button--primary" type="button" disabled={busy || !mergeFields.length} onClick={() => onMerge(candidate.id, existingPageId, mergeFields)}>Merge Selected Fields</button></div> : null}
    </section>
  );
}

export function WebsiteIndexDiscoveryPanel({ onIndexChanged }) {
  const [state, setState] = useState({ runs: [], candidates: [], audit_events: [], website_index: [] });
  const [status, setStatus] = useState("pending_review");
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const result = await loadWebsiteIndexDiscovery();
      setState(result);
    } catch (loadError) {
      setError(loadError.message || "Website discovery queue could not be loaded.");
    }
  }
  useEffect(() => { load(); }, []);

  async function act(work, success, indexChanged = false) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      setMessage(success);
      setSelected(null);
      await load();
      if (indexChanged) await onIndexChanged?.();
    } catch (actionError) {
      setError(actionError.message || "Website discovery action failed.");
    } finally {
      setBusy(false);
    }
  }
  const rows = state.candidates.filter((candidate) => status === "all" || candidate.status === status);
  const latestRun = state.runs[0];
  return (
    <>
      <section className="panel">
        <div className="panel__header">
          <div>
            <div className="eyebrow">Discovery ≠ Approval</div>
            <h3>Website Index Discovery</h3>
            <p>Scan the public Van Finance Company website. Every result remains unverified and unavailable to Internal Linking until you approve it.</p>
          </div>
          <button className="button button--primary" type="button" disabled={busy} onClick={() => act(() => scanWebsiteIndex(DISCOVERY_ROOT), "Scan complete. Candidates are ready for manual review.")}>
            {busy ? "Working…" : "Scan Website"}
          </button>
        </div>
        <div className="notice">Same-domain public HTML only. External links, accounts, login, checkout, search, tracking URLs and files are excluded. Wix filter controls without unique URLs are recorded for manual mapping—no URL is invented.</div>
        {error ? <div className="notice notice--error">{error}</div> : null}
        {message ? <div className="notice notice--success">{message}</div> : null}
        <DiscoverySummary run={latestRun} />
      </section>

      {selected ? (
        <CandidateEditor
          candidate={selected}
          pages={state.website_index}
          busy={busy}
          onClose={() => setSelected(null)}
          onSave={(id, changes) => act(() => editWebsiteIndexCandidate(id, changes), "Review changes saved. The candidate is still pending.")}
          onMerge={(id, pageId, fields) => act(() => mergeWebsiteIndexCandidate(id, pageId, fields), "Selected discovery fields merged into the approved destination.", true)}
        />
      ) : null}

      <section className="panel">
        <div className="panel__header">
          <div><h3>Pending Review Queue</h3><p>{rows.length} destination{rows.length === 1 ? "" : "s"} shown.</p></div>
          <select className="field__input" style={{ maxWidth: 220 }} value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="pending_review">Pending Review</option><option value="approved">Approved</option><option value="merged">Merged</option><option value="rejected">Rejected</option><option value="all">All</option>
          </select>
        </div>
        <div className="knowledge-table-wrap">
          <table className="knowledge-table">
            <thead><tr><th>Destination</th><th>Category</th><th>Keywords & matching terms</th><th>Source & evidence</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.map((candidate) => (
                <tr key={candidate.id}>
                  <td><strong>{candidate.title}</strong><br /><small>{candidate.url || "No unique URL — manual mapping required"}</small></td>
                  <td>{candidate.suggested_category}<br /><small>{candidate.suggested_customer_intent.join(", ")}</small></td>
                  <td>{[...candidate.suggested_keywords, ...candidate.suggested_matching_terms].slice(0, 12).join(", ") || "—"}</td>
                  <td><small>{candidate.source_page}</small><br /><small>{titleCase(candidate.evidence?.evidence_type)} · HTTP {candidate.http_status ?? "not checked"}</small></td>
                  <td>{titleCase(candidate.status)}{candidate.duplicate_type !== "none" ? <><br /><small>Duplicate: {titleCase(candidate.duplicate_type)}</small></> : null}</td>
                  <td>
                    <div className="card-actions">
                      {candidate.status === "pending_review" ? <>
                        <button className="button button--success" type="button" disabled={busy || !candidate.url || candidate.duplicate_type !== "none"} onClick={() => act(() => approveWebsiteIndexCandidate(candidate.id), "Destination verified and approved.", true)}>Approve</button>
                        <button className="button button--danger" type="button" disabled={busy} onClick={() => act(() => rejectWebsiteIndexCandidate(candidate.id), "Destination rejected.")}>Reject</button>
                        <button className="button button--ghost" type="button" onClick={() => setSelected(candidate)}>Edit / Merge</button>
                      </> : null}
                      {candidate.url ? <a className="button button--ghost" href={candidate.url} target="_blank" rel="noreferrer">Open URL</a> : null}
                      {candidate.status === "rejected" ? <button className="button button--ghost" type="button" disabled={busy} onClick={() => act(() => deleteWebsiteIndexCandidate(candidate.id), "Rejected discovery record removed; audit history preserved.")}>Delete</button> : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length ? <tr><td colSpan="6">No destinations match this review status.</td></tr> : null}
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
