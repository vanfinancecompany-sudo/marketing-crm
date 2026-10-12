import { useEffect, useMemo, useState } from "react";
import { buildMarketingAccessHeaders, parseMarketingJsonResponse } from "../services/marketingAccess.js";

const ENDPOINT = "/api/vansco-google-vehicle-selection";

export default function VanscoGoogleVehicleAdsPage() {
  const [vehicles, setVehicles] = useState([]);
  const [selected, setSelected] = useState([]);
  const [savedIds, setSavedIds] = useState([]);
  const [mode, setMode] = useState("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const unsaved = selected.slice().sort().join("|") !== savedIds.slice().sort().join("|");
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return vehicles.filter(v => !term || [v.id, v.title, v.storeCode].some(value => String(value || "").toLowerCase().includes(term)));
  }, [vehicles, search]);

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
      setLoaded(true);
    } catch (err) {
      setError(err.message || "Could not load Google Vehicle Ads selection.");
    } finally {
      setBusy("");
    }
  }

  useEffect(() => { load(); }, []);

  function setVehicle(id, checked) {
    setSelected(prev => checked ? Array.from(new Set([...prev, id])) : prev.filter(item => item !== id));
    setMessage("");
  }

  async function act(action) {
    if (busy) return;
    if (action === "activate" && (unsaved || savedIds.length === 0)) {
      setError("Save your selected vehicles first, then activate selected-only mode.");
      return;
    }
    if (action === "deactivate" && !window.confirm("Show ALL DealerKit vehicles in the Google feed again? This could make the whole stock eligible for paid Vehicle Ads.")) return;
    setBusy(action);
    setError("");
    setMessage("");
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: buildMarketingAccessHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(action === "save" ? { action, selectedIds: selected } : { action }),
      });
      const json = await parseMarketingJsonResponse(response, "Could not update Vansco Google Vehicle Ads.");
      setMode(json.mode || "all");
      setSavedIds(json.selectedIds || []);
      setSelected(json.selectedIds || []);
      setMessage(json.message || "Saved.");
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
            <p>Choose exactly which DealerKit vehicles are sent to Merchant Center. Finance and Rent2Buy stock is not affected.</p>
          </div>
          <button className="button button--ghost" type="button" onClick={load} disabled={Boolean(busy)}>Refresh stock</button>
        </div>
        <div className="notice" style={{ marginBottom: 14 }}>
          <strong>Google feed: {mode === "selected" ? "Selected vehicles only" : "All DealerKit vehicles (unchanged)"}</strong>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            {vehicles.length} vehicles in the DealerKit Google feed · {selected.length} selected.
            {mode === "selected" ? " Saving a new selection updates the next Google feed fetch." : " Your selections are only a draft until you activate selected-only mode."}
            {" "}Google normally imports this feed once daily; you can also request Update in Merchant Center.
          </div>
        </div>
        {error ? <div className="notice notice--error" role="alert">{error}</div> : null}
        {message ? <div className="notice" role="status">{message}</div> : null}
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
          <span className="status-pill">{selected.length} selected</span>
        </div>
        <div className="card-actions" style={{ marginBottom: 14 }}>
          <button type="button" className="button button--ghost" disabled={Boolean(busy)} onClick={() => setSelected(prev => Array.from(new Set([...prev, ...visible.map(v => v.id)])))}>Select visible</button>
          <button type="button" className="button button--ghost" disabled={Boolean(busy)} onClick={() => { const remove = new Set(visible.map(v => v.id)); setSelected(prev => prev.filter(id => !remove.has(id))); }}>Clear visible</button>
          <button type="button" className="button button--primary" disabled={Boolean(busy) || !unsaved} onClick={() => act("save")}>{busy === "save" ? "Saving..." : "Save selected vehicles"}</button>
          {mode === "all" ? (
            <button type="button" className="button button--primary" disabled={Boolean(busy) || unsaved || !savedIds.length} onClick={() => act("activate")}>Activate selected vehicles only</button>
          ) : (
            <button type="button" className="button button--ghost" disabled={Boolean(busy)} onClick={() => act("deactivate")}>Return to all vehicles</button>
          )}
        </div>
        {unsaved ? <div className="notice">You have unsaved changes. Save your selections before leaving this screen.</div> : null}
        {loaded && visible.length === 0 ? <div className="empty-state">No vehicles match this search.</div> : null}
        <div style={{ maxHeight: "68vh", overflowY: "auto", borderTop: "1px solid #ddd" }}>
          {visible.map(vehicle => (
            <label key={vehicle.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 6px", borderBottom: "1px solid #ddd", cursor: "pointer" }}>
              <input
                type="checkbox" disabled={Boolean(busy)}
                checked={selected.includes(vehicle.id)}
                onChange={event => setVehicle(vehicle.id, event.target.checked)}
                aria-label={`Advertise ${vehicle.title || vehicle.id} on Google`}
              />
              {vehicle.imageUrl ? <img src={vehicle.imageUrl} alt="" style={{ width: 90, height: 68, objectFit: "contain", flexShrink: 0 }} loading="lazy" /> : <span style={{ width: 90, textAlign: "center" }}>No photo</span>}
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong>{vehicle.title || vehicle.id}</strong>
                <span style={{ display: "block", fontSize: 13, opacity: 0.75 }}>{vehicle.id} · {vehicle.price || "Price unavailable"} · {vehicle.storeCode || "Unassigned branch"}</span>
              </span>
            </label>
          ))}
        </div>
        <p style={{ fontSize: 12, marginTop: 12, opacity: 0.8 }}>
          Selection controls which products are supplied by the Marketing CRM Google feed. It does not change DealerKit website adverts, other dealership integrations, or the Google Ads daily budget. Please pause the Shopping campaign before making your first selection.
        </p>
      </section>
    </div>
  );
}
