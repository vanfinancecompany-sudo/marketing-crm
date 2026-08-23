import React from "react";

const ONLYVANS_LISTINGS_URL = "https://www.onlyvans-uk.com/dashboard/listings/";
const ONLYVANS_EXPORT_URL = "/api/onlyvans-export";

export default function OnlyVansQuickAction() {
  const [visible, setVisible] = React.useState(
    () => typeof window !== "undefined" && window.location.pathname === "/van-finance-facebook",
  );

  React.useEffect(() => {
    function updateVisibility() {
      setVisible(window.location.pathname === "/van-finance-facebook");
    }

    window.addEventListener("popstate", updateVisibility);
    window.addEventListener("marketing:navigation", updateVisibility);
    return () => {
      window.removeEventListener("popstate", updateVisibility);
      window.removeEventListener("marketing:navigation", updateVisibility);
    };
  }, []);

  if (!visible) return null;

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

  return (
    <div
      style={{
        position: "fixed",
        right: 18,
        bottom: 18,
        zIndex: 90,
        display: "flex",
        gap: 8,
        alignItems: "center",
        padding: 8,
        borderRadius: 12,
        background: "rgba(18, 18, 18, 0.94)",
        boxShadow: "0 10px 28px rgba(0, 0, 0, 0.28)",
      }}
    >
      <button className="button button--primary" type="button" onClick={downloadAndOpenOnlyVans}>
        OnlyVans: Download CSV + Open Listings
      </button>
    </div>
  );
}
