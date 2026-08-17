const API_KEY_HEADER = "x-marketing-customer-database-key";

export function withKnowledgeHubNoLock(handler) {
  return async function knowledgeHubNoLockHandler(request, response) {
    const serverKey = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;

    if (!serverKey) {
      response.status(500).json({
        ok: false,
        message: "Knowledge Hub server access is not configured.",
      });
      return;
    }

    request.headers[API_KEY_HEADER] = serverKey;
    return handler(request, response);
  };
}
