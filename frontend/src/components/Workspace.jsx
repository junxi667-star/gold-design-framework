import { memo, useEffect, useRef, useState } from "react";

import { RefreshIcon, CopyIcon } from "./Icons.jsx";
import { resolveAssetUrl } from "../lib/api.js";

function short(value, left = 8, right = 6) {
  const raw = String(value || "");
  return raw.length > left + right + 3
    ? `${raw.slice(0, left)}…${raw.slice(-right)}`
    : raw;
}

function statusLabel(status) {
  return (
    {
      generating: "正在生成",
      generation_failed: "生成失败",
      awaiting_confirmation: "等待您确认设计",
      awaiting_wallet_signature: "等待钱包签名",
      tx_submitted: "交易已提交，等待链上确认",
      chain_confirmed: "已登记到 Monad",
      registration_failed: "登记失败",
      finalized: "最终版已确认",
    }[status] || status || "未知"
  );
}

function stateClass(status) {
  if (["chain_confirmed", "finalized"].includes(status)) return status;
  return ["generation_failed", "registration_failed"].includes(status) ? "failed" : "";
}

function isHttpUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value, window.location.href);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

const VersionCard = memo(function VersionCard({ onAction, onCopy, onPreview, version }) {
  const requirement = version.structuredRequirement || {};
  const records = version.chainRecords || [];
  const registerRecord = records.find((item) => item.kind === "register");
  const finalRecord = records.find((item) => item.kind === "finalize");
  const explorer = finalRecord?.explorerUrl || registerRecord?.explorerUrl;
  const transactionHash = registerRecord?.txHash || version.txHash || "";
  const imageUrl = resolveAssetUrl(version.imageUrl || "");
  const canRegister = [
    "awaiting_confirmation",
    "awaiting_wallet_signature",
    "registration_failed",
  ].includes(version.status);

  return (
    <article className="version-card" data-version-number={version.versionNumber}>
      <button
        className="version-media"
        type="button"
        onClick={() =>
          onPreview(
            imageUrl,
            `V${version.versionNumber} · ${version.changeRequest || "初始设计版本"}`
          )
        }
      >
        <img
          className="version-image"
          src={imageUrl}
          alt={`V${version.versionNumber} 珠宝设计效果图`}
          loading="lazy"
        />
      </button>
      <div className="version-body">
        <div className="version-top">
          <div className="version-title">
            <span className="version-number">V{version.versionNumber}</span>
            <div>
              <h3>{version.versionNumber === 1 ? "初始设计" : "迭代设计"}</h3>
              <span className="muted">
                {version.changeRequest || "AI 根据客户需求生成"}
              </span>
            </div>
          </div>
          <span className={`version-state ${stateClass(version.status)}`}>
            {statusLabel(version.status)}
          </span>
        </div>
        <p className="version-description">
          {version.understandingSummary ||
            `${requirement.style || ""}${requirement.productType || "珠宝设计"}`}
        </p>
        <div className="version-fields">
          <div>
            <span>产品 / 形状</span>
            <b>
              {requirement.productType || "-"} ·{" "}
              {requirement.shape || requirement.structureForms?.[0] || "-"}
            </b>
          </div>
          <div>
            <span>风格 / 元素</span>
            <b>
              {requirement.style || "-"} ·{" "}
              {(requirement.motifs || []).join("、") || "-"}
            </b>
          </div>
          <HashField
            label="内容指纹 (contentHash)"
            value={version.contentHash}
            fallback="尚未生成"
            onCopy={onCopy}
          />
          <HashField
            label="上一版指纹"
            value={version.parentContentHash}
            fallback="首版无上一版本"
            onCopy={onCopy}
          />
          <HashField
            label="交易哈希"
            value={transactionHash}
            fallback="尚未提交"
            onCopy={onCopy}
          />
          <div>
            <span>链下存储</span>
            <b>{version.storageMode || "尚未存储"}</b>
          </div>
        </div>
        <div className="version-actions">
          {canRegister && (
            <button
              className="button primary"
              type="button"
              onClick={() => onAction(version.id, "register")}
            >
              登记 V{version.versionNumber} 到 Monad
            </button>
          )}
          {version.status === "tx_submitted" && (
            <button
              className="button secondary"
              type="button"
              onClick={() => onAction(version.id, "check-register")}
            >
              检查登记状态
            </button>
          )}
          {version.status === "chain_confirmed" && (
            <button
              className="button secondary"
              type="button"
              onClick={() => onAction(version.id, "finalize")}
            >
              确认为最终版
            </button>
          )}
          {isHttpUrl(explorer) && (
            <a className="button glass" href={explorer} target="_blank" rel="noreferrer">
              在 Explorer 查看
            </a>
          )}
          {version.metadataUri && (
            <a
              className="button glass"
              href={resolveAssetUrl(version.metadataUri)}
              target="_blank"
              rel="noreferrer"
            >
              查看版本信息
            </a>
          )}
        </div>
        {version.storageWarning && (
          <div className="version-warning">{version.storageWarning}</div>
        )}
      </div>
    </article>
  );
});

