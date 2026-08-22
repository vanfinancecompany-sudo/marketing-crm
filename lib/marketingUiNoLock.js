const API_KEY_HEADER = "x-marketing-customer-database-key";

export function withMarketingUiNoLock(handler, label = "Marketing CRM") {
  return async function marketingUiNoLockHandler(request, response) {
    const serverKey = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;

    if (!serverKey) {
      response.status(500).json({
        ok: false,
        message: `${label} server access is not configured.`,
      });
      return;
    }

    request.headers[API_KEY_HEADER] = serverKey;
    return handler(request, response);
  };
}
