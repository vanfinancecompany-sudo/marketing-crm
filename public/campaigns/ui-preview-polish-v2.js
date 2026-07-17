(() => {
  const STORAGE_KEY = "marketingCampaignUiSections";
  const SECTION_DEFAULTS = {
    "Campaign Settings": true,
    Audience: true,
    Readiness: true,
    Sending: true,
    "Campaign Summary": false,
    "Frozen Template Snapshot": false,
  };
  const SUCCESS_SEND_STATUSES = new Set(["accepted", "completed", "delivered", "opened", "clicked"]);
  const WARNING_SEND_STATUSES = new Set(["partially_failed", "submission_unknown"]);

  function $(id) { return document.getElementById(id); }
  function parseCount(value) {
    const number = Number(String(value || "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(number) ? number : 0;
  }
  function readPrefs() {
    try { return { ...SECTION_DEFAULTS, ...JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") }; }
    catch { return { ...SECTION_DEFAULTS }; }
  }
  function writePrefs(prefs) {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch {}
  }
  function sectionName(section) {
    if (section.id === "campaignSendingSection") return "Sending";
    if (section.querySelector("#detailTitle")) return "Campaign Settings";
    return (section.querySelector("h3, h2")?.textContent || "Section").trim();
  }
  function sectionSummary(name) {
    if (name === "Audience") {
      const audience = $("audienceCounts")?.innerText || "";
      const deliverable = audience.match(/Deliverable customers\s+([\d,]+)/i)?.[1];
      return deliverable ? `${deliverable} deliverable` : "Not selected";
    }
    if (name === "Readiness") return $("readyPanel")?.textContent?.trim() || "Not Ready";
    if (name === "Sending") {
      const text = $("brevoConnectionBanner")?.innerText || "";
      const provider = text.match(/^(SendGrid|SMTP2GO|Brevo)/i)?.[1] || "Email provider";
      if (/configured for Mail Send/i.test(text)) return `${provider} Configured for Mail Send`;
      if (/authorised/i.test(text)) return `${provider} Authorised`;
      if (/rejected/i.test(text)) return `${provider} Rejected`;
      if (/not fully configured/i.test(text)) return `${provider} Not Configured`;
      if (/could not be reached/i.test(text)) return `${provider} Unreachable`;
      return `Checking ${provider}`;
    }
    if (name === "Campaign Summary") {
      const recipients = Array.from(document.querySelectorAll("#summaryGrid .summary-item")).find((item) => /Estimated recipients/i.test(item.innerText));
      return recipients ? recipients.innerText.replace(/Estimated recipients/i, "Estimated recipients ").trim() : "Overview";
    }
    if (name === "Frozen Template Snapshot") {
      const vehicles = Array.from(document.querySelectorAll("#snapshotGrid .snapshot-item")).find((item) => /Selected Vehicles/i.test(item.innerText));
      return vehicles ? vehicles.innerText.replace(/Selected Vehicles/i, "Selected vehicles ").trim() : "Snapshot saved";
    }
    return $("detailStatus")?.textContent?.trim() || "Draft";
  }
  function makeCollapsible(section, prefs) {
    const name = sectionName(section);
    if (!SECTION_DEFAULTS.hasOwnProperty(name) || section.dataset.collapsibleReady) return;
    section.dataset.collapsibleReady = "true";
    section.classList.add("collapsible-card");
    const children = Array.from(section.childNodes);
    let heading = section.querySelector(":scope > .card-header");
    if (!heading) {
      const title = section.querySelector(":scope > h3, :scope > h2");
      heading = document.createElement("div");
      heading.className = "collapsible-heading";
      const titleWrap = document.createElement("div");
      titleWrap.className = "collapsible-title";
      if (title) titleWrap.appendChild(title);
      heading.appendChild(titleWrap);
      section.insertBefore(heading, section.firstChild);
    } else {
      heading.classList.add("collapsible-heading");
      heading.querySelector("div")?.classList.add("collapsible-title");
    }
    const summary = document.createElement("span");
    summary.className = "collapsible-summary";
    summary.dataset.sectionSummary = name;
    const titleHost = heading.querySelector(".collapsible-title") || heading.firstElementChild || heading;
    titleHost.appendChild(summary);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "collapsible-toggle";
    toggle.dataset.sectionToggle = name;
    heading.appendChild(toggle);
    const body = document.createElement("div");
    body.className = "collapsible-body";
    children.filter((node) => node !== heading && node.parentNode === section).forEach((node) => body.appendChild(node));
    section.appendChild(body);
    const setOpen = (open) => {
      section.classList.toggle("is-collapsed", !open);
      toggle.textContent = open ? "Hide" : "Show";
      toggle.setAttribute("aria-expanded", String(open));
      prefs[name] = open;
      writePrefs(prefs);
    };
    toggle.addEventListener("click", () => setOpen(section.classList.contains("is-collapsed")));
    setOpen(Boolean(prefs[name]));
  }
  function addWorkflow() {
    const detail = $("detailSection");
    if (!detail || $("campaignWorkflowSteps")) return;
    const card = document.createElement("section");
    card.id = "campaignWorkflowSteps";
    card.className = "card workflow-steps";
    detail.parentNode.insertBefore(card, detail);
  }
  function normaliseHistoryRow(send) {
    if (!send) return null;
    const type = String(send.send_type || send.type || "").trim().toLowerCase();
    const status = String(send.status || "").trim().toLowerCase();
    if (!type || !status) return null;
    return {
      type,
      status,
      requested: parseCount(send.requested_count ?? send.requested),
      accepted: parseCount(send.sent_count ?? send.accepted),
      failed: parseCount(send.failed_count ?? send.failed),
    };
  }
  function readSendHistory() {
    const loadedHistory = window.marketingCampaignSendingState?.history;
    if (Array.isArray(loadedHistory)) return loadedHistory.map(normaliseHistoryRow).filter(Boolean);
    return Array.from(document.querySelectorAll("#sendHistoryRows tr")).map((row) => {
      const cells = Array.from(row.cells || []);
      if (cells.length < 8) return null;
      const type = cells[0].textContent.trim().toLowerCase();
      const status = cells[2].textContent.trim().toLowerCase();
      if (!type || /no .*history|migration/i.test(type)) return null;
      return normaliseHistoryRow({
        type,
        status,
        requested: cells[3].textContent,
        accepted: cells[4].textContent,
        failed: cells[5].textContent,
      });
    }).filter(Boolean);
  }
  function updateWorkflow() {
    const node = $("campaignWorkflowSteps");
    const detail = $("detailSection");
    if (!node || !detail || detail.classList.contains("hidden")) return;
    const hasCampaign = Boolean($("detailTitle")?.textContent?.trim());
    const audienceText = $("audienceCounts")?.innerText || "";
    const finalSendCount = parseCount(audienceText.match(/Final send count\s+([\d,]+)/i)?.[1]);
    const hasAudience = finalSendCount > 0;
    const ready = /READY TO SEND/i.test($("readyPanel")?.textContent || "");
    const providerStatus = $("brevoConnectionBanner")?.innerText || "";
    const providerAuthorised = /authorised|configured for Mail Send/i.test(providerStatus);
    const history = readSendHistory();
    const testComplete = history.some((send) => send.type.includes("test") && SUCCESS_SEND_STATUSES.has(send.status) && send.accepted > 0 && send.failed === 0);
    const productionRows = history.filter((send) => send.type.includes("production"));
    const productionWarning = productionRows.some((send) => WARNING_SEND_STATUSES.has(send.status));
    const productionComplete = productionRows.some((send) => SUCCESS_SEND_STATUSES.has(send.status) && send.accepted > 0);
    const productionLabel = productionComplete ? "Production batch sent" : "Production Send";
    const steps = [
      { label: "Campaign", state: hasCampaign ? "complete" : "blocked" },
      { label: "Audience", state: hasAudience ? "complete" : hasCampaign ? "current" : "blocked" },
      { label: "Readiness", state: ready ? "complete" : hasAudience ? "current" : "blocked" },
      { label: "Test", state: testComplete ? "complete" : providerAuthorised ? "current" : "blocked" },
      { label: productionLabel, state: productionComplete ? "complete" : productionWarning ? "warning" : ready && providerAuthorised ? "current" : "blocked" },
    ];
    node.innerHTML = steps.map((step, index) => {
      const marker = step.state === "complete" ? "✓" : step.state === "warning" ? "!" : index + 1;
      return `<div class="workflow-step ${step.state}"><span>${marker}</span>${step.label}</div>`;
    }).join("");
  }
  function addPreviewLabel() {
    const shell = $("previewFrameShell");
    if (!shell || $("campaignPreviewModeLabel")) return;
    const label = document.createElement("p");
    label.id = "campaignPreviewModeLabel";
    label.className = "campaign-preview-title";
    shell.parentNode.insertBefore(label, shell);
  }
  function updatePreviewLabel() {
    const label = $("campaignPreviewModeLabel");
    if (!label) return;
    label.textContent = $("previewFrame")?.classList.contains("mobile") ? "Mobile email preview" : "Desktop email preview";
  }
  function refreshPolish() {
    addWorkflow();
    addPreviewLabel();
    const prefs = readPrefs();
    document.querySelectorAll("#detailSection > .detail-stack > section.card").forEach((section) => makeCollapsible(section, prefs));
    updateWorkflow();
    updatePreviewLabel();
    document.querySelectorAll("[data-section-summary]").forEach((node) => { node.textContent = sectionSummary(node.dataset.sectionSummary); });
  }
  function observeSendHistory() {
    const target = $("sendHistoryRows");
    if (!target || target.dataset.workflowObserved) return;
    target.dataset.workflowObserved = "true";
    new MutationObserver(() => refreshPolish()).observe(target, { childList: true, subtree: true, characterData: true });
  }
  document.addEventListener("click", (event) => {
    if (event.target?.id === "desktopPreview" || event.target?.id === "mobilePreview") setTimeout(refreshPolish, 0);
  });
  window.addEventListener("marketingCampaignSendingStateChanged", () => setTimeout(refreshPolish, 0));
  setInterval(() => { observeSendHistory(); refreshPolish(); }, 900);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { observeSendHistory(); refreshPolish(); });
  else { observeSendHistory(); refreshPolish(); }
})();
