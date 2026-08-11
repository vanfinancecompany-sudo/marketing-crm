import {
  WIDGET_CHANNEL,
  createWidgetState,
  escapeHtml,
  reduceWidgetState,
  widgetRequest,
} from "./widget-core.mjs";

const HTMLElementBase = globalThis.HTMLElement || class {};
const VOICE_MAX_SECONDS = 45;
const VOICE_MAX_BYTES = 2_500_000;
const VOICE_TRANSCRIBE_URL = "/api/ai-assistant-transcribe";

const STYLES = `
  :host { --vfc-red:#d71920; --vfc-black:#111; --vfc-border:#dedede; font-family:Arial,sans-serif; color:var(--vfc-black); }
  * { box-sizing:border-box; }
  button, textarea { font:inherit; }
  .launcher { position:fixed; right:18px; bottom:18px; width:60px; height:60px; border:0; border-radius:50%; background:var(--vfc-red); color:#fff; box-shadow:0 6px 22px rgba(0,0,0,.24); cursor:pointer; font-weight:700; }
  .panel { position:fixed; right:18px; bottom:18px; width:min(380px,calc(100vw - 24px)); height:min(610px,calc(100vh - 24px)); background:#fff; border:1px solid var(--vfc-border); border-radius:16px; box-shadow:0 10px 36px rgba(0,0,0,.25); display:flex; flex-direction:column; overflow:hidden; }
  :host([panel-only]) .panel { position:absolute; inset:0; width:100%; height:100%; max-height:none; border-radius:16px; }
  .header { background:var(--vfc-black); color:#fff; padding:14px 16px; display:flex; align-items:center; gap:10px; }
  .title { flex:1; font-weight:700; }
  .header button { border:0; background:transparent; color:#fff; cursor:pointer; padding:6px; border-radius:6px; }
  .header button:focus-visible, .launcher:focus-visible, .send:focus-visible, .mic:focus-visible, .choice:focus-visible, .cta:focus-visible, .retry:focus-visible { outline:3px solid #f4b3b5; outline-offset:2px; }
  .messages { flex:1; overflow-y:auto; padding:16px; background:#f7f7f7; display:flex; flex-direction:column; gap:10px; }
  .message { max-width:86%; padding:10px 12px; border-radius:12px; line-height:1.42; white-space:pre-wrap; overflow-wrap:anywhere; }
  .assistant { align-self:flex-start; background:#fff; border:1px solid var(--vfc-border); }
  .customer { align-self:flex-end; background:var(--vfc-black); color:#fff; }
  .typing { align-self:flex-start; color:#555; font-size:14px; }
  .choices { display:flex; gap:8px; flex-wrap:wrap; }
  .choice, .cta, .retry { border:0; border-radius:8px; padding:10px 13px; cursor:pointer; font-weight:700; }
  .choice, .cta { background:var(--vfc-red); color:#fff; }
  .retry { background:#eee; color:#111; }
  .composer { border-top:1px solid var(--vfc-border); padding:10px; background:#fff; }
  .input-row { display:flex; align-items:flex-end; gap:8px; }
  textarea { flex:1; min-height:44px; max-height:110px; resize:vertical; border:1px solid #aaa; border-radius:8px; padding:10px; }
  .mic { width:44px; height:44px; flex:0 0 44px; border:1px solid #aaa; border-radius:8px; background:#fff; color:#111; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:19px; line-height:1; }
  .mic.recording { background:var(--vfc-red); border-color:var(--vfc-red); color:#fff; animation:vfcMicPulse 1s ease-in-out infinite alternate; }
  .mic:disabled { opacity:.5; cursor:not-allowed; }
  .send { min-width:66px; height:44px; border:0; border-radius:8px; background:var(--vfc-red); color:#fff; cursor:pointer; font-weight:700; }
  .send:disabled, .choice:disabled { opacity:.55; cursor:not-allowed; }
  .voice-status { min-height:16px; margin:6px 1px 0; color:#555; font-size:11px; line-height:1.3; }
  .voice-status.error { color:#a00; }
  .notice { margin:5px 1px 0; color:#555; font-size:11px; line-height:1.35; }
  .notice a { color:#333; }
  @keyframes vfcMicPulse { from { box-shadow:0 0 0 0 rgba(215,25,32,.25); } to { box-shadow:0 0 0 5px rgba(215,25,32,.08); } }
  @media (max-width:520px) {
    .launcher { right:12px; bottom:12px; width:56px; height:56px; }
    .panel { inset:0; width:100vw; height:100vh; max-height:none; border:0; border-radius:0; }
    :host([panel-only]) .panel { inset:0; width:100%; height:100%; border:1px solid var(--vfc-border); border-radius:14px; }
    .message { max-width:92%; }
    .send { min-width:58px; }
  }
`;

