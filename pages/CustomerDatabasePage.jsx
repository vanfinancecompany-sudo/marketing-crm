import { useMemo, useState } from "react";
import {
  buildCustomerExports,
  cleanCustomerRows,
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

const statCards = [
  ["Rows imported", "rowsImported"],
  ["Clean contacts", "cleanContacts"],
  ["Duplicates removed", "duplicatesRemoved"],
  ["Bad rows rejected", "badRowsRejected"],
  ["Email-ready contacts", "emailReadyContacts"],
  ["SMS-ready contacts", "smsReadyContacts"],
  ["Facebook-ready contacts", "facebookReadyContacts"],
];

const downloadButtons = [
  ["Master CSV", "master", "customer-master.csv"],
  ["Facebook Audience CSV", "facebook", "facebook-audience.csv"],
  ["Email Marketing CSV", "email", "email-marketing.csv"],
  ["SMS CSV", "sms", "sms-contacts.csv"],
  ["Rejected Rows CSV", "rejected", "rejected-rows.csv"],
  ["Duplicate Report CSV", "duplicates", "duplicate-report.csv"],
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

  const exports = useMemo(
    () => buildCustomerExports(result.cleanContacts, result.rejectedRows, result.duplicateRows),
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
      setResult(cleanCustomerRows(rows));
    } catch (uploadError) {
      setResult(EMPTY_RESULT);
      setError(uploadError.message || "Could not read this CSV file.");
    }
  }

  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div>
          <div className="eyebrow">Customer Data</div>
          <h2>Customer Database</h2>
          <p>
            Upload a CSV to clean customer contact data in your browser and prepare safe
            exports for Facebook, email, and SMS audiences.
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Upload CSV</h3>
            <p>No data is saved yet. Cleaning and downloads run locally in this browser.</p>
          </div>
        </div>

        <input className="field__input" type="file" accept=".csv,text/csv" onChange={handleFileUpload} />
        {fileName ? <div className="notice">Loaded file: {fileName}</div> : null}
        {error ? <div className="notice notice--error">{error}</div> : null}
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
            <h3>Downloads</h3>
            <p>Exports use cleaned contacts only, with separate reports for rejects and duplicates.</p>
          </div>
        </div>

        <div className="card-actions">
          {downloadButtons.map(([label, key, filename]) => (
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
      </section>

      <PreviewTable
        title="Clean contacts preview"
        rows={result.cleanContacts}
        emptyText="No clean contacts yet."
        columns={[
          { key: "firstName", label: "First name" },
          { key: "lastName", label: "Last name" },
          { key: "email", label: "Email" },
          { key: "phone", label: "Phone" },
          { key: "postcode", label: "Postcode" },
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
          { key: "duplicateReason", label: "Reason" },
        ]}
      />
    </div>
  );
}
