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

  function $(id) { return document.getElementById(id); }
  function readPrefs() {
    try { return { ...SECTION_DEFAULTS, ...JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") }; }
    catch { return { ...SECTION_DEFAULTS }; }
  }
  function writePrefs(prefs) {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch {}
  }
  function injectStyles() {
    if ($("campaignUiPolishStyles")) return;
    const style = document.createElement("style");
    style.id = "campaignUiPolishStyles";
    style.textContent = `
      body { overflow-x:hidden; }
      .detail-grid { grid-template-columns:minmax(420px, 44%) minmax(520px, 56%); }
      .detail-grid > .card.detail-stack { position:sticky; top:16px; }
      .workflow-steps { display:grid; grid-template-columns:repeat(5, minmax(120px, 1fr)); gap:8px; }
      .workflow-step { border:1px solid var(--line); border-radius:9px; padding:9px 10px; background:#fff; display:flex; align-items:center; gap:8px; font-weight:900; color:#475569; }
      .workflow-step span { width:24px; height:24px; border-radius:999px; display:inline-flex; align-items:center; justify-content:center; background:#e2e8f0; color:#334155; font-size:12px; }
      .workflow-step.complete { border-color:#bbf7d0; background:#f0fdf4; color:#166534; }
      .workflow-step.complete span { background:var(--green); color:#fff; }
      .workflow-step.current { border-color:#bfdbfe; background:#eef4ff; color:#1d4ed8; }
      .workflow-step.current span { background:var(--blue); color:#fff; }
      .workflow-step.blocked { background:#f8fafc; color:#64748b; }
      .collapsible-card { display:grid; gap:12px; }
      .collapsible-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
      .collapsible-title { display:grid; gap:3px; }
      .collapsible-summary { color:var(--muted); font-size:12px; font-weight:850; }
      .collapsible-toggle { min-width:92px; }
      .collapsible-card.is-collapsed .collapsible-body { display:none; }
      .campaign-preview-title { margin:0 0 10px; font-weight:900; color:#334155; }
      .preview-frame { min-height:min(82vh, 940px); max-height:none; overflow:auto; }
      .preview-frame.mobile-mode { align-items:flex-start; overflow-x:hidden; }
      #previewFrame { min-height:min(78vh, 900px); }
      #previewFrame.mobile { width:390px; max-width:100%; min-height:820px; }
      @media (max-width:1280px) {
        .detail-grid { grid-template-columns:1fr; }
        .detail-grid > .card.detail-stack { position:static; }
        .workflow-steps { grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); }
      }
      @media (max-width:760px) {
        main { padding:12px; }
        .page-stack { gap:12px; }
        .workflow-steps { grid-template-columns:1fr; }
        .collapsible-heading { display:grid; }
        .toolbar button { white-space:normal; }
        #previewFrame.mobile { width:340px; }
      }
    `;
    document.head.appendChild(style);
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
      if (/authorised/i.test(text)) return "Brevo Authorised";
      if (/rejected/i.test(text)) return "Brevo Rejected";
      if (/not fully configured/i.test(text)) return "Brevo Not Configured";
      if (/could not be reached/i.test(text)) return "Brevo Unreachable";
      return "Checking Brevo";
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
  function updateWorkflow() {
    const node = $("campaignWorkflowSteps");
    const detail = $("detailSection");
    if (!node || !detail || detail.classList.contains("hidden")) return;
    const hasCampaign = Boolean($("detailTitle")?.textContent?.trim());
    const audienceText = $("audienceCounts")?.innerText || "";
    const hasAudience = /Final send count/i.test(audienceText);
    const ready = /READY TO SEND/i.test($("readyPanel")?.textContent || "");
    const brevo = $("brevoConnectionBanner")?.innerText || "";
    const testReady = /authorised/i.test(brevo);
    const productionReady = ready && testReady;
    const steps = [
      ["Campaign", hasCampaign, !hasCampaign],
      ["Audience", hasAudience, hasCampaign && !hasAudience],
      ["Readiness", ready, hasAudience && !ready],
      ["Test", testReady, ready && !testReady],
      ["Production Send", productionReady, testReady && !productionReady],
    ];
    node.innerHTML = steps.map(([label, complete, current], index) => `<div class="workflow-step ${complete ? "complete" : current ? "current" : "blocked"}"><span>${complete ? "✓" : index + 1}</span>${label}</div>`).join("");
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
    injectStyles();
    addWorkflow();
    addPreviewLabel();
    const prefs = readPrefs();
    document.querySelectorAll("#detailSection > .detail-stack > section.card").forEach((section) => makeCollapsible(section, prefs));
    updateWorkflow();
    updatePreviewLabel();
    document.querySelectorAll("[data-section-summary]").forEach((node) => { node.textContent = sectionSummary(node.dataset.sectionSummary); });
  }
  document.addEventListener("click", (event) => {
    if (event.target?.id === "desktopPreview" || event.target?.id === "mobilePreview") setTimeout(refreshPolish, 0);
  });
  setInterval(refreshPolish, 900);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refreshPolish);
  else refreshPolish();
})();
