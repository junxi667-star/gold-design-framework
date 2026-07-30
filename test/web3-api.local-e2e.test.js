import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { ContractFactory, JsonRpcProvider } from "ethers";
import ganache from "ganache";

import { compileDesignRegistry } from "../scripts/web3-contract.js";
import { createAppServer } from "../server.js";

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function offlineProvider() {
  return {
    healthCheck: async () => ({
      provider: "local-comfyui",
      configured: false,
      reachable: false,
      error: { code: "COMFYUI_UNAVAILABLE", message: "Web3 测试不连接 ComfyUI" },
    }),
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function chainableResult({
  id,
  versionId,
  projectId,
  requirementRevisionId,
  filename,
  status = "succeeded",
  isDemoPlaceholder = false,
  provider = "local-comfyui",
  parentVersionId = null,
  parentResultId = null,
  storedSha256 = sha256(VALID_PNG),
  storedSizeBytes = VALID_PNG.length,
  imageUrl = `/generated/${encodeURIComponent(filename)}`,
} = {}) {
  const suffix = id.replace(/^result-/, "");
  const taskId = `task-${suffix}`;
  const generationId = `generation-${suffix}`;
  const directionId = `direction-${suffix}`;
  return {
    task: {
      id: taskId,
      generationId,
      projectId,
      status: "succeeded",
      resultIds: [id],
      completedImages: [],
      directions: [{ id: directionId, resultIds: [id], completedImages: [] }],
    },
    result: {
      id,
      versionId,
      generationId,
      projectId,
      sourceTaskId: taskId,
      parentVersionId,
      parentResultId,
      directionId,
      status,
      imageUrl,
      imageAsset: filename
        ? {
          filename,
          mimeType: "image/png",
          sizeBytes: storedSizeBytes,
          sha256: storedSha256,
        }
        : null,
      isDemoPlaceholder,
      provider,
      requirementRevisionId,
      createdAt: "2026-07-29T00:00:00.000Z",
    },
  };
}

async function seedAiEvidence(directory) {
  const generatedDir = path.join(directory, "generated");
  await mkdir(generatedDir, { recursive: true });
  for (const filename of [
    "result-v1.png",
    "result-v2.png",
    "result-parent-v1.png",
    "result-parent-v2.png",
    "result-cross-project.png",
    "result-tampered.png",
  ]) {
    await writeFile(path.join(generatedDir, filename), VALID_PNG);
  }

  const definitions = [
    chainableResult({
      id: "result-v1",
      versionId: "version-v1",
      projectId: "project-api-e2e",
      requirementRevisionId: "requirement-main",
      filename: "result-v1.png",
    }),
    chainableResult({
      id: "result-v2",
      versionId: "version-v2",
      projectId: "project-api-e2e",
      requirementRevisionId: "requirement-main",
      filename: "result-v2.png",
      parentVersionId: "version-v1",
      parentResultId: "result-v1",
    }),
    chainableResult({
      id: "result-parent-v1",
      versionId: "version-parent-v1",
      projectId: "project-parent-gate",
      requirementRevisionId: "requirement-parent",
      filename: "result-parent-v1.png",
    }),
    chainableResult({
      id: "result-parent-v2",
      versionId: "version-parent-v2",
      projectId: "project-parent-gate",
      requirementRevisionId: "requirement-parent",
      filename: "result-parent-v2.png",
      parentVersionId: "version-parent-v1",
      parentResultId: "result-parent-v1",
    }),
    chainableResult({
      id: "result-other-project",
      versionId: "version-other-project",
      projectId: "project-other",
      requirementRevisionId: "requirement-other",
      filename: "result-cross-project.png",
    }),
    chainableResult({
      id: "result-missing-file",
      versionId: "version-missing-file",
      projectId: "project-failure-gates",
      requirementRevisionId: "requirement-failure",
      filename: "missing-file.png",
    }),
    chainableResult({
      id: "result-tampered",
      versionId: "version-tampered",
      projectId: "project-failure-gates",
      requirementRevisionId: "requirement-failure",
      filename: "result-tampered.png",
      storedSha256: "ab".repeat(32),
    }),
    chainableResult({
      id: "result-placeholder",
      versionId: "version-placeholder",
      projectId: "project-failure-gates",
      requirementRevisionId: "requirement-failure",
      filename: null,
      isDemoPlaceholder: true,
      provider: "local-demo",
      imageUrl: null,
    }),
    chainableResult({
      id: "result-failed",
      versionId: "version-failed",
      projectId: "project-failure-gates",
      requirementRevisionId: "requirement-failure",
      filename: null,
      status: "failed",
      imageUrl: null,
    }),
  ];
  const projectIds = [
    ["project-api-e2e", "requirement-main"],
    ["project-parent-gate", "requirement-parent"],
    ["project-other", "requirement-other"],
    ["project-failure-gates", "requirement-failure"],
  ];
  await writeFile(path.join(directory, "ai-state.json"), JSON.stringify({
    schemaVersion: 4,
    requirements: projectIds.map(([projectId, id]) => ({
      id,
      projectId,
      status: "confirmed",
      confirmedAt: "2026-07-29T00:00:00.000Z",
    })),
    promptTemplates: [],
    tasks: definitions.map((item) => item.task),
    results: definitions.map((item) => item.result),
    feedback: [],
    idempotency: {},
  }), "utf8");
  return { generatedDir };
}

async function requestJson(url, { method = "GET", body } = {}) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

async function startHttpServer(directory, web3Options) {
  const server = createAppServer({
    statePath: path.join(directory, "ai-state.json"),
    generatedDir: path.join(directory, "generated"),
    provider: offlineProvider(),
    web3StatePath: path.join(directory, "web3-state.json"),
    ...web3Options,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("HTTP API 在真实本地 EVM 完成确认、登记、最终确认和读取时间线", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "gold-web3-api-"));
  await seedAiEvidence(directory);
  const chainId = 31337;
  const chain = ganache.server({
    chain: { chainId, networkId: chainId },
    logging: { quiet: true },
    wallet: { deterministic: true, totalAccounts: 3 },
  });
  await chain.listen(0, "127.0.0.1");
  const chainAddress = chain.address();
  const rpcUrl = `http://127.0.0.1:${chainAddress.port}`;
  const provider = new JsonRpcProvider(rpcUrl);
  const signer = await provider.getSigner(0);
  const artifact = await compileDesignRegistry();
  const registry = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy();
  await registry.waitForDeployment();

  const artifactPath = path.join(directory, "DesignRegistry.json");
  const runtimePath = path.join(directory, "web3-runtime.json");
  await writeFile(artifactPath, JSON.stringify(artifact), "utf8");
  await writeFile(runtimePath, JSON.stringify({
    schemaVersion: "local-web3-runtime/v1",
    mode: "local-development",
    rpcUrl,
    chainId,
    contractAddress: await registry.getAddress(),
    deploymentTransactionHash: registry.deploymentTransaction().hash,
    developmentSignerAddress: await signer.getAddress(),
  }), "utf8");
  const legacyContentHash = `0x${"44".repeat(32)}`;
  const deploymentTransactionHash = registry.deploymentTransaction().hash;
  await writeFile(path.join(directory, "web3-state.json"), JSON.stringify({
    schemaVersion: "local-web3-state/v1",
    confirmations: [{
      confirmationId: "confirmation-legacy",
      projectId: "project-legacy",
      versionId: "version-legacy",
      selectedResultId: "result-legacy",
      manifest: {
        schemaVersion: "design-manifest/v1",
        projectId: "project-legacy",
        versionId: "version-legacy",
        resultId: "result-legacy",
        imageSha256: "44".repeat(32),
      },
      canonicalManifest: "{}",
      contentHash: legacyContentHash,
      parentContentHash: `0x${"00".repeat(32)}`,
      parentVersionId: null,
    }],
    registrations: [{
      registrationId: "registration-legacy",
      confirmationId: "confirmation-legacy",
      projectId: "project-legacy",
      versionId: "version-legacy",
      status: "prepared",
      mode: "local-development",
      chainId,
      contractAddress: await registry.getAddress(),
      deploymentTransactionHash,
      contentHash: legacyContentHash,
      canonicalManifest: "{}",
      resultId: "result-legacy",
      finalizeRequested: false,
    }],
  }), "utf8");

  const app = await startHttpServer(directory, {
    web3RuntimePath: runtimePath,
    web3ArtifactPath: artifactPath,
    web3RpcUrl: rpcUrl,
    web3ChainId: chainId,
  });

  try {
    const config = await requestJson(`${app.baseUrl}/api/web3/config`);
    assert.equal(config.response.status, 200);
    assert.equal(config.payload.data.status, "READY_LOCAL");
    assert.equal(config.payload.data.connected, true);
    assert.equal(config.payload.data.signer.type, "local-development-signer");

    const missingResult = await requestJson(
      `${app.baseUrl}/api/projects/project-api-e2e/versions/version-v1/confirm`,
      { method: "POST", body: {} },
    );
    assert.equal(missingResult.response.status, 400);
    assert.equal(missingResult.payload.error.code, "INPUT_VALIDATION_FAILED");

    const crossProjectResult = await requestJson(
      `${app.baseUrl}/api/projects/project-api-e2e/versions/version-other-project/confirm`,
      { method: "POST", body: { resultId: "result-other-project" } },
    );
    assert.equal(crossProjectResult.response.status, 409);
    assert.equal(crossProjectResult.payload.error.code, "AI_RESULT_PROJECT_MISMATCH");

    const placeholderResult = await requestJson(
      `${app.baseUrl}/api/projects/project-failure-gates/versions/version-placeholder/confirm`,
      { method: "POST", body: { resultId: "result-placeholder" } },
    );
    assert.equal(placeholderResult.response.status, 409);
    assert.equal(placeholderResult.payload.error.code, "AI_RESULT_NOT_CHAINABLE");

    const failedResult = await requestJson(
      `${app.baseUrl}/api/projects/project-failure-gates/versions/version-failed/confirm`,
      { method: "POST", body: { resultId: "result-failed" } },
    );
    assert.equal(failedResult.response.status, 409);
    assert.equal(failedResult.payload.error.code, "AI_RESULT_NOT_SUCCEEDED");

    const missingFile = await requestJson(
      `${app.baseUrl}/api/projects/project-failure-gates/versions/version-missing-file/confirm`,
      { method: "POST", body: { resultId: "result-missing-file" } },
    );
    assert.equal(missingFile.response.status, 409);
    assert.equal(missingFile.payload.error.code, "IMAGE_ASSET_UNAVAILABLE");

    const tamperedFile = await requestJson(
      `${app.baseUrl}/api/projects/project-failure-gates/versions/version-tampered/confirm`,
      { method: "POST", body: { resultId: "result-tampered" } },
    );
    assert.equal(tamperedFile.response.status, 409);
    assert.equal(tamperedFile.payload.error.code, "IMAGE_ASSET_INTEGRITY_MISMATCH");

    const fakeClientHash = await requestJson(
      `${app.baseUrl}/api/projects/project-api-e2e/versions/version-v1/confirm`,
      {
        method: "POST",
        body: { resultId: "result-v1", imageSha256: "11".repeat(32) },
      },
    );
    assert.equal(fakeClientHash.response.status, 409);
    assert.equal(fakeClientHash.payload.error.code, "CLIENT_IMAGE_HASH_MISMATCH");

    for (const metadataUri of [
      "https://example.com/manifests/customer@example.com/version-v1",
      "https://example.com/manifests/sk-live-abcdefghijklmnop/version-v1",
      "https://example.com/manifests/version-v1?access_token=secret",
    ]) {
      const sensitiveUri = await requestJson(
        `${app.baseUrl}/api/projects/project-api-e2e/versions/version-v1/confirm`,
        { method: "POST", body: { resultId: "result-v1", metadataUri } },
      );
      assert.equal(sensitiveUri.response.status, 400);
      assert.equal(sensitiveUri.payload.error.code, "INPUT_VALIDATION_FAILED");
    }

    const v1Confirm = await requestJson(
      `${app.baseUrl}/api/projects/project-api-e2e/versions/version-v1/confirm`,
      {
        method: "POST",
        body: {
          resultId: "result-v1",
        },
      },
    );
    assert.equal(v1Confirm.response.status, 201);
    assert.equal(v1Confirm.payload.data.status, "confirmed-offchain");
    assert.equal(v1Confirm.payload.data.manifest.schemaVersion, "design-manifest/v1");
    assert.equal(v1Confirm.payload.data.manifest.imageSha256, sha256(VALID_PNG));
    assert.equal(
      v1Confirm.payload.data.manifest.imageHashSource,
      "server-computed-final-image-bytes",
    );
    assert.equal(v1Confirm.payload.data.manifest.resultId, "result-v1");
    assert.equal(v1Confirm.payload.data.manifest.requirementRevisionId, "requirement-main");
    assert.equal(v1Confirm.payload.data.parentContentHash, `0x${"00".repeat(32)}`);

    const v1Prepare = await requestJson(
      `${app.baseUrl}/api/web3/registrations/prepare`,
      {
        method: "POST",
        body: {
          projectId: "project-api-e2e",
          versionId: "version-v1",
          finalize: false,
        },
      },
    );
    assert.equal(v1Prepare.response.status, 201);
    assert.equal(v1Prepare.payload.data.status, "prepared");
    assert.equal(v1Prepare.payload.data.mode, "local-development");
    assert.equal(v1Prepare.payload.data.manifest.schemaVersion, "design-manifest/v1");

    const v1RegistrationId = v1Prepare.payload.data.registrationId;
    const v1Submit = await requestJson(
      `${app.baseUrl}/api/web3/registrations/${v1RegistrationId}/submit-local`,
      {
        method: "POST",
        body: {
          acknowledgedLocalDevelopmentSigner: true,
          expectedContentHash: v1Prepare.payload.data.contentHash,
        },
      },
    );
    assert.equal(v1Submit.response.status, 200);
    assert.equal(v1Submit.payload.data.status, "submitted-local");
    assert.match(v1Submit.payload.data.transactionHash, /^0x[a-f0-9]{64}$/i);

    const v1Verify = await requestJson(
      `${app.baseUrl}/api/web3/registrations/${v1RegistrationId}/verify`,
      {
        method: "POST",
        body: { expectedContentHash: v1Prepare.payload.data.contentHash },
      },
    );
    assert.equal(v1Verify.response.status, 200);
    assert.equal(v1Verify.payload.data.verified, true);

    const v2Confirm = await requestJson(
      `${app.baseUrl}/api/projects/project-api-e2e/versions/version-v2/confirm`,
      {
        method: "POST",
        body: {
          resultId: "result-v2",
          selectedResultId: "result-v2",
          parentVersionId: "version-v1",
          confirmationSource: "local_registry_workbench",
          confirmedBy: "local-development-user",
        },
      },
    );
    assert.equal(v2Confirm.response.status, 201);
    assert.equal(v2Confirm.payload.data.parentContentHash, v1Confirm.payload.data.contentHash);

    const v2Prepare = await requestJson(
      `${app.baseUrl}/api/web3/registrations/prepare`,
      {
        method: "POST",
        body: {
          projectId: "project-api-e2e",
          versionId: "version-v2",
          sourceVersionId: "version-v2",
          resultId: "result-v2",
          confirmationId: v2Confirm.payload.data.confirmationId,
          finalize: true,
        },
      },
    );
    assert.equal(v2Prepare.response.status, 201);
    const v2RegistrationId = v2Prepare.payload.data.registrationId;

    const v2Submit = await requestJson(
      `${app.baseUrl}/api/web3/registrations/${v2RegistrationId}/submit-local`,
      {
        method: "POST",
        body: {
          finalize: true,
          acknowledgedLocalDevelopmentSigner: true,
          expectedContentHash: v2Prepare.payload.data.contentHash,
        },
      },
    );
    assert.equal(v2Submit.response.status, 200);
    assert.match(v2Submit.payload.data.finalizeTransactionHash, /^0x[a-f0-9]{64}$/i);

    const v2Verify = await requestJson(
      `${app.baseUrl}/api/web3/registrations/${v2RegistrationId}/verify`,
      {
        method: "POST",
        body: { expectedContentHash: v2Prepare.payload.data.contentHash },
      },
    );
    assert.equal(v2Verify.response.status, 200);
    assert.equal(v2Verify.payload.data.verified, true);
    assert.equal(v2Verify.payload.data.onchain.finalized, true);

    const timeline = await requestJson(
      `${app.baseUrl}/api/projects/project-api-e2e/chain-timeline`,
    );
    assert.equal(timeline.response.status, 200);
    assert.equal(timeline.payload.data.items.length, 2);
    assert.equal(timeline.payload.data.items[1].status, "verified");
    assert.equal(timeline.payload.data.items[1].versionNumber, 2);
    assert.equal(timeline.payload.data.items[1].parentVersionId, "version-v1");
    assert.equal(timeline.payload.data.items[1].isFinal, true);
    assert.equal(timeline.payload.data.items[1].registration.finalizeRequested, true);

    const parentV1Confirm = await requestJson(
      `${app.baseUrl}/api/projects/project-parent-gate/versions/version-parent-v1/confirm`,
      { method: "POST", body: { resultId: "result-parent-v1" } },
    );
    assert.equal(parentV1Confirm.response.status, 201);
    const parentV1Prepare = await requestJson(
      `${app.baseUrl}/api/web3/registrations/prepare`,
      {
        method: "POST",
        body: {
          projectId: "project-parent-gate",
          versionId: "version-parent-v1",
        },
      },
    );
    assert.equal(parentV1Prepare.response.status, 201);
    const parentV2Confirm = await requestJson(
      `${app.baseUrl}/api/projects/project-parent-gate/versions/version-parent-v2/confirm`,
      {
        method: "POST",
        body: {
          resultId: "result-parent-v2",
          parentVersionId: "version-parent-v1",
        },
      },
    );
    assert.equal(parentV2Confirm.response.status, 201);
    const unverifiedParentPrepare = await requestJson(
      `${app.baseUrl}/api/web3/registrations/prepare`,
      {
        method: "POST",
        body: {
          projectId: "project-parent-gate",
          versionId: "version-parent-v2",
        },
      },
    );
    assert.equal(unverifiedParentPrepare.response.status, 409);
    assert.equal(
      unverifiedParentPrepare.payload.error.code,
      "PARENT_VERSION_NOT_REGISTERED",
    );

    const legacyPrepare = await requestJson(
      `${app.baseUrl}/api/web3/registrations/prepare`,
      {
        method: "POST",
        body: {
          projectId: "project-legacy",
          versionId: "version-legacy",
        },
      },
    );
    assert.equal(legacyPrepare.response.status, 409);
    assert.equal(legacyPrepare.payload.error.code, "CONFIRMATION_INTEGRITY_INVALID");

    const legacySubmit = await requestJson(
      `${app.baseUrl}/api/web3/registrations/registration-legacy/submit-local`,
      {
        method: "POST",
        body: {
          acknowledgedLocalDevelopmentSigner: true,
          expectedContentHash: legacyContentHash,
        },
      },
    );
    assert.equal(legacySubmit.response.status, 409);
    assert.equal(legacySubmit.payload.error.code, "CONFIRMATION_INTEGRITY_INVALID");
  } finally {
    await app.close();
    await chain.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("本地链未启动时 config 明确返回 NOT_CONNECTED，而 prepare fail-closed", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "gold-web3-offline-"));
  const app = await startHttpServer(directory, {
    web3RuntimePath: path.join(directory, "missing-runtime.json"),
    web3ArtifactPath: path.join(
      path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."),
      "contracts",
      "artifacts",
      "DesignRegistry.json",
    ),
    web3RpcUrl: "http://127.0.0.1:65534",
    web3ChainId: 31337,
  });
  try {
    const config = await requestJson(`${app.baseUrl}/api/web3/config`);
    assert.equal(config.response.status, 200);
    assert.equal(config.payload.data.connected, false);
    assert.equal(config.payload.data.error.code, "LOCAL_EVM_NOT_CONNECTED");

    const prepare = await requestJson(`${app.baseUrl}/api/web3/registrations/prepare`, {
      method: "POST",
      body: { projectId: "offline-project", versionId: "v1" },
    });
    assert.equal(prepare.response.status, 503);
    assert.equal(prepare.payload.error.code, "LOCAL_EVM_NOT_CONNECTED");
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
