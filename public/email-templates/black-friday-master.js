// Black Friday 2026 master template for the Email Template Designer.
// Kept in its own file so the wording, default blocks and stock-count rule can be reviewed and
// tested without touching the designer itself. Nothing here sends or saves anything.
(function (root) {
  const WEBSITE = "https://www.vanfinancecompany.co.uk";
  const ICON_OPTIONS = [
    { value: "warranty", label: "Warranty shield" },
    { value: "deposit", label: "Pound sign" },
    { value: "delivery", label: "Delivery" },
    { value: "stock", label: "Stock" },
    { value: "none", label: "No icon" },
  ];

  const blockLabels = { campaign_hero: "Campaign Hero", usp_panel: "Selling Points", campaign_cta: "Closing Call To Action" };

  const blockDefaults = {
    campaign_hero: {
      theme: "black_friday",
      eyebrow: "BLACK FRIDAY",
      headline: "FREE 2-YEAR AUTOGUARD WARRANTY",
      subheadline: "WITH EVERY VAN",
      supporting_text: "Drive away this Black Friday with two years of AutoGuard warranty cover included with every van.",
      button_text: "SHOP BLACK FRIDAY VANS",
      button_url: `${WEBSITE}/vans`,
      show_image: "yes",
      image_url: "",
      image_alt: "Van Finance Company van",
      show_partner_logo: "yes",
      partner_logo_url: "",
      partner_logo_alt: "MBi AutoGuard Warranties",
    },
    usp_panel: {
      heading: "",
      item_1_icon: "warranty", item_1_title: "FREE 2-YEAR AUTOGUARD WARRANTY", item_1_text: "With every van",
      item_2_icon: "deposit", item_2_title: "VAN FINANCE FROM JUST £99 DEPOSIT", item_2_text: "Subject to status",
      item_3_icon: "delivery", item_3_title: "FREE UK DOORSTEP DELIVERY", item_3_text: "Delivered direct to you",
      item_4_icon: "stock", item_4_title: "HUGE CHOICE OF VANS IN STOCK", item_4_text: "Browse the full range online",
    },
    campaign_cta: {
      heading: "EXPLORE THE FULL RANGE",
      body: "Every van comes with a free 2-year AutoGuard warranty this Black Friday.",
      button_text: "VIEW ALL VANS",
      button_url: `${WEBSITE}/vans`,
      secondary_text: "Prefer to talk? Call 0330 133 6376",
    },
  };

  // The stock figure is never hardcoded. The designer reads the live number of finance vans and
  // only uses "200+" wording when the stock list really supports it.
  function stockCopy(count) {
    const total = Number(count);
    if (!Number.isFinite(total) || total < 20) return { title: "HUGE CHOICE OF VANS IN STOCK", button: "VIEW ALL VANS" };
    if (total >= 200) return { title: `${Math.floor(total / 100) * 100}+ VANS IN STOCK`, button: `SHOP ALL ${Math.floor(total / 100) * 100}+ VANS` };
    return { title: `OVER ${Math.floor((total - 1) / 10) * 10} VANS IN STOCK`, button: "VIEW ALL VANS" };
  }

  const master = {
    key: "black_friday_2026",
    label: "Black Friday 2026",
    summary: "Premium dark campaign: free 2-year AutoGuard warranty, four selling points and ten featured vans.",
    category: "finance_offer",
    layout: "finance_offer",
    colour: "#d81e36",
    secondary: "#0b0b0d",
    name: "VFC Black Friday 2026",
    subject: "BLACK FRIDAY | FREE 2-Year AutoGuard Warranty With Every Van",
    preview: "Van finance from £99 deposit. Free UK delivery. Explore our Black Friday van collection.",
    hero: "Free 2-year AutoGuard warranty with every van",
    footer: "Van Finance Company is a trading name of Vansco Ltd. Vansco Ltd is authorised and regulated by the Financial Conduct Authority. FCA Register number 673442. Finance is subject to status. We are a credit broker, not a lender, and offer credit from a selected panel of lenders. Vansco Ltd may receive a fee from lenders for an introduction. Registered in England and Wales, company number 07811287. VAT number 125 650 331.",
    blocks: [
      { type: "campaign_hero", settings: {} },
      { type: "usp_panel", settings: {} },
      { type: "vehicle_grid", settings: { heading: "THE BLACK FRIDAY COLLECTION", intro_text: "Hand-picked vans, each with a free 2-year AutoGuard warranty.", number_of_vehicles: 10, layout: "two_column", product_mode: "finance", source_mode: "selected", top_padding: 0 } },
      { type: "campaign_cta", settings: {} },
      { type: "text", settings: { heading: "", body: "Finance subject to status and lender terms. Deposit required depends on the vehicle and your circumstances. Warranty subject to AutoGuard terms and conditions. Vehicles subject to availability.", alignment: "centre", padding_size: "small", background_colour: "#0b0b0d", text_colour: "#8b8b93" } },
    ],
  };

  root.VFC_BLACK_FRIDAY_2026 = { master, blockLabels, blockDefaults, iconOptions: ICON_OPTIONS, stockCopy };
})(typeof window !== "undefined" ? window : globalThis);
