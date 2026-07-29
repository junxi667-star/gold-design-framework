import { createHash } from "node:crypto";

const baseUrl = process.env.LOCAL_APP_URL || "http://127.0.0.1:4173";
const projectId = `local-smoke-${Date.now()}`;

function syntheticImageHash(label) {
  return createHash("sha256").update(`synthetic-local-test:${label}`).digest("hex");
}

async function request(pathname, { method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${method} ${pathname} -> ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload.data;
}

async function register(versionId, { parentVersionId = null, finalize = false } = {}) {
  const confirmation = await request(
    `/api/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}/confirm`,
    {
      method: "POST",
      body: {
        resultId: `synthetic-result-${versionId}`,
        imageSha256: syntheticImageHash(versionId),
        ...(parentVersionId ? { parentVersionId } : {}),
      },
    },
  );
  const prepared = await request("/api/web3/registrations/prepare", {
    method: "POST",
    body: {
      projectId,
      versionId,
      finalize,
    },
  });
  const submitted = await request(
    `/api/web3/registrations/${encodeURIComponent(prepared.registrationId)}/submit-local`,
    {
      method: "POST",
      body: {
        ...(finalize ? { finalize: true } : {}),
        acknowledgedLocalDevelopmentSigner: true,
        expectedContentHash: prepared.contentHash,
      },
    },
  );
  const verification = await request(
    `/api/web3/registrations/${encodeURIComponent(prepared.registrationId)}/verify`,
    {
      method: "POST",
      body: { expectedContentHash: prepared.contentHash },
    },
  );
  if (!verification.verified) {
    throw new Error(`Verification failed: ${JSON.stringify(verification)}`);
  }
  return { confirmation, prepared, submitted, verification };
}

const config = await request("/api/web3/config");
if (!config.connected || config.mode !== "local-development") {
  throw new Error(`Local Web3 backend is not ready: ${JSON.stringify(config)}`);
}

const v1 = await register("v1");
const v2 = await register("v2", { parentVersionId: "v1", finalize: true });
const timeline = await request(
  `/api/projects/${encodeURIComponent(projectId)}/chain-timeline`,
);

console.log(JSON.stringify({
  evidenceType: "synthetic-local-e2e-smoke",
  warning: "This proves only the local EVM/API path; it is not Monad or real AI output.",
  projectId,
  chainId: config.chainId,
  contractAddress: config.contractAddress,
  developmentSigner: config.signer.address,
  v1: {
    contentHash: v1.confirmation.contentHash,
    transactionHash: v1.submitted.transactionHash,
    verified: v1.verification.verified,
  },
  v2: {
    contentHash: v2.confirmation.contentHash,
    parentContentHash: v2.confirmation.parentContentHash,
    transactionHash: v2.submitted.transactionHash,
    finalizeTransactionHash: v2.submitted.finalizeTransactionHash,
    verified: v2.verification.verified,
    finalized: v2.verification.onchain.finalized,
  },
  timelineItems: timeline.items.length,
}, null, 2));
