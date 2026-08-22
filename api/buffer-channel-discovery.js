import { BUFFER_API_URL } from "../lib/bufferPublishing.js";

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }

  const token = String(process.env.BUFFER_API_KEY || "").trim();
  if (!token) {
    response.status(500).json({ ok: false, error: "BUFFER_API_KEY is not configured." });
    return;
  }

  const query = `
    query BufferQueryIntrospection {
      __type(name: "Query") {
        fields {
          name
          args {
            name
            type {
              kind
              name
              ofType {
                kind
                name
                ofType { kind name }
              }
            }
          }
        }
      }
    }
  `;

  const result = await fetch(BUFFER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query }),
  });
  const payload = await result.json().catch(() => ({}));
  response.status(result.ok ? 200 : result.status).json({ ok: result.ok, payload });
}
