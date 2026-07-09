import { useEffect, useMemo, useState } from "react";
import {
  PIPELINE_OPTIONS,
  SOURCE_OPTIONS,
  addContactToResult,
  buildCustomerExports,
  cleanCustomerRows,
  cleanManualContact,
  filterContactsByPipeline,
  parseCsv,
} from "../utils/contactCleaning.js";

const EMPTY_RESULT = {
  cleanContacts: [],
  rejectedRows: [],
  duplicateRows: [],
  stats: {
    rowsImported: 0,
    cleanContacts: 0,
    duplicatesRemoved: 0,
    badRowsRejected: 0,
    emailReadyContacts: 0,
    smsReadyContacts: 0,
    facebookReadyContacts: 0,
  },
};

const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  postcode: "",
  company: "",
  pipeline: "unknown",
  source: "manual",
  notes: "",
};

const IMPORT_HISTORY_KEY = "customerDatabaseImportHistory";

const pipelineLabels = {
  all: "All",
  finance: "Finance",
  rent2buy: "Rent2Buy",
  both: "Both",
  unknown: "Unknown",
};

const sourceLabels = {
  manual: "Manual",
  wix: "Wix",
  supabase: "Supabase",
  facebook: "Facebook",
  crm: "CRM",
  other: "Other",
};

const exportGroups = [
  {
    title: "Facebook",
    buttons: [
      ["Full Audience", "fullFacebook", "full-facebook-audience.csv"],
      ["Finance", "financeFacebook", "finance-facebook-audience.csv"],
      ["Rent2Buy", "rent2buyFacebook", "rent2buy-facebook-audience.csv"],
    ],
  },
  {
    title: "Email",
    buttons: [
      ["Full", "email", "email-marketing.csv"],
      ["Finance", "financeEmail", "finance-email.csv"],
      ["Rent2Buy", "rent2buyEmail", "rent2buy-email.csv"],
    ],
  },
  {
    title: "SMS",
    buttons: [
      ["Full", "sms", "sms-contacts.csv"],
      ["Finance", "financeSms", "finance-sms.csv"],
      ["Rent2Buy", "rent2buySms", "rent2buy-sms.csv"],
    ],
  },
  {
    title: "Reports",
    buttons: [
      ["Master Database", "master", "customer-master.csv"],
      ["Duplicate Report", "duplicates", "duplicate-report.csv"],
      ["Rejected Rows", "rejected", "rejected-rows.csv"],
    ],
  },
];

