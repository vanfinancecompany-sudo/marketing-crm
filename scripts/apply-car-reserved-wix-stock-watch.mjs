import fs from "node:fs";
import { fileURLToPath } from "node:url";

const targetUrl = new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url);
const targetPath = fileURLToPath(targetUrl);
let source = fs.readFileSync(targetPath, "utf8");

function replaceOnce(before, after, label) {
  const first = source.indexOf(before);
  if (first === -1) throw new Error(`Car reserved Wix Stock Watch transform could not find: ${label}`);
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Car reserved Wix Stock Watch transform found duplicate anchor: ${label}`);
  }
  source = source.replace(before, after);
}

if (!source.includes('from "../services/carReservedWixStock.js"')) {
  replaceOnce(
`import {
  previewReservedFinanceWixStock,
  unpublishReservedFinanceWixStock,
} from "../services/financeReservedWixStock.js";`,
`import {
  previewReservedFinanceWixStock,
  unpublishReservedFinanceWixStock,
} from "../services/financeReservedWixStock.js";
import {
  previewReservedCarWixStock,
  unpublishReservedCarWixStock,
} from "../services/carReservedWixStock.js";`,
    "Finance Wix service import"
  );

  replaceOnce(
`  const [wixActionError, setWixActionError] = useState("");

  useEffect(() => {`,
`  const [wixActionError, setWixActionError] = useState("");
  const [carWixPreview, setCarWixPreview] = useState(null);
  const [carWixChecking, setCarWixChecking] = useState(false);
  const [carWixDrafting, setCarWixDrafting] = useState(false);
  const [carWixDraftResult, setCarWixDraftResult] = useState(null);
  const [carWixActionError, setCarWixActionError] = useState("");

  useEffect(() => {`,
    "WatchCard car Wix state"
  );

  replaceOnce(
`    setWixActionError("");
  }, [record.id, record.notes, record.workflowStatus, record.displayStatus]);`,
`    setWixActionError("");
    setCarWixPreview(null);
    setCarWixChecking(false);
    setCarWixDrafting(false);
    setCarWixDraftResult(null);
    setCarWixActionError("");
  }, [record.id, record.notes, record.workflowStatus, record.displayStatus]);`,
    "WatchCard car Wix reset"
  );

  replaceOnce(
`  const status = workflowStatusOf(record);`,
`  async function checkCarWixCollections() {
    setCarWixChecking(true);
    setCarWixActionError("");
    setCarWixDraftResult(null);
    try {
      const result = await previewReservedCarWixStock(record.registration);
      setCarWixPreview(result);
    } catch (error) {
      setCarWixActionError(error?.message || "Could not check car Wix collections.");
    } finally {
      setCarWixChecking(false);
    }
  }

  async function moveCarWixMatchesToDraft() {
    setCarWixDrafting(true);
    setCarWixActionError("");
    try {
      const result = await unpublishReservedCarWixStock(record.registration);
      setCarWixDraftResult(result);
      const refreshed = await previewReservedCarWixStock(record.registration);
      setCarWixPreview(refreshed);
    } catch (error) {
      setCarWixActionError(error?.message || "Could not move car Wix records to draft.");
    } finally {
      setCarWixDrafting(false);
    }
  }

  const status = workflowStatusOf(record);`,
    "WatchCard car Wix functions"
  );

  replaceOnce(
`  const showFinanceReservedWix = selectedPipeline === "finance" && record.displayStatus === "reserved" && Boolean(normalizeWatchRegistration(record.registration));`,
`  const showFinanceReservedWix = selectedPipeline === "finance" && record.displayStatus === "reserved" && Boolean(normalizeWatchRegistration(record.registration));
  const showCarReservedWix = selectedPipeline === "cars" && record.displayStatus === "reserved" && Boolean(normalizeWatchRegistration(record.registration));`,
    "WatchCard car reserved flag"
  );

  replaceOnce(
`        {record.displayStatus === "back_in_stock" ? <div className="vehicle-card__meta">This was hidden before, but Vansco now shows it as available/unknown again.</div> : null}`,
`        {showCarReservedWix ? (
          <div style={{ marginTop: 4, border: "1px solid #bfdbfe", borderRadius: 12, padding: 10, background: "#eff6ff", display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 900, fontSize: 12, color: "#1d4ed8" }}>Car Wix stock check</div>
            <div className="vehicle-card__meta">Read-only first: check this registration in the two approved car collections shared by Van Finance Company and Car Finance Company.</div>
            {!carWixPreview ? (
              <button className="button button--primary" type="button" onClick={checkCarWixCollections} disabled={carWixChecking || carWixDrafting}>
                {carWixChecking ? "Checking Wix..." : "Check car Wix collections"}
              </button>
            ) : (
              <>
                <div style={{ display: "grid", gap: 4 }}>
                  {(carWixPreview.collections || []).map((collection) => (
                    <div key={collection.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", fontSize: 11, padding: "4px 6px", borderRadius: 7, background: collection.live ? "#dbeafe" : "#f8fafc" }}>
                      <span style={{ fontWeight: 800 }}>{collection.label}</span>
                      <span style={{ color: collection.error ? "#b45309" : collection.live ? "#1d4ed8" : "#64748b", fontWeight: 900 }}>
                        {collection.error ? "CHECK FAILED" : collection.live ? ("LIVE" + (collection.matches?.length > 1 ? " × " + collection.matches.length : "")) : "Not live"}
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ borderRadius: 8, padding: "7px 8px", background: "#111827", color: "#ffffff", fontSize: 10, lineHeight: 1.4 }}>
                  <strong>CAR-ONLY SAFETY.</strong> This action can only change <strong>CARFINANCE</strong> and <strong>CARPAGES</strong>. Van Finance van collections and Rent2Buy collections are outside the allowlist.
                </div>
                {(carWixPreview.matches || []).length > 0 ? (
                  <button className="button button--primary" type="button" onClick={moveCarWixMatchesToDraft} disabled={carWixDrafting || carWixChecking}>
                    {carWixDrafting ? "Moving to Draft..." : ("Set " + (carWixPreview.matches || []).length + " live car record" + ((carWixPreview.matches || []).length === 1 ? "" : "s") + " to Draft")}
                  </button>
                ) : (
                  <div className="vehicle-card__meta">No live matches remain in the approved car stock collections.</div>
                )}
                <button className="button button--ghost" type="button" onClick={checkCarWixCollections} disabled={carWixChecking || carWixDrafting}>
                  {carWixChecking ? "Rechecking..." : "Recheck car collections"}
                </button>
              </>
            )}
            {carWixDraftResult ? (
              <div style={{ borderRadius: 8, padding: "7px 8px", background: carWixDraftResult.ok ? "#ecfdf5" : "#fff7ed", color: carWixDraftResult.ok ? "#047857" : "#9a3412", fontSize: 10, lineHeight: 1.45, fontWeight: 800 }}>
                {carWixDraftResult.message || ((carWixDraftResult.changed || 0) + " car record(s) moved to draft.")}
                {(carWixDraftResult.results || []).length ? (" " + carWixDraftResult.results.map((item) => item.collectionLabel + ": " + (item.ok ? "Draft ✓" : "Failed")).join(" · ")) : ""}
              </div>
            ) : null}
            {carWixActionError ? <div style={{ borderRadius: 8, padding: "7px 8px", background: "#fff7ed", color: "#9a3412", fontSize: 10, lineHeight: 1.45, fontWeight: 800 }}>{carWixActionError}</div> : null}
          </div>
        ) : null}
        {record.displayStatus === "back_in_stock" ? <div className="vehicle-card__meta">This was hidden before, but Vansco now shows it as available/unknown again.</div> : null}`,
    "WatchCard car Wix UI"
  );
}

fs.writeFileSync(targetPath, source);
console.log("Applied Car reserved Wix Stock Watch controls.");
