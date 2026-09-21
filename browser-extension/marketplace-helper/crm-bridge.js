(() => {
  const hostname = String(window.location.hostname || "").toLowerCase();
  const isMarketingCrmHost =
    hostname === "marketing-crm-six.vercel.app" ||
    hostname.startsWith("marketing-crm-") ||
    hostname.startsWith("marketing-crm-git-") ||
    hostname.startsWith("marketing-crm-six-") ||
    hostname.startsWith("crm-b5po-");
  if (!isMarketingCrmHost) return;

  const JOB_TYPE = "VFC_MARKETPLACE_JOB";
  const ACK_TYPE = "VFC_MARKETPLACE_JOB_STORED";
  const PUBLISHED_TYPE = "VFC_MARKETPLACE_PUBLISHED";
  const RECEIPT_ACK_TYPE = "VFC_MARKETPLACE_RECEIPT_ACK";
  const GROUP_DISCOVERY_START = "VFC_GROUP_DISCOVERY_START";
  const GROUP_DISCOVERY_ACK = "VFC_GROUP_DISCOVERY_ACK";
  const GROUP_DISCOVERY_COMPLETE = "VFC_GROUP_DISCOVERY_COMPLETE";
  const GROUP_INSPECTION_START = "VFC_GROUP_INSPECTION_START";
  const GROUP_INSPECTION_ACK = "VFC_GROUP_INSPECTION_ACK";
  const GROUP_INSPECTION_COMPLETE = "VFC_GROUP_INSPECTION_COMPLETE";
  const GROUP_POST_JOB = "VFC_GROUP_POST_JOB";
  const GROUP_POST_JOB_ACK = "VFC_GROUP_POST_JOB_ACK";
  const GROUP_POST_SUBMITTED = "VFC_GROUP_POST_SUBMITTED";
  const GROUP_POST_EVENT_ACK = "VFC_GROUP_POST_EVENT_ACK";
  const GROUP_POST_STATUS_START = "VFC_GROUP_POST_STATUS_START";
  const GROUP_POST_STATUS_ACK = "VFC_GROUP_POST_STATUS_ACK";
  const GROUP_POST_STATUS_COMPLETE = "VFC_GROUP_POST_STATUS_COMPLETE";
  const FACEBOOK_HELPER_PING = "VFC_FACEBOOK_HELPER_PING";
  const FACEBOOK_HELPER_PONG = "VFC_FACEBOOK_HELPER_PONG";

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

    if (message.source === "vfc-marketing-crm" && message.type === FACEBOOK_HELPER_PING) {
      const id = message.id || "";
      try {
        const result = await chrome.runtime.sendMessage({ type: "GET_FACEBOOK_HELPER_STATUS" });
        window.postMessage({
          source: "vfc-facebook-helper",
          type: FACEBOOK_HELPER_PONG,
          id,
          ok: Boolean(result?.ok),
          version: result?.version || chrome.runtime.getManifest()?.version || "",
          capabilities: result?.capabilities || [],
          hostname,
          error: result?.error || "",
        }, window.location.origin);
      } catch (error) {
        window.postMessage({
          source: "vfc-facebook-helper",
          type: FACEBOOK_HELPER_PONG,
          id,
          ok: false,
          version: chrome.runtime.getManifest()?.version || "",
          capabilities: [],
          hostname,
          error: String(error?.message || error),
        }, window.location.origin);
      }
      return;
    }

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

    if (message.source === "vfc-marketing-crm" && message.type === GROUP_DISCOVERY_START) {
      const id = message.id || message.job?.id || "";
      try {
        const result = await chrome.runtime.sendMessage({ type: "STORE_GROUP_DISCOVERY_JOB", job: message.job });
        window.postMessage({
          source: "vfc-facebook-helper",
          type: GROUP_DISCOVERY_ACK,
          id,
          ok: Boolean(result?.ok),
          error: result?.error || "",
        }, window.location.origin);
      } catch (error) {
        window.postMessage({
          source: "vfc-facebook-helper",
          type: GROUP_DISCOVERY_ACK,
          id,
          ok: false,
          error: String(error?.message || error),
        }, window.location.origin);
      }
      return;
    }

    if (message.source === "vfc-marketing-crm" && message.type === GROUP_INSPECTION_START) {
      const id = message.id || message.job?.id || "";
      try {
        const result = await chrome.runtime.sendMessage({ type: "STORE_GROUP_INSPECTION_JOB", job: message.job });
        window.postMessage({
          source: "vfc-facebook-helper",
          type: GROUP_INSPECTION_ACK,
          id,
          ok: Boolean(result?.ok),
          error: result?.error || "",
        }, window.location.origin);
      } catch (error) {
        window.postMessage({
          source: "vfc-facebook-helper",
          type: GROUP_INSPECTION_ACK,
          id,
          ok: false,
          error: String(error?.message || error),
        }, window.location.origin);
      }
      return;
    }

    if (message.source === "vfc-marketing-crm" && message.type === GROUP_POST_JOB) {
      const id = message.id || message.job?.id || "";
      try {
        const result = await chrome.runtime.sendMessage({ type: "STORE_GROUP_POST_JOB", job: message.job });
        window.postMessage({
          source: "vfc-facebook-helper",
          type: GROUP_POST_JOB_ACK,
          id,
          ok: Boolean(result?.ok),
          error: result?.error || "",
        }, window.location.origin);
      } catch (error) {
        window.postMessage({
          source: "vfc-facebook-helper",
          type: GROUP_POST_JOB_ACK,
          id,
          ok: false,
          error: String(error?.message || error),
        }, window.location.origin);
      }
      return;
    }

    if (message.source === "vfc-marketing-crm" && message.type === GROUP_POST_STATUS_START) {
      const id = message.id || message.job?.id || "";
      try {
        const result = await chrome.runtime.sendMessage({ type: "STORE_GROUP_POST_STATUS_JOB", job: message.job });
        window.postMessage({
          source: "vfc-facebook-helper",
          type: GROUP_POST_STATUS_ACK,
          id,
          ok: Boolean(result?.ok),
          error: result?.error || "",
        }, window.location.origin);
      } catch (error) {
        window.postMessage({
          source: "vfc-facebook-helper",
          type: GROUP_POST_STATUS_ACK,
          id,
          ok: false,
          error: String(error?.message || error),
        }, window.location.origin);
      }
      return;
    }

    if (message.source === "vfc-marketing-crm" && message.type === GROUP_POST_EVENT_ACK) {
      chrome.runtime.sendMessage({
        type: "ACK_GROUP_POST_EVENT",
        eventId: message.eventId || "",
      }).catch(() => {});
      return;
    }

    if (message.source === "vfc-marketing-crm" && message.type === RECEIPT_ACK_TYPE) {
      chrome.runtime.sendMessage({ type: "ACK_MARKETPLACE_RECEIPT", receiptId: message.receiptId || "" }).catch(() => {});
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "MARKETPLACE_PUBLISHED" && message.receipt) {
      window.postMessage({
        source: "vfc-marketplace-extension",
        type: PUBLISHED_TYPE,
        receipt: message.receipt,
      }, window.location.origin);
      return;
    }

    if (message?.type === "GROUP_DISCOVERY_COMPLETE") {
      window.postMessage({
        source: "vfc-facebook-helper",
        type: GROUP_DISCOVERY_COMPLETE,
        jobId: message.jobId || "",
        productKey: message.productKey || "",
        candidates: message.candidates || [],
        queryCount: Number(message.queryCount || 0),
      }, window.location.origin);
      return;
    }

    if (message?.type === "GROUP_INSPECTION_COMPLETE") {
      window.postMessage({
        source: "vfc-facebook-helper",
        type: GROUP_INSPECTION_COMPLETE,
        jobId: message.jobId || "",
        productKey: message.productKey || "",
        inspections: message.inspections || [],
      }, window.location.origin);
      return;
    }

    if (message?.type === "GROUP_POST_SUBMITTED" && message.event) {
      window.postMessage({
        source: "vfc-facebook-helper",
        type: GROUP_POST_SUBMITTED,
        event: message.event,
      }, window.location.origin);
      return;
    }

    if (message?.type === "GROUP_POST_STATUS_COMPLETE") {
      window.postMessage({
        source: "vfc-facebook-helper",
        type: GROUP_POST_STATUS_COMPLETE,
        jobId: message.jobId || "",
        productKey: message.productKey || "",
        results: message.results || [],
      }, window.location.origin);
    }
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

  chrome.runtime.sendMessage({ type: "GET_LAST_GROUP_POST_EVENT" })
    .then((result) => {
      if (!result?.event) return;
      window.postMessage({
        source: "vfc-facebook-helper",
        type: GROUP_POST_SUBMITTED,
        event: result.event,
      }, window.location.origin);
    })
    .catch(() => {});
})();
