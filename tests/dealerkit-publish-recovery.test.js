import assert from "node:assert/strict";
import test from "node:test";
import { approveDealerKitRecovery, buildDealerKitRecovery, verifyPendingDealerKitRepairs } from "../api/_dealerkit-publish-recovery.js";
import { ControlledPublishError, controlledWixCreateId, controlledWixRequest, draftAwareControlledWixBody, queryControlledRegistrationItems } from "../api/_dealerkit-controlled-publish-state.js";
import { reconcileRecoverableTargets, setTargetPublishStatus } from "../api/dealerkit-controlled-publish.js";
import { submitDealerKitVehicle } from "../utils/dealerKitSubmitVehicle.js";
import { preserveVehicleRoutes, retryTemporaryPublishOperation } from "../lib/dealerKitPublishRecovery.js";

const registration = "LX73YCR";
const configuration = { siteId: "test-site" };
const collectionIds = { finance: "VANFINANCEPAGES", rent2buy: "VANPAGES", cars: "CARPAGES" };
const blockerCodes = { finance: "vfc_duplicate_existing", rent2buy: "rent2buy_existing_ambiguous", cars: "car_detail_ambiguous" };
const live = { id: "live-vehicle", data: { title: registration, _publishStatus: "PUBLISHED", slug: "vehicle-lx73ycr", price: 18000, images: ["wix:image://photo"], spec: { make: "Ford" } } };
const draft = { id: "draft-vehicle", data: { ...live.data, _publishStatus: "DRAFT", _updatedDate: { $date: "2026-11-20T09:00:00.000Z" } } };
const wait = async () => {};

function fixture(product = "finance", items = [live, draft]) {
  const entry = { collectionId: collectionIds[product], siteId: configuration.siteId, items };
  return {
    registration, configuration, configurationsBySiteId: { [configuration.siteId]: configuration },
    vehicle: { supplierStockId: "stock-1", status: "available", sourceUpdatedAt: "2026-11-20T10:00:00Z" },
    decision: { persisted: true, reviewStatus: "reviewed", reviewedSourceUpdatedAt: "2026-11-20T10:00:00Z", financeCategories: ["all_vans"] },
    plan: { mode: product, blockers: [{ code: blockerCodes[product] }] },
    vfcWixResults: product === "finance" ? [entry] : [],
    rent2buyWixResults: product === "rent2buy" ? [entry] : [],
    carListingRows: [], carDetailRows: product === "cars" ? items : [],
  };
}

for (const product of ["finance", "rent2buy", "cars"]) {
  test(product + " keeps the live ID and verifies an approved draft-only fix before resuming", async () => {
    const state = fixture(product);
    const proposal = buildDealerKitRecovery(state, product);
    assert.ok(proposal.summary.approval);
    assert.equal(proposal.canonical.id, live.id);
    const events = [];
    let archived = null;
    const result = await approveDealerKitRecovery(state, product, proposal.summary.approval, {
      refresh: async () => { events.push("refresh"); return state; },
      activeSpecial: async () => false,
      audit: async (_state, _product, event, details) => {
        events.push(event);
        if (event === "approved") {
          assert.deepEqual(details.canonical, live);
          assert.deepEqual(details.draft, draft);
        }
      },
      query: async (site, collection, plate, options = {}) => {
        assert.equal(site.siteId, configuration.siteId);
        assert.equal(collection, collectionIds[product]);
        assert.equal(plate, registration);
        return options.includeDraftItems === false || archived ? [live] : [live, draft];
      },
      request: async (_site, path, { method, body }) => {
        if (method === "PATCH") {
          events.push("patch");
          assert.equal(path, "/wix-data/v2/items/" + draft.id);
          assert.equal(body.dataCollectionId, collectionIds[product]);
          assert.deepEqual(body.publishPluginOptions, { includeDraftItems: true });
          assert.deepEqual(body.condition, { filter: { title: { $eq: registration }, _publishStatus: { $eq: "DRAFT" }, _updatedDate: { $eq: draft.data._updatedDate } } });
          const [change] = body.patch.fieldModifications;
          assert.equal(change.fieldPath, "title");
          archived = { id: draft.id, data: { ...draft.data, title: change.setFieldOptions.value } };
          // A Wix response can be lost even when the write succeeded.
          throw new ControlledPublishError(502, "Wix connection dropped");
        }
        assert.equal(body.query.filter._id.$eq, draft.id);
        return { dataItems: [archived] };
      },
      wait,
    });
    assert.equal(result.verified, true);
    assert.deepEqual(events, ["approved", "refresh", "patch", "verified"]);
  });
}

