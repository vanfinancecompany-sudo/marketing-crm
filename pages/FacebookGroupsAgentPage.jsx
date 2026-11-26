import { useEffect, useMemo, useRef, useState } from "react";
import {
  GROUP_AGENT_DISCOVERY_COMPLETE,
  GROUP_AGENT_INSPECTION_COMPLETE,
  GROUP_POST_EVENT_ACK,
  GROUP_POST_STATUS_COMPLETE,
  GROUP_POST_STATUS_PROGRESS,
  GROUP_POST_STATUS_EVENT,
  GROUP_POST_STATUS_EVENT_ACK,
  GROUP_POST_SUBMITTED,
  applyGroupInspection,
  archiveFacebookGroup,
  buildFacebookGroupPostJob,
  getFacebookHelperStatus,
  groupDueState,
  groupPipeline,
  hydrateFacebookGroups,
  loadFacebookGroups,
  markGroupAccepted,
  markGroupPostStatus,
  markGroupPosted,
  mergeFacebookGroupsByRecentPostState,
  normalizeFacebookGroupUrl,
  mergeDiscoveredGroups,
  prepareFacebookGroupPost,
  persistFacebookGroupsRemote,
  requestGroupRenewalHelper,
  recoverFacebookGroupsFromSnapshot,
  requestFacebookGroupRecoverySnapshot,
  restoreFacebookGroup,
  saveFacebookGroups,
  scoreFacebookGroups,
  setGroupRepeatDays,
  startFacebookGroupDiscovery,
  startFacebookGroupInspection,
  startFacebookPostStatusCheck,
} from "../services/facebookGroupsAgent.js";
import { londonDateKey } from "../lib/marketingDailyOperations.js";
import { RENEWAL_HEARTBEAT_INTERVAL_MS } from "../lib/rent2buyGroupRenewalMonitor.js";
import { renewalReviewIdentity } from "../lib/rent2buyGroupRenewals.js";
import { recordDailyMarketingActivity } from "../services/marketingDailyOperations.js";
import { getStoredMarketingAccessKey, MARKETING_ACCESS_HEADER } from "../services/marketingAccess.js";

const AUTOMATIC_RENEWAL_CLAIM_KEY = "vfcRent2BuyAutomaticRenewalClaim";

function readAutomaticRenewalClaim() {
  try { return JSON.parse(window.localStorage.getItem(AUTOMATIC_RENEWAL_CLAIM_KEY) || "null"); }
  catch { return null; }
}

function clearAutomaticRenewalClaim(jobId) {
  if (readAutomaticRenewalClaim()?.jobId === jobId) window.localStorage.removeItem(AUTOMATIC_RENEWAL_CLAIM_KEY);
}