function messageMarkup(messages) {
  return messages.map((message) => `<div class="message ${message.role === "customer" ? "customer" : "assistant"}">${escapeHtml(message.content)}</div>`).join("");
}

function voiceSupported() {
  return Boolean(globalThis.navigator?.mediaDevices?.getUserMedia && globalThis.MediaRecorder);
}

function preferredMimeType() {
  const recorder = globalThis.MediaRecorder;
  if (!recorder?.isTypeSupported) return "";
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => recorder.isTypeSupported(type)) || "";
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The recording could not be read."));
    reader.onloadend = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.readAsDataURL(blob);
  });
}

export function assistantTitle(pageContext = {}) {
  const pageType = String(pageContext?.pageType || pageContext?.page_type || "").trim().toLowerCase();
  const productContext = String(pageContext?.productContext || pageContext?.product_context || "").trim().toLowerCase();
  if (pageType === "finance_vehicle" || pageType === "finance_general" || productContext === "finance") return "Finance Assistant";
  if (pageType === "rent2buy_general" || productContext === "rent2buy") return "Rent2Buy Assistant";
  return "Finance & Rent2Buy";
}

export class VfcAiAssistantWidget extends HTMLElementBase {
  constructor() {
    super();
    this.state = createWidgetState();
    this.voiceRecorder = null;
    this.voiceStream = null;
    this.voiceChunks = [];
    this.voiceTimer = null;
    this.voiceRecording = false;
    this.voiceTranscribing = false;
    this.voiceError = "";
    this.attachShadow?.({ mode: "open" });
  }

  connectedCallback() {
    if (this.hasAttribute("panel-only")) this.state = reduceWidgetState(this.state, { type: "open" });
    this.render();
    this.dispatchEvent(new CustomEvent("vfc-ai-request", { detail: { channel: WIDGET_CHANNEL, type: "widget_ready" }, bubbles: true, composed: true }));
  }

  disconnectedCallback() {
    this.cancelVoiceCapture();
  }

  receive(message = {}) {
    if (message.channel !== WIDGET_CHANNEL) return;
    if (message.type === "initialise") {
      if (this.state.initialised) return;
      this.state = reduceWidgetState(this.state, { type: "initialise", pageContext: message.pageContext, conversationId: message.conversationId, privacyUrl: message.privacyUrl });
      if (this.hasAttribute("panel-only")) this.state = { ...this.state, open: true };
      this.render();
      if (!this.state.conversationId) this.request("start");
      return;
    }
    if (message.type === "assistant_response") {
      this.state = reduceWidgetState(this.state, { type: "response", payload: message.payload });
      this.render();
      this.scrollToLatest();
      return;
    }
    if (message.type === "assistant_error") {
      this.state = reduceWidgetState(this.state, { type: "error" });
      this.render();
      this.scrollToLatest();
    }
  }

  request(action, { message = "", productChoice = null, retry = false } = {}) {
    if (!this.state.pageContext || this.state.loading) return;
    const request = widgetRequest({ action, message, productChoice, conversationId: this.state.conversationId, pageContext: this.state.pageContext });
    if (action === "restart") this.state = reduceWidgetState(this.state, { type: "restart" });
    this.state = reduceWidgetState(this.state, { type: "request", request, customerMessage: action === "message" && !retry ? message : "" });
    if (this.hasAttribute("panel-only")) this.state = { ...this.state, open: true };
    this.render();
    this.dispatchEvent(new CustomEvent("vfc-ai-request", { detail: request, bubbles: true, composed: true }));
    this.scrollToLatest();
  }

  sendMessage(productChoice = null) {
    const input = this.shadowRoot?.querySelector("#customerMessage");
    const message = productChoice || String(input?.value || "").trim();
    if (!message || this.state.loading || this.voiceRecording || this.voiceTranscribing) return;
    if (productChoice && this.state.pageContext?.pageType === "homepage") this.state.pageContext = { ...this.state.pageContext, productContext: productChoice };
    if (input) input.value = "";
    this.request("message", { message, productChoice });
  }

  retry() {
    const previous = this.state.retryRequest;
    if (!previous || this.state.loading) return;
    this.request(previous.action, { message: previous.message, productChoice: previous.productChoice, retry: true });
  }

