(() => {
  function build({ id, email } = {}) {
    return {
      id: String(id || ""),
      email: String(email || "").trim(),
    };
  }

  globalThis.CampaignTestSendPayload = Object.freeze({ build });

  function loadSimpleSendFlow() {
    if (document.querySelector('script[data-simple-send-flow="true"]')) return;
    const script = document.createElement("script");
    script.src = "/campaigns/simple-send-flow.js?v=20260915-resilient-endpoint";
    script.dataset.simpleSendFlow = "true";
    document.body.appendChild(script);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadSimpleSendFlow, { once: true });
  } else {
    loadSimpleSendFlow();
  }
})();
