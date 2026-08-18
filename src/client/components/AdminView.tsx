import { BrandBar } from "./BrandBar";

export type AdminAgent = {
  name: string;
  projectId: string;
  projectName: string;
  projectStatus: string;
  phase: "plan" | "build" | "legacy";
  pid: number;
  running: boolean;
  verified: boolean;
  stoppedByAdmin: boolean;
  canStop: boolean;
  canRestart: boolean;
  historical: boolean;
  command: string;
  directory: string;
  startedAt: number;
};

export function AdminView(props: {
  agents: AdminAgent[];
  registryCount: number;
  selected: string;
  stdout: string;
  stderr: string;
  token: string;
  error: string;
  busy: string;
  onToken: (value: string) => void;
  onApplyToken: () => void;
  onSelect: (name: string) => void;
  onRefresh: () => void;
  onStop: (name: string) => void;
  onRestart: (name: string) => void;
  onRefreshLogs: () => void;
}) {
  const selected = props.agents.find((item) => item.name === props.selected);
  const running = props.agents.filter((item) => item.running).length;
  return (
    <div className="cc min-h-screen">
      <BrandBar />
      <main className="mx-auto max-w-[1120px] px-5 pb-20 pt-8">
        <header className="mb-5 flex items-end gap-4 border-b border-[var(--line)] pb-5">
          <div>
            <h1 className="font-display m-0 text-[clamp(2.5rem,7vw,4.5rem)] font-extrabold uppercase leading-[.88] tracking-[-.025em]">
              Agents
            </h1>
            <div className="mt-2 font-data text-[9px] text-[var(--dimmer)]">
              BGRUN · {running} RUNNING · {props.agents.length} PROJECTS ·{" "}
              {props.registryCount} RECORDS
            </div>
          </div>
          <button className="cc-mini ml-auto" onClick={props.onRefresh}>
            REFRESH
          </button>
        </header>

        {props.error ? (
          <div className="mb-4 rounded-[6px] border border-[rgba(255,92,43,.3)] bg-[rgba(255,92,43,.04)] px-4 py-3 font-data text-[9px] leading-4 text-[var(--claw)]">
            {props.error}
          </div>
        ) : null}

        {props.error.toLowerCase().includes("authorization") ? (
          <div className="mb-5 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <input
              className="cc-input"
              type="password"
              value={props.token}
              placeholder="CROWDCLAW_ADMIN_TOKEN"
              aria-label="Admin token"
              onInput={(event: Event) =>
                props.onToken((event.currentTarget as HTMLInputElement).value)
              }
              onKeyDown={(event: KeyboardEvent) => {
                if (event.key === "Enter") props.onApplyToken();
              }}
            />
            <button className="cc-btn" onClick={props.onApplyToken}>
              OPEN
            </button>
          </div>
        ) : null}

        <div className="grid grid-cols-[minmax(300px,.8fr)_minmax(0,1.5fr)] gap-4 max-[820px]:grid-cols-1">
          <section className="overflow-hidden rounded-[7px] border border-[var(--line)] bg-[#071014]">
            {props.agents.length ? (
              props.agents.map((agent) => (
                <button
                  key={agent.projectId}
                  className={`grid w-full grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-3 border-0 border-b border-[var(--line)] bg-transparent px-4 py-3 text-left last:border-b-0 ${props.selected === agent.name ? "bg-white/[.035]" : "hover:bg-white/[.02]"}`}
                  onClick={() => props.onSelect(agent.name)}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${agent.stoppedByAdmin ? "bg-[var(--claw)]" : agent.running ? "bg-[var(--mint)]" : agent.projectStatus === "failed" ? "bg-[var(--claw)]" : "bg-[var(--dimmer)]"}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-data text-[9px] text-[var(--bone)]">
                      {agent.projectName}
                    </span>
                    <span className="mt-1 block truncate font-data text-[8px] uppercase tracking-[.1em] text-[var(--dimmer)]">
                      {agent.phase} · {agent.projectStatus.replaceAll("_", " ")}{" "}
                      · PID {agent.pid || "—"}
                      {agent.running && !agent.verified ? " · UNVERIFIED" : ""}
                    </span>
                  </span>
                  <span className="font-data text-[8px] uppercase text-[var(--dimmer)]">
                    {agentState(agent)}
                  </span>
                </button>
              ))
            ) : (
              <div className="px-4 py-10 text-center font-data text-[9px] text-[var(--dimmer)]">
                NO AGENTS
              </div>
            )}
          </section>

          <section className="min-w-0 overflow-hidden rounded-[7px] border border-[var(--line)] bg-[#050a0c]">
            {selected ? (
              <>
                <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-3">
                  <span className="min-w-0 truncate font-data text-[9px] text-[var(--bone)]">
                    {selected.projectName}
                  </span>
                  <span className="font-data text-[8px] uppercase tracking-[.1em] text-[var(--dimmer)]">
                    {selected.running
                      ? selected.phase
                      : `LAST ${selected.phase} LOG`}
                  </span>
                  <button
                    className="cc-mini ml-auto"
                    onClick={props.onRefreshLogs}
                  >
                    LOGS
                  </button>
                  <button
                    className="cc-mini"
                    disabled={
                      props.busy === selected.name ||
                      !selected.canRestart ||
                      (selected.running && !selected.verified)
                    }
                    onClick={() => props.onRestart(selected.name)}
                  >
                    {restartLabel(selected)}
                  </button>
                  <button
                    className="cc-mini text-[var(--claw)]"
                    disabled={props.busy === selected.name || !selected.canStop}
                    onClick={() => props.onStop(selected.name)}
                  >
                    STOP
                  </button>
                </div>
                <div className="grid max-h-[620px] grid-cols-2 overflow-auto max-[820px]:grid-cols-1">
                  <LogPane label="STDOUT" text={props.stdout} />
                  <LogPane label="STDERR" text={props.stderr} />
                </div>
              </>
            ) : (
              <div className="flex min-h-[320px] items-center justify-center font-data text-[9px] text-[var(--dimmer)]">
                SELECT AGENT
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function agentState(agent: AdminAgent): string {
  if (agent.running && !agent.verified) return "UNVERIFIED";
  if (agent.stoppedByAdmin) return "PAUSED";
  if (agent.running) return "RUN";
  if (agent.projectStatus === "failed") return "FAILED";
  if (agent.projectStatus === "awaiting_start") return "READY";
  if (agent.projectStatus === "completed") return "DONE";
  if (agent.projectStatus === "waiting_funds") return "FUND";
  return "IDLE";
}

function restartLabel(agent: AdminAgent): string {
  if (agent.stoppedByAdmin) return "RESUME";
  if (agent.projectStatus === "failed") return "RETRY";
  return "RESTART";
}

function LogPane(props: { label: string; text: string }) {
  return (
    <div className="min-w-0 border-r border-[var(--line)] last:border-r-0 max-[820px]:border-r-0 max-[820px]:border-b">
      <div className="sticky top-0 border-b border-[var(--line)] bg-[#071014] px-3 py-2 font-data text-[8px] tracking-[.12em] text-[var(--dimmer)]">
        {props.label}
      </div>
      <pre className="m-0 min-h-[300px] whitespace-pre-wrap break-words p-3 font-data text-[9px] leading-4 text-[var(--dim)]">
        {props.text || "—"}
      </pre>
    </div>
  );
}
