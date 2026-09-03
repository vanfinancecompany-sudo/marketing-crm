import fs from "node:fs";
import { fileURLToPath } from "node:url";

const targetUrl = new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url);
const targetPath = fileURLToPath(targetUrl);
let source = fs.readFileSync(targetPath, "utf8");

function replaceOnce(before, after, label) {
  const first = source.indexOf(before);
  if (first === -1) throw new Error(`Finance reserved Wix Stock Watch transform could not find: ${label}`);
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Finance reserved Wix Stock Watch transform found duplicate anchor: ${label}`);
  }
  source = source.replace(before, after);
}

if (!source.includes('from "../services/financeReservedWixStock.js"')) {
  replaceOnce(
`import {
  fetchVanscoCacheRecords,
  processVanscoCacheBatch,
  refreshVanscoCacheUrls,
  saveVanscoWatchAction,
} from "../services/vanscoStockCache.js";`,
`import {
  fetchVanscoCacheRecords,
  processVanscoCacheBatch,
  refreshVanscoCacheUrls,
  saveVanscoWatchAction,
} from "../services/vanscoStockCache.js";
import {
  previewReservedFinanceWixStock,
  unpublishReservedFinanceWixStock,
} from "../services/financeReservedWixStock.js";`,
    "Vansco cache import"
  );

  replaceOnce(
`  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {`,
`  const [saveMessage, setSaveMessage] = useState("");
  const [wixPreview, setWixPreview] = useState(null);
  const [wixChecking, setWixChecking] = useState(false);
  const [wixDrafting, setWixDrafting] = useState(false);
  const [wixDraftResult, setWixDraftResult] = useState(null);
  const [wixActionError, setWixActionError] = useState("");

  useEffect(() => {`,
    "WatchCard state"
  );

  replaceOnce(
`    setSavingAction("");
  }, [record.id, record.notes, record.workflowStatus, record.displayStatus]);`,
`    setSavingAction("");
    setWixPreview(null);
    setWixChecking(false);
    setWixDrafting(false);
    setWixDraftResult(null);
    setWixActionError("");
  }, [record.id, record.notes, record.workflowStatus, record.displayStatus]);`,
    "WatchCard reset"
  );

  replaceOnce(
`  const status = workflowStatusOf(record);`,
`  async function checkFinanceWixCollections() {
    setWixChecking(true);
    setWixActionError("");
    setWixDraftResult(null);
    try {
      const result = await previewReservedFinanceWixStock(record.registration);
      setWixPreview(result);
    } catch (error) {
      setWixActionError(error?.message || "Could not check Finance Wix collections.");
    } finally {
      setWixChecking(false);
    }
  }

  async function moveFinanceWixMatchesToDraft() {
    setWixDrafting(true);
    setWixActionError("");
    try {
      const result = await unpublishReservedFinanceWixStock(record.registration);
      setWixDraftResult(result);
      const refreshed = await previewReservedFinanceWixStock(record.registration);
      setWixPreview(refreshed);
    } catch (error) {
      setWixActionError(error?.message || "Could not move Finance Wix records to draft.");
    } finally {
      setWixDrafting(false);
    }
  }

  const status = workflowStatusOf(record);`,
    "WatchCard finance Wix functions"
  );

  replaceOnce(
`  const isLocalNotVansco = record.displayStatus === "local_not_vansco";`,
`  const isLocalNotVansco = record.displayStatus === "local_not_vansco";
  const showFinanceReservedWix = selectedPipeline === "finance" && record.displayStatus === "reserved" && Boolean(normalizeWatchRegistration(record.registration));`,
    "WatchCard reserved flag"
  );

  replaceOnce(
`        {record.displayStatus === "back_in_stock" ? <div className="vehicle-card__meta">This was hidden before, but Vansco now shows it as available/unknown again.</div> : null}`,
`        {showFinanceReservedWix ? (
          <div style={{ marginTop: 4, border: "1px solid #fecaca", borderRadius: 12, padding: 10, background: "#fff7f7", display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 900, fontSize: 12, color: "#991b1b" }}>Finance Wix stock check</div>
            <div className="vehicle-card__meta">Read-only first: check this registration across the nine approved Van Finance stock collections.</div>
            {!wixPreview ? (
              <button className="button button--primary" type="button" onClick={checkFinanceWixCollections} disabled={wixChecking || wixDrafting}>
                {wixChecking ? "Checking Wix..." : "Check Wix collections"}
              </button>
            ) : (
              <>
                <div style={{ display: "grid", gap: 4 }}>
                  {(wixPreview.collections || []).map((collection) => (
                    <div key={collection.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", fontSize: 11, padding: "4px 6px", borderRadius: 7, background: collection.live ? "#fee2e2" : "#f8fafc" }}>
                      <span style={{ fontWeight: 800 }}>{collection.label}</span>
                      <span style={{ color: collection.error ? "#b45309" : collection.live ? "#b91c1c" : "#64748b", fontWeight: 900 }}>
                        {collection.error ? "CHECK FAILED" : collection.live ? `LIVE${collection.matches?.length > 1 ? ` × ${collection.matches.length}` : ""}` : "Not live"}
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ borderRadius: 8, padding: "7px 8px", background: "#111827", color: "#ffffff", fontSize: 10, lineHeight: 1.4 }}>
                  <strong>VAN FINANCE PAGES</strong> is HARD PROTECTED. This Stock Watch action can never move it to draft.
                </div>
                {(wixPreview.matches || []).length > 0 ? (
                  <button className="button button--primary" type="button" onClick={moveFinanceWixMatchesToDraft} disabled={wixDrafting || wixChecking}>
                    {wixDrafting ? "Moving to Draft..." : `Set ${(wixPreview.matches || []).length} live Finance record${(wixPreview.matches || []).length === 1 ? "" : "s"} to Draft`}
                  </button>
                ) : (
                  <div className="vehicle-card__meta">No live matches remain in the approved Finance stock collections.</div>
                )}
                <button className="button button--ghost" type="button" onClick={checkFinanceWixCollections} disabled={wixChecking || wixDrafting}>
                  {wixChecking ? "Rechecking..." : "Recheck collections"}
                </button>
              </>
            )}
            {wixDraftResult ? (
              <div style={{ borderRadius: 8, padding: "7px 8px", background: wixDraftResult.ok ? "#ecfdf5" : "#fff7ed", color: wixDraftResult.ok ? "#047857" : "#9a3412", fontSize: 10, lineHeight: 1.45, fontWeight: 800 }}>
                {wixDraftResult.message || `${wixDraftResult.changed || 0} record(s) moved to draft.`}
                {(wixDraftResult.results || []).length ? ` ${wixDraftResult.results.map((item) => `${item.collectionLabel}: ${item.ok ? "Draft ✓" : "Failed"}`).join(" · ")}` : ""}
              </div>
            ) : null}
            {wixActionError ? <div style={{ borderRadius: 8, padding: "7px 8px", background: "#fff7ed", color: "#9a3412", fontSize: 10, lineHeight: 1.45, fontWeight: 800 }}>{wixActionError}</div> : null}
          </div>
        ) : null}
        {record.displayStatus === "back_in_stock" ? <div className="vehicle-card__meta">This was hidden before, but Vansco now shows it as available/unknown again.</div> : null}`,
    "WatchCard finance Wix UI"
  );
}

fs.writeFileSync(targetPath, source);
console.log("Applied Finance reserved Wix Stock Watch controls.");
