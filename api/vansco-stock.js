const SOURCE_URL = "https://www.vansco.co.uk/all-stock/";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ message: "Method not allowed." });
    return;
  }

  try {
    const upstream = await fetch(SOURCE_URL, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-GB,en;q=0.9",
        referer: "https://marketing-crm-six.vercel.app/",
        pragma: "no-cache",
        "cache-control": "no-cache",
      },
    });

    if (!upstream.ok) {
      response.status(upstream.status).json({
        message: `Vansco request failed with status ${upstream.status}.`,
      });
      return;
    }

    const html = await upstream.text();
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      html,
      htmlLength: html.length,
      fetchedAt: new Date().toISOString(),
      sourceUrl: SOURCE_URL,
    });
  } catch (error) {
    response.status(500).json({
      message: error?.message || "Could not fetch Vansco stock source.",
    });
  }
}
