const call = (path, body) => chrome.runtime.sendMessage({ type: "api", path, body });
const DEFAULT_HOME = "https://www.facebook.com/marketplace/inbox/";

function render(s) {
  if (!s || s.error) {
    document.getElementById("status").textContent = "Local service not running.\nStart it, then reopen this popup.";
    return;
  }
  document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === s.mode));
  const hb = s.heartbeat;
  document.getElementById("status").textContent = [
    s.monitoring?.ok ? "MONITORING MARKETPLACE: YES" : "MONITORING MARKETPLACE: NO - " + (s.monitoring?.reasons?.[0] || "unknown"),
    "Mode: " + s.mode,
    "Tab: " + (hb ? hb.health + " (" + hb.visibility + "), " + Math.round((Date.now() - Date.parse(hb.at)) / 1000) + "s ago" : "not seen"),
    "Chats visible: " + (hb?.rows ?? 0) + ", unread: " + (hb?.unread ?? 0),
    "List: " + (hb?.list || "none") + (hb?.opener ? " (" + hb.opener + ")" : ""),
    ...(s.mode !== "off" && hb && !hb.rows ? ["WARNING: the assistant tab's page shows no conversation list, so new messages cannot be detected."] : []),
    "Sent " + s.counts.sent + " · drafts " + s.counts.drafts + " · needs a person " + s.counts.needsHuman,
  ].join("\n");
}

const refresh = () => call("/status").then(render);
document.getElementById("stop").onclick = () => call("/stop", {}).then(render);
document.querySelectorAll("[data-mode]").forEach((b) => {
  b.onclick = () => {
    if (b.dataset.mode === "send" && !confirm("Switch on LIVE sending to Facebook customers on the allowlist?")) return;
    call("/control", { mode: b.dataset.mode }).then((s) => { render(s); chrome.runtime.sendMessage({ type: "supervise" }); });
  };
});
chrome.storage.local.get("home").then(({ home }) => { document.getElementById("home").value = home || DEFAULT_HOME; });
document.getElementById("saveHome").onclick = () => {
  const value = document.getElementById("home").value.trim();
  if (/^https:\/\/www\.facebook\.com\//.test(value) || /^http:\/\/127\.0\.0\.1:4618\/__fb\//.test(value)) chrome.storage.local.set({ home: value });
};
refresh();
setInterval(refresh, 2000);

document.getElementById("diag").onclick = async () => {
  const out = document.getElementById("diagResult");
  out.textContent = "Capturing…";
  const reply = await chrome.runtime.sendMessage({ type: "diagnose-active" });
  out.textContent = reply?.error
    ? "Not captured: " + reply.error
    : "Saved. " + reply.rows + " conversation rows, " + reply.unread + " classed unread on " + reply.path + ".";
};
