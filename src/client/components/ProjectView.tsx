import { SOL_LAMPORTS } from "../../shared/constants";
import type { ProjectBundle, ProjectStatus } from "../../shared/types";
import { publicErrorLabel } from "../../shared/public-error";
import type { Tab } from "../state";
import { number, shortAddress } from "../format";

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
  proposalTitle: string;
  proposalGoal: string;
  proposing: boolean;
  steerText: string;
  steerAmount: string;
  steering: boolean;
  onTab: (tab: Tab) => void;
  onVersion: (version: number | null) => void;
  onCopyWallet: () => void;
  onSyncFunding: () => void;
  onDevFund: () => void;
  onShare: () => void;
  onStartBuild: () => void;
  onVoteMilestone: (milestoneKey: string) => void;
  onProposalTitle: (value: string) => void;
  onProposalGoal: (value: string) => void;
  onProposeMilestone: () => void;
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
  // `null` means follow the latest shipped artifact. `-1` is the explicit
  // live-workspace view while a newer milestone is being built.
  const liveSelected = props.selectedVersion === -1;
  const requestedVersion =
    props.selectedVersion != null && props.selectedVersion > 0
      ? props.selectedVersion
      : null;
  const currentArtifact =
    requestedVersion != null
      ? artifacts.find((item) => item.version === requestedVersion) ||
        latestArtifact
      : latestArtifact;
  const next = project.milestones[project.done];
  const shipped = project.milestones.slice(0, project.done);
  const upcoming = project.milestones.slice(project.done, project.done + 12);
  const buildActive = [
    "queued",
    "working",
    "validating",
    "publishing",
  ].includes(project.status);
  const awaitingStart = project.status === "awaiting_start";
  const retrying =
    project.status === "queued" &&
    project.retryAt > 0 &&
    project.retryAt > Date.now();
  const active =
    project.status === "planning" ||
    project.status === "seeding" ||
    buildActive;
  const paused = project.status === "waiting_funds";
  const runningBuild = runs.find(
    (run) => run.status === "running" && run.kind === "build",
  );
  const totalTokens = usage.totalTokens;
  const activityItems = buildActivityItems(
    events,
    project.streamPreview,
    project.agentNote,
    runningBuild?.startedAt || 0,
  );
  const liveBuildPreview = parseBuildPreview(project.streamPreview);
  const workspaceWritten =
    /(?:^|\n)(?:WRITE game\.tsx|Writing game\.tsx)(?:\n|$)/i.test(
      project.streamPreview,
    );
  const waitingForFirstSource =
    Boolean(runningBuild) &&
    buildActive &&
    !currentArtifact &&
    !workspaceWritten &&
    !["validating", "publishing"].includes(project.status);
  const waitingForAgentStart =
    !runningBuild &&
    buildActive &&
    !currentArtifact &&
    !workspaceWritten &&
    !["validating", "publishing"].includes(project.status);
  const solBalance = project.onchainLamports / SOL_LAMPORTS;
  const totalDonatedSol = project.creditedLamports / SOL_LAMPORTS;
  const remainingSol = creditsToSol(
    project.availableCredits,
    lamportsPerCredit,
  );
  const stageActivity = stageActivityLabel(
    project.status,
    project.agentNote,
    project.error,
    retrying,
  );
  const stageHeight = awaitingStart
    ? "96px"
    : buildActive && (showLiveWorkspace || !currentArtifact)
      ? "clamp(190px, 23vw, 260px)"
      : "clamp(500px, 64vw, 720px)";
  const seed = treasuryGrants[0];
  const visibleSeed = seed && seed.status !== "failed" ? seed : undefined;
  const openSteering = steering
    .filter((item) => item.status === "open")
    .sort((a, b) => b.influence - a.influence);
  const showLiveWorkspace = liveSelected && buildActive;
  const playUrl =
    showLiveWorkspace || !currentArtifact
      ? `/api/projects/${encodeURIComponent(project.id)}/preview?rev=${encodeURIComponent(String(props.previewRevision))}`
      : `/artifacts/${encodeURIComponent(project.id)}/${currentArtifact.version}`;
  const hasCommunity = Boolean(
    visibleSeed || supporters.length || openSteering.length,
  );

  return (
    <main className="mx-auto max-w-[1120px] px-5 pb-[80px]">
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 pt-5 pb-5 max-[620px]:grid-cols-[auto_minmax(0,1fr)]">
        <a className="cc-icon-link" href="/" aria-label="Back">
          ←
        </a>
        <h1 className="cc-project-title font-display m-0 min-w-0 truncate text-[clamp(2.15rem,6vw,3.25rem)] font-extrabold uppercase leading-[.88] tracking-[-.02em]">
          {project.name}
        </h1>
        <button
          className="cc-btn max-[620px]:col-span-2 max-[620px]:w-full"
          onClick={props.onShare}
        >
          SHARE ↗
        </button>
      </header>

      {props.error ? (
        <div
          role="status"
          className="mb-4 flex items-start gap-3 rounded-[6px] border border-[rgba(255,92,43,.32)] bg-[rgba(255,92,43,.055)] px-4 py-3"
        >
          <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--claw)]" />
          <div className="min-w-0 text-[11px] leading-5 text-[var(--dim)]">
            {publicErrorLabel(props.error)}
          </div>
        </div>
      ) : null}

      <section className="cc-stage cc-stage-appear">
        <div className="cc-stage-bar">
          <span
            className={`cc-dot ${active ? "cc-dot-go" : artifacts.length || paused ? "cc-dot-on" : ""}`}
          />
          <span className="cc-label text-[var(--bone)]">
            {statusLabel(project.status, project.error, retrying)}
          </span>
          {buildActive ? (
            <>
              <span className="cc-stage-runner" />
              <span
                data-stage-clock
                className="ml-auto mr-2 font-data text-[9px] text-[var(--dimmer)]"
              />
            </>
          ) : (
            <span className="ml-auto" />
          )}
          <div className="flex items-center gap-0.5">
            {artifacts.length ? (
              <div className="cc-version-strip">
                {buildActive ? (
                  <button
                    className={`cc-version-chip ${showLiveWorkspace ? "cc-version-on" : ""}`}
                    onClick={() => props.onVersion(-1)}
                    aria-label="Show live workspace"
                    title="Live workspace"
                  >
                    LIVE
                  </button>
                ) : null}
                {artifacts.slice(-5).map((item) => (
                  <button
                    key={item.version}
                    className={`cc-version-chip ${currentArtifact?.version === item.version && !showLiveWorkspace ? "cc-version-on" : ""}`}
                    onClick={() => props.onVersion(item.version)}
                    aria-label={`Show version ${item.version}`}
                    title={`Version ${item.version}`}
                  >
                    V{item.version}
                  </button>
                ))}
              </div>
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
                  aria-label="Source"
                >
                  {"</>"}
                </button>
                <a
                  className="cc-tab no-underline"
                  href={`/artifacts/${encodeURIComponent(project.id)}/${currentArtifact.version}?download=1`}
                  download
                  aria-label={`Download version ${currentArtifact.version} HTML`}
                >
                  ↓H
                </a>
                <a
                  className="cc-tab no-underline"
                  href={`/artifacts/${encodeURIComponent(project.id)}/${currentArtifact.version}/source?download=1`}
                  download
                  aria-label={`Download version ${currentArtifact.version} source`}
                >
                  ↓S
                </a>
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
        {buildActive &&
        !waitingForFirstSource &&
        !waitingForAgentStart &&
        (showLiveWorkspace || !currentArtifact) ? (
          <div className="flex min-h-[30px] items-center gap-2 border-b border-[var(--line)] bg-[#071014] px-3 font-data text-[9px] text-[var(--dimmer)]">
            <span className="cc-spinner shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{stageActivity}</span>
          </div>
        ) : null}
        {project.status === "failed" ? (
          <div className="cc-activity-ribbon">
            <span className="cc-activity-current">
              {publicErrorLabel(project.error || project.agentNote)}
            </span>
          </div>
        ) : null}
        <div className="cc-stage-body relative" style={{ height: stageHeight }}>
          {awaitingStart ? (
            <div className="flex h-full items-center justify-end px-6">
              <button
                className="cc-btn cc-btn-primary shrink-0"
                onClick={props.onStartBuild}
              >
                START BUILD →
              </button>
            </div>
          ) : showLiveWorkspace && buildActive ? (
            <BuildWaitingSurface
              activity={activityItems}
              assistant={liveBuildPreview.assistant}
              source={liveBuildPreview.source}
            />
          ) : waitingForFirstSource ? (
            <BuildWaitingSurface
              activity={activityItems}
              assistant={liveBuildPreview.assistant}
              source={liveBuildPreview.source}
            />
          ) : waitingForAgentStart ? (
            <QueueWaitingSurface label={stageActivity} retrying={retrying} />
          ) : props.tab === "code" && currentArtifact && !showLiveWorkspace ? (
            <pre className="cc-code">
              {props.artifactCodeVersion === currentArtifact.version &&
              props.artifactCode != null
                ? props.artifactCode
                : "…"}
            </pre>
          ) : (
            <iframe
              key={playUrl}
              className="cc-preview-frame block h-full w-full border-0 bg-black"
              src={playUrl}
              sandbox="allow-scripts allow-pointer-lock"
              title={`${project.name} browser`}
            />
          )}
        </div>
      </section>

      <LiveStrip
        totalTokens={totalTokens}
        usdEstimate={usage.usdEstimate}
        walletAddress={project.walletAddress}
        solBalance={solBalance}
        totalDonatedSol={totalDonatedSol}
        remainingSol={remainingSol}
        liveState={props.liveState}
        refreshing={props.refreshing}
        onCopyWallet={props.onCopyWallet}
        onSyncFunding={props.onSyncFunding}
        onDevFund={props.bundle.devFundingEnabled ? props.onDevFund : undefined}
      />

      <Roadmap
        shipped={shipped}
        upcoming={upcoming}
        done={project.done}
        total={project.milestones.length}
        active={buildActive}
        currentVersion={currentArtifact?.version}
        onVersion={props.onVersion}
        onVoteMilestone={props.onVoteMilestone}
        proposalTitle={props.proposalTitle}
        proposalGoal={props.proposalGoal}
        proposing={props.proposing}
        onProposalTitle={props.onProposalTitle}
        onProposalGoal={props.onProposalGoal}
        onProposeMilestone={props.onProposeMilestone}
      />

      {hasCommunity ? (
        <Community
          seed={visibleSeed}
          supporters={supporters}
          openSteering={openSteering}
          allowSteering={
            Boolean(currentArtifact) &&
            (supporters.some((item) => item.influenceAvailable > 0) ||
              openSteering.length > 0)
          }
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
  totalTokens: number;
  usdEstimate: number;
  walletAddress: string;
  solBalance: number;
  totalDonatedSol: number;
  remainingSol: number;
  liveState: "connecting" | "live" | "fallback";
  refreshing: boolean;
  onCopyWallet: () => void;
  onSyncFunding: () => void;
  onDevFund?: () => void;
}) {
  return (
    <section className="border-b border-[var(--line)] py-4">
      <div className="grid grid-cols-2 gap-x-5 gap-y-4 min-[720px]:grid-cols-4">
        <StatBlock label="TOKENS" value={integer(props.totalTokens)} subtle />
        <StatBlock
          label="EST. USD"
          value={`$${formatUsd(props.usdEstimate)}`}
          title="API-equivalent estimate from provider-reported usage; not a live billing meter."
        />
        <StatBlock
          label="DONATED"
          value={`${number(props.totalDonatedSol, 4)} SOL`}
          title={`Observed on-chain balance: ${number(props.solBalance, 4)} SOL`}
        />
        <StatBlock
          label="RUNWAY"
          value={`${props.remainingSol < 0 ? "-" : ""}${number(Math.abs(props.remainingSol), 4)} SOL`}
          accent={props.remainingSol < 0 ? "warn" : "ok"}
        />
      </div>

      <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-start gap-x-3 gap-y-2 border-t border-[var(--line)] pt-3 max-[680px]:grid-cols-[auto_minmax(0,1fr)_auto]">
        <span className="cc-label pt-0.5 text-[var(--bone)]">FUND</span>
        <button
          className="min-w-0 select-all break-all border-0 bg-transparent p-0 text-left font-data text-[10px] leading-4 tracking-[.01em] text-[var(--dim)] hover:text-[var(--mint)]"
          onClick={props.onCopyWallet}
          title="Copy project wallet"
        >
          {props.walletAddress}
        </button>
        <button className="cc-mini" onClick={props.onCopyWallet}>
          COPY
        </button>
        <button
          className="cc-mini max-[680px]:col-start-3"
          disabled={props.refreshing}
          onClick={props.onSyncFunding}
        >
          {props.refreshing ? "…" : "SYNC"}
        </button>
        {props.onDevFund ? (
          <button
            className="cc-mini col-start-2 w-max"
            onClick={props.onDevFund}
          >
            DEV
          </button>
        ) : null}
      </div>
    </section>
  );
}

function StatBlock(props: {
  label: string;
  value: string;
  accent?: "ok" | "warn";
  subtle?: boolean;
  title?: string;
  meta?: string;
}) {
  const tone =
    props.accent === "warn"
      ? "text-[var(--claw)]"
      : props.accent === "ok"
        ? "text-[var(--mint)]"
        : props.subtle
          ? "text-[var(--dimmer)]"
          : "text-[var(--bone)]";
  return (
    <div className="min-w-[84px]" title={props.title}>
      <div className="font-data text-[8px] uppercase tracking-[.12em] text-[var(--dimmer)]">
        {props.label}
      </div>
      <div className={`mt-1 font-data whitespace-nowrap text-[11px] ${tone}`}>
        {props.value}
      </div>
      {props.meta ? (
        <div className="mt-1 font-data text-[8px] leading-3 text-[var(--dimmer)]">
          {props.meta}
        </div>
      ) : null}
    </div>
  );
}

function Community(props: {
  seed: ProjectBundle["treasuryGrants"][number] | undefined;
  supporters: ProjectBundle["supporters"];
  openSteering: ProjectBundle["steering"];
  allowSteering: boolean;
  steerText: string;
  steerAmount: string;
  steering: boolean;
  onSteerText: (value: string) => void;
  onSteerAmount: (value: string) => void;
  onSteer: () => void;
}) {
  return (
    <section className="cc-community-block mt-6">
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

      {props.allowSteering ? (
        <details className="cc-steer-details">
          <summary>STEER</summary>
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
              {props.steering ? "…" : "→"}
            </button>
          </div>
        </details>
      ) : null}
    </section>
  );
}

function Roadmap(props: {
  shipped: ProjectBundle["project"]["milestones"];
  upcoming: ProjectBundle["project"]["milestones"];
  done: number;
  total: number;
  active: boolean;
  currentVersion?: number;
  onVersion: (version: number | null) => void;
  onVoteMilestone: (milestoneKey: string) => void;
  proposalTitle: string;
  proposalGoal: string;
  proposing: boolean;
  onProposalTitle: (value: string) => void;
  onProposalGoal: (value: string) => void;
  onProposeMilestone: () => void;
}) {
  const proposalTitle = props.proposalTitle || "";
  const proposalGoal = props.proposalGoal || "";

  const progress = props.total
    ? Math.min(100, (props.done / props.total) * 100)
    : 0;
  return (
    <section className="mt-7">
      <div className="flex items-center gap-3 border-b border-[var(--line)] pb-3">
        <span className="cc-label">ROADMAP</span>
        <span className="cc-rail-meter min-w-[90px] flex-1">
          <i style={{ width: `${progress}%` }} />
        </span>
        <span className="font-data text-[9px] text-[var(--dimmer)]">
          {props.done}/{props.total}
        </span>
      </div>

      <div className="mt-3 grid gap-[5px]">
        {props.shipped.slice(-3).map((mile, shippedIndex) => {
          const index = Math.max(0, props.shipped.length - 3) + shippedIndex;
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
              <span className="truncate text-sm leading-[1.35] text-[var(--dim)]">
                {mile.title}
              </span>
              <span className="font-data text-[10px] text-[var(--dimmer)]">
                V{version}
              </span>
            </button>
          );
        })}

        {props.upcoming.map((mile, offset) => {
          const rowClass = `grid w-full grid-cols-[26px_minmax(0,1fr)_auto] items-start gap-3 rounded-[6px] border px-4 py-3 text-left ${offset === 0 ? "border-[rgba(255,92,43,.38)] bg-[rgba(255,92,43,.045)]" : "border-[var(--line)] bg-white/[.012]"}`;
          const row = (
            <>
              <span className="pt-0.5 font-data text-[10px] text-[var(--dimmer)]">
                {props.done + offset + 1}
              </span>
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={`min-w-0 truncate text-[13px] leading-5 ${offset === 0 ? "text-[var(--bone)]" : "text-[var(--dim)]"}`}
                  >
                    {mile.title}
                  </span>
                  {mile.rendering === "three_migration" ? (
                    <span className="shrink-0 font-data text-[8px] uppercase tracking-[.12em] text-[var(--mint)]">
                      3D
                    </span>
                  ) : mile.origin === "community" ? (
                    <span className="shrink-0 font-data text-[8px] uppercase tracking-[.1em] text-[var(--dimmer)]">
                      COMMUNITY
                    </span>
                  ) : null}
                </span>
                {mile.goal ? (
                  <span className="mt-1 block text-[10px] leading-4 text-[var(--dimmer)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
                    {mile.goal}
                  </span>
                ) : null}
              </span>
              {offset > 0 ? (
                <button
                  className="cc-mini min-w-[54px] whitespace-nowrap"
                  onClick={() => props.onVoteMilestone(mile.key)}
                  aria-label={`Upvote ${mile.title}`}
                >
                  ▲ {Math.max(0, Number(mile.votes || 0))}
                </button>
              ) : (
                <span aria-hidden="true" />
              )}
            </>
          );

          return offset === 0 && props.active ? (
            <button
              key={mile.key || `${mile.title}-${props.done + offset}`}
              className={`${rowClass} cursor-pointer`}
              onClick={() => props.onVersion(-1)}
              aria-label={`Show build progress for ${mile.title}`}
            >
              {row}
            </button>
          ) : (
            <div
              key={mile.key || `${mile.title}-${props.done + offset}`}
              className={rowClass}
            >
              {row}
            </div>
          );
        })}
      </div>

      <details className="mt-3 rounded-[6px] border border-[var(--line)] bg-white/[.01] px-4 py-3">
        <summary className="cursor-pointer list-none font-data text-[9px] uppercase tracking-[.12em] text-[var(--dimmer)]">
          + SUGGEST MILESTONE
        </summary>
        <div className="mt-3 grid gap-2">
          <input
            className="cc-input"
            value={proposalTitle}
            maxLength={90}
            placeholder="Milestone title"
            onInput={(event: Event) =>
              props.onProposalTitle(
                (event.currentTarget as HTMLInputElement).value,
              )
            }
          />
          <textarea
            className="cc-input min-h-[76px] resize-y py-2"
            value={proposalGoal}
            maxLength={360}
            placeholder="Description"
            onInput={(event: Event) =>
              props.onProposalGoal(
                (event.currentTarget as HTMLTextAreaElement).value,
              )
            }
          />
          <div className="flex justify-end">
            <button
              className="cc-mini shrink-0"
              disabled={
                props.proposing ||
                proposalTitle.trim().length < 3 ||
                proposalGoal.trim().length < 8
              }
              onClick={props.onProposeMilestone}
            >
              {props.proposing ? "ADDING…" : "ADD"}
            </button>
          </div>
        </div>
      </details>
    </section>
  );
}

type BuildActivityItem = { text: string; createdAt: number };

function QueueWaitingSurface(props: { label: string; retrying: boolean }) {
  return (
    <div className="relative flex h-full overflow-hidden bg-[#050a0c]">
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            "linear-gradient(#10202855 1px,transparent 1px),linear-gradient(90deg,#10202855 1px,transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />
      <div className="relative z-10 m-auto w-full max-w-[620px] px-6 py-7">
        {props.label ? (
          <div className="flex items-center gap-3 border-y border-[var(--line)] py-3 font-data text-[10px] text-[var(--bone)]">
            <span
              className="relative flex h-2.5 w-2.5 items-center justify-center"
              aria-hidden="true"
            >
              <span
                className={`absolute h-full w-full animate-ping rounded-full ${props.retrying ? "bg-[var(--claw)]" : "bg-[var(--mint)]"} opacity-20`}
              />
              <span
                className={`relative h-1.5 w-1.5 rounded-full ${props.retrying ? "bg-[var(--claw)]" : "bg-[var(--mint)]"}`}
              />
            </span>
            <span>{props.label}</span>
          </div>
        ) : null}
        <svg
          className={`${props.label ? "mt-3" : ""} block h-[2px] w-full overflow-hidden bg-[var(--line)]`}
          viewBox="0 0 100 2"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <rect x="-24" y="0" width="24" height="2" fill="#ff5c2b">
            <animate
              attributeName="x"
              values="-24;100"
              dur="1.25s"
              repeatCount="indefinite"
            />
          </rect>
        </svg>
      </div>
    </div>
  );
}

function BuildWaitingSurface(props: {
  activity: BuildActivityItem[];
  assistant: string;
  source: string;
}) {
  const source = props.source;
  const latest = [...props.activity]
    .reverse()
    .find((item) => item.text !== source && item.text !== props.assistant);
  return (
    <div className="relative flex h-full overflow-hidden bg-[#050a0c]">
      <div
        className="absolute inset-0 opacity-25"
        style={{
          backgroundImage:
            "linear-gradient(#10202855 1px,transparent 1px),linear-gradient(90deg,#10202855 1px,transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      <div className="relative z-10 m-auto w-full max-w-[720px] px-6 py-7">
        {props.assistant ? (
          <div className="mb-3 truncate font-data text-[9px] text-[var(--dimmer)]">
            {props.assistant}
          </div>
        ) : latest ? (
          <div className="mb-3 truncate font-data text-[9px] text-[var(--dimmer)]">
            {latest.text}
          </div>
        ) : null}

        {source ? (
          <div className="flex items-center gap-3 border-y border-[var(--line)] py-3">
            <span
              className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center"
              aria-hidden="true"
            >
              <span className="absolute h-full w-full animate-ping rounded-full bg-[var(--mint)] opacity-25" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-[var(--mint)]" />
            </span>
            <span className="min-w-0 font-data text-[10px] leading-5 text-[var(--bone)]">
              {source}
            </span>
          </div>
        ) : null}

        <svg
          className={`${source ? "mt-3" : ""} block h-[2px] w-full overflow-hidden bg-[var(--line)]`}
          viewBox="0 0 100 2"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <rect x="-24" y="0" width="24" height="2" fill="#ff5c2b">
            <animate
              attributeName="x"
              values="-24;100"
              dur="1.25s"
              repeatCount="indefinite"
            />
          </rect>
        </svg>
      </div>
    </div>
  );
}

function parseBuildPreview(preview: string): {
  assistant: string;
  source: string;
} {
  let assistant = "";
  let source = "";
  for (const raw of preview.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^A\|/i.test(line)) assistant = line.slice(2).trim().slice(0, 360);
    if (/^G\|/i.test(line)) source = line.slice(2).trim().slice(0, 180);
  }
  return { assistant, source };
}

function buildActivityItems(
  events: ProjectBundle["events"],
  preview: string,
  note: string,
  runStartedAt: number,
): BuildActivityItem[] {
  const eventItems = events
    .filter(
      (event) =>
        event.type === "agent.activity" &&
        (!runStartedAt || event.createdAt >= runStartedAt - 1000),
    )
    .slice(0, 8)
    .reverse()
    .map((event) => ({
      text: cleanBuildActivity(event.message),
      createdAt: event.createdAt,
    }))
    .filter((item) => Boolean(item.text));

  const previewItems = preview
    .split(/\r?\n/)
    .map((line) => cleanBuildActivity(line.replace(/^>\s*/, "")))
    .filter(Boolean)
    .map((line) => ({ text: line, createdAt: 0 }));

  const cleanNote = cleanBuildActivity(note);
  if (cleanNote) previewItems.push({ text: cleanNote, createdAt: 0 });

  return dedupeActivityItems([...eventItems, ...previewItems]).slice(-5);
}

function cleanBuildActivity(value: string): string {
  const line = value.replace(/\s+/g, " ").trim();
  if (!line) return "";
  if (
    /^(?:BUILDING|READY|DONE|STARTING|VALIDATE|PUBLISH|SHIPPING|V\d+|BUSY|TIMEOUT|RETRY)$/i.test(
      line,
    )
  )
    return "";
  if (
    /^(?:Codex generating build|Model running|Codex (?:turn|command) started|Model step started|Model response received)$/i.test(
      line,
    )
  )
    return "";
  if (
    /configured service tier .*not advertised as supported|service tier .*will be omitted/i.test(
      line,
    )
  )
    return "";
  if (/^A\|/i.test(line)) return line.slice(2).trim().slice(0, 360);
  if (/^G\|/i.test(line)) return line.slice(2).trim().slice(0, 180);
  if (/^WRITE game\.tsx$/i.test(line)) return "Writing game.tsx";
  if (/^COMMIT game\.tsx$/i.test(line)) return "Committing game.tsx";
  if (/^DONE$/i.test(line)) return "Build response complete";
  return line.slice(0, 180);
}

function dedupeActivityItems(items: BuildActivityItem[]): BuildActivityItem[] {
  const out: BuildActivityItem[] = [];
  for (const item of items) {
    if (!item.text || out[out.length - 1]?.text === item.text) continue;
    out.push(item);
  }
  return out;
}

function integer(value: number): string {
  return Math.max(0, Math.floor(value)).toLocaleString("en-US");
}

function formatUsd(value: number): string {
  if (!(value > 0)) return "0.000";
  if (value < 0.01) return value.toFixed(3);
  if (value < 1) return value.toFixed(2);
  return value.toFixed(1);
}

function creditsToSol(credits: number, lamportsPerCredit: number): number {
  return (credits * lamportsPerCredit) / SOL_LAMPORTS;
}

function stageActivityLabel(
  _status: ProjectStatus,
  note: string,
  _error: string,
  _retrying: boolean,
): string {
  const clean = note.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (
    /configured service tier .*not advertised as supported|service tier .*will be omitted/i.test(
      clean,
    )
  )
    return "";
  if (
    /^(?:Codex (?:turn|command) started|Model step started|Model response received)$/i.test(
      clean,
    )
  )
    return "";
  if (
    /^(?:BUILDING|READY|DONE|STARTING|VALIDATE|PUBLISH|SHIPPING|V\d+|BUSY|TIMEOUT|RETRY)$/i.test(
      clean,
    )
  )
    return "";
  return clean.slice(0, 160);
}

function statusLabel(
  status: ProjectStatus,
  error = "",
  retrying = false,
): string {
  if (status === "failed") return publicErrorLabel(error);
  if (status === "awaiting_start") return "";
  if (status === "seeding") return "STARTING";
  if (status === "waiting_funds") return "PAUSED FOR FUNDS";
  if (retrying) return "RETRYING";
  if (status === "queued") return "STARTING";
  if (status === "working") return "BUILDING";
  if (status === "validating" || status === "publishing") return "SHIPPING";
  if (status === "completed") return "COMPLETE";
  return status.toUpperCase();
}
