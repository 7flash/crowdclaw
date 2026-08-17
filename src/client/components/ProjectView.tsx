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
  const active = isActive(project.status);
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
  const seedLamports =
    seed?.lamports ||
    (next ? Math.max(1, Math.ceil(next.costCredits * lamportsPerCredit)) : 0);
  const openSteering = steering
    .filter((item) => item.status === "open")
    .sort((a, b) => b.influence - a.influence);
  const liveLines = activityLines(
    project.streamPreview,
    events,
    visibleSeed,
    artifacts.length,
  );
  const stageHeight = currentArtifact
    ? "h-[472px] max-[800px]:h-[340px]"
    : active
      ? "h-[300px] max-[800px]:h-[250px]"
      : "h-[132px]";
  const hasCommunity = Boolean(
    visibleSeed || supporters.length || openSteering.length,
  );

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
            {statusLabel(project.status, project.error)}
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
          ) : project.status === "seeding" ? (
            <SeedSurface
              seed={seed}
              lamports={seedLamports}
              balanceLamports={project.onchainLamports}
              activity={liveLines}
            />
          ) : active ? (
            <AgentSurface
              status={project.status}
              note={project.agentNote}
              lines={liveLines}
            />
          ) : (
            <IdleSurface status={project.status} lines={liveLines} />
          )}
        </div>
      </section>

      <LiveRail
        agentId={project.agentId}
        totalTokens={totalTokens}
        contextWindow={contextWindow}
        walletAddress={project.walletAddress}
        solBalance={solBalance}
        availableSol={availableSol}
        nextSol={nextSol}
        hasNext={Boolean(next)}
        refreshing={props.refreshing}
        onCopyWallet={props.onCopyWallet}
        onSyncFunding={props.onSyncFunding}
        onDevFund={props.bundle.devFundingEnabled ? props.onDevFund : undefined}
      />

      <Roadmap
        shipped={shipped}
        upcoming={upcoming}
        done={project.done}
        active={active}
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

function LiveRail(props: {
  agentId: string;
  totalTokens: number;
  contextWindow: number;
  walletAddress: string;
  solBalance: number;
  availableSol: number;
  nextSol: number;
  hasNext: boolean;
  refreshing: boolean;
  onCopyWallet: () => void;
  onSyncFunding: () => void;
  onDevFund?: () => void;
}) {
  const tokenPercent = Math.min(
    100,
    props.contextWindow ? (props.totalTokens / props.contextWindow) * 100 : 0,
  );
  const fundPercent = Math.min(
    100,
    props.nextSol ? (props.availableSol / props.nextSol) * 100 : 0,
  );
  return (
    <div className="cc-live-rail">
      <div className="cc-live-cell">
        <span className="cc-label">AGENT</span>
        <span className="font-data text-[9px] text-[var(--mint)]">
          {props.agentId}
        </span>
        <span className="cc-rail-meter">
          <i style={{ width: `${tokenPercent}%` }} />
        </span>
        <span className="font-data text-[9px] text-[var(--dimmer)]">
          {tokens(props.totalTokens)}
        </span>
      </div>
      <div className="cc-live-cell">
        <span className="cc-label">SOL</span>
        <button
          className="min-w-0 truncate border-0 bg-transparent p-0 text-left font-data text-[9px] text-[var(--dimmer)]"
          onClick={props.onCopyWallet}
          title={props.walletAddress}
        >
          {shortAddress(props.walletAddress)}
        </button>
        <span
          key={props.solBalance}
          className="cc-balance-pop font-data text-[13px] text-[var(--bone)]"
        >
          {number(props.solBalance, 4)}
        </span>
        <button className="cc-mini" onClick={props.onSyncFunding}>
          {props.refreshing ? "…" : "↻"}
        </button>
        {props.hasNext ? (
          <span className="cc-rail-meter">
            <i style={{ width: `${fundPercent}%` }} />
          </span>
        ) : null}
        {props.hasNext ? (
          <span className="font-data text-[9px] text-[var(--dimmer)]">
            {number(props.availableSol, 3)}/{number(props.nextSol, 3)}
          </span>
        ) : null}
        <button
          className="cc-mini text-[var(--claw)]"
          onClick={props.onCopyWallet}
        >
          FUND
        </button>
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
        {number(creditsToSol(mile.costCredits, lamportsPerCredit), 3)} SOL
      </span>
    </div>
  );
}

