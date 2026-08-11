const WidgetClass = globalThis.customElements?.get("vfc-ai-assistant");

const CONTINUE_CUE_STYLES = `
  :host([panel-only]) .panel {
    border:1px solid #202428 !important;
  }

  @keyframes vfcContinueChatPulse {
    0%, 100% {
      border-color:#d71920;
      box-shadow:0 0 0 1px rgba(215,25,32,.08);
      background:#fff;
    }
    50% {
      border-color:#c9141b;
      box-shadow:0 0 0 6px rgba(215,25,32,.16), 0 0 12px rgba(215,25,32,.12);
      background:#fff9f9;
    }
  }

  @keyframes vfcContinueChatText {
    0%, 100% { color:#4d555c; }
    50% { color:#17191b; }
  }

  @media (max-width:520px) {
    .composer.mobile-compact .input-row textarea {
      border:2px solid #d71920 !important;
      box-shadow:0 0 0 1px rgba(215,25,32,.08);
      animation:vfcContinueChatPulse 2.2s ease-in-out infinite;
    }
    .composer.mobile-compact .input-row textarea::placeholder {
      color:#4d555c;
      opacity:1;
      font-weight:700;
      animation:vfcContinueChatText 2.2s ease-in-out infinite;
    }
  }

  @media (max-width:520px) and (prefers-reduced-motion:reduce) {
    .composer.mobile-compact .input-row textarea {
      animation:none;
      border:2px solid #d71920 !important;
      box-shadow:0 0 0 3px rgba(215,25,32,.12);
    }
    .composer.mobile-compact .input-row textarea::placeholder {
      animation:none;
      color:#202428;
    }
  }
`;

export function ensureContinueCueStyle(widget) {
  const root = widget?.shadowRoot;
  if (!root || root.querySelector("style[data-vfc-mobile-attention-cue]")) return;
  const style = document.createElement("style");
  style.dataset.vfcMobileAttentionCue = "true";
  style.textContent = CONTINUE_CUE_STYLES;
  root.appendChild(style);
}

if (WidgetClass && !WidgetClass.prototype.__vfcMobileAttentionCueInstalled) {
  const prototype = WidgetClass.prototype;
  prototype.__vfcMobileAttentionCueInstalled = true;

  const previousRender = prototype.render;
  prototype.render = function renderWithMobileAttentionCue(...args) {
    const result = previousRender.apply(this, args);
    ensureContinueCueStyle(this);
    return result;
  };

  queueMicrotask(() => {
    document.querySelectorAll("vfc-ai-assistant").forEach((widget) => ensureContinueCueStyle(widget));
  });
}
