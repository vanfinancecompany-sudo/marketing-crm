(() => {
  const path = "/__marketplace-reply-poc/observer";
  if (location.origin !== "http://" + location.host || location.hostname !== "127.0.0.1" || location.pathname !== path) return;
  const surface = document.getElementById("observer-fixture");
  const report = document.getElementById("observer-report");
  if (!surface || !report) return;
  let active = false;
  let queued = false;

  async function observe() {
    if (active) {
      queued = true;
      return;
    }
    active = true;
    try {
      const started = performance.now();
      const threads = [...surface.querySelectorAll("[data-fixture-thread]")].slice(0, 16).map((row) => {
        const alreadyRead = row.dataset.alreadyRead === "true";
        return {
          id: row.dataset.fixtureThread,
          alreadyRead,
          historyReady: row.dataset.historyReady === "true",
          listingUrl: row.querySelector("[data-fixture-listing]")?.getAttribute("href"),
          messages: alreadyRead ? [...row.querySelectorAll("[data-fixture-direction]")].slice(0, 64).map((node) => ({
            id: node.getAttribute("data-message-id"),
            direction: node.dataset.fixtureDirection,
            sequence: Number(node.dataset.fixtureSequence),
          })) : [],
        };
      });
      const scanMs = performance.now() - started;
      const response = await fetch(path + "-observe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(3_000),
        body: JSON.stringify({ health: surface.dataset.fixtureHealth || "layout-changed", threads, scanMs }),
      });
      if (!response.ok) throw new Error("Observer service rejected the snapshot");
      const payload = await response.json();
      report.textContent = JSON.stringify({ ...payload, scanMs, roundTripMs: performance.now() - started }, null, 2);
    } catch {
      report.textContent = "Observer service unavailable. No messages were acted on.";
    } finally {
      active = false;
      if (queued) {
        queued = false;
        void observe();
      }
    }
  }

  new MutationObserver(observe).observe(surface, { childList: true, subtree: true, attributes: true });
  setInterval(observe, 1_200);
  void observe();
})();