  emitCta() {
    if (!this.state.cta) return;
    this.dispatchEvent(new CustomEvent("vfc-ai-request", { detail: { channel: WIDGET_CHANNEL, type: "cta", cta: this.state.cta }, bubbles: true, composed: true }));
  }

  close() {
    this.cancelVoiceCapture();
    if (this.hasAttribute("panel-only")) {
      this.dispatchEvent(new CustomEvent("vfc-ai-ui", { detail: { channel: WIDGET_CHANNEL, type: "ui_close" }, bubbles: true, composed: true }));
      return;
    }
    this.state = reduceWidgetState(this.state, { type: "close" });
    this.render();
    this.shadowRoot?.querySelector(".launcher")?.focus();
  }

  cleanupVoiceStream() {
    if (this.voiceTimer) clearTimeout(this.voiceTimer);
    this.voiceTimer = null;
    this.voiceStream?.getTracks?.().forEach((track) => track.stop());
    this.voiceStream = null;
  }

  cancelVoiceCapture() {
    if (this.voiceRecorder && this.voiceRecorder.state !== "inactive") {
      this.voiceRecorder.onstop = null;
      try { this.voiceRecorder.stop(); } catch {}
    }
    this.voiceRecorder = null;
    this.voiceChunks = [];
    this.voiceRecording = false;
    this.cleanupVoiceStream();
  }

  async toggleVoice() {
    if (this.state.loading || this.voiceTranscribing) return;
    if (this.voiceRecording) {
      try { this.voiceRecorder?.stop(); } catch { this.cancelVoiceCapture(); }
      return;
    }
    await this.startVoiceRecording();
  }

  async startVoiceRecording() {
    this.voiceError = "";
    if (!voiceSupported()) {
      this.voiceError = "Voice input isn’t supported by this browser. You can still type your question.";
      this.render();
      return;
    }

    try {
      this.voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = preferredMimeType();
      this.voiceChunks = [];
      this.voiceRecorder = mimeType ? new MediaRecorder(this.voiceStream, { mimeType }) : new MediaRecorder(this.voiceStream);
      this.voiceRecorder.addEventListener("dataavailable", (event) => {
        if (event.data?.size) this.voiceChunks.push(event.data);
      });
      this.voiceRecorder.addEventListener("stop", () => this.finishVoiceRecording(), { once: true });
      this.voiceRecording = true;
      this.voiceRecorder.start();
      this.voiceTimer = setTimeout(() => {
        if (this.voiceRecorder?.state === "recording") this.voiceRecorder.stop();
      }, VOICE_MAX_SECONDS * 1000);
      this.render();
    } catch (error) {
      this.cancelVoiceCapture();
      const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
      this.voiceError = denied
        ? "Microphone access was blocked. Allow microphone access in your browser, or type your question instead."
        : "I couldn’t start the microphone. Please try again or type your question.";
      this.render();
    }
  }

