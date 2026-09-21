import { useEffect, useMemo, useState } from "react";
import {
  GROUP_AGENT_DISCOVERY_COMPLETE,
  GROUP_AGENT_INSPECTION_COMPLETE,
  applyGroupInspection,
  loadFacebookGroups,
  markGroupPosted,
  mergeDiscoveredGroups,
  prepareFacebookGroupPost,
  saveFacebookGroups,
  scoreFacebookGroups,
  startFacebookGroupDiscovery,
  startFacebookGroupInspection,
} from "../services/facebookGroupsAgent.js";

function clean(value) {
  return String(value ?? "").trim();
}

function vehicleKey(vehicle) {
  return String(vehicle?.id || vehicle?.registration || vehicle?.reg || vehicle?.title || "");
}

function vehicleLabel(vehicle) {
  const reg = clean(vehicle?.registration || vehicle?.reg || vehicle?.title).toUpperCase();
  const name = clean(vehicle?.name || vehicle?.vanDescription || vehicle?.description);
  return [reg, name].filter(Boolean).join(" - ") || "Van";
}

function statusClass(status) {
  if (status === "Green") return "success";
  if (status === "Red") return "danger";
  return "warning";
}

function checkedLabel(value) {
  if (!value) return "Not live-checked yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Checked";
  return `Checked ${date.toLocaleDateString("en-GB")}`;
}

function yesNoUnknown(value, yes = "Yes", no = "No") {
  if (value === true) return yes;
  if (value === false) return no;
  return "Unknown";
}

