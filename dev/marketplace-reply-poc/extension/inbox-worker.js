(() => {
  const root = "/__marketplace-reply-poc";
  if (location.hostname !== "127.0.0.1" || location.pathname !== root + "/inbox") return;

  let observing = false;

  async function scanInbox() {
    const inbox = document.getElementById("reply-fixture-inbox");
    if ((inbox && !inbox.dataset.fixtureHealth) || observing) return;
    observing = true;
    try {
      const rows = [...(inbox?.querySelectorAll("[data-thread-id]") || [])];
      const response = await fetch(root + "/observe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(3_000),
        body: JSON.stringify({
          health: inbox?.dataset.fixtureHealth || "layout-changed",
          rows: rows.map((row) => ({
            threadId: row.dataset.threadId,
            listingId: row.dataset.listingId,
            incomingIds: [...row.querySelectorAll('[data-direction="incoming"][data-turn-id]')].map((item) => item.dataset.turnId),
            outgoingIds: [...row.querySelectorAll('[data-direction="outgoing"][data-outgoing-id]')].map((item) => item.dataset.outgoingId),
          })),
        }),
      });
      if (!response.ok) return;
      const { instruction } = await response.json();
      if (!instruction || inbox?.dataset.fixtureHealth !== "healthy") return;

      const row = [...inbox.querySelectorAll("[data-thread-id]")]
        .find((item) => item.dataset.threadId === instruction.threadId);
      if (!row || row.dataset.listingId !== instruction.listingId) return;
      const form = [...row.querySelectorAll("form")]
        .find((candidate) => candidate.dataset.turnId === instruction.turnId);
      const reply = form?.elements.namedItem("reply");
      if (!reply) return;
      form.dataset.attemptId = instruction.attemptId;
      reply.value = instruction.text;
      form.requestSubmit();
    } catch {
      // The server records a claim before returning it. Poll again without
      // resubmitting an attempt whose result may have been lost.
    } finally {
      observing = false;
    }
  }

  scanInbox();
  setInterval(scanInbox, 500);
})();
