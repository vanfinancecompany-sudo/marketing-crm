const WidgetClass = globalThis.customElements?.get("vfc-ai-assistant");

const CONTINUE_CUE_STYLES = `
  :host([panel-only]) .panel {
    border:1px solid #202428 !important;
  }

  @keyframes vfcContinueChatPulse {
    0%, 100% {
      border-color:#9aa1a7;
      box-shadow:0 0 0 0 rgba(215,25,32,0);
      background:#fff;
    }
    50% {
      border-color:#d71920;
      box-shadow:0 0 0 4px rgba(215,25,32,.11);
      background:#fffafa;
    }
  }

  @keyframes vfcContinueChatText {
    0%, 100% { color:#59626a; }
    50% { color:#17191b; }
  }

  @media (max-width:520px) {
    .composer.mobile-compact .input-row textarea {
      border-color:#9aa1a7 !important;
      box-shadow:0 0 0 0 rgba(215,25,32,0);
      animation:vfcContinueChatPulse 2.4s ease-in-out infinite;
    }
    .composer.mobile-compact .input-row textarea::placeholder {
      color:#59626a;
      opacity:1;
      font-weight:700;
      animation:vfcContinueChatText 2.4s ease-in-out infinite;
    }
  }

  @media (max-width:520px) and (prefers-reduced-motion:reduce) {
    .composer.mobile-compact .input-row textarea {
      animation:none;
      border-color:#d71920 !important;
      box-shadow:0 0 0 2px rgba(215,25,32,.12);
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
