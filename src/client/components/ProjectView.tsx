import { CREDIT_SYMBOL, SOL_LAMPORTS } from "../../shared/constants";
import type { ProjectBundle } from "../../shared/types";
import type { Tab } from "../state";
import { ago, number, shortAddress, tokens } from "../format";

export type ProjectViewProps = {
  bundle: ProjectBundle;
  refreshing: boolean;
  liveState: "connecting" | "live" | "fallback";
  error: string | null;
  tab: Tab;
  selectedVersion: number | null;
  artifactCode: string | null;
  artifactCodeVersion: number | null;
  onTab: (tab: Tab) => void;
  onVersion: (version: number) => void;
  onCopyWallet: () => void;
  onSyncFunding: () => void;
  onDevFund: () => void;
  onShare: () => void;
};

export function ProjectView(props: ProjectViewProps) {
  const { project, artifacts, runs, events, usage } = props.bundle;
  const latestArtifact = artifacts[artifacts.length - 1];
  const currentArtifact =
    props.selectedVersion != null
      ? artifacts.find((item) => item.version === props.selectedVersion) ||
        latestArtifact
      : latestArtifact;
  const currentRun = runs.find((run) => run.status === "running") || runs[0];
  const next = project.milestones[project.done];
  const backlog = project.milestones.slice(project.done + 1, project.done + 4);
  const shipped = project.milestones.slice(0, project.done);
  const fundingProgress = next
    ? Math.min(
        100,
        (project.availableCredits / Math.max(0.01, next.costCredits)) * 100,
      )
    : 100;
  const liveOutputTokens =
    currentRun?.status === "running" &&
    currentRun.outputTokens === 0 &&
    currentRun.streamChars
      ? Math.ceil(currentRun.streamChars / 4)
      : currentRun?.outputTokens || 0;
  const contextUsed = currentRun?.lastContextTokens || 0;
  const contextWindow = currentRun?.contextWindow || usage.contextWindow;
  const contextPct = Math.min(
    100,
    contextWindow ? (contextUsed / contextWindow) * 100 : 0,
  );
  const sol = project.onchainLamports / SOL_LAMPORTS;

  return (
    <div className="mx-auto max-w-[920px] px-5 pb-[70px]">
      <header className="cc-project-transition flex items-start gap-[10px] pt-[10px] pb-[14px]">
        <a
          className="cc-btn cc-btn-ghost no-underline"
          href="/"
          aria-label="Back"
        >
          ←
        </a>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-display text-[clamp(1.5rem,4vw,2.1rem)] font-extrabold uppercase leading-[.9] tracking-[-.015em]">
              {project.name}
            </div>
            <span className={`cc-status cc-status-${project.status}`}>
              {statusLabel(project.status)}
            </span>
          </div>
          <div className="mt-1 text-[13.5px] text-[var(--dim)]">
            {project.summary}
          </div>
        </div>
        <button className="cc-btn" onClick={props.onShare}>
          share ↗
        </button>
      </header>

      <div className="cc-stage">
        <div className="cc-stage-bar">
          <span
            className={`cc-dot ${isActive(project.status) ? "cc-dot-go" : artifacts.length ? "cc-dot-on" : ""}`}
          />
          <span className="cc-label">
            {currentArtifact ? `v${currentArtifact.version}` : project.status}
          </span>
          {props.refreshing ? (
            <span className="cc-label text-[var(--mint)]">· sync</span>
          ) : null}
          <span
            className={`cc-label ${props.liveState === "live" ? "text-[var(--mint)]" : "text-[var(--dimmer)]"}`}
          >
            {props.liveState === "live"
              ? "· live"
              : props.liveState === "fallback"
                ? "· reconnecting"
                : "· connecting"}
          </span>
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
        <div className="relative h-[472px] max-[800px]:h-[340px]">
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
                  : "loading artifact code…"}
              </pre>
            )
          ) : (
            <div className="grid h-full place-items-center px-8 text-center">
              <div>
                <div className="font-display text-[34px] font-extrabold uppercase text-[#283840]">
                  {project.status === "planning" ? "PLANNING" : "v0"}
                </div>
                <div className="mt-3 max-w-[520px] text-sm text-[var(--dimmer)]">
                  {project.streamPreview || project.agentNote}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        className={`cc-say ${project.agentNote || project.error || props.error ? "cc-say-has" : ""}`}
      >
        {props.error || project.error ? (
          <p className="text-[var(--dim)]">{props.error || project.error}</p>
        ) : (
          <p>{project.agentNote}</p>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <section className="cc-panel">
          <div className="flex items-center justify-between">
            <span className="cc-label">agent</span>
            <span className="font-data text-[10px] text-[var(--mint)]">
              {project.agentId}
            </span>
          </div>
          <div className="mt-4 flex items-end justify-between gap-4">
            <div>
              <div className="font-display text-[28px] font-extrabold uppercase leading-none">
                {statusLabel(project.status)}
              </div>
              <div className="mt-1 text-xs text-[var(--dimmer)]">
                {currentRun?.model || "assigned · awaiting first run"}
              </div>
            </div>
            {currentRun ? (
              <div className="font-data text-right text-[10px] text-[var(--dimmer)]">
                {currentRun.status}
                <br />
                {ago(currentRun.startedAt)}
              </div>
            ) : null}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <Metric
              label="input"
              value={`${currentRun?.usageEstimated ? "~" : ""}${tokens(currentRun?.inputTokens || 0)}`}
              suffix="tok"
            />
            <Metric
              label="output"
              value={`${currentRun?.usageEstimated || (currentRun?.status === "running" && currentRun.outputTokens === 0 && currentRun.streamChars) ? "~" : ""}${tokens(liveOutputTokens)}`}
              suffix="tok"
            />
          </div>

          <div className="mt-4">
            <div className="flex justify-between font-data text-[10px] text-[var(--dimmer)]">
              <span>
                {currentRun?.usageEstimated
                  ? "estimated context"
                  : "run context"}
              </span>
              <span>
                {tokens(contextUsed)} / {tokens(contextWindow)}
              </span>
            </div>
            <div className="cc-meter mt-2">
              <span style={{ width: `${contextPct}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-[11px] text-[var(--dimmer)]">
              <span>
                context remaining{" "}
                {tokens(Math.max(0, contextWindow - contextUsed))}
              </span>
              <span>lifetime {tokens(usage.totalTokens)} tokens</span>
            </div>
          </div>

          <div className="mt-4 rounded-md border border-[var(--line)] bg-black/10 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="cc-label">funded token runway</span>
              <span className="font-data text-[11px] text-[var(--mint)]">
                {usage.estimatedFundedTokenRunway > 0
                  ? `~${tokens(usage.estimatedFundedTokenRunway)} tok`
                  : "learning"}
              </span>
            </div>
            <div className="mt-1 text-[10px] leading-4 text-[var(--dimmer)]">
              {usage.tokensPerSpentCredit > 0
                ? `learned from ~${tokens(usage.tokensPerSpentCredit)} tokens per spent ${CREDIT_SYMBOL}`
                : "Appears after the first shipped milestone and improves from this project’s own history."}
            </div>
          </div>
        </section>

        <section className="cc-panel">
          <div className="flex items-center justify-between">
            <span className="cc-label">funding wallet</span>
            <button className="cc-mini" onClick={props.onSyncFunding}>
              {props.refreshing ? "syncing" : "refresh"}
            </button>
          </div>
          <button
            className="mt-4 flex w-full items-center justify-between gap-3 border-0 bg-transparent p-0 text-left"
            onClick={props.onCopyWallet}
            title={project.walletAddress}
          >
            <span className="font-data text-[13px] text-[var(--bone)]">
              {shortAddress(project.walletAddress)}
            </span>
            <span className="cc-label text-[var(--mint)]">copy address</span>
          </button>
          <div className="mt-3 text-[11px] leading-5 text-[var(--dimmer)]">
            Send SOL to this project wallet. Confirmed balance is converted into
            build credits automatically.
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <Metric label="wallet" value={number(sol, 4)} suffix="SOL" />
            <Metric
              label="available"
              value={number(project.availableCredits, 2)}
              suffix={CREDIT_SYMBOL}
            />
            <Metric
              label="spent"
              value={number(project.spentCredits, 2)}
              suffix={CREDIT_SYMBOL}
            />
          </div>

          {next ? (
            <div className="mt-4">
              <div className="flex justify-between font-data text-[10px] text-[var(--dimmer)]">
                <span>next milestone</span>
                <span>
                  {number(project.availableCredits, 2)} /{" "}
                  {number(next.costCredits, 2)} {CREDIT_SYMBOL}
                </span>
              </div>
              <div className="cc-meter mt-2">
                <span style={{ width: `${fundingProgress}%` }} />
              </div>
              <div className="mt-2 text-[11px] text-[var(--dimmer)]">
                {project.availableCredits >= next.costCredits
                  ? "funded · agent continues automatically"
                  : `${number(next.costCredits - project.availableCredits, 2)} ${CREDIT_SYMBOL} still needed`}
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="cc-btn cc-btn-primary"
              onClick={props.onCopyWallet}
            >
              fund this project
            </button>
            {props.bundle.devFundingEnabled ? (
              <button className="cc-btn" onClick={props.onDevFund}>
                dev +2 {CREDIT_SYMBOL}
              </button>
            ) : null}
          </div>
          {project.fundingError ? (
            <div className="mt-3 text-[10px] text-[var(--claw)]">
              funding sync: {project.fundingError}
            </div>
          ) : null}
        </section>
      </div>

      {shipped.length ? (
        <section>
          <div className="cc-section">
            <span className="cc-label">shipped</span>
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
                  <span className="font-data whitespace-nowrap text-[11px] text-[var(--dimmer)]">
                    v{version}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {next ? (
        <section>
          <div className="cc-section">
            <span className="cc-label">now</span>
          </div>
          <div
            className={`cc-milestone cc-next ${project.status === "waiting_funds" ? "" : "cc-ready"}`}
          >
            <span className="font-data text-[11px] text-[var(--claw)]">
              {isActive(project.status) ? (
                <span className="cc-spinner" />
              ) : (
                project.done + 1
              )}
            </span>
            <span className="text-sm leading-[1.35]">{next.title}</span>
            <span className="font-data whitespace-nowrap text-[11px] text-[var(--claw)]">
              {next.costCredits} {CREDIT_SYMBOL}
            </span>
          </div>
        </section>
      ) : null}

      {backlog.length ? (
        <section>
          <div className="cc-section">
            <span className="cc-label">rolling next</span>
          </div>
          <div className="grid gap-[5px]">
            {backlog.map((mile, index) => (
              <div
                key={`${mile.title}-${index}`}
                className="cc-milestone opacity-40"
              >
                <span className="font-data text-[11px] text-[var(--dimmer)]">
                  {project.done + 2 + index}
                </span>
                <span className="text-sm leading-[1.35]">{mile.title}</span>
                <span className="font-data whitespace-nowrap text-[11px] text-[var(--dimmer)]">
                  {mile.costCredits} {CREDIT_SYMBOL}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[10px] text-[var(--dimmer)]">
            After every ship the agent adds one new concrete milestone, so the
            roadmap keeps rolling.
          </div>
        </section>
      ) : null}

      {events.length ? (
        <section>
          <div className="cc-section">
            <span className="cc-label">activity</span>
          </div>
          <div className="cc-activity">
            {events.slice(0, 8).map((event) => (
              <div
                key={event.id}
                className="grid grid-cols-[72px_1fr] gap-3 border-b border-[var(--line)] py-2.5 text-[11px] last:border-0"
              >
                <span className="font-data text-[var(--dimmer)]">
                  {ago(event.createdAt)}
                </span>
                <span className="text-[var(--dim)]">{event.message}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix: string;
}) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-black/10 px-3 py-2.5">
      <div className="cc-label">{label}</div>
      <div className="font-data mt-1 text-[14px]">
        {value}{" "}
        <span className="text-[9px] text-[var(--dimmer)]">{suffix}</span>
      </div>
    </div>
  );
}

function statusLabel(status: string): string {
  if (status === "waiting_funds") return "waiting for money";
  if (status === "validating") return "validating";
  if (status === "publishing") return "publishing";
  return status.replaceAll("_", " ");
}

function isActive(status: string): boolean {
  return ["planning", "queued", "working", "validating", "publishing"].includes(
    status,
  );
}
