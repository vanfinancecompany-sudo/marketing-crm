// Canonical owner-supplied Van Finance Company operational evidence.
// Captured 2026-08-16. This is deliberately code-backed so Jasmine can read
// the facts even when a persisted Business Intelligence section is incomplete.

export const VFC_PRIMARY_SOURCE_KNOWLEDGE_VERSION = "2026-08-16";

const finance = (label, value) => ({
  label: `Van Finance Company · ${label}`,
  value,
});

export const VFC_PRIMARY_SOURCE_KNOWLEDGE = Object.freeze({
  sales_knowledge: Object.freeze([
    finance("Retail preparation before advertising", "When a used van first enters stock it is prepared for retail presentation before advertising. This includes valet, polish, paint correction where required and obvious faults being dealt with. This retail-ready stage is separate from the deeper point-of-sale workshop preparation after the vehicle is sold."),
    finance("101-point PDI and point-of-sale preparation", "The main mechanical preparation happens after sale. A sold vehicle enters the workshop queue for a 101-point inspection / PDI covering mechanical condition, electrical checks, bodywork, tyres, brakes, warning lights, relevant belts and previous MOT failures or advisories. A sold vehicle receives a new 12-month MOT and servicing at point of sale."),
    finance("Servicing policy", "Every sold vehicle receives at least an oil-and-filter service. A full service is carried out when the vehicle is due one, when there is no service history, or when there is no sufficiently recent service history to rely on."),
    finance("Ford wet-belt policy", "For relevant Ford Transit, Transit Custom, Transit Connect and Transit Courier vehicles, VFC generally replaces the wet belt at point of sale regardless of mileage or older service history. The normal exception is documented evidence that the wet belt was replaced within the previous 1,000 miles or previous 6 months. A belt replacement can sometimes add roughly one or two days to preparation; this is not an automatic delay on every vehicle."),
    finance("Cambelt and timing-belt policy", "Cambelts and timing belts are replaced in line with manufacturer recommendations. If a vehicle has no service history, VFC automatically replaces the cambelt or timing belt where applicable rather than assuming the work has already been completed."),
    finance("Tyres, brakes and MOT-history review", "Tyres and brakes are checked during the 101-point PDI. VFC does not aim to hand over a vehicle with tyres sitting close to the legal minimum; tyres approaching the limit are replaced so the vehicle has a good usable tread depth. The workshop also reviews previous MOT failures and advisories so relevant issues can be checked before handover."),
    finance("Standard in-house warranty", "Every sold vehicle includes a standard in-house warranty for 3 months or 3,000 miles, subject to the applicable warranty terms. Customers may have the option to purchase an upgraded warranty. The standard warranty is handled directly by VFC rather than requiring the customer to deal with a third-party warranty administrator."),
    finance("After-sales and local-garage warranty support", "Customers with a warranty issue contact VFC directly by email or WhatsApp and should provide photos or videos where possible. The after-sales team handles the case. If workshop attention is required, a garage local to the customer is normally preferred, ideally one the customer already knows. VFC deals directly with the garage and pays authorised warranty repair costs directly. If a vehicle genuinely needs to return, recovery can be arranged. Where required and available, a courtesy vehicle can be supplied during repairs."),
    finance("AA breakdown cover", "Sold vehicles are signed up for 12 months of basic AA breakdown cover from the delivery or handover date. VFC recommends customers consider suitable paid or premium breakdown cover as well because the complimentary basic policy is not the same as a comprehensive paid policy."),
    finance("Remote-buying journey", "Typical Finance journey: approval or available credit limit; choose a van; receive a quote; finance documents are sent digitally; customer signs online; customer pays a £100 reservation deposit; once received the vehicle is taken off sale; the van enters the workshop queue for MOT, servicing and the 101-point PDI; it is valeted; VFC arranges free delivery to the customer's home or work address. Any remaining customer deposit balance is due the day before delivery and can be paid by card over the phone or bank transfer using instructions in the delivery-confirmation email."),
    finance("Remote-buying turnaround", "Typical turnaround is 7–10 working days and is often around a week, subject to workshop requirements, parts, MOT, belt replacement and other preparation needs. This is a typical timeframe, not a guaranteed delivery deadline."),
    finance("Final delivery-driver inspection", "After workshop sign-off, the delivery driver carries out a second walk-around inspection on the day before or day of delivery. The check includes bodywork and visible damage, dashboard warning lights, mileage, keys, paperwork and general readiness for delivery. This is a secondary check in addition to the workshop 101-point inspection."),
    finance("If a remote customer reports a problem on delivery", "The customer should contact the after-sales team and send as much detail as possible, ideally photos or video. VFC looks to rectify the issue promptly. A local garage is normally the quickest and most practical repair route. If the vehicle genuinely needs to return, VFC can arrange recovery and, where required and available, a courtesy vehicle during repairs."),
    finance("Used electric-van battery guidance", "Older or early-generation used electric vans should not be assumed to retain the same usable range quoted when new. VFC recommends asking the dealer for a battery-health check when considering a used electric van. Do not invent a universal degradation percentage or battery-life figure."),
    finance("Commercial-vehicle buyer behaviour", "VFC does not claim a universal psychology for why customers choose one van over another. From experience, many commercial-vehicle buyers already know the broad vehicle type their work requires, such as small, medium, long-wheelbase, Luton, tipper, dropside or pickup. Suitability for the business is central; monthly payment can influence the final decision, but VFC does not claim it is always the primary reason."),
    finance("Remote-buying ethos", "VFC aims to make buying a van remotely simple and hassle-free from start to finish: choose a van, pay the reservation deposit, sign finance documentation digitally, VFC prepares the van, then free delivery to the customer's door. Local-garage warranty support and direct after-sales help are intended to reduce friction for remote customers. The owner reports repeat business and customers regularly commenting that the process is easy; treat this as qualitative experience, not a quantified satisfaction statistic."),
  ]),
  faqs: Object.freeze([
    finance("Are your used vans inspected before delivery?", "Yes. Sold vans go through a 101-point PDI / workshop inspection, a new 12-month MOT and servicing at point of sale. After workshop sign-off, the delivery driver performs a second walk-around readiness check before handover or delivery."),
    finance("What happens if my van develops a fault under warranty?", "Contact VFC directly by email or WhatsApp and include photos or video where possible. The after-sales team will handle the issue. If a garage is needed, a local garage is normally used and VFC deals directly with that garage for authorised warranty repairs."),
    finance("Do I need to bring a warranty repair back to you?", "Normally no. A garage local to the customer is usually the preferred and quicker route. If the vehicle genuinely needs to return to VFC, recovery can be arranged."),
    finance("How long does remote van delivery usually take?", "Typical turnaround is 7–10 working days and often around a week, subject to preparation, MOT, parts and any required belt work. It is a typical timeframe rather than a guaranteed delivery date."),
    finance("What deposit reserves a Finance van?", "A £100 reservation deposit takes the vehicle off sale. If there is a remaining customer deposit balance, that balance is due the day before delivery and can be paid by card over the phone or bank transfer."),
  ]),
  compliance: Object.freeze([
    finance("Distance-sale and finance cancellation rights are separate", "A qualifying consumer distance sale can carry statutory cancellation rights that differ from an on-premises purchase. A regulated distance credit agreement can also have a 14-day cancellation or withdrawal right under applicable FCA rules. These are separate legal rights. Never state that cancelling the finance agreement automatically cancels or rejects the vehicle sale."),
    finance("Do not promise blanket remote-purchase refunds", "Do not promise a blanket full refund in every remote-purchase scenario without checking the applicable contract, vehicle use or condition and legal basis. For customer-specific legal questions, explain the general position and refer the customer to their agreement or the relevant team rather than improvising legal advice."),
    finance("Do not turn typical timings into guarantees", "Where VFC evidence says typically, normally, generally, where required, where available or similar, preserve that qualification. In particular, 7–10 working days is a typical preparation and delivery timeframe, not a guaranteed deadline."),
    finance("Keep Finance and Rent2Buy separate", "These VFC operational facts describe the Van Finance Company Finance / used-van sales process. Do not apply them to Rent2Buy unless a separate approved Rent2Buy source explicitly confirms the same rule."),
  ]),
});

function entryKey(entry) {
  return `${String(entry?.label || "").trim().toLowerCase()}\u0000${String(entry?.value || "").trim().toLowerCase()}`;
}

export function withVfcPrimarySourceKnowledge(sectionKey, entries = []) {
  const combined = [...(Array.isArray(entries) ? entries : []), ...(VFC_PRIMARY_SOURCE_KNOWLEDGE[sectionKey] || [])];
  const seen = new Set();
  return combined.filter((entry) => {
    const key = entryKey(entry);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