function SeedSurface({
  seed,
  lamports,
  balanceLamports,
  activity,
}: {
  seed: ProjectBundle["treasuryGrants"][number] | undefined;
  lamports: number;
  balanceLamports: number;
  activity: string[];
}) {
  const confirmed =
    seed?.status === "confirmed" ||
    (lamports > 0 && balanceLamports >= lamports);
  const submitted = seed?.status === "submitted" || confirmed;
  return (
    <div className="cc-seed-surface h-full">
      <div className="cc-seed-glow" aria-hidden="true" />
      <div className="relative z-10 flex h-full flex-col justify-center px-7">
        <div className="mx-auto w-full max-w-[620px]">
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4">
            <span className="font-data text-[10px] uppercase tracking-[.12em] text-[var(--bone)]">
              CrowdClaw
            </span>
            <span className="cc-seed-track">
              <i
                className={
                  submitted
                    ? "cc-seed-packet cc-seed-packet-sent"
                    : "cc-seed-packet"
                }
              />
            </span>
            <span
              key={`${seed?.status || "new"}-${lamports}`}
              className="font-data text-[15px] text-[var(--mint)]"
            >
              +{number(lamports / SOL_LAMPORTS, 4)} SOL
            </span>
          </div>
          <div className="mt-4">
            <ActivityFeed
              lines={
                activity.length
                  ? activity
                  : [submitted ? "CONFIRMING" : "SIGNING"]
              }
            />
          </div>
        </div>
      </div>
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

function IdleSurface({
  status,
  lines,
}: {
  status: ProjectStatus;
  lines: string[];
}) {
  return (
    <div className="flex h-full items-center px-7">
      <div className="w-full">
        <ActivityFeed lines={lines.length ? lines : [statusLabel(status)]} />
      </div>
    </div>
  );
}

function ActivityFeed({ lines }: { lines: string[] }) {
  return (
    <div className="cc-cinema-feed">
      {lines.slice(-6).map((line, index) => (
        <div
          key={`${line}-${index}`}
          className={
            index === Math.min(lines.length, 6) - 1
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

function activityLines(
  preview: string,
  events: ProjectEvent[],
  seed: ProjectBundle["treasuryGrants"][number] | undefined,
  artifactCount: number,
): string[] {
  const lines: string[] = [];
  for (const event of [...events].reverse()) {
    const label = eventLabel(event);
    if (label) lines.push(label);
  }
  if (seed && seed.status !== "failed") {
    const amount = number(seed.lamports / SOL_LAMPORTS, 4);
    const state =
      seed.status === "confirmed"
        ? "✓"
        : seed.status === "submitted"
          ? "…"
          : "→";
    lines.push(`${state} ${amount} SOL`);
  }
  for (const line of preview.split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean || /^[TSNM]\|/.test(clean)) continue;
    lines.push(clean.replace(/^>\s*/, ""));
  }
  if (artifactCount && !lines.some((line) => /^V\d+\s+LIVE$/.test(line)))
    lines.push(`V${artifactCount} LIVE`);
  return dedupe(lines).slice(-8);
}

function eventLabel(event: ProjectEvent): string {
  if (event.type === "wallet.created") return "WALLET";
  if (event.type === "agent.assigned") return "AGENT";
  if (event.type === "roadmap.planned") return "ROADMAP";
  if (event.type === "treasury.seed.sent") return "SOL SENT";
  if (event.type === "funding.confirmed") return "SOL ✓";
  if (event.type === "milestone.started") return "BUILD";
  if (event.type === "artifact.published") {
    const match = event.message.match(/v(\d+)/i);
    return match ? `V${match[1]} LIVE` : "LIVE";
  }
  if (event.type === "roadmap.rolled") return "NEXT +1";
  if (event.type === "agent.busy") return "BUSY";
  if (event.type === "agent.retry") return "RETRY";
  if (
    event.type === "agent.failed" ||
    event.type === "agent.process.failed" ||
    event.type === "treasury.seed.failed"
  )
    return "ERROR";
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
