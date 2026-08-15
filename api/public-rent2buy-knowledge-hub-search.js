import handler from "./public-knowledge-hub-search.js";

export default async function rent2BuyKnowledgeHubSearchHandler(request, response) {
  const headers = request.headers || (request.headers = {});
  const hadOrigin = Object.prototype.hasOwnProperty.call(headers, "origin");
  const originalOrigin = headers.origin;
  const hadOriginCaps = Object.prototype.hasOwnProperty.call(headers, "Origin");
  const originalOriginCaps = headers.Origin;

  headers.origin = "https://www.rent2buyvans.co.uk";
  delete headers.Origin;

  try {
    return await handler(request, response);
  } finally {
    if (hadOrigin) headers.origin = originalOrigin;
    else delete headers.origin;
    if (hadOriginCaps) headers.Origin = originalOriginCaps;
  }
}
