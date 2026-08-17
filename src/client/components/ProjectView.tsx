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
  steerText: string;
  steerAmount: string;
  steering: boolean;
  onTab: (tab: Tab) => void;
  onVersion: (version: number | null) => void;
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
  const next = project.milestones[project.done];
  const shipped = project.milestones.slice(0, project.done);
  const upcoming = project.milestones.slice(project.done, project.done + 4);
  const buildActive = [
    "queued",
    "working",
    "validating",
    "publishing",
  ].includes(project.status);
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
  const activityLines = buildActivityLines(
    project.streamPreview,
    project.agentNote,
  );
  const workspaceWritten =
    /(?:^|\n)(?:WRITE game\.tsx|Writing game\.tsx)(?:\n|$)/i.test(
      project.streamPreview,
    );
  const waitingForFirstSource =
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
  const stageHeight =
    !currentArtifact && buildActive
      ? "clamp(300px, 38vw, 430px)"
      : "clamp(360px, 48vw, 560px)";
  const seed = treasuryGrants[0];
  const visibleSeed = seed && seed.status !== "failed" ? seed : undefined;
  const openSteering = steering
    .filter((item) => item.status === "open")
    .sort((a, b) => b.influence - a.influence);
  const showLiveWorkspace = props.selectedVersion == null && buildActive;
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
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="cc-project-title font-display m-0 min-w-0 max-w-[calc(100%_-_34px)] truncate text-[clamp(2.15rem,6vw,3.25rem)] font-extrabold uppercase leading-[.88] tracking-[-.02em]">
            {project.name}
          </h1>
          <details className="relative shrink-0">
            <summary
              className="cursor-pointer list-none px-1 pb-0.5 font-data text-[13px] tracking-[.18em] text-[var(--dimmer)] hover:text-[var(--dim)]"
              aria-label="Project details"
              title="Project details"
            >
              ···
            </summary>
            <div className="absolute right-0 top-7 z-30 w-[min(520px,calc(100vw-40px))] rounded-[6px] border border-[var(--line)] bg-[#081115] p-4 shadow-2xl">
              {project.summary ? (
                <div className="text-[11px] leading-5 text-[var(--dim)]">
                  {project.summary}
                </div>
              ) : null}
              <div
                className={`${project.summary ? "mt-3 border-t border-[var(--line)] pt-3" : ""} whitespace-pre-wrap font-data text-[9px] leading-5 text-[var(--dimmer)]`}
              >
                {project.idea}
              </div>
            </div>
          </details>
        </div>
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
                    onClick={() => props.onVersion(null)}
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
        {buildActive && !waitingForFirstSource ? (
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
          {waitingForFirstSource ? (
            <BuildWaitingSurface
              activity={activityLines}
              fallback={stageActivity}
            />
          ) : props.tab === "code" && currentArtifact && !showLiveWorkspace ? (
            <pre className="cc-code">
              {props.artifactCodeVersion === currentArtifact.version &&
              props.artifactCode != null
                ? props.artifactCode
                : "…"}
            </pre>
          ) : (
            <iframe
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
        currentUsagePending={Boolean(
          runningBuild &&
          runningBuild.inputTokens +
            runningBuild.outputTokens +
            runningBuild.thinkingTokens ===
            0,
        )}
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
  currentUsagePending: boolean;
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
    <div className="cc-live-strip block">
      <div className="grid w-full grid-cols-2 gap-x-5 gap-y-3 min-[720px]:grid-cols-4">
        <StatBlock
          label="REPORTED TOKENS"
          value={`${integer(props.totalTokens)} TOK`}
          subtle
          title={
            props.currentUsagePending
              ? "The active Codex turn reports usage at model_end; this is provider-reported usage from completed model steps."
              : "Provider-reported usage from completed model steps."
          }
        />
        <StatBlock
          label="EST. USD"
          value={`$${formatUsd(props.usdEstimate)}`}
          title="API-equivalent estimate from provider-reported usage; not a live billing meter."
        />
        <StatBlock
          label="DONATED"
          value={`${number(props.totalDonatedSol, 4)} SOL`}
        />
        <StatBlock
          label="RUNWAY"
          value={`${props.remainingSol < 0 ? "-" : ""}${number(Math.abs(props.remainingSol), 4)} SOL`}
          accent={props.remainingSol < 0 ? "warn" : "ok"}
        />
      </div>

      <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 border-t border-[var(--line)] pt-3 max-[620px]:grid-cols-[auto_minmax(0,1fr)_auto]">
        <span className="cc-label text-[var(--bone)]">FUND</span>
        <button
          className="min-w-0 break-all border-0 bg-transparent p-0 text-left font-data text-[10px] leading-4 text-[var(--dim)] hover:text-[var(--mint)]"
          onClick={props.onCopyWallet}
          title="Copy project wallet"
        >
          {props.walletAddress}
        </button>
        <button className="cc-mini" onClick={props.onCopyWallet}>
          COPY
        </button>
        <button
          className="cc-mini max-[620px]:col-start-3"
          disabled={props.refreshing}
          onClick={props.onSyncFunding}
        >
          {props.refreshing ? "…" : "SYNC"}
        </button>
        {props.liveState !== "live" ? (
          <span className="col-span-full font-data text-[8px] uppercase tracking-[.12em] text-[var(--dimmer)]">
            {props.liveState}
          </span>
        ) : null}
        {props.onDevFund ? (
          <button className="cc-mini" onClick={props.onDevFund}>
            DEV
          </button>
        ) : null}
      </div>
    </div>
  );
}

function StatBlock(props: {
  label: string;
  value: string;
  accent?: "ok" | "warn";
  subtle?: boolean;
  title?: string;
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
      <div className={`mt-1 font-data whitespace-nowrap text-[10px] ${tone}`}>
        {props.value}
      </div>
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
}) {
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

        {props.upcoming.map((mile, offset) => (
          <div
            key={`${mile.title}-${props.done + offset}`}
            className={`cc-milestone ${offset === 0 ? "cc-next" : "opacity-45"}`}
            title={mile.goal || mile.title}
          >
            <span className="font-data text-[11px] text-[var(--dimmer)]">
              {props.done + offset + 1}
            </span>
            <span className="truncate text-sm leading-[1.35]">
              {mile.title}
            </span>
            <span aria-hidden="true" />
          </div>
        ))}
      </div>
    </section>
  );
}

function BuildWaitingSurface(props: { activity: string[]; fallback: string }) {
  const visible = props.activity.length
    ? props.activity.slice(-3)
    : [props.fallback];
  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-[#050a0c] px-6">
      <div
        className="absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "linear-gradient(#10202855 1px,transparent 1px),linear-gradient(90deg,#10202855 1px,transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />
      <svg
        className="relative z-10 h-[88px] w-[88px]"
        viewBox="0 0 100 100"
        role="img"
        aria-label="Codex build active"
      >
        <circle
          cx="50"
          cy="50"
          r="31"
          fill="none"
          stroke="#193039"
          strokeWidth="1"
        />
        <circle
          cx="50"
          cy="50"
          r="31"
          fill="none"
          stroke="#ff5c2b"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="34 162"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 50 50"
            to="360 50 50"
            dur="1.15s"
            repeatCount="indefinite"
          />
        </circle>
        <circle
          cx="50"
          cy="50"
          r="20"
          fill="none"
          stroke="#4fe3c1"
          strokeWidth="1"
          strokeLinecap="round"
          strokeDasharray="18 108"
          opacity=".55"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="360 50 50"
            to="0 50 50"
            dur="1.8s"
            repeatCount="indefinite"
          />
        </circle>
        <circle cx="50" cy="50" r="4.5" fill="#ff5c2b">
          <animate
            attributeName="opacity"
            values="1;.35;1"
            dur="1.1s"
            repeatCount="indefinite"
          />
        </circle>
      </svg>

      <div className="relative z-10 mt-8 w-full max-w-[620px] font-data text-[10px] leading-5">
        {visible.map((line, index) => (
          <div
            key={`${line}-${index}`}
            className={`flex min-w-0 items-start gap-3 border-t border-[var(--line)] py-2 ${
              index === visible.length - 1
                ? "text-[var(--bone)]"
                : "text-[var(--dimmer)]"
            }`}
          >
            <span
              className={
                index === visible.length - 1
                  ? "text-[var(--mint)]"
                  : "text-[var(--dimmer)]"
              }
            >
              ·
            </span>
            <span className="min-w-0 flex-1 break-words">{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildActivityLines(preview: string, note: string): string[] {
  const lines = preview
    .split(/\r?\n/)
    .map((line) => line.replace(/^>\s*/, "").trim())
    .filter(Boolean)
    .map((line) => {
      if (/^WRITE game\.tsx$/i.test(line)) return "Writing game.tsx";
      if (/^DONE$/i.test(line)) return "Build response complete";
      return line;
    });
  const cleanNote = note.replace(/\s+/g, " ").trim();
  if (
    cleanNote &&
    !/^(?:BUILDING|READY|DONE|STARTING|VALIDATE|PUBLISH|SHIPPING|V\d+|BUSY|TIMEOUT|RETRY)$/i.test(
      cleanNote,
    )
  )
    lines.push(cleanNote);
  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped[deduped.length - 1] === line) continue;
    deduped.push(line.slice(0, 180));
  }
  const rich = deduped.filter(
    (line) => !/^Codex generating build$/i.test(line),
  );
  return (rich.length ? rich : deduped).slice(-5);
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
  status: ProjectStatus,
  note: string,
  error: string,
  retrying: boolean,
): string {
  if (retrying) {
    if (/(?:request\s+timed\s*out|timed\s*out|timeout)/i.test(error))
      return "Model request timed out · retrying automatically";
    return "Retry scheduled";
  }
  const clean = note.replace(/\s+/g, " ").trim();
  if (
    clean &&
    !/^(?:BUILDING|READY|DONE|STARTING|VALIDATE|PUBLISH|SHIPPING|V\d+|BUSY|TIMEOUT|RETRY)$/i.test(
      clean,
    )
  )
    return clean.slice(0, 160);
  if (status === "queued") return "Starting Codex";
  if (status === "working") return "Codex generating build";
  if (status === "validating") return "Validating build";
  if (status === "publishing") return "Publishing build";
  return "Working";
}

function statusLabel(
  status: ProjectStatus,
  error = "",
  retrying = false,
): string {
  if (status === "failed") return publicErrorLabel(error);
  if (status === "seeding") return "STARTING";
  if (status === "waiting_funds") return "PAUSED FOR FUNDS";
  if (retrying) return "RETRYING";
  if (status === "queued") return "STARTING";
  if (status === "working") return "BUILDING";
  if (status === "validating" || status === "publishing") return "SHIPPING";
  if (status === "completed") return "COMPLETE";
  return status.toUpperCase();
}
