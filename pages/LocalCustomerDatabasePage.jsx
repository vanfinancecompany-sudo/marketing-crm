import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_TAGS,
  PIPELINE_OPTIONS,
  SOURCE_OPTIONS,
  addContactToResult,
  buildCustomerExports,
  buildCustomerResult,
  cleanCustomerRows,
  cleanManualContact,
  contactName,
  createTimelineEvent,
  filterContactsByPipeline,
  parseCsv,
  updateContactRecord,
} from "../utils/contactCleaning.js";

const USE_SUPABASE_CUSTOMER_DATABASE = String(import.meta.env.VITE_USE_SUPABASE_CUSTOMER_DATABASE || "").toLowerCase() === "true";

const STORAGE_KEYS = {
  contacts: "vfc_customer_database_contacts",
  imports: "vfc_customer_database_imports",
  rejected: "vfc_customer_database_rejected",
  duplicates: "vfc_customer_database_duplicates",
  possibleDuplicates: "vfc_customer_database_possible_duplicates",
};

const PAGE_SIZE = 50;
const STORAGE_WARNING = "Browser storage limit reached.\nContacts remain available until refresh.\nSupabase storage is recommended for permanent storage.";

const EMPTY_FORM = {
  first_name: "",
  last_name: "",
  company: "",
  email: "",
  phone: "",
  postcode: "",
  pipeline: "unknown",
  source: "manual",
  notes: "",
  tags: [],
};

const EMPTY_FILTERS = {
  source: "all",
  tag: "all",
  readiness: "all",
  postcode: "all",
  unknownPipeline: false,
};

const pipelineLabels = {
  all: "All",
  finance: "Finance",
  rent2buy: "Rent2Buy",
  both: "Both",
  unknown: "Unknown",
};

const sourceLabels = {
  manual: "Manual",
  csv: "CSV",
  wix: "Wix",
  crm: "CRM",
  facebook: "Facebook",
  supabase: "Supabase",
  other: "Other",
};

const exportGroups = [
  { title: "Facebook", buttons: [["Full Audience", "fullFacebook", "full-facebook-audience.csv"], ["Finance", "financeFacebook", "finance-facebook-audience.csv"], ["Rent2Buy", "rent2buyFacebook", "rent2buy-facebook-audience.csv"]] },
  { title: "Email", buttons: [["Full", "email", "email-marketing.csv"], ["Finance", "financeEmail", "finance-email.csv"], ["Rent2Buy", "rent2buyEmail", "rent2buy-email.csv"]] },
  { title: "SMS", buttons: [["Full", "sms", "sms-contacts.csv"], ["Finance", "financeSms", "finance-sms.csv"], ["Rent2Buy", "rent2buySms", "rent2buy-sms.csv"]] },
  { title: "Reports", buttons: [["Master Database", "master", "customer-master.csv"], ["Duplicate Report", "duplicates", "duplicate-report.csv"], ["Rejected Rows", "rejected", "rejected-rows.csv"]] },
];

