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
    "Mode: " + s.mode,
    "Tab: " + (hb ? hb.health + " (" + hb.visibility + "), " + Math.round((Date.now() - Date.parse(hb.at)) / 1000) + "s ago" : "not seen"),
    "Chats visible: " + (hb?.rows ?? 0) + ", unread: " + (hb?.unread ?? 0),
    "Sent " + s.counts.sent + " · drafts " + s.counts.drafts + " · needs a person " + s.counts.needsHuman,
  ].join("\n");
}

const refresh = () => call("/status").then(render);
document.getElementById("stop").onclick = () => call("/stop", {}).then(render);
document.querySelectorAll("[data-mode]").forEach((b) => {
  b.onclick = () => call("/control", { mode: b.dataset.mode }).then((s) => { render(s); chrome.runtime.sendMessage({ type: "supervise" }); });
});
chrome.storage.local.get("home").then(({ home }) => { document.getElementById("home").value = home || DEFAULT_HOME; });
document.getElementById("saveHome").onclick = () => {
  const value = document.getElementById("home").value.trim();
  if (/^https:\/\/www\.facebook\.com\//.test(value) || /^http:\/\/127\.0\.0\.1:4618\/__fb\//.test(value)) chrome.storage.local.set({ home: value });
};
refresh();
setInterval(refresh, 2000);
