import assert from "node:assert/strict";
import test from "node:test";
import { assayReceiptFinalityPolicy, chainReceiptKey, mergeChainReceiptViews, reorganizationCorrection } from "../src/finality-merge.mjs";
import { makeNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";

const ni = (value) => makeNiUri(Buffer.from(value, "utf8"));
const receipt = { chainId: "eip155:1", blockHash: `0x${"11".repeat(32)}`, transactionHash: `0x${"22".repeat(32)}`, logIndex: 3, senAct: ni("act"), evidenceRoot: ni("evidence") };
const charge = (positiveEvidence, negativeEvidence) => ({ predicate: ni("predicate"), subject: ni("subject"), object: ni("object"), positiveEvidence, negativeEvidence });

test("finality assay requires the exact canonical receipt and declared confirmations", async () => {
  const fetchImpl = async (_url, request) => { const { method } = JSON.parse(request.body); const result = method === "eth_getTransactionReceipt" ? { status: "0x1", blockHash: receipt.blockHash, blockNumber: "0x64", logs: [{ logIndex: "0x3" }] } : "0x69"; return { ok: true, json: async () => ({ result }) }; };
  const result = await assayReceiptFinalityPolicy(receipt, { id: "ethereum-6-confirmations", chainId: "eip155:1", rpcUrl: "https://rpc.invalid", confirmations: 6 }, fetchImpl);
  assert.equal(result.key, chainReceiptKey(receipt));
  assert.equal(result.observedThrough, 100);
  assert.equal(result.boundaryKind, "confirmation-threshold");
  assert.equal(result.regime, "scott-continuous");
  assert.equal(result.stage, "positing");
  assert.equal(result.finalizedThrough, undefined);
  await assert.rejects(() => assayReceiptFinalityPolicy({ ...receipt, blockHash: `0x${"33".repeat(32)}` }, { id: "p", chainId: "eip155:1", rpcUrl: "x", confirmations: 1 }, fetchImpl), /no longer canonical/u);
  await assert.rejects(() => assayReceiptFinalityPolicy(receipt, { id: "not-final", chainId: "eip155:1", rpcUrl: "x", finalityTag: "latest" }, fetchImpl), /EVM finalized tag/u);
  await assert.rejects(() => assayReceiptFinalityPolicy(receipt, { id: "zero", chainId: "eip155:1", rpcUrl: "x", confirmations: 0 }, fetchImpl), /confirmations must be positive/u);
});

test("grow-only receipt union and FOUR join are associative commutative and idempotent", () => {
  const a = { receipts: [receipt], evidence: [charge(true, false)] }, b = { receipts: [receipt], evidence: [charge(false, true)] };
  const ab = mergeChainReceiptViews([a, b]), ba = mergeChainReceiptViews([b, a]), aa = mergeChainReceiptViews([a, a]);
  assert.deepEqual(ab, ba); assert.deepEqual(aa, mergeChainReceiptViews([a])); assert.deepEqual(ab.evidence[0], charge(true, true));
  assert.deepEqual(mergeChainReceiptViews([{ ...a }, mergeChainReceiptViews([b, a])]), mergeChainReceiptViews([mergeChainReceiptViews([a, b]), a]));
});

test("replay drift and simultaneous cross-chain custody are refused", () => {
  assert.throws(() => mergeChainReceiptViews([{ receipts: [receipt] }, { receipts: [{ ...receipt, senAct: ni("other") }] }]), /replay changed/u);
  const resource = ni("resource"), evidence = ni("custody");
  assert.throws(() => mergeChainReceiptViews([{ custody: [{ resource, evidence, active: true, chainId: "eip155:1", account: "eip155:1:0x0000000000000000000000000000000000000001" }] }, { custody: [{ resource, evidence, active: true, chainId: "eip155:10", account: "eip155:10:0x0000000000000000000000000000000000000001" }] }]), /exclusive custody/u);
});

test("reorganization appends negative evidence instead of deleting the positive claim", () => {
  const correction = reorganizationCorrection(charge(true, false));
  const merged = mergeChainReceiptViews([{ evidence: [charge(true, false)] }, { evidence: [correction] }]);
  assert.deepEqual(merged.evidence[0], charge(true, true));
});