export default function FacebookGroupsAgentPage({
  productKey,
  vehicles,
  vehiclesLoading,
  vehiclesError,
}) {
  const isRent2Buy = productKey === "rent2buy";
  const title = isRent2Buy ? "Rent2Buy Facebook Groups" : "Van Finance Groups & Classifieds";
  const [groups, setGroups] = useState(() => loadFacebookGroups());
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [segmentFilter, setSegmentFilter] = useState("All");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [lastRun, setLastRun] = useState(null);

  const scoredGroups = useMemo(
    () => scoreFacebookGroups(groups, productKey),
    [groups, productKey],
  );

  const segments = useMemo(
    () => ["All", ...new Set(scoredGroups.map((group) => group.segment).filter(Boolean))],
    [scoredGroups],
  );

  const visibleGroups = useMemo(
    () => scoredGroups
      .filter((group) => statusFilter === "All" || group.status === statusFilter)
      .filter((group) => segmentFilter === "All" || group.segment === segmentFilter)
      .slice(0, 100),
    [scoredGroups, statusFilter, segmentFilter],
  );

  const selectedVehicle = useMemo(
    () => (vehicles || []).find((vehicle) => vehicleKey(vehicle) === selectedVehicleId) || null,
    [vehicles, selectedVehicleId],
  );

  const counts = useMemo(() => {
    const result = { total: scoredGroups.length, green: 0, amber: 0, red: 0, checked: 0, postable: 0 };
    for (const group of scoredGroups) {
      if (group.status === "Green") result.green += 1;
      else if (group.status === "Red") result.red += 1;
      else result.amber += 1;
      if (group.lastCheckedAt) result.checked += 1;
      if (group.canPost === true) result.postable += 1;
    }
    return result;
  }, [scoredGroups]);

  useEffect(() => {
    function handleMessage(event) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const payload = event.data || {};
      if (payload.source !== "vfc-facebook-helper") return;

      if (payload.type === GROUP_AGENT_DISCOVERY_COMPLETE) {
        if (payload.productKey && payload.productKey !== productKey) return;
        const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
        const merged = mergeDiscoveredGroups(groups, candidates, productKey);
        setGroups(merged);
        saveFacebookGroups(merged);
        setLastRun({
          type: "discovery",
          found: candidates.length,
          queries: Number(payload.queryCount || 0),
          at: new Date().toISOString(),
        });
        setMessage(
          `Discovery found ${candidates.length} candidate group${candidates.length === 1 ? "" : "s"}. Checking the strongest/stalest candidates now…`,
        );
        setBusy("inspection");
        startFacebookGroupInspection(scoreFacebookGroups(merged, productKey), productKey, 12)
          .catch((error) => {
            setBusy("");
            setMessage(`${error.message || "Discovery completed, but live checks could not start."} You can press Check Next 12 manually.`);
          });
        return;
      }

      if (payload.type === GROUP_AGENT_INSPECTION_COMPLETE) {
        if (payload.productKey && payload.productKey !== productKey) return;
        const inspections = Array.isArray(payload.inspections) ? payload.inspections : [];
        setGroups((current) => {
          const updated = applyGroupInspection(current, inspections, productKey);
          saveFacebookGroups(updated);
          return updated;
        });
        setBusy("");
        setLastRun({
          type: "inspection",
          checked: inspections.length,
          at: new Date().toISOString(),
        });
        setMessage(
          `Live check completed for ${inspections.length} group${inspections.length === 1 ? "" : "s"}. Green groups are the best posting candidates; Amber means the rules still need judgement.`,
        );
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [groups, productKey]);

  async function discoverGroups() {
    if (busy) return;
    setBusy("discovery");
    setMessage("Starting Facebook discovery. The helper will work through a controlled batch of live group searches.");
    try {
      await startFacebookGroupDiscovery(productKey, {
        queryCount: isRent2Buy ? 10 : 12,
        maxGroups: isRent2Buy ? 50 : 70,
      });
      setMessage("Facebook discovery is running in a helper tab. Keep Facebook logged in; results will return here automatically.");
    } catch (error) {
      setBusy("");
      setMessage(error.message || "Could not start Facebook group discovery.");
    }
  }

  async function checkNextGroups() {
    if (busy) return;
    setBusy("inspection");
    setMessage("Checking the next group batch for membership, post access and visible advertising/rule evidence.");
    try {
      await startFacebookGroupInspection(scoredGroups, productKey, 12);
      setMessage("Live group checks are running. Results will return here automatically.");
    } catch (error) {
      setBusy("");
      setMessage(error.message || "Could not start live group checks.");
    }
  }

  async function preparePost(group) {
    if (!selectedVehicle) {
      setMessage("Choose a van at the top of the page first.");
      return;
    }
    setBusy(`post:${group.id}`);
    setMessage(`Preparing ${selectedVehicle.registration || selectedVehicle.reg || "the selected van"} for ${group.name}…`);
    try {
      await prepareFacebookGroupPost({
        group,
        vehicle: selectedVehicle,
        caption: selectedVehicle.caption || "",
        productKey,
      });
      setMessage(
        `${group.name} is opening in Facebook. The helper will prepare the text and image where Facebook exposes a compatible group composer. Review it and click Post yourself.`,
      );
    } catch (error) {
      setMessage(error.message || "Could not hand this group post to the browser helper.");
    } finally {
      setBusy("");
    }
  }

  function confirmPosted(group) {
    const updated = markGroupPosted(groups, group.url);
    setGroups(updated);
    saveFacebookGroups(updated);
    setMessage(`${group.name} marked posted. The posting date is now part of its rotation score.`);
  }

  if (vehiclesLoading) {
    return <div className="empty-state">Loading live stock…</div>;
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel__header">
          <div>
            <h2>{title}</h2>
            <p>
              {isRent2Buy
                ? "Find and live-check relevant trade, courier, self-employed and local classified groups for Rent2Buy. Discovery favours the southern eligibility area."
                : "Find and live-check England-wide van, commercial vehicle, trade, small-business and classified groups for Van Finance."}
            </p>
          </div>
          <div className="card-actions">
            <button className="button button--primary" type="button" onClick={discoverGroups} disabled={Boolean(busy)}>
              {busy === "discovery" ? "Discovering…" : "Discover New Groups"}
            </button>
            <button className="button button--ghost" type="button" onClick={checkNextGroups} disabled={Boolean(busy)}>
              {busy === "inspection" ? "Checking…" : "Check Next 12"}
            </button>
          </div>
        </div>

        <div className="posting-summary-strip">
          {[
            ["Groups", counts.total],
            ["Green", counts.green],
            ["Amber", counts.amber],
            ["Can post", counts.postable],
            ["Live checked", counts.checked],
          ].map(([label, value]) => (
            <div className="posting-summary-card" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>

        {message ? <div className="notice">{message}</div> : null}
        {lastRun ? (
          <div className="creative-card__meta">
            Last agent run: {lastRun.type === "discovery" ? `${lastRun.found || 0} groups discovered` : `${lastRun.checked || 0} groups checked`}
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Post setup</h3>
            <p>Select the van once, then prepare it for any suitable group below.</p>
          </div>
        </div>
        {vehiclesError ? <div className="notice notice--error">{vehiclesError}</div> : null}
        <label className="field">
          <span>Van</span>
          <select value={selectedVehicleId} onChange={(event) => setSelectedVehicleId(event.target.value)}>
            <option value="">Choose a van…</option>
            {(vehicles || []).map((vehicle) => (
              <option key={vehicleKey(vehicle)} value={vehicleKey(vehicle)}>
                {vehicleLabel(vehicle)}
              </option>
            ))}
          </select>
        </label>
        {selectedVehicle ? (
          <div className="notice">
            Ready: <strong>{vehicleLabel(selectedVehicle)}</strong>. The helper uses the existing {isRent2Buy ? "Rent2Buy" : "Van Finance"} Facebook copy and stock image.
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Group opportunities</h3>
            <p>Score combines relevance, group size, live posting access, rule evidence and posting history.</p>
          </div>
          <div className="card-actions">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              {["All", "Green", "Amber", "Red"].map((value) => <option key={value}>{value}</option>)}
            </select>
            <select value={segmentFilter} onChange={(event) => setSegmentFilter(event.target.value)}>
              {segments.map((value) => <option key={value}>{value}</option>)}
            </select>
          </div>
        </div>

        {visibleGroups.length === 0 ? (
          <div className="empty-state">No groups match this view yet. Run discovery to build the list.</div>
        ) : (
          <div className="posting-card-grid posting-card-grid--dense">
            {visibleGroups.map((group) => (
              <article className="posting-card" key={group.id || group.url}>
                <div className="posting-card__body">
                  <div className="creative-card__tags">
                    <span className="tag">{group.segment || "Group"}</span>
                    <span className="tag">{group.area || "Audience unknown"}</span>
                    <span className="tag">{group.members || "Size unknown"}</span>
                    <span className={`tag tag--${statusClass(group.status)}`}>{group.status || "Amber"}</span>
                  </div>
                  <h3>{group.name}</h3>
                  <p>
                    Score <strong>{group.score || 0}/100</strong> · {checkedLabel(group.lastCheckedAt)}
                  </p>
                  <div className="posting-card__meta">
                    <span>Joined: {yesNoUnknown(group.joined)}</span>
                    <span>Can post: {yesNoUnknown(group.canPost)}</span>
                    <span>Approval: {yesNoUnknown(group.approvalRequired, "Required", "Not seen")}</span>
                    <span>Links: {yesNoUnknown(group.linksAllowed, "Allowed", "Restricted")}</span>
                  </div>
                  {group.ruleEvidence ? (
                    <div className="notice">
                      <strong>Rule evidence:</strong> {group.ruleEvidence.slice(0, 420)}
                    </div>
                  ) : (
                    <div className="notice">No fresh rule evidence yet. Run the live checker before relying on this group.</div>
                  )}
                  <div className="creative-card__meta">
                    Last posted: {group.lastPostedAt ? new Date(group.lastPostedAt).toLocaleDateString("en-GB") : "Never recorded"} · Posts: {Number(group.postCount || 0)} · Leads: {Number(group.leads || 0)}
                  </div>
                  <div className="card-actions">
                    <button className="button button--primary" type="button" onClick={() => preparePost(group)} disabled={Boolean(busy)}>
                      {busy === `post:${group.id}` ? "Preparing…" : "Prepare Group Post"}
                    </button>
                    <button className="button button--ghost" type="button" onClick={() => window.open(group.url, "_blank", "noopener,noreferrer")}>
                      Open Group
                    </button>
                    <button className="button button--ghost" type="button" onClick={() => confirmPosted(group)}>
                      Mark Posted
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
