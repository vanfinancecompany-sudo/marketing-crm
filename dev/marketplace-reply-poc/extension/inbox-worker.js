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
            outgoingId: row.querySelector("[data-outgoing-id]")?.dataset.outgoingId,
          })),
        }),
      });
      if (!response.ok) return;
      const { instruction } = await response.json();
      if (!instruction || inbox?.dataset.fixtureHealth !== "healthy") return;

      const row = [...inbox.querySelectorAll("[data-thread-id]")]
        .find((item) => item.dataset.threadId === instruction.threadId);
      const form = row?.querySelector("form");
      const reply = form?.elements.namedItem("reply");
      if (!reply || row.dataset.listingId !== instruction.listingId || row.querySelector("[data-outgoing-id]")) return;
      form.dataset.attemptId = instruction.attemptId;
      reply.value = instruction.text;
      form.requestSubmit();
    } catch {
      // The next scan only requests a new claim. A recorded attempt can never
      // be automatically submitted again when a previous response was lost.
    } finally {
      observing = false;
    }
  }

  scanInbox();
  setInterval(scanInbox, 500);
})();