test("approval expires when either record changes, before any Wix mutation", async () => {
  const state = fixture();
  const approval = buildDealerKitRecovery(state, "finance").summary.approval;
  const events = [];
  const changed = { ...draft, data: { ...draft.data, _updatedDate: "2026-11-20T10:01:00Z" } };
  await assert.rejects(approveDealerKitRecovery(state, "finance", approval, {
    refresh: async () => fixture("finance", [live, changed]),
    audit: async (_state, _product, event, details) => events.push([event, details.mutationStarted]),
    request: async () => assert.fail("stale approval reached a Wix write"),
  }), /changed after approval/);
  assert.deepEqual(events, [["approved", undefined], ["failed", false]]);
});

test("different content, overlapping live rows, unavailable stock and another channel's reference are escalated", () => {
  const cases = [
    fixture("finance", [live, { ...draft, data: { ...draft.data, price: 1 } }]),
    fixture("finance", [live, { ...draft, data: { ...draft.data, _publishStatus: "PUBLISHED" } }]),
    { ...fixture(), vehicle: { ...fixture().vehicle, status: "reserved" } },
    { ...fixture(), rent2buyWixResults: [{ collectionId: "VANPAGES", siteId: configuration.siteId, items: [{ id: "r2b", data: { relation: draft.id } }] }] },
  ];
  for (const state of cases) {
    const plan = buildDealerKitRecovery(state, "finance").summary;
    assert.equal(plan.approval, undefined);
    assert.ok(plan.explanation);
  }
});

test("an older draft like LX73YCR keeps its distinct price and gallery", () => {
  const published = { ...live, data: { ...live.data, _createdDate: { $date: "2026-11-02T15:25:16.777Z" }, priceVat: "£18,000", mainImages: ["wix:image://live"] } };
  const older = { ...draft, data: { ...draft.data, _createdDate: { $date: "2026-11-01T08:43:38.647Z" }, _draftDate: "2026-11-02", priceVat: "£19,000", mainImages: ["wix:image://draft"] } };
  const state = fixture("finance", [published, older]);
  const proposal = buildDealerKitRecovery(state, "finance");
  assert.ok(proposal.summary.approval);
  assert.match(proposal.summary.modified, /different pricing and photographs/);
  assert.deepEqual(proposal.draft, older);
  assert.deepEqual(proposal.canonical, published);
  const editedRoute = { ...older, data: { ...older.data, slug: "different-url" } };
  assert.equal(buildDealerKitRecovery(fixture("finance", [published, editedRoute]), "finance").summary.approval, undefined);
});

test("missing or malformed CMS data cannot be mistaken for no matches", async () => {
  await assert.rejects(queryControlledRegistrationItems(configuration, "CARPAGES", registration, {
    request: async () => ({}),
  }), /incomplete registration lookup/);
});

test("Submit waits for a specific repair and continues into the fresh publish plan", async () => {
  const recovery = buildDealerKitRecovery(fixture(), "finance").summary;
  const ready = { canPublish: true, confirmation: { current: true } };
  let fixed = false;
  const calls = [];
  const result = await submitDealerKitVehicle({
    save: async () => calls.push("save"),
    read: async () => fixed ? { plan: ready } : { recovery },
    approve: async proposal => { assert.equal(proposal.approval, recovery.approval); calls.push("approve"); return true; },
    repair: async () => { fixed = true; calls.push("repair"); return { verified: true }; },
    upload: async () => calls.push("upload"),
    publish: async plan => { assert.equal(plan, ready); calls.push("publish"); return { verified: true }; },
    status: () => {}, isCurrent: () => true,
  });
  assert.equal(result.verified, true);
  assert.deepEqual(calls, ["save", "approve", "repair", "upload", "publish"]);
});

test("Submit cancellation does not repair, upload or publish", async () => {
  const recovery = buildDealerKitRecovery(fixture(), "finance").summary;
  const unexpected = () => assert.fail("operation ran after cancellation");
  await assert.rejects(submitDealerKitVehicle({
    save: async () => {}, read: async () => ({ recovery }),
    approve: async () => false, repair: unexpected, upload: unexpected, publish: unexpected,
    status: () => {}, isCurrent: () => true,
  }), /Repair cancelled/);
});