function downloadCsv(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function updateFormValue(setForm, key, value) {
  setForm((current) => ({ ...current, [key]: value }));
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function contactName(contact) {
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Unnamed contact";
}

function contactMatchesSearch(contact, search) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [
    contact.firstName,
    contact.lastName,
    contact.email,
    contact.phone,
    contact.postcode,
    contact.company,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

function buildResult(cleanContacts, rejectedRows, duplicateRows, rowsImported) {
  return {
    cleanContacts,
    rejectedRows,
    duplicateRows,
    stats: {
      rowsImported,
      cleanContacts: cleanContacts.length,
      duplicatesRemoved: duplicateRows.length,
      badRowsRejected: rejectedRows.length,
      emailReadyContacts: cleanContacts.filter((contact) => contact.email).length,
      smsReadyContacts: cleanContacts.filter((contact) => contact.phone).length,
      facebookReadyContacts: cleanContacts.filter((contact) => contact.email || contact.phone).length,
    },
  };
}

function loadImportHistory() {
  try {
    return JSON.parse(localStorage.getItem(IMPORT_HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveImportHistory(history) {
  localStorage.setItem(IMPORT_HISTORY_KEY, JSON.stringify(history));
}

function TableShell({ children }) {
  return <div style={{ overflowX: "auto" }}>{children}</div>;
}

function Modal({ title, children, onClose }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "grid",
        placeItems: "center",
        padding: 18,
        background: "rgba(15, 23, 42, 0.48)",
      }}
    >
      <div className="panel" style={{ width: "min(760px, 100%)", maxHeight: "88vh", overflow: "auto" }}>
        <div className="panel__header">
          <div>
            <div className="eyebrow">Customer Database</div>
            <h3>{title}</h3>
          </div>
          <button type="button" className="button button--ghost" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ContactForm({ form, setForm, error, onSubmit, submitLabel }) {
  return (
    <form onSubmit={onSubmit} className="field-grid">
      <label className="field">
        <span className="field__label">First name</span>
        <input
          className="field__input"
          value={form.firstName}
          onChange={(event) => updateFormValue(setForm, "firstName", event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">Last name</span>
        <input
          className="field__input"
          value={form.lastName}
          onChange={(event) => updateFormValue(setForm, "lastName", event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">Email</span>
        <input
          className="field__input"
          value={form.email}
          onChange={(event) => updateFormValue(setForm, "email", event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">Mobile</span>
        <input
          className="field__input"
          value={form.phone}
          onChange={(event) => updateFormValue(setForm, "phone", event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">Postcode</span>
        <input
          className="field__input"
          value={form.postcode}
          onChange={(event) => updateFormValue(setForm, "postcode", event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">Company</span>
        <input
          className="field__input"
          value={form.company}
          onChange={(event) => updateFormValue(setForm, "company", event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field__label">Pipeline</span>
        <select
          className="field__input"
          value={form.pipeline}
          onChange={(event) => updateFormValue(setForm, "pipeline", event.target.value)}
        >
          {PIPELINE_OPTIONS.map((pipeline) => (
            <option key={pipeline} value={pipeline}>
              {pipelineLabels[pipeline]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field__label">Source</span>
        <select
          className="field__input"
          value={form.source}
          onChange={(event) => updateFormValue(setForm, "source", event.target.value)}
        >
          {SOURCE_OPTIONS.map((source) => (
            <option key={source} value={source}>
              {sourceLabels[source]}
            </option>
          ))}
        </select>
      </label>
      <label className="field" style={{ gridColumn: "1 / -1" }}>
        <span className="field__label">Notes</span>
        <textarea
          className="field__input"
          rows={3}
          value={form.notes}
          onChange={(event) => updateFormValue(setForm, "notes", event.target.value)}
        />
      </label>
      <div className="card-actions" style={{ gridColumn: "1 / -1" }}>
        <button type="submit" className="button button--primary">
          {submitLabel}
        </button>
      </div>
      {error ? <div className="notice notice--error" style={{ gridColumn: "1 / -1" }}>{error}</div> : null}
    </form>
  );
}

export default function CustomerDatabasePage() {
  const [result, setResult] = useState(EMPTY_RESULT);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [manualError, setManualError] = useState("");
  const [manualForm, setManualForm] = useState(EMPTY_FORM);
  const [activeFilter, setActiveFilter] = useState("all");
  const [exportScope, setExportScope] = useState("all");
  const [search, setSearch] = useState("");
  const [modalMode, setModalMode] = useState("");
  const [selectedContact, setSelectedContact] = useState(null);
  const [editingIndex, setEditingIndex] = useState(-1);
  const [importHistory, setImportHistory] = useState([]);

  useEffect(() => {
    setImportHistory(loadImportHistory());
  }, []);

  const csvExports = useMemo(
    () =>
      buildCustomerExports(
        result.cleanContacts,
        result.rejectedRows,
        result.duplicateRows,
        exportScope
      ),
    [result, exportScope]
  );
  const visibleContacts = useMemo(
    () =>
      filterContactsByPipeline(result.cleanContacts, activeFilter).filter((contact) =>
        contactMatchesSearch(contact, search)
      ),
    [result.cleanContacts, activeFilter, search]
  );
  const dashboardCards = useMemo(
    () => [
      ["Total Contacts", result.stats.cleanContacts],
      ["Finance Contacts", result.cleanContacts.filter((contact) => contact.pipeline === "finance").length],
      ["Rent2Buy Contacts", result.cleanContacts.filter((contact) => contact.pipeline === "rent2buy").length],
      ["Both", result.cleanContacts.filter((contact) => contact.pipeline === "both").length],
      ["Unknown", result.cleanContacts.filter((contact) => contact.pipeline === "unknown").length],
      ["Facebook Ready", result.stats.facebookReadyContacts],
      ["Email Ready", result.stats.emailReadyContacts],
      ["SMS Ready", result.stats.smsReadyContacts],
      ["Duplicates Removed", result.stats.duplicatesRemoved],
      ["Rejected Records", result.stats.badRowsRejected],
    ],
    [result]
  );

  async function handleFileUpload(event) {
    const file = event.target.files?.[0];
    setError("");
    setFileName(file?.name || "");

    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setResult(EMPTY_RESULT);
      setError("Upload a CSV file.");
      return;
    }

    try {
      const text = await file.text();
      const rows = parseCsv(text);
      const cleaned = cleanCustomerRows(rows);
      const entry = {
        id: `${Date.now()}-${file.name}`,
        importDate: new Date().toISOString(),
        filename: file.name,
        rowsImported: cleaned.stats.rowsImported,
        duplicates: cleaned.stats.duplicatesRemoved,
        rejected: cleaned.stats.badRowsRejected,
      };
      const nextHistory = [entry, ...importHistory].slice(0, 10);
      setResult(cleaned);
      setImportHistory(nextHistory);
      saveImportHistory(nextHistory);
    } catch (uploadError) {
      setResult(EMPTY_RESULT);
      setError(uploadError.message || "Could not read this CSV file.");
    }
  }

  function openAddModal() {
    setManualForm(EMPTY_FORM);
    setManualError("");
    setEditingIndex(-1);
    setModalMode("add");
  }

  function openEditModal(contact) {
    setManualForm({
      firstName: contact.firstName || "",
      lastName: contact.lastName || "",
      email: contact.email || "",
      phone: contact.phone || "",
      postcode: contact.postcode || "",
      company: contact.company || "",
      pipeline: contact.pipeline || "unknown",
      source: contact.source || "manual",
      notes: contact.notes || "",
    });
    setManualError("");
    setEditingIndex(result.cleanContacts.indexOf(contact));
    setModalMode("edit");
  }

  function closeModal() {
    setModalMode("");
    setSelectedContact(null);
    setEditingIndex(-1);
    setManualError("");
  }

  function handleManualSubmit(event) {
    event.preventDefault();
    const { contact, error: contactError } = cleanManualContact(manualForm);

    if (contactError) {
      setManualError(contactError);
      return;
    }

    if (editingIndex >= 0) {
      setResult((current) => {
        const currentContact = current.cleanContacts[editingIndex];
        const cleanContacts = [...current.cleanContacts];
        cleanContacts[editingIndex] = {
          ...currentContact,
          ...contact,
          created_at: currentContact.created_at,
          sourceRow: currentContact.sourceRow,
        };
        return buildResult(
          cleanContacts,
          current.rejectedRows,
          current.duplicateRows,
          current.stats.rowsImported
        );
      });
    } else {
      setResult((current) => addContactToResult(current, contact));
    }

    setManualForm(EMPTY_FORM);
    closeModal();
  }

  function handleDeleteContact(contact) {
    setResult((current) => {
      const cleanContacts = current.cleanContacts.filter((item) => item !== contact);
      return buildResult(
        cleanContacts,
        current.rejectedRows,
        current.duplicateRows,
        current.stats.rowsImported
      );
    });
  }

  return (
    <div className="page-stack" style={{ gap: 14 }}>
      <section className="hero-panel" style={{ padding: 18 }}>
        <div className="panel__header" style={{ marginBottom: 0 }}>
          <div>
            <div className="eyebrow">Customer Data</div>
            <h2>Customer Database</h2>
            <p>Upload, clean, search, manage, and export contacts from one CRM workspace.</p>
          </div>
          <div className="card-actions">
            <button type="button" className="button button--primary" onClick={openAddModal}>
              + Add Contact
            </button>
          </div>
        </div>
      </section>

      <section className="stats-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        {dashboardCards.map(([label, value]) => (
          <div key={label} className="stat-card" style={{ padding: 16, borderRadius: 18 }}>
            <div className="stat-card__label">{label}</div>
            <div className="stat-card__value" style={{ fontSize: 30 }}>{value}</div>
          </div>
        ))}
      </section>

      <section className="panel" style={{ padding: 16 }}>
        <div className="panel__header">
          <div>
            <h3>Import</h3>
            <p>Old imports default to Unknown unless a clear field says Finance or Rent2Buy.</p>
          </div>
          <label className="field" style={{ minWidth: 280 }}>
            <span className="field__label">Upload CSV</span>
            <input className="field__input" type="file" accept=".csv,text/csv" onChange={handleFileUpload} />
          </label>
        </div>
        {fileName ? <div className="notice">Loaded file: {fileName}</div> : null}
        {error ? <div className="notice notice--error">{error}</div> : null}
      </section>

      <section className="panel" style={{ padding: 16 }}>
        <div className="panel__header">
          <div>
            <h3>Contacts</h3>
            <p>{visibleContacts.length} showing from {result.stats.cleanContacts} clean contacts.</p>
          </div>
          <label className="field" style={{ minWidth: 260 }}>
            <span className="field__label">Search</span>
            <input
              className="field__input"
              placeholder="Name, email, phone, postcode, company"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>

        <div className="card-actions" style={{ marginBottom: 12 }}>
          {["all", ...PIPELINE_OPTIONS].map((pipeline) => (
            <button
              key={pipeline}
              type="button"
              className={activeFilter === pipeline ? "button button--primary" : "button button--ghost"}
              onClick={() => setActiveFilter(pipeline)}
            >
              {pipelineLabels[pipeline]}
            </button>
          ))}
        </div>

        <TableShell>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr>
                {["Name", "Email", "Phone", "Pipeline", "Source", "Postcode", "Last Updated", "Actions"].map((heading) => (
                  <th key={heading} style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #dbe2ea", color: "#475569" }}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleContacts.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 18, color: "#64748b" }}>No contacts match this view.</td>
                </tr>
              ) : (
                visibleContacts.map((contact, index) => (
                  <tr key={`${contact.email || contact.phone || contact.sourceRow}-${index}`}>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7", fontWeight: 800 }}>{contactName(contact)}</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{contact.email || "-"}</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{contact.phone || "-"}</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{pipelineLabels[contact.pipeline] || contact.pipeline}</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{sourceLabels[contact.source] || contact.source}</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{contact.postcode || "-"}</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7", whiteSpace: "nowrap" }}>{formatDate(contact.updated_at)}</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>
                      <div className="card-actions" style={{ gap: 6 }}>
                        <button type="button" className="button button--ghost" onClick={() => { setSelectedContact(contact); setModalMode("view"); }}>View</button>
                        <button type="button" className="button button--ghost" onClick={() => openEditModal(contact)}>Edit</button>
                        <button type="button" className="button button--danger" onClick={() => handleDeleteContact(contact)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableShell>
      </section>

      <section className="panel" style={{ padding: 16 }}>
        <div className="panel__header">
          <div>
            <h3>Import History</h3>
            <p>Stored locally for now.</p>
          </div>
        </div>
        <TableShell>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr>
                {["Import Date", "Filename", "Rows Imported", "Duplicates", "Rejected"].map((heading) => (
                  <th key={heading} style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid #dbe2ea", color: "#475569" }}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {importHistory.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 18, color: "#64748b" }}>No imports yet.</td></tr>
              ) : (
                importHistory.map((item) => (
                  <tr key={item.id}>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{formatDate(item.importDate)}</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{item.filename}</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{item.rowsImported}</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{item.duplicates}</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid #eef2f7" }}>{item.rejected}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableShell>
      </section>

      <section className="panel" style={{ padding: 16 }}>
        <div className="panel__header">
          <div>
            <h3>Export Centre</h3>
            <p>Grouped exports for audience uploads and reports.</p>
          </div>
          <label className="field" style={{ minWidth: 220 }}>
            <span className="field__label">Report scope</span>
            <select className="field__input" value={exportScope} onChange={(event) => setExportScope(event.target.value)}>
              {["all", ...PIPELINE_OPTIONS].map((pipeline) => (
                <option key={pipeline} value={pipeline}>{pipelineLabels[pipeline]}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="card-grid">
          {exportGroups.map((group) => (
            <div key={group.title} className="panel panel--nested" style={{ boxShadow: "none" }}>
              <h3 style={{ marginTop: 0 }}>{group.title}</h3>
              <div className="card-actions">
                {group.buttons.map(([label, key, filename]) => (
                  <button
                    key={key}
                    type="button"
                    className="button button--ghost"
                    disabled={!result.stats.rowsImported}
                    onClick={() => downloadCsv(filename, csvExports[key])}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel" style={{ padding: 16 }}>
        <div className="panel__header">
          <div>
            <h3>Reports Preview</h3>
            <p>Rejected records and duplicates remain available for review.</p>
          </div>
        </div>
        <div className="card-grid">
          <div className="panel panel--nested" style={{ boxShadow: "none" }}>
            <h3 style={{ marginTop: 0 }}>Rejected Rows</h3>
            <TableShell>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <tbody>
                  {result.rejectedRows.slice(0, 5).map((row, index) => (
                    <tr key={`rejected-${index}`}>
                      <td style={{ padding: 8, borderBottom: "1px solid #eef2f7" }}>{row._rowNumber}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #eef2f7" }}>{row.rejectionReason}</td>
                    </tr>
                  ))}
                  {result.rejectedRows.length === 0 ? <tr><td style={{ padding: 12, color: "#64748b" }}>No rejected rows.</td></tr> : null}
                </tbody>
              </table>
            </TableShell>
          </div>
          <div className="panel panel--nested" style={{ boxShadow: "none" }}>
            <h3 style={{ marginTop: 0 }}>Duplicates</h3>
            <TableShell>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <tbody>
                  {result.duplicateRows.slice(0, 5).map((row, index) => (
                    <tr key={`duplicate-${index}`}>
                      <td style={{ padding: 8, borderBottom: "1px solid #eef2f7" }}>{row.email || row.phone}</td>
                      <td style={{ padding: 8, borderBottom: "1px solid #eef2f7" }}>{row.duplicateReason}</td>
                    </tr>
                  ))}
                  {result.duplicateRows.length === 0 ? <tr><td style={{ padding: 12, color: "#64748b" }}>No duplicates.</td></tr> : null}
                </tbody>
              </table>
            </TableShell>
          </div>
        </div>
      </section>

      {(modalMode === "add" || modalMode === "edit") ? (
        <Modal title={modalMode === "edit" ? "Edit Contact" : "Add Contact"} onClose={closeModal}>
          <ContactForm
            form={manualForm}
            setForm={setManualForm}
            error={manualError}
            onSubmit={handleManualSubmit}
            submitLabel={modalMode === "edit" ? "Save Contact" : "Add Contact"}
          />
        </Modal>
      ) : null}

      {modalMode === "view" && selectedContact ? (
        <Modal title="Customer Profile" onClose={closeModal}>
          <div className="field-grid">
            {[
              ["Name", contactName(selectedContact)],
              ["Email", selectedContact.email || "-"],
              ["Phone", selectedContact.phone || "-"],
              ["Postcode", selectedContact.postcode || "-"],
              ["Pipeline", pipelineLabels[selectedContact.pipeline] || selectedContact.pipeline],
              ["Source", sourceLabels[selectedContact.source] || selectedContact.source],
              ["Created", formatDate(selectedContact.created_at)],
              ["Updated", formatDate(selectedContact.updated_at)],
            ].map(([label, value]) => (
              <div key={label} className="field">
                <span className="field__label">{label}</span>
                <div className="field__input">{value}</div>
              </div>
            ))}
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="field__label">Notes</span>
              <div className="field__input" style={{ minHeight: 84, whiteSpace: "pre-line" }}>
                {selectedContact.notes || "-"}
              </div>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
