import { useEffect, useMemo, useState } from "react";
import {
  GROUP_AGENT_DISCOVERY_COMPLETE,
  GROUP_AGENT_INSPECTION_COMPLETE,
  GROUP_POST_EVENT_ACK,
  GROUP_POST_STATUS_COMPLETE,
  GROUP_POST_SUBMITTED,
  applyGroupInspection,
  archiveFacebookGroup,
  getFacebookHelperStatus,
  groupDueState,
  groupPipeline,
  loadFacebookGroups,
  markGroupAccepted,
  markGroupPostStatus,
  markGroupPosted,
  mergeDiscoveredGroups,
  prepareFacebookGroupPost,
  restoreFacebookGroup,
  saveFacebookGroups,
  scoreFacebookGroups,
  setGroupRepeatDays,
  startFacebookGroupDiscovery,
  startFacebookGroupInspection,
  startFacebookPostStatusCheck,
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

function dateLabel(value, fallback = "Never") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString("en-GB");
}

function yesNoUnknown(value, yes = "Yes", no = "No") {
  if (value === true) return yes;
  if (value === false) return no;
  return "Unknown";
}

function postStatusLabel(group) {
  if (group.postStatus === "accepted") return "Accepted";
  if (group.postStatus === "pending") return "Pending admin approval";
  if (group.postStatus === "awaiting") return "Awaiting acceptance check";
  if (group.postStatus === "not_found") return "Not found yet";
  if (group.postStatus === "unavailable") return "Unavailable";
  return group.postCount ? "Posted before" : "Not posted yet";
}