function HashField({ fallback, label, onCopy, value }) {
  const raw = value || "";
  return (
    <div>
      <span>{label}</span>
      <div className="hash-row">
        <code title={raw}>{short(raw || fallback)}</code>
        {raw && (
          <button
            className="copy-mini"
            type="button"
            onClick={() => onCopy(raw, "内容已复制")}
            title={`复制${label}`}
            aria-label={`复制${label}`}
          >
            <CopyIcon />
          </button>
        )}
      </div>
    </div>
  );
}

function VersionComparison({ versions }) {
  const compareRef = useRef(null);
  const usable = versions.filter((item) => item.imageUrl);
  const first = usable[0];
  const latest = usable.at(-1);
  const [position, setPosition] = useComparisonPosition(compareRef, usable.length >= 2);

  if (usable.length < 2) return null;
  return (
    <div className="compare-section">
      <div className="compare-head">
        <div>
          <h3>版本视觉对比</h3>
          <p>拖动滑杆，直观看到最新版本相对首版的变化。</p>
        </div>
        <div className="compare-legend">
          <span>V{first.versionNumber} 初始</span>
          <span>V{latest.versionNumber} 最新</span>
        </div>
      </div>
      <div className="compare-view" ref={compareRef}>
        <img
          className="compare-image"
          src={resolveAssetUrl(latest.imageUrl)}
          alt="较早版本设计"
        />
        <div className="compare-overlay" style={{ width: `${position}%` }}>
          <img
            className="compare-image"
            src={resolveAssetUrl(first.imageUrl)}
            alt="较新版本设计"
          />
        </div>
        <div className="compare-divider" style={{ left: `${position}%` }}>
          <span>↔</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={position}
          onChange={(event) => setPosition(Number(event.target.value))}
          aria-label="调整版本对比位置"
        />
      </div>
    </div>
  );
}

function useComparisonPosition(compareRef, enabled) {
  const [position, setPosition] = useStateWithReset(50, enabled);
  useEffect(() => {
    if (!enabled || !compareRef.current) return undefined;
    const sync = () => {
      const image = compareRef.current.querySelector(
        ".compare-overlay .compare-image"
      );
      if (image) image.style.width = `${compareRef.current.clientWidth}px`;
    };
    sync();
    window.addEventListener("resize", sync, { passive: true });
    return () => window.removeEventListener("resize", sync);
  }, [compareRef, enabled]);
  return [position, setPosition];
}

function useStateWithReset(initialValue, resetKey) {
  const [value, setValue] = useState(initialValue);
  useEffect(() => setValue(initialValue), [initialValue, resetKey]);
  return [value, setValue];
}

