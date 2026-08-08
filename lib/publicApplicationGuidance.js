const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

const DIRECT_APPLICATION_NAVIGATION = /^(?:how\s+(?:do|can)\s+i\s+apply(?:\s+(?:for|on)\s+(?:this|the)\s+(?:van|vehicle|finance|rent2buy))?|where\s+(?:do|can)\s+i\s+apply(?:\s+(?:for|on)\s+(?:this|the)\s+(?:van|vehicle|finance|rent2buy))?|what\s+do\s+i\s+(?:click|press|use)\s+to\s+apply|how\s+do\s+i\s+start\s+(?:my|the)\s+application|i(?:'m|\s+am)\s+ready\s+to\s+apply|i\s+want\s+to\s+apply|start\s+(?:my|the)\s+application|apply\s+now)[?.! ]*$/i;

const RENT2BUY_ELIGIBILITY = /^(?:(?:can|could|would)\s+i\s+(?:get|have)\s+(?:a\s+)?(?:van|vehicle|one)|(?:can|could|would)\s+i\s+(?:get|be)\s+(?:accepted|approved)|(?:will|would|do)\s+i\s+qualify|am\s+i\s+eligible|would\s+i\s+be\s+eligible|can\s+i\s+qualify|is\s+it\s+easy\s+to\s+(?:get|qualify|be\s+accepted)|how\s+easy\s+is\s+it\s+to\s+(?:get|qualify)|is\s+(?:rent\s*2\s*buy|rent\s+to\s+buy|rent2buy)\s+easy\s+to\s+get)[?.! ]*$/i;
const RENT2BUY_EASE = /\b(?:is\s+it\s+easy|how\s+easy|easy\s+to\s+get|easy\s+to\s+qualify)\b/i;

export function isDirectApplicationNavigationQuestion(message = "") {
  return DIRECT_APPLICATION_NAVIGATION.test(clean(message, 500));
}

export function isRent2BuyEligibilityQuestion(message = "") {
  return RENT2BUY_ELIGIBILITY.test(clean(message, 500));
}

function rent2BuyEligibilityReply(message = "") {
  if (RENT2BUY_EASE.test(clean(message, 500))) {
    return "It can be straightforward if you meet the affordability and document checks, but it isn’t automatic. There’s no credit check, and you normally also need to be within 100 miles of Southampton. If you send me your postcode, I can check whether you’re in the covered area.";
  }
  return "Potentially, yes. Rent2Buy is subject to eligibility and checks. There’s no credit check; we assess affordability and the required documents instead, and you normally also need to be within 100 miles of Southampton. If you send me your postcode, I can check whether you’re in the covered area.";
}

export function publicApplicationGuidanceReply({ message = "", pageType = "", productLock = "" } = {}) {
  if (!["finance", "rent2buy"].includes(productLock)) return null;

  // On a Rent2Buy-locked page the product is already known, so short eligibility questions must not
  // fall into generic clarification/recovery just because the customer says "it", "one" or "a van".
  if (productLock === "rent2buy" && isRent2BuyEligibilityQuestion(message)) {
    return rent2BuyEligibilityReply(message);
  }

  if (!isDirectApplicationNavigationQuestion(message)) return null;

  if (productLock === "finance") {
    if (pageType === "finance_vehicle") {
      return "To apply for this van, use the APPLY NOW button on this page. That keeps the application tied to the vehicle you’re viewing.";
    }
    return "To start a Finance application, use the APPLY NOW button on this page.";
  }

  return "To start a Rent2Buy application, use the APPLY NOW button on this page.";
}
