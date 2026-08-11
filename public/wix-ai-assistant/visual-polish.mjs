const WidgetClass = globalThis.customElements?.get("vfc-ai-assistant");

const FINANCE_GENERAL_REPLIES = Object.freeze([
  "How does van finance work?",
  "Who can apply for van finance?",
  "What deposit do I need?",
]);

const FINANCE_VEHICLE_REPLIES = Object.freeze([
  "Tell me about this van",
  "What deposit do I need?",
  "How do I apply for this van?",
]);

const RENT2BUY_REPLIES = Object.freeze([
  "How does Rent2Buy work?",
  "Who can apply for Rent2Buy?",
  "What do I need to apply?",
]);

export function isFinanceVehiclePage(pageContext = {}) {
  return String(pageContext?.pageType || "").trim().toLowerCase() === "finance_vehicle";
}

export function starterRepliesFor(pageContext = {}) {
  const pageType = String(pageContext?.pageType || "").trim().toLowerCase();
  if (pageType === "finance_vehicle") return [...FINANCE_VEHICLE_REPLIES];
  if (pageType === "finance_general") return [...FINANCE_GENERAL_REPLIES];
  if (pageType === "rent2buy_general") return [...RENT2BUY_REPLIES];
  return [];
}

export function isVehicleApplyPrompt(message, pageContext = {}) {
  if (!isFinanceVehiclePage(pageContext)) return false;
  const text = String(message || "").toLowerCase();
  return /\bapply now\b|\bapply for this van\b|\bready to apply\b|\bapplication form\b/.test(text);
}

const POLISH_STYLES = `
  :host {
    --vfc-soft-bg:#f4f6f8;
    --vfc-assistant:#eef5fa;
    --vfc-assistant-border:#d9e7f0;
    --vfc-customer:#25292d;
    --vfc-muted:#66717a;
  }
  .panel { background:var(--vfc-soft-bg) !important; }
  .header { padding:13px 15px !important; }
  .header-copy { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
  .header-copy .title { font-size:15px; line-height:1.2; font-weight:700; }
  .header-subtitle { color:#cfd3d7; font-size:10.5px; line-height:1.25; font-weight:400; }
  .header > button { font-size:11px; opacity:.9; }
  .messages { background:var(--vfc-soft-bg) !important; gap:11px !important; padding:15px !important; }
  .message { border-radius:17px !important; padding:10px 13px !important; line-height:1.5 !important; box-shadow:0 1px 2px rgba(17,24,39,.04); }
  .message.assistant { background:var(--vfc-assistant) !important; border:1px solid var(--vfc-assistant-border) !important; color:#17212b !important; border-bottom-left-radius:6px !important; }
  .message.customer { background:var(--vfc-customer) !important; color:#fff !important; border-bottom-right-radius:6px !important; padding:9px 12px !important; }
  .typing { color:var(--vfc-muted) !important; padding-left:3px; }
  .composer { background:#fff !important; padding:10px 11px 9px !important; }
  textarea { border-color:#cbd2d8 !important; border-radius:12px !important; background:#fff; line-height:1.35; }
  .mic { width:auto !important; min-width:65px; flex:0 0 auto !important; padding:0 10px !important; border-radius:12px !important; gap:5px; font-size:13px !important; font-weight:700; }
  .mic .mic-icon { font-size:17px; line-height:1; }
  .mic.recording { min-width:65px; }
  .send { border-radius:12px !important; min-width:61px !important; }
  .voice-status { margin-top:7px !important; font-size:11px !important; color:var(--vfc-muted) !important; }
  .voice-status.success { color:#2c6b46 !important; font-weight:700; }
  .quick-replies { display:flex; flex-wrap:wrap; gap:7px; margin:1px 0 2px; align-self:flex-start; max-width:100%; }
  .quick-reply { border:1px solid #d7dde2; background:#fff; color:#26323b; border-radius:999px; padding:8px 11px; cursor:pointer; font-size:11px; line-height:1.15; font-weight:700; box-shadow:0 1px 2px rgba(17,24,39,.04); }
  .quick-reply:hover { border-color:#bdc8d0; background:#fafcfd; }
  .quick-reply:focus-visible { outline:3px solid #f4b3b5; outline-offset:2px; }
  .quick-reply.apply-quick-reply { background:#fff4f4; border-color:#efc4c6; color:#a90f15; }
  .vehicle-apply-card { max-width:92% !important; background:#fff !important; border:1px solid #e6c2c4 !important; border-left:4px solid var(--vfc-red) !important; border-radius:15px !important; padding:13px !important; box-shadow:0 4px 14px rgba(17,24,39,.07) !important; }
  .apply-card-heading { font-size:13px; font-weight:800; color:#111; margin-bottom:6px; }
  .apply-card-copy { font-size:12px; line-height:1.45; color:#37414a; }
  .apply-card-cta { display:inline-block; margin-top:10px; background:var(--vfc-red); color:#fff; border-radius:9px; padding:9px 12px; font-size:11px; line-height:1; font-weight:800; letter-spacing:.15px; }
  .apply-card-note { margin-top:7px; color:#68727b; font-size:10.5px; line-height:1.3; }
  @media (max-width:520px) {
    .messages { padding:13px !important; }
    .message { max-width:90% !important; }
    .vehicle-apply-card { max-width:96% !important; }
    .quick-replies { gap:6px; }
    .quick-reply { padding:7px 9px; font-size:10.5px; }
    .mic { min-width:60px; padding:0 8px !important; }
  }
`;

