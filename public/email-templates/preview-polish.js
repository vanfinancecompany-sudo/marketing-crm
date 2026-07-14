(() => {
  const NEW_STOCK_COPY = {
    subject: "Fresh vans have just landed at {{company}}",
    preview: "Newly arrived vans are ready to view, with finance options available.",
    hero: "Fresh vans have just landed",
    openingHeading: "New arrivals ready to view",
    openingBody:
      "Hi {{first_name}},\n\nFresh vans have just landed at {{company}}. Browse the latest arrivals below and tap any vehicle to view the details.\n\nNationwide van sales • Delivery to your door • Finance options available • No-pressure service",
    vehicleHeading: "Latest vans to view",
    vehicleIntro:
      "Each vehicle links through to the current advert with the saved details shown here.",
    primaryCta: "View the latest vans",
    closingBody:
      "Seen something suitable? Our team can explain the available options and help with the next step.",
  };

  function $(id) { return document.getElementById(id); }

  function dispatchInput(node) {
    if (!node) return;
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setField(id, value) {
    const node = $(id);
    if (!node) return;
    node.value = value;
    dispatchInput(node);
  }

  function setBlockSetting(index, key, value) {
    const node = document.querySelector(`[data-block-index="${index}"][data-block-setting="${key}"]`);
    if (!node) return;
    node.value = value;
    dispatchInput(node);
  }

  function currentButtonUrl(index) {
    const node = document.querySelector(`[data-block-index="${index}"][data-block-setting="url"]`);
    return String(node?.value || "").trim();
  }

  function isNewStockMasterSelected() {
    return Boolean(document.querySelector('[data-master="new_stock"].is-selected'));
  }

  function applyNewStockPolish() {
    if (!isNewStockMasterSelected()) return;

    setField("default_subject", NEW_STOCK_COPY.subject);
    setField("preview_text", NEW_STOCK_COPY.preview);
    setField("hero_heading", NEW_STOCK_COPY.hero);
    setField("brandSecondary", "#f1f5f9");
    setField("secondary_colour", "#f1f5f9");

    setBlockSetting(0, "heading", NEW_STOCK_COPY.openingHeading);
    setBlockSetting(0, "body", NEW_STOCK_COPY.openingBody);
    setBlockSetting(0, "padding_size", "large");

    setBlockSetting(1, "heading", NEW_STOCK_COPY.vehicleHeading);
    setBlockSetting(1, "intro_text", NEW_STOCK_COPY.vehicleIntro);
    setBlockSetting(1, "layout", "one_column");
    setBlockSetting(1, "placeholder_note", "");

    setBlockSetting(2, "text", NEW_STOCK_COPY.primaryCta);
    setBlockSetting(2, "alignment", "centre");
    setBlockSetting(2, "width", "full");
    setBlockSetting(2, "url", currentButtonUrl(2) || "https://www.vanfinancecompany.co.uk");

    setBlockSetting(3, "body", NEW_STOCK_COPY.closingBody);
    setBlockSetting(3, "padding_size", "small");
  }

  function injectStyles() {
    if ($("emailTemplatePreviewPolishStyles")) return;
    const style = document.createElement("style");
    style.id = "emailTemplatePreviewPolishStyles";
    style.textContent = `
      body { overflow-x:hidden; }
      .preview-frame { min-height:min(82vh, 940px); max-height:none; overflow:auto; }
      .preview-frame.mobile-mode { align-items:flex-start; justify-content:center; overflow-x:hidden; padding:14px; }
      .email-preview { min-height:min(78vh, 900px); }
      .email-preview.mobile { width:390px; max-width:100%; min-height:820px; }
      .email-preview-label { margin:0 0 10px; font-weight:900; color:#334155; }
      @media (max-width:1160px) {
        .right-stack { position:static; }
        .preview-frame { min-height:720px; }
      }
      @media (max-width:760px) {
        main { padding:12px; }
        .designer { gap:12px; }
        .preview-toolbar { display:grid; }
        .email-preview.mobile { width:340px; }
        .toolbar button { white-space:normal; }
      }
    `;
    document.head.appendChild(style);
  }

  function addLabel() {
    const frame = $("previewFrame");
    if (!frame || $("emailPreviewModeLabel")) return;
    const label = document.createElement("p");
    label.id = "emailPreviewModeLabel";
    label.className = "email-preview-label";
    frame.parentNode.insertBefore(label, frame);
  }

  function updateLabel() {
    const label = $("emailPreviewModeLabel");
    const preview = $("livePreview");
    if (!label || !preview) return;
    label.textContent = preview.classList.contains("mobile") ? "Mobile email preview" : "Desktop email preview";
  }

  function refresh() {
    injectStyles();
    addLabel();
    updateLabel();
  }

  document.addEventListener("click", (event) => {
    const masterButton = event.target?.closest?.('[data-master="new_stock"]');
    if (masterButton) setTimeout(applyNewStockPolish, 0);
    if (event.target?.id === "desktopToggle" || event.target?.id === "mobileToggle") setTimeout(refresh, 0);
  });

  setInterval(refresh, 1000);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refresh);
  else refresh();
})();
