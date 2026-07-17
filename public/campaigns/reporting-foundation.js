(() => {
  const STORAGE_KEY = "marketingCustomerDatabaseApiKey";
  const API_HEADER = "x-marketing-customer-database-key";
  const REPORTING_API = "/api/marketing-template-campaign-reporting";
  const fmt = new Intl.NumberFormat("en-GB");
  const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short" });

  const state = {
    selectedCampaignId: "",
    reporting: null,
    loading: false,
  };

  function $(id) { return document.getElementById(id); }
  function escapeHtml(value) {
    return String(value || "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }
  function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : dateFmt.format(date);
  }
  function getStoredKey() {
    try { return window.localStorage.getItem(STORAGE_KEY) || ""; } catch { return ""; }
  }
  async function reportingApi(action, payload = {}) {
    const response = await fetch(REPORTING_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", [API_HEADER]: getStoredKey() },
      body: JSON.stringify({ action, ...payload }),
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok || data.ok === false) {
      const error = new Error(data.message || "Campaign reporting request failed.");
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function currentCampaignId() {
    const selected = document.querySelector("#campaignRows tr.is-selected button[data-open]");
    if (selected?.dataset.open) return selected.dataset.open;
    const openButtons = Array.from(document.querySelectorAll("#campaignRows button[data-open]")).filter((button) => {
      const row = button.closest("tr");
      return row && $("detailTitle") && row.innerText.includes($("detailTitle").textContent.trim());
    });
    return openButtons[0]?.dataset.open || "";
  }
  function statusBadge(status) {
    const safe = escapeHtml(status || "unknown");
    let cls = "neutral";
    if (["accepted", "sent", "delivered", "opened", "clicked", "completed"].includes(status)) cls = "green";
    else if (["failed", "hard_bounced", "blocked", "complained", "unsubscribed"].includes(status)) cls = "red";
    else if (["soft_bounced", "deferred", "submission_unknown", "partially_failed"].includes(status)) cls = "amber";
    else if (["pending", "preparing", "sending"].includes(status)) cls = "blue";
    return `<span class="badge ${cls}">${safe}</span>`;
  }
  function installStyles() {
    if ($("campaignReportingStyles")) return;
    const style = document.createElement("style");
    style.id = "campaignReportingStyles";
    style.textContent = `
      .reporting-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); gap:10px; margin-top:12px; }
      .reporting-card { border:1px solid var(--line); border-radius:8px; padding:10px; background:var(--soft); }
      .reporting-card strong { display:block; color:var(--muted); font-size:12px; text-transform:uppercase; }
      .reporting-card b { display:block; margin-top:4px; font-size:22px; }
      .reporting-card span { display:block; margin-top:3px; color:var(--muted); font-size:12px; }
      .reporting-layout { display:grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap:14px; margin-top:14px; }
      .reporting-panel { border:1px solid var(--line); border-radius:10px; background:#fff; padding:12px; overflow:hidden; }
      .reporting-panel h4 { margin:0 0 8px; font-size:15px; }
      .reporting-table-wrap { max-height:260px; overflow:auto; }
      .reporting-table-wrap table { font-size:13px; }
      .reporting-empty { border:1px dashed var(--line); border-radius:8px; padding:12px; color:var(--muted); text-align:center; }
      .reporting-note { margin-top:10px; color:var(--muted); font-size:12px; line-height:1.45; }
      @media (max-width: 900px) { .reporting-layout { grid-template-columns:1fr; } }
    `;
    document.head.appendChild(style);
  }
  function ensurePanel() {
    installStyles();
    if ($("campaignReportingSection")) return;
    const detailStack = document.querySelector("#detailSection .detail-stack");
    if (!detailStack) return;
    const section = document.createElement("section");
    section.id = "campaignReportingSection";
    section.className = "card";
    section.innerHTML = `
      <div class="card-header">
        <div>
          <h3>Campaign Reporting</h3>
          <p>Production-only email-provider delivery, engagement and suppression events captured by webhook. Test sends are shown separately.</p>
        </div>
        <button id="refreshReportingButton" type="button">Refresh Report</button>
      </div>
      <p id="reportingMessage" class="message hidden" style="margin-top:12px;"></p>
      <div id="reportingMetrics" class="reporting-grid"></div>
      <p id="reportingNote" class="reporting-note"></p>
      <div class="reporting-layout">
        <section class="reporting-panel">
          <h4>Production Recipient Status</h4>
          <div id="reportingStatusBreakdown" class="reporting-table-wrap"></div>
        </section>
        <section class="reporting-panel">
          <h4>Top Clicked Production Links</h4>
          <div id="reportingTopLinks" class="reporting-table-wrap"></div>
        </section>
        <section class="reporting-panel">
          <h4>Recent Production Events</h4>
          <div id="reportingRecentEvents" class="reporting-table-wrap"></div>
        </section>
        <section class="reporting-panel">
          <h4>Recent Production Recipients</h4>
          <div id="reportingRecipients" class="reporting-table-wrap"></div>
        </section>
      </div>
    `;
    const sendingSection = $("campaignSendingSection");
    if (sendingSection?.nextSibling) detailStack.insertBefore(section, sendingSection.nextSibling);
    else detailStack.appendChild(section);
    $("refreshReportingButton").addEventListener("click", () => refreshReporting().catch((error) => renderError(error.message)));
  }
  function renderError(message) {
    const node = $("reportingMessage");
    if (!node) return;
    node.textContent = message || "";
    node.className = message ? "message error" : "message hidden";
  }
  function renderMetricCards(reporting) {
    const recipients = reporting?.recipients || {};
    const sends = reporting?.sends || {};
    const tests = reporting?.tests || {};
    const latestTest = tests.latest_created_at ? `${tests.latest_status || "unknown"} · ${formatDate(tests.latest_completed_at || tests.latest_created_at)}` : "No test sends";
    const cards = [
      ["Delivered", recipients.delivered || 0, `${recipients.delivery_rate || 0}% delivery rate`],
      ["Opens", recipients.opens || recipients.unique_opens || recipients.opened || 0, "All tracked open events"],
      ["Unique Opens", recipients.unique_opens || recipients.opened || 0, `${recipients.open_rate || 0}% open rate`],
      ["Clicked", recipients.clicked || 0, `${recipients.click_rate || 0}% click rate`],
      ["Delivery Rate", `${recipients.delivery_rate || 0}%`, "Delivered / accepted recipients"],
      ["Open Rate", `${recipients.open_rate || 0}%`, "Unique opens / delivered recipients"],
      ["Click Rate", `${recipients.click_rate || 0}%`, "Unique clicks / delivered recipients"],
      ["Bounce Rate", `${recipients.bounce_rate || 0}%`, "Soft, hard and blocked recipients"],
      ["Soft Bounce", recipients.soft_bounced || 0, "Temporary delivery failures"],
      ["Hard Bounce", recipients.hard_bounced || 0, "Permanent delivery failures"],
      ["Deferred", recipients.deferred || 0, "Delivery deferred by provider"],
      ["Blocked", recipients.blocked || 0, "Messages blocked by provider"],
      ["Complaints", recipients.complained || 0, "Spam complaint events"],
      ["Unsubscribes", recipients.unsubscribed || 0, `${recipients.unsubscribe_rate || 0}% unsubscribe rate`],
      ["Production batches", sends.production_batches || 0, "Completed or attempted batches"],
      ["Test sends", tests.count || 0, latestTest],
    ];
    $("reportingMetrics").innerHTML = cards.map(([label, value, detail]) => `
      <div class="reporting-card"><strong>${escapeHtml(label)}</strong><b>${escapeHtml(value)}</b><span>${escapeHtml(detail)}</span></div>
    `).join("");
    $("reportingNote").textContent = "Production metrics exclude internal test sends. Open counts are based on provider tracking and may include privacy proxy or prefetch activity.";
  }
  function renderStatusBreakdown(rows = []) {
    if (!rows.length) {
      $("reportingStatusBreakdown").innerHTML = `<div class="reporting-empty">No production recipient statuses recorded yet.</div>`;
      return;
    }
    $("reportingStatusBreakdown").innerHTML = `<table><thead><tr><th>Status</th><th>Count</th></tr></thead><tbody>${rows.map((row) => `
      <tr><td>${statusBadge(row.status)}</td><td>${fmt.format(row.count || 0)}</td></tr>
    `).join("")}</tbody></table>`;
  }
  function renderTopLinks(rows = []) {
    if (!rows.length) {
      $("reportingTopLinks").innerHTML = `<div class="reporting-empty">No production click events recorded yet.</div>`;
      return;
    }
    $("reportingTopLinks").innerHTML = `<table><thead><tr><th>Link</th><th>Clicks</th><th>Unique</th></tr></thead><tbody>${rows.map((row) => `
      <tr><td><a href="${escapeHtml(row.url)}" target="_blank" rel="noreferrer">${escapeHtml(row.url)}</a></td><td>${fmt.format(row.clicks || 0)}</td><td>${fmt.format(row.unique_recipients || 0)}</td></tr>
    `).join("")}</tbody></table>`;
  }
  function renderRecentEvents(rows = []) {
    if (!rows.length) {
      $("reportingRecentEvents").innerHTML = `<div class="reporting-empty">No production webhook events recorded yet.</div>`;
      return;
    }
    $("reportingRecentEvents").innerHTML = `<table><thead><tr><th>Event</th><th>Customer</th><th>Email</th><th>When</th></tr></thead><tbody>${rows.map((row) => `
      <tr><td>${statusBadge(row.event_type)}</td><td>${escapeHtml(row.customer_id || "-")}</td><td>${escapeHtml(row.email || "-")}</td><td>${formatDate(row.event_at)}</td></tr>
    `).join("")}</tbody></table>`;
  }
  function renderRecipients(rows = []) {
    if (!rows.length) {
      $("reportingRecipients").innerHTML = `<div class="reporting-empty">No production recipient rows recorded yet.</div>`;
      return;
    }
    $("reportingRecipients").innerHTML = `<table><thead><tr><th>Customer</th><th>Email</th><th>Status</th><th>Last Event</th></tr></thead><tbody>${rows.map((row) => `
      <tr><td>${escapeHtml(row.customer_id || "-")}</td><td>${escapeHtml(row.email || "-")}</td><td>${statusBadge(row.status)}</td><td>${formatDate(row.last_event_at || row.first_sent_at)}</td></tr>
    `).join("")}</tbody></table>`;
  }
  function renderReporting() {
    const reporting = state.reporting;
    if (!reporting) {
      $("reportingMetrics").innerHTML = `<div class="reporting-empty">Open a campaign to load reporting.</div>`;
      return;
    }
    if (reporting.migration_required) {
      $("reportingMetrics").innerHTML = `<div class="reporting-empty">Migration 012 is required before webhook reporting is available.</div>`;
      if ($("reportingNote")) $("reportingNote").textContent = "";
      renderStatusBreakdown([]);
      renderTopLinks([]);
      renderRecentEvents([]);
      renderRecipients([]);
      return;
    }
    renderMetricCards(reporting);
    renderStatusBreakdown(reporting.status_breakdown || []);
    renderTopLinks(reporting.top_links || []);
    renderRecentEvents(reporting.recent_events || []);
    renderRecipients(reporting.recent_recipients || []);
    renderError("");
  }
  async function refreshReporting({ quiet = false } = {}) {
    ensurePanel();
    const id = currentCampaignId();
    state.selectedCampaignId = id;
    if (!id) {
      $("campaignReportingSection").classList.add("hidden");
      return;
    }
    if (state.loading) return;
    $("campaignReportingSection").classList.remove("hidden");
    state.loading = true;
    if (!quiet) $("reportingMetrics").innerHTML = `<div class="reporting-empty">Loading campaign reporting...</div>`;
    try {
      const result = await reportingApi("campaignReporting", { id });
      if (id !== currentCampaignId()) return;
      state.reporting = result.reporting;
      renderReporting();
    } finally {
      state.loading = false;
    }
  }
  function observeCampaignChanges() {
    let last = "";
    setInterval(() => {
      ensurePanel();
      const id = currentCampaignId();
      if (id && id !== last) {
        last = id;
        refreshReporting().catch((error) => renderError(error.message));
      }
      if (!id && last) {
        last = "";
        if ($("campaignReportingSection")) $("campaignReportingSection").classList.add("hidden");
      }
    }, 1300);
    setInterval(() => {
      if (document.visibilityState !== "visible" || !currentCampaignId()) return;
      refreshReporting({ quiet: true }).catch((error) => renderError(error.message));
    }, 30000);
    window.addEventListener("focus", () => {
      if (!currentCampaignId()) return;
      refreshReporting({ quiet: true }).catch((error) => renderError(error.message));
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observeCampaignChanges);
  else observeCampaignChanges();
})();