async function renewalRequest(body) {
  const response = await fetch(body ? "/api/rent2buy-group-renewals" : "/api/rent2buy-group-renewals?view=queue", {
    headers: { [MARKETING_ACCESS_HEADER]: getStoredMarketingAccessKey(), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The renewal queue is unavailable.");
  return data;
}

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

function registrationKey(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function usedVansStorageKey(productKey) {
  return `vfcFacebookGroupsUsedVans:${productKey}`;
}

function groupActivityType(productKey) {
  return productKey === "rent2buy" ? "rent2buy_groups_post" : "van_finance_groups_post";
}

function groupActivityDestination(productKey) {
  return productKey === "rent2buy" ? "Rent2Buy Facebook Groups" : "Van Finance Groups & Classifieds";
}

function loadUsedVanKeys(productKey) {
  if (typeof window === "undefined") return [];
  try {
    const saved = JSON.parse(window.localStorage.getItem(usedVansStorageKey(productKey)) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveUsedVanKeys(productKey, keys) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(usedVansStorageKey(productKey), JSON.stringify(keys || []));
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
  if (group.postStatus === "declined") return "Declined";
  if (group.postStatus === "unavailable") return "Unavailable";
  return group.postCount ? "Posted before" : "Not posted yet";
}

function pipelineLabel(group) {
  const pipeline = groupPipeline(group);
  if (pipeline === "proven") return "PROVEN";
  if (pipeline === "testing") return "AWAITING";
  if (pipeline === "membership_pending") return "PENDING MEMBERSHIP";
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
  const [usedVehicleKeys, setUsedVehicleKeys] = useState(() => loadUsedVanKeys(productKey));
  const [statusFilter, setStatusFilter] = useState("All");
  const [segmentFilter, setSegmentFilter] = useState("All");
  const [pipelineView, setPipelineView] = useState("new");
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState("");
  const [renewalRunning, setRenewalRunning] = useState(false);
  const [renewalAutomatic, setRenewalAutomatic] = useState(false);
  const [renewalPolling, setRenewalPolling] = useState(false);
  const [renewalPending, setRenewalPending] = useState(false);
  const [renewalDraft, setRenewalDraft] = useState(null);
  const [renewalMessage, setRenewalMessage] = useState("");
  const renewalWork = useRef(false);
  const renewalRunningRef = useRef(false);
  const lastRenewalHeartbeat = useRef({ at: 0, attemptedAt: 0, state: "" });

  function recordGroupPostActivity({ groupUrl, groupName, registration, postedAt, renewalDate, jobId, automatic, approvalState, permalink }) {
    const activityDate = londonDateKey(postedAt ? new Date(postedAt) : new Date());
    const canonicalUrl = normalizeFacebookGroupUrl(groupUrl || "");
    const sourceId = [
      "facebook-group",
      productKey,
      activityDate,
      canonicalUrl.toLowerCase(),
      registrationKey(registration),
    ].join("::");

    return recordDailyMarketingActivity(groupActivityType(productKey), {
      activityDate,
      source: "facebook_groups",
      sourceId,
      metadata: {
        destination: groupActivityDestination(productKey),
        group_url: canonicalUrl,
        group_name: clean(groupName),
        registration: clean(registration).toUpperCase(),
        ...(isRent2Buy ? { submitted_at: postedAt || new Date().toISOString(), posting_mode: automatic ? "automatic" : "manual" } : {}),
        ...(renewalDate ? { renewal_run_date: renewalDate, renewal_job_id: jobId, approval_outcome: approvalState || "submitted" } : {}),
        ...(permalink ? { post_permalink: permalink } : {}),
      },
    });
  }
  function recordGroupApproval(event) {
    if (event?.reviewIdentity) {
      return renewalRequest({ action: "review", groupUrl: event.groupUrl, target: event.reviewIdentity,
        result: event.accepted ? "accepted" : event.declined ? "declined" : event.pending ? "pending" : "unknown",
        observedAt: event.observedAt, permalink: event.matchedUrl });
    }
    if (!isRent2Buy || !event?.postedAt) return Promise.resolve();
    const approval = event.accepted ? "accepted" : event.declined ? "declined" : event.pending ? "pending" : "";
    return approval ? renewalRequest({ action: "approval", groupUrl: event.groupUrl || event.url, registration: event.registration,
      postedAt: event.postedAt, checkedAt: event.checkedAt || new Date().toISOString(), approval, reason: event.reason }) : Promise.resolve();
  }
  async function reportRenewalHeartbeat(state, reason, approvalMonitor) {
    const previous = lastRenewalHeartbeat.current;
    const immediate = ["paused", "restricted"].includes(state) && state !== previous.state;
    if (!immediate && (Date.now() - previous.at < RENEWAL_HEARTBEAT_INTERVAL_MS || Date.now() - previous.attemptedAt < 60_000)) return;
    if (immediate && Date.now() - previous.attemptedAt < 60_000 && state === previous.attemptedState) return;
    previous.attemptedAt = Date.now();
    previous.attemptedState = state;
    await renewalRequest({ action: "heartbeat", state, reason, extension: helperStatus.version, approvalMonitor });
    previous.at = Date.now();
    previous.state = state;
  }

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
    () => activeGroups.filter((group) => groupPipeline(group) === "new"),
    [activeGroups],
  );

  const membershipPendingGroups = useMemo(
    () => activeGroups.filter((group) => groupPipeline(group) === "membership_pending"),
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
      : pipelineView === "awaiting"
        ? awaitingGroups
        : pipelineView === "membership_pending"
          ? membershipPendingGroups
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

  const rotationVehicles = useMemo(
    () => (vehicles || []).filter((vehicle) => {
      const key = vehicleKey(vehicle);
      return key === selectedVehicleId || !usedVehicleKeys.includes(key);
    }),
    [vehicles, selectedVehicleId, usedVehicleKeys],
  );
  const supportsRenewals = isRent2Buy && helperStatus.capabilities.includes("groups-renewals");
  const supportsAutomaticRenewals = supportsRenewals && helperStatus.capabilities.includes("groups-automatic-renewals");

  function setRenewalRun(on) {
    renewalRunningRef.current = on;
    setRenewalRunning(on);
  }

  async function setAutomaticRenewals(enabled) {
    try {
      await requestGroupRenewalHelper("SET_GROUP_RENEWAL_AUTOMATION", undefined, { enabled });
      setRenewalRun(false);
      setRenewalAutomatic(enabled);
      setRenewalPolling(enabled);
      setRenewalMessage(enabled ? "Automatic renewals enabled in this Edge profile." : "Automatic renewals paused.");
      if (enabled) {
        lastRenewalHeartbeat.current.at = 0;
        lastRenewalHeartbeat.current.attemptedAt = 0;
        void advanceRenewals();
      } else await reportRenewalHeartbeat("paused");
    } catch (error) {
      setRenewalMessage(error.message);
    }
  }

  async function deferAutomaticRenewals(until) {
    setRenewalPolling(false);
    await requestGroupRenewalHelper("DEFER_GROUP_RENEWAL_AUTOMATION", undefined, { until });
  }

  async function advanceRenewals() {
    if (renewalWork.current) return;
    renewalWork.current = true;
    try {
      const helper = await requestGroupRenewalHelper("GET_GROUP_RENEWAL_STATE");
      const automatic = helper.automatic && helper.driver;
      if (helper.driver && (automatic || helper.restrictionReason)) {
        const state = helper.restrictionReason ? "restricted" : helper.pending || helper.reviewPending ? "processing" : "ready";
        await reportRenewalHeartbeat(state, helper.restrictionReason, helper.approvalMonitor).catch(() => {});
        if (helper.restrictionReportPending && lastRenewalHeartbeat.current.state === "restricted") {
          await requestGroupRenewalHelper("ACK_GROUP_RENEWAL_RESTRICTION");
        }
      }
      for (const approval of helper.approvalReceipts || []) {
        await recordGroupApproval(approval);
        await requestGroupRenewalHelper("ACK_GROUP_RENEWAL_APPROVAL", approval.id);
      }
      if (helper.reviewPending) return;
      setRenewalAutomatic(Boolean(helper.automatic));
      if (helper.automatic && !helper.driver) setRenewalRun(false);
      setRenewalPending(Boolean(helper.pending));
      setRenewalDraft(helper.pending || null);
      if (helper.pending) {
        clearAutomaticRenewalClaim(helper.pending.id);
        return;
      }
      const result = helper.result;
      if (result) clearAutomaticRenewalClaim(result.jobId);
      if (!result && helper.restrictionReason) {
        setRenewalPolling(false);
        setRenewalMessage(helper.restrictionReason);
      }
      if (result?.status === "submitted") {
        const current = loadFacebookGroups();
        const item = current.find((group) => normalizeFacebookGroupUrl(group.url).toLowerCase() === result.groupUrl.toLowerCase());
        if (!item) throw new Error("Refresh the group records before saving this browser receipt.");
        const updated = Date.parse(item.lastPostedAt) >= Date.parse(result.postedAt) ? current :
          markGroupPosted(current, result.groupUrl, result);
        // Only acknowledge the browser's durable receipt after both CRM writes.
        await persistFacebookGroupsRemote(updated);
        await recordGroupPostActivity({ ...result, renewalDate: result.date });
        await renewalRequest({ action: "submission", groupUrl: result.groupUrl, registration: result.registration,
          postedAt: result.postedAt, runDate: result.date, jobId: result.jobId });
        saveFacebookGroups(updated, { remote: false });
        setGroups(updated);
        markVehicleUsed(result.registration, result.vehicleId);
        await requestGroupRenewalHelper("ACK_GROUP_RENEWAL_RESULT", result.jobId);
        setRenewalMessage(result.groupName + " · submission confirmed");
        return;
      }
      if (result) {
        await renewalRequest(result.status === "stop"
          ? { action: "stop", reason: result.reason, groupUrl: result.groupUrl, jobId: result.jobId,
            runDate: result.date, duplicateRisk: result.duplicateRisk }
          : { action: "outcome", groupUrl: result.groupUrl, runDate: result.date,
            jobId: result.jobId, status: result.status, reason: result.reason, duplicateRisk: result.duplicateRisk,
            failureStage: result.failureStage, attemptedAt: result.attemptedAt });
        await requestGroupRenewalHelper("ACK_GROUP_RENEWAL_RESULT", result.jobId);
        if (result.status === "stop") {
          setRenewalRun(false);
          setRenewalPolling(false);
          setRenewalAutomatic(false);
        }
        setRenewalMessage(result.groupName + " · " + result.reason);
        return;
      }
      if ((!renewalRunningRef.current && !automatic) || vehiclesLoading || (automatic && helper.wakeAt > Date.now())) return;
      const { today, latest, settings, nextRunAt } = await renewalRequest();
      if (!settings.enabled || latest?.date !== today || latest.stopped) {
        setRenewalRun(false);
        if (automatic) {
          const next = Date.parse(nextRunAt);
          const checkAgain = !settings.enabled || latest?.stopped ? 60 * 60_000 : 15 * 60_000;
          const wakeAt = latest?.date !== today ? Math.min(next || Infinity, Date.now() + checkAgain) : next;
          await deferAutomaticRenewals(new Date(Number.isFinite(wakeAt) ? wakeAt : Date.now() + checkAgain).toISOString());
        }
        setRenewalMessage(latest?.stopped?.reason || "No active renewal queue for today.");
        return;
      }
      const saved = automatic ? readAutomaticRenewalClaim() : null;
      const interrupted = saved?.date === today && latest.groups.find((item) => item.groupKey === saved.groupKey &&
        ["queued", "preparing"].includes(item.status));
      if (saved && !interrupted) clearAutomaticRenewalClaim(saved.jobId);
      const cleanGroup = latest.groups.find(item => item.status === "queued" && !item.review && !item.issues?.length);
      if (automatic && !interrupted && !cleanGroup && helperStatus.capabilities.includes("groups-renewal-reconciliation")) {
        const held = latest.groups.find(item => item.review && ["queued", "needs_attention", "failed"].includes(item.status));
        if (held) {
          setRenewalPolling(true);
          await requestGroupRenewalHelper("START_GROUP_RENEWAL_REVIEW", undefined, { review: {
            url: held.url, name: held.name, registration: registrationKey(held.review.registration), postedAt: held.review.postedAt,
            reviewKind: held.review.kind, permalink: held.review.permalink, identity: renewalReviewIdentity(held.review),
          } });
          return;
        }
      }
      const group = interrupted || cleanGroup || latest.groups.find((item) => item.status === "queued");
      if (!group) {
        setRenewalRun(false);
        if (automatic) await deferAutomaticRenewals(nextRunAt);
        setRenewalMessage("No further groups to prepare today. Review exceptions in Conversations & AI.");
        return;
      }
      if (automatic) setRenewalPolling(true);
      const renewal = { date: today, jobId: interrupted ? saved.jobId : crypto.randomUUID(), automatic };
      const hasAdvert = (item) => {
        const job = buildFacebookGroupPostJob({ group, vehicle: item, productKey, renewal });
        return job.caption && job.imageUrl && job.registration;
      };
      let vehicle = interrupted ? (vehicles || []).find((item) => vehicleKey(item) === saved.vehicleId && hasAdvert(item)) :
        rotationVehicles.find((item) => !usedVehicleKeys.includes(vehicleKey(item)) && hasAdvert(item));
      if (!vehicle && interrupted) {
        if (group.status === "preparing") await renewalRequest({ action: "outcome", groupUrl: group.url, jobId: saved.jobId,
          status: "failed", reason: "The selected van became unavailable before the browser received the job" });
        clearAutomaticRenewalClaim(saved.jobId);
        return;
      }
      if (!vehicle && automatic) {
        vehicle = (vehicles || []).find(hasAdvert);
        if (vehicle) {
          saveUsedVanKeys(productKey, []);
          setUsedVehicleKeys([]);
        }
      }
      if (!vehicle) {
        setRenewalRun(false);
        if (automatic) await deferAutomaticRenewals(new Date(Date.now() + 60 * 60_000).toISOString());
        setRenewalMessage("No unused eligible van has both a caption and an image.");
        return;
      }
      if (automatic) window.localStorage.setItem(AUTOMATIC_RENEWAL_CLAIM_KEY, JSON.stringify({
        date: today, groupKey: group.groupKey, jobId: renewal.jobId, vehicleId: vehicleKey(vehicle),
      }));
      const claimed = await renewalRequest({ action: "claim", groupUrl: group.url, jobId: renewal.jobId, automatic, registration: vehicle.registration || vehicle.reg });
      if (!claimed.prepare) {
        clearAutomaticRenewalClaim(renewal.jobId);
        setRenewalMessage(group.name + " · " + claimed.reason);
        return;
      }
      try {
        await prepareFacebookGroupPost({ group, vehicle, productKey, renewal });
        clearAutomaticRenewalClaim(renewal.jobId);
        setRenewalPending(true);
        setRenewalMessage(group.name + " · preparing the stock photo and caption.");
      } catch (error) {
        // An acknowledgement can be lost after the extension already stored the job.
        const current = await requestGroupRenewalHelper("GET_GROUP_RENEWAL_STATE");
        if (!current.pending && !current.result) {
          await renewalRequest({ action: "outcome", groupUrl: group.url, jobId: renewal.jobId,
            status: "failed", reason: error.message });
          clearAutomaticRenewalClaim(renewal.jobId);
        }
      }
    } catch (error) {
      setRenewalRun(false);
      setRenewalPolling(false);
      setRenewalPending(false);
      setRenewalMessage(error.message || "Could not continue the renewal queue.");
    } finally {
      renewalWork.current = false;
    }
  }

  useEffect(() => {
    if (!supportsRenewals) return undefined;
    void advanceRenewals();
    function onRenewalWake(event) {
      if (event.source === window && event.origin === window.location.origin &&
          event.data?.source === "vfc-facebook-helper" && event.data?.type === "VFC_GROUP_RENEWAL_WAKE") void advanceRenewals();
    }
    window.addEventListener("message", onRenewalWake);
    const timer = renewalRunning || renewalPending || renewalPolling ? window.setInterval(advanceRenewals, 4000) : null;
    return () => {
      if (timer !== null) window.clearInterval(timer);
      window.removeEventListener("message", onRenewalWake);
    };
  }, [supportsRenewals, renewalRunning, renewalPending, renewalPolling, rotationVehicles, usedVehicleKeys, vehiclesLoading]);

  async function reviewRenewalDraft() {
    if (!renewalDraft) return;
    const copied = await copyGroupCaptionForFallback(renewalDraft.caption);
    try {
      await requestGroupRenewalHelper("OPEN_GROUP_RENEWAL_DRAFT", renewalDraft.id);
      setRenewalMessage(copied ? "Caption copied. Paste it and approve with Facebook’s Post button." : "Use Copy caption in the Facebook draft.");
    } catch (error) {
      setRenewalMessage(error.message);
    }
  }

  const counts = useMemo(() => {
    const result = {
      total: activeGroups.length,
      new: newGroups.length,
      membershipPending: membershipPendingGroups.length,
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
  }, [activeGroups, newGroups, membershipPendingGroups, awaitingGroups, provenGroups, dueGroups, archivedGroups]);

  useEffect(() => {
    setUsedVehicleKeys(loadUsedVanKeys(productKey));
    setSelectedVehicleId("");
  }, [productKey]);

  useEffect(() => {
    let cancelled = false;

    hydrateFacebookGroups(loadFacebookGroups())
      .then((restored) => {
        if (!cancelled) setGroups((current) => {
          const merged = mergeFacebookGroupsByRecentPostState(current, restored);
          saveFacebookGroups(merged);
          return merged;
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function checkHelper() {
      const status = await getFacebookHelperStatus();
      if (cancelled) return;
      setHelperStatus({ checking: false, ...status });

      if (status.connected && status.capabilities.includes("groups-state-recovery")) {
        try {
          const response = await requestFacebookGroupRecoverySnapshot();
          if (cancelled) return;
          const approvalItems = Array.isArray(response?.snapshot?.approvalItems)
            ? response.snapshot.approvalItems
            : [];
          setGroups((current) => {
            const recovered = recoverFacebookGroupsFromSnapshot(current, response?.snapshot || {});
            saveFacebookGroups(recovered);
            return recovered;
          });
          if (approvalItems.length) {
            setMessage(`Recovered ${approvalItems.length} Facebook group post${approvalItems.length === 1 ? "" : "s"} still waiting for approval from the browser helper.`);
          }
        } catch {
          // Recovery is best-effort. Persistent server state remains the source of truth.
        }
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
        markVehicleUsed(postEvent.registration, selectedVehicleId);
        recordGroupPostActivity({
          groupUrl: postEvent.groupUrl,
          groupName: postEvent.groupName,
          registration: postEvent.registration,
          postedAt: postEvent.postedAt,
        }).catch((error) => {
          setMessage(`${postEvent.groupName || "Facebook group"} was recorded as posted, but Content Operations could not be updated: ${error.message || "unknown error"}`);
        });
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

      if (payload.type === GROUP_POST_STATUS_PROGRESS) {
        if (payload.productKey && payload.productKey !== productKey) return;
        persist((current) => markGroupPostStatus(current, payload.result));
        void recordGroupApproval(payload.result).catch(() => {});
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
        const declined = results.filter((item) => item.declined).length;
        const unavailable = results.filter((item) => item.unavailable).length;
        setBusy("");
        setMessage(
          `Acceptance check finished: ${accepted} accepted, ${pending} still pending, ${Math.max(0, results.length - accepted - pending - declined - unavailable)} not visible yet${declined ? `, ${declined} declined and archived` : ""}${unavailable ? `, ${unavailable} unavailable group${unavailable === 1 ? "" : "s"} archived` : ""}.`,
        );
      }

      if (payload.type === GROUP_POST_STATUS_EVENT && payload.event) {
        const statusEvent = payload.event;
        if (statusEvent.crmOrigin && statusEvent.crmOrigin !== window.location.origin) return;
        if (statusEvent.productKey && statusEvent.productKey !== productKey) return;
        persist((current) => markGroupPostStatus(current, statusEvent));
        if (!statusEvent.automatic) void recordGroupApproval(statusEvent).catch(() => {});
        window.postMessage({
          source: "vfc-marketing-crm",
          type: GROUP_POST_STATUS_EVENT_ACK,
          eventId: statusEvent.id || "",
        }, window.location.origin);

        if (statusEvent.accepted) {
          setMessage(
            `${statusEvent.groupName || "Facebook group"} has accepted/visible ${statusEvent.registration || "the advert"}. It has moved into Proven / Hot automatically.`,
          );
        } else if (statusEvent.declined) {
          setMessage(
            `${statusEvent.groupName || "Facebook group"} declined ${statusEvent.registration || "the advert"} and has been archived automatically.`,
          );
        } else if (statusEvent.unavailable) {
          setMessage(
            `${statusEvent.groupName || "Facebook group"} is no longer available and has been archived automatically.`,
          );
        }
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [groups, productKey, selectedVehicleId, vehicles]);

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
      const generalGroups = activeGroups.filter((group) => groupPipeline(group) !== "membership_pending");
      await startFacebookGroupInspection(generalGroups, productKey, 12);
      setMessage("Live group checks are running. Dead/unavailable groups will fall out of the active pipelines automatically.");
    } catch (error) {
      setBusy("");
      setMessage(error.message || "Could not start live group checks.");
    }
  }

  async function checkPendingMembership() {
    if (busy || !membershipPendingGroups.length) return;
    if (!(await requireGroupsHelper())) return;
    setBusy("membership-inspection");
    setMessage(`Checking ${membershipPendingGroups.length} pending membership request${membershipPendingGroups.length === 1 ? "" : "s"} against Facebook.`);
    try {
      await startFacebookGroupInspection(
        membershipPendingGroups,
        productKey,
        Math.min(25, membershipPendingGroups.length),
      );
      setMessage("Membership checks are running. Approved groups will return to New & Testing automatically.");
    } catch (error) {
      setBusy("");
      setMessage(error.message || "Could not check pending memberships.");
    }
  }

  async function checkPostAcceptance() {
    if (busy) return;
    if (!(await requireGroupsHelper())) return;
    setBusy("post-status");
    const batchSize = Math.min(25, awaitingGroups.length);
    setMessage(`Checking the next ${batchSize} of ${awaitingGroups.length} posted group${awaitingGroups.length === 1 ? "" : "s"} to see which adverts are visible, still pending, or unavailable.`);
    try {
      await startFacebookPostStatusCheck(activeGroups, productKey, Math.min(25, awaitingGroups.length || 25));
      setMessage("Acceptance checks are running through the posted groups. Results will return here automatically.");
    } catch (error) {
      setBusy("");
      setMessage(error.message || "Could not start the post acceptance check.");
    }
  }

  async function copyGroupCaptionForFallback(caption) {
    const text = String(caption || "");
    if (!text || !navigator.clipboard?.writeText) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  async function preparePost(group) {
    if (!selectedVehicle) {
      setMessage("Choose a van at the top of the page first.");
      return;
    }

    const caption = selectedVehicle.caption || "";
    const captionCopyPromise = copyGroupCaptionForFallback(caption);

    if (!(await requireGroupsHelper())) return;

    const captionCopied = await captionCopyPromise;
    setBusy(`post:${group.id}`);
    setMessage(`Preparing ${selectedVehicle.registration || selectedVehicle.reg || "the selected van"} for ${group.name}…`);
    try {
      await prepareFacebookGroupPost({
        group,
        vehicle: selectedVehicle,
        caption,
        productKey,
        captionCopied,
      });
      setMessage(
        captionCopied
          ? `${group.name} is opening in Facebook. The helper will prepare the advert, with the formatted caption also held on your clipboard as a safe fallback.`
          : `${group.name} is opening in Facebook. The helper will prepare the advert. When you click Facebook's Post button, the CRM will record that automatically and start tracking acceptance.`,
      );
    } catch (error) {
      setMessage(error.message || "Could not hand this group post to the browser helper.");
    } finally {
      setBusy("");
    }
  }

  function markVehicleUsed(registration, fallbackId = "") {
    const wanted = registrationKey(registration);
    const matched = (vehicles || []).find((vehicle) =>
      registrationKey(vehicle?.registration || vehicle?.reg || vehicle?.title) === wanted
    );
    const key = vehicleKey(matched) || fallbackId;
    if (!key) return;

    setUsedVehicleKeys((current) => {
      if (current.includes(key)) return current;
      const next = [...current, key];
      saveUsedVanKeys(productKey, next);
      return next;
    });
  }

  function resetVanRotation() {
    saveUsedVanKeys(productKey, []);
    setUsedVehicleKeys([]);
    setMessage("Van rotation reset. Full stock is available again.");
  }

  function persistGroups(updated) {
    setGroups(updated);
    saveFacebookGroups(updated);
  }

  function confirmPosted(group) {
    const registration = clean(selectedVehicle?.registration || selectedVehicle?.reg || selectedVehicle?.title);
    const updated = markGroupPosted(groups, group.url, { registration });
    persistGroups(updated);
    markVehicleUsed(registration, selectedVehicleId);
    recordGroupPostActivity({
      groupUrl: group.url,
      groupName: group.name,
      registration,
      postedAt: new Date().toISOString(),
    }).catch((error) => {
      setMessage(`${group.name} was marked posted, but Content Operations could not be updated: ${error.message || "unknown error"}`);
    });
    setMessage(`${group.name} marked posted manually. It is now awaiting an acceptance check.`);
  }

  function confirmAccepted(group) {
    const updated = markGroupAccepted(groups, group.url, {
      registration: group.pendingRegistration,
    });
    persistGroups(updated);
    void recordGroupApproval({ url: group.url, registration: group.pendingRegistration, postedAt: group.lastPostedAt, accepted: true }).catch(() => {});
    setMessage(`${group.name} is now Proven/Hot. It will come back to the top when its repeat interval is due.`);
  }

  function confirmDeclined(group) {
    const updated = markGroupPostStatus(groups, {
      url: group.url,
      registration: group.pendingRegistration,
      declined: true,
      checkedAt: new Date().toISOString(),
    });
    persistGroups(updated);
    void recordGroupApproval({ url: group.url, registration: group.pendingRegistration, postedAt: group.lastPostedAt, declined: true }).catch(() => {});
    setMessage(`${group.name} marked declined and moved straight to Archived.`);
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
      <article className={`posting-card${due.due ? " posting-card--due" : ""}`} key={group.id || group.url}>
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
            <span>Joined: {group.membershipPending ? "Pending approval" : yesNoUnknown(group.joined)}</span>
            <span>Can post: {yesNoUnknown(group.canPost)}</span>
            <span>Post approval: {yesNoUnknown(group.approvalRequired, "Required", "Not seen")}</span>
            <span>Links: {yesNoUnknown(group.linksAllowed, "Allowed", "Restricted")}</span>
          </div>

          <div className="notice">
            <strong>Post status:</strong> {postStatusLabel(group)}
            {group.pendingRegistration ? ` · ${group.pendingRegistration}` : ""}
            <br />
            Last post: <strong>{dateLabel(group.lastPostedAt)}</strong>
            {" · "}Accepted posts: <strong>{Number(group.acceptedPostCount || 0)}</strong>
            {group.lastPostDetectedState ? (
              <>
                <br />
                Last Facebook check: <strong>{group.lastPostDetectedState}</strong>
                {group.lastPostMatchMethod ? ` · ${group.lastPostMatchMethod}` : ""}
                {` · CRM: ${pipeline === "proven" ? "Proven / Hot" : pipeline === "archived" ? "Archived" : "Awaiting"}`}
              </>
            ) : null}
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
                  <>
                    <button className="button button--ghost" type="button" onClick={() => confirmAccepted(group)}>
                      Mark Accepted
                    </button>
                    <button className="button button--ghost" type="button" onClick={() => confirmDeclined(group)}>
                      Mark Declined
                    </button>
                  </>
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
                ? "Find, test and retain local van sales, car-and-van classifieds and marketplace groups that actually accept Rent2Buy adverts."
                : "Find, test and retain UK van sales, car-and-van classifieds and vehicle marketplace groups that actually accept Van Finance adverts."}
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
              {busy === "post-status"
                ? "Checking Posts…"
                : counts.awaiting > 25
                  ? `Check next 25 of ${counts.awaiting} Awaiting Posts`
                  : `Check ${counts.awaiting} Awaiting Posts`}
            </button>
          </div>
        </div>

        <div className="posting-summary-strip">
          {[
            ["Active", counts.total],
            ["New / Testing", counts.new],
            ["Pending Membership", counts.membershipPending],
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
              ? `v${helperStatus.version || "unknown"} connected${helperStatus.capabilities.includes("groups-discovery") ? " · Groups ready" : " · Groups support missing"}${helperStatus.capabilities.includes("groups-auto-approval-monitor") ? " · approval monitor on" : ""}`
              : "not connected to this CRM tab"}
          {helperStatus.hostname ? ` · ${helperStatus.hostname}` : ""}
        </div>

        {message ? <div className="notice">{message}</div> : null}
        {isRent2Buy ? <div className="notice">
          <strong>Daily Proven / Hot renewals</strong>
          <p>{renewalAutomatic ? "The helper posts each eligible renewal in this Edge profile and records Facebook’s results." :
            "Enable automatic renewals for previously approved adverts, or review drafts one by one."}</p>
          {supportsAutomaticRenewals ? <button className="button button--small" type="button" disabled={Boolean(busy)}
            onClick={() => void setAutomaticRenewals(!renewalAutomatic)}>
            {renewalAutomatic ? "Pause automatic renewals" : "Enable automatic renewals"}
          </button> : null}
          {!renewalAutomatic ? <button className="button button--small" type="button" disabled={!supportsRenewals || Boolean(busy)}
            onClick={() => setRenewalRun(!renewalRunning)}>
            {renewalRunning ? "Pause after this group" : "Prepare today’s renewal queue"}
          </button> : null}
          {renewalDraft && !renewalDraft.renewal?.automatic ? <details>
            <summary>{renewalDraft.prepared ? "Review prepared advert" : "Preparing advert"} · {renewalDraft.groupName}</summary>
            <p>{renewalDraft.registration}</p>
            <img src={renewalDraft.imageUrl} alt="Prepared stock photo" width="200" />
            <p style={{ whiteSpace: "pre-wrap" }}>{renewalDraft.caption}</p>
            <button className="button button--small" type="button" onClick={reviewRenewalDraft}>Copy caption and open Facebook draft</button>
          </details> : null}
          {renewalMessage ? <p role="status">{renewalMessage}</p> : null}
        </div> : null}
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
            {dueGroups.slice(0, isRent2Buy ? 30 : 8).map(renderGroupCard)}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>Post setup</h3>
            <p>Select the van once, then use it across the groups you want to test or revisit. Posted vans drop out of the rotation once you move on.</p>
          </div>
          <div className="card-actions">
            <button className="button button--ghost" type="button" onClick={resetVanRotation} disabled={!usedVehicleKeys.length}>
              Reset Vans
            </button>
          </div>
        </div>
        {vehiclesError ? <div className="notice notice--error">{vehiclesError}</div> : null}
        <label className="field">
          <span>Van</span>
          <select value={selectedVehicleId} onChange={(event) => setSelectedVehicleId(event.target.value)}>
            <option value="">Choose a van…</option>
            {rotationVehicles.map((vehicle) => (
              <option key={vehicleKey(vehicle)} value={vehicleKey(vehicle)}>
                {vehicleLabel(vehicle)}
              </option>
            ))}
          </select>
        </label>
        {selectedVehicle ? (
          <div className="notice">
            Ready: <strong>{vehicleLabel(selectedVehicle)}</strong>. The helper uses the existing {isRent2Buy ? "Rent2Buy" : "Van Finance"} Facebook copy and stock image.
            {" "}Rotation remaining: <strong>{Math.max(0, (vehicles || []).length - usedVehicleKeys.length)}</strong>.
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h3>{showArchived ? "Archived / dead groups" : pipelineView === "proven" ? "Proven / Hot groups" : pipelineView === "awaiting" ? "Awaiting approval / visibility" : pipelineView === "membership_pending" ? "Pending membership" : "New & testing groups"}</h3>
            <p>
              {showArchived
                ? "Unavailable, declined or unwanted groups stay out of the working pipelines but can be restored."
                : pipelineView === "proven"
                  ? "Only groups where an advert has been confirmed visible/accepted."
                  : pipelineView === "awaiting"
                    ? "Posts already sent to Facebook and waiting for approval or visibility checks."
                    : pipelineView === "membership_pending"
                      ? "Groups where your join request is still waiting for admin approval. Once Facebook shows you as joined, they return to New & Testing."
                      : "Fresh vehicle-sales and classified-group discoveries you have not posted to yet."}
            </p>
          </div>
          <div className="card-actions">
            <button className={`button ${!showArchived && pipelineView === "new" ? "button--primary" : "button--ghost"}`} type="button" onClick={() => { setShowArchived(false); setPipelineView("new"); }}>
              New & Testing ({counts.new})
            </button>
            <button className={`button ${!showArchived && pipelineView === "membership_pending" ? "button--primary" : "button--ghost"}`} type="button" onClick={() => { setShowArchived(false); setPipelineView("membership_pending"); }}>
              Pending Membership ({counts.membershipPending})
            </button>
            <button className={`button ${!showArchived && pipelineView === "awaiting" ? "button--primary" : "button--ghost"}`} type="button" onClick={() => { setShowArchived(false); setPipelineView("awaiting"); }}>
              Awaiting ({counts.awaiting})
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
          {!showArchived && pipelineView === "membership_pending" ? (
            <button
              className="button button--primary"
              type="button"
              onClick={checkPendingMembership}
              disabled={Boolean(busy) || !counts.membershipPending}
            >
              {busy === "membership-inspection"
                ? "Checking Membership…"
                : `Check Pending Membership (${counts.membershipPending})`}
            </button>
          ) : null}
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {["All", "Green", "Amber", "Red"].map((value) => <option key={value}>{value}</option>)}
          </select>
          <select value={segmentFilter} onChange={(event) => setSegmentFilter(event.target.value)}>
            {segments.map((value) => <option key={value}>{value}</option>)}
          </select>
        </div>

        {visibleGroups.length === 0 ? (
          <div className="empty-state">
            {showArchived
              ? "No archived groups."
              : pipelineView === "proven"
                ? "No proven groups yet. Once Facebook accepts a test advert, it will move here."
                : pipelineView === "awaiting"
                  ? "No posts are waiting for approval or visibility checks."
                  : pipelineView === "membership_pending"
                    ? "No group membership requests are currently pending."
                    : "No new groups match this view yet. Run discovery to build the pipeline."}
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
