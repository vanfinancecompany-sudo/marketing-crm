(() => {
  const path = "/__marketplace-reply-poc/observer";
  if (location.origin !== "http://" + location.host || location.hostname !== "127.0.0.1" || location.pathname !== path) return;
  const surface = document.getElementById("observer-fixture");
  const report = document.getElementById("observer-report");
  if (!surface || !report) return;
  let active = false;
  let queued = false;
  let recovering = true;
  let frozen = false;
  let lifecycleGeneration = 0;

  async function observe() {
    if (frozen) return;
    if (active) {
      queued = true;
      return;
    }
    active = true;
    try {
      const started = performance.now();
      const generation = lifecycleGeneration;
      const threads = [...surface.querySelectorAll("[data-fixture-thread]")].slice(0, 16).map((row) => {
        const alreadyRead = row.dataset.alreadyRead === undefined ? null : row.dataset.alreadyRead === "true";
        const open = row.dataset.fixtureOpen === "true";
        return {
          id: row.dataset.fixtureThread,
          alreadyRead,
          open,
          historyReady: row.dataset.historyReady === "true",
          listingUrl: row.querySelector("[data-fixture-listing]")?.getAttribute("href"),
          messages: open && alreadyRead ? [...row.querySelectorAll("[data-fixture-direction]")].slice(0, 64).map((node) => ({
            id: node.getAttribute("data-message-id"),
            direction: node.dataset.fixtureDirection,
            sequence: Number(node.dataset.fixtureSequence),
          })) : [],
        };
      });
      const scanMs = performance.now() - started;
      const visibility = document.visibilityState;
      const response = await fetch(path + "-observe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(3_000),
        body: JSON.stringify({ health: surface.dataset.fixtureHealth || "layout-changed", threads, recovering }),
      });
      if (!response.ok) throw new Error("Observer service rejected the snapshot");
      const payload = await response.json();
      if (generation === lifecycleGeneration) recovering = payload.health !== "healthy";
      report.textContent = JSON.stringify({ ...payload, visibility, scanMs, roundTripMs: performance.now() - started }, null, 2);
    } catch {
      recovering = true;
      report.textContent = "Observer service unavailable. No messages were acted on.";
    } finally {
      active = false;
      if (queued) {
        queued = false;
        void observe();
      }
    }
  }

  document.addEventListener("freeze", () => {
    lifecycleGeneration++;
    frozen = true;
    recovering = true;
  });
  document.addEventListener("resume", () => {
    frozen = false;
    recovering = true;
    void observe();
  });
  new MutationObserver(observe).observe(surface, { childList: true, subtree: true, attributes: true });
  setInterval(observe, 1_200);
  void observe();
})();
