import { useEffect, useState } from "react";
import VehicleCard from "../components/VehicleCard.jsx";
import FilterBar from "../components/FilterBar.jsx";

const STOCK_AUTO_REFRESH_MS = 30 * 60 * 1000;
const CARSLINK_STATUS_REFRESH_MS = 60 * 1000;

function formatCarslinkTime(value) {
  if (!value) return "Waiting for first tracked run";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function carslinkStateLabel(payload) {
  if (!payload?.configured) return "Not connected";
  if (payload?.status?.state === "error") return "Needs attention";
  if (payload?.status?.state === "syncing") return "Syncing";
  if (payload?.healthy) return "Automatic · healthy";
  return "Automatic · starting";
}

export default function StockPage({
  vehicles,
  vehiclesLoading,
  vehiclesError,
  filters,
  onFiltersChange,
  onGenerateReel,
  onViewCreatives,
  selectedVehicleIds = [],
  onToggleVehicle,
  onAddSelectedToQueue,
  onAddSelectedToReelLabQueue,
  onAddSelectedToYouTubeQueue,
  onOpenYouTubeGenerator,
  youtubeSelectionSummary = null,
  carsStockStatus = null,
  reelActionLocks = {},
  ignoreReelLock = false,
  onIgnoreReelLockChange,
  generationMessage = "",
  creativeError = "",
}) {
  const selectedCount = selectedVehicleIds.length;
  const [carslinkSyncing, setCarslinkSyncing] = useState(false);
  const [carslinkMessage, setCarslinkMessage] = useState("");
  const [carslinkError, setCarslinkError] = useState("");
  const [carslinkStatus, setCarslinkStatus] = useState(null);
  const [carslinkStatusLoading, setCarslinkStatusLoading] = useState(false);
  const carsConfigured = Boolean(carsStockStatus?.configured);
  const carsTableName = carsStockStatus?.tableName || "";
  const carsLoaded = Number(carsStockStatus?.loaded || 0);
  const carsRawRows = Number(carsStockStatus?.rawRows || 0);
  const carsLoadError = carsStockStatus?.error || "";
  const carsEmptyMessage = !carsConfigured
    ? "Cars stock source is not configured yet. Set VITE_CARS_STOCK_TABLE to the correct Supabase table once confirmed."
    : carsLoadError
      ? `Cars stock table could not be loaded: ${carsLoadError}`
      : carsRawRows === 0
        ? `No cars found in ${carsTableName} yet. Import cars into this table to populate the Cars tab.`
        : "No usable cars found yet. Import cars with a valid registration and image to populate the Cars tab.";

  function refreshStockPage() {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }

  async function loadCarslinkStatus({ silent = false } = {}) {
    if (!silent) setCarslinkStatusLoading(true);
    try {
      const response = await fetch("/api/carslink-status", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || `CarsLink status returned HTTP ${response.status}.`);
      setCarslinkStatus(payload);
    } catch (error) {
      if (!silent) setCarslinkError(error?.message || "CarsLink status could not be loaded.");
    } finally {
      if (!silent) setCarslinkStatusLoading(false);
    }
  }

  async function runCarslinkProductionSync() {
    if (carslinkSyncing) return;
    setCarslinkSyncing(true);
    setCarslinkMessage("");
    setCarslinkError("");

    try {
      const response = await fetch("/api/carslink-production-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmProduction: true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `CarsLink production returned HTTP ${response.status}.`);
      }

      const syncId = payload?.carslink?.sync_id || payload?.status?.syncId || "accepted";
      const queued = payload?.carslink?.queued_count ?? payload?.status?.queuedCount ?? payload?.sent_count ?? 0;
      const localSkipped = Array.isArray(payload?.local_skipped) ? payload.local_skipped.length : 0;
      const sourceCount = Number(payload?.source_count || 0);
      setCarslinkMessage(`CarsLink LIVE sync accepted. Sync ID: ${syncId} | source: ${sourceCount} | queued: ${queued} | local skipped: ${localSkipped}`);
      await loadCarslinkStatus({ silent: true });
    } catch (error) {
      setCarslinkError(error?.message || "CarsLink live sync failed.");
      await loadCarslinkStatus({ silent: true });
    } finally {
      setCarslinkSyncing(false);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const interval = window.setInterval(() => {
      refreshStockPage();
    }, STOCK_AUTO_REFRESH_MS);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || filters.pipeline !== "vanFinance") return undefined;
    loadCarslinkStatus();
    const interval = window.setInterval(() => loadCarslinkStatus({ silent: true }), CARSLINK_STATUS_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [filters.pipeline]);

  const liveStatus = carslinkStatus?.status || {};
  const sourceCount = Number(liveStatus.sourceCount || 0);
  const eligibleCount = Number(liveStatus.eligibleCount || liveStatus.queuedCount || 0);
  const skippedCount = Number(liveStatus.skippedCount || 0);

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Stock</h3>
            <p>Browse vehicles and jump straight into creative generation.</p>
          </div>
          <div className="card-actions">
            <button
              className="button button--ghost"
              type="button"
              onClick={refreshStockPage}
              disabled={vehiclesLoading}
            >
              {vehiclesLoading ? "Refreshing..." : "Refresh Stock"}
            </button>
            <span className="status-pill">{vehicles.length} visible</span>
            <span className="status-pill">Auto-refresh 30 mins</span>
          </div>
        </div>

        {filters.pipeline === "vanFinance" ? (
          <div
            className={carslinkStatus?.status?.state === "error" ? "notice notice--error" : "notice"}
            style={{ display: "grid", gap: 10 }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <strong>CarsLink LIVE · {carslinkStatusLoading && !carslinkStatus ? "Checking" : carslinkStateLabel(carslinkStatus)}</strong>
                <div style={{ marginTop: 3, opacity: 0.78, fontSize: 13 }}>
                  Checks Finance stock hourly, pushes automatically when stock changes, and forces a full refresh at least every 12 hours.
                </div>
              </div>
              <button
                className="button button--ghost"
                type="button"
                onClick={runCarslinkProductionSync}
                disabled={carslinkSyncing}
                title="Force a full CarsLink production reconciliation now."
              >
                {carslinkSyncing ? "Syncing CarsLink..." : "Sync CarsLink now"}
              </button>
            </div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
              <span><strong>{eligibleCount}</strong> eligible</span>
              <span><strong>{skippedCount}</strong> skipped</span>
              <span><strong>{sourceCount}</strong> source vans</span>
              <span>Last sync: <strong>{formatCarslinkTime(liveStatus.lastSuccessAt)}</strong></span>
              <span>Next check: <strong>{formatCarslinkTime(carslinkStatus?.schedule?.nextCheckAt)}</strong></span>
            </div>
            {liveStatus.syncId ? <div style={{ opacity: 0.7, fontSize: 12 }}>Last CarsLink sync ID: {liveStatus.syncId}</div> : null}
            {liveStatus.lastError ? <div style={{ fontWeight: 800 }}>CarsLink error: {liveStatus.lastError}</div> : null}
          </div>
        ) : null}

        {carslinkMessage ? <div className="notice">{carslinkMessage}</div> : null}
        {carslinkError ? <div className="notice notice--error">{carslinkError}</div> : null}

        <FilterBar filters={filters} onChange={onFiltersChange} />

        <div className="selection-summary stock-selection-summary">
          <strong>{selectedCount} selected for manual reel queue</strong>
          <span>Pick vehicles, then send them to Reel Lab Beta or YouTube Generator queues.</span>
          {filters.pipeline === "cars" ? (
            <span>
              Cars table config: {carsConfigured ? "configured" : "not configured"} | Cars table name: {carsTableName || "none"} | Cars loaded: {carsLoaded}
            </span>
          ) : null}
          {youtubeSelectionSummary && selectedCount ? (
            <span>
              Ready for YouTube: {youtubeSelectionSummary.ready} | Warning: {youtubeSelectionSummary.skipped} may need more images
            </span>
          ) : null}
          <div className="card-actions">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={ignoreReelLock}
                onChange={(event) => onIgnoreReelLockChange?.(event.target.checked)}
              />
              <span>Ignore reel lock / allow reuse</span>
            </label>
            <button
              className="button button--primary"
              type="button"
              onClick={() => onAddSelectedToReelLabQueue?.("finance")}
              disabled={!selectedCount}
            >
              Add selected to Finance Reel Lab Queue
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={() => onAddSelectedToReelLabQueue?.("rent2buy")}
              disabled={!selectedCount}
            >
              Add selected to Rent2Buy Reel Lab Queue
            </button>
            <button
              className="button button--primary"
              type="button"
              onClick={() => onAddSelectedToYouTubeQueue?.(filters.pipeline === "cars" ? "cars" : filters.pipeline === "rent2buy" ? "rent2buy" : "vanFinance")}
              disabled={!selectedCount}
            >
              Add to YouTube Queue
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={onOpenYouTubeGenerator}
            >
              Open YouTube Generator
            </button>
          </div>
          {generationMessage ? <div className="notice">{generationMessage}</div> : null}
          {creativeError ? <div className="notice notice--error">{creativeError}</div> : null}
        </div>

        {vehiclesLoading ? (
          <div className="empty-state">Loading live stock...</div>
        ) : vehiclesError ? (
          <div className="empty-state">Unable to load stock: {vehiclesError}</div>
        ) : vehicles.length === 0 && filters.pipeline === "cars" ? (
          <div className="empty-state">{carsEmptyMessage}</div>
        ) : vehicles.length === 0 ? (
          <div className="empty-state">No vehicles are ready for marketing yet.</div>
        ) : (
          <div className="card-grid">
            {vehicles.map((vehicle) => (
              <VehicleCard
                key={vehicle.id}
                vehicle={vehicle}
                displayMode={filters.pipeline === "rent2buy" ? "rent2buy" : filters.pipeline === "cars" ? "cars" : "finance"}
                onGenerateReel={onGenerateReel}
                onViewCreatives={onViewCreatives}
                selectable
                selected={selectedVehicleIds.includes(String(vehicle.id || vehicle.reg || vehicle.registration || vehicle.name || ""))}
                onSelect={onToggleVehicle}
                reelActionLock={reelActionLocks[String(vehicle.id || vehicle.reg || vehicle.registration || vehicle.name || "")]}
                ignoreReelLock={ignoreReelLock}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
