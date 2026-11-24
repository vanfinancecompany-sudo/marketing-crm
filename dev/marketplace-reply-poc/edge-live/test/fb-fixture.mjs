// Test-only stand-in for Facebook's server side. Mounted by service.mjs only
// when R2B_FIXTURE=1. Pushes changes to open pages over SSE, as Facebook's
// realtime channel does, so a background tab updates without polling.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export function createFixture(file) {
  let fb = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { threads: {}, seq: 1, sends: 0 };
  const clients = new Set();
  const push = (data) => { for (const res of clients) res.write("data: " + data + "\n\n"); };
  const commit = () => {
    writeFileSync(file, JSON.stringify(fb));
    push("changed");
  };
  const thread = (id, name = "Alex", listing = "2015 Ford Transit Rent2Buy") =>
    (fb.threads[id] ??= { name, listing, listingId: "1119983400609221", unread: false, messages: [] });

  const routes = {
    "GET /__fb/api/state": () => fb,
    "POST /__fb/api/customer": ({ threadId, text, name, listing, notice }) => {
      const isNew = !fb.threads[String(threadId)];
      const t = thread(String(threadId), name, listing);
      // Facebook opens every new Marketplace chat with this notice (as a message).
      if (isNew && notice) t.messages.push({ id: "mid.$notice" + fb.seq++, out: false, text: t.name + " started this chat. View buyer profile" });
      t.messages.push({ id: "mid.$in" + fb.seq++, out: false, text: String(text) });
      t.updated = fb.seq;
      t.unread = true;
      commit();
      return { ok: true };
    },
    // Simulate Facebook reloading the page or closing the chat panel.
    "POST /__fb/api/command": ({ cmd }) => { if (["reload", "closepanel", "popupnext", "dockednext"].includes(cmd)) push(cmd); return { ok: true }; },
    "POST /__fb/api/read": ({ threadId }) => { if (fb.threads[threadId]) fb.threads[threadId].unread = false; commit(); return { ok: true }; },
    "POST /__fb/api/send": ({ threadId, text }) => {
      fb.threads[threadId].messages.push({ id: "mid.$out" + fb.seq++, out: true, text: String(text) });
      fb.threads[threadId].updated = fb.seq;
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
