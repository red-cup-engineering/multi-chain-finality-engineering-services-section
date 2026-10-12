#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/computer-content-address-engineering-services-section/semantic-content-identity";
import { recordSettlementRecord } from "@red-cup-engineering/witness-journal-document-service";
import { assayReceiptFinalityPolicy, chainReceiptKey } from "./finality-merge.mjs";
import { canonicalJson as canonical } from "@red-cup-engineering/json-services-section/canonical-json";
import { ACTIVITYSTREAMS_CONTEXT } from "@red-cup-engineering/activitypub-services-section/activitystreams";

export const ACTOR = "urn:ame:multi-chain-finality-services-section";
export const NODE_ID = "multi-chain-finality-services-section";
const HERE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const EFFECTS = Object.freeze(["provider-local-witness-journal-evidence"]);
const INTENT_SIGNATURE = "assay-one-chain-qualified-receipt-against-one-finality-policy/v1";

function identified(body) {
  const id = identifyJsonSemanticContent({ objectKind: "multi-chain-finality.activity-record", value: body, witnessRoot: EMPTY_WITNESS_ROOT }).token;
  return Object.freeze({ id, ...body });
}
function response(type, source, object, recordedAt) {
  return identified({
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type,
    actor: ACTOR,
    target: source?.actor ?? null,
    inReplyTo: source?.id ?? null,
    object,
    published: recordedAt,
  });
}
function witnessJournalAgent(env) {
  if (!env.WITNESS_JOURNAL_RDF_AGENT) throw new Error("WITNESS_JOURNAL_RDF_AGENT must name the provider's contracted witness-journal RDF A2A provider");
  return env.WITNESS_JOURNAL_RDF_AGENT;
}
async function append(record, category, recordedAt, env, recorder) {
  return recorder({
    agentUrl: witnessJournalAgent(env),
    root: resolve(env.MULTI_CHAIN_FINALITY_DATA_ROOT ?? `${HERE}/data`),
    nodeId: NODE_ID,
    settlement: ACTOR,
    actor: ACTOR,
    category,
    recordedAt,
    record,
  });
}
function publicRpcUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new TypeError("finality policy rpcUrl must be an absolute HTTP or HTTPS URL"); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new TypeError("finality policy rpcUrl must be a public HTTP or HTTPS observation endpoint without embedded credentials");
  }
  return value;
}
function exactRequest(request) {
  if (request?.type !== "ReceiptFinalityPolicyAssayDemand") throw new TypeError("request must be ReceiptFinalityPolicyAssayDemand");
  chainReceiptKey(request.receipt);
  if (request.policy?.chainId !== request.receipt.chainId || typeof request.policy.id !== "string" || request.policy.id.length === 0) {
    throw new TypeError("request must carry one exact per-chain finality policy identity");
  }
  publicRpcUrl(request.policy.rpcUrl);
  const hasTag = typeof request.policy.finalityTag === "string" && request.policy.finalityTag.length > 0;
  const hasConfirmations = request.policy.confirmations !== undefined;
  if (hasTag === hasConfirmations) throw new TypeError("finality policy must select exactly one finality tag or confirmation count");
  if (hasTag && request.policy.finalityTag !== "finalized") {
    throw new TypeError("finality tag must be the EVM finalized tag");
  }
  if (hasConfirmations) {
    let confirmations;
    try { confirmations = BigInt(request.policy.confirmations); } catch { throw new TypeError("finality confirmations must be a positive EVM quantity"); }
    if (confirmations < 1n) throw new TypeError("finality confirmations must be a positive EVM quantity");
  }
  return request;
}
function solicitationProblem(activity) {
  if (activity?.["@context"] !== ACTIVITYSTREAMS_CONTEXT || activity.type !== "Offer" || activity.target !== ACTOR || activity.object?.type !== "ServiceSolicitation") {
    return "solicitation-must-be-an-addressed-activitystreams-service-offer";
  }
  try { exactRequest(activity.object.request); } catch (error) { return error.message; }
  if (activity.object.requestDigest === undefined || activity.object.sourceActivity?.id === undefined) {
    return "solicitation-must-bind-request-digest-and-source-activity";
  }
  return null;
}
function offer(source, request, recordedAt) {
  return response("Offer", source, {
    type: "ExecutableServiceOffer",
    sourceActivity: source.object.sourceActivity.id,
    request,
    requestDigest: source.object.requestDigest,
    operation: "invoke-service",
    effects: EFFECTS,
    requirements: ["exact-chain-finality-policy", "canonical-receipt-and-log", "provider-owned-witness-journal-boundary"],
    intentSignature: INTENT_SIGNATURE,
    scope: Object.freeze({ chainId: request.receipt.chainId, finalityPolicy: request.policy.id }),
    chainMutation: false,
    customerMutation: false,
  }, recordedAt);
}
function invocationProblem(activity) {
  const contract = activity?.object;
  const offered = contract?.offer;
  const capability = contract?.capability;
  if (activity?.["@context"] !== ACTIVITYSTREAMS_CONTEXT || activity.type !== "Accept" || activity.target !== ACTOR || contract?.type !== "ServiceContract") {
    return "invocation-must-be-an-addressed-activitystreams-service-contract";
  }
  if (offered?.type !== "Offer" || offered.actor !== ACTOR || offered.target !== activity.actor) {
    return "invocation-must-accept-an-exact-provider-authored-offer";
  }
  try { exactRequest(offered.object.request); } catch (error) { return error.message; }
  if (canonical(offered.object.effects) !== canonical(EFFECTS) || offered.object.operation !== "invoke-service") return "provider-offer-effects-or-operation-changed";
  if (capability?.type !== "Capability" || capability.issuer !== activity.actor || capability.holder !== ACTOR || capability.invocationTarget !== ACTOR || capability.parentOffer !== offered.id) {
    return "invocation-capability-is-not-attenuated-to-this-provider-and-offer";
  }
  if (capability.capTP?.method !== "invoke-service" || capability.attenuation?.requestDigest !== offered.object.requestDigest) {
    return "invocation-capability-does-not-bind-the-offered-request";
  }
  const allowed = capability.allowedActions;
  const exactAllowed = ["invoke-service", ...EFFECTS];
  if (
    !Array.isArray(allowed)
    || allowed.length !== exactAllowed.length
    || new Set(allowed).size !== exactAllowed.length
    || !exactAllowed.every((action) => allowed.includes(action))
  ) {
    return "invocation-capability-does-not-authorize-the-exact-provider-effects";
  }
  return null;
}
async function refusal(source, reason, recordedAt, env, recorder) {
  const record = response("Reject", source, {
    type: "ReceiptFinalityPolicyAssayRefusal",
    reason,
    positiveEvidence: false,
    negativeEvidence: false,
    chainMutation: false,
    customerMutation: false,
    partialSuccessClaimed: false,
  }, recordedAt);
  try {
    await append(record, "multi-chain-finality.receipt-finality-policy-assay-refusal", recordedAt, env, recorder);
    return record;
  } catch {
    return response("Reject", source, {
      type: "ReceiptFinalityPolicyAssayRefusal",
      reason,
      witnessStatus: "unsettled-provider-witness-boundary-unavailable",
      positiveEvidence: false,
      negativeEvidence: false,
      chainMutation: false,
      customerMutation: false,
      partialSuccessClaimed: false,
    }, recordedAt);
  }
}
export async function run(
  activity,
  operation = "invoke-service",
  recordedAt = new Date().toISOString(),
  env = process.env,
  assay = assayReceiptFinalityPolicy,
  recorder = recordSettlementRecord,
) {
  if (!Number.isFinite(Date.parse(recordedAt))) {
    return refusal(activity, "recordedAt-must-be-an-ISO-timestamp", new Date().toISOString(), env, recorder);
  }
  if (operation === "solicit-service") {
    const problem = solicitationProblem(activity);
    if (problem) return refusal(activity, problem, recordedAt, env, recorder);
    const record = offer(activity, activity.object.request, recordedAt);
    try {
      await append(record, "multi-chain-finality.receipt-finality-policy-assay-offer", recordedAt, env, recorder);
      return record;
    } catch {
      return response("Reject", activity, {
        type: "ReceiptFinalityPolicyAssayRefusal",
        reason: "provider-witness-boundary-unavailable",
        witnessStatus: "unsettled-provider-witness-boundary-unavailable",
        positiveEvidence: false,
        negativeEvidence: false,
        chainMutation: false,
        customerMutation: false,
        partialSuccessClaimed: false,
      }, recordedAt);
    }
  }
  if (operation !== "invoke-service") return refusal(activity, "unknown-provider-operation", recordedAt, env, recorder);
  const problem = invocationProblem(activity);
  if (problem) return refusal(activity, problem, recordedAt, env, recorder);
  try {
    const request = activity.object.offer.object.request;
    const result = await assay(request.receipt, request.policy);
    const record = response("Accept", activity, {
      type: "ReceiptFinalityPolicyAssay",
      result,
      positiveEvidence: true,
      negativeEvidence: false,
      chainMutation: false,
      customerMutation: false,
    }, recordedAt);
    await append(record, "multi-chain-finality.receipt-finality-policy-assay", recordedAt, env, recorder);
    return record;
  } catch (error) {
    return refusal(activity, error instanceof Error ? error.message : String(error), recordedAt, env, recorder);
  }
}

function argument(flag) {
  const at = process.argv.indexOf(flag);
  return at < 0 ? undefined : process.argv[at + 1];
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const activity = JSON.parse(readFileSync(0, "utf8"));
    const output = await run(activity, argument("--operation") ?? "invoke-service", argument("--now") ?? new Date().toISOString());
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    if (output.type === "Reject") process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${basename(process.argv[1])}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
