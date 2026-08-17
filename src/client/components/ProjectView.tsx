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
    treasuryGrants,
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
  const solBalance = project.onchainLamports / SOL_LAMPORTS;
  const availableSol = creditsToSol(
    project.availableCredits,
    lamportsPerCredit,
  );
  const nextSol = next ? creditsToSol(next.costCredits, lamportsPerCredit) : 0;
  const seed = treasuryGrants[0];
  const openSteering = steering
    .filter((item) => item.status === "open")
    .sort((a, b) => b.influence - a.influence);
  const stageHeight = currentArtifact
    ? "h-[472px] max-[800px]:h-[340px]"
    : active
      ? "h-[250px] max-[800px]:h-[210px]"
      : "h-[92px]";

  return (
    <main className="mx-auto max-w-[920px] px-5 pb-[72px]">
      <header className="cc-project-transition flex items-center gap-3 py-4">
        <a className="cc-icon-link" href="/" aria-label="Back">
          ←
        </a>
        <h1 className="font-display m-0 min-w-0 flex-1 truncate text-[clamp(1.8rem,4vw,2.45rem)] font-extrabold uppercase leading-[.9] tracking-[-.015em]">
          {project.name}
        </h1>
        <button className="cc-btn" onClick={props.onShare}>
          SHARE ↗
        </button>
      </header>

      <section className="cc-stage">
        <div className="cc-stage-bar">
          <span
            className={`cc-dot ${active ? "cc-dot-go" : artifacts.length ? "cc-dot-on" : ""}`}
          />
          <span className="cc-label text-[var(--bone)]">
            {statusLabel(project.status)}
          </span>
          <span
            className={`ml-1 h-1.5 w-1.5 rounded-full ${props.liveState === "live" ? "bg-[var(--mint)]" : "bg-[var(--dimmer)]"}`}
            aria-label={props.liveState}
          />
          {active ? <span className="cc-stage-runner" /> : null}
          <div className="ml-auto flex items-center gap-0.5">
            {currentArtifact ? (
              <span className="cc-label mr-2">V{currentArtifact.version}</span>
            ) : null}
            {currentArtifact ? (
              <>
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
              </>
            ) : null}
          </div>
        </div>
        <div className={`relative ${stageHeight}`}>
          {currentArtifact ? (
            props.tab === "play" ? (
              <iframe
                key={currentArtifact.version}
                className="cc-artifact-reveal block h-full w-full border-0 bg-black"
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
              <span className="cc-label">{statusLabel(project.status)}</span>
            </div>
          )}
        </div>
      </section>

      {project.error || props.error ? (
        <div className="cc-agent-line text-[var(--claw)]">
          <span>{props.error || project.error}</span>
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <section className="cc-panel cc-panel-tight">
          <div className="flex items-center justify-between gap-3">
            <span className="cc-label">AGENT</span>
            <span className="font-data text-[9px] text-[var(--mint)]">
              {project.agentId}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div className="cc-meter flex-1">
              <span
                style={{
                  width: `${Math.min(100, contextWindow ? (totalTokens / contextWindow) * 100 : 0)}%`,
                }}
              />
            </div>
            <span className="font-data whitespace-nowrap text-[9px] text-[var(--dimmer)]">
              {tokens(totalTokens)} / {tokens(contextWindow)} TOK
            </span>
          </div>
        </section>

        <section className="cc-panel cc-panel-tight">
          <div className="flex items-center justify-between gap-3">
            <span className="cc-label">TREASURY</span>
            <button
              className="cc-mini"
              onClick={props.onSyncFunding}
              aria-label="Refresh"
            >
              ↻
            </button>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button
              className="min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left font-data text-[10px] text-[var(--dimmer)]"
              onClick={props.onCopyWallet}
              title={project.walletAddress}
            >
              {shortAddress(project.walletAddress)}
            </button>
            <span
              key={project.onchainLamports}
              className="cc-balance-pop font-data text-[16px] text-[var(--bone)]"
            >
              {number(solBalance, 4)} SOL
            </span>
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
              <span className="font-data whitespace-nowrap text-[9px] text-[var(--dimmer)]">
                {number(availableSol, 3)} / {number(nextSol, 3)} SOL
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

      <Roadmap
        shipped={shipped}
        upcoming={upcoming}
        done={project.done}
        active={active}
        currentVersion={currentArtifact?.version}
        lamportsPerCredit={lamportsPerCredit}
        onVersion={props.onVersion}
      />

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <section className="cc-panel cc-panel-tight">
          <div className="cc-label mb-2">SUPPORTERS</div>
          <div className="grid">
            {seed ? (
              <div
                key={`${seed.id}-${seed.status}`}
                className={`cc-supporter-row ${seed.status === "confirmed" ? "cc-fund-arrive" : "cc-fund-pending"}`}
              >
                <span className="font-data text-[10px] text-[var(--bone)]">
                  CrowdClaw
                </span>
                <span className="font-data text-[10px]">
                  +{number(seed.lamports / SOL_LAMPORTS, 4)} SOL
                </span>
                <span className="font-data text-[9px] text-[var(--dimmer)]">
                  {seed.status === "confirmed" ? "✓" : "…"}
                </span>
              </div>
            ) : null}
            {supporters.slice(0, 8).map((supporter) => (
              <div key={supporter.address} className="cc-supporter-row">
                <span
                  className="truncate font-data text-[10px] text-[var(--dim)]"
                  title={supporter.address}
                >
                  {shortAddress(supporter.address)}
                </span>
                <span className="font-data text-[10px]">
                  {number(supporter.donatedLamports / SOL_LAMPORTS, 4)} SOL
                </span>
                <span className="font-data text-[9px] text-[var(--mint)]">
                  {number(supporter.influenceAvailable, 2)}
                </span>
              </div>
            ))}
            {!seed && !supporters.length ? (
              <div className="font-display text-[22px] font-extrabold text-[#283840]">
                —
              </div>
            ) : null}
          </div>
        </section>

        <section className="cc-panel cc-panel-tight">
          <div className="cc-label mb-2">STEER NEXT</div>
          {openSteering.length ? (
            <div className="mb-2 grid gap-1.5">
              {openSteering.slice(0, 3).map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[1fr_auto] gap-3 border-b border-[var(--line)] py-2 text-[11px]"
                >
                  <span>{item.instruction}</span>
                  <span className="font-data text-[var(--mint)]">
                    {number(item.influence, 2)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-[1fr_68px_auto] gap-2">
            <input
              className="cc-input"
              value={props.steerText}
              maxLength={180}
              placeholder="what next"
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

function Roadmap(props: {
  shipped: ProjectBundle["project"]["milestones"];
  upcoming: ProjectBundle["project"]["milestones"];
  done: number;
  active: boolean;
  currentVersion?: number;
  lamportsPerCredit: number;
  onVersion: (version: number) => void;
}) {
  return (
    <section className="mt-6">
      {props.upcoming[0] ? (
        <>
          <div className="cc-section">
            <span className="cc-label">NOW</span>
          </div>
          <MilestoneRow
            mile={props.upcoming[0]}
            index={props.done}
            current
            active={props.active}
            lamportsPerCredit={props.lamportsPerCredit}
          />
        </>
      ) : null}
      {props.upcoming.length > 1 ? (
        <>
          <div className="cc-section">
            <span className="cc-label">NEXT</span>
          </div>
          <div className="grid gap-[5px]">
            {props.upcoming.slice(1).map((mile, offset) => (
              <MilestoneRow
                key={`${mile.title}-${offset}`}
                mile={mile}
                index={props.done + offset + 1}
                lamportsPerCredit={props.lamportsPerCredit}
              />
            ))}
          </div>
        </>
      ) : null}
      {props.shipped.length ? (
        <>
          <div className="cc-section">
            <span className="cc-label">SHIPPED</span>
          </div>
          <div className="grid gap-[5px]">
            {props.shipped
              .slice()
              .reverse()
              .slice(0, 4)
              .map((mile, reverseIndex) => {
                const index = props.shipped.length - 1 - reverseIndex;
                const version = mile.artifactVersion || index + 1;
                return (
                  <button
                    key={`${mile.title}-${index}`}
                    className={`cc-milestone cc-done ${props.currentVersion === version ? "cc-selected" : ""}`}
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
          </div>
        </>
      ) : null}
    </section>
  );
}

function MilestoneRow({
  mile,
  index,
  current = false,
  active = false,
  lamportsPerCredit,
}: {
  mile: ProjectBundle["project"]["milestones"][number];
  index: number;
  current?: boolean;
  active?: boolean;
  lamportsPerCredit: number;
}) {
  return (
    <div className={`cc-milestone ${current ? "cc-next" : "opacity-45"}`}>
      <span className="font-data text-[11px] text-[var(--dimmer)]">
        {current && active ? <span className="cc-spinner" /> : index + 1}
      </span>
      <span className="text-sm leading-[1.35]">{mile.title}</span>
      <span
        className={`font-data whitespace-nowrap text-[10px] ${current ? "text-[var(--claw)]" : "text-[var(--dimmer)]"}`}
      >
        {number(creditsToSol(mile.costCredits, lamportsPerCredit), 3)} SOL
      </span>
    </div>
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
  const lines = preview
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-6);
  return (
    <div className="cc-agent-surface h-full">
      <div className="cc-agent-grid" aria-hidden="true" />
      <div className="relative z-10 flex h-full flex-col justify-end px-7 py-6">
        <div className="mb-auto flex items-center gap-3">
          <span className="cc-spinner" />
          <span className="font-data text-[10px] uppercase tracking-[.14em] text-[var(--claw)]">
            {note || statusLabel(status)}
          </span>
        </div>
        {lines.length ? (
          <div className="grid gap-1.5 font-data text-[10px] text-[var(--dimmer)]">
            {lines.map((line, index) => (
              <div key={`${line}-${index}`} className="cc-activity-row">
                <span>{line}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid max-w-[430px] gap-2" aria-hidden="true">
            <span className="cc-agent-bar w-[88%]" />
            <span className="cc-agent-bar w-[62%]" />
            <span className="cc-agent-bar w-[76%]" />
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
  if (status === "seeding") return "FUNDING";
  if (status === "waiting_funds") return "WAITING";
  if (status === "queued") return "STARTING";
  if (status === "working") return "BUILDING";
  if (status === "validating" || status === "publishing") return "SHIPPING";
  if (status === "completed") return "COMPLETE";
  if (status === "failed") return "STOPPED";
  return status.toUpperCase();
}

function isActive(status: ProjectStatus): boolean {
  return [
    "planning",
    "seeding",
    "queued",
    "working",
    "validating",
    "publishing",
  ].includes(status);
}