  async finishVoiceRecording() {
    const mimeType = this.voiceRecorder?.mimeType || this.voiceChunks[0]?.type || "audio/webm";
    const blob = new Blob(this.voiceChunks, { type: mimeType });
    this.voiceRecorder = null;
    this.voiceChunks = [];
    this.voiceRecording = false;
    this.cleanupVoiceStream();

    if (!blob.size) {
      this.voiceError = "I couldn’t hear a recording. Please try again.";
      this.render();
      return;
    }
    if (blob.size > VOICE_MAX_BYTES) {
      this.voiceError = "That recording was too large. Please keep voice questions under 45 seconds.";
      this.render();
      return;
    }

    this.voiceTranscribing = true;
    this.voiceError = "";
    this.render();
    try {
      const audioBase64 = await blobToBase64(blob);
      const response = await fetch(VOICE_TRANSCRIBE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ audio_base64: audioBase64, mime_type: mimeType }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !String(payload?.text || "").trim()) throw new Error(payload?.error || "Voice transcription failed.");
      const transcript = String(payload.text).trim().slice(0, 3000);
      this.voiceTranscribing = false;
      this.render();
      const input = this.shadowRoot?.querySelector("#customerMessage");
      if (input) {
        input.value = transcript;
        input.focus();
      }
    } catch (error) {
      this.voiceTranscribing = false;
      this.voiceError = String(error?.message || "").trim().slice(0, 220) || "I couldn’t transcribe that. Please try again or type your question.";
      this.render();
    }
  }

  render() {
    if (!this.shadowRoot) return;
    if (!this.state.open && !this.hasAttribute("panel-only")) {
      this.shadowRoot.innerHTML = `<style>${STYLES}</style><button class="launcher" type="button" aria-label="Ask a question">Ask Me</button>`;
      this.shadowRoot.querySelector(".launcher")?.addEventListener("click", () => { this.state = reduceWidgetState(this.state, { type: "open" }); this.render(); this.shadowRoot?.querySelector("#customerMessage")?.focus(); });
      return;
    }
    const title = assistantTitle(this.state.pageContext);
    const choices = this.state.status === "needs_product" ? `<div class="choices" aria-label="Choose a product"><button class="choice" data-product="finance" type="button">Finance</button><button class="choice" data-product="rent2buy" type="button">Rent2Buy</button></div>` : "";
    const cta = this.state.cta ? `<button class="cta" type="button">${escapeHtml(this.state.cta.label)}</button>` : "";
    const retry = !this.state.loading && this.state.retryRequest ? `<div><div class="message assistant">Sorry, I couldn’t send that. Please try again.</div><button class="retry" type="button">Try again</button></div>` : "";
    const typing = this.state.loading ? `<div class="typing" role="status">Assistant is typing…</div>` : "";
    const privacy = this.state.privacyUrl ? ` <a href="${escapeHtml(this.state.privacyUrl)}" target="_top" rel="noopener">Privacy notice</a>.` : "";
    const voiceDisabled = this.state.loading || this.voiceTranscribing;
    const voiceLabel = this.voiceRecording ? "Stop recording" : "Speak your question";
    const voiceIcon = this.voiceRecording ? "■" : "🎙";
    const voiceStatus = this.voiceError
      ? `<p class="voice-status error" role="status">${escapeHtml(this.voiceError)}</p>`
      : this.voiceRecording
        ? `<p class="voice-status" role="status">Listening… tap the red microphone to stop. Maximum ${VOICE_MAX_SECONDS} seconds.</p>`
        : this.voiceTranscribing
          ? `<p class="voice-status" role="status">Turning your voice into text…</p>`
          : `<p class="voice-status">Tap the microphone to speak, then check the text before sending.</p>`;
    this.shadowRoot.innerHTML = `<style>${STYLES}</style>
      <section class="panel" role="dialog" aria-label="${escapeHtml(title)}" aria-modal="false">
        <header class="header"><span class="title">${escapeHtml(title)}</span><button class="restart" type="button" aria-label="Restart conversation">Restart</button><button class="close" type="button" aria-label="Close ${escapeHtml(title)}">Close</button></header>
        <div class="messages" aria-live="polite" aria-busy="${this.state.loading}">${messageMarkup(this.state.messages)}${typing}${choices}${cta}${retry}</div>
        <div class="composer"><div class="input-row"><textarea id="customerMessage" aria-label="Type your message" placeholder="Type your message…" ${this.state.loading || this.voiceRecording || this.voiceTranscribing ? "disabled" : ""}></textarea><button class="mic ${this.voiceRecording ? "recording" : ""}" type="button" aria-label="${voiceLabel}" title="${voiceLabel}" ${voiceDisabled ? "disabled" : ""}>${voiceIcon}</button><button class="send" type="button" aria-label="Send message" ${this.state.loading || this.voiceRecording || this.voiceTranscribing ? "disabled" : ""}>Send</button></div>${voiceStatus}<p class="notice">Please do not send bank details, passwords or card information in chat.${privacy}</p></div>
      </section>`;
    this.shadowRoot.querySelector(".close")?.addEventListener("click", () => this.close());
    this.shadowRoot.querySelector(".restart")?.addEventListener("click", () => this.request("restart"));
    this.shadowRoot.querySelector(".send")?.addEventListener("click", () => this.sendMessage());
    this.shadowRoot.querySelector(".mic")?.addEventListener("click", () => this.toggleVoice());
    this.shadowRoot.querySelector("#customerMessage")?.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); this.sendMessage(); } });
    this.shadowRoot.querySelectorAll("[data-product]").forEach((button) => button.addEventListener("click", () => this.sendMessage(button.dataset.product)));
    this.shadowRoot.querySelector(".cta")?.addEventListener("click", () => this.emitCta());
    this.shadowRoot.querySelector(".retry")?.addEventListener("click", () => this.retry());
  }

  scrollToLatest() {
    queueMicrotask(() => { const messages = this.shadowRoot?.querySelector(".messages"); if (messages) messages.scrollTop = messages.scrollHeight; });
  }
}

if (globalThis.customElements && !globalThis.customElements.get("vfc-ai-assistant")) globalThis.customElements.define("vfc-ai-assistant", VfcAiAssistantWidget);
