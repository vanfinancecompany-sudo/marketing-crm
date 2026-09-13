import { normalizeFinanceRegistration } from "./vanscoWixPrice.js";

export function registrationTitleVariants(value) {
  const registration = normalizeFinanceRegistration(value);
  if (!registration) return [];
  const variants = [registration];
  for (let index = 1; index < registration.length; index += 1) {
    variants.push(`${registration.slice(0, index)} ${registration.slice(index)}`);
  }
  return Array.from(new Set(variants));
}
