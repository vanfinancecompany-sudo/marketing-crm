const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

const DIRECT_APPLICATION_NAVIGATION = /^(?:how\s+(?:do|can)\s+i\s+apply(?:\s+(?:for|on)\s+(?:this|the)\s+(?:van|vehicle|finance|rent2buy))?|where\s+(?:do|can)\s+i\s+apply(?:\s+(?:for|on)\s+(?:this|the)\s+(?:van|vehicle|finance|rent2buy))?|what\s+do\s+i\s+(?:click|press|use)\s+to\s+apply|how\s+do\s+i\s+start\s+(?:my|the)\s+application|i(?:'m|\s+am)\s+ready\s+to\s+apply|i\s+want\s+to\s+apply|start\s+(?:my|the)\s+application|apply\s+now)[?.! ]*$/i;

export function isDirectApplicationNavigationQuestion(message = "") {
  return DIRECT_APPLICATION_NAVIGATION.test(clean(message, 500));
}

export function publicApplicationGuidanceReply({ message = "", pageType = "", productLock = "" } = {}) {
  if (!["finance", "rent2buy"].includes(productLock)) return null;
  if (!isDirectApplicationNavigationQuestion(message)) return null;

  if (productLock === "finance") {
    if (pageType === "finance_vehicle") {
      return "To apply for this van, use the APPLY NOW button on this page. That keeps the application tied to the vehicle you’re viewing.";
    }
    return "To start a Finance application, use the APPLY NOW button on this page.";
  }

  return "To start a Rent2Buy application, use the APPLY NOW button on this page.";
}
