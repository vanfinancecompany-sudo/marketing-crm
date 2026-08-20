function clean(value) {
  return String(value ?? "").replace(/Â£/g, "£").replace(/â€“/g, "–").trim();
}

function registrationOf(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function buildAutomatedFacebookCaption(vehicle, productKey) {
  const registration = registrationOf(vehicle?.registration || vehicle?.reg || vehicle?.title);
  const title = clean(vehicle?.vanDescription || vehicle?.description || vehicle?.name || vehicle?.title || registration);

  if (productKey === "rent2buy") {
    return `${title}\n\nREGISTRATION: ${registration}\n\nRENT IT! - DRIVE IT! - OWN IT!\nNo credit check. Check if you qualify online.\n\nhttps://www.rent2buyvans.co.uk/van-pages/${registration}`.trim();
  }

  return `${title}\n\nREGISTRATION: ${registration}\n\nVan finance available from £99 deposit. Free UK delivery. Apply online today.\n\nhttps://www.vanfinancecompany.co.uk/van-finance/${registration}`.trim();
}

export function buildAutomatedReelCaption({ productKey, registration, title }) {
  const reg = registrationOf(registration);
  const cleanTitle = clean(title || "Vehicle reel");
  if (productKey === "rent2buy") {
    return `${cleanTitle}\n\nREGISTRATION: ${reg}\n\nRENT IT! - DRIVE IT! - OWN IT!\nCheck if you qualify online.\n\nhttps://www.rent2buyvans.co.uk/van-pages/${reg}`;
  }
  return `${cleanTitle}\n\nREGISTRATION: ${reg}\n\nVan finance available. Free UK delivery. Apply online today.\n\nhttps://www.vanfinancecompany.co.uk/van-finance/${reg}`;
}

const FRAME_PACKS = {
  vanFinance: [
    [
      { headline: "FROM £99 DEPOSIT", support: "VAN FINANCE COMPANY" }, {}, {},
      { headline: "FREE UK DELIVERY", support: "NATIONWIDE DELIVERY" },
      { headline: "APPROVED IN 60 MINUTES", support: "FAST ONLINE APPLICATION" },
      { headline: "FINANCE THE VAT", support: "KEEP YOUR CASH FLOW MOVING" },
      { headline: "GOOD OR BAD CREDIT", support: "ALL CREDIT PROFILES CONSIDERED" },
      { headline: "SELF-EMPLOYED WELCOME", support: "FLEXIBLE VAN FINANCE" },
      { headline: "200+ VANS AVAILABLE", support: "READY TO GO" },
      { headline: "APPLY ONLINE TODAY", support: "VANFINANCECOMPANY.CO.UK", button: "APPLY NOW" },
    ],
    [
      { headline: "FAST VAN FINANCE", support: "APPROVED IN 60 MINUTES" }, {}, {},
      { headline: "GOOD OR BAD CREDIT", support: "ALL CREDIT PROFILES CONSIDERED" },
      { headline: "FROM £99 DEPOSIT", support: "LOW DEPOSIT OPTIONS" },
      { headline: "FREE UK DELIVERY", support: "NATIONWIDE DELIVERY" },
      { headline: "SELF-EMPLOYED WELCOME", support: "FLEXIBLE FINANCE OPTIONS" },
      { headline: "FINANCE THE VAT", support: "KEEP YOUR CASH FLOW MOVING" },
      { headline: "200+ VANS AVAILABLE", support: "CHOOSE YOUR NEXT VAN" },
      { headline: "APPLY ONLINE TODAY", support: "VANFINANCECOMPANY.CO.UK", button: "APPLY NOW" },
    ],
    [
      { headline: "FINANCE YOUR NEXT WORK VAN", support: "KEEP YOUR CASH FLOW MOVING" }, {}, {},
      { headline: "FINANCE THE VAT", support: "BUSINESS-FRIENDLY VAN FINANCE" },
      { headline: "SELF-EMPLOYED WELCOME", support: "FLEXIBLE FINANCE OPTIONS" },
      { headline: "FROM £99 DEPOSIT", support: "LOW DEPOSIT OPTIONS" },
      { headline: "APPROVED IN 60 MINUTES", support: "FAST ONLINE APPLICATION" },
      { headline: "FREE UK DELIVERY", support: "NATIONWIDE DELIVERY" },
      { headline: "200+ VANS AVAILABLE", support: "READY TO GO" },
      { headline: "APPLY ONLINE TODAY", support: "VANFINANCECOMPANY.CO.UK", button: "APPLY NOW" },
    ],
    [
      { headline: "YOUR NEXT VAN IS HERE", support: "200+ VANS AVAILABLE" }, {}, {},
      { headline: "FREE UK DELIVERY", support: "NATIONWIDE DELIVERY" },
      { headline: "FROM £99 DEPOSIT", support: "LOW DEPOSIT OPTIONS" },
      { headline: "APPROVED IN 60 MINUTES", support: "FAST ONLINE APPLICATION" },
      { headline: "GOOD OR BAD CREDIT", support: "ALL CREDIT PROFILES CONSIDERED" },
      { headline: "FINANCE THE VAT", support: "KEEP YOUR CASH FLOW MOVING" },
      { headline: "VANS READY TO GO", support: "CHOOSE YOUR NEXT VAN TODAY" },
      { headline: "APPLY ONLINE TODAY", support: "VANFINANCECOMPANY.CO.UK", button: "APPLY NOW" },
    ],
  ],
  rent2buy: [
    [
      { headline: "NO CREDIT CHECK VANS", support: "RENT IT - DRIVE IT - OWN IT" }, {}, {},
      { headline: "APPLY IN 60 SECONDS", support: "FAST ONLINE CHECK" },
      { headline: "FINAL PAYMENT IT'S YOURS", support: "CLEAR ROUTE TO OWNERSHIP" },
      { headline: "VANS READY TO GO", support: "PICKUPS, LUTONS AND PANEL VANS" },
      { headline: "NO CREDIT CHECK", support: "CHECK IF YOU QUALIFY" },
      { headline: "DRIVE IT, THEN OWN IT", support: "FLEXIBLE RENT2BUY" },
      { headline: "GET BACK TO WORK FAST", support: "CHOOSE YOUR VAN TODAY" },
      { headline: "CHECK IF YOU QUALIFY", support: "RENT2BUYVANS.CO.UK", button: "APPLY NOW" },
    ],
    [
      { headline: "DRIVE IT, THEN OWN IT", support: "RENT2BUY VANS" }, {}, {},
      { headline: "FINAL PAYMENT IT'S YOURS", support: "CLEAR ROUTE TO OWNERSHIP" },
      { headline: "NO CREDIT CHECK", support: "SIMPLE QUALIFYING CHECK" },
      { headline: "APPLY IN 60 SECONDS", support: "FAST ONLINE APPLICATION" },
      { headline: "FLEXIBLE RENT2BUY", support: "RENT IT - DRIVE IT - OWN IT" },
      { headline: "VANS READY TO GO", support: "PICK YOUR NEXT VAN" },
      { headline: "CHECK IF YOU QUALIFY", support: "START ONLINE TODAY" },
      { headline: "APPLY TODAY", support: "RENT2BUYVANS.CO.UK", button: "APPLY NOW" },
    ],
    [
      { headline: "GET BACK ON THE ROAD", support: "APPLY IN 60 SECONDS" }, {}, {},
      { headline: "NO CREDIT CHECK", support: "FAST ONLINE CHECK" },
      { headline: "CHECK IF YOU QUALIFY", support: "SIMPLE ONLINE APPLICATION" },
      { headline: "VANS READY TO GO", support: "CHOOSE YOUR VEHICLE TODAY" },
      { headline: "RENT IT - DRIVE IT - OWN IT", support: "FLEXIBLE RENT2BUY" },
      { headline: "FINAL PAYMENT IT'S YOURS", support: "WORK TOWARDS OWNERSHIP" },
      { headline: "FAST ONLINE APPLICATION", support: "GET STARTED TODAY" },
      { headline: "CHECK IF YOU QUALIFY", support: "RENT2BUYVANS.CO.UK", button: "APPLY NOW" },
    ],
    [
      { headline: "YOUR NEXT VAN IS READY", support: "FLEXIBLE RENT2BUY OPTIONS" }, {}, {},
      { headline: "NO CREDIT CHECK VANS", support: "SIMPLE QUALIFYING CHECK" },
      { headline: "VANS READY TO GO", support: "PANEL VANS, LUTONS AND PICKUPS" },
      { headline: "APPLY IN 60 SECONDS", support: "FAST ONLINE APPLICATION" },
      { headline: "DRIVE IT, THEN OWN IT", support: "RENT IT - DRIVE IT - OWN IT" },
      { headline: "FINAL PAYMENT IT'S YOURS", support: "CLEAR ROUTE TO OWNERSHIP" },
      { headline: "CHECK IF YOU QUALIFY", support: "START ONLINE TODAY" },
      { headline: "APPLY TODAY", support: "RENT2BUYVANS.CO.UK", button: "APPLY NOW" },
    ],
  ],
};

export function automatedReelFrameSpecs(productKey, index = 0) {
  const packs = FRAME_PACKS[productKey] || FRAME_PACKS.vanFinance;
  const selected = packs[Math.abs(Number(index) || 0) % packs.length];
  return Array.from({ length: 10 }, (_, frameIndex) => ({ ...(selected[frameIndex] || {}) }));
}
