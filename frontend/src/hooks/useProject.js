import { useCallback, useRef, useState } from "react";

import { request } from "../lib/api.js";

function progressToStep(progress, message = "") {
  const lower = String(message).toLowerCase();
  if (lower.includes("保存") || lower.includes("上传") || lower.includes("完成")) return 4;
  if (lower.includes("worker") || lower.includes("生成") || lower.includes("seedream") || lower.includes("图片")) return 3;
  if (lower.includes("prompt") || lower.includes("提示词")) return 2;
  if (lower.includes("解析") || lower.includes("理解") || lower.includes("创建")) return 1;
  if (progress >= 96) return 5;
  if (progress >= 78) return 4;
  if (progress >= 32) return 3;
  return progress >= 16 ? 2 : 1;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function useProject(accessCode, { showToast, showError }) {
  const [projectId, setProjectId] = useState(
    () => localStorage.getItem("jewelchain-project-id") || ""
  );
  const [timeline, setTimeline] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isRevising, setIsRevising] = useState(false);
  const [progress, setProgress] = useState(null);
  const [changeRequest, setChangeRequest] = useState("");
  const projectIdRef = useRef(projectId);

  const api = useCallback(
    (path, options = {}) => request(path, { accessCode: accessCode.trim(), ...options }),
    [accessCode]
  );

  const setJobProgress = useCallback(
    (value, message) =>
      setProgress({
        value: Math.max(0, Math.min(100, Number(value) || 0)),
        message: message || "处理中",
        step: progressToStep(value, message),
      }),
    []
  );

  const pollJob = useCallback(
    async (jobId) => {
      const started = Date.now();
      let failures = 0;
      while (Date.now() - started < 75_000) {
        try {
          const job = await api(`/api/hackathon/jobs/${encodeURIComponent(jobId)}`);
          failures = 0;
          setJobProgress(job.progress, job.currentStep);
          if (job.status === "succeeded") {
            setJobProgress(100, "设计版本已生成并保存");
            return job;
          }
          if (job.status === "failed") throw new Error(job.error?.message || "图片生成失败");
        } catch (error) {
          console.warn("pollJob attempt failed:", error);
          failures += 1;
          await delay(Math.min(10_000, 1500 * 2 ** (failures - 1)));
          continue;
        }
        await delay(1500);
      }
      const job = await api(`/api/hackathon/jobs/${encodeURIComponent(jobId)}`);
      setJobProgress(
        Math.max(30, Number(job.progress || 0)),
        "任务已保存在 Master 队列；Image Worker 上线后会自动领取并继续执行"
      );
      return { ...job, deferredToWorker: true };
    },
    [api, setJobProgress]
  );

  const refreshTimeline = useCallback(
    async (requestedProjectId = projectIdRef.current) => {
      if (!requestedProjectId) return null;
      try {
        const nextTimeline = await api(
          `/api/hackathon/designs/${encodeURIComponent(requestedProjectId)}/timeline`
        );
        if (projectIdRef.current === requestedProjectId) setTimeline(nextTimeline);
        return nextTimeline;
      } catch (cause) {
        if (cause.code === "PROJECT_NOT_FOUND" && projectIdRef.current === requestedProjectId) {
          localStorage.removeItem("jewelchain-project-id");
          setProjectId("");
          setTimeline(null);
          return null;
        }
        showError(cause);
        return null;
      }
    },
    [api, showError]
  );

  const createDesign = useCallback(
    async (customerText, isMasterOnline) => {
      if (!isMasterOnline) {
        showError(new Error("Master（调度服务）暂时离线。网站仍可浏览，服务恢复后再提交生图任务。"));
        return;
      }
      if (customerText.trim().length < 6) {
        showError(new Error("请输入更详细的需求描述，至少包含一句完整描述"));
        return;
      }
      setIsCreating(true);
      setJobProgress(3, "正在创建设计项目");
      try {
        const result = await api("/api/hackathon/designs", {
          method: "POST",
          body: { customerText: customerText.trim() },
        });
        projectIdRef.current = result.projectId;
        setProjectId(result.projectId);
        localStorage.setItem("jewelchain-project-id", result.projectId);
        const job = await pollJob(result.jobId);
        await refreshTimeline(result.projectId);
        showToast(
          job.deferredToWorker
            ? "任务已进入 Master 队列，Image Worker 上线后会自动领取"
            : "V1 已生成，请连接钱包并登记到 Monad"
        );
      } catch (cause) {
        showError(cause);
      } finally {
        setIsCreating(false);
      }
    },
    [api, pollJob, refreshTimeline, setJobProgress, showError, showToast]
  );

  const reviseDesign = useCallback(
    async (isMasterOnline) => {
      if (!isMasterOnline) {
        showError(new Error("Master（调度服务）暂时离线，暂时无法创建新版本。"));
        return;
      }
      if (!projectId || !timeline) {
        showError(new Error("请先创建 V1"));
        return;
      }
      if (changeRequest.trim().length < 2) {
        showError(new Error("请填写修改要求"));
        return;
      }
      const parent = [...(timeline.versions || [])]
        .reverse()
        .find((item) => ["chain_confirmed", "finalized"].includes(item.status));
      if (!parent) {
        showError(new Error("请先登记当前版本。登记后，系统才能将它记录为下一版的来源。"));
        return;
      }
      setIsRevising(true);
      setJobProgress(3, "正在创建修改任务");
      try {
        const result = await api(
          `/api/hackathon/designs/${encodeURIComponent(projectId)}/revisions`,
          {
            method: "POST",
            body: { parentVersionId: parent.id, changeRequest: changeRequest.trim() },
          }
        );
        const job = await pollJob(result.jobId);
        setChangeRequest("");
        await refreshTimeline(projectId);
        showToast(
          job.deferredToWorker
            ? `V${result.versionNumber} 已排队，Worker 上线后自动生成`
            : `V${result.versionNumber} 已生成`
        );
      } catch (cause) {
        showError(cause);
      } finally {
        setIsRevising(false);
      }
    },
    [api, changeRequest, pollJob, projectId, refreshTimeline, setJobProgress, showError, showToast, timeline]
  );

  const resetProject = useCallback(() => {
    localStorage.removeItem("jewelchain-project-id");
    projectIdRef.current = "";
    setProjectId("");
    setTimeline(null);
    setProgress(null);
    setChangeRequest("");
  }, []);

  return {
    projectId,
    projectIdRef,
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
    setJobProgress,
  };
}
