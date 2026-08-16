import { SOL_LAMPORTS } from "../../shared/constants";
import type { ProjectBundle, ProjectStatus } from "../../shared/types";
import type { Tab } from "../state";
import { number, shortAddress, tokens } from "../format";

export type ProjectViewProps = {
  bundle: ProjectBundle;
  refreshing: boolean;
  liveState: "connecting" | "live" | "fallback";
  error: string | null;
  tab: Tab;
  selectedVersion: number | null;
  artifactCode: string | null;
  artifactCodeVersion: number | null;
  steerText: string;
  steerAmount: string;
  steering: boolean;
  onTab: (tab: Tab) => void;
  onVersion: (version: number) => void;
  onCopyWallet: () => void;
  onSyncFunding: () => void;
  onDevFund: () => void;
  onShare: () => void;
  onSteerText: (value: string) => void;
  onSteerAmount: (value: string) => void;
  onSteer: () => void;
};

export function ProjectView(props: ProjectViewProps) {
  const {
    project,
    artifacts,
    runs,
    supporters,
    steering,
    usage,
    lamportsPerCredit,
  } = props.bundle;
  const latestArtifact = artifacts[artifacts.length - 1];
  const currentArtifact =
    props.selectedVersion != null
      ? artifacts.find((item) => item.version === props.selectedVersion) ||
        latestArtifact
      : latestArtifact;
  const currentRun = runs.find((run) => run.status === "running") || runs[0];
  const next = project.milestones[project.done];
  const shipped = project.milestones.slice(0, project.done);
  const upcoming = project.milestones.slice(project.done, project.done + 4);
  const active = isActive(project.status);
  const totalTokens = currentRun
    ? currentRun.inputTokens + currentRun.outputTokens
    : usage.totalTokens;
  const contextWindow = currentRun?.contextWindow || usage.contextWindow;
  const contextUsed =
    currentRun?.lastContextTokens || usage.latestContextTokens;
  const sol = project.onchainLamports / SOL_LAMPORTS;
  const availableSol = creditsToSol(
    project.availableCredits,
    lamportsPerCredit,
  );
  const openSteering = steering
    .filter((item) => item.status === "open")
    .sort((a, b) => b.influence - a.influence);
  const stageHeight = currentArtifact
    ? "h-[472px] max-[800px]:h-[340px]"
    : active
      ? "h-[230px] max-[800px]:h-[190px]"
      : "h-[132px]";

  return (
    <main className="mx-auto max-w-[920px] px-5 pb-[72px]">
      <header className="cc-project-transition flex items-start gap-3 py-4">
        <a className="cc-icon-link" href="/" aria-label="Back">
          ←
        </a>
        <div className="min-w-0 flex-1">
          <h1 className="font-display m-0 text-[clamp(1.7rem,4vw,2.35rem)] font-extrabold uppercase leading-[.9] tracking-[-.015em]">
            {project.name}
          </h1>
          {project.summary ? (
            <p className="m-0 mt-1 truncate text-[13px] text-[var(--dim)]">
              {project.summary}
            </p>
          ) : null}
        </div>
        <button className="cc-btn" onClick={props.onShare}>
          SHARE ↗
        </button>
      </header>

      <section className="cc-stage">
        <div className="cc-stage-bar">
          <span
            className={`cc-dot ${active ? "cc-dot-go" : artifacts.length ? "cc-dot-on" : ""}`}
          />
          <span className="cc-label">
            {currentArtifact ? `V${currentArtifact.version}` : "V0"}
          </span>
          <span
            className={`ml-1 h-1.5 w-1.5 rounded-full ${props.liveState === "live" ? "bg-[var(--mint)]" : "bg-[var(--dimmer)]"}`}
            aria-label={props.liveState}
          />
          {active ? <span className="cc-stage-runner" /> : null}
          {currentArtifact ? (
            <div className="ml-auto flex gap-0.5">
              <button
                className={`cc-tab ${props.tab === "play" ? "cc-tab-on" : ""}`}
                onClick={() => props.onTab("play")}
                aria-label="Play"
              >
                ▶
              </button>
              <button
                className={`cc-tab ${props.tab === "code" ? "cc-tab-on" : ""}`}
                onClick={() => props.onTab("code")}
                aria-label="Code"
              >
                {"</>"}
              </button>
              <a
                className="cc-tab no-underline"
                href={`/artifacts/${encodeURIComponent(project.id)}/${currentArtifact.version}`}
                target="_blank"
                rel="noopener"
                aria-label={`Open version ${currentArtifact.version}`}
              >
                ↗
              </a>
            </div>
          ) : null}
        </div>
        <div className={`relative ${stageHeight}`}>
          {currentArtifact ? (
            props.tab === "play" ? (
              <iframe
                key={currentArtifact.version}
                className="block h-full w-full border-0 bg-black"
                src={`/artifacts/${encodeURIComponent(project.id)}/${currentArtifact.version}`}
                sandbox="allow-scripts allow-pointer-lock"
                title={`${project.name} v${currentArtifact.version}`}
              />
            ) : (
              <pre className="cc-code">
                {props.artifactCodeVersion === currentArtifact.version &&
                props.artifactCode != null
                  ? props.artifactCode
                  : "…"}
              </pre>
            )
          ) : active ? (
            <AgentSurface
              status={project.status}
              note={project.agentNote}
              preview={project.streamPreview}
            />
          ) : (
            <div className="grid h-full place-items-center">
              <div className="font-display text-[34px] font-extrabold uppercase text-[#283840]">
                V0
              </div>
            </div>
          )}
        </div>
      </section>

      {project.error || props.error ? (
        <div className="cc-agent-line text-[var(--claw)]">
          <span className="cc-dot" />
          <span className="truncate">{props.error || project.error}</span>
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1.15fr]">
        <section className="cc-panel cc-panel-tight">
          <div className="flex items-center justify-between gap-3">
            <span className="cc-label">AGENT</span>
            <span className="font-data text-[10px] text-[var(--mint)]">
              {project.agentId}
            </span>
          </div>
          <div className="mt-3 flex items-end justify-between gap-4">
            <span className="font-display text-[27px] font-extrabold uppercase leading-none">
              {statusLabel(project.status)}
            </span>
            <span className="font-data text-right text-[10px] text-[var(--dimmer)]">
              {tokens(totalTokens)} / {tokens(contextWindow)} TOK
            </span>
          </div>
          <div className="cc-meter mt-3">
            <span
              style={{
                width: `${Math.min(100, contextWindow ? (contextUsed / contextWindow) * 100 : 0)}%`,
              }}
            />
          </div>
        </section>

        <section className="cc-panel cc-panel-tight">
          <div className="flex items-center justify-between gap-3">
            <span className="cc-label">SOL</span>
            <button
              className="cc-mini"
              onClick={props.onSyncFunding}
              aria-label="Refresh"
            >
              ↻
            </button>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              className="min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left font-data text-[12px] text-[var(--bone)]"
              onClick={props.onCopyWallet}
              title={project.walletAddress}
            >
              {shortAddress(project.walletAddress)}
            </button>
            <span className="font-data text-[12px]">{number(sol, 4)} SOL</span>
            <button
              className="cc-btn cc-btn-primary"
              onClick={props.onCopyWallet}
            >
              FUND
            </button>
          </div>
          {next ? (
            <div className="mt-3 flex items-center gap-3">
              <div className="cc-meter flex-1">
                <span
                  style={{
                    width: `${Math.min(100, next.costCredits ? (project.availableCredits / next.costCredits) * 100 : 0)}%`,
                  }}
                />
              </div>
              <span className="font-data whitespace-nowrap text-[10px] text-[var(--dimmer)]">
                {number(availableSol, 3)} /{" "}
                {number(creditsToSol(next.costCredits, lamportsPerCredit), 3)}{" "}
                SOL
              </span>
            </div>
          ) : null}
          {props.bundle.devFundingEnabled ? (
            <button className="cc-mini mt-2" onClick={props.onDevFund}>
              DEV +{number(creditsToSol(2, lamportsPerCredit), 3)} SOL
            </button>
          ) : null}
        </section>
      </div>

      <section className="mt-6">
        <div className="cc-section">
          <span className="cc-label">ROADMAP</span>
        </div>
        <div className="grid gap-[5px]">
          {shipped.map((mile, index) => {
            const version = mile.artifactVersion || index + 1;
            return (
              <button
                key={`${mile.title}-${index}`}
                className={`cc-milestone cc-done ${currentArtifact?.version === version ? "cc-selected" : ""}`}
                onClick={() => props.onVersion(version)}
              >
                <span className="font-data text-[11px] text-[var(--mint)]">
                  ✓
                </span>
                <span className="text-sm leading-[1.35] text-[var(--dim)]">
                  {mile.title}
                </span>
                <span className="font-data text-[10px] text-[var(--dimmer)]">
                  V{version}
                </span>
              </button>
            );
          })}
          {upcoming.map((mile, offset) => {
            const index = project.done + offset;
            const current = offset === 0;
            return (
              <div
                key={`${mile.title}-${index}`}
                className={`cc-milestone ${current ? "cc-next" : "opacity-45"}`}
              >
                <span className="font-data text-[11px] text-[var(--dimmer)]">
                  {current && active ? (
                    <span className="cc-spinner" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span className="text-sm leading-[1.35]">{mile.title}</span>
                <span
                  className={`font-data whitespace-nowrap text-[10px] ${current ? "text-[var(--claw)]" : "text-[var(--dimmer)]"}`}
                >
                  {number(creditsToSol(mile.costCredits, lamportsPerCredit), 3)}{" "}
                  SOL
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <section className="cc-panel cc-panel-tight">
          <div className="cc-label mb-3">SUPPORTERS</div>
          {supporters.length ? (
            <div className="grid gap-0">
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-[var(--line)] pb-2 font-data text-[8px] uppercase tracking-[.12em] text-[var(--dimmer)]">
                <span></span>
                <span>SOL</span>
                <span>INFLUENCE</span>
              </div>
              {supporters.slice(0, 8).map((supporter) => (
                <div
                  key={supporter.address}
                  className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-[var(--line)] py-2.5 font-data text-[10px] last:border-0"
                >
                  <span
                    className="truncate text-[var(--dim)]"
                    title={supporter.address}
                  >
                    {shortAddress(supporter.address)}
                  </span>
                  <span>
                    {number(supporter.donatedLamports / SOL_LAMPORTS, 4)}
                  </span>
                  <span className="text-[var(--mint)]">
                    {number(supporter.influenceAvailable, 2)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="font-display text-[24px] font-extrabold text-[#283840]">
              —
            </div>
          )}
        </section>

        <section className="cc-panel cc-panel-tight">
          <div className="cc-label mb-3">STEER NEXT</div>
          {openSteering.length ? (
            <div className="mb-3 grid gap-1.5">
              {openSteering.slice(0, 4).map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[1fr_auto] gap-3 rounded-[5px] border border-[var(--line)] px-3 py-2 text-[11px]"
                >
                  <span>{item.instruction}</span>
                  <span className="font-data text-[var(--mint)]">
                    {number(item.influence, 2)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-[1fr_72px_auto] gap-2">
            <input
              className="cc-input"
              value={props.steerText}
              maxLength={180}
              placeholder="Steer next…"
              onInput={(event: Event) =>
                props.onSteerText(
                  (event.currentTarget as HTMLInputElement).value,
                )
              }
            />
            <input
              className="cc-input font-data text-right"
              value={props.steerAmount}
              inputMode="decimal"
              aria-label="Influence"
              onInput={(event: Event) =>
                props.onSteerAmount(
                  (event.currentTarget as HTMLInputElement).value,
                )
              }
            />
            <button
              className="cc-btn"
              disabled={
                props.steering ||
                props.steerText.trim().length < 3 ||
                !(Number(props.steerAmount) > 0)
              }
              onClick={props.onSteer}
            >
              {props.steering ? "…" : "STEER"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

function AgentSurface({
  status,
  note,
  preview,
}: {
  status: ProjectStatus;
  note: string;
  preview: string;
}) {
  const lines =
    status === "planning"
      ? []
      : preview
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(-5);
  return (
    <div className="cc-agent-surface h-full">
      <div className="cc-agent-grid" aria-hidden="true" />
      <div className="relative z-10 flex h-full flex-col justify-center px-8 py-6">
        <div className="flex items-center gap-3">
          <span className="cc-spinner" />
          <span className="font-data text-[10px] tracking-[.16em] text-[var(--claw)]">
            {note || statusLabel(status)}
          </span>
        </div>
        {lines.length ? (
          <div className="mt-5 grid gap-2 font-data text-[10px] text-[var(--dimmer)]">
            {lines.map((line, index) => (
              <div key={`${line}-${index}`} className="cc-activity-row">
                <span>{line}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-6 grid max-w-[440px] gap-2" aria-hidden="true">
            <span className="cc-agent-bar w-[92%]" />
            <span className="cc-agent-bar w-[68%]" />
            <span className="cc-agent-bar w-[80%]" />
          </div>
        )}
      </div>
    </div>
  );
}

function creditsToSol(credits: number, lamportsPerCredit: number): number {
  return (Math.max(0, credits) * lamportsPerCredit) / SOL_LAMPORTS;
}

function statusLabel(status: ProjectStatus): string {
  if (status === "waiting_funds") return "WAITING";
  if (status === "working") return "BUILDING";
  if (status === "validating" || status === "publishing") return "SHIPPING";
  if (status === "failed") return "STOPPED";
  return status.toUpperCase();
}

function isActive(status: ProjectStatus): boolean {
  return ["planning", "queued", "working", "validating", "publishing"].includes(
    status,
  );
}