test("resumable writing reuses a committed create after a lost Wix API response", async () => {
  const state = fixture("cars");
  const target = { product: "cars", collectionId: "CARPAGES", kind: "detail", operation: "create", desiredPublishStatus: "PUBLISHED", data: { title: registration, price: 18000 } };
  const id = controlledWixCreateId(configuration.siteId, target.collectionId, registration);
  let item;
  let writes = 0;
  const events = [];
  const dependencies = {
    query: async () => item ? [item] : [],
    write: async () => {
      writes++;
      item = { id, data: { ...target.data, _publishStatus: "PUBLISHED" } };
      throw new ControlledPublishError(502, "Lost response");
    },
    audit: async (_state, _product, event) => events.push(event),
    wait,
  };
  const first = await reconcileRecoverableTargets(state, registration, "cars", [target], dependencies);
  const second = await reconcileRecoverableTargets(state, registration, "cars", [target], dependencies);
  assert.equal(first.verification.verified, true);
  assert.equal(second.writes.length, 0);
  assert.equal(writes, 1);
  assert.deepEqual(events, ["publish_started", "record_reconciled", "publish_verified", "publish_started", "record_reconciled", "publish_verified"]);
});

test("a browser reload verifies a previously approved repair before publishing", async () => {
  const state = fixture();
  const repair = buildDealerKitRecovery(state, "finance");
  const approval = repair.summary.approval;
  const selector = {
    select() { return this; },
    eq() { return this; },
    in() { return this; },
    order: async () => ({ data: [{ event: "approved", approval, details: repair }] }),
  };
  state.supabase = { from: () => selector };
  let archived = { ...draft, data: { ...draft.data, title: repair.archivedTitle } };
  const seen = [];
  const dependencies = {
    query: async () => [live],
    request: async () => ({ dataItems: [archived] }),
    audit: async (_state, _product, event) => seen.push(event),
    wait,
  };
  await verifyPendingDealerKitRepairs(state, "finance", dependencies);
  assert.deepEqual(seen, ["verified"]);
  archived = draft;
  await assert.rejects(verifyPendingDealerKitRepairs(state, "finance", dependencies), /approved repair is still unverified/);
  assert.deepEqual(seen, ["verified"]);
});

test("a rejected Wix status task retries after rate limiting", async () => {
  let attempts = 0;
  const result = await setTargetPublishStatus(configuration, {
    collectionId: "CARPAGES", desiredPublishStatus: "PUBLISHED",
  }, live.id, {
    wait,
    request: async (_site, path) => {
      if (path !== "/cms/v1/tasks") return { task: { status: "COMPLETED" } };
      attempts++;
      if (attempts === 1) throw new ControlledPublishError(429, "Rate limited", { wixStatus: 429 });
      return { task: { id: "task-1" } };
    },
  });
  assert.equal(result.taskId, "task-1");
  assert.equal(attempts, 2);
});

test("a settled Wix status is reused and an unsettled claim blocks a second task", async () => {
  const state = fixture("cars");
  const target = { ...live, itemId: live.id, data: { title: registration }, collectionId: "CARPAGES", operation: "update", publishStatusOperation: "publish", desiredPublishStatus: "PUBLISHED" };
  const item = { id: live.id, data: { ...target.data, _publishStatus: "DRAFT" } };
  let claimed = false;
  let tasks = 0;
  const dependencies = {
    query: async () => [item],
    audit: async () => {},
    claimStatus: async () => {
      if (claimed) throw new ControlledPublishError(409, "Pending task", { manualAttentionRequired: true });
      claimed = true;
      return "test-claim";
    },
    setStatus: async () => {
      tasks++;
      throw new ControlledPublishError(502, "Lost status response", { publishStatusChangeUncertain: true });
    },
    wait,
  };
  await assert.rejects(reconcileRecoverableTargets(state, registration, "cars", [target], dependencies), /Lost status response/);
  await assert.rejects(reconcileRecoverableTargets(state, registration, "cars", [target], dependencies), /Pending task/);
  item.data._publishStatus = "PUBLISHED";
  const outcome = await reconcileRecoverableTargets(state, registration, "cars", [target], dependencies);
  assert.equal(outcome.verification.verified, true);
  assert.equal(tasks, 1);
});

