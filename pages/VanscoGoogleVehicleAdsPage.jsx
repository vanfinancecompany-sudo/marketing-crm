import { useEffect, useMemo, useState } from "react";
import { buildMarketingAccessHeaders, parseMarketingJsonResponse } from "../services/marketingAccess.js";

const ENDPOINT = "/api/vansco-google-vehicle-selection";

export default function VanscoGoogleVehicleAdsPage() {
  const [vehicles, setVehicles] = useState([]);
  const [selected, setSelected] = useState([]);
  const [savedIds, setSavedIds] = useState([]);
  const [mode, setMode] = useState("all");
  const [search, setSearch] = useState("");
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [previewOnly, setPreviewOnly] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [merchantPending, setMerchantPending] = useState([]);
  const [lastStockCheck, setLastStockCheck] = useState(null);
  const [automaticCount, setAutomaticCount] = useState(0);
  const [blockedIds, setBlockedIds] = useState([]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const unsaved = selected.slice().sort().join("|") !== savedIds.slice().sort().join("|");
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return vehicles.filter(v => (!showSelectedOnly || selectedSet.has(v.id)) && (!term || [v.id, v.title, v.storeCode].some(value => String(value || "").toLowerCase().includes(term))));
  }, [vehicles, search, selectedSet, showSelectedOnly]);

  async function load() {
    setBusy("load");
    setError("");
    try {
      const response = await fetch(ENDPOINT, { headers: buildMarketingAccessHeaders(), cache: "no-store" });
      const json = await parseMarketingJsonResponse(response, "Could not load Vansco Google vehicle stock.");
      const ids = Array.isArray(json.selectedIds) ? json.selectedIds : [];
      setVehicles(json.vehicles || []);
      setSelected(ids);
      setSavedIds(ids);
      setMode(json.mode || "all");
      setPreviewOnly(Boolean(json.previewOnly));
      setAlerts(json.alerts || []);
      setMerchantPending(json.merchantPending || []);
      setLastStockCheck(json.lastStockWatchCheckedAt || null);
      setAutomaticCount(Number(json.automaticCount || 0));
      setBlockedIds(json.blockedSoldIds || []);
      setLoaded(true);
    } catch (err) {
      setError(err.message || "Could not load Google Vehicle Ads selection.");
    } finally {
      setBusy("");
    }
  }

  useEffect(() => { load(); }, []);
  // Recheck status even when the operator leaves the page open. Do not overwrite unsaved edits.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!busy && !unsaved && loaded) load();
    }, 120_000);
    return () => window.clearInterval(timer);
  }, [busy, unsaved, loaded]);

  function setVehicle(id, checked) {
    setSelected(prev => checked ? Array.from(new Set([...prev, id])) : prev.filter(item => item !== id));
    setMessage("");
  }

  async function act(action, payload = {}) {
    if (busy || previewOnly || !loaded) return;
    if (action === "activate" && (unsaved || savedIds.length === 0)) {
      setError("Save your selected vehicles first, then activate selected-only mode.");
      return;
    }
    if (action === "activate" && !window.confirm("Activate the saved Google feed selection?")) return;
    if (action === "deactivate" && !window.confirm("Enable automatic available-stock advertising? Sold, reserved and manually blocked vehicles will remain excluded.")) return;
    if (action === "block" && !window.confirm("Block this vehicle from the Google feed until you manually restore it?")) return;
    if (action === "unblock" && !window.confirm("Restore this vehicle to automatic Google advertising if DealerKit confirms it is available?")) return;
    if (action === "remove" && !window.confirm(
      payload.reason === "sold"
        ? "Mark this van SOLD and remove it from the Google feed? You must also refresh Merchant Center."
        : "Remove this vehicle from the selected Google feed? You must then refresh Merchant Center."
    )) return;
    if (action === "confirm_merchant" && !window.confirm(
      "Only confirm after you have updated Merchant Center and checked that the removed vehicle is no longer listed. Mark this reminder complete?"
    )) return;
    setBusy(action);
    setError("");
    setMessage("");
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: buildMarketingAccessHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(action === "save" ? { action, selectedIds: selected } : { action, ...payload }),
      });
      const json = await parseMarketingJsonResponse(response, "Could not update Vansco Google Vehicle Ads.");
      setMode(json.mode || "all");
      setSavedIds(json.selectedIds || []);
      setSelected(json.selectedIds || []);
      setMerchantPending(json.merchantPending || []);
      setBlockedIds(json.blockedSoldIds || []);
      setMessage(json.message || "Saved.");
      await load();
    } catch (err) {
      setError(err.message || "Could not save the selection.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Vansco Google Vehicle Ads</h3>
            <p>Automatically include available DealerKit vehicles in Merchant Center, or switch to your saved manual vehicle selection. Finance and Rent2Buy stock is not affected.</p>
          </div>
          <button className="button button--ghost" type="button" onClick={load} disabled={Boolean(busy)}>Refresh stock</button>
        </div>
        <div className="notice" style={{ marginBottom: 14 }}>
          <strong>Google feed: {mode === "selected" ? "Saved vehicles only (manual)" : "Automatic available stock"}</strong>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            {vehicles.filter(vehicle => !vehicle.missingFromFeed).length} vehicles in the current DealerKit Google feed · {automaticCount} currently eligible for automatic inclusion · {selected.length} saved for optional manual selection.
            {previewOnly ? " Read-only preview: setup is awaiting the private selection table." : mode === "selected" ? " Your saved selection limits the feed, but sold and reserved vehicles are still excluded." : " New available vans join automatically. Sold, reserved, awaiting-delivery and blocked vans are excluded when the feed is fetched."}
            {" "}Merchant Center normally fetches this URL daily. Request Update there only when you need a faster refresh.
          </div>
        </div>
        {previewOnly ? <div className="notice" role="status" style={{ marginBottom: 12 }}>
          <strong>Read-only preview</strong> · You can browse and search the real DealerKit stock.
          Saving and activation will become available after the selection database is installed.
          No live Google inventory has been changed.
        </div> : null}
        {error ? <div className="notice notice--error" role="alert">{error}</div> : null}
        {message ? <div className="notice" role="status">{message}</div> : null}
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
          DealerKit Stock Watch: {lastStockCheck ? new Date(lastStockCheck).toLocaleString("en-GB") : "No recent check available"}.
          Status is checked every two minutes while this page is open, and when you click Refresh stock.
          A missing Google-feed vehicle is a warning, not proof of sale.
        </div>
        {alerts.length > 0 ? (
          <section role="alert" style={{ border: "2px solid #dc2626", background: "#fff1f2", borderRadius: 14, padding: 16, marginBottom: 16 }}>
            <h3 style={{ color: "#991b1b", margin: "0 0 6px" }}>ACTION REQUIRED · {alerts.length} Google vehicle stock warning{alerts.length === 1 ? "" : "s"}</h3>
            <p style={{ marginTop: 0, fontSize: 13 }}>Review the stock discrepancy. Sold and reserved vehicles are excluded from the CRM feed automatically; Merchant Center still needs to fetch the latest feed.</p>
            {alerts.map(alert => (
              <div key={alert.id} style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: "1px solid #fecaca" }}>
                <div>
                  <strong>{alert.registration || "Registration unavailable"} · {alert.title}</strong>
                  <div style={{ fontSize: 13, fontWeight: 700, color: alert.risk === "sold" ? "#b91c1c" : "#92400e" }}>
                    {alert.risk === "sold" ? "SOLD on DealerKit" : alert.risk === "reserved" ? "RESERVED / NOT AVAILABLE on DealerKit" : "MISSING FROM CURRENT GOOGLE FEED · VERIFY STATUS"}
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>Last source check: {alert.checkedAt ? new Date(alert.checkedAt).toLocaleString("en-GB") : "Unknown"}</div>
                </div>
                <button type="button" className="button button--primary" disabled={Boolean(busy) || unsaved} onClick={() => act("remove", { vehicleId: alert.id, reason: alert.risk === "sold" ? "sold" : "manual" })}>
                  Remove from Google feed
                </button>
              </div>
            ))}
          </section>
        ) : (
          <div role="status" style={{ fontSize: 13, marginBottom: 12, color: "#475569" }}>
            {mode === "selected" ? "No sold, reserved or missing warnings among your saved vehicles." : "Automatic exclusions are active for known sold, reserved and blocked vehicles."} DealerKit statuses may lag actual sales.
          </div>
        )}
        {merchantPending.length > 0 ? (
          <section role="alert" style={{ border: "2px solid #b45309", background: "#fffbeb", borderRadius: 14, padding: 16, marginBottom: 16 }}>
            <h3 style={{ margin: "0 0 6px", color: "#92400e" }}>MERCHANT CENTER UPDATE REQUIRED · {merchantPending.length} outstanding</h3>
            <p style={{ marginTop: 0, fontSize: 13 }}>
              Removed from our feed selection, but Google may still show the old catalogue until it processes an update.
              Open <a href="https://merchants.google.com/" target="_blank" rel="noopener noreferrer" style={{ fontWeight: 800 }}>Google Merchant Center ↗</a>, update the Vansco data source, verify the item is removed, then confirm here.
            </p>
            {merchantPending.map(item => (
              <div key={item.id} style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "9px 0", borderTop: "1px solid #fcd34d" }}>
                <div>
                  <strong>{item.registration || item.vehicleId} · {item.title}</strong>
                  <div style={{ fontSize: 12 }}>Removed from our selection: {new Date(item.removedAt).toLocaleString("en-GB")} · Reason: {item.reason}</div>
                </div>
                <button type="button" className="button button--primary" disabled={Boolean(busy)} onClick={() => act("confirm_merchant", { actionId: item.id })}>
                  I've verified Merchant Center
                </button>
              </div>
            ))}
          </section>
        ) : null}
        <div className="card-actions" style={{ margin: "14px 0" }}>
          <input
            className="field__input"
            type="search"
            aria-label="Search Google vehicle stock"
            placeholder="Find registration, make, model or branch"
            value={search}
            onChange={event => setSearch(event.target.value)}
            style={{ flex: "1 1 300px", maxWidth: 420 }}
          />
          <span className="status-pill">{visible.length} shown</span>
          <span className="status-pill" aria-live="polite" style={{ background: "#dbeafe", color: "#1d4ed8" }}>{mode === "selected" ? `${selected.length} manual picks` : `${automaticCount} auto eligible`}</span>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 650 }}>
            <input type="checkbox" checked={showSelectedOnly} onChange={e => setShowSelectedOnly(e.target.checked)} />
            Show selected only
          </label>
        </div>
        <p style={{ margin: "2px 0 12px", color: "#475569", fontSize: 13 }}>
          Checkboxes maintain your optional manual shortlist. In automatic mode they do not limit which available vans Google can advertise. To switch to manual mode, save your shortlist and click <strong>Use saved selection only</strong>.
        </p>
        <div className="card-actions" style={{ marginBottom: 14 }}>
          <button type="button" className="button button--ghost" disabled={Boolean(busy) || previewOnly || !loaded} onClick={() => setSelected(prev => Array.from(new Set([...prev, ...visible.map(v => v.id)])))}>Select visible</button>
          <button type="button" className="button button--ghost" disabled={Boolean(busy) || previewOnly || !loaded} onClick={() => { const remove = new Set(visible.map(v => v.id)); setSelected(prev => prev.filter(id => !remove.has(id))); }}>Clear visible</button>
          <button type="button" className="button button--primary" disabled={Boolean(busy) || previewOnly || !loaded || !unsaved} onClick={() => act("save")}>{busy === "save" ? "Saving..." : "Save selected vehicles"}</button>
          {mode === "all" ? (
            <button type="button" className="button button--primary" disabled={Boolean(busy) || previewOnly || !loaded || unsaved || !savedIds.length} onClick={() => act("activate")}>Use saved selection only</button>
          ) : (
            <button type="button" className="button button--ghost" disabled={Boolean(busy) || previewOnly || !loaded} onClick={() => act("deactivate")}>Use automatic available stock</button>
          )}
        </div>
        {unsaved ? <div className="notice" role="status"><strong>{selected.length} vans selected.</strong> Changes not saved yet. Click <strong>Save selected vehicles</strong> when you're ready.</div> : null}
        {loaded && visible.length === 0 ? <div className="empty-state">No vehicles match this search.</div> : null}
        <div style={{ maxHeight: "68vh", overflowY: "auto", borderTop: "1px solid #ddd" }}>
          {visible.map(vehicle => (
            <label key={vehicle.id} style={{
              display: "flex", alignItems: "center", gap: 14, padding: "12px 10px",
              borderBottom: "1px solid #e2e8f0", borderLeft: selectedSet.has(vehicle.id) ? "4px solid #2563eb" : "4px solid transparent",
              background: selectedSet.has(vehicle.id) ? "#eff6ff" : "#fff",
              cursor: busy || previewOnly || !loaded ? "wait" : "pointer", transition: "background .12s ease",
            }}>
              <input
                type="checkbox" disabled={Boolean(busy) || previewOnly || !loaded}
                checked={selectedSet.has(vehicle.id)}
                onChange={event => setVehicle(vehicle.id, event.target.checked)}
                aria-label={`Advertise ${vehicle.title || vehicle.id} on Google`}
              />
              {vehicle.imageUrl ? <img src={vehicle.imageUrl} alt="" style={{ width: 90, height: 68, objectFit: "contain", flexShrink: 0 }} loading="lazy" /> : <span style={{ width: 90, textAlign: "center" }}>No photo</span>}
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong>{vehicle.title || vehicle.id}</strong>
                {vehicle.feedExclusion ? <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#b91c1c" }}>EXCLUDED from Google feed: {vehicle.feedExclusion === "blocked" ? "Manual hold / awaiting verification" : "DealerKit unavailable"}</span> : null}
                <span style={{ display: "block", fontSize: 13, opacity: 0.75 }}>{vehicle.registration ? `${vehicle.registration} · ` : ""}{vehicle.id} · {vehicle.price || "Price unavailable"} · {vehicle.storeCode || "Unassigned branch"}{vehicle.stockStatus ? ` · DealerKit: ${vehicle.stockStatus}` : ""}</span>
              </span>
              {selectedSet.has(vehicle.id) && mode === "selected" ? (
                <button type="button" className="button button--ghost"
                  style={{ color: "#b91c1c", fontSize: 12 }}
                  disabled={Boolean(busy) || unsaved}
                  onClick={event => { event.preventDefault(); event.stopPropagation(); act("remove", { vehicleId: vehicle.id, reason: "manual" }); }}>
                  Remove from shortlist
                </button>
              ) : null}
              {blockedIds.includes(vehicle.id) ? (
                <button type="button" className="button button--ghost" style={{ fontSize: 12 }}
                  disabled={Boolean(busy) || unsaved}
                  onClick={event => { event.preventDefault(); event.stopPropagation(); act("unblock", { vehicleId: vehicle.id }); }}>
                  Restore hold
                </button>
              ) : !vehicle.missingFromFeed && !vehicle.feedExclusion ? (
                <button type="button" className="button button--ghost" style={{ color: "#b91c1c", fontSize: 12 }}
                  disabled={Boolean(busy) || unsaved}
                  onClick={event => { event.preventDefault(); event.stopPropagation(); act("block", { vehicleId: vehicle.id }); }}>
                  Block from Google
                </button>
              ) : null}
              <span aria-hidden="true" style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: vehicle.feedExclusion ? "#b91c1c" : "#1d4ed8", minWidth: 74, textAlign: "right" }}>
                {vehicle.feedExclusion ? "EXCLUDED" : mode === "all" ? "✓ AUTO" : selectedSet.has(vehicle.id) ? "✓ SELECTED" : "Not selected"}
              </span>
            </label>
          ))}
        </div>
        <p style={{ fontSize: 12, marginTop: 12, opacity: 0.8 }}>
          Only this Vansco Merchant Center feed is affected; Stock Watch, other advertising and Google Ads daily budgets are unchanged. DealerKit changes are applied at the next Merchant Center feed fetch. Google may continue displaying an old listing until its update finishes.
        </p>
      </section>
    </div>
  );
}
