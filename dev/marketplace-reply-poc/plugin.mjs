import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReplySimulator, LISTINGS } from "./state.mjs";

const ROOT = "/__marketplace-reply-poc";
const ASSETS = {
  "/": ["control.html", "text/html; charset=utf-8"],
  "/inbox": ["inbox.html", "text/html; charset=utf-8"],
  "/fixture.js": ["fixture.js", "text/javascript; charset=utf-8"],
  "/fixture.css": ["fixture.css", "text/css; charset=utf-8"],
};

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64_000) throw new TypeError("Fixture request too large");
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected a JSON object");
  return value;
}

export function createFixtureMiddleware(stateFile) {
  const simulator = createReplySimulator(stateFile);
  return async (request, response, next) => {
    const target = request.url?.split("?")[0];
    if (target !== ROOT && !target?.startsWith(ROOT + "/")) return next();

    const json = (status, body) => {
      response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify(body));
    };

    const host = request.headers.host || "";
    if (request.socket.remoteAddress !== "127.0.0.1" || !/^127\.0\.0\.1(?::\d+)?$/.test(host)) {
      return json(403, { error: "This fixture only runs on loopback" });
    }
    const route = target.slice(ROOT.length) || "/";
    if (request.method === "GET" && Object.hasOwn(ASSETS, route)) {
      const [file, type] = ASSETS[route];
      response.writeHead(200, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      });
      return response.end(readFileSync(new URL(file, import.meta.url)));
    }
    if (request.method === "GET" && route === "/state") {
      return json(200, { ...simulator.snapshot(), listings: LISTINGS });
    }
    if (request.method !== "POST") return json(404, { error: "Unknown fixture route" });
    if (request.headers.origin !== "http://" + host || !request.headers["content-type"]?.startsWith("application/json")) {
      return json(403, { error: "Use the local fixture page to submit changes" });
    }

    try {
      const input = await readJson(request);
      switch (route) {
        case "/control":
          simulator.setEnabled(input.enabled);
          break;
        case "/scenario":
          simulator.configureInbox(input);
          break;
        case "/incoming":
          return json(201, simulator.addEnquiry(input.scenario));
        case "/observe":
          if (!Array.isArray(input.rows) || input.rows.some((row) => !row || typeof row.threadId !== "string")) {
            throw new TypeError("Invalid observed threads");
          }
          return json(200, { instruction: simulator.observe(input) });
        case "/deliver":
          return simulator.deliver(input)
            ? json(200, { ok: true })
            : json(409, { error: "The simulated send was not accepted" });
        default:
          return json(404, { error: "Unknown fixture route" });
      }
      return json(200, simulator.snapshot());
    } catch (error) {
      if (error instanceof TypeError || error instanceof SyntaxError) return json(400, { error: error.message });
      console.error("[Marketplace reply fixture]", error);
      return json(500, { error: "The local fixture could not persist the change" });
    }
  };
}

export function marketplaceReplyFixture() {
  return {
    name: "marketplace-reply-fixture",
    configureServer(server) {
      const checkout = createHash("sha256").update(server.config.root + ":" + server.config.server.port).digest("hex").slice(0, 12);
      const path = join(tmpdir(), "marketing-crm-marketplace-reply-poc", checkout, "state.json");
      server.middlewares.use(createFixtureMiddleware(path));
    },
  };
}
