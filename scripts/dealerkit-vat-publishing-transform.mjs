const VFC_POLICY_IMPORT = 'import { resolveVanFinanceVatText } from "./dealerKitVatPolicy.js";';
const R2B_POLICY_IMPORT = 'import { rent2BuyRentalVatPolicy } from "./dealerKitVatPolicy.js";';

function replaceOrThrow(source, pattern, replacement, label) {
  if (typeof pattern === "string") {
    if (!source.includes(pattern)) throw new Error(`DealerKit VAT transform could not find ${label}.`);
    return source.replace(pattern, replacement);
  }
  if (!pattern.test(source)) throw new Error(`DealerKit VAT transform could not find ${label}.`);
  return source.replace(pattern, replacement);
}

export function transformVanFinanceVatSource(input) {
  let source = String(input || "");

  if (!source.includes(VFC_POLICY_IMPORT)) {
    const importAnchor = '} from "./vanscoWixPrice.js";';
    source = replaceOrThrow(
      source,
      importAnchor,
      `${importAnchor}\n${VFC_POLICY_IMPORT}`,
      "Van Finance VAT policy import anchor",
    );
  }

  if (!source.includes("DEALERKIT_VFC_VAT_POLICY")) {
    source = replaceOrThrow(
      source,
      /function sourceVatText\(vehicle = \{\}\) \{[\s\S]*?\n\}/,
      `function sourceVatText(vehicle = {}) {\n  // DEALERKIT_VFC_VAT_POLICY: verified Wix values stay +VAT or N/A; ambiguous cases still block.\n  return resolveVanFinanceVatText(vehicle);\n}`,
      "Van Finance sourceVatText",
    );
  }

  return source;
}

export function transformRent2BuyVatSource(input) {
  let source = String(input || "");

  if (!source.includes(R2B_POLICY_IMPORT)) {
    const importAnchor = 'import { normalizeFinanceRegistration, parseRetailPrice } from "./vanscoWixPrice.js";';
    source = replaceOrThrow(
      source,
      importAnchor,
      `${importAnchor}\n${R2B_POLICY_IMPORT}`,
      "Rent2Buy VAT policy import anchor",
    );
  }

  if (!source.includes("DEALERKIT_RENT2BUY_VAT_POLICY")) {
    const legacyBlock = `  const plusVat = clean(vatStatus, 80) === "plus_vat";\n  const noVat = clean(vatStatus, 80) === "no_vat";\n  const vatKnown = plusVat || noVat;\n\n  return {\n    retailPrice: retail,\n    mileage: derived.mileage,\n    termMonths: rule.termMonths,\n    upliftPercent: rule.upliftPercent,\n    grossFactor: rule.grossFactor,\n    monthly,\n    upfront,\n    ...structure,\n    vatStatus: clean(vatStatus, 80) || "unknown",\n    vatKnown,\n    monthlyIncVat: plusVat ? currencyNumber(monthly * 1.2) : monthly,\n    upfrontIncVat: plusVat ? currencyNumber(upfront * 1.2) : upfront,\n    monthlyDisplay: plusVat\n      ? \`£\${monthly} +VAT (£\${currencyNumber(monthly * 1.2)} INC VAT)\`\n      : \`£\${monthly}\`,\n    upfrontDisplay: plusVat\n      ? \`£\${upfront} +VAT (£\${currencyNumber(upfront * 1.2)} INC VAT)\`\n      : \`£\${upfront}\`,\n    listingMonthlyDisplay: \`£\${monthly} PM\`,\n    listingInitialDisplay: plusVat ? \`INITIAL RENTAL £\${upfront} +VAT\` : \`INITIAL RENTAL £\${upfront}\`,\n  };`;

    const replacement = `  // DEALERKIT_RENT2BUY_VAT_POLICY: Rent2Buy rental payments are always advertised + VAT.\n  // The donor vehicle VAT state is retained separately for audit only.\n  const rentalVatPolicy = rent2BuyRentalVatPolicy(vatStatus);\n\n  return {\n    retailPrice: retail,\n    mileage: derived.mileage,\n    termMonths: rule.termMonths,\n    upliftPercent: rule.upliftPercent,\n    grossFactor: rule.grossFactor,\n    monthly,\n    upfront,\n    ...structure,\n    sourceVatStatus: rentalVatPolicy.sourceVatStatus,\n    vatStatus: rentalVatPolicy.vatStatus,\n    vatKnown: rentalVatPolicy.vatKnown,\n    monthlyIncVat: currencyNumber(monthly * rentalVatPolicy.vatMultiplier),\n    upfrontIncVat: currencyNumber(upfront * rentalVatPolicy.vatMultiplier),\n    monthlyDisplay: \`£\${monthly} +VAT (£\${currencyNumber(monthly * rentalVatPolicy.vatMultiplier)} INC VAT)\`,\n    upfrontDisplay: \`£\${upfront} +VAT (£\${currencyNumber(upfront * rentalVatPolicy.vatMultiplier)} INC VAT)\`,\n    listingMonthlyDisplay: \`£\${monthly} PM\`,\n    listingInitialDisplay: \`INITIAL RENTAL £\${upfront} +VAT\`,\n  };`;

    source = replaceOrThrow(source, legacyBlock, replacement, "Rent2Buy VAT pricing block");
  }

  return source;
}
