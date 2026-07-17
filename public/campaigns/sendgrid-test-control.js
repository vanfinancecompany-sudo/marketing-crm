(() => {
  const ENDPOINT = "/api/sendgrid-test-email";
  const ACCESS_HEADER = "x-marketing-customer-database-key";
  const SAFE_SEND_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function safeFailureMessage(value) {
    const message = String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, 240);
    if (!message || /authorization|bearer|api[ _-]?key|secret|token|header|response body|stack|<html/i.test(message)) {
      return "SendGrid test send failed.";
    }
    return message;
  }

  function create(options = {}) {
    const button = options.button;
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    let previewEnabled = false;
    let pending = false;

    function render() {
      if (!button) return;
      button.hidden = !previewEnabled;
      button.disabled = pending;
    }

    async function request(method, payload) {
      const response = await fetchImpl(ENDPOINT, {
        method,
        headers: {
          "Content-Type": "application/json",
          [ACCESS_HEADER]: String(options.getStoredKey?.() || ""),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) {
        const error = new Error(safeFailureMessage(result.message));
        error.status = response.status;
        throw error;
      }
      return result;
    }

    async function checkAvailability() {
      previewEnabled = false;
      render();
      try {
        const result = await request("GET");
        previewEnabled = result.preview_enabled === true;
      } catch {
        previewEnabled = false;
      }
      render();
      return previewEnabled;
    }

    async function send() {
      if (!previewEnabled || pending) return false;
      const campaignId = String(options.getCampaignId?.() || "").trim();
      if (!campaignId) {
        options.setMessage?.("Open a campaign before sending a SendGrid test.", true);
        return false;
      }
      const email = String(options.getEmail?.() || "").trim();
      pending = true;
      render();
      try {
        const result = await request("POST", { campaign_id: campaignId, email });
        const sendId = SAFE_SEND_ID.test(String(result.send_id || "")) ? String(result.send_id) : "";
        options.setMessage?.(`SendGrid test accepted${sendId ? ` — Send ID: ${sendId}` : ""}`, false);
        options.onAccepted?.(result);
        return true;
      } catch (error) {
        options.setMessage?.(safeFailureMessage(error?.message), true);
        return false;
      } finally {
        pending = false;
        render();
      }
    }

    render();
    return { checkAvailability, send };
  }

  globalThis.SendGridTestControl = { create, safeFailureMessage };
})();
