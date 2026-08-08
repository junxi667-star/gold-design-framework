import { RefreshIcon, WalletIcon, ArrowIcon, SparkleIcon } from "./Icons.jsx";
import { ThemeToggle } from "./ThemeToggle.jsx";

export function AppShell({
  accessCode,
  children,
  customerText,
  isMasterOnline,
  isStatusBusy,
  onAccessCodeChange,
  onConnectWallet,
  onCustomerTextChange,
  onCreateDesign,
  onFillExample,
  onNavigate,
  onRefreshStatus,
  onRetryMaster,
  onScrollToCreate,
  onScrollToFlow,
  serviceStatus,
  status,
  walletAddress,
}) {
  const serviceClass = serviceStatus.ready ? "ok" : "warning";
  const walletLabel = walletAddress
    ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`
    : "连接钱包";

  return (
    <>
      <a className="skip-link" href="#create">
        跳到创建设计
      </a>
      <canvas id="particleCanvas" className="particle-canvas" aria-hidden="true" />
      <div className="flow-ribbons" aria-hidden="true">
        <span className="ribbon ribbon-one" />
        <span className="ribbon ribbon-two" />
        <span className="ribbon ribbon-three" />
      </div>
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <div className="noise-layer" aria-hidden="true" />

      <header className="topbar">
        <a className="brand" href="#top" aria-label="返回 JewelChain Studio 首页">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 48 48">
              <path d="M24 3 42 15 35 37 24 45 13 37 6 15 24 3Z" />
              <path d="m6 15 18 9 18-9M24 24v21M13 37l11-13 11 13" />
            </svg>
          </span>
          <span className="brand-copy">
            <strong>JewelChain Studio</strong>
            <small>曜石金智能珠宝工坊</small>
          </span>
        </a>
        <nav className="topnav" aria-label="页面导航">
          <a href="#create" onClick={(event) => onNavigate(event, "#create")}>
            创建设计
          </a>
          <a href="#versions" onClick={(event) => onNavigate(event, "#versions")}>
            版本档案
          </a>
          <a href="#agent" onClick={(event) => onNavigate(event, "#agent")}>
            Agent 验证
          </a>
        </nav>
        <div className="top-actions">
          <ThemeToggle />
          <button
            className={`icon-button${isStatusBusy ? " spinning" : ""}`}
            type="button"
            title="刷新服务状态"
            aria-label="刷新服务状态"
            onClick={onRefreshStatus}
          >
            <RefreshIcon />
          </button>
          <span className={`badge ${serviceClass}`} role="status" aria-live="polite">
            <i />
            {serviceStatus.label}
          </span>
          <button
            className={`button wallet-button${walletAddress ? " connected" : ""}`}
            type="button"
            aria-label={walletAddress ? `已连接钱包 ${walletLabel}` : "连接钱包"}
            onClick={onConnectWallet}
          >
            <WalletIcon />
            <span>{walletLabel}</span>
          </button>
        </div>
      </header>

      <main id="top" className="page-shell">
        <section className="hero-section reveal">
          <div className="hero-copy">
            <div className="eyebrow">
              <span /> MONAD PLAYGROUND · HACKATHON FINAL
            </div>
            <h1>
              把一句珠宝灵感，
              <br />
              <em>变成可验证的设计版本。</em>
            </h1>
            <p>
              用一句话描述您的珠宝灵感，AI 会生成设计效果图并支持持续修改。系统自动记录每次修改的来源，并将关键版本登记到
              Monad，方便后续核验与追溯。
            </p>
            <div className="hero-actions">
              <button
                className="button primary large"
                type="button"
                onClick={onScrollToCreate}
              >
                开始创建设计
                <ArrowIcon />
              </button>
              <button
                className="button glass large"
                type="button"
                onClick={onScrollToFlow}
              >
                查看完整流程
              </button>
            </div>
            <ul className="trust-row" aria-label="产品能力">
              <li>
                <i className="dot purple" />
                AI 需求理解
              </li>
              <li>
                <i className="dot gold" />
                V1 / V2 版本链
              </li>
              <li>
                <i className="dot teal" />
                Monad 可验证
              </li>
              <li>
                <i className="dot gold" />
                云端调度 / 本地生图
              </li>
            </ul>
            <ul className="protocol-pills" aria-label="通信与执行架构">
              <li>Master API</li>
              <li>WebSocket 主通道</li>
              <li>HTTP 兜底</li>
              <li>云端 Master / 本地 Worker</li>
            </ul>
          </div>
          <div
            className="hero-visual"
            role="img"
            aria-label="设计版本从 V1 到 V2 并在 Monad 上完成核验的可视化"
          >
            <div className="jewel-stage">
              <div className="orbit orbit-a">
                <span />
              </div>
              <div className="orbit orbit-b">
                <span />
              </div>
              <div className="orbit orbit-c" />
              <div className="gem-core">
                <div className="gem-facet" />
                <span>JC</span>
              </div>
              <div className="floating-card card-v1">
                <span>V1</span>
                <b>初始设计</b>
                <small>AI Generated</small>
              </div>
              <div className="floating-card card-v2">
                <span>V2</span>
                <b>磨砂 · 简化祥云</b>
                <small>Parent linked</small>
              </div>
              <div className="floating-card card-chain">
                <i />
                <b>Monad Verified</b>
                <small>contentHash</small>
              </div>
            </div>
          </div>
        </section>

        <section id="flowGuide" className="value-strip reveal" aria-label="项目闭环">
          <article>
            <strong>01</strong>
            <div>
              <b>需求输入</b>
              <span>自然语言描述珠宝灵感</span>
            </div>
          </article>
          <article>
            <strong>02</strong>
            <div>
              <b>AI 生成</b>
              <span>AI 生成第一版设计（V1）</span>
            </div>
          </article>
          <article>
            <strong>03</strong>
            <div>
              <b>版本修改</b>
              <span>记录每一版的修改来源</span>
            </div>
          </article>
          <article>
            <strong>04</strong>
            <div>
              <b>Monad 登记</b>
              <span>钱包签名与公开验证</span>
            </div>
          </article>
        </section>

        {!isMasterOnline && (
          <section className="offline-notice reveal" role="status" aria-live="polite">
            <div className="offline-orb" aria-hidden="true">
              <span />
            </div>
            <div>
              <strong>Master（调度服务）暂时离线</strong>
              <p>
                网站介绍与动画效果仍可正常浏览；实时生图、项目数据和 Agent
                问答将在调度服务恢复后自动可用。
              </p>
            </div>
            <button className="button glass" type="button" onClick={onRetryMaster}>
              重新连接服务
            </button>
          </section>
        )}

        <section id="create" className="studio-layout reveal">
          <article className="panel creation-panel">
            <div className="panel-heading">
              <div>
                <span className="panel-kicker">DESIGN CONSOLE</span>
                <h2>描述你的珠宝设计</h2>
                <p>
                  用日常语言描述您的想法即可，Agent 会自动整理成专业的珠宝设计指令。
                </p>
              </div>
              <span className="step-pill">Step 01</span>
            </div>
            <div className="preset-row" role="group" aria-label="示例需求">
              {[
                [
                  "新中式戒指",
                  "设计一款适合年轻女性日常佩戴的新中式黄金戒指，使用简化祥云元素，造型轻盈，不要太复杂。",
                ],
                [
                  "月牙吊坠",
                  "设计一款现代极简黄金吊坠，以月牙为主体，适合通勤佩戴，线条干净。",
                ],
                [
                  "山水手镯",
                  "设计一款轻奢黄金手镯，加入抽象山水纹样，整体克制高级，适合作为纪念礼物。",
                ],
              ].map(([label, value]) => (
                <button
                  className="preset-chip"
                  type="button"
                  key={label}
                  onClick={() => onCustomerTextChange(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label htmlFor="customerText" className="field-label">
              客户需求
            </label>
            <div className="textarea-shell">
              <textarea
                id="customerText"
                rows="6"
                maxLength="600"
                value={customerText}
                onChange={(event) => onCustomerTextChange(event.target.value)}
                placeholder="例如：设计一款适合年轻女性日常佩戴的新中式黄金戒指，使用简化祥云元素，不要太复杂。"
              />
              <span className="char-count">{customerText.length} / 600</span>
            </div>
            <div className="form-row">
              <label className="compact-field" htmlFor="accessCode">
                <span>
                  演示访问码 <small>{status.accessCodeRequired ? "必填" : "选填"}</small>
                </span>
                <input
                  id="accessCode"
                  type="password"
                  autoComplete="off"
                  value={accessCode}
                  onChange={(event) => onAccessCodeChange(event.target.value)}
                  placeholder={
                    status.accessCodeRequired
                      ? "该项目需要访问码，请填写"
                      : "如无需访问码，请留空"
                  }
                />
              </label>
              <button className="text-button" type="button" onClick={onFillExample}>
                填入示例需求
              </button>
            </div>
            <button
              className="button primary full generate-button"
              type="button"
              disabled={!isMasterOnline || status.isCreating}
              onClick={onCreateDesign}
            >
              <span className="button-shine" aria-hidden="true" />
              <SparkleIcon />
              <span>{status.isCreating ? "正在生成第一版设计（V1）…" : "生成第一版设计（V1）"}</span>
            </button>
            {status.progress && <JobProgress progress={status.progress} />}
            {status.error && (
              <div className="error-box" role="alert">
                {status.error}
              </div>
            )}
          </article>
          <SystemStatusPanel status={status} walletLabel={walletLabel} />
        </section>
        {children}
        <section className="certificate-preview panel reveal">
          <div className="certificate-mark">JC</div>
          <div>
            <span className="panel-kicker">VERIFIABLE DESIGN RECORD</span>
            <h2>不是"把图片放上链"，而是保存可核验的版本关系。</h2>
            <p>
              图片与完整版本信息保存在链下；Monad 记录内容指纹（contentHash）、上一版指纹、登记钱包和区块时间。任何人都可以核验当前文件是否与链上登记一致。
            </p>
          </div>
          <div className="certificate-points">
            <span>内容指纹</span>
            <span>版本来源</span>
            <span>钱包签名</span>
            <span>链上凭证</span>
          </div>
        </section>
        <section className="disclaimer reveal">
          <strong>项目边界</strong>
          <p>
            本演示生成的是珠宝概念效果图，不是生产级 CAD 或工厂文件。链上记录证明内容指纹、提交地址与时间，不替代版权登记、原创性审查或法律认定。
          </p>
        </section>
      </main>
      <footer className="site-footer">
        <div>
          <b>JewelChain Studio</b>
          <span>AI Jewelry Design Agent on Monad</span>
        </div>
        <small>Hackathon Final · v1.3.1</small>
      </footer>
    </>
  );
}

function JobProgress({ progress }) {
  const step = progress.step;
  return (
    <div className="job-panel" role="status" aria-live="polite" aria-busy={progress.value < 100}>
      <div className="job-head">
        <span>{progress.message}</span>
        <b>{Math.round(progress.value)}%</b>
      </div>
      <div className="progress-track">
        <div
          className="progress-bar"
          style={{ width: `${progress.value}%` }}
          role="progressbar"
          aria-label="生成进度"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={Math.round(progress.value)}
        />
      </div>
      <div className="pipeline" aria-label="Agent 执行流程">
        {["解析需求", "生成提示词", "AI 生成图片", "保存版本", "等待您确认设计"].map(
          (label, index) => (
            <span
              className={
                progress.value >= 100 || index + 1 < step
                  ? "done"
                  : index + 1 === step
                    ? "active"
                    : ""
              }
              key={label}
            >
              <i>{index + 1}</i>
              {label}
            </span>
          )
        )}
      </div>
    </div>
  );
}

function SystemStatusPanel({ status, walletLabel }) {
  return (
    <aside className="panel system-panel">
      <div className="panel-heading compact-heading">
        <div>
          <span className="panel-kicker">SYSTEM MATRIX</span>
          <h2>运行状态</h2>
        </div>
        <span className="live-indicator">
          <i />
          LIVE
        </span>
      </div>
      <div className="status-grid">
        <div className="status-item">
          <span className="status-icon purple">AI</span>
          <div>
            <small>生图执行端</small>
            <b>{status.image}</b>
          </div>
        </div>
        <div className="status-item">
          <span className="status-icon gold">DB</span>
          <div>
            <small>链下存储</small>
            <b>{status.storage}</b>
          </div>
        </div>
        <div className="status-item">
          <span className="status-icon teal">M</span>
          <div>
            <small>Monad 网络</small>
            <b>{status.chain}</b>
          </div>
        </div>
        <div className="status-item">
          <span className="status-icon neutral">W</span>
          <div>
            <small>用户钱包</small>
            <b>{walletLabel === "连接钱包" ? "未连接" : walletLabel}</b>
          </div>
        </div>
      </div>
      <div className="security-note">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3 5 6v5c0 4.8 2.9 8.1 7 10 4.1-1.9 7-5.2 7-10V6l-7-3Z" />
          <path d="m9 12 2 2 4-5" />
        </svg>
        <div>
          <strong>最小数据上链</strong>
          <p>
            API Key 仅保存在生图端（Image Worker）的 <code>.env</code>
            ；链上只登记内容指纹、版本关系和公开版本信息地址。
          </p>
        </div>
      </div>
      <div className="architecture-mini" role="group" aria-label="系统连接路径">
        <span>Browser</span>
        <i />
        <span>Master 调度服务</span>
        <i />
        <span>Image Worker 生图端</span>
        <i />
        <span>Monad</span>
      </div>
      <section className="terminology-note" aria-label="术语说明">
        <div className="orchestration-title">术语说明</div>
        <dl>
          <div>
            <dt>Master</dt>
            <dd>负责调度流程、保存数据和验证链上结果的服务</dd>
          </div>
          <div>
            <dt>Image Worker</dt>
            <dd>负责调用图片模型并生成效果图的生图端</dd>
          </div>
          <div>
            <dt>Metadata</dt>
            <dd>记录设计版本信息的标准文件</dd>
          </div>
          <div>
            <dt>contentHash</dt>
            <dd>用于核验版本内容是否一致的数字指纹</dd>
          </div>
        </dl>
      </section>
      <div className="orchestration-note">
        <div className="orchestration-title">当前推荐部署</div>
        <p>
          黑客松阶段支持 <strong>Master（调度服务）/ Image Worker（生图端）</strong>{" "}
          拆分。当前可本地一键运行；后续将 Master API 部署到云服务器，本地电脑只需继续运行生图端。
        </p>
        <div className="orchestration-tags">
          <span>WS dispatch</span>
          <span>HTTP fallback</span>
          <span>Remote Worker Ready</span>
        </div>
      </div>
    </aside>
  );
}
