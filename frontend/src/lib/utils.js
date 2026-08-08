export function scrollToSection(targetId) {
  const target = document.querySelector(targetId);
  if (!target) return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({
    behavior: reducedMotion ? "auto" : "smooth",
    block: targetId === "#flowGuide" ? "center" : "start",
  });
}

export function getImageStatus(config, isMasterOnline) {
  if (!isMasterOnline) return "等待调度服务 / 生图端";

  const generation = config?.generation || {};
  const workerMode = generation.mode === "worker";
  const onlineWorkers = Number(
    config?.workerStatus?.onlineWorkers || generation.worker?.onlineWorkers || 0
  );
  const directConfigured = Boolean(
    generation.directProvider?.configured || config?.imageProvider?.configured
  );

  if (workerMode) {
    return onlineWorkers > 0 ? `生图端在线（${onlineWorkers}）` : "等待生图端上线";
  }

  if (generation.mode === "hybrid") {
    if (onlineWorkers > 0) return `生图端优先（${onlineWorkers} 在线）`;
    return directConfigured ? "Master API 直接调用（备用）" : "生图端未配置";
  }

  if (directConfigured) {
    const model = generation.directProvider?.model || config?.imageProvider?.model || "图片模型";
    return `${model} 已配置`;
  }

  return "未配置 API Key";
}

export function getStorageStatus(config, isMasterOnline) {
  if (!isMasterOnline) return "调度服务离线";
  return config?.storage?.effectiveMode === "supabase" ? "Supabase 云端存储" : "本地安全存储";
}

export function getChainStatus(isMasterOnline) {
  return isMasterOnline ? "Monad 合约可访问" : "实时检查暂停";
}
