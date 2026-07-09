import { useMemo, useState } from "react";
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
  pipeline: "unknown",
  source: "manual",
  notes: "",
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
  wix: "Wix",
  supabase: "Supabase",
  facebook: "Facebook",
  crm: "CRM",
  other: "Other",
};

const statCards = [
  ["Rows imported", "rowsImported"],
  ["Clean contacts", "cleanContacts"],
  ["Duplicates removed", "duplicatesRemoved"],
  ["Bad rows rejected", "badRowsRejected"],
  ["Email-ready contacts", "emailReadyContacts"],
  ["SMS-ready contacts", "smsReadyContacts"],
  ["Facebook-ready contacts", "facebookReadyContacts"],
];

const scopedDownloadButtons = [
  ["Master CSV", "master", "customer-master.csv"],
  ["Facebook Audience CSV", "facebook", "facebook-audience.csv"],
  ["Email Marketing CSV", "email", "email-marketing.csv"],
  ["SMS CSV", "sms", "sms-contacts.csv"],
  ["Rejected Rows CSV", "rejected", "rejected-rows.csv"],
  ["Duplicate Report CSV", "duplicates", "duplicate-report.csv"],
];

const productDownloadButtons = [
  ["Finance Facebook CSV", "financeFacebook", "finance-facebook-audience.csv"],
  ["Rent2Buy Facebook CSV", "rent2buyFacebook", "rent2buy-facebook-audience.csv"],
  ["Full Facebook CSV", "fullFacebook", "full-facebook-audience.csv"],
  ["Finance Email CSV", "financeEmail", "finance-email.csv"],
  ["Rent2Buy Email CSV", "rent2buyEmail", "rent2buy-email.csv"],
  ["Finance SMS CSV", "financeSms", "finance-sms.csv"],
  ["Rent2Buy SMS CSV", "rent2buySms", "rent2buy-sms.csv"],
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

function PreviewTable({ title, rows, columns, emptyText }) {
  return (
    <section className="panel">
      <div className="panel__header">
        <div>
          <h3>{title}</h3>
          <p>Showing the first 10 rows.</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">{emptyText}</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    style={{
                      textAlign: "left",
                      padding: "10px 8px",
                      borderBottom: "1px solid #dbe2ea",
                      color: "#475569",
                    }}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 10).map((row, index) => (
                <tr key={`${title}-${index}`}>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      style={{
                        padding: "10px 8px",
                        borderBottom: "1px solid #eef2f7",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {row[column.key] || ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
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

  const exports = useMemo(
    () =>
      buildCustomerExports(
        result.cleanContacts,
        result.rejectedRows,
        result.duplicateRows,
        exportScope
      ),
    [result, exportScope]
  );
  const filteredContacts = useMemo(
    () => filterContactsByPipeline(result.cleanContacts, activeFilter),
    [result.cleanContacts, activeFilter]
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
      setResult(cleanCustomerRows(rows));
    } catch (uploadError) {
      setResult(EMPTY_RESULT);
      setError(uploadError.message || "Could not read this CSV file.");
    }
  }

  function handleManualSubmit(event) {
    event.preventDefault();
    const { contact, error: contactError } = cleanManualContact(manualForm);

    if (contactError) {
      setManualError(contactError);
      return;
    }

    setResult((current) => addContactToResult(current, contact));
    setManualForm(EMPTY_FORM);
    setManualError("");
  }

  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div>
          <div className="eyebrow">Customer Data</div>
          <h2>Customer Database</h2>
          <p>
            Upload a CSV or add contacts manually. Contacts stay in this browser for now and
            are structured ready for future Supabase storage with pipeline, source, notes,
            created_at, updated_at, and last_seen_at fields.
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Upload CSV</h3>
            <p>
              Old imports default to Unknown unless a clear product, source, status, or lead
              type field says Finance or Rent2Buy.
            </p>
          </div>
        </div>

        <input className="field__input" type="file" accept=".csv,text/csv" onChange={handleFileUpload} />
        {fileName ? <div className="notice">Loaded file: {fileName}</div> : null}
        {error ? <div className="notice notice--error">{error}</div> : null}
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Add Contact</h3>
            <p>Use this for manual Finance, Rent2Buy, Both, or Unknown contacts.</p>
          </div>
        </div>

        <form onSubmit={handleManualSubmit} className="field-grid">
          <label className="field">
            <span className="field__label">First name</span>
            <input
              className="field__input"
              value={manualForm.firstName}
              onChange={(event) => updateFormValue(setManualForm, "firstName", event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">Last name</span>
            <input
              className="field__input"
              value={manualForm.lastName}
              onChange={(event) => updateFormValue(setManualForm, "lastName", event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">Email</span>
            <input
              className="field__input"
              value={manualForm.email}
              onChange={(event) => updateFormValue(setManualForm, "email", event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">Mobile</span>
            <input
              className="field__input"
              value={manualForm.phone}
              onChange={(event) => updateFormValue(setManualForm, "phone", event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">Postcode</span>
            <input
              className="field__input"
              value={manualForm.postcode}
              onChange={(event) => updateFormValue(setManualForm, "postcode", event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">Pipeline</span>
            <select
              className="field__input"
              value={manualForm.pipeline}
              onChange={(event) => updateFormValue(setManualForm, "pipeline", event.target.value)}
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
              value={manualForm.source}
              onChange={(event) => updateFormValue(setManualForm, "source", event.target.value)}
            >
              {SOURCE_OPTIONS.map((source) => (
                <option key={source} value={source}>
                  {sourceLabels[source]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Notes</span>
            <textarea
              className="field__input"
              rows={3}
              value={manualForm.notes}
              onChange={(event) => updateFormValue(setManualForm, "notes", event.target.value)}
            />
          </label>
          <div className="card-actions" style={{ gridColumn: "1 / -1" }}>
            <button type="submit" className="button button--primary">
              Add Contact
            </button>
          </div>
        </form>

        {manualError ? <div className="notice notice--error">{manualError}</div> : null}
      </section>

      <section className="stats-grid">
        {statCards.map(([label, key]) => (
          <div key={key} className="stat-card">
            <div className="stat-card__label">{label}</div>
            <div className="stat-card__value">{result.stats[key]}</div>
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Filters</h3>
            <p>Preview contacts by pipeline.</p>
          </div>
        </div>

        <div className="card-actions">
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
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Downloads</h3>
            <p>
              General downloads use the selected export scope. Product downloads always use
              the named Finance or Rent2Buy audience.
            </p>
          </div>
          <label className="field" style={{ minWidth: 220 }}>
            <span className="field__label">Export scope</span>
            <select
              className="field__input"
              value={exportScope}
              onChange={(event) => setExportScope(event.target.value)}
            >
              {["all", ...PIPELINE_OPTIONS].map((pipeline) => (
                <option key={pipeline} value={pipeline}>
                  {pipelineLabels[pipeline]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="card-actions">
          {scopedDownloadButtons.map(([label, key, filename]) => (
            <button
              key={key}
              type="button"
              className="button button--primary"
              disabled={!result.stats.rowsImported}
              onClick={() => downloadCsv(filename, exports[key])}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="card-actions" style={{ marginTop: 12 }}>
          {productDownloadButtons.map(([label, key, filename]) => (
            <button
              key={key}
              type="button"
              className="button button--ghost"
              disabled={!result.stats.rowsImported}
              onClick={() => downloadCsv(filename, exports[key])}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <PreviewTable
        title={`Clean contacts preview - ${pipelineLabels[activeFilter]}`}
        rows={filteredContacts}
        emptyText="No clean contacts for this filter yet."
        columns={[
          { key: "firstName", label: "First name" },
          { key: "lastName", label: "Last name" },
          { key: "email", label: "Email" },
          { key: "phone", label: "Phone" },
          { key: "postcode", label: "Postcode" },
          { key: "pipeline", label: "Pipeline" },
          { key: "source", label: "Source" },
        ]}
      />

      <PreviewTable
        title="Rejected rows preview"
        rows={result.rejectedRows}
        emptyText="No rejected rows yet."
        columns={[
          { key: "_rowNumber", label: "Source row" },
          { key: "rejectionReason", label: "Reason" },
        ]}
      />

      <PreviewTable
        title="Duplicates preview"
        rows={result.duplicateRows}
        emptyText="No duplicates yet."
        columns={[
          { key: "sourceRow", label: "Source row" },
          { key: "email", label: "Email" },
          { key: "phone", label: "Phone" },
          { key: "pipeline", label: "Pipeline" },
          { key: "mergedPipeline", label: "Merged pipeline" },
          { key: "duplicateReason", label: "Reason" },
        ]}
      />
    </div>
  );
}
