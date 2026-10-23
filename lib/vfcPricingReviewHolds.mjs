import { isVfcPricingReviewHeld } from "./vfcFinancePriceMatrix.mjs";

const historicalFindings = Object.freeze({
  WGZ8806: {
    issue: "Listing and detail monthly payments disagreed in the 8 October audit.",
    evidence: "Listing was £219/month; detail was £307/month.",
    check: "Confirm the exact listing and detail identities and both monthly fields before matching the current DealerKit price.",
  },
  WM73CXJ: {
    issue: "Listing and detail monthly payments disagreed in the 8 October audit.",
    evidence: "Listing was £344/month; detail was £334/month.",
    check: "Verify the correct current retail cash price and both monthly fields.",
  },
  YK23ZYA: {
    issue: "Duplicate listing records were found in the 8 October audit.",
    evidence: "Two Wix listing rows carried the same registration.",
    check: "Resolve duplicate records before any price update; the updater refuses duplicates.",
  },
  JM10ASM: {
    issue: "Listing and detail monthly payments disagreed in the 8 October audit.",
    evidence: "Listing was £292/month; detail was £307/month.",
    check: "Verify both live Wix records, the agreed retail price, and the proposed monthly payment.",
  },
  LM70YPT: {
    issue: "Listing and detail cash prices disagreed in the 8 October audit.",
    evidence: "Listing was £16,495; detail was £16,995.",
    check: "Confirm which cash price is correct before changing the live listing and detail together.",
  },
  MT18UFR: {
    issue: "The detail-page cash price was malformed in the 8 October audit.",
    evidence: "Listing was £21,995; detail was written as £21.995.",
    check: "Confirm the intended cash price; do not treat a formatting error as a discount.",
  },
});

function normalizeRegistration(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function getVfcPricingReviewHold(value) {
  const registration = normalizeRegistration(value);
  if (!isVfcPricingReviewHeld(registration)) return null;
  const finding = historicalFindings[registration] || {
    issue: "This registration is on the historic VFC manual pricing/VAT review list.",
    evidence: "The precise discrepancy was not recorded in the available audit notes.",
    check: "Check the live Wix listing, detail page, VAT basis and current DealerKit record before approving any change.",
  };
  return {
    registration,
    ...finding,
    historic: true,
    auditDate: historicalFindings[registration] ? "2026-10-08" : null,
  };
}
