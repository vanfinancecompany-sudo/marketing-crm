import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { vanscoSentPostsByChannel } from "../api/_vansco-buffer-runtime.js";

const branches = {
  vansco333: { channelId: "gb-333" },
  southamptonAirport: { channelId: "gb-airport" },
  newForest: { channelId: "gb-forest" },
};
const posts = (channelId, prefix, number) => ({
  edges: Array.from({ length: number }, (_, i) => ({
    node: { id: prefix + i, channelId, status: "sent", sentAt: "2026-10-12T19:00:00Z" },
  })),
  pageInfo: { hasNextPage: false },
});

test("every Vansco channel counts its own sent posts even when combined posts exceed the Buffer 100 limit", () => {
  const payload = { data: {
    facebookSent: posts("fb", "facebook-", 70),
    vansco333Sent: posts("gb-333", "333-", 10),
    airportSent: posts("gb-airport", "airport-", 6),
    newForestSent: posts("gb-forest", "forest-", 10),
  } };
  const got = vanscoSentPostsByChannel(payload, "fb", branches);
  assert.equal(got.facebook.length, 70);
  assert.equal(got.googleBusiness.vansco333.length, 10);
  assert.equal(got.googleBusiness.southamptonAirport.length, 6);
  assert.equal(got.googleBusiness.newForest.length, 10);
  assert.equal(got.hasNextPage, false);
});

test("unpublished and wrong-channel posts cannot inflate published totals", () => {
  const payload = { data: {
    facebookSent: { edges: [
      { node: { id: "a", channelId: "fb", status: "scheduled" } },
      { node: { id: "b", channelId: "other", status: "sent" } },
      { node: { id: "c", channelId: "fb", status: "sent" } },
    ] },
    vansco333Sent: posts("gb-333", "333-", 2),
  } };
  const got = vanscoSentPostsByChannel(payload, "fb", branches);
  assert.deepEqual(got.facebook.map(v => v.id), ["c"]);
  assert.equal(got.googleBusiness.vansco333.length, 2);
  assert.deepEqual(got.googleBusiness.southamptonAirport, []);
});

test("GraphQL monitoring asks for published data per channel rather than a shared page", async () => {
  const source = await readFile(new URL("../api/_vansco-buffer-runtime.js", import.meta.url), "utf8");
  for (const name of ["facebookSent", "vansco333Sent", "airportSent", "newForestSent"]) {
    assert.match(source, new RegExp(name + ": posts\\("));
  }
  assert.match(source, /filter: \{\s*status: \[sent\]/);
  assert.match(source, /vanscoSentPostsByChannel\(payload, facebookConfig.channelId, googleConfig.branches\)/);
});