function pipelineLabel(group) {
  const pipeline = groupPipeline(group);
  if (pipeline === "proven") return "PROVEN";
  if (pipeline === "testing") return "AWAITING";
  if (pipeline === "archived") return "ARCHIVED";
  return "NEW";
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
  const [pipelineView, setPipelineView] = useState("new");
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [lastRun, setLastRun] = useState(null);
  const [helperStatus, setHelperStatus] = useState({
    checking: true,
    connected: false,
    version: "",
    capabilities: [],
    hostname: "",
  });

  const scoredGroups = useMemo(
    () => scoreFacebookGroups(groups, productKey),
    [groups, productKey],
  );

  const activeGroups = useMemo(
    () => scoredGroups.filter((group) => !group.archived),
    [scoredGroups],
  );

  const archivedGroups = useMemo(
    () => scoredGroups.filter((group) => group.archived),
    [scoredGroups],
  );

  const newGroups = useMemo(
    () => activeGroups.filter((group) => groupPipeline(group) !== "proven"),
    [activeGroups],
  );

  const provenGroups = useMemo(
    () => activeGroups.filter((group) => groupPipeline(group) === "proven"),
    [activeGroups],
  );

  const dueGroups = useMemo(
    () => provenGroups.filter((group) => groupDueState(group).due),
    [provenGroups],
  );

  const awaitingGroups = useMemo(
    () => activeGroups.filter((group) =>
      ["awaiting", "pending", "not_found"].includes(group.postStatus)
    ),
    [activeGroups],
  );

  const segments = useMemo(
    () => ["All", ...new Set(activeGroups.map((group) => group.segment).filter(Boolean))],
    [activeGroups],
  );

  const pipelineGroups = showArchived
    ? archivedGroups
    : pipelineView === "proven"
      ? provenGroups
      : newGroups;

  const visibleGroups = useMemo(
    () => pipelineGroups
      .filter((group) => statusFilter === "All" || group.status === statusFilter)
      .filter((group) => segmentFilter === "All" || group.segment === segmentFilter)
      .slice(0, 100),
    [pipelineGroups, statusFilter, segmentFilter],
  );

  const selectedVehicle = useMemo(
    () => (vehicles || []).find((vehicle) => vehicleKey(vehicle) === selectedVehicleId) || null,
    [vehicles, selectedVehicleId],
  );

  const counts = useMemo(() => {
    const result = {
      total: activeGroups.length,
      new: newGroups.length,
      awaiting: awaitingGroups.length,
      proven: provenGroups.length,
      due: dueGroups.length,
      archived: archivedGroups.length,
      green: 0,
      amber: 0,
    };
    for (const group of activeGroups) {
      if (group.status === "Green") result.green += 1;
      else if (group.status !== "Red") result.amber += 1;
    }
    return result;
  }, [activeGroups, newGroups, awaitingGroups, provenGroups, dueGroups, archivedGroups]);

  useEffect(() => {
    let cancelled = false;

    async function checkHelper() {
      const status = await getFacebookHelperStatus();
      if (!cancelled) {
        setHelperStatus({ checking: false, ...status });
      }
    }

    checkHelper();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function persist(update) {
      setGroups((current) => {
        const next = typeof update === "function" ? update(current) : update;
        saveFacebookGroups(next);
        return next;
      });
    }

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
          `Discovery found ${candidates.length} candidate group${candidates.length === 1 ? "" : "s"}. Live-checking the strongest/stalest candidates now…`,
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
        let archivedCount = 0;
        persist((current) => {
          const updated = applyGroupInspection(current, inspections, productKey);
          archivedCount = updated.filter((group) =>
            group.archived && !current.find((old) => old.id === group.id)?.archived
          ).length;
          return updated;
        });
        setBusy("");
        setLastRun({ type: "inspection", checked: inspections.length, at: new Date().toISOString() });
        setMessage(
          `Live check completed for ${inspections.length} group${inspections.length === 1 ? "" : "s"}.${archivedCount ? ` ${archivedCount} dead/unavailable group${archivedCount === 1 ? "" : "s"} removed from the active pipelines.` : ""}`,
        );
        return;
      }

      if (payload.type === GROUP_POST_SUBMITTED && payload.event) {
        const postEvent = payload.event;
        if (postEvent.productKey && postEvent.productKey !== productKey) return;
        persist((current) => markGroupPosted(current, postEvent.groupUrl, {
          postedAt: postEvent.postedAt,
          registration: postEvent.registration,
          approvalState: postEvent.approvalState === "accepted" ? "accepted" : "awaiting",
        }));
        window.postMessage({
          source: "vfc-marketing-crm",
          type: GROUP_POST_EVENT_ACK,
          eventId: postEvent.id || "",
        }, window.location.origin);
        setMessage(
          `${postEvent.groupName || "Facebook group"} recorded as posted. It now sits in Awaiting until Facebook visibility/approval is confirmed.`,
        );
        return;
      }

      if (payload.type === GROUP_POST_STATUS_COMPLETE) {
        if (payload.productKey && payload.productKey !== productKey) return;
        const results = Array.isArray(payload.results) ? payload.results : [];
        persist((current) => results.reduce(
          (next, result) => markGroupPostStatus(next, result),
          current,
        ));
        const accepted = results.filter((item) => item.accepted).length;
        const pending = results.filter((item) => item.pending).length;
        const unavailable = results.filter((item) => item.unavailable).length;
        setBusy("");
        setMessage(
          `Acceptance check finished: ${accepted} accepted, ${pending} still pending, ${Math.max(0, results.length - accepted - pending - unavailable)} not visible yet${unavailable ? `, ${unavailable} unavailable group${unavailable === 1 ? "" : "s"} archived` : ""}.`,
        );
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [groups, productKey]);

  async function requireGroupsHelper() {
    const status = await getFacebookHelperStatus();
    setHelperStatus({ checking: false, ...status });
    const ready = status.connected && status.capabilities.includes("groups-discovery");
    if (!ready) {
      setMessage(
        status.connected
          ? `Facebook Helper v${status.version || "unknown"} is connected, but it does not include Groups support. Update the extension and refresh this CRM tab.`
          : "Facebook Helper is not connected to this CRM tab. Update/reload the extension, then refresh this page before trying again.",
      );
    }
    return ready;
  }

  async function discoverGroups() {
    if (busy) return;
    if (!(await requireGroupsHelper())) return;
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
    if (!(await requireGroupsHelper())) return;
    setBusy("inspection");
    setMessage("Checking the next group batch for access, posting ability and visible advertising rules.");
    try {
      await startFacebookGroupInspection(activeGroups, productKey, 12);
      setMessage("Live group checks are running. Dead/unavailable groups will fall out of the active pipelines automatically.");
    } catch (error) {
      setBusy("");
      setMessage(error.message || "Could not start live group checks.");
    }
  }

  async function checkPostAcceptance() {
    if (busy) return;
    if (!(await requireGroupsHelper())) return;
    setBusy("post-status");
    setMessage("Checking posted groups to see which adverts are visible, still pending, or unavailable.");
    try {
      await startFacebookPostStatusCheck(activeGroups, productKey, 12);
      setMessage("Acceptance checks are running through the posted groups. Results will return here automatically.");
    } catch (error) {
      setBusy("");
      setMessage(error.message || "Could not start the post acceptance check.");
    }
  }

  async function preparePost(group) {
    if (!(await requireGroupsHelper())) return;
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
        `${group.name} is opening in Facebook. The helper will prepare the advert. When you click Facebook's Post button, the CRM will record that automatically and start tracking acceptance.`,
      );
    } catch (error) {
      setMessage(error.message || "Could not hand this group post to the browser helper.");
    } finally {
      setBusy("");
    }
  }

  function persistGroups(updated) {
    setGroups(updated);
    saveFacebookGroups(updated);
  }

  function confirmPosted(group) {
    const registration = clean(selectedVehicle?.registration || selectedVehicle?.reg || selectedVehicle?.title);
    const updated = markGroupPosted(groups, group.url, { registration });
    persistGroups(updated);
    setMessage(`${group.name} marked posted manually. It is now awaiting an acceptance check.`);
  }

  function confirmAccepted(group) {
    const updated = markGroupAccepted(groups, group.url, {
      registration: group.pendingRegistration,
    });
    persistGroups(updated);
    setMessage(`${group.name} is now Proven/Hot. It will come back to the top when its repeat interval is due.`);
  }

  function removeGroup(group) {
    if (!window.confirm(`Remove ${group.name} from the active group pipelines?`)) return;
    const updated = archiveFacebookGroup(groups, group.url, "Removed as not worth posting");
    persistGroups(updated);
    setMessage(`${group.name} removed from the active pipelines.`);
  }

  function restoreGroup(group) {
    const updated = restoreFacebookGroup(groups, group.url);
    persistGroups(updated);
    setMessage(`${group.name} restored to the active group list.`);
  }

  function updateRepeatDays(group, value) {
    const updated = setGroupRepeatDays(groups, group.url, value);
    persistGroups(updated);
  }

  function renderGroupCard(group) {
    const pipeline = groupPipeline(group);
    const due = groupDueState(group);
    const isAwaiting = ["awaiting", "pending", "not_found"].includes(group.postStatus);
    return (
      <article className="posting-card" key={group.id || group.url}>
        <div className="posting-card__body">
          <div className="creative-card__tags">
            <span className="tag">{pipelineLabel(group)}</span>
            {due.due ? <span className="tag tag--success">DUE AGAIN</span> : null}
            <span className="tag">{group.segment || "Group"}</span>
            <span className="tag">{group.area || "Audience unknown"}</span>
            <span className={`tag tag--${statusClass(group.status)}`}>{group.status || "Amber"}</span>
          </div>

          <h3>{group.name}</h3>
          <p>
            Score <strong>{group.score || 0}/100</strong> · {group.members || "Size unknown"} · {checkedLabel(group.lastCheckedAt)}
          </p>

          <div className="posting-card__meta">
            <span>Joined: {yesNoUnknown(group.joined)}</span>
            <span>Can post: {yesNoUnknown(group.canPost)}</span>
            <span>Approval: {yesNoUnknown(group.approvalRequired, "Required", "Not seen")}</span>
            <span>Links: {yesNoUnknown(group.linksAllowed, "Allowed", "Restricted")}</span>
          </div>

          <div className="notice">
            <strong>Post status:</strong> {postStatusLabel(group)}
            {group.pendingRegistration ? ` · ${group.pendingRegistration}` : ""}
            <br />
            Last post: <strong>{dateLabel(group.lastPostedAt)}</strong>
            {" · "}Accepted posts: <strong>{Number(group.acceptedPostCount || 0)}</strong>
            {pipeline === "proven" ? (
              <>
                {" · "}Repeat every{" "}
                <select
                  value={Number(group.repeatDays || 7)}
                  onChange={(event) => updateRepeatDays(group, event.target.value)}
                >
                  {[7, 10, 14, 21, 30].map((days) => (
                    <option key={days} value={days}>{days} days</option>
                  ))}
                </select>
              </>
            ) : null}
          </div>

          {pipeline === "proven" ? (
            <div className="creative-card__meta">
              {due.due
                ? `Due now · last posted ${due.daysSincePost} day${due.daysSincePost === 1 ? "" : "s"} ago`
                : `Next reminder in ${due.daysUntilDue} day${due.daysUntilDue === 1 ? "" : "s"}`}
            </div>
          ) : null}

          {group.ruleEvidence ? (
            <div className="notice">
              <strong>Rule evidence:</strong> {group.ruleEvidence.slice(0, 420)}
            </div>
          ) : (
            <div className="notice">No fresh rule evidence yet. Live-check this group before relying on it.</div>
          )}

          <div className="card-actions">
            {!group.archived ? (
              <>
                <button className="button button--primary" type="button" onClick={() => preparePost(group)} disabled={Boolean(busy)}>
                  {busy === `post:${group.id}` ? "Preparing…" : pipeline === "proven" ? "Prepare Next Post" : "Prepare Test Post"}
                </button>
                <button className="button button--ghost" type="button" onClick={() => window.open(group.url, "_blank", "noopener,noreferrer")}>
                  Open Group
                </button>
                {isAwaiting ? (
                  <button className="button button--ghost" type="button" onClick={() => confirmAccepted(group)}>
                    Mark Accepted
                  </button>
                ) : null}
                <button className="button button--ghost" type="button" onClick={() => confirmPosted(group)}>
                  I Posted It
                </button>
                <button className="button button--ghost" type="button" onClick={() => removeGroup(group)}>
                  Remove
                </button>
              </>
            ) : (
              <button className="button button--ghost" type="button" onClick={() => restoreGroup(group)}>
                Restore Group
              </button>
            )}
          </div>
        </div>
      </article>
    );
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
                ? "Find, test and retain the Facebook groups that actually accept Rent2Buy adverts. Proven groups become a repeat posting pipeline."
                : "Find, test and retain England-wide Facebook groups and classifieds that actually accept Van Finance adverts."}
            </p>
          </div>
          <div className="card-actions">
            <button className="button button--primary" type="button" onClick={discoverGroups} disabled={Boolean(busy)}>
              {busy === "discovery" ? "Discovering…" : "Discover New Groups"}
            </button>
            <button className="button button--ghost" type="button" onClick={checkNextGroups} disabled={Boolean(busy)}>
              {busy === "inspection" ? "Checking…" : "Check Next 12"}
            </button>
            <button className="button button--ghost" type="button" onClick={checkPostAcceptance} disabled={Boolean(busy) || !counts.awaiting}>
              {busy === "post-status" ? "Checking Posts…" : `Check ${counts.awaiting} Awaiting Posts`}
            </button>
          </div>
        </div>

        <div className="posting-summary-strip">
          {[
            ["Active", counts.total],
            ["New / Testing", counts.new],
            ["Awaiting", counts.awaiting],
            ["Proven / Hot", counts.proven],
            ["Due again", counts.due],
            ["Archived", counts.archived],
          ].map(([label, value]) => (
            <div className="posting-summary-card" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>

        <div className="notice">
          <strong>Facebook Helper:</strong>{" "}
          {helperStatus.checking
            ? "checking connection…"
            : helperStatus.connected
              ? `v${helperStatus.version || "unknown"} connected${helperStatus.capabilities.includes("groups-discovery") ? " · Groups ready" : " · Groups support missing"}`
              : "not connected to this CRM tab"}
          {helperStatus.hostname ? ` · ${helperStatus.hostname}` : ""}
        </div>

        {message ? <div className="notice">{message}</div> : null}
        {lastRun ? (
          <div className="creative-card__meta">
            Last agent run: {lastRun.type === "discovery"
              ? `${lastRun.found || 0} groups discovered`
              : `${lastRun.checked || 0} groups checked`}
          </div>
        ) : null}
      </section>

      {dueGroups.length ? (
        <section className="panel">
          <div className="panel__header">
            <div>
              <h3>🔥 Proven groups due another advert</h3>
              <p>These groups have accepted a previous advert and have reached their posting interval.</p>
            </div>
          </div>
          <div className="posting-card-grid posting-card-grid--dense">
            {dueGroups.slice(0, 8).map(renderGroupCard)}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Post setup</h3>
            <p>Select the van once, then use it across the groups you want to test or revisit.</p>
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
            <h3>{showArchived ? "Archived / dead groups" : pipelineView === "proven" ? "Proven / Hot groups" : "New & testing groups"}</h3>
            <p>
              {showArchived
                ? "Unavailable or unwanted groups stay out of the working pipelines but can be restored."
                : pipelineView === "proven"
                  ? "Only groups where an advert has been confirmed visible/accepted."
                  : "Fresh discoveries and groups currently being tested for real posting value."}
            </p>
          </div>
          <div className="card-actions">
            <button className={`button ${!showArchived && pipelineView === "new" ? "button--primary" : "button--ghost"}`} type="button" onClick={() => { setShowArchived(false); setPipelineView("new"); }}>
              New & Testing ({counts.new})
            </button>
            <button className={`button ${!showArchived && pipelineView === "proven" ? "button--primary" : "button--ghost"}`} type="button" onClick={() => { setShowArchived(false); setPipelineView("proven"); }}>
              Proven / Hot ({counts.proven})
            </button>
            <button className={`button ${showArchived ? "button--primary" : "button--ghost"}`} type="button" onClick={() => setShowArchived(true)}>
              Archived ({counts.archived})
            </button>
          </div>
        </div>

        <div className="card-actions">
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {["All", "Green", "Amber", "Red"].map((value) => <option key={value}>{value}</option>)}
          </select>
          <select value={segmentFilter} onChange={(event) => setSegmentFilter(event.target.value)}>
            {segments.map((value) => <option key={value}>{value}</option>)}
          </select>
        </div>

        {visibleGroups.length === 0 ? (
          <div className="empty-state">
            {showArchived ? "No archived groups." : pipelineView === "proven" ? "No proven groups yet. Once Facebook accepts a test advert, it will move here." : "No groups match this view yet. Run discovery to build the pipeline."}
          </div>
        ) : (
          <div className="posting-card-grid posting-card-grid--dense">
            {visibleGroups.map(renderGroupCard)}
          </div>
        )}
      </section>
    </div>
  );
}
