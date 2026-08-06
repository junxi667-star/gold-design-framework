import {
  ZERO_HASH,
  encodeConfirmVersion,
  encodeRegisterVersion,
  normalizeAddress,
  normalizeBytes32,
  parseRegistryReceipt,
} from "./evm-codec.js";
import {
  createAppError,
  CHAIN_ERROR,
  INVALID_TX_HASH,
  WALLET_MISMATCH,
  RPC_UNAVAILABLE,
  RPC_REQUEST_FAILED,
  RPC_TIMEOUT,
  RPC_CONNECT_FAILED,
  CHAIN_STATUS_FAILED,
  TRANSACTION_REVERTED,
  WRONG_CONTRACT,
  EXPECTED_EVENT_NOT_FOUND,
} from "./error-codes.js";

function chainError(message, { code = CHAIN_ERROR, httpStatus, retryable, details } = {}) {
  return createAppError(code, { message, httpStatus, retryable, details });
}

function hexQuantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

export class MonadChainService {
  constructor({ fetchImpl = globalThis.fetch } = {}) {
    this.fetchImpl = fetchImpl;
    this.chainId = Number(process.env.MONAD_CHAIN_ID || 10143);
    this.rpcUrl = String(process.env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz").trim();
    this.explorerUrl = String(process.env.MONAD_EXPLORER_URL || "https://testnet.monadvision.com").replace(/\/+$/, "");
    this.contractAddress = normalizeAddress(process.env.DESIGN_REGISTRY_ADDRESS || "0x017BA6A7b6d90387bc588ad6FccDf2e0FD16D8b7");
    this.requestId = 1;
  }

  config() {
    return {
      chainId: this.chainId,
      chainIdHex: hexQuantity(this.chainId),
      chainName: this.chainId === 10143 ? "Monad Testnet" : "Monad",
      nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
      rpcUrls: [this.rpcUrl],
      blockExplorerUrls: [this.explorerUrl],
      contractAddress: this.contractAddress,
    };
  }

  async rpc(method, params = []) {
    if (!this.fetchImpl) throw chainError("当前环境不支持网络请求", { code: RPC_UNAVAILABLE });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await this.fetchImpl(this.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: this.requestId++, method, params }),
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok || payload.error) {
        throw chainError(payload?.error?.message || `Monad RPC 请求失败（HTTP ${response.status}）`, {
          code: RPC_REQUEST_FAILED,
          details: { method, status: response.status, rpcCode: payload?.error?.code || null },
        });
      }
      return payload.result;
    } catch (error) {
      if (error?.name === "AbortError") throw chainError("Monad RPC 请求超时", { code: RPC_TIMEOUT });
      if (error?.httpStatus) throw error;
      throw chainError("无法连接 Monad RPC", { code: RPC_CONNECT_FAILED, details: { cause: error?.message || String(error) } });
    } finally {
      clearTimeout(timeout);
    }
  }

  async status() {
    try {
      const [chainIdHex, code] = await Promise.all([
        this.rpc("eth_chainId"),
        this.rpc("eth_getCode", [this.contractAddress, "latest"]),
      ]);
      const actualChainId = Number(BigInt(chainIdHex));
      return {
        configured: true,
        reachable: actualChainId === this.chainId,
        expectedChainId: this.chainId,
        actualChainId,
        contractAddress: this.contractAddress,
        contractCodePresent: typeof code === "string" && code !== "0x",
        explorerUrl: this.explorerUrl,
      };
    } catch (error) {
      return {
        configured: true,
        reachable: false,
        expectedChainId: this.chainId,
        contractAddress: this.contractAddress,
        contractCodePresent: false,
        error: { code: error.code || CHAIN_STATUS_FAILED, message: error.message },
      };
    }
  }

  prepareRegister({ designId, contentHash, parentContentHash = ZERO_HASH, metadataUri }) {
    const normalizedDesignId = normalizeBytes32(designId, "designId");
    const normalizedContentHash = normalizeBytes32(contentHash, "contentHash");
    const normalizedParent = normalizeBytes32(parentContentHash, "parentContentHash");
    return {
      kind: "register",
      chain: this.config(),
      transaction: {
        to: this.contractAddress,
        value: "0x0",
        data: encodeRegisterVersion({
          designId: normalizedDesignId,
          contentHash: normalizedContentHash,
          parentContentHash: normalizedParent,
          metadataUri,
        }),
      },
      expected: {
        designId: normalizedDesignId,
        contentHash: normalizedContentHash,
        parentContentHash: normalizedParent,
        metadataUri,
      },
    };
  }

  prepareFinalize({ designId, contentHash }) {
    const normalizedDesignId = normalizeBytes32(designId, "designId");
    const normalizedContentHash = normalizeBytes32(contentHash, "contentHash");
    return {
      kind: "finalize",
      chain: this.config(),
      transaction: {
        to: this.contractAddress,
        value: "0x0",
        data: encodeConfirmVersion({ designId: normalizedDesignId, contentHash: normalizedContentHash }),
      },
      expected: { designId: normalizedDesignId, contentHash: normalizedContentHash },
    };
  }

  async verifyTransaction({ txHash, walletAddress, kind, expected }) {
    if (!/^0x[0-9a-f]{64}$/i.test(txHash)) {
      throw chainError("txHash 格式无效", { code: INVALID_TX_HASH, httpStatus: 400, retryable: false });
    }
    const [transaction, receipt] = await Promise.all([
      this.rpc("eth_getTransactionByHash", [txHash]),
      this.rpc("eth_getTransactionReceipt", [txHash]),
    ]);
    if (!transaction || !receipt) return { status: "pending", txHash };
    if (String(receipt.status).toLowerCase() !== "0x1") {
      return { status: "failed", txHash, errorCode: TRANSACTION_REVERTED, errorMessage: "Monad 交易执行失败" };
    }
    if (normalizeAddress(transaction.to) !== this.contractAddress) {
      return { status: "failed", txHash, errorCode: WRONG_CONTRACT, errorMessage: "交易目标不是当前 Design Registry 合约" };
    }
    if (normalizeAddress(transaction.from) !== normalizeAddress(walletAddress)) {
      return { status: "failed", txHash, errorCode: WALLET_MISMATCH, errorMessage: "交易发送钱包与提交记录不一致" };
    }
    const event = parseRegistryReceipt(receipt, {
      contractAddress: this.contractAddress,
      expectedDesignId: expected.designId,
      expectedContentHash: expected.contentHash,
      expectedParentContentHash: expected.parentContentHash || ZERO_HASH,
      kind,
    });
    if (!event) {
      return { status: "failed", txHash, errorCode: EXPECTED_EVENT_NOT_FOUND, errorMessage: "交易成功，但没有找到匹配的版本登记事件" };
    }
    return {
      status: "confirmed",
      txHash,
      blockNumber: Number(BigInt(receipt.blockNumber)),
      event,
      explorerUrl: `${this.explorerUrl}/tx/${txHash}`,
    };
  }
}
