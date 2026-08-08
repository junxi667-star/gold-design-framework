import { useCallback, useEffect, useMemo, useState } from "react";
import { lazy, Suspense } from "react";

import { AppShell } from "./components/AppShell.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { useProject } from "./hooks/useProject.js";
import { useWallet } from "./hooks/useWallet.js";
import { useServiceStatus } from "./hooks/useServiceStatus.js";
import { useToast } from "./hooks/useToast.js";
import { useEntranceAnimations, useParticles } from "./hooks/useAnimations.js";
import {
  scrollToSection,
  getImageStatus,
  getStorageStatus,
  getChainStatus,
} from "./lib/utils.js";

const Workspace = lazy(() => import("./components/Workspace.jsx"));
const ImageDialog = lazy(() =>
  import("./components/Workspace.jsx").then((m) => ({ default: m.ImageDialog }))
);

const EXAMPLE =
  "设计一款适合年轻女性日常佩戴的新中式黄金戒指，使用简化祥云元素，造型轻盈，不要太复杂。";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export default function App() {
  const [accessCode, setAccessCode] = useState(
    () => sessionStorage.getItem("jewelchain-access-code") || ""
  );
  const [customerText, setCustomerText] = useState("");
  const [agentQuestion, setAgentQuestion] = useState("");
  const [agentAnswer, setAgentAnswer] = useState(null);
  const [modalImage, setModalImage] = useState(null);
  const [isMobilePrimaryVisible, setIsMobilePrimaryVisible] = useState(false);

  const { toast, error, setError, showToast, showError } = useToast();
  const { config, isMasterOnline, isStatusBusy, loadConfig } = useServiceStatus(accessCode);
  const {
    projectId,
    timeline,
    isCreating,
    isRevising,
    progress,
    changeRequest,
    setChangeRequest,
    api,
    refreshTimeline,
    createDesign,
    reviseDesign,
    resetProject,
  } = useProject(accessCode, { showToast, showError });
  const { walletAddress, connectWallet, ensureMonadNetwork, restoreWallet } = useWallet(
    config,
    loadConfig,
    { showToast, showError }
  );

  useEntranceAnimations();
  useParticles();

  useEffect(() => {
    sessionStorage.setItem("jewelchain-access-code", accessCode);
  }, [accessCode]);

  useEffect(() => {
    const updateMobilePrimary = () =>
      setIsMobilePrimaryVisible(window.innerWidth <= 640 && window.scrollY > 520 && !timeline);
    updateMobilePrimary();
    window.addEventListener("resize", updateMobilePrimary, { passive: true });
    window.addEventListener("scroll", updateMobilePrimary, { passive: true });
    return () => {
      window.removeEventListener("resize", updateMobilePrimary);
      window.removeEventListener("scroll", updateMobilePrimary);
    };
  }, [timeline]);

  useEffect(() => {
    loadConfig().then(() => restoreWallet());
  }, [loadConfig, restoreWallet]);

  useEffect(() => {
    if (projectId && isMasterOnline) refreshTimeline(projectId);
  }, [isMasterOnline, projectId, refreshTimeline]);

  const pollChain = useCallback(
    async (versionId, kind) => {
      const started = Date.now();
      let failures = 0;
      while (Date.now() - started < 120_000) {
        try {
          const status = await api(
            `/api/hackathon/versions/${encodeURIComponent(versionId)}/chain-status?kind=${kind}`
          );
          failures = 0;
          if (status.status === "confirmed") {
            showToast(
              kind === "finalize"
                ? "最终版本已在 Monad 确认"
                : "设计版本已登记到 Monad"
            );
            await refreshTimeline();
            return status;
          }
          if (status.status === "failed")
            throw new Error(status.errorMessage || "Monad 交易失败");
        } catch (error) {
          console.warn("pollChain attempt failed:", error);
          failures += 1;
          await delay(Math.min(10_000, 1600 * 2 ** (failures - 1)));
          continue;
        }
        await delay(1600);
      }
      throw new Error("交易已提交，但等待链上确认超时。稍后点击刷新可继续检查。");
    },
    [api, refreshTimeline, showToast]
  );

  const sendPreparedTransaction = useCallback(
    async (versionId, kind) => {
      setError("");
      const wallet = walletAddress || (await connectWallet());
      await ensureMonadNetwork();
      const preparePath =
        kind === "finalize" ? "prepare-finalize" : "prepare-registration";
      showToast(
        kind === "finalize"
          ? "正在准备最终确认交易"
          : "Agent 正在保存版本并计算 Hash"
      );
      const prepared = await api(
        `/api/hackathon/versions/${encodeURIComponent(versionId)}/${preparePath}`,
        { method: "POST", body: { walletAddress: wallet } }
      );
      if (prepared.alreadyConfirmed || prepared.alreadyFinalized) {
        await refreshTimeline();
        return;
      }
      const txHash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [{ ...prepared.transaction, from: wallet }],
      });
      await api(
        `/api/hackathon/versions/${encodeURIComponent(versionId)}/chain-submission`,
        { method: "POST", body: { txHash, walletAddress: wallet, kind } }
      );
      showToast("交易已提交，正在等待 Monad 确认");
      await pollChain(versionId, kind);
    },
    [
      api,
      connectWallet,
      ensureMonadNetwork,
      pollChain,
      refreshTimeline,
      showToast,
      walletAddress,
      setError,
    ]
  );

  const downloadCertificate = useCallback(async () => {
    if (!projectId) return;
    const certificate = await api(
      `/api/hackathon/designs/${encodeURIComponent(projectId)}/certificate`
    );
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(certificate, null, 2)], { type: "application/json" })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${certificate.project.localDesignId}_certificate.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast("最终确认凭证已下载");
  }, [api, projectId, showToast]);

  const onTimelineAction = useCallback(
    async (versionId, action) => {
      try {
        if (versionId === "certificate" && action === "download") {
          await downloadCertificate();
          return;
        }
        if (action === "check-register") {
          await pollChain(versionId, "register");
          return;
        }
        await sendPreparedTransaction(versionId, action);
      } catch (cause) {
        showError(cause);
      }
    },
    [downloadCertificate, pollChain, sendPreparedTransaction, showError]
  );

  const askAgent = useCallback(
    async (question) => {
      if (!isMasterOnline) {
        setAgentAnswer({
          answer:
            "Master（调度服务）暂时离线。网站介绍与动画效果仍可浏览，Agent 问答将在服务恢复后可用。",
          evidence: [],
        });
        return;
      }
      if (!projectId) {
        showError(new Error("请先创建设计项目"));
        return;
      }
      const query = String(question || "").trim();
      if (!query) return;
      setAgentAnswer({
        answer: "Agent 正在查询版本记录与链上交易证据…",
        evidence: [],
      });
      try {
        setAgentAnswer(
          await api("/api/hackathon/agent/query", {
            method: "POST",
            body: { projectId, question: query },
          })
        );
      } catch (cause) {
        setAgentAnswer({ answer: cause.message, evidence: [] });
      }
    },
    [api, isMasterOnline, projectId, showError]
  );

  const copyText = useCallback(
    async (value, successMessage = "已复制") => {
      const text = String(value || "");
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const area = document.createElement("textarea");
        area.value = text;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.append(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      showToast(successMessage);
    },
    [showToast]
  );

  const handleNavigate = useCallback((event, targetId) => {
    event.preventDefault();
    window.history.replaceState(null, "", targetId);
    scrollToSection(targetId);
  }, []);

  const handleResetProject = useCallback(
    (shouldScroll = true) => {
      resetProject();
      setAgentAnswer(null);
      setError("");
      if (shouldScroll) scrollToSection("#create");
    },
    [resetProject, setError]
  );

  const presentationStatus = useMemo(
    () => ({
      image: getImageStatus(config, isMasterOnline),
      storage: getStorageStatus(config, isMasterOnline),
      chain: getChainStatus(isMasterOnline),
      accessCodeRequired: Boolean(config?.demoAccessCodeRequired),
      error,
      isCreating,
      progress,
    }),
    [config, error, isCreating, isMasterOnline, progress]
  );

  const serviceStatus = useMemo(() => {
    if (!isMasterOnline)
      return { ready: false, label: "Master（调度服务）暂时离线" };
    const workerMode = config?.generation?.mode === "worker";
    const workers = Number(
      config?.workerStatus?.onlineWorkers || config?.generation?.worker?.onlineWorkers || 0
    );
    const directConfigured = Boolean(
      config?.generation?.directProvider?.configured || config?.imageProvider?.configured
    );
    const ready = workerMode
      ? workers > 0
      : config?.generation?.mode === "hybrid"
        ? workers > 0 || directConfigured
        : directConfigured;
    return {
      ready,
      label: ready
        ? "调度服务与生图端已就绪"
        : workerMode
          ? "调度服务在线，等待生图端"
          : "调度服务在线，生图配置待检查",
    };
  }, [config, isMasterOnline]);

  const handleRefreshStatus = useCallback(
    () =>
      loadConfig().then((nextConfig) =>
        showToast(nextConfig ? "Master 已连接" : "Master 仍未上线", !nextConfig)
      ),
    [loadConfig, showToast]
  );

  const handleRetryMaster = useCallback(
    () =>
      loadConfig().then((nextConfig) => {
        if (nextConfig) {
          showToast("Master 已恢复连接");
          if (projectId) refreshTimeline(projectId);
        } else showToast("Master 仍未上线，稍后再试", true);
      }),
    [loadConfig, projectId, refreshTimeline, showToast]
  );

  return (
    <ErrorBoundary>
      <AppShell
        accessCode={accessCode}
        customerText={customerText}
        isMasterOnline={isMasterOnline}
        isStatusBusy={isStatusBusy}
        onAccessCodeChange={setAccessCode}
        onConnectWallet={() => connectWallet().catch(showError)}
        onCreateDesign={() => createDesign(customerText, isMasterOnline)}
        onCustomerTextChange={setCustomerText}
        onFillExample={() => setCustomerText(EXAMPLE)}
        onNavigate={handleNavigate}
        onRefreshStatus={handleRefreshStatus}
        onRetryMaster={handleRetryMaster}
        onScrollToCreate={() => scrollToSection("#create")}
        onScrollToFlow={() => scrollToSection("#flowGuide")}
        serviceStatus={serviceStatus}
        status={presentationStatus}
        walletAddress={walletAddress}
      >
        <Suspense
          fallback={
            <div className="panel" style={{ padding: 30, textAlign: "center" }}>
              加载中…
            </div>
          }
        >
          <Workspace
            agentAnswer={agentAnswer}
            agentQuestion={agentQuestion}
            changeRequest={changeRequest}
            isMasterOnline={isMasterOnline}
            isRevising={isRevising}
            onAction={onTimelineAction}
            onAgentQuestionChange={setAgentQuestion}
            onAskAgent={askAgent}
            onCopy={copyText}
            onCopyProjectLink={() => copyText(window.location.href, "演示链接已复制")}
            onNewProject={() => handleResetProject(true)}
            onPreview={(src, caption) => setModalImage({ src, caption })}
            onRefreshTimeline={() => refreshTimeline()}
            onRevise={() => reviseDesign(isMasterOnline)}
            onSetChangeRequest={setChangeRequest}
            onStartCreate={() => scrollToSection("#create")}
            timeline={timeline}
          />
        </Suspense>
      </AppShell>
      {toast && (
        <div
          className={`toast${toast.isError ? " error" : ""}`}
          role="status"
          aria-live="polite"
        >
          {toast.message}
        </div>
      )}
      <Suspense fallback={null}>
        <ImageDialog image={modalImage} onClose={() => setModalImage(null)} />
      </Suspense>
      <button
        className={`mobile-primary${isMobilePrimaryVisible ? " is-visible" : ""}${timeline ? " hidden-by-workspace" : ""}`}
        type="button"
        onClick={() => scrollToSection("#create")}
      >
        开始创建设计
      </button>
    </ErrorBoundary>
  );
}
