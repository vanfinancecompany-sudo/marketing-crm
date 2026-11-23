// Test-only stand-in for Facebook's server side. Mounted by service.mjs only
// when R2B_FIXTURE=1. Pushes changes to open pages over SSE, as Facebook's
// realtime channel does, so a background tab updates without polling.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export function createFixture(file) {
  let fb = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { threads: {}, seq: 1, sends: 0 };
  const clients = new Set();
  const commit = () => {
    writeFileSync(file, JSON.stringify(fb));
    for (const res of clients) res.write("data: changed\n\n");
  };
  const thread = (id, name = "Alex", listing = "2015 Ford Transit Rent2Buy") =>
    (fb.threads[id] ??= { name, listing, listingId: "1119983400609221", unread: false, messages: [] });

  const routes = {
    "GET /__fb/api/state": () => fb,
    "POST /__fb/api/customer": ({ threadId, text, name, listing }) => {
      const t = thread(String(threadId), name, listing);
      t.messages.push({ id: "mid.$in" + fb.seq++, out: false, text: String(text) });
      t.unread = true;
      commit();
      return { ok: true };
    },
    "POST /__fb/api/read": ({ threadId }) => { if (fb.threads[threadId]) fb.threads[threadId].unread = false; commit(); return { ok: true }; },
    "POST /__fb/api/send": ({ threadId, text }) => {
      fb.threads[threadId].messages.push({ id: "mid.$out" + fb.seq++, out: true, text: String(text) });
      fb.sends++;
      commit();
      return { ok: true };
    },
  };

  return function handle(request, response, url, body) {
    if (request.method === "GET" && url.pathname === "/__fb/api/events") {
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
      response.write("data: hello\n\n");
      clients.add(response);
      request.on("close", () => clients.delete(response));
      return true;
    }
    const route = routes[request.method + " " + url.pathname];
    if (!route) return false;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(route(body || {})));
    return true;
  };
}