function readStorage(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } }
function writeStorage(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (storageError) { console.warn("Customer Database localStorage write failed", storageError); return false; } }
function downloadCsv(filename, content) { const blob = new Blob([content], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url); }
function updateFormValue(setForm, key, value) { setForm((current) => ({ ...current, [key]: value })); }
function formatNumber(value) { return Number(value || 0).toLocaleString("en-GB"); }
function formatDate(value) { if (!value) return "-"; const date = new Date(value); if (Number.isNaN(date.getTime())) return "-"; return date.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
function contactMatchesSearch(contact, search) { const query = search.trim().toLowerCase(); if (!query) return true; return [contact.first_name, contact.last_name, contact.email, contact.phone, contact.postcode, contact.company].filter(Boolean).some((value) => String(value).toLowerCase().includes(query)); }
function TableShell({ children }) { return <div style={{ overflowX: "auto" }}>{children}</div>; }

function Modal({ title, children, onClose }) {
  return <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", padding: 18, background: "rgba(15, 23, 42, 0.48)" }}><div className="panel" style={{ width: "min(840px, 100%)", maxHeight: "88vh", overflow: "auto" }}><div className="panel__header"><div><div className="eyebrow">Customer Database</div><h3>{title}</h3></div><button type="button" className="button button--ghost" onClick={onClose}>Close</button></div>{children}</div></div>;
}

function TagChips({ tags }) {
  const safeTags = Array.isArray(tags) ? tags : [];
  if (!safeTags.length) return <span style={{ color: "#64748b" }}>-</span>;
  return <div className="card-actions" style={{ gap: 6 }}>{safeTags.slice(0, 6).map((tag) => <span key={tag} className="tag" style={{ padding: "5px 8px", fontSize: 12 }}>{tag}</span>)}{safeTags.length > 6 ? <span className="tag">+{safeTags.length - 6}</span> : null}</div>;
}

function ContactForm({ form, setForm, error, onSubmit, submitLabel }) {
  function toggleTag(tag) { setForm((current) => { const tags = new Set(current.tags || []); if (tags.has(tag)) tags.delete(tag); else tags.add(tag); return { ...current, tags: [...tags].sort() }; }); }
  return <form onSubmit={onSubmit} className="field-grid"><label className="field"><span className="field__label">First name</span><input className="field__input" value={form.first_name} onChange={(event) => updateFormValue(setForm, "first_name", event.target.value)} /></label><label className="field"><span className="field__label">Last name</span><input className="field__input" value={form.last_name} onChange={(event) => updateFormValue(setForm, "last_name", event.target.value)} /></label><label className="field"><span className="field__label">Company</span><input className="field__input" value={form.company} onChange={(event) => updateFormValue(setForm, "company", event.target.value)} /></label><label className="field"><span className="field__label">Email</span><input className="field__input" value={form.email} onChange={(event) => updateFormValue(setForm, "email", event.target.value)} /></label><label className="field"><span className="field__label">Mobile</span><input className="field__input" value={form.phone} onChange={(event) => updateFormValue(setForm, "phone", event.target.value)} /></label><label className="field"><span className="field__label">Postcode</span><input className="field__input" value={form.postcode} onChange={(event) => updateFormValue(setForm, "postcode", event.target.value)} /></label><label className="field"><span className="field__label">Pipeline</span><select className="field__input" value={form.pipeline} onChange={(event) => updateFormValue(setForm, "pipeline", event.target.value)}>{PIPELINE_OPTIONS.map((pipeline) => <option key={pipeline} value={pipeline}>{pipelineLabels[pipeline]}</option>)}</select></label><label className="field"><span className="field__label">Source</span><select className="field__input" value={form.source} onChange={(event) => updateFormValue(setForm, "source", event.target.value)}>{SOURCE_OPTIONS.map((source) => <option key={source} value={source}>{sourceLabels[source]}</option>)}</select></label><label className="field" style={{ gridColumn: "1 / -1" }}><span className="field__label">Notes</span><textarea className="field__input" rows={3} value={form.notes} onChange={(event) => updateFormValue(setForm, "notes", event.target.value)} /></label><div className="field" style={{ gridColumn: "1 / -1" }}><span className="field__label">Tags</span><div className="card-actions">{DEFAULT_TAGS.map((tag) => <button key={tag} type="button" className={(form.tags || []).includes(tag) ? "button button--primary" : "button button--ghost"} onClick={() => toggleTag(tag)}>{tag}</button>)}</div></div><div className="card-actions" style={{ gridColumn: "1 / -1" }}><button type="submit" className="button button--primary">{submitLabel}</button></div>{error ? <div className="notice notice--error" style={{ gridColumn: "1 / -1" }}>{error}</div> : null}</form>;
}

export default function LocalCustomerDatabasePage() {
  const initialContacts = readStorage(STORAGE_KEYS.contacts, []);
  const initialRejected = readStorage(STORAGE_KEYS.rejected, []);
  const initialDuplicates = readStorage(STORAGE_KEYS.duplicates, []);
  const initialPossibleDuplicates = readStorage(STORAGE_KEYS.possibleDuplicates, []);
  const [result, setResult] = useState(() => buildCustomerResult(initialContacts, initialRejected, initialDuplicates, initialContacts.length, initialPossibleDuplicates));
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const [manualError, setManualError] = useState("");
  const [manualForm, setManualForm] = useState(EMPTY_FORM);
  const [activeFilter, setActiveFilter] = useState("all");
  const [advancedFilters, setAdvancedFilters] = useState(EMPTY_FILTERS);
  const [exportScope, setExportScope] = useState("all");
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [modalMode, setModalMode] = useState("");
  const [selectedContact, setSelectedContact] = useState(null);
  const [editingIndex, setEditingIndex] = useState(-1);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkTag, setBulkTag] = useState("lead");
  const [bulkPipeline, setBulkPipeline] = useState("unknown");
  const [importHistory, setImportHistory] = useState(() => readStorage(STORAGE_KEYS.imports, []));

  const csvExports = useMemo(() => buildCustomerExports(result.cleanContacts, result.rejectedRows, result.duplicateRows, exportScope), [result.cleanContacts, result.rejectedRows, result.duplicateRows, exportScope]);
  const filteredContacts = useMemo(() => filterContactsByPipeline(result.cleanContacts, activeFilter).filter((contact) => contactMatchesSearch(contact, search)).filter((contact) => advancedFilters.source === "all" || contact.source === advancedFilters.source).filter((contact) => advancedFilters.tag === "all" || (contact.tags || []).includes(advancedFilters.tag)).filter((contact) => advancedFilters.readiness === "all" || (contact.tags || []).includes(advancedFilters.readiness)).filter((contact) => advancedFilters.postcode === "all" || Boolean(contact.postcode)).filter((contact) => !advancedFilters.unknownPipeline || contact.pipeline === "unknown"), [result.cleanContacts, activeFilter, search, advancedFilters]);
  const totalPages = Math.max(1, Math.ceil(filteredContacts.length / PAGE_SIZE));
  const pageStartIndex = filteredContacts.length ? (currentPage - 1) * PAGE_SIZE : 0;
  const pageEndIndex = Math.min(pageStartIndex + PAGE_SIZE, filteredContacts.length);
  const visiblePageContacts = useMemo(() => filteredContacts.slice(pageStartIndex, pageEndIndex), [filteredContacts, pageStartIndex, pageEndIndex]);
  const selectedVisibleContacts = useMemo(() => visiblePageContacts.filter((contact) => selectedIds.includes(contact.customer_id)), [visiblePageContacts, selectedIds]);
  const dashboardCards = useMemo(() => [["Total Contacts", result.stats.cleanContacts], ["Finance Contacts", result.cleanContacts.filter((contact) => contact.pipeline === "finance").length], ["Rent2Buy Contacts", result.cleanContacts.filter((contact) => contact.pipeline === "rent2buy").length], ["Both", result.cleanContacts.filter((contact) => contact.pipeline === "both").length], ["Unknown", result.cleanContacts.filter((contact) => contact.pipeline === "unknown").length], ["Facebook Ready", result.stats.facebookReadyContacts], ["Email Ready", result.stats.emailReadyContacts], ["SMS Ready", result.stats.smsReadyContacts], ["Duplicates Removed", result.stats.duplicatesRemoved], ["Rejected Records", result.stats.badRowsRejected]], [result.cleanContacts, result.stats]);

  useEffect(() => { setCurrentPage(1); setSelectedIds([]); }, [search, activeFilter, advancedFilters]);
  useEffect(() => { setCurrentPage((page) => Math.min(page, totalPages)); }, [totalPages]);

  function persist(nextResult, nextImports = importHistory) { if (USE_SUPABASE_CUSTOMER_DATABASE) { setStorageWarning(""); return; } const writesSucceeded = [writeStorage(STORAGE_KEYS.contacts, nextResult.cleanContacts), writeStorage(STORAGE_KEYS.rejected, nextResult.rejectedRows), writeStorage(STORAGE_KEYS.duplicates, nextResult.duplicateRows), writeStorage(STORAGE_KEYS.possibleDuplicates, nextResult.possibleDuplicates || []), writeStorage(STORAGE_KEYS.imports, nextImports)].every(Boolean); setStorageWarning(writesSucceeded ? "" : STORAGE_WARNING); }
  function replaceResult(nextResult, nextImports = importHistory) { setResult(nextResult); setImportHistory(nextImports); persist(nextResult, nextImports); }
  async function handleFileUpload(event) { const file = event.target.files?.[0]; setError(""); setFileName(file?.name || ""); if (!file) return; if (!file.name.toLowerCase().endsWith(".csv")) { setError("Upload a CSV file."); return; } try { const text = await file.text(); const rows = parseCsv(text); const cleaned = cleanCustomerRows(rows, { existingContacts: result.cleanContacts, rejectedRows: result.rejectedRows, duplicateRows: result.duplicateRows, possibleDuplicates: result.possibleDuplicates, filename: file.name }); const entry = { import_id: `${Date.now()}-${file.name}`, filename: file.name, imported_at: new Date().toISOString(), rows_imported: cleaned.stats.rowsImported, contacts_created: cleaned.importStats.contactsCreated || 0, duplicates_merged: cleaned.importStats.duplicatesMerged || 0, possible_duplicates: cleaned.importStats.possibleDuplicates || 0, rejected_rows: cleaned.stats.badRowsRejected }; replaceResult(cleaned, [entry, ...importHistory].slice(0, 12)); setCurrentPage(1); setSelectedIds([]); } catch (uploadError) { setError(uploadError.message || "Could not read this CSV file."); } }
  function openAddModal() { setManualForm(EMPTY_FORM); setManualError(""); setEditingIndex(-1); setModalMode("add"); }
  function openEditModal(contact) { setManualForm({ first_name: contact.first_name || "", last_name: contact.last_name || "", company: contact.company || "", email: contact.email || "", phone: contact.phone || "", postcode: contact.postcode || "", pipeline: contact.pipeline || "unknown", source: contact.source || "manual", notes: contact.notes || "", tags: contact.tags || [] }); setManualError(""); setEditingIndex(result.cleanContacts.findIndex((item) => item.customer_id === contact.customer_id)); setModalMode("edit"); }
  function closeModal() { setModalMode(""); setSelectedContact(null); setEditingIndex(-1); setManualError(""); }
  function handleManualSubmit(event) { event.preventDefault(); if (editingIndex >= 0) { const existing = result.cleanContacts[editingIndex]; const { contact, error: contactError } = updateContactRecord(existing, manualForm); if (contactError) { setManualError(contactError); return; } const cleanContacts = [...result.cleanContacts]; cleanContacts[editingIndex] = contact; replaceResult(buildCustomerResult(cleanContacts, result.rejectedRows, result.duplicateRows, result.stats.rowsImported, result.possibleDuplicates)); } else { const { contact, error: contactError } = cleanManualContact(manualForm, result.cleanContacts); if (contactError) { setManualError(contactError); return; } replaceResult(addContactToResult(result, contact)); } setManualForm(EMPTY_FORM); closeModal(); }
  function handleDeleteContact(contact) { const cleanContacts = result.cleanContacts.filter((item) => item.customer_id !== contact.customer_id); replaceResult(buildCustomerResult(cleanContacts, result.rejectedRows, result.duplicateRows, result.stats.rowsImported, result.possibleDuplicates)); setSelectedIds((ids) => ids.filter((id) => id !== contact.customer_id)); }
  function toggleSelected(contactId) { setSelectedIds((ids) => ids.includes(contactId) ? ids.filter((id) => id !== contactId) : [...ids, contactId]); }
  function updateSelectedContacts(updater) { const visibleSelectedIds = new Set(selectedVisibleContacts.map((contact) => contact.customer_id)); const now = new Date().toISOString(); const cleanContacts = result.cleanContacts.map((contact) => visibleSelectedIds.has(contact.customer_id) ? updater(contact, now) : contact); replaceResult(buildCustomerResult(cleanContacts, result.rejectedRows, result.duplicateRows, result.stats.rowsImported, result.possibleDuplicates)); }
  function bulkAddTag() { updateSelectedContacts((contact, now) => (contact.tags || []).includes(bulkTag) ? contact : { ...contact, tags: [...(contact.tags || []), bulkTag].sort(), updated_at: now, timeline: [...(contact.timeline || []), createTimelineEvent("tag_added", `Tag added: ${bulkTag}`, now)] }); }
  function bulkRemoveTag() { updateSelectedContacts((contact, now) => !(contact.tags || []).includes(bulkTag) ? contact : { ...contact, tags: (contact.tags || []).filter((tag) => tag !== bulkTag), updated_at: now, timeline: [...(contact.timeline || []), createTimelineEvent("tag_removed", `Tag removed: ${bulkTag}`, now)] }); }
  function bulkChangePipeline() { updateSelectedContacts((contact, now) => contact.pipeline === bulkPipeline ? contact : { ...contact, pipeline: bulkPipeline, updated_at: now, timeline: [...(contact.timeline || []), createTimelineEvent("pipeline_changed", `Pipeline changed from ${contact.pipeline} to ${bulkPipeline}`, now)] }); }
  function bulkDeleteSelected() { const visibleSelectedIds = new Set(selectedVisibleContacts.map((contact) => contact.customer_id)); const cleanContacts = result.cleanContacts.filter((contact) => !visibleSelectedIds.has(contact.customer_id)); replaceResult(buildCustomerResult(cleanContacts, result.rejectedRows, result.duplicateRows, result.stats.rowsImported, result.possibleDuplicates)); setSelectedIds([]); }
  function handleDownload(key, filename) { downloadCsv(filename, csvExports[key]); }
  function exportSelected() { const selectedExports = buildCustomerExports(selectedVisibleContacts, [], [], "all"); downloadCsv("selected-customers.csv", selectedExports.master); }

  return <div className="page-stack" style={{ gap: 14 }}><section className="hero-panel" style={{ padding: 18 }}><div className="panel__header" style={{ marginBottom: 0 }}><div><div className="eyebrow">Customer Data</div><h2>Customer Database</h2><p>Upload, clean, search, manage, and export contacts from one CRM workspace.</p></div><div className="card-actions"><button type="button" className="button button--primary" onClick={openAddModal}>+ Add Contact</button></div></div></section>{storageWarning ? <div className="notice notice--error">{storageWarning}</div> : null}<section className="stats-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>{dashboardCards.map(([label, value]) => <div key={label} className="stat-card" style={{ padding: 16, borderRadius: 18 }}><div className="stat-card__label">{label}</div><div className="stat-card__value" style={{ fontSize: 30 }}>{formatNumber(value)}</div></div>)}</section><section className="panel" style={{ padding: 16 }}><div className="panel__header"><div><h3>Import</h3><p>Old imports default to Unknown unless a clear field says Finance or Rent2Buy.</p></div><label className="field" style={{ minWidth: 280 }}><span className="field__label">Upload CSV</span><input className="field__input" type="file" accept=".csv,text/csv" onChange={handleFileUpload} /></label></div>{fileName ? <div className="notice">Loaded file: {fileName}</div> : null}{error ? <div className="notice notice--error">{error}</div> : null}</section><section className="panel" style={{ padding: 16 }}><div className="panel__header"><div><h3>Contacts</h3><p>{formatNumber(filteredContacts.length)} matched contacts from {formatNumber(result.stats.cleanContacts)} clean contacts. {formatNumber(selectedVisibleContacts.length)} selected on this page.</p></div><label className="field" style={{ minWidth: 260 }}><span className="field__label">Search</span><input className="field__input" placeholder="Name, email, phone, postcode, company" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div><div className="card-actions" style={{ marginBottom: 12 }}>{["all", ...PIPELINE_OPTIONS].map((pipeline) => <button key={pipeline} type="button" className={activeFilter === pipeline ? "button button--primary" : "button button--ghost"} onClick={() => setActiveFilter(pipeline)}>{pipelineLabels[pipeline]}</button>)}</div><div className="field-grid" style={{ marginBottom: 12 }}><label className="field"><span className="field__label">Source</span><select className="field__input" value={advancedFilters.source} onChange={(event) => setAdvancedFilters((filters) => ({ ...filters, source: event.target.value }))}><option value="all">All sources</option>{SOURCE_OPTIONS.map((source) => <option key={source} value={source}>{sourceLabels[source]}</option>)}</select></label><label className="field"><span className="field__label">Tag</span><select className="field__input" value={advancedFilters.tag} onChange={(event) => setAdvancedFilters((filters) => ({ ...filters, tag: event.target.value }))}><option value="all">All tags</option>{DEFAULT_TAGS.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select></label><label className="field"><span className="field__label">Readiness</span><select className="field__input" value={advancedFilters.readiness} onChange={(event) => setAdvancedFilters((filters) => ({ ...filters, readiness: event.target.value }))}><option value="all">All</option><option value="email_ready">Email Ready</option><option value="sms_ready">SMS Ready</option><option value="facebook_ready">Facebook Ready</option></select></label><label className="field"><span className="field__label">Data quality</span><select className="field__input" value={advancedFilters.postcode} onChange={(event) => setAdvancedFilters((filters) => ({ ...filters, postcode: event.target.value }))}><option value="all">Any postcode</option><option value="has_postcode">Has postcode</option></select></label><label className="toggle-row" style={{ marginTop: 20 }}><input type="checkbox" checked={advancedFilters.unknownPipeline} onChange={(event) => setAdvancedFilters((filters) => ({ ...filters, unknownPipeline: event.target.checked }))} />Unknown Pipeline</label></div><div className="selection-summary" style={{ marginBottom: 12 }}><strong>Bulk actions</strong><div className="card-actions"><select className="field__input" style={{ width: 180 }} value={bulkTag} onChange={(event) => setBulkTag(event.target.value)}>{DEFAULT_TAGS.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select><button type="button" className="button button--ghost" disabled={!selectedVisibleContacts.length} onClick={bulkAddTag}>Add Tag</button><button type="button" className="button button--ghost" disabled={!selectedVisibleContacts.length} onClick={bulkRemoveTag}>Remove Tag</button><select className="field__input" style={{ width: 160 }} value={bulkPipeline} onChange={(event) => setBulkPipeline(event.target.value)}>{PIPELINE_OPTIONS.map((pipeline) => <option key={pipeline} value={pipeline}>{pipelineLabels[pipeline]}</option>)}</select><button type="button" className="button button--ghost" disabled={!selectedVisibleContacts.length} onClick={bulkChangePipeline}>Change Pipeline</button><button type="button" className="button button--ghost" disabled={!selectedVisibleContacts.length} onClick={exportSelected}>Export Selected</button><button type="button" className="button button--danger" disabled={!selectedVisibleContacts.length} onClick={bulkDeleteSelected}>Delete Selected</button></div></div><div className="card-actions" style={{ justifyContent: "space-between", marginBottom: 12 }}><span style={{ color: "#64748b", fontWeight: 800 }}>Showing {filteredContacts.length ? formatNumber(pageStartIndex + 1) : 0}-{formatNumber(pageEndIndex)} of {formatNumber(filteredContacts.length)} contacts</span><div className="card-actions" style={{ alignItems: "center" }}><button type="button" className="button button--ghost" disabled={currentPage <= 1} onClick={() => { setCurrentPage((page) => Math.max(1, page - 1)); setSelectedIds([]); }}>Previous</button><label className="field" style={{ width: 110 }}><span className="field__label">Page</span><input className="field__input" type="number" min="1" max={totalPages} value={currentPage} onChange={(event) => { const nextPage = Math.min(totalPages, Math.max(1, Number(event.target.value) || 1)); setCurrentPage(nextPage); setSelectedIds([]); }} /></label><span style={{ color: "#64748b", fontWeight: 800 }}>of {formatNumber(totalPages)}</span><button type="button" className="button button--ghost" disabled={currentPage >= totalPages} onClick={() => { setCurrentPage((page) => Math.min(totalPages, page + 1)); setSelectedIds([]); }}>Next</button></div></div><TableShell><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}><thead><tr><th style={{ padding: "10px 8px", borderBottom: "1px solid #dbe2ea" }}><input type="checkbox" checked={visiblePageContacts.length > 0 && visiblePageContacts.every((contact) => selectedIds.includes(contact.customer_id))} onChange={(event) => setSelectedIds(event.target.checked ? visiblePageContacts.map((contact) => contact.customer_id) : [])} /></th>{["Name", "Email", "Phone", "Pipeline", "Source", "Postcode", "Last Updated", "Actions"].map((heading) => <th key={heading} style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #dbe2ea", color: "#475569" }}>{heading}</th>)}</tr></thead><tbody>{visiblePageContacts.length === 0 ? <tr><td colSpan={9} style={{ padding: 18, color: "#64748b" }}>No contacts match this view.</td></tr> : visiblePageContacts.map((contact) => <tr key={contact.customer_id}><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}><input type="checkbox" checked={selectedIds.includes(contact.customer_id)} onChange={() => toggleSelected(contact.customer_id)} /></td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7", fontWeight: 800 }}>{contactName(contact)}<br /><small style={{ color: "#64748b" }}>{contact.customer_id}</small><TagChips tags={contact.tags} /></td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{contact.email || "-"}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{contact.phone || "-"}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{pipelineLabels[contact.pipeline] || contact.pipeline}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{sourceLabels[contact.source] || contact.source}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{contact.postcode || "-"}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7", whiteSpace: "nowrap" }}>{formatDate(contact.updated_at)}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}><div className="card-actions" style={{ gap: 6 }}><button type="button" className="button button--ghost" onClick={() => { setSelectedContact(contact); setModalMode("view"); }}>View</button><button type="button" className="button button--ghost" onClick={() => openEditModal(contact)}>Edit</button><button type="button" className="button button--danger" onClick={() => handleDeleteContact(contact)}>Delete</button></div></td></tr>)}</tbody></table></TableShell></section><section className="panel" style={{ padding: 16 }}><div className="panel__header"><div><h3>Import History</h3><p>Stored locally for now.</p></div></div><TableShell><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}><tbody>{importHistory.length === 0 ? <tr><td style={{ padding: 18, color: "#64748b" }}>No imports yet.</td></tr> : importHistory.map((item) => <tr key={item.import_id}><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{formatDate(item.imported_at)}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{item.filename}</td><td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{formatNumber(item.rows_imported)}</td></tr>)}</tbody></table></TableShell></section><section className="panel" style={{ padding: 16 }}><div className="panel__header"><div><h3>Export Centre</h3><p>Grouped exports for audience uploads and reports.</p></div><label className="field" style={{ minWidth: 220 }}><span className="field__label">Report scope</span><select className="field__input" value={exportScope} onChange={(event) => setExportScope(event.target.value)}>{["all", ...PIPELINE_OPTIONS].map((pipeline) => <option key={pipeline} value={pipeline}>{pipelineLabels[pipeline]}</option>)}</select></label></div><div className="card-grid">{exportGroups.map((group) => <div key={group.title} className="panel panel--nested" style={{ boxShadow: "none" }}><h3 style={{ marginTop: 0 }}>{group.title}</h3><div className="card-actions">{group.buttons.map(([label, key, filename]) => <button key={key} type="button" className="button button--ghost" disabled={!result.stats.cleanContacts && key !== "rejected" && key !== "duplicates"} onClick={() => handleDownload(key, filename)}>{label}</button>)}</div></div>)}</div></section><section className="panel" style={{ padding: 16 }}><div className="panel__header"><div><h3>Reports Preview</h3><p>Rejected records, duplicates, and possible duplicates remain available for review.</p></div></div></section>{(modalMode === "add" || modalMode === "edit") ? <Modal title={modalMode === "edit" ? "Edit Contact" : "Add Contact"} onClose={closeModal}><ContactForm form={manualForm} setForm={setManualForm} error={manualError} onSubmit={handleManualSubmit} submitLabel={modalMode === "edit" ? "Save Contact" : "Add Contact"} /></Modal> : null}{modalMode === "view" && selectedContact ? <Modal title="Customer Profile" onClose={closeModal}><div className="field-grid">{[["Name", contactName(selectedContact)], ["Email", selectedContact.email || "-"], ["Phone", selectedContact.phone || "-"], ["Postcode", selectedContact.postcode || "-"], ["Pipeline", pipelineLabels[selectedContact.pipeline] || selectedContact.pipeline], ["Source", sourceLabels[selectedContact.source] || selectedContact.source], ["Created At", formatDate(selectedContact.created_at)], ["Updated At", formatDate(selectedContact.updated_at)], ["Last Seen At", formatDate(selectedContact.last_seen_at)], ["Duplicate Count", selectedContact.duplicate_count || 0]].map(([label, value]) => <div key={label} className="field"><span className="field__label">{label}</span><div className="field__input">{value}</div></div>)}<div className="field" style={{ gridColumn: "1 / -1" }}><span className="field__label">Tags</span><div className="field__input"><TagChips tags={selectedContact.tags} /></div></div><div className="field" style={{ gridColumn: "1 / -1" }}><span className="field__label">Notes</span><div className="field__input" style={{ minHeight: 84, whiteSpace: "pre-line" }}>{selectedContact.notes || "-"}</div></div></div></Modal> : null}</div>;
}
