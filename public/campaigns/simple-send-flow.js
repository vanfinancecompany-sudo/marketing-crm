(() => {
  const STORAGE_KEY = "marketingCustomerDatabaseApiKey";
  const API_HEADER = "x-marketing-customer-database-key";
  const SEND_API = "/api/marketing-template-campaign-sends";
  const PROGRESS_API = "/api/marketing-template-campaign-send-progress";
  const POLL_MS = 2000;
  const fmt = new Intl.NumberFormat("en-GB");

  const flow = {
    campaignId: "",
    activeSendId: "",
    busy: false,
    progress: null,
    lastRefreshAt: 0,
    completionRefreshedFor: "",
  };

  function $(id) { return document.getElementById(id); }

  function getStoredKey() {
    try { return window.localStorage.getItem(STORAGE_KEY) || ""; }
    catch { return ""; }
  }

  function currentCampaignId() {
    const selected = document.querySelector("#campaignRows tr.is-selected button[data-open]");
    if (selected?.dataset.open) return selected.dataset.open;
    const title = $("detailTitle")?.textContent?.trim();
    if (!title) return "";
    const button = Array.from(document.querySelectorAll("#campaignRows button[data-open]")).find((candidate) => {
      const row = candidate.closest("tr");
      return row?.innerText?.includes(title);
    });
    return button?.dataset.open || "";
  }

  function setMessage(text, error = false) {
    const node = $("sendMessage");
    if (!node) return;
    node.textContent = text || "";
    node.className = text ? `message${error ? " error" : ""}` : "message hidden";
  }

  async function request(url, body) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [API_HEADER]: getStoredKey(),
      },
      body: JSON.stringify(body || {}),
      cache: "no-store",
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

  function sendApi(action, payload = {}) {
    return request(SEND_API, { action, ...payload });
  }

  function progressApi(payload = {}) {
    return request(PROGRESS_API, payload);
  }

  function installStyles() {
    if ($("simpleSendFlowStyles")) return;
    const style = document.createElement("style");
    style.id = "simpleSendFlowStyles";
    style.textContent = `
      .simple-send-toolbar { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
      .simple-send-button { min-width:190px; min-height:42px; font-size:15px; font-weight:900; }
      .simple-send-progress { margin-top:2px; border:1px solid #bfdbfe; border-radius:10px; padding:13px; background:#f8fbff; }
      .simple-send-progress.hidden { display:none; }
      .simple-send-progress__top { display:flex; justify-content:space-between; gap:12px; align-items:baseline; }
      .simple-send-progress__status { font-weight:900; color:#0f172a; font-size:15px; }
      .simple-send-progress__count { font-weight:900; color:#1d4ed8; font-size:15px; white-space:nowrap; }
      .simple-send-progress__track { height:14px; margin-top:10px; border-radius:999px; overflow:hidden; background:#dbeafe; box-shadow:inset 0 0 0 1px rgba(37,99,235,.08); }
      .simple-send-progress__fill { height:100%; width:0%; border-radius:inherit; background:var(--blue, #2563eb); transition:width .35s ease; }
      .simple-send-progress__detail { display:flex; gap:12px; flex-wrap:wrap; margin-top:8px; color:#475569; font-size:13px; font-weight:700; }
      .simple-send-progress__detail strong { color:#0f172a; }
      .simple-send-progress.is-complete { border-color:#86efac; background:#f0fdf4; }
      .simple-send-progress.is-complete .simple-send-progress__count { color:#166534; }
      .simple-send-progress.is-complete .simple-send-progress__fill { background:var(--green, #0f8f5f); }
      .simple-send-progress.is-error { border-color:#fecaca; background:#fff7f7; }
      .simple-send-progress.is-error .simple-send-progress__count { color:#991b1b; }
      .simple-send-progress.is-error .simple-send-progress__fill { background:var(--red, #c2413b); }
      .simple-send-help { margin:0; color:#475569; font-size:13px; }
      .simple-send-stage { display:inline-flex; align-items:center; gap:7px; }
      .simple-send-stage::before { content:""; width:8px; height:8px; border-radius:999px; background:#2563eb; }
      .simple-send-progress[data-phase="preparing"] .simple-send-stage::before,
      .simple-send-progress[data-phase="queued"] .simple-send-stage::before,
      .simple-send-progress[data-phase="sending"] .simple-send-stage::before { animation:simpleSendPulse 1.1s ease-in-out infinite alternate; }
      @keyframes simpleSendPulse { from { opacity:.35; transform:scale(.85); } to { opacity:1; transform:scale(1.15); } }
    `;
    document.head.appendChild(style);
  }

  function batchInput() {
    return $("productionBatchSize");
  }

  function requestedBatchSize() {
    const value = Number(batchInput()?.value || 0);
    if (!Number.isInteger(value) || value < 1 || value > 500) {
      throw new Error("Enter a batch size between 1 and 500.");
    }
    return value;
  }

  function activeProgressIsSending() {
    return ["preparing", "queued", "reserving", "sending"].includes(String(flow.progress?.phase || ""));
  }

  function syncButtonState() {
    const button = $("simpleSendBatchButton");
    const input = batchInput();
    if (!button || !input) return;
    const oldPrepare = $("prepareSendButton");
    const blockedByFoundation = Boolean(oldPrepare?.disabled);
    const blocked = flow.busy || activeProgressIsSending() || blockedByFoundation;
    button.disabled = blocked;
    input.disabled = flow.busy || activeProgressIsSending();
    const count = Number(input.value || 0);
    button.textContent = flow.busy
      ? "Preparing & Queueing…"
      : activeProgressIsSending()
        ? "Batch Sending…"
        : Number.isInteger(count) && count >= 1 && count <= 500
          ? `Send ${fmt.format(count)} Emails`
          : "Send Batch";
  }

  function renderLocalStage(phase, requested, text) {
    flow.progress = {
      phase,
      status: phase,
      requested: Number(requested || 0),
      processed: 0,
      pending: Number(requested || 0),
      accepted: 0,
      failed: 0,
      suppressed: 0,
      unknown: 0,
      progress_percent: 0,
      local_text: text || "",
    };
    renderProgress();
  }

  function phaseLabel(progress) {
    if (progress.local_text) return progress.local_text;
    if (progress.phase === "preparing") return "Preparing audience…";
    if (["queued", "reserving"].includes(progress.phase)) return "Queued, waiting for sender…";
    if (progress.phase === "sending") return "Sending emails…";
    if (progress.phase === "completed") return "Batch completed";
    if (progress.phase === "completed_with_issues" || progress.status === "partially_failed") return "Batch completed with issues";
    if (progress.status === "failed") return "Batch failed";
    if (progress.status === "cancelled") return "Batch cancelled";
    return "Batch status";
  }

  function renderProgress() {
    const panel = $("simpleBatchProgress");
    if (!panel) return;
    const progress = flow.progress;
    if (!progress) {
      panel.className = "simple-send-progress hidden";
      panel.innerHTML = "";
      syncButtonState();
      return;
    }

    const requested = Number(progress.requested || 0);
    const processed = Math.max(0, Number(progress.processed || 0));
    const accepted = Math.max(0, Number(progress.accepted || 0));
    const failed = Math.max(0, Number(progress.failed || 0));
    const suppressed = Math.max(0, Number(progress.suppressed || 0));
    const unknown = Math.max(0, Number(progress.unknown || 0));
    const pending = Math.max(0, Number(progress.pending ?? Math.max(0, requested - processed)));
    const percent = Math.max(0, Math.min(100, Number(progress.progress_percent || 0)));
    const complete = ["completed", "completed_with_issues"].includes(progress.phase) || ["completed", "partially_failed"].includes(progress.status);
    const error = progress.status === "failed";

    panel.dataset.phase = progress.phase || progress.status || "";
    panel.className = `simple-send-progress${complete ? " is-complete" : ""}${error ? " is-error" : ""}`;
    panel.innerHTML = `
      <div class="simple-send-progress__top">
        <div class="simple-send-progress__status"><span class="simple-send-stage">${phaseLabel(progress)}</span></div>
        <div class="simple-send-progress__count">${fmt.format(processed)} / ${fmt.format(requested)}</div>
      </div>
      <div class="simple-send-progress__track" role="progressbar" aria-label="Current email batch progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
        <div class="simple-send-progress__fill" style="width:${percent}%"></div>
      </div>
      <div class="simple-send-progress__detail">
        <span><strong>${fmt.format(accepted)}</strong> accepted</span>
        <span><strong>${fmt.format(pending)}</strong> remaining</span>
        ${suppressed ? `<span><strong>${fmt.format(suppressed)}</strong> skipped/suppressed</span>` : ""}
        ${failed ? `<span><strong>${fmt.format(failed)}</strong> failed</span>` : ""}
        ${unknown ? `<span><strong>${fmt.format(unknown)}</strong> needs checking</span>` : ""}
        <span><strong>${percent}%</strong> complete</span>
      </div>
      ${progress.error_summary ? `<p class="simple-send-help" style="margin-top:8px;">${String(progress.error_summary).replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]))}</p>` : ""}
    `;
    syncButtonState();
  }

  function refreshFoundationOnce() {
    const button = $("refreshSendButton");
    if (button && !button.disabled) button.click();
  }

  async function pollProgress({ discover = false } = {}) {
    const campaignId = currentCampaignId();
    if (!campaignId) return;
    const payload = flow.activeSendId && !discover
      ? { send_id: flow.activeSendId }
      : { campaign_id: campaignId };
    const result = await progressApi(payload);
    if (!result.found || !result.progress) return;
    if (result.progress.campaign_id !== campaignId) return;

    flow.progress = result.progress;
    flow.activeSendId = ["sending", "preparing"].includes(result.progress.status) ? result.progress.send_id : "";
    renderProgress();

    const terminal = ["completed", "partially_failed", "failed", "cancelled"].includes(result.progress.status);
    if (terminal && flow.completionRefreshedFor !== result.progress.send_id) {
      flow.completionRefreshedFor = result.progress.send_id;
      setMessage(
        result.progress.status === "completed"
          ? `Batch complete: ${fmt.format(result.progress.accepted)} emails accepted by the provider.`
          : `Batch finished with status ${result.progress.status}. Check the progress details below.`,
        result.progress.status === "failed"
      );
      refreshFoundationOnce();
    }
  }

  async function cancelPreparationQuietly(preparation) {
    if (!preparation?.send_id) return;
    try { await sendApi("cancelPreparedSend", { send_id: preparation.send_id }); }
    catch {}
  }

  async function sendBatch() {
    if (flow.busy || activeProgressIsSending()) return;
    const campaignId = currentCampaignId();
    if (!campaignId) {
      setMessage("Open a campaign before sending a batch.", true);
      return;
    }

    let batchSize;
    try { batchSize = requestedBatchSize(); }
    catch (error) {
      setMessage(error.message, true);
      return;
    }

    const oldPrepare = $("prepareSendButton");
    if (oldPrepare?.disabled) {
      const reason = $("productionDisabledReason")?.textContent?.trim();
      setMessage(reason || "This campaign is not ready to send yet.", true);
      return;
    }

    flow.busy = true;
    flow.campaignId = campaignId;
    flow.activeSendId = "";
    flow.completionRefreshedFor = "";
    renderLocalStage("preparing", batchSize, "Preparing audience…");
    syncButtonState();
    setMessage(`Preparing ${fmt.format(batchSize)} recipients and queueing the batch…`);

    let preparation = null;
    try {
      const prepared = await sendApi("prepareProductionSend", {
        id: campaignId,
        batch_size: batchSize,
      });
      preparation = prepared.preparation;
      const actualCount = Number(preparation?.proposed_batch_size || batchSize);
      renderLocalStage("queued", actualCount, "Audience prepared, queueing…");

      const queued = await sendApi("confirmProductionSend", {
        send_id: preparation.send_id,
        confirmation_token: preparation.confirmation_token,
        confirmation_phrase: preparation.confirmation_phrase,
        batch_size: actualCount,
      });
      preparation = null;
      flow.activeSendId = queued.send?.id || "";
      flow.busy = false;
      flow.progress = {
        send_id: flow.activeSendId,
        campaign_id: campaignId,
        status: queued.send?.status || "sending",
        phase: "queued",
        requested: Number(queued.queued_count || actualCount),
        processed: Number(queued.send?.metadata?.processed_count || 0),
        pending: Number(queued.send?.metadata?.pending_count ?? queued.queued_count ?? actualCount),
        accepted: Number(queued.send?.sent_count || 0),
        failed: Number(queued.send?.failed_count || 0),
        suppressed: Number(queued.send?.metadata?.skipped_suppressed_count || 0),
        unknown: Number(queued.send?.metadata?.submission_unknown_count || 0),
        progress_percent: 0,
      };
      setMessage(queued.message || `Batch queued: ${fmt.format(actualCount)} emails.`);
      renderProgress();
      refreshFoundationOnce();
      await pollProgress().catch(() => {});
    } catch (error) {
      await cancelPreparationQuietly(preparation);
      flow.busy = false;
      flow.activeSendId = "";
      flow.progress = null;
      renderProgress();
      setMessage(error.message || "The batch could not be queued.", true);
    } finally {
      syncButtonState();
    }
  }

  function installSimpleFlow() {
    const input = batchInput();
    const oldPrepare = $("prepareSendButton");
    const oldConfirm = $("confirmSendButton");
    const oldCancel = $("cancelPreparedSendButton");
    const phrase = $("productionConfirmationPhrase");
    if (!input || !oldPrepare || !oldConfirm || !oldCancel || !phrase) return false;

    installStyles();
    const sendArea = input.closest("section.send-area");
    if (!sendArea) return false;

    const warning = sendArea.querySelector(".send-warning");
    if (warning) warning.textContent = "Maximum 500 recipients per batch. Enter how many you want, then press Send Batch once.";
    const heading = sendArea.querySelector(".send-danger");
    if (heading) heading.textContent = "This button sends real customer email.";

    const batchLabel = input.closest("label");
    if (batchLabel) {
      const firstText = Array.from(batchLabel.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
      if (firstText) firstText.textContent = "How many emails? ";
    }

    const phraseLabel = phrase.closest("label");
    if (phraseLabel) phraseLabel.style.display = "none";
    const preparationSummary = $("preparationSummary");
    if (preparationSummary) preparationSummary.style.display = "none";

    oldPrepare.hidden = true;
    oldConfirm.hidden = true;
    oldCancel.hidden = true;

    const toolbar = oldPrepare.closest(".toolbar");
    if (toolbar && !$("simpleSendBatchButton")) {
      toolbar.classList.add("simple-send-toolbar");
      const button = document.createElement("button");
      button.id = "simpleSendBatchButton";
      button.type = "button";
      button.className = "primary simple-send-button";
      button.addEventListener("click", () => sendBatch());
      toolbar.insertBefore(button, oldPrepare);

      const help = document.createElement("p");
      help.className = "simple-send-help";
      help.textContent = "One click prepares the audience, queues the emails, and starts the background sender. You can leave this page after it is queued.";
      toolbar.parentNode.insertBefore(help, toolbar.nextSibling);

      const progress = document.createElement("div");
      progress.id = "simpleBatchProgress";
      progress.className = "simple-send-progress hidden";
      progress.setAttribute("aria-live", "polite");
      help.parentNode.insertBefore(progress, help.nextSibling);

      input.addEventListener("input", syncButtonState);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          $("simpleSendBatchButton")?.click();
        }
      });
    }

    syncButtonState();
    return true;
  }

  function watchCampaign() {
    const campaignId = currentCampaignId();
    if (!campaignId) return;
    if (campaignId !== flow.campaignId) {
      flow.campaignId = campaignId;
      flow.activeSendId = "";
      flow.progress = null;
      flow.completionRefreshedFor = "";
      renderProgress();
      pollProgress({ discover: true }).catch(() => {});
    }
  }

  setInterval(() => {
    if (!installSimpleFlow()) return;
    watchCampaign();
    syncButtonState();
    if (activeProgressIsSending() && Date.now() - flow.lastRefreshAt >= POLL_MS) {
      flow.lastRefreshAt = Date.now();
      pollProgress().catch((error) => {
        const panel = $("simpleBatchProgress");
        if (panel) panel.title = error.message || "Progress refresh failed";
      });
    }
  }, 500);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      installSimpleFlow();
      watchCampaign();
    });
  } else {
    installSimpleFlow();
    watchCampaign();
  }
})();
