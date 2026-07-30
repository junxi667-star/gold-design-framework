import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const SCRIPT_PATH = new URL("../public/js/monad-readonly-workbench.js", import.meta.url);
const LAST_SUCCESSFUL_AT = "2026-07-29T02:03:04.000Z";
const DIFFERENT_OBSERVED_AT = "2099-01-02T03:04:05.000Z";

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...values) {
    values.forEach((value) => this.values.add(value));
  }

  remove(...values) {
    values.forEach((value) => this.values.delete(value));
  }

  toggle(value, force) {
    if (force === true) {
      this.values.add(value);
      return true;
    }
    if (force === false) {
      this.values.delete(value);
      return false;
    }
    if (this.values.has(value)) {
      this.values.delete(value);
      return false;
    }
    this.values.add(value);
    return true;
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.dataset = {};
    this.classList = new FakeClassList();
    this.className = "";
    this.textContent = "";
    this.innerHTML = "";
    this.hidden = false;
    this.disabled = false;
    this.attributes = new Map();
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async dispatch(type, event = {}) {
    const listeners = this.listeners.get(type) ?? [];
    await Promise.all(listeners.map((listener) => listener({
      target: this,
      preventDefault() {},
      ...event,
    })));
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  querySelector() {
    return null;
  }
}

class FakeDocument {
  constructor() {
    this.readyState = "loading";
    this.listeners = new Map();
    this.elements = new Map();
    this.localMode = new FakeElement("mode-local");
    this.localMode.dataset.registryMode = "local";
    this.monadMode = new FakeElement("mode-monad");
    this.monadMode.dataset.registryMode = "monad";

    for (const id of [
      "registry-local-surface",
      "registry-monad-surface",
      "monad-evidence-refresh",
      "monad-evidence-state",
      "monad-source-pill",
      "monad-chain-name",
      "monad-chain-id",
      "monad-source",
      "monad-observed-block",
      "monad-observed-at",
      "monad-contract-address",
      "monad-contract-explorer",
      "monad-evidence-grid",
      "monad-v1-parent",
      "monad-v2-parent",
      "monad-final-state",
      "monad-latest-version",
      "monad-final-version",
      "monad-version-count",
      "monad-event-counts",
      "monad-checks-pill",
      "monad-boundary-copy",
      "toast",
    ]) {
      this.elements.set(`#${id}`, new FakeElement(id));
    }
    this.contractCopy = new FakeElement("contract-copy");
    this.contractCopy.dataset.monadCopy = "contract";
    this.elements.get("#registry-monad-surface").querySelector = (selector) => (
      selector === '[data-monad-copy="contract"]' ? this.contractCopy : null
    );
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  querySelector(selector) {
    return this.elements.get(selector) ?? null;
  }

  querySelectorAll(selector) {
    return selector === "[data-registry-mode]" ? [this.localMode, this.monadMode] : [];
  }

  async fireDOMContentLoaded() {
    this.readyState = "complete";
    const listeners = this.listeners.get("DOMContentLoaded") ?? [];
    await Promise.all(listeners.map((listener) => listener()));
  }
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

function cachedEvidence({ codeStatus = "PRESENT_AT_LAST_VERIFICATION" } = {}) {
  const contractAddress = `0x${"11".repeat(20)}`;
  const transactionKinds = ["DEPLOYMENT", "VERSION_V1", "VERSION_V2", "FINALIZATION"];
  return {
    mode: "monad-testnet-readonly",
    evidenceStatus: "cached",
    source: "cached-public-evidence",
    stale: true,
    observedAt: DIFFERENT_OBSERVED_AT,
    lastSuccessfulAt: LAST_SUCCESSFUL_AT,
    network: {
      chainId: 10143,
      chainName: "Monad Testnet",
      readOnly: true,
    },
    block: { number: 48_000_001 },
    contract: {
      address: contractAddress,
      codeStatus,
      explorerUrl: `https://testnet.monadscan.com/address/${contractAddress}`,
    },
    transactions: transactionKinds.map((kind, index) => {
      const transactionHash = `0x${String(index + 1).repeat(64)}`;
      return {
        kind,
        status: 1,
        blockNumber: 48_000_010 + index,
        transactionHash,
        explorerUrl: `https://testnet.monadscan.com/tx/${transactionHash}`,
      };
    }),
    versions: [
      {
        label: "V1",
        versionNumber: 1,
        parentLabel: null,
        finalized: false,
      },
      {
        label: "V2",
        versionNumber: 2,
        parentLabel: "V1",
        finalized: true,
      },
    ],
    versionCount: 2,
    latest: { versionNumber: 2, finalized: true },
    final: { versionNumber: 2, finalized: true },
    checks: {
      allChecksPass: true,
      eventCounts: { VersionRegistered: 2, VersionFinalized: 1 },
    },
    boundary: "Monad Testnet read-only evidence only.",
  };
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

async function createHarness(responses) {
  const source = await readFile(SCRIPT_PATH, "utf8");
  const document = new FakeDocument();
  const responseQueue = [...responses];
  const fetchCalls = [];
  const sandbox = {
    AbortController,
    URL,
    URLSearchParams,
    console,
    document,
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      const response = responseQueue.shift();
      if (!response) throw new Error("Unexpected fetch");
      return response;
    },
    Intl: {
      DateTimeFormat: class {
        format(date) {
          return date.toISOString();
        }
      },
    },
    navigator: {
      clipboard: { writeText: async () => {} },
    },
    window: {
      clearTimeout,
      location: { search: "" },
      setTimeout,
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  new vm.Script(source, { filename: "monad-readonly-workbench.js" }).runInContext(sandbox);
  await document.fireDOMContentLoaded();
  return { document, fetchCalls };
}

test("CACHED 使用 lastSuccessfulAt 渲染四张可信卡，503 后清空成功证据", async () => {
  const errorMessage = "Monad Testnet 公开 RPC 暂时不可用";
  const harness = await createHarness([
    jsonResponse(200, { data: cachedEvidence() }),
    jsonResponse(503, {
      error: {
        code: "MONAD_TESTNET_RPC_UNAVAILABLE",
        message: errorMessage,
      },
    }),
  ]);
  const { document, fetchCalls } = harness;
  const state = document.querySelector("#monad-evidence-state");
  const source = document.querySelector("#monad-source");
  const sourcePill = document.querySelector("#monad-source-pill");
  const observedAt = document.querySelector("#monad-observed-at");
  const grid = document.querySelector("#monad-evidence-grid");

  await document.monadMode.dispatch("click");
  await waitFor(() => sourcePill.textContent === "CACHED VERIFIED", "cached render");

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "/api/web3/monad-testnet/evidence");
  assert.equal(fetchCalls[0].options.method, "GET");
  assert.match(state.innerHTML, /CACHED VERIFIED/);
  assert.match(state.innerHTML, /历史核验证据/);
  assert.match(state.innerHTML, /不是实时状态/);
  assert.match(source.textContent, /历史核验缓存/);
  assert.equal(observedAt.textContent, LAST_SUCCESSFUL_AT);
  assert.doesNotMatch(state.innerHTML, new RegExp(DIFFERENT_OBSERVED_AT));
  assert.notEqual(observedAt.textContent, DIFFERENT_OBSERVED_AT);
  assert.doesNotMatch(state.innerHTML, /LIVE VERIFIED/);
  assert.equal((grid.innerHTML.match(/<article /g) ?? []).length, 4);
  assert.equal((grid.innerHTML.match(/SUCCESS · 1/g) ?? []).length, 4);
  assert.equal((grid.innerHTML.match(/is-cached/g) ?? []).length, 4);
  assert.equal(document.querySelector("#monad-v1-parent").textContent, "ROOT");
  assert.equal(document.querySelector("#monad-v2-parent").textContent, "V1");
  assert.equal(document.querySelector("#monad-final-state").textContent, "V2 · finalized=true");
  assert.equal(document.querySelector("#monad-checks-pill").textContent, "ALL CHECKS PASS");

  await document.querySelector("#monad-evidence-refresh").dispatch("click");
  await waitFor(() => sourcePill.textContent === "ERROR", "503 error render");

  assert.equal(fetchCalls.length, 2);
  assert.match(state.innerHTML, /ERROR · MONAD_TESTNET_RPC_UNAVAILABLE/);
  assert.match(state.innerHTML, new RegExp(errorMessage));
  assert.doesNotMatch(state.innerHTML, /LIVE VERIFIED|CACHED VERIFIED/);
  assert.doesNotMatch(grid.innerHTML, /SUCCESS · 1|LIVE VERIFIED|CACHED VERIFIED/);
  assert.equal((grid.innerHTML.match(/<article /g) ?? []).length, 4);
  assert.equal((grid.innerHTML.match(/is-error/g) ?? []).length, 4);
  assert.equal(document.querySelector("#monad-v1-parent").textContent, "等待证据");
  assert.equal(document.querySelector("#monad-v2-parent").textContent, "等待证据");
  assert.equal(document.querySelector("#monad-final-state").textContent, "等待证据");
  assert.equal(document.querySelector("#monad-latest-version").textContent, "—");
  assert.equal(document.querySelector("#monad-final-version").textContent, "—");
  assert.equal(document.querySelector("#monad-version-count").textContent, "—");
  assert.equal(document.querySelector("#monad-checks-pill").textContent, "CHECKS NOT PROVEN");
  assert.equal(document.contractCopy.disabled, true);
  assert.equal(document.contractCopy.dataset.copyValue, undefined);
});

test("CACHED 携带实时 PRESENT 合约状态时拒绝并进入 ERROR", async () => {
  const harness = await createHarness([
    jsonResponse(200, { data: cachedEvidence({ codeStatus: "PRESENT" }) }),
  ]);
  const { document } = harness;
  const state = document.querySelector("#monad-evidence-state");
  const sourcePill = document.querySelector("#monad-source-pill");
  const grid = document.querySelector("#monad-evidence-grid");

  await document.monadMode.dispatch("click");
  await waitFor(() => sourcePill.textContent === "ERROR", "invalid cached error render");

  assert.match(state.innerHTML, /ERROR · CONTRACT_EVIDENCE_INCOMPLETE/);
  assert.doesNotMatch(state.innerHTML, /CACHED VERIFIED|LIVE VERIFIED/);
  assert.doesNotMatch(grid.innerHTML, /SUCCESS · 1|CACHED VERIFIED|LIVE VERIFIED/);
  assert.equal(document.querySelector("#monad-v1-parent").textContent, "等待证据");
  assert.equal(document.querySelector("#monad-v2-parent").textContent, "等待证据");
  assert.equal(document.querySelector("#monad-checks-pill").textContent, "CHECKS NOT PROVEN");
});
