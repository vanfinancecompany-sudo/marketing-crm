// Verified against the live, deployed Rent2Buy quotation components on both websites:
// rent2buy-vans @ 14f6ad660636e12c9657953ff08cb351c647bf13
// vanfinance-co @ 1b58fbb6cc4671dff9243fdfcab375c9dda94e59
// component: components/Rent2BuyRentalDrawerPreview.jsx
// UI guidance only. This is not authority to change a signed rental agreement,
// override the server quotation or invent an excess-mileage charge.
export function verifiedRent2BuyMileageUiGuidance({ message = "", productContext = "" } = {}) {
  if (productContext !== "rent2buy") return "";
  const text = String(message || "").toLowerCase();
  if (!/\b(?:mileage|miles?\s+(?:per|a)\s+month|monthly\s+miles?|excess\s+miles?|miles?\s+allowance)\b/.test(text)) return "";
  return [
    "# Verified Rent2Buy website calculator guidance",
    "This section is current first-party website UI evidence, not a quotation or a variation to a signed contract.",
    "On an eligible Rent2Buy van's detail page, the YOUR RENT2BUY QUOTE calculator has a visible 'Miles per month' slider. New quotes initially show 1,000 miles/month. The available mileage settings are supplied by the server for that van; 3,000 miles/month can be selected when it appears as an option.",
    "Selecting a different mileage allowance automatically requests a new server-verified monthly rental. The customer can review the revised quotation and save the quote when ready. Do not imply that an already signed agreement can be edited with this slider.",
    "Under the mileage slider, the website has a 'How excess mileage works' explanation. Excess charges and their application must be confirmed from that displayed explanation and the individual rental agreement. Do not invent a price per extra mile or promise an exception.",
    "If a question asks both how to change monthly mileage and what happens when exceeding it, answer BOTH parts. Do not send the customer to staff just to operate an available quote slider, and do not describe 3,000 miles as the website's initial selection.",
  ].join("\n");
}
