(() => {
  function build({ id, email } = {}) {
    return {
      id: String(id || ""),
      email: String(email || "").trim(),
    };
  }

  globalThis.CampaignTestSendPayload = Object.freeze({ build });
})();
