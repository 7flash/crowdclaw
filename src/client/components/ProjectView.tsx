import { SOL_LAMPORTS } from "../../shared/constants";
import type {
  ProjectBundle,
  ProjectEvent,
  ProjectStatus,
} from "../../shared/types";
import { publicErrorLabel } from "../../shared/public-error";
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
  previewRevision: number;
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
    events,
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
  const buildActive = [
    "queued",
    "working",
    "validating",
    "publishing",
  ].includes(project.status);
  const fundingActive =
    project.status === "seeding" || project.status === "waiting_funds";
  const active = project.status === "planning" || fundingActive || buildActive;
  const totalTokens = currentRun
    ? currentRun.inputTokens +
      currentRun.outputTokens +
      currentRun.thinkingTokens
    : usage.totalTokens;
  const contextWindow = currentRun?.contextWindow || usage.contextWindow;
  const solBalance = project.onchainLamports / SOL_LAMPORTS;
  const availableSol = creditsToSol(
    project.availableCredits,
    lamportsPerCredit,
  );
  const nextSol = next ? creditsToSol(next.costCredits, lamportsPerCredit) : 0;
  const seed = treasuryGrants[0];
  const visibleSeed = seed && seed.status !== "failed" ? seed : undefined;
  const openSteering = steering
    .filter((item) => item.status === "open")
    .sort((a, b) => b.influence - a.influence);
  const buildLines = buildActivityLines(
    project.streamPreview,
    events,
    artifacts.length,
    project.status,
  );
  const showLiveWorkspace = props.selectedVersion == null && buildActive;
  const playUrl =
    showLiveWorkspace || !currentArtifact
      ? `/api/projects/${encodeURIComponent(project.id)}/preview?rev=${encodeURIComponent(String(props.previewRevision))}`
      : `/artifacts/${encodeURIComponent(project.id)}/${currentArtifact.version}`;
  const stageHeight = "h-[500px] max-[800px]:h-[360px]";
  const hasCommunity = Boolean(
    visibleSeed || supporters.length || openSteering.length,
  );

  return (
    <main className="mx-auto max-w-[920px] px-5 pb-[72px]">
      <header className="flex items-center gap-3 py-4">
        <a className="cc-icon-link" href="/" aria-label="Back">
          ←
        </a>
        <h1 className="cc-project-title font-display m-0 min-w-0 flex-1 truncate text-[clamp(2rem,5vw,3rem)] font-extrabold uppercase leading-[.9] tracking-[-.015em]">
          {project.name}
        </h1>
        <button className="cc-btn" onClick={props.onShare}>
          SHARE ↗
        </button>
      </header>

      <section className="cc-stage cc-stage-appear">
        <div className="cc-stage-bar">
          <span
            className={`cc-dot ${active ? "cc-dot-go" : artifacts.length ? "cc-dot-on" : ""}`}
          />
          <span className="cc-label text-[var(--bone)]">
            {statusLabel(project.status, project.error)}
          </span>
          <span
            className={`ml-1 h-1.5 w-1.5 rounded-full ${props.liveState === "live" ? "bg-[var(--mint)]" : "bg-[var(--dimmer)]"}`}
            aria-label={props.liveState}
          />
          {buildActive ? (
            <>
              <span className="cc-stage-runner" />
              <span
                data-run-clock
                className="ml-auto mr-2 font-data text-[9px] text-[var(--dimmer)]"
              />
            </>
          ) : (
            <span className="ml-auto" />
          )}
          <div className="flex items-center gap-0.5">
            {currentArtifact && !showLiveWorkspace ? (
              <span className="cc-label mr-2">V{currentArtifact.version}</span>
            ) : null}
            {currentArtifact && !showLiveWorkspace ? (
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
        <div className={`cc-stage-body relative ${stageHeight}`}>
          {props.tab === "code" && currentArtifact && !showLiveWorkspace ? (
            <pre className="cc-code">
              {props.artifactCodeVersion === currentArtifact.version &&
              props.artifactCode != null
                ? props.artifactCode
                : "…"}
            </pre>
          ) : (
            <>
              <iframe
                className="cc-preview-frame block h-full w-full border-0 bg-black"
                src={playUrl}
                sandbox="allow-scripts allow-pointer-lock"
                title={`${project.name} browser`}
              />
              {project.status === "failed" ? (
                <div className="cc-browser-overlay">
                  <ActivityFeed
                    lines={[
                      publicErrorLabel(project.error || project.agentNote),
                    ]}
                  />
                </div>
              ) : buildActive ? (
                <div className="cc-browser-overlay">
                  <div className="cc-coding-live">
                    <span>{project.agentNote || "CODING"}</span>
                    <span data-run-clock />
                  </div>
                  <ActivityFeed
                    lines={
                      buildLines.length
                        ? buildLines
                        : [project.agentNote || "CODING"]
                    }
                  />
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>

      <LiveStrip
        agentId={project.agentId}
        totalTokens={totalTokens}
        contextWindow={contextWindow}
        walletAddress={project.walletAddress}
        solBalance={solBalance}
        liveState={props.liveState}
        onCopyWallet={props.onCopyWallet}
        onDevFund={props.bundle.devFundingEnabled ? props.onDevFund : undefined}
      />

      <Roadmap
        shipped={shipped}
        upcoming={upcoming}
        done={project.done}
        active={buildActive}
        currentVersion={currentArtifact?.version}
        lamportsPerCredit={lamportsPerCredit}
        onVersion={props.onVersion}
      />

      {hasCommunity ? (
        <Community
          seed={visibleSeed}
          supporters={supporters}
          openSteering={openSteering}
          steerText={props.steerText}
          steerAmount={props.steerAmount}
          steering={props.steering}
          onSteerText={props.onSteerText}
          onSteerAmount={props.onSteerAmount}
          onSteer={props.onSteer}
        />
      ) : null}
    </main>
  );
}

function LiveStrip(props: {
  agentId: string;
  totalTokens: number;
  contextWindow: number;
  walletAddress: string;
  solBalance: number;
  liveState: "connecting" | "live" | "fallback";
  onCopyWallet: () => void;
  onDevFund?: () => void;
}) {
  const tokenPercent = Math.min(
    100,
    props.contextWindow ? (props.totalTokens / props.contextWindow) * 100 : 0,
  );
  return (
    <div className="cc-live-strip">
      <span className="cc-label">AGENT</span>
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate font-data text-[9px] text-[var(--mint)]">
          {props.agentId}
        </span>
        <span className="cc-rail-meter">
          <i style={{ width: `${tokenPercent}%` }} />
        </span>
        <span className="font-data text-[9px] text-[var(--dimmer)]">
          {tokens(props.totalTokens)}
        </span>
      </div>
      <button
        className="cc-live-wallet truncate border-0 bg-transparent p-0 font-data text-[9px] text-[var(--dimmer)]"
        onClick={props.onCopyWallet}
        title={props.walletAddress}
      >
        {number(props.solBalance, 4)} SOL · {shortAddress(props.walletAddress)}
      </button>
      <div className="flex items-center gap-2">
        <span
          className={`h-1.5 w-1.5 rounded-full ${props.liveState === "live" ? "bg-[var(--mint)]" : "bg-[var(--dimmer)]"}`}
        />
        {props.onDevFund ? (
          <button className="cc-mini" onClick={props.onDevFund}>
            DEV
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Community(props: {
  seed: ProjectBundle["treasuryGrants"][number] | undefined;
  supporters: ProjectBundle["supporters"];
  openSteering: ProjectBundle["steering"];
  steerText: string;
  steerAmount: string;
  steering: boolean;
  onSteerText: (value: string) => void;
  onSteerAmount: (value: string) => void;
  onSteer: () => void;
}) {
  return (
    <div className="mt-6 grid gap-3 md:grid-cols-2">
      <section className="cc-community-block">
        <div className="cc-section mt-0">
          <span className="cc-label">SUPPORTERS</span>
        </div>
        <div className="grid">
          {props.seed ? (
            <div
              key={`${props.seed.id}-${props.seed.status}`}
              className={`cc-supporter-row ${props.seed.status === "confirmed" ? "cc-fund-arrive" : "cc-fund-pending"}`}
            >
              <span className="font-data text-[10px] text-[var(--bone)]">
                CrowdClaw
              </span>
              <span className="font-data text-[10px]">
                +{number(props.seed.lamports / SOL_LAMPORTS, 4)} SOL
              </span>
              <span className="font-data text-[9px] text-[var(--dimmer)]">
                {props.seed.status === "confirmed" ? "✓" : "…"}
              </span>
            </div>
          ) : null}
          {props.supporters.slice(0, 8).map((supporter) => (
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
        </div>
      </section>

      <section className="cc-community-block">
        <div className="cc-section mt-0">
          <span className="cc-label">STEER</span>
        </div>
        {props.openSteering.length ? (
          <div className="mb-2 grid gap-1">
            {props.openSteering.slice(0, 3).map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-[1fr_auto] gap-3 py-1.5 text-[11px]"
              >
                <span className="truncate">{item.instruction}</span>
                <span className="font-data text-[var(--mint)]">
                  {number(item.influence, 2)}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="grid grid-cols-[1fr_58px_auto] gap-2">
          <input
            className="cc-input"
            value={props.steerText}
            maxLength={180}
            placeholder="what next"
            onInput={(event: Event) =>
              props.onSteerText((event.currentTarget as HTMLInputElement).value)
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
            {props.steering ? "…" : "→"}
          </button>
        </div>
      </section>
    </div>
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
  key?: string;
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
        {number(creditsToSol(mile.costCredits, lamportsPerCredit), 4)} SOL
      </span>
    </div>
  );
}

function AgentSurface({
  status,
  note,
  lines,
}: {
  status: ProjectStatus;
  note: string;
  lines: string[];
}) {
  const fallback = [note || statusLabel(status)];
  return (
    <div className="cc-agent-surface h-full">
      <div className="cc-agent-grid" aria-hidden="true" />
      <div className="relative z-10 flex h-full flex-col px-7 py-6">
        <div className="flex items-center gap-3">
          <span className="cc-spinner" />
          <span className="font-data text-[10px] uppercase tracking-[.14em] text-[var(--claw)]">
            {note || statusLabel(status)}
          </span>
        </div>
        <div className="mt-auto max-w-[620px]">
          <ActivityFeed lines={lines.length ? lines : fallback} />
        </div>
      </div>
    </div>
  );
}

function IdleSurface({ lines }: { lines: string[] }) {
  return (
    <div className="flex h-full items-center px-7">
      <div className="w-full">
        <ActivityFeed lines={lines} />
      </div>
    </div>
  );
}

function ActivityFeed({ lines }: { lines: string[] }) {
  const visible = lines.slice(-5);
  return (
    <div className="cc-cinema-feed">
      {visible.map((line, index) => (
        <div
          key={`${line}-${index}`}
          className={
            index === visible.length - 1
              ? "cc-cinema-line cc-cinema-current"
              : "cc-cinema-line"
          }
        >
          <span>{line}</span>
        </div>
      ))}
    </div>
  );
}

function buildActivityLines(
  preview: string,
  events: ProjectEvent[],
  artifactCount: number,
  status: ProjectStatus,
): string[] {
  const lines: string[] = [];
  if (["queued", "working", "validating", "publishing"].includes(status)) {
    for (const event of [...events].reverse()) {
      const label = eventLabel(event);
      if (label) lines.push(label);
    }
    for (const line of preview.split(/\r?\n/)) {
      const clean = line.trim();
      if (!clean || /^[TSNM]\|/.test(clean)) continue;
      lines.push(clean.replace(/^>\s*/, ""));
    }
  }
  if (artifactCount && !lines.some((line) => /^V\d+\s+LIVE$/.test(line)))
    lines.push(`V${artifactCount} LIVE`);
  return dedupe(lines).slice(-8);
}

function eventLabel(event: ProjectEvent): string {
  if (event.type === "milestone.started") return "BUILD";
  if (event.type === "artifact.published") {
    const match = event.message.match(/v(\d+)/i);
    return match ? `V${match[1]} LIVE` : "LIVE";
  }
  if (event.type === "roadmap.rolled") return "NEXT +1";
  if (event.type === "agent.activity") return event.message.slice(0, 100);
  if (event.type === "agent.busy") return "BUSY";
  if (event.type === "agent.retry") return "RETRY";
  return "";
}

function dedupe(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (!line || out[out.length - 1] === line) continue;
    out.push(line);
  }
  return out;
}

function creditsToSol(credits: number, lamportsPerCredit: number): number {
  return (Math.max(0, credits) * lamportsPerCredit) / SOL_LAMPORTS;
}

function statusLabel(status: ProjectStatus, error = ""): string {
  if (status === "failed") return publicErrorLabel(error);
  if (status === "seeding") return "FUNDING";
  if (status === "waiting_funds") return "WAITING";
  if (status === "queued") return "STARTING";
  if (status === "working") return "BUILDING";
  if (status === "validating" || status === "publishing") return "SHIPPING";
  if (status === "completed") return "COMPLETE";
  return status.toUpperCase();
}
