(() => {
  function $(id) { return document.getElementById(id); }
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
    if (event.target?.id === "desktopToggle" || event.target?.id === "mobileToggle") setTimeout(refresh, 0);
  });
  setInterval(refresh, 1000);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refresh);
  else refresh();
})();
