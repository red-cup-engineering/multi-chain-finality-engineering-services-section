import assert from "node:assert/strict";
import test from "node:test";

import { ACTOR, EFFECTS, run } from "../src/finality-service-contract.mjs";

const at = "2026-07-24T22:30:00.000Z";
const env = {
  WITNESS_JOURNAL_RDF_AGENT: "https://witnessJournal.example/.well-known/agent-card.json",
  MULTI_CHAIN_FINALITY_DATA_ROOT: "/tmp/multi-chain-finality-contract-test",
};
const receipt = {
  chainId: "eip155:8453",
  blockHash: `0x${"11".repeat(32)}`,
  transactionHash: `0x${"22".repeat(32)}`,
  logIndex: 3,
};
const request = {
  type: "ReceiptFinalityPolicyAssayDemand",
  receipt,
  policy: {
    id: "base-finalized-tag",
    chainId: "eip155:8453",
    rpcUrl: "https://base.example",
    finalityTag: "finalized",
  },
};
const recorded = [];
const recorder = async (entry) => {
  recorded.push(entry);
  return { documentNi: "ni:///sha-256;AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" };
};
function solicitation(value = request) {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: "urn:test:finality-solicitation",
    type: "Offer",
    actor: "urn:ame:customer",
    target: ACTOR,
    object: {
      type: "ServiceSolicitation",
      request: value,
      requestDigest: "sha256:request",
      sourceActivity: { id: "urn:leader:source" },
    },
  };
}
function invocation(offered) {
  return {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: "urn:test:finality-invocation",
    type: "Accept",
    actor: "urn:ame:customer",
    target: ACTOR,
    object: {
      type: "ServiceContract",
      offer: offered,
      capability: {
        type: "Capability",
        issuer: "urn:ame:customer",
        holder: ACTOR,
        invocationTarget: ACTOR,
        parentOffer: offered.id,
        allowedActions: ["invoke-service", ...EFFECTS],
        attenuation: { requestDigest: offered.object.requestDigest },
        capTP: { method: "invoke-service" },
      },
    },
  };
}

test("offers only the exact receipt-finality-policy assay demand through the advertised carrier", async () => {
  const offered = await run(solicitation(), "solicit-service", at, env, undefined, recorder);
  assert.equal(offered.type, "Offer");
  assert.equal(offered.object.type, "ExecutableServiceOffer");
  assert.deepEqual(offered.object.effects, EFFECTS);
  assert.equal(offered.object.request, request);
  assert.ok(recorded.at(-1).category.endsWith("receipt-finality-policy-assay-offer"));

  const wrong = await run(solicitation({ type: "UnionSettlementTimeChainCapabilityDemand" }), "solicit-service", at, env, undefined, recorder);
  assert.equal(wrong.type, "Reject");
  assert.equal(wrong.object.reason, "request must be ReceiptFinalityPolicyAssayDemand");
});

test("invocation returns and records an attributable assay without mutation", async () => {
  const offered = await run(solicitation(), "solicit-service", at, env, undefined, recorder);
  const assay = async () => ({
    ...receipt,
    key: `${receipt.chainId}:${receipt.blockHash}:${receipt.transactionHash}:3`,
    blockNumber: 100,
    observedThrough: 110,
    boundaryKind: "protocol-finalized-block",
    regime: "strict-finite",
    stage: "settling",
    finalityPolicy: request.policy.id,
    positiveEvidence: true,
    negativeEvidence: false,
  });
  const result = await run(invocation(offered), "invoke-service", at, env, assay, recorder);
  assert.equal(result.type, "Accept");
  assert.equal(result.object.type, "ReceiptFinalityPolicyAssay");
  assert.equal(result.object.chainMutation, false);
  assert.equal(result.object.customerMutation, false);
  assert.ok(recorded.at(-1).category.endsWith("receipt-finality-policy-assay"));
});

test("failed or insufficient finality remains a typed provider refusal", async () => {
  const offered = await run(solicitation(), "solicit-service", at, env, undefined, recorder);
  const result = await run(invocation(offered), "invoke-service", at, env, async () => {
    throw new Error("receipt has not reached the declared finality policy");
  }, recorder);
  assert.equal(result.type, "Reject");
  assert.equal(result.object.type, "ReceiptFinalityPolicyAssayRefusal");
  assert.equal(result.object.reason, "receipt has not reached the declared finality policy");
  assert.equal(result.object.partialSuccessClaimed, false);
});

test("the contract refuses a non-final EVM tag, widened capability, and invalid time as typed values", async () => {
  const taggedLatest = await run(solicitation({
    ...request,
    policy: { ...request.policy, finalityTag: "latest" },
  }), "solicit-service", at, env, undefined, recorder);
  assert.equal(taggedLatest.type, "Reject");
  assert.equal(taggedLatest.object.reason, "finality tag must be the EVM finalized tag");

  const offered = await run(solicitation(), "solicit-service", at, env, undefined, recorder);
  const widened = invocation(offered);
  widened.object.capability.allowedActions.push("customer-mutation");
  const rejectedCapability = await run(widened, "invoke-service", at, env, async () => {
    throw new Error("assay must not be reached");
  }, recorder);
  assert.equal(rejectedCapability.type, "Reject");
  assert.equal(rejectedCapability.object.reason, "invocation-capability-does-not-authorize-the-exact-provider-effects");

  const invalidTime = await run(solicitation(), "solicit-service", "not-a-time", env, undefined, recorder);
  assert.equal(invalidTime.type, "Reject");
  assert.equal(invalidTime.object.reason, "recordedAt-must-be-an-ISO-timestamp");
});

test("an unavailable provider witness boundary is a typed unsettled refusal, never a crash or offer", async () => {
  const unavailableRecorder = async () => {
    throw new Error("provider witness unavailable");
  };
  const valid = await run(solicitation(), "solicit-service", at, env, undefined, unavailableRecorder);
  assert.equal(valid.type, "Reject");
  assert.equal(valid.object.reason, "provider-witness-boundary-unavailable");
  assert.equal(valid.object.witnessStatus, "unsettled-provider-witness-boundary-unavailable");

  const invalid = await run(
    solicitation({ type: "UnionSettlementTimeChainCapabilityDemand" }),
    "solicit-service",
    at,
    env,
    undefined,
    unavailableRecorder,
  );
  assert.equal(invalid.type, "Reject");
  assert.equal(invalid.object.reason, "request must be ReceiptFinalityPolicyAssayDemand");
  assert.equal(invalid.object.witnessStatus, "unsettled-provider-witness-boundary-unavailable");
});
