// Finance vehicle adverts only. The hook changes caption emphasis, never stock data,
// URLs, media, prices, marketplace fields, or Rent2Buy creative.
export function isVanFinancePoorCreditImageSlot(slotIndex) {
  const slot = Number(slotIndex);
  return slotIndex !== null && slotIndex !== undefined
    && slotIndex !== "" && Number.isInteger(slot) && slot >= 0 && slot % 2 === 0;
}

export function withVanFinancePoorCreditOpening(caption, slotIndex) {
  const text = String(caption ?? "");
  if (!text.trim() || !isVanFinancePoorCreditImageSlot(slotIndex)) return text;
  if (/^GOOD OR POOR CREDIT\?/i.test(text.trimStart())) return text;

  // Leave the complete vehicle-specific price, registration, specs, benefits and
  // destination URL intact. Only switch the opening and brand-led subheading.
  const body = text.replace(/^VAN FINANCE COMPANY\s*\|[^\n]*/m,
    "VAN FINANCE COMPANY | VAN FINANCE OPTIONS");
  return `GOOD OR POOR CREDIT?\n\n${body}`;
}
