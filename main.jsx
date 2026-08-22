import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import SingleActiveTabGate from "./components/SingleActiveTabGate.jsx";
import "./styles.css";
import "./utils/overnightAutoRefreshPause.js";
import "./utils/postingVisibilityStateAutoSync.js";
import "./utils/vanscoWixPriceHelper.js";

const ACTIVE_INTEGRATIONS = Object.freeze({
  liveStatus: "/buffer-live-status.js",
  postingBridge: "/buffer-posting-bridge.js",
});

function ensureModuleScript(id, src) {
  if (document.getElementById(id)) return;
  const script = document.createElement("script");
  script.id = id;
  script.type = "module";
  script.src = src;
  script.dataset.marketingActiveIntegration = "true";
  document.body.appendChild(script);
}

function loadActiveBrowserIntegrations() {
  const path = window.location.pathname;
  const isFacebookPosting = path === "/van-finance-facebook" || path === "/rent2buy-facebook";
  const needsLiveStatus = path === "/" || isFacebookPosting || path.startsWith("/daily-reels");

  if (needsLiveStatus) {
    ensureModuleScript("activeBufferLiveStatus", ACTIVE_INTEGRATIONS.liveStatus);
  }
  if (isFacebookPosting) {
    ensureModuleScript("activeBufferPostingBridge", ACTIVE_INTEGRATIONS.postingBridge);
  }
}

function ActiveApp() {
  React.useEffect(() => {
    // The safety gate must win the browser startup race. Buffer observers and
    // polling are deliberately attached only after this tab owns the CRM lock.
    const startupTimer = window.setTimeout(loadActiveBrowserIntegrations, 350);
    const routeTimer = window.setInterval(loadActiveBrowserIntegrations, 1000);
    window.addEventListener("popstate", loadActiveBrowserIntegrations);

    return () => {
      window.clearTimeout(startupTimer);
      window.clearInterval(routeTimer);
      window.removeEventListener("popstate", loadActiveBrowserIntegrations);
    };
  }, []);

  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <SingleActiveTabGate>
      <ActiveApp />
    </SingleActiveTabGate>
  </React.StrictMode>
);
