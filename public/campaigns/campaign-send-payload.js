(() => {
  function build({ id, email, testFirstName } = {}) {
    return {
      id: String(id || ""),
      email: String(email || "").trim(),
      test_first_name: String(testFirstName || "").trim(),
    };
  }

  globalThis.CampaignTestSendPayload = Object.freeze({ build });
})();
