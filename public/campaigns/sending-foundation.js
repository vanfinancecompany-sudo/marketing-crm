(() => {
  const STORAGE_KEY = "marketingCustomerDatabaseApiKey";
  const API_HEADER = "x-marketing-customer-database-key";
  const SEND_API = "/api/marketing-template-campaign-sends";
  const fmt = new Intl.NumberFormat("en-GB");
  const dateFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "short" });

  const state = {
    selectedCampaignId: "",
    preparation: null,
    history: [],
    progress: null,
    migrationRequired: false,
    brevo: null,
    sendGridTestControl: null,
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
  async function sendApi(action, payload = {}) {
    const response = await fetch(SEND_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", [API_HEADER]: getStoredKey() },
      body: JSON.stringify({ action, ...payload }),
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok || data.ok === false) {
      const error = new Error(data.message || "Campaign sending request failed.");
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
  function currentCampaignStatus() {
    return $("detailStatus")?.textContent?.trim() || "";
  }
  function setMessage(text, error = false) {
    const node = $("sendMessage");
    if (!node) return;
    node.textContent = text || "";
    node.className = text ? `message${error ? " error" : ""}` : "message hidden";
  }
  function statusBadge(status) {
    const safe = escapeHtml(status || "unknown");
    let cls = "";
    if (["completed", "accepted", "delivered", "opened", "clicked"].includes(status)) cls = "green";
    else if (["failed"].includes(status)) cls = "red";
    else if (["partially_failed", "submission_unknown"].includes(status)) cls = "amber";
    else if (["preparing", "sending"].includes(status)) cls = "blue";
    else if (["cancelled"].includes(status)) cls = "neutral";
    return `<span class="badge ${cls}">${safe}</span>`;
  }
  function brevoState() {
    const brevo = state.brevo || {};
    const provider = brevo.provider || "Email provider";
    const unsubscribeConfigured = Boolean(brevo.unsubscribe_secret_configured && brevo.public_base_url_configured);
    const missing = [];
    if (!brevo.api_key_configured) missing.push("API key");
    if (!brevo.sender_email_configured) missing.push("sender email");
    if (!brevo.sender_name) missing.push("sender name");
    if (!unsubscribeConfigured) missing.push("unsubscribe configuration");
    if (state.migrationRequired) missing.push("Migration 011");
    if (brevo.connectivity === "checking") return { key: "checking", label: `Checking ${provider} connection...`, detail: "Refreshing sending configuration.", missing, unsubscribeConfigured };
    if (missing.length) return { key: "not_configured", label: `${provider} is not fully configured`, detail: `Missing: ${missing.join(", ")}.`, missing, unsubscribeConfigured };
    if (brevo.connectivity === "authorised") return { key: "authorised", label: `${provider} connected and authorised`, detail: "Sender name and sender email are configured.", missing, unsubscribeConfigured };
    if (brevo.connectivity === "rejected") return { key: "rejected", label: `${provider} connection rejected`, detail: "Check the API key and its sending permissions.", missing, unsubscribeConfigured };
    if (brevo.connectivity === "unreachable") return { key: "unreachable", label: `${provider} could not be reached`, detail: "Refresh the connection to try again.", missing, unsubscribeConfigured };
    return { key: "checking", label: `Checking ${provider} connection...`, detail: "Sending configuration has not loaded yet.", missing, unsubscribeConfigured };
  }
  function sendBlockReason(kind) {
    const status = brevoState();
    const brevo = state.brevo || {};
    if (status.key !== "authorised") return status.label;
    if (!brevo.sender_email_configured) return "Sender email is missing.";
    if (!brevo.sender_name) return "Sender name is missing.";
    if (state.migrationRequired) return "Migration 011 is required before sending is available.";
    if (kind === "production" && !status.unsubscribeConfigured) return "Unsubscribe configuration is required for production sending.";
    if (kind === "production" && currentCampaignStatus() !== "ready") return "Only Ready campaigns can prepare production sends.";
    return "";
  }
  function installStyles() {
    if ($("sendFoundationStyles")) return;
    const style = document.createElement("style");
    style.id = "sendFoundationStyles";
    style.textContent = `
      .send-grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap:10px; margin-top:12px; }
      .send-item { border:1px solid var(--line); border-radius:8px; padding:10px; background:var(--soft); }
      .send-item strong { display:block; color:var(--muted); font-size:12px; text-transform:uppercase; }
      .send-warning { border:1px solid #fed7aa; background:#fff7ed; color:#9a3412; border-radius:8px; padding:10px; font-weight:800; }
      .send-danger { border:1px solid #fecaca; background:#fff7f7; color:#991b1b; border-radius:8px; padding:12px; font-weight:850; }
      .send-area { border:1px solid var(--line); border-radius:10px; padding:12px; background:#fff; display:grid; gap:10px; }
      .send-area h4 { margin:0; font-size:15px; }
      .send-history { max-height:320px; overflow:auto; margin-top:10px; }
      .send-history table { font-size:13px; }
      .send-history .provider-error { max-width:320px; white-space:normal; color:var(--red); }
      .campaign-progress-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(135px, 1fr)); gap:10px; margin-top:12px; }
      .campaign-progress-item { border:1px solid var(--line); border-radius:8px; padding:10px; background:var(--soft); }
      .campaign-progress-item strong { display:block; color:var(--muted); font-size:12px; text-transform:uppercase; }
      .campaign-progress-item b { display:block; margin-top:3px; font-size:22px; }
      .campaign-progress-track { height:10px; margin-top:14px; border-radius:999px; overflow:hidden; background:#dfe7f1; }
      .campaign-progress-fill { height:100%; border-radius:inherit; background:var(--blue); transition:none; }
      .campaign-progress-percent { margin-top:6px; color:var(--blue); font-weight:900; text-align:right; }
      .campaign-progress-batch { margin-top:14px; padding-top:12px; border-top:1px solid var(--line); }
      .campaign-progress-batch h4 { margin:0; font-size:15px; }
      .brevo-banner { display:grid; grid-template-columns:auto minmax(0, 1fr) auto; gap:12px; align-items:center; border-radius:10px; padding:13px; border:1px solid var(--line); background:#f8fafc; }
      .brevo-banner strong { display:block; font-size:15px; }
      .brevo-banner p { margin:3px 0 0; }
      .brevo-dot { width:12px; height:12px; border-radius:999px; background:#94a3b8; box-shadow:0 0 0 4px rgba(148, 163, 184, .15); }
      .brevo-banner.authorised { border-color:#86efac; background:#f0fdf4; color:#166534; }
      .brevo-banner.authorised .brevo-dot { background:var(--green); box-shadow:0 0 0 4px rgba(15, 143, 95, .15); }
      .brevo-banner.rejected, .brevo-banner.not_configured { border-color:#fecaca; background:#fff7f7; color:#991b1b; }
      .brevo-banner.rejected .brevo-dot, .brevo-banner.not_configured .brevo-dot { background:var(--red); box-shadow:0 0 0 4px rgba(194, 65, 59, .15); }
      .brevo-banner.unreachable, .brevo-banner.checking { border-color:#fed7aa; background:#fff7ed; color:#9a3412; }
      .brevo-banner.unreachable .brevo-dot, .brevo-banner.checking .brevo-dot { background:var(--amber); box-shadow:0 0 0 4px rgba(168, 103, 0, .15); }
      .send-disabled-reason { margin:0; color:var(--red); font-size:13px; font-weight:850; }
      .badge.amber { background:#fff7ed; color:#9a3412; }
      .badge.blue { background:#eef4ff; color:#1d4ed8; }
      .badge.neutral { background:#f3f4f6; color:#4b5563; }
    `;
    document.head.appendChild(style);
  }
  function ensureProgressPanel() {
    if ($("campaignProgressSection")) return;
    const detailStack = document.querySelector("#detailSection .detail-stack");
    if (!detailStack) return;
    const audienceSection = Array.from(detailStack.children).find((child) => child.querySelector("h3")?.textContent?.trim() === "Audience");
    if (!audienceSection) return;
    const section = document.createElement("section");
    section.id = "campaignProgressSection";
    section.className = "card";
    section.innerHTML = `
      <h3>Campaign Progress</h3>
      <p>Read-only progress from this campaign's existing production recipient records.</p>
      <div id="campaignProgressGrid" class="campaign-progress-grid"></div>
      <div class="campaign-progress-track" role="progressbar" aria-label="Campaign progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div id="campaignProgressFill" class="campaign-progress-fill" style="width:0%;"></div>
      </div>
      <div id="campaignProgressPercent" class="campaign-progress-percent">0%</div>
      <div id="campaignLastBatch" class="campaign-progress-batch"></div>
    `;
    detailStack.insertBefore(section, audienceSection);
  }
  function renderCampaignProgress() {
    const progress = state.progress || {};
    const totalAudience = Number(progress.total_audience || 0);
    const alreadyProcessed = Number(progress.already_processed || 0);
    const eligibleRemaining = Math.max(0, Number(progress.eligible_remaining || 0));
    const nextBatchSize = Math.max(1, Math.min(500, Number($("productionBatchSize")?.value || 25)));
    const remainingAfterBatch = Math.max(0, eligibleRemaining - nextBatchSize);
    const progressPercent = Math.max(0, Math.min(100, Number(progress.progress_percent || 0)));
    const items = [
      ["Total Audience", totalAudience],
      ["Already Processed", alreadyProcessed],
      ["Eligible Remaining", eligibleRemaining],
      ["Next Batch Size", nextBatchSize],
      ["Remaining After This Batch", remainingAfterBatch],
    ];
    $("campaignProgressGrid").innerHTML = items.map(([label, value]) => `<div class="campaign-progress-item"><strong>${escapeHtml(label)}</strong><b>${fmt.format(value)}</b></div>`).join("");
    $("campaignProgressFill").style.width = `${progressPercent}%`;
    $("campaignProgressFill").parentElement.setAttribute("aria-valuenow", String(progressPercent));
    $("campaignProgressPercent").textContent = `${progressPercent}%`;
    const lastBatch = progress.last_batch;
    $("campaignLastBatch").innerHTML = lastBatch ? `
      <h4>Last Batch</h4>
      <div class="campaign-progress-grid">
        ${[
          ["Processed", lastBatch.sent || 0],
          ["Accepted", lastBatch.accepted || 0],
          ["Failed", lastBatch.failed || 0],
          ["Suppressed", lastBatch.suppressed || 0],
          ["Completed", formatDate(lastBatch.completed_at)],
        ].map(([label, value]) => `<div class="campaign-progress-item"><strong>${escapeHtml(label)}</strong><b>${escapeHtml(value)}</b></div>`).join("")}
      </div>
    ` : `<h4>Last Batch</h4><p class="hint">No production batches created yet.</p>`;
  }
  function ensurePanel() {
    installStyles();
    ensureProgressPanel();
    if ($("campaignSendingSection")) return;
    const detailStack = document.querySelector("#detailSection .detail-stack");
    if (!detailStack) return;
    const section = document.createElement("section");
    section.id = "campaignSendingSection";
    section.className = "card";
    section.innerHTML = `
      <div class="card-header">
        <div>
          <h3>Sending</h3>
          <p>Email-provider test sending and controlled production-batch preparation. No automatic full-database sends.</p>
        </div>
        <button id="refreshSendButton">Refresh Connection</button>
      </div>
      <div id="brevoConnectionBanner" class="brevo-banner checking" aria-live="polite"></div>
      <p id="sendMessage" class="message hidden" style="margin-top:12px;"></p>
      <div id="brevoStatusGrid" class="send-grid"></div>
      <section class="send-area" style="margin-top:14px;">
        <div>
          <h4>Send one internal test email</h4>
          <p class="hint">This does not contact the campaign audience.</p>
        </div>
        <label>Internal test email address
          <input id="testSendEmail" type="email" placeholder="name@example.com" />
        </label>
        <p id="testDisabledReason" class="send-disabled-reason hidden"></p>
        <div class="toolbar">
          <button id="sendTestButton">Send Test Email</button>
          <button id="sendSendGridTestButton" type="button" hidden>Send SendGrid Test</button>
        </div>
        <p id="sendGridTestConfiguration" class="hint" hidden></p>
      </section>
      <section class="send-area" style="margin-top:14px;">
        <div class="send-danger">This sends real customer email.</div>
        <div class="send-warning">Maximum 500 recipients per confirmed batch.</div>
        <div class="form-grid">
          <label>Batch size
            <input id="productionBatchSize" type="number" min="1" max="500" value="25" />
          </label>
          <label>Confirmation phrase
            <input id="productionConfirmationPhrase" placeholder="Prepare first" />
          </label>
        </div>
        <div id="preparationSummary" class="send-grid"></div>
        <p id="productionDisabledReason" class="send-disabled-reason hidden"></p>
        <div class="toolbar">
          <button id="prepareSendButton">Prepare Send</button>
          <button id="confirmSendButton" class="primary" disabled>Confirm and Send Batch</button>
          <button id="cancelPreparedSendButton" disabled>Cancel Preparation</button>
        </div>
      </section>
      <div class="send-history">
        <table>
          <thead><tr><th>Type</th><th>Status</th><th>Requested</th><th>Accepted</th><th>Failed</th><th>Duplicates</th><th>Created</th><th>Provider response</th></tr></thead>
          <tbody id="sendHistoryRows"><tr><td colspan="8">No send history loaded.</td></tr></tbody>
        </table>
      </div>
    `;
    const readiness = $("readyPanel")?.closest("section.card");
    if (readiness?.nextSibling) detailStack.insertBefore(section, readiness.nextSibling);
    else detailStack.appendChild(section);

    $("refreshSendButton").addEventListener("click", () => refreshSending().catch((error) => setMessage(error.message, true)));
    $("sendTestButton").addEventListener("click", () => sendTest().catch((error) => setMessage(error.message, true)));
    if (window.SendGridTestControl) {
      state.sendGridTestControl = window.SendGridTestControl.create({
        button: $("sendSendGridTestButton"),
        configurationNode: $("sendGridTestConfiguration"),
        getCampaignId: currentCampaignId,
        getEmail: () => $("testSendEmail")?.value || "",
        getStoredKey,
        setMessage,
        onAccepted: () => refreshSending().catch((error) => setMessage(error.message, true)),
      });
      $("sendSendGridTestButton").addEventListener("click", () => state.sendGridTestControl.send());
      state.sendGridTestControl.checkAvailability();
    }
    $("prepareSendButton").addEventListener("click", () => prepareSend().catch((error) => setMessage(error.message, true)));
    $("confirmSendButton").addEventListener("click", () => confirmSend().catch((error) => setMessage(error.message, true)));
    $("cancelPreparedSendButton").addEventListener("click", () => cancelPreparation().catch((error) => setMessage(error.message, true)));
    $("productionBatchSize").addEventListener("input", renderCampaignProgress);
  }
  function renderBrevoStatus() {
    const brevo = state.brevo || {};
    const status = brevoState();
    const banner = $("brevoConnectionBanner");
    banner.className = `brevo-banner ${status.key}`;
    banner.innerHTML = `
      <span class="brevo-dot" aria-hidden="true"></span>
      <div><strong>${escapeHtml(status.label)}</strong><p>${escapeHtml(status.detail)}</p></div>
      <button id="refreshBrevoInlineButton" type="button">Refresh Connection</button>
    `;
    $("refreshBrevoInlineButton").addEventListener("click", () => refreshSending().catch((error) => setMessage(error.message, true)));
    $("brevoStatusGrid").innerHTML = [
      [`${brevo.provider || "Email provider"} connection`, brevo.connectivity || "checking"],
      ["Configured", status.missing.length ? "No" : "Yes"],
      ["Sender email", brevo.sender_email_configured ? "Configured" : "Missing"],
      ["Sender name", brevo.sender_name || "Missing"],
      ["Unsubscribe", status.unsubscribeConfigured ? "Configured" : "Missing"],
    ].map(([label, value]) => `<div class="send-item"><strong>${escapeHtml(label)}</strong>${escapeHtml(value)}</div>`).join("");
    renderControlStates();
  }
  function renderControlStates() {
    const testReason = sendBlockReason("test");
    const productionReason = sendBlockReason("production");
    const testDisabled = Boolean(testReason);
    const productionDisabled = Boolean(productionReason);
    if ($("sendTestButton")) $("sendTestButton").disabled = testDisabled;
    if ($("prepareSendButton")) $("prepareSendButton").disabled = productionDisabled;
    if ($("testDisabledReason")) {
      $("testDisabledReason").textContent = testReason;
      $("testDisabledReason").classList.toggle("hidden", !testReason);
    }
    if ($("productionDisabledReason")) {
      $("productionDisabledReason").textContent = productionReason;
      $("productionDisabledReason").classList.toggle("hidden", !productionReason);
    }
  }
  function renderPreparation() {
    const prep = state.preparation;
    const button = $("confirmSendButton");
    const cancel = $("cancelPreparedSendButton");
    button.disabled = !prep;
    cancel.disabled = !prep;
    $("productionConfirmationPhrase").placeholder = prep ? prep.confirmation_phrase : "Prepare first";
    $("preparationSummary").innerHTML = prep ? [
      ["Full eligible audience", prep.final_eligible_count],
      ["Current suppressed count", prep.suppressed_count],
      ["Previously sent / duplicates", prep.skipped_duplicate_count],
      ["Proposed batch size", prep.proposed_batch_size],
      ["Subject", prep.subject],
      ["HTML hash", String(prep.html_hash || "").slice(0, 12)],
    ].map(([label, value]) => `<div class="send-item"><strong>${escapeHtml(label)}</strong>${escapeHtml(value)}</div>`).join("") : "";
    renderControlStates();
  }
  function renderHistory() {
    const rows = state.history || [];
    if (state.migrationRequired) {
      $("sendHistoryRows").innerHTML = `<tr><td colspan="8">Migration 011 is required before send history is available.</td></tr>`;
      return;
    }
    if (!rows.length) {
      $("sendHistoryRows").innerHTML = `<tr><td colspan="8">No test or production email has been sent for this campaign.</td></tr>`;
      return;
    }
    $("sendHistoryRows").innerHTML = rows.map((send) => `
      <tr>
        <td>${escapeHtml(send.send_type)}</td>
        <td>${statusBadge(send.status)}</td>
        <td>${fmt.format(send.requested_count || 0)}</td>
        <td>${fmt.format(send.sent_count || 0)}</td>
        <td>${fmt.format(send.failed_count || 0)}</td>
        <td>${fmt.format(send.skipped_duplicate_count || 0)}</td>
        <td>${formatDate(send.created_at)}</td>
        <td class="${send.send_type === "production" && send.error_summary ? "provider-error" : ""}">${send.send_type === "production" && send.error_summary ? escapeHtml(send.error_summary) : "-"}</td>
      </tr>`).join("");
  }
  async function refreshSending() {
    ensurePanel();
    const id = currentCampaignId();
    state.selectedCampaignId = id;
    state.preparation = null;
    state.progress = null;
    if (!id) {
      $("campaignSendingSection").classList.add("hidden");
      $("campaignProgressSection").classList.add("hidden");
      return;
    }
    $("campaignSendingSection").classList.remove("hidden");
    $("campaignProgressSection").classList.remove("hidden");
    renderCampaignProgress();
    state.brevo = { connectivity: "checking" };
    renderBrevoStatus();
    renderPreparation();
    const [brevoResult, historyResult] = await Promise.all([
      sendApi("brevoStatus"),
      sendApi("sendHistory", { id }),
    ]);
    state.brevo = brevoResult.brevo;
    state.history = historyResult.sends || [];
    state.progress = historyResult.progress || null;
    state.migrationRequired = Boolean(historyResult.migration_required);
    renderBrevoStatus();
    renderPreparation();
    renderHistory();
    renderCampaignProgress();
  }
  async function sendTest() {
    const reason = sendBlockReason("test");
    if (reason) throw new Error(reason);
    const id = currentCampaignId();
    if (!id) throw new Error("Open a campaign before sending a test.");
    const email = $("testSendEmail").value.trim();
    const result = await sendApi("sendTest", { id, email });
    setMessage(`Test email accepted by ${state.brevo?.provider || "the email provider"}${result.provider_message_id ? ` (${result.provider_message_id})` : ""}.`);
    await refreshSending();
  }
  async function prepareSend() {
    const reason = sendBlockReason("production");
    if (reason) throw new Error(reason);
    const id = currentCampaignId();
    if (!id) throw new Error("Open a campaign before preparing a send.");
    if (currentCampaignStatus() !== "ready") throw new Error("Only Ready campaigns can prepare production sends.");
    const batchSize = Number($("productionBatchSize").value || 25);
    const result = await sendApi("prepareProductionSend", { id, batch_size: batchSize });
    state.preparation = result.preparation;
    $("productionConfirmationPhrase").value = "";
    setMessage(`Prepared. Type ${result.preparation.confirmation_phrase} to send one limited batch.`);
    renderPreparation();
  }
  async function confirmSend() {
    const prep = state.preparation;
    if (!prep) throw new Error("Prepare the send first.");
    const phrase = $("productionConfirmationPhrase").value.trim();
    const batchSize = Number($("productionBatchSize").value || prep.proposed_batch_size || 25);
    const result = await sendApi("confirmProductionSend", {
      send_id: prep.send_id,
      confirmation_token: prep.confirmation_token,
      confirmation_phrase: phrase,
      batch_size: batchSize,
    });
    state.preparation = null;
    setMessage(`Production batch finished with status ${result.send?.status || "unknown"}.`);
    await refreshSending();
  }
  async function cancelPreparation() {
    if (!state.preparation) return;
    await sendApi("cancelPreparedSend", { send_id: state.preparation.send_id });
    state.preparation = null;
    setMessage("Prepared send cancelled.");
    await refreshSending();
  }
  function observeCampaignChanges() {
    let last = "";
    setInterval(() => {
      ensurePanel();
      const id = currentCampaignId();
      if (id && id !== last) {
        last = id;
        refreshSending().catch((error) => setMessage(error.message, true));
      }
      if (id) renderControlStates();
    }, 1200);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observeCampaignChanges);
  else observeCampaignChanges();
})();