test("capacity interruption preserves successful updates and reports the remaining operation", async () => {
  const state = fixture("cars");
  const item = { id: live.id, data: { ...live.data } };
  const first = { ...live, data: { price: 20000 }, previousData: item.data, itemId: item.id, collectionId: "CARPAGES", operation: "update" };
  const second = { collectionId: "CARFINANCE", operation: "create", data: { title: registration } };
  const writes = [];
  await assert.rejects(reconcileRecoverableTargets(state, registration, "cars", [first, second], {
    query: async (_configuration, collection) => collection === "CARPAGES" ? [item] : [],
    write: async (_configuration, target) => {
      if (target === second) throw new ControlledPublishError(409, "Capacity full", { code: "wix_cms_item_limit" });
      writes.push(target.collectionId);
      item.data = { ...item.data, ...target.data };
      return { operation: "update", itemId: item.id };
    },
    audit: async () => {},
    wait,
  }), error => error.details.resumable && error.details.writes.length === 1 && error.details.code === "wix_cms_item_limit");
  assert.equal(item.data.price, 20000);
  assert.deepEqual(writes, ["CARPAGES"]);
});

test("updates retain existing route fields while applying reviewed pricing", () => {
  assert.deepEqual(preserveVehicleRoutes(
    { title: registration, webLink: "/new", price: 18000 },
    { title: "LX73 YCR", webLink: "/current", price: 20000 },
  ), { title: "LX73 YCR", webLink: "/current", price: 18000 });
});

test("temporary operations retry within their limit and avoid long rate-limit windows", async () => {
  let attempts = 0;
  await assert.rejects(retryTemporaryPublishOperation(async () => {
    attempts++;
    throw new ControlledPublishError(429, "rate limit");
  }, { wait }), /rate limit/);
  assert.equal(attempts, 3);
  await assert.rejects(retryTemporaryPublishOperation(async () => {
    attempts++;
    throw new ControlledPublishError(429, "rate limit", { retryAfterMs: 12000 });
  }, { wait }), /rate limit/);
  assert.equal(attempts, 4);
});


test("draft PATCH protection covers Cars, Finance and Rent2Buy before writing (WDE0197)", async () => {
  const configuration = { apiBaseUrl: "https://wix.test", apiKey: "fake", siteId: "fixture" };
  const collections = ["CARFINANCE", "CARPAGES", "VANFINANCEPAGES", "VANPAGES", "ALLRENT2BUYVANS"];
  for (const collection of collections) {
    const itemId = "vehicle-123";
    const body = {
      dataCollectionId: collection,
      patch: { dataItemId: itemId, fieldModifications: [{ fieldPath: "picture", action: "SET_FIELD", setFieldOptions: { value: "new-image" } }] },
    };
    let requests = 0;
    const result = await controlledWixRequest(configuration, "/wix-data/v2/items/" + itemId, {
      method: "PATCH",
      body,
      request: async (_url, options) => {
        requests++;
        const submitted = JSON.parse(options.body);
        assert.equal(submitted.publishPluginOptions.includeDraftItems, true, collection);
        assert.deepEqual(submitted.patch, body.patch, "only draft option added, field patch preserved");
        return { ok: true, status: 200, json: async () => ({ dataItem: { id: itemId } }) };
      },
    });
    assert.equal(requests, 1, "Wix PATCH is sent once, not blindly retried");
    assert.equal(result.dataItem.id, itemId);
    assert.equal(body.publishPluginOptions, undefined, "caller payload is not mutated");
    const rollback = draftAwareControlledWixBody("/wix-data/v2/items/" + itemId, "PATCH", {
      dataCollectionId: collection, patch: { dataItemId: itemId, fieldModifications: [{ fieldPath: "picture", action: "REMOVE_FIELD" }] },
    });
    assert.equal(rollback.publishPluginOptions.includeDraftItems, true);
    assert.equal(rollback.patch.fieldModifications[0].action, "REMOVE_FIELD");
  }
});

test("draft-aware guard leaves published reads, publish tasks and explicit options unchanged", () => {
  const draftBody = { dataCollectionId: "CARFINANCE", patch: { dataItemId: "car", fieldModifications: [] }, publishPluginOptions: { includeDraftItems: false } };
  assert.equal(draftAwareControlledWixBody("/wix-data/v2/items/car", "PATCH", draftBody), draftBody);
  const query = { dataCollectionId: "CARFINANCE", query: { paging: { limit: 1 } } };
  assert.equal(draftAwareControlledWixBody("/wix-data/v2/items/query", "POST", query), query);
  const status = { task: { type: "UPDATE_PUBLISH_STATUS" } };
  assert.equal(draftAwareControlledWixBody("/cms/v1/tasks", "POST", status), status);
  const unrelated = { dataCollectionId: "CARFINANCE", patch: { dataItemId: "car" } };
  assert.equal(draftAwareControlledWixBody("/wix-data/v2/items/car", "GET", unrelated), unrelated);
});
