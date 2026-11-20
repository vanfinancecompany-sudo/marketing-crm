import assert from "node:assert/strict";
import test from "node:test";
import { acquireDealerKitPublishLease } from "../api/_dealerkit-publish-safety.js";
import { ControlledPublishError, controlledWixCreateId } from "../api/_dealerkit-controlled-publish-state.js";
import publishVan, { reconcileRecoverableTargets } from "../api/dealerkit-controlled-publish.js";
import publishCar from "../api/dealerkit-car-controlled-publish.js";
import publishWixLegacy from "../api/dealerkit-wix-publish.js";
import prepareMedia from "../api/dealerkit-wix-prepare-media.js";
import manualMedia from "../api/dealerkit-wix-manual-media.js";
import saveReview from "../api/dealerkit-review-decision.js";
import { uploadDealerKitWixPhoto } from "../lib/dealerKitPublishRecovery.js";
import { submitDealerKitVehicle } from "../utils/dealerKitSubmitVehicle.js";

const reg = "ZZ99TST";
const configuration = { siteId: "test-cms" };
const wait = async () => {};

function leaseStore() {
  const owners = new Map();
  return {
    rpc: async (name, { p_registration, p_owner }) => {
      assert.equal(name, "dealerkit_acquire_publish_lease");
      if (owners.has(p_registration)) return { data: false };
      owners.set(p_registration, p_owner);
      return { data: true };
    },
    from(table) {
      assert.equal(table, "dealerkit_publish_leases");
      const fields = {};
      return {
        delete() { return this; },
        eq(field, value) {
          fields[field] = value;
          if (field === "registration") return this;
          if (owners.get(fields.registration) === fields.owner) owners.delete(fields.registration);
          return Promise.resolve({});
        },
      };
    },
  };
}

for (const [product, collections] of [
  ["finance", ["VANFINANCEPAGES", "VANFINANCE-ALLVANS"]],
  ["rent2buy", ["VANPAGES", "ALLRENT2BUYVANS"]],
  ["cars", ["CARPAGES", "CARFINANCE"]],
]) {
  test(product + " leaves a staged upload failure unpublished and reuses a ready upload after a retry", async () => {
    let publishes = 0;
    let uploads = 0;
    let uploadedFile;
    const plan = { canPublish: true, confirmation: { product, registration: reg } };
    const options = {
      save: async () => {},
      read: async () => ({ plan }),
      upload: async () => {
        const prepared = { uploadUrl: "https://example.invalid/upload" };
        const file = { name: "mock-vehicle.jpg", type: "image/jpeg" };
        uploadedFile = await uploadDealerKitWixPhoto(prepared, file, {
          wait,
          request: async (url, options) => {
            assert.equal(url, prepared.uploadUrl);
            assert.equal(options.body, file);
            uploads++;
            return uploads <= 4
              ? new Response("{}", { status: 429 })
              : Response.json({ file: { id: "test-media" } });
          },
        });
      },
      publish: async incoming => {
        assert.equal(incoming, plan);
        publishes++;
        return { verified: true };
      },
      status: () => {}, isCurrent: () => true, wait,
    };
    await assert.rejects(submitDealerKitVehicle(options), /Preparing photographs: Wix could not confirm.*429/);
    assert.equal(publishes, 0);
    assert.equal(uploads, 3);
    assert.equal((await submitDealerKitVehicle(options)).verified, true);
    assert.equal(uploadedFile.file.id, "test-media");
    assert.equal(uploads, 5);
    assert.equal(publishes, 1);
  });

  test(product + " blocks a concurrent submission and reuses the completed row after temporary API and partial failures", async () => {
    const supabase = leaseStore();
    const state = { configuration, registration: reg };
    const data = { title: reg };
    const targets = collections.map(collectionId => ({ collectionId, operation: "create", data, desiredPublishStatus: "PUBLISHED" }));
    const records = new Map();
    const attempts = new Map();
    let allowSecond = false;
    let firstWrite;
    let continueFirst;
    const started = new Promise(resolve => { firstWrite = resolve; });
    const gate = new Promise(resolve => { continueFirst = resolve; });
    const dependencies = {
      audit: async () => {},
      wait,
      query: async (_configuration, collectionId) => records.has(collectionId) ? [records.get(collectionId)] : [],
      write: async (_configuration, target) => {
        const { collectionId } = target;
        attempts.set(collectionId, (attempts.get(collectionId) || 0) + 1);
        if (collectionId === collections[1] && !allowSecond) throw new ControlledPublishError(503, "Mock temporary outage");
        const id = controlledWixCreateId(configuration.siteId, collectionId, reg);
        assert.equal(records.has(collectionId), false);
        records.set(collectionId, { id, data: { ...data, _publishStatus: "PUBLISHED" } });
        if (collectionId === collections[0]) {
          firstWrite();
          await gate;
          throw new ControlledPublishError(502, "Mock response lost after commit");
        }
        return { operation: "create", itemId: id, collectionId };
      },
    };
    async function submit() {
      const release = await acquireDealerKitPublishLease(reg, supabase);
      try {
        return await reconcileRecoverableTargets(state, reg, product, targets, dependencies);
      } finally {
        await release();
      }
    }

    const first = submit();
    await started;
    await assert.rejects(submit(), error => error.status === 409 && error.details.code === "dealerkit_publish_in_progress");
    assert.equal(records.size, 1);
    continueFirst();
    await assert.rejects(first, error => error.status === 503 && error.details.resumable);
    assert.equal(attempts.get(collections[1]), 3);
    allowSecond = true;
    const resumed = await submit();
    assert.equal(resumed.verification.verified, true);
    assert.deepEqual([...records.keys()], collections);
    assert.equal(attempts.get(collections[0]), 1);
    assert.equal(attempts.get(collections[1]), 4);
  });
}

test("isolation applies before Preview publishes, approvals, media writes and review saves reach live integrations", async t => {
  const mockedKey = "test-preview-crm-key";
  const previous = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const previousEnv = process.env.VERCEL_ENV;
  t.after(() => {
    if (previous === undefined) delete process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
    else process.env.MARKETING_CUSTOMER_DATABASE_API_KEY = previous;
    if (previousEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousEnv;
  });
  process.env.MARKETING_CUSTOMER_DATABASE_API_KEY = mockedKey;
  process.env.VERCEL_ENV = "preview";
  const routes = [
    [publishVan, "POST", "publish_new_vehicle", "finance"],
    [publishVan, "POST", "publish_new_vehicle", "rent2buy"],
    [publishVan, "POST", "approve_recovery", "rent2buy"],
    [publishCar, "POST", "approve_recovery", "cars"],
    [publishCar, "POST", "publish_new_car", "cars"],
    [publishWixLegacy, "POST", "apply_existing_vfc_update", "finance"],
    [prepareMedia, "POST", "prepare_media", "finance"],
    [manualMedia, "POST", "prepare_upload", "rent2buy"],
    [saveReview, "PUT", "save", "cars"],
  ];
  for (const [handler, method, action, productMode] of routes) {
    const reply = {
      setHeader() {},
      status(code) { this.code = code; return this; },
      json(payload) { this.payload = payload; return this; },
    };
    await handler({
      method,
      headers: { "x-marketing-customer-database-key": mockedKey },
      body: { action, productMode, registration: reg, confirmRegistration: reg },
    }, reply);
    assert.equal(reply.code, 403, action);
    assert.equal(reply.payload.details.code, "dealerkit_preview_read_only");
  }
});
