import React from "react";

const ONLYVANS_LISTINGS_URL = "https://www.onlyvans-uk.com/dashboard/listings/";
const ONLYVANS_EXPORT_URL = "/api/onlyvans-export";
const ONLYVANS_BUTTON_ID = "onlyvans-posting-page-action";

function downloadAndOpenOnlyVans() {
  // Open OnlyVans from the same user gesture so popup blockers allow it.
  window.open(ONLYVANS_LISTINGS_URL, "_blank", "noopener,noreferrer");

  // Start the current-stock CSV download in the CRM tab.
  const link = document.createElement("a");
  link.href = ONLYVANS_EXPORT_URL;
  link.download = "";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export default function OnlyVansQuickAction() {
  React.useEffect(() => {
    function removeButton() {
      document.getElementById(ONLYVANS_BUTTON_ID)?.remove();
    }

    function mountButton() {
      if (window.location.pathname !== "/van-finance-facebook") {
        removeButton();
        return;
      }

      const actions = document.querySelector(
        ".posting-destination-hero .posting-page-actions",
      );
      if (!actions) return;

      const existing = document.getElementById(ONLYVANS_BUTTON_ID);
      if (existing?.parentElement === actions) return;
      existing?.remove();

      const button = document.createElement("button");
      button.id = ONLYVANS_BUTTON_ID;
      button.type = "button";
      button.className = "button button--primary";
      button.textContent = "OnlyVans CSV + Open Listings";
      button.title = "Download the latest full-stock OnlyVans CSV and open OnlyVans listings";
      button.setAttribute("aria-label", button.title);
      button.addEventListener("click", downloadAndOpenOnlyVans);

      // Keep the action in the real page header rather than as a floating overlay.
      actions.prepend(button);
    }

    mountButton();

    // The CRM uses client-side navigation. Watching the app DOM makes the button
    // appear reliably even when navigation does not emit popstate/custom events.
    const root = document.getElementById("root") || document.body;
    const observer = new MutationObserver(mountButton);
    observer.observe(root, { childList: true, subtree: true });

    window.addEventListener("popstate", mountButton);
    window.addEventListener("marketing:navigation", mountButton);
    const timer = window.setInterval(mountButton, 750);

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      window.removeEventListener("popstate", mountButton);
      window.removeEventListener("marketing:navigation", mountButton);
      removeButton();
    };
  }, []);

  return null;
}
