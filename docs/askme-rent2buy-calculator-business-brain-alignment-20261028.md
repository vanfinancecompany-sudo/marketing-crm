# Rent2Buy Business Brain calculator alignment, 28 October 2026

## Scope
Content-only revision of current approved Business Brain `products` and `faqs` entries. This does not change the DealerKit retail source, Felix pricing engine, website slider, vehicle eligibility, fixed specials, CRM workflow, or quote signing.

## Ground truth checked
- `marketing-crm/lib/rent2BuyFlexiblePricing.mjs`: 1,000/2,000/3,000/4,000 miles/month; allowed months 12/24/36/48; initial rental ladder, vehicle age/mileage caps, ex VAT and inc VAT, price rounding.
- `marketing-crm/lib/rent2BuyQuoteChoices.mjs` and `lib/rent2BuyQuoteIssue.mjs`: return only current eligible choices; server signs quotes against current DealerKit retail/year/mileage; protected fixed specials excluded.
- Deployed Rent2Buy and VFC `components/Rent2BuyRentalDrawerPreview.jsx`: initial UI selection is 1,000 miles; controls for term, monthly miles and upfront; updated quote on change.
- Deployed Rent2Buy calculator's 'How excess mileage works': currently displays 20p/mile billed monthly and an effect on agreement term as described on-screen. Actual signed agreement controls.
- The original approved `products` entry 23: `The standard mileage allowance is normally 3,000 miles per month or 36,000 miles per year. Excess-mileage charges may apply under the agreement.`
- Existing FAQ entries were preserved; five new questions are appended.

## Customer-facing principles
1. Explain how to build the **new** quote on the actual vehicle page rather than directing visitors to staff just to operate the slider.
2. The calculator initially shows 1,000 miles/month, not a 3,000-miles 'default'.
3. Only present mileage and term options that the vehicle's calculator allows. No fixed universal initial rental; minimum is vehicle-specific.
4. Prices are server-verified and depend on current DealerKit vehicle retail price, eligibility and selected quote inputs. Never hand-calculate or invent amounts, and never override fixed special deals.
5. Explain both monthly **+VAT** and **inc VAT** figures, and distinguish **new unsigned quotes** from existing signed agreements.
6. The currently published excess mileage explanation is for information; confirm the signed agreement before promising contractual terms.
7. Rent2Buy is separate from Finance; no cross-product assumptions.

## Rollback plan
Restore the original `products` entry 23 text shown above, and remove exactly the five newly labelled calculator FAQs listed in the SQL content change. Never roll back other entries or unrelated later editorial edits.