function ensurePolishStyle(widget) {
  const root = widget.shadowRoot;
  if (!root || root.querySelector("style[data-vfc-visual-polish]")) return;
  const style = document.createElement("style");
  style.dataset.vfcVisualPolish = "true";
  style.textContent = POLISH_STYLES;
  root.appendChild(style);
}

function polishHeader(widget) {
  const root = widget.shadowRoot;
  const header = root?.querySelector(".header");
  const title = header?.querySelector(".title");
  if (!header || !title || header.querySelector(".header-copy")) return;

  const pageType = String(widget.state?.pageContext?.pageType || "").toLowerCase();
  if (pageType === "finance_vehicle" || pageType === "finance_general") title.textContent = "Van Finance Assistant";

  const copy = document.createElement("div");
  copy.className = "header-copy";
  header.insertBefore(copy, title);
  copy.appendChild(title);

  const subtitle = document.createElement("span");
  subtitle.className = "header-subtitle";
  subtitle.textContent = pageType === "finance_vehicle"
    ? "Ask about this van or van finance"
    : pageType === "rent2buy_general"
      ? "Help with Rent2Buy"
      : pageType === "finance_general"
        ? "Help with van finance"
        : "Van Finance & Rent2Buy help";
  copy.appendChild(subtitle);
}

function polishMic(widget) {
  const mic = widget.shadowRoot?.querySelector(".mic");
  if (!mic) return;
  const recording = Boolean(widget.voiceRecording);
  mic.innerHTML = `<span class="mic-icon" aria-hidden="true">${recording ? "■" : "🎙"}</span><span>${recording ? "Stop" : "Talk"}</span>`;
}

function addStarterReplies(widget) {
  const root = widget.shadowRoot;
  const messages = root?.querySelector(".messages");
  if (!messages || messages.querySelector(".quick-replies")) return;
  if (!widget.state?.initialised || widget.state?.loading || widget.voiceRecording || widget.voiceTranscribing) return;
  if (widget.state?.status === "needs_product") return;
  if ((widget.state?.messages || []).some((message) => message.role === "customer")) return;

  const replies = starterRepliesFor(widget.state?.pageContext);
  if (!replies.length) return;
  const container = document.createElement("div");
  container.className = "quick-replies";
  container.setAttribute("aria-label", "Popular questions");

  replies.forEach((reply) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `quick-reply${reply.toLowerCase().includes("apply for this van") ? " apply-quick-reply" : ""}`;
    button.textContent = reply.replace(/^How do I /i, "").replace(/\?$/, "");
    button.addEventListener("click", () => {
      if (widget.state?.loading) return;
      widget.request("message", { message: reply });
    });
    container.appendChild(button);
  });
  messages.appendChild(container);
}

function polishVehicleApplyPrompt(widget) {
  if (!isFinanceVehiclePage(widget.state?.pageContext)) return;
  const lastAssistant = [...(widget.state?.messages || [])].reverse().find((message) => message.role === "assistant");
  if (!lastAssistant || !isVehicleApplyPrompt(lastAssistant.content, widget.state?.pageContext)) return;

  const nodes = widget.shadowRoot?.querySelectorAll(".message.assistant");
  const node = nodes?.[nodes.length - 1];
  if (!node || node.classList.contains("vehicle-apply-card")) return;
  const original = node.textContent || "";
  node.classList.add("vehicle-apply-card");
  node.textContent = "";

  const heading = document.createElement("div");
  heading.className = "apply-card-heading";
  heading.textContent = "Ready to apply?";
  const copy = document.createElement("div");
  copy.className = "apply-card-copy";
  copy.textContent = original;
  const cta = document.createElement("div");
  cta.className = "apply-card-cta";
  cta.textContent = "APPLY FOR THIS VAN";
  const note = document.createElement("div");
  note.className = "apply-card-note";
  note.textContent = "Use the APPLY NOW button on this vehicle page to start your application.";
  node.append(heading, copy, cta, note);
}

function polishWidget(widget) {
  ensurePolishStyle(widget);
  polishHeader(widget);
  polishMic(widget);
  addStarterReplies(widget);
  polishVehicleApplyPrompt(widget);
}

if (WidgetClass && !WidgetClass.prototype.__vfcVisualPolishInstalled) {
  const prototype = WidgetClass.prototype;
  prototype.__vfcVisualPolishInstalled = true;

  const originalRender = prototype.render;
  prototype.render = function renderWithVisualPolish(...args) {
    const result = originalRender.apply(this, args);
    polishWidget(this);
    return result;
  };

  const currentFinish = prototype.finishVoiceRecording;
  prototype.finishVoiceRecording = async function finishVoiceRecordingWithVisualState(...args) {
    const result = await currentFinish.apply(this, args);
    const input = this.shadowRoot?.querySelector("#customerMessage");
    const status = this.shadowRoot?.querySelector(".voice-status");
    if (!this.voiceRecording && !this.voiceTranscribing && String(input?.value || "").trim() && status && !this.voiceError) {
      status.classList.add("success");
      status.textContent = "✓ Voice captured. Check the text, then press Send.";
    }
    return result;
  };

  queueMicrotask(() => {
    document.querySelectorAll("vfc-ai-assistant").forEach((widget) => polishWidget(widget));
  });
}