function EmptyWorkspace({ isMasterOnline, onStartCreate }) {
  return (
    <section className="workspace workspace-empty" aria-label="版本档案与 Agent 验证">
      <section id="versions" className="panel empty-workspace-panel reveal">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">VERSION ARCHIVE</span>
            <h2>设计版本档案</h2>
            <p>
              创建第一版设计后，这里会按时间线保留每次修改、内容指纹和 Monad 登记记录。
            </p>
          </div>
          <span className="step-pill">Step 02</span>
        </div>
        <div className="empty-workspace-actions">
          <span>尚未创建设计版本</span>
          <button className="button primary" type="button" onClick={onStartCreate}>
            前往创建设计
          </button>
        </div>
      </section>
      <section id="agent" className="panel empty-workspace-panel reveal">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">ON-CHAIN AGENT</span>
            <h2>链上证据问答</h2>
            <p>
              {isMasterOnline
                ? "项目创建后，Agent 会基于版本关系与链上交易证据回答问题。"
                : "调度服务恢复并创建项目后，Agent 会基于版本关系与链上交易证据回答问题。"}
            </p>
          </div>
          <span className="agent-orb" aria-hidden="true" />
        </div>
        <div className="empty-workspace-actions">
          <span>等待项目与链上证据</span>
          <button className="button secondary" type="button" onClick={onStartCreate}>
            先创建设计
          </button>
        </div>
      </section>
    </section>
  );
}

