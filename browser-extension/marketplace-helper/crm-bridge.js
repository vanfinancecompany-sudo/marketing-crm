(() => {
  const JOB_TYPE = "VFC_MARKETPLACE_JOB";
  const ACK_TYPE = "VFC_MARKETPLACE_JOB_STORED";
  const PUBLISHED_TYPE = "VFC_MARKETPLACE_PUBLISHED";
  const RECEIPT_ACK_TYPE = "VFC_MARKETPLACE_RECEIPT_ACK";

  function validJob(job) {
    return Boolean(
      job &&
      typeof job === "object" &&
      job.id &&
      job.registration &&
      job.destination === "Facebook Marketplace" &&
      Array.isArray(job.images) &&
      job.images.length,
    );
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const message = event.data || {};

    if (message.source === "vfc-marketing-crm" && message.type === JOB_TYPE) {
      const job = message.job;
      if (!validJob(job)) {
        window.postMessage({
          source: "vfc-marketplace-extension",
          type: ACK_TYPE,
          jobId: job?.id || "",
          ok: false,
          error: "Marketplace job failed extension validation.",
        }, window.location.origin);
        return;
      }

      try {
        const result = await chrome.runtime.sendMessage({ type: "STORE_MARKETPLACE_JOB", job });
        window.postMessage({
          source: "vfc-marketplace-extension",
          type: ACK_TYPE,
          jobId: job.id,
          ok: Boolean(result?.ok),
          error: result?.error || "",
        }, window.location.origin);
      } catch (error) {
        window.postMessage({
          source: "vfc-marketplace-extension",
          type: ACK_TYPE,
          jobId: job.id,
          ok: false,
          error: String(error?.message || error),
        }, window.location.origin);
      }
      return;
    }

    if (message.source === "vfc-marketing-crm" && message.type === RECEIPT_ACK_TYPE) {
      chrome.runtime.sendMessage({ type: "ACK_MARKETPLACE_RECEIPT", receiptId: message.receiptId || "" }).catch(() => {});
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "MARKETPLACE_PUBLISHED" || !message.receipt) return;
    window.postMessage({
      source: "vfc-marketplace-extension",
      type: PUBLISHED_TYPE,
      receipt: message.receipt,
    }, window.location.origin);
  });

  chrome.runtime.sendMessage({ type: "GET_LAST_MARKETPLACE_RECEIPT" })
    .then((result) => {
      if (!result?.receipt) return;
      window.postMessage({
        source: "vfc-marketplace-extension",
        type: PUBLISHED_TYPE,
        receipt: result.receipt,
      }, window.location.origin);
    })
    .catch(() => {});
})();
