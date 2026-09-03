import fs from "node:fs";
import { fileURLToPath } from "node:url";

const targetUrl = new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url);
const targetPath = fileURLToPath(targetUrl);
let source = fs.readFileSync(targetPath, "utf8");

function replaceOnce(before, after, label) {
  const first = source.indexOf(before);
  if (first === -1) throw new Error(`Rent2Buy reserved Wix Stock Watch transform could not find: ${label}`);
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Rent2Buy reserved Wix Stock Watch transform found duplicate anchor: ${label}`);
  }
  source = source.replace(before, after);
}

if (!source.includes('from "../services/rent2buyReservedWixStock.js"')) {
  replaceOnce(
`import {
  previewReservedCarWixStock,
  unpublishReservedCarWixStock,
} from "../services/carReservedWixStock.js";`,
`import {
  previewReservedCarWixStock,
  unpublishReservedCarWixStock,
} from "../services/carReservedWixStock.js";
import {
  previewReservedRent2BuyWixStock,
  unpublishReservedRent2BuyWixStock,
} from "../services/rent2buyReservedWixStock.js";`,
    "Car Wix service import"
  );

  replaceOnce(
`  const [carWixActionError, setCarWixActionError] = useState("");

  useEffect(() => {`,
`  const [carWixActionError, setCarWixActionError] = useState("");
  const [rentWixPreview, setRentWixPreview] = useState(null);
  const [rentWixChecking, setRentWixChecking] = useState(false);
  const [rentWixDrafting, setRentWixDrafting] = useState(false);
  const [rentWixDraftResult, setRentWixDraftResult] = useState(null);
  const [rentWixActionError, setRentWixActionError] = useState("");

  useEffect(() => {`,
    "WatchCard Rent2Buy Wix state"
  );

  replaceOnce(
`    setCarWixActionError("");
  }, [record.id, record.notes, record.workflowStatus, record.displayStatus]);`,
`    setCarWixActionError("");
    setRentWixPreview(null);
    setRentWixChecking(false);
    setRentWixDrafting(false);
    setRentWixDraftResult(null);
    setRentWixActionError("");
  }, [record.id, record.notes, record.workflowStatus, record.displayStatus]);`,
    "WatchCard Rent2Buy Wix reset"
  );

  replaceOnce(
`  const status = workflowStatusOf(record);`,
`  async function checkRent2BuyWixCollections() {
    setRentWixChecking(true);
    setRentWixActionError("");
    setRentWixDraftResult(null);
    try {
      const result = await previewReservedRent2BuyWixStock(record.registration);
      setRentWixPreview(result);
    } catch (error) {
      setRentWixActionError(error?.message || "Could not check Rent2Buy Wix collections.");
    } finally {
      setRentWixChecking(false);
    }
  }

  async function moveRent2BuyWixMatchesToDraft() {
    setRentWixDrafting(true);
    setRentWixActionError("");
    try {
      const result = await unpublishReservedRent2BuyWixStock(record.registration);
      setRentWixDraftResult(result);
      const refreshed = await previewReservedRent2BuyWixStock(record.registration);
      setRentWixPreview(refreshed);
    } catch (error) {
      setRentWixActionError(error?.message || "Could not move Rent2Buy listing records to Draft.");
    } finally {
      setRentWixDrafting(false);
    }
  }

  const status = workflowStatusOf(record);`,
    "WatchCard Rent2Buy Wix functions"
  );

  replaceOnce(
`  const showCarReservedWix = selectedPipeline === "cars" && record.displayStatus === "reserved" && Boolean(normalizeWatchRegistration(record.registration));`,
`  const showCarReservedWix = selectedPipeline === "cars" && record.displayStatus === "reserved" && Boolean(normalizeWatchRegistration(record.registration));
  const showRent2BuyReservedWix = selectedPipeline === "rent2buy" && record.displayStatus === "reserved" && Boolean(normalizeWatchRegistration(record.registration));`,
    "WatchCard Rent2Buy reserved flag"
  );

  replaceOnce(
`        {record.displayStatus === "back_in_stock" ? <div className="vehicle-card__meta">This was hidden before, but Vansco now shows it as available/unknown again.</div> : null}`,
`        {showRent2BuyReservedWix ? (
          <div style={{ marginTop: 4, border: "1px solid #fecaca", borderRadius: 12, padding: 10, background: "#fff7f7", display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 900, fontSize: 12, color: "#991b1b" }}>Rent2Buy Wix stock check</div>
            <div className="vehicle-card__meta">Read-only first: check this registration across all nine Rent2Buy listing/category collections on both Wix mirrors.</div>
            {!rentWixPreview ? (
              <button className="button button--primary" type="button" onClick={checkRent2BuyWixCollections} disabled={rentWixChecking || rentWixDrafting}>
                {rentWixChecking ? "Checking both Wix sites..." : "Check Rent2Buy Wix collections"}
              </button>
            ) : (
              <>
                <div style={{ display: "grid", gap: 8 }}>
                  {(rentWixPreview.sites || []).map((site) => (
                    <div key={site.id} style={{ border: "1px solid #e5e7eb", borderRadius: 9, padding: 7, background: "#ffffff", display: "grid", gap: 4 }}>
                      <div style={{ fontSize: 10, fontWeight: 900, color: "#374151" }}>{site.label}</div>
                      {site.error ? <div style={{ fontSize: 10, color: "#b45309", fontWeight: 800 }}>SITE CHECK FAILED: {site.error}</div> : null}
                      {(site.collections || []).map((collection) => (
                        <div key={site.id + "-" + collection.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", fontSize: 10, padding: "3px 5px", borderRadius: 6, background: collection.protected ? "#111827" : collection.live ? "#fee2e2" : "#f8fafc", color: collection.protected ? "#ffffff" : "inherit" }}>
                          <span style={{ fontWeight: 800 }}>{collection.label}</span>
                          <span style={{ color: collection.protected ? "#ffffff" : collection.error ? "#b45309" : collection.live ? "#b91c1c" : "#64748b", fontWeight: 900 }}>
                            {collection.error ? "CHECK FAILED" : collection.protected ? (collection.live ? "LIVE • PROTECTED" : "PROTECTED") : collection.live ? ("LIVE" + (collection.matches?.length > 1 ? " × " + collection.matches.length : "")) : "Not live"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div style={{ borderRadius: 8, padding: "7px 8px", background: "#111827", color: "#ffffff", fontSize: 10, lineHeight: 1.4 }}>
                  <strong>VAN PAGES is HARD PROTECTED on both Wix sites.</strong> Full Rent2Buy vehicle pages remain live for existing Google/indexed links. This action can only move the nine listing/category collections to Draft.
                </div>
                {(rentWixPreview.matches || []).length > 0 ? (
                  <button className="button button--primary" type="button" onClick={moveRent2BuyWixMatchesToDraft} disabled={rentWixDrafting || rentWixChecking}>
                    {rentWixDrafting ? "Moving Rent2Buy listings to Draft..." : ("Set " + (rentWixPreview.matches || []).length + " live Rent2Buy listing record" + ((rentWixPreview.matches || []).length === 1 ? "" : "s") + " to Draft")}
                  </button>
                ) : (
                  <div className="vehicle-card__meta">No live listing/category matches remain on either Wix site. VAN PAGES stays protected.</div>
                )}
                <button className="button button--ghost" type="button" onClick={checkRent2BuyWixCollections} disabled={rentWixChecking || rentWixDrafting}>
                  {rentWixChecking ? "Rechecking both sites..." : "Recheck Rent2Buy collections"}
                </button>
              </>
            )}
            {rentWixDraftResult ? (
              <div style={{ borderRadius: 8, padding: "7px 8px", background: rentWixDraftResult.ok ? "#ecfdf5" : "#fff7ed", color: rentWixDraftResult.ok ? "#047857" : "#9a3412", fontSize: 10, lineHeight: 1.45, fontWeight: 800 }}>
                {rentWixDraftResult.message || ((rentWixDraftResult.changed || 0) + " Rent2Buy listing record(s) moved to Draft. VAN PAGES remained protected.")}
                {(rentWixDraftResult.results || []).length ? (" " + rentWixDraftResult.results.map((item) => (item.siteLabel || item.siteId) + " / " + item.collectionLabel + ": " + (item.ok ? "Draft ✓" : "Failed")).join(" · ")) : ""}
              </div>
            ) : null}
            {rentWixActionError ? <div style={{ borderRadius: 8, padding: "7px 8px", background: "#fff7ed", color: "#9a3412", fontSize: 10, lineHeight: 1.45, fontWeight: 800 }}>{rentWixActionError}</div> : null}
          </div>
        ) : null}
        {record.displayStatus === "back_in_stock" ? <div className="vehicle-card__meta">This was hidden before, but Vansco now shows it as available/unknown again.</div> : null}`,
    "WatchCard Rent2Buy Wix UI"
  );
}

fs.writeFileSync(targetPath, source);
console.log("Applied dual-site Rent2Buy reserved Wix Stock Watch controls with VAN PAGES hard protection.");
