import test from "node:test";
import assert from "node:assert/strict";
import { createStockImageLookup, createStockImageHandler, normalizeStockRegistration } from "../api/_vehicle-image-suite-stock.js";

const vehicle = (registration = "CP16AZW", supplierStockId = "id-1") => ({
  registration, supplierStockId, status: "available",
  images: [{ url: "https://cdn.example/three.jpg", order: 2 }, { url: "https://cdn.example/one.jpg", order: 0 },
    { url: "https://cdn.example/two.jpg", order: 1 }, { url: "https://cdn.example/one.jpg", order: 3 }],
  primaryImage: "https://cdn.example/one.jpg", internalCustomer: "must not escape",
});
const snapshot = vehicles => ({ complete: true, vehicles, diagnostics: {} });
function build({ stock = snapshot([vehicle()]), detail = vehicle(), clock = () => 0 } = {}) {
  const counts = { stock: 0, detail: 0 };
  const lookup = createStockImageLookup({
    fetchSnapshot: async options => { counts.stock++; assert.equal(options.allowPartial, true); return stock; },
    fetchDetail: async (id, options) => { counts.detail++; assert.equal(options.specifications, false); return detail; },
    now: clock,
  });
  return { lookup, counts };
}
test("normalise standard and private registrations, reject invalid inputs", () => {
  assert.equal(normalizeStockRegistration(" cp16 azw "), "CP16AZW");
  assert.equal(normalizeStockRegistration("A1"), "A1");
  for (const value of ["", "vehicle", "../CP16AZW", ["CP16AZW"], "CP16AZW<script>"]) assert.throws(() => normalizeStockRegistration(value));
});
test("exact match returns only identity and ordered, deduplicated HTTPS images", async () => {
  const { lookup } = build();
  const data = await lookup("CP16 AZW");
  assert.deepEqual(Object.keys(data), ["ok", "registration", "supplierStockId", "primaryImage", "images"]);
  assert.deepEqual(data.images, [0, 1, 2].map((order) => ({ url: "https://cdn.example/" + ["one", "two", "three"][order] + ".jpg", order })));
  assert.equal(data.primaryImage, data.images[0].url);
  assert.equal(JSON.stringify(data).includes("internalCustomer"), false);
});
test("different registration, missing or non-public stock never loads another vehicle", async () => {
  for (const vehicles of [[], [vehicle("CP16AZX")], [{ ...vehicle(), status: "sold" }]]) {
    const { lookup, counts } = build({ stock: snapshot(vehicles) });
    await assert.rejects(lookup("CP16AZW"), error => error.status === 404);
    assert.equal(counts.detail, 0);
  }
});
test("duplicate registrations reject both rows and adapter diagnostics, without guessing", async () => {
  for (const stock of [snapshot([vehicle(), vehicle("CP16AZW", "id-2")]),
    { ...snapshot([vehicle()]), complete: false, diagnostics: { duplicateRegistrations: [{ registration: "CP16AZW", supplierStockIds: ["id-1", "id-2"] }] } }]) {
    const { lookup, counts } = build({ stock });
    await assert.rejects(lookup("CP16AZW"), error => error.status === 409);
    assert.equal(counts.detail, 0);
  }
});
test("detail identity/availability mismatch and missing gallery are safe fallbacks", async () => {
  for (const detail of [vehicle("CP16AZX"), vehicle("CP16AZW", "different-id"), { ...vehicle(), status: "sold" }]) {
    await assert.rejects(build({ detail }).lookup("CP16AZW"), error => error.status === 409);
  }
  await assert.rejects(build({ detail: { ...vehicle(), images: [] } }).lookup("CP16AZW"), error => error.status === 404);
});
test("one snapshot serves many registrations and concurrent calls share stock/gallery work", async () => {
  let time = 0, reads = 0, details = 0;
  const vehicles = [vehicle(), vehicle("HJ22LSK", "id-2")];
  const lookup = createStockImageLookup({
    fetchSnapshot: async () => { reads++; return snapshot(vehicles); },
    fetchDetail: async id => { details++; return vehicles.find(v => v.supplierStockId === id); },
    now: () => time,
  });
  await Promise.all([lookup("CP16AZW"), lookup("CP16AZW"), lookup("HJ22LSK")]);
  assert.equal(reads, 1); assert.equal(details, 2);
  await lookup("CP16 AZW"); assert.equal(reads, 1); assert.equal(details, 2);
  time = 300001; await lookup("CP16AZW"); assert.equal(reads, 2); assert.equal(details, 3);
});
test("unstable snapshots fail closed and failed snapshot reads back off", async () => {
  await assert.rejects(build({ stock: { ...snapshot([vehicle()]), complete: false } }).lookup("CP16AZW"), error => error.status === 503);
  let reads = 0;
  const lookup = createStockImageLookup({ fetchSnapshot: async () => { reads++; throw new Error("secret=do-not-return"); }, now: () => 0 });
  await assert.rejects(lookup("CP16AZW"), /temporarily unavailable/);
  await assert.rejects(lookup("HJ22LSK"), /temporarily unavailable/);
  assert.equal(reads, 1);
});
test("handler is GET-only and errors do not expose internal exception text", async () => {
  let calls = 0;
  const handler = createStockImageHandler(async () => { calls++; throw new Error("DealerKit secret"); });
  const res = { headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(value) { this.code = value; return this; }, json(value) { this.body = value; return this; } };
  await handler({ method: "POST" }, res);
  assert.equal(res.code, 405); assert.equal(calls, 0); assert.equal(res.headers.Allow, "GET");
  await handler({ method: "GET", query: { registration: "CP16AZW" } }, res);
  assert.equal(res.code, 503); assert.equal(JSON.stringify(res.body).includes("secret"), false);
});