export default function Workspace({
  agentAnswer,
  agentQuestion,
  changeRequest,
  isMasterOnline,
  isRevising,
  onAction,
  onAgentQuestionChange,
  onAskAgent,
  onCopy,
  onNewProject,
  onPreview,
  onRefreshTimeline,
  onRevise,
  onSetChangeRequest,
  onCopyProjectLink,
  onStartCreate,
  timeline,
}) {
  const versions = timeline?.versions || [];
  const project = timeline?.project || {};
  const latest = versions.at(-1);
  const canRevise = Boolean(
    latest &&
      latest.status === "chain_confirmed" &&
      !project.finalVersionId &&
      isMasterOnline &&
      !isRevising
  );

  if (!timeline)
    return (
      <EmptyWorkspace isMasterOnline={isMasterOnline} onStartCreate={onStartCreate} />
    );

  return (
    <section className="workspace">
      <section id="versions" className="panel versions-panel reveal">
        <div className="workspace-header">
          <div>
            <span className="panel-kicker">VERSION ARCHIVE</span>
            <h2>设计版本档案</h2>
            <div className="project-summary">
              <strong>{project.title}</strong>
              <br />
              <span>{project.localDesignId}</span>
              <div className="summary-badges">
                <span>{versions.length} 个设计版本</span>
                <span>
                  {project.finalVersionId ? "最终版已确认" : "等待最终确认"}
                </span>
                <span>Monad Testnet</span>
              </div>
              {project.finalVersionId && (
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => onAction("certificate", "download")}
                >
                  下载最终凭证 JSON
                </button>
              )}
            </div>
          </div>
          <div className="workspace-actions">
            <button className="button glass" type="button" onClick={onCopyProjectLink}>
              复制演示链接
            </button>
            <button className="button glass" type="button" onClick={onNewProject}>
              新建设计
            </button>
            <button
              className="icon-button framed"
              type="button"
              title="刷新版本时间线"
              aria-label="刷新版本时间线"
              onClick={onRefreshTimeline}
              disabled={!isMasterOnline}
            >
              <RefreshIcon />
            </button>
          </div>
        </div>
        <VersionComparison versions={versions} />
        <div className="timeline-head">
          <span>版本时间线</span>
          <small>每个已登记版本都保留可核验的内容指纹</small>
        </div>
        <div className="timeline" aria-busy={isRevising}>
          {versions.map((version) => (
            <VersionCard
              key={version.id}
              version={version}
              onAction={onAction}
              onCopy={onCopy}
              onPreview={onPreview}
            />
          ))}
        </div>
      </section>
      <section className="workspace-grid reveal">
        <article className="panel revision-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">ITERATION</span>
              <h2>生成下一版本</h2>
              <p>
                为建立可验证的版本来源，请先将当前版本登记到 Monad。登记完成后，系统会把它记录为下一版的来源。
              </p>
            </div>
            <span className="step-pill">Step 02</span>
          </div>
          <label htmlFor="changeRequest" className="field-label">
            修改要求
          </label>
          <div className="textarea-shell compact-textarea">
            <textarea
              id="changeRequest"
              rows="5"
              maxLength="400"
              value={changeRequest}
              onChange={(event) => onSetChangeRequest(event.target.value)}
              placeholder="例如：保留戒圈和祥云元素，把表面改成磨砂质感。"
            />
            <span className="char-count">{changeRequest.length} / 400</span>
          </div>
          <div className="change-chips">
            {[
              ["简化纹样", "保留整体造型，将纹样进一步简化。"],
              ["改为磨砂", "保留主体结构，把表面改成细腻磨砂质感。"],
              ["更轻盈", "保留核心元素，让整体比例更轻盈、更适合日常佩戴。"],
            ].map(([label, value]) => (
              <button type="button" key={label} onClick={() => onSetChangeRequest(value)}>
                {label}
              </button>
            ))}
          </div>
          <button
            className="button primary full"
            type="button"
            disabled={!canRevise}
            onClick={onRevise}
          >
            {isRevising ? "Agent 正在生成下一版…" : "基于链上最新版本生成 V2"}
          </button>
        </article>
        <article id="agent" className="panel agent-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">ON-CHAIN AGENT</span>
              <h2>链上证据问答</h2>
              <p>Agent 会先查询数据库与链上交易证据，再给出回答。</p>
            </div>
            <span className="agent-orb" aria-hidden="true" />
          </div>
          <div className="question-chips">
            {[
              "哪一版被确认为最终版？",
              "V2 是否由 V1 修改而来？",
              "当前文件是否与链上登记一致？",
            ].map((question) => (
              <button type="button" key={question} onClick={() => onAskAgent(question)}>
                {question}
              </button>
            ))}
          </div>
          <label htmlFor="agentQuestion" className="field-label">
            自定义问题
          </label>
          <div className="inline-input">
            <input
              id="agentQuestion"
              value={agentQuestion}
              onChange={(event) => onAgentQuestionChange(event.target.value)}
              placeholder="例如：V2 的修改要求是什么？"
              onKeyDown={(event) => {
                if (event.key === "Enter") onAskAgent(agentQuestion);
              }}
            />
            <button
              className="button secondary"
              type="button"
              onClick={() => onAskAgent(agentQuestion)}
              disabled={!isMasterOnline}
            >
              询问 Agent
            </button>
          </div>
          {agentAnswer && (
            <div className="agent-answer">
              <p>{agentAnswer.answer}</p>
              {agentAnswer.evidence?.length > 0 && (
                <div className="evidence-list">
                  <strong>证据来源：</strong>
                  <ul>
                    {agentAnswer.evidence.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </article>
      </section>
    </section>
  );
}

export function ImageDialog({ image, onClose }) {
  const closeRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!image) return undefined;
    previousFocusRef.current = document.activeElement;
    closeRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const nodes = [
        ...document.querySelectorAll(
          "#imageModal button:not([disabled]), #imageModal [href], #imageModal [tabindex]:not([tabindex='-1'])"
        ),
      ];
      if (nodes.length === 0) return;
      const index = nodes.indexOf(document.activeElement);
      event.preventDefault();
      nodes[
        event.shiftKey
          ? index <= 0
            ? nodes.length - 1
            : index - 1
          : index === nodes.length - 1
            ? 0
            : index + 1
      ]?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [image, onClose]);

  if (!image) return null;
  return (
    <dialog
      id="imageModal"
      className="modal"
      open
      aria-label="查看设计大图"
      onCancel={onClose}
    >
      <button
        className="modal-dismiss"
        type="button"
        tabIndex="-1"
        aria-hidden="true"
        onClick={onClose}
      />
      <button
        className="modal-close"
        type="button"
        aria-label="关闭大图"
        ref={closeRef}
        onClick={onClose}
      >
        ×
      </button>
      <img src={image.src} alt="珠宝设计大图" />
      <div className="modal-caption">{image.caption}</div>
    </dialog>
  );
}
