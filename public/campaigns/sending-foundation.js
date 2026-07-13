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
    migrationRequired: false,
    brevo: null,
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
    const cls = status === "completed" || status === "accepted" ? "green" : status === "failed" || status === "partially_failed" ? "red" : "";
    return `<span class="badge ${cls}">${safe}</span>`;
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
      .send-history { max-height:260px; overflow:auto; margin-top:10px; }
      .send-history table { font-size:13px; }
    `;
    document.head.appendChild(style);
  }
  function ensurePanel() {
    installStyles();
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
          <p>Brevo test sending and controlled production-batch preparation. No automatic full-database sends.</p>
        </div>
        <button id="refreshSendButton">Refresh Sending</button>
      </div>
      <p id="sendMessage" class="message hidden"></p>
      <div id="brevoStatusGrid" class="send-grid"></div>
      <div class="send-warning" style="margin-top:12px;">No production email is sent until a Ready campaign is prepared, the confirmation phrase is typed exactly, and one limited batch is confirmed.</div>
      <div class="form-grid" style="margin-top:14px;">
        <label class="span-2">Internal test email address
          <input id="testSendEmail" type="email" placeholder="name@example.com" />
        </label>
      </div>
      <div class="toolbar" style="margin-top:10px;">
        <button id="sendTestButton">Send Test Email</button>
      </div>
      <hr style="border:0;border-top:1px solid var(--line);margin:16px 0;">
      <div class="form-grid">
        <label>Batch size
          <input id="productionBatchSize" type="number" min="1" max="250" value="25" />
        </label>
        <label>Confirmation phrase
          <input id="productionConfirmationPhrase" placeholder="Prepare first" />
        </label>
      </div>
      <div id="preparationSummary" class="send-grid"></div>
      <div class="toolbar" style="margin-top:10px;">
        <button id="prepareSendButton">Prepare Send</button>
        <button id="confirmSendButton" class="primary" disabled>Confirm and Send Batch</button>
        <button id="cancelPreparedSendButton" disabled>Cancel Preparation</button>
      </div>
      <div class="send-history">
        <table>
          <thead><tr><th>Type</th><th>Status</th><th>Requested</th><th>Accepted</th><th>Failed</th><th>Duplicates</th><th>Created</th></tr></thead>
          <tbody id="sendHistoryRows"><tr><td colspan="7">No send history loaded.</td></tr></tbody>
        </table>
      </div>
    `;
    const readiness = $("readyPanel")?.closest("section.card");
    if (readiness?.nextSibling) detailStack.insertBefore(section, readiness.nextSibling);
    else detailStack.appendChild(section);

    $("refreshSendButton").addEventListener("click", () => refreshSending().catch((error) => setMessage(error.message, true)));
    $("sendTestButton").addEventListener("click", () => sendTest().catch((error) => setMessage(error.message, true)));
    $("prepareSendButton").addEventListener("click", () => prepareSend().catch((error) => setMessage(error.message, true)));
    $("confirmSendButton").addEventListener("click", () => confirmSend().catch((error) => setMessage(error.message, true)));
    $("cancelPreparedSendButton").addEventListener("click", () => cancelPreparation().catch((error) => setMessage(error.message, true)));
  }
  function renderBrevoStatus() {
    const brevo = state.brevo || {};
    $("brevoStatusGrid").innerHTML = [
      ["Brevo connection", brevo.connectivity || "unknown"],
      ["Configured", brevo.configured ? "Yes" : "No"],
      ["Sender email", brevo.sender_email_configured ? "Configured" : "Missing"],
      ["Sender name", brevo.sender_name || "-"],
      ["Unsubscribe", brevo.unsubscribe_secret_configured && brevo.public_base_url_configured ? "Configured" : "Missing"],
    ].map(([label, value]) => `<div class="send-item"><strong>${escapeHtml(label)}</strong>${escapeHtml(value)}</div>`).join("");
  }
  function renderPreparation() {
    const prep = state.preparation;
    const button = $("confirmSendButton");
    const cancel = $("cancelPreparedSendButton");
    button.disabled = !prep;
    cancel.disabled = !prep;
    $("productionConfirmationPhrase").placeholder = prep ? prep.confirmation_phrase : "Prepare first";
    $("preparationSummary").innerHTML = prep ? [
      ["Current eligible", prep.final_eligible_count],
      ["Suppressed", prep.suppressed_count],
      ["Already sent / duplicates", prep.skipped_duplicate_count],
      ["This batch", prep.proposed_batch_size],
      ["Subject", prep.subject],
      ["HTML hash", String(prep.html_hash || "").slice(0, 12)],
    ].map(([label, value]) => `<div class="send-item"><strong>${escapeHtml(label)}</strong>${escapeHtml(value)}</div>`).join("") : "";
  }
  function renderHistory() {
    const rows = state.history || [];
    if (state.migrationRequired) {
      $("sendHistoryRows").innerHTML = `<tr><td colspan="7">Migration 011 is required before send history is available.</td></tr>`;
      return;
    }
    if (!rows.length) {
      $("sendHistoryRows").innerHTML = `<tr><td colspan="7">No production email has been sent.</td></tr>`;
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
      </tr>`).join("");
  }
  async function refreshSending() {
    ensurePanel();
    const id = currentCampaignId();
    state.selectedCampaignId = id;
    state.preparation = null;
    if (!id) {
      $("campaignSendingSection").classList.add("hidden");
      return;
    }
    $("campaignSendingSection").classList.remove("hidden");
    const [brevoResult, historyResult] = await Promise.all([
      sendApi("brevoStatus"),
      sendApi("sendHistory", { id }),
    ]);
    state.brevo = brevoResult.brevo;
    state.history = historyResult.sends || [];
    state.migrationRequired = Boolean(historyResult.migration_required);
    renderBrevoStatus();
    renderPreparation();
    renderHistory();
  }
  async function sendTest() {
    const id = currentCampaignId();
    if (!id) throw new Error("Open a campaign before sending a test.");
    const email = $("testSendEmail").value.trim();
    const result = await sendApi("sendTest", { id, email });
    setMessage(`Test email accepted by Brevo${result.provider_message_id ? ` (${result.provider_message_id})` : ""}.`);
    await refreshSending();
  }
  async function prepareSend() {
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
    }, 1200);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observeCampaignChanges);
  else observeCampaignChanges();
})();
