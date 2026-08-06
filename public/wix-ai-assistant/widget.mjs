import {
  WIDGET_CHANNEL,
  createWidgetState,
  escapeHtml,
  reduceWidgetState,
  widgetRequest,
} from "./widget-core.mjs";

const HTMLElementBase = globalThis.HTMLElement || class {};

const STYLES = `
  :host { --vfc-red:#d71920; --vfc-black:#111; --vfc-border:#dedede; font-family:Arial,sans-serif; color:var(--vfc-black); }
  * { box-sizing:border-box; }
  button, textarea { font:inherit; }
  .launcher { position:fixed; right:18px; bottom:18px; width:60px; height:60px; border:0; border-radius:50%; background:var(--vfc-red); color:#fff; box-shadow:0 6px 22px rgba(0,0,0,.24); cursor:pointer; font-weight:700; }
  .panel { position:fixed; right:18px; bottom:18px; width:min(380px,calc(100vw - 24px)); height:min(610px,calc(100vh - 24px)); background:#fff; border:1px solid var(--vfc-border); border-radius:16px; box-shadow:0 10px 36px rgba(0,0,0,.25); display:flex; flex-direction:column; overflow:hidden; }
  .header { background:var(--vfc-black); color:#fff; padding:14px 16px; display:flex; align-items:center; gap:10px; }
  .title { flex:1; font-weight:700; }
  .header button { border:0; background:transparent; color:#fff; cursor:pointer; padding:6px; border-radius:6px; }
  .header button:focus-visible, .launcher:focus-visible, .send:focus-visible, .choice:focus-visible, .cta:focus-visible, .retry:focus-visible { outline:3px solid #f4b3b5; outline-offset:2px; }
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
  .send { min-width:66px; height:44px; border:0; border-radius:8px; background:var(--vfc-red); color:#fff; cursor:pointer; font-weight:700; }
  .send:disabled, .choice:disabled { opacity:.55; cursor:not-allowed; }
  .notice { margin:8px 1px 0; color:#555; font-size:11px; line-height:1.35; }
  .notice a { color:#333; }
  @media (max-width:520px) {
    .launcher { right:12px; bottom:12px; width:56px; height:56px; }
    .panel { inset:0; width:100vw; height:100vh; max-height:none; border:0; border-radius:0; }
    .message { max-width:92%; }
  }
`;

function messageMarkup(messages) {
  return messages.map((message) => `<div class="message ${message.role === "customer" ? "customer" : "assistant"}">${escapeHtml(message.content)}</div>`).join("");
}

export class VfcAiAssistantWidget extends HTMLElementBase {
  constructor() {
    super();
    this.state = createWidgetState();
    this.attachShadow?.({ mode: "open" });
  }

  connectedCallback() {
    this.render();
    this.dispatchEvent(new CustomEvent("vfc-ai-request", { detail: { channel: WIDGET_CHANNEL, type: "widget_ready" }, bubbles: true, composed: true }));
  }

  receive(message = {}) {
    if (message.channel !== WIDGET_CHANNEL) return;
    if (message.type === "initialise") {
      if (this.state.initialised) return;
      this.state = reduceWidgetState(this.state, { type: "initialise", pageContext: message.pageContext, conversationId: message.conversationId, privacyUrl: message.privacyUrl });
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
    this.render();
    this.dispatchEvent(new CustomEvent("vfc-ai-request", { detail: request, bubbles: true, composed: true }));
    this.scrollToLatest();
  }

  sendMessage(productChoice = null) {
    const input = this.shadowRoot?.querySelector("#customerMessage");
    const message = productChoice || String(input?.value || "").trim();
    if (!message || this.state.loading) return;
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

  render() {
    if (!this.shadowRoot) return;
    if (!this.state.open) {
      this.shadowRoot.innerHTML = `<style>${STYLES}</style><button class="launcher" type="button" aria-label="Open Van Finance assistant">Chat</button>`;
      this.shadowRoot.querySelector(".launcher")?.addEventListener("click", () => { this.state = reduceWidgetState(this.state, { type: "open" }); this.render(); this.shadowRoot?.querySelector("#customerMessage")?.focus(); });
      return;
    }
    const choices = this.state.status === "needs_product" ? `<div class="choices" aria-label="Choose a product"><button class="choice" data-product="finance" type="button">Finance</button><button class="choice" data-product="rent2buy" type="button">Rent2Buy</button></div>` : "";
    const cta = this.state.cta ? `<button class="cta" type="button">${escapeHtml(this.state.cta.label)}</button>` : "";
    const retry = !this.state.loading && this.state.retryRequest ? `<div><div class="message assistant">Sorry, I couldn’t send that. Please try again.</div><button class="retry" type="button">Try again</button></div>` : "";
    const typing = this.state.loading ? `<div class="typing" role="status">Assistant is typing…</div>` : "";
    const privacy = this.state.privacyUrl ? ` <a href="${escapeHtml(this.state.privacyUrl)}" target="_top" rel="noopener">Privacy notice</a>.` : "";
    this.shadowRoot.innerHTML = `<style>${STYLES}</style>
      <section class="panel" role="dialog" aria-label="Van Finance assistant" aria-modal="false">
        <header class="header"><span class="title">Van Finance Assistant</span><button class="restart" type="button" aria-label="Restart conversation">Restart</button><button class="close" type="button" aria-label="Close assistant">Close</button></header>
        <div class="messages" aria-live="polite" aria-busy="${this.state.loading}">${messageMarkup(this.state.messages)}${typing}${choices}${cta}${retry}</div>
        <div class="composer"><div class="input-row"><textarea id="customerMessage" aria-label="Type your message" placeholder="Type your message…" ${this.state.loading ? "disabled" : ""}></textarea><button class="send" type="button" aria-label="Send message" ${this.state.loading ? "disabled" : ""}>Send</button></div><p class="notice">Please do not send bank details, passwords or card information in chat.${privacy}</p></div>
      </section>`;
    this.shadowRoot.querySelector(".close")?.addEventListener("click", () => { this.state = reduceWidgetState(this.state, { type: "close" }); this.render(); this.shadowRoot?.querySelector(".launcher")?.focus(); });
    this.shadowRoot.querySelector(".restart")?.addEventListener("click", () => this.request("restart"));
    this.shadowRoot.querySelector(".send")?.addEventListener("click", () => this.sendMessage());
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
