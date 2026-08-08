import { useCallback, useEffect, useState } from "react";

export function useWallet(config, loadConfig, { showToast: _showToast, showError: _showError }) {
  const [walletAddress, setWalletAddress] = useState("");

  const restoreWallet = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      const accounts = await window.ethereum.request({ method: "eth_accounts" });
      if (accounts?.[0]) setWalletAddress(accounts[0].toLowerCase());
    } catch {
      // Wallet restoration is optional.
    }
  }, []);

  const connectWallet = useCallback(async () => {
    if (!window.ethereum)
      throw new Error(
        "当前浏览器没有检测到 MetaMask。电脑请安装 MetaMask；手机请在 MetaMask 内置浏览器中打开本页面。"
      );
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    if (!accounts?.[0]) throw new Error("没有获得钱包地址");
    const address = accounts[0].toLowerCase();
    setWalletAddress(address);
    return address;
  }, []);

  const ensureMonadNetwork = useCallback(async () => {
    const currentConfig = config || (await loadConfig());
    if (
      !currentConfig?.chain?.chainIdHex ||
      !currentConfig.chain.nativeCurrency ||
      currentConfig.chain.rpcUrls?.length === 0
    )
      throw new Error("无法读取完整的 Monad 网络配置");
    if (!window.ethereum) throw new Error("未检测到 MetaMask");
    const current = await window.ethereum.request({ method: "eth_chainId" });
    if (String(current).toLowerCase() === String(currentConfig.chain.chainIdHex).toLowerCase())
      return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: currentConfig.chain.chainIdHex }],
      });
    } catch (cause) {
      if (cause?.code !== 4902) throw cause;
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: currentConfig.chain.chainIdHex,
            chainName: currentConfig.chain.chainName,
            nativeCurrency: currentConfig.chain.nativeCurrency,
            rpcUrls: currentConfig.chain.rpcUrls,
            blockExplorerUrls: currentConfig.chain.blockExplorerUrls,
          },
        ],
      });
    }
  }, [config, loadConfig]);

  useEffect(() => {
    if (!window.ethereum) return undefined;
    const onAccountsChanged = (accounts) =>
      setWalletAddress(accounts?.[0]?.toLowerCase?.() || "");
    const onChainChanged = () => {
      loadConfig();
    };
    window.ethereum.on?.("accountsChanged", onAccountsChanged);
    window.ethereum.on?.("chainChanged", onChainChanged);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", onAccountsChanged);
      window.ethereum.removeListener?.("chainChanged", onChainChanged);
    };
  }, [loadConfig]);

  return {
    walletAddress,
    connectWallet,
    ensureMonadNetwork,
    restoreWallet,
  };
}
