import { SOL_LAMPORTS } from "../../shared/constants";
import { publicErrorLabel } from "../../shared/public-error";
import type { Project } from "../../shared/types";
import { BrandBar } from "./BrandBar";

export type HomeViewProps = {
  projects: Project[];
  creating: boolean;
  starting: boolean;
  planningProject: Project | null;
  draft: string;
  onDraft: (value: string) => void;
  lamportsPerCredit: number;
  onCreate: () => void;
  onStart: () => void;
  error?: string | null;
};

export function HomeView(props: HomeViewProps) {
  const planning = props.creating || Boolean(props.planningProject);
  return (
    <div className="cc min-h-screen">
      <BrandBar />
      <div
        className={`mx-auto px-5 pb-16 ${planning ? "max-w-[700px]" : "max-w-[700px]"}`}
      >
        {!planning ? (
          <section className="cc-rise pt-[78px] pb-[30px] text-center">
            <h1 className="font-display m-0 mb-8 text-[clamp(2.7rem,8vw,4.8rem)] font-extrabold leading-[.88] tracking-[-.025em]">
              Describe your{" "}
              <em className="not-italic text-[var(--claw)]">Idea</em>.
            </h1>

            <div className="cc-box text-left">
              <textarea
                className="min-h-[94px] w-full resize-none border-0 bg-transparent px-[18px] pt-[18px] pb-1 text-[16.5px] leading-6 outline-none placeholder:text-[var(--dimmer)]"
                value={props.draft}
                maxLength={2000}
                aria-label="Idea"
                aria-describedby="idea-minimum"
                placeholder="snake, walls closing in"
                onInput={(event: Event) =>
                  props.onDraft(
                    (event.currentTarget as HTMLTextAreaElement).value,
                  )
                }
                onKeyDown={(event: KeyboardEvent) => {
                  if (
                    event.key === "Enter" &&
                    (event.metaKey || event.ctrlKey) &&
                    props.draft.trim().length >= 10 &&
                    !props.creating
                  )
                    props.onCreate();
                }}
              />
              <div className="flex items-center px-[10px] pt-2 pb-[10px]">
                <span
                  id="idea-minimum"
                  className={`font-data px-2 text-[9px] ${props.draft.trim().length >= 10 ? "text-[var(--mint)]" : "text-[var(--dimmer)]"}`}
                >
                  {props.draft.trim().length >= 10
                    ? "✓"
                    : `${props.draft.trim().length}/10`}
                </span>
                <button
                  className="cc-btn cc-btn-primary ml-auto min-w-[54px]"
                  disabled={props.draft.trim().length < 10 || props.creating}
                  onClick={props.onCreate}
                  aria-label="Create"
                >
                  →
                </button>
              </div>
            </div>
            {props.error ? (
              <div className="mt-3 font-data text-[10px] text-[var(--claw)]">
                {publicErrorLabel(props.error)}
              </div>
            ) : null}
          </section>
        ) : (
          <section className="pt-[64px] pb-[30px]">
            <Planning
              project={props.planningProject}
              idea={props.draft}
              creating={props.creating}
              starting={props.starting}
              lamportsPerCredit={props.lamportsPerCredit}
              onStart={props.onStart}
            />
          </section>
        )}

        {!planning && props.projects.length ? (
          <section className="mt-12 border-t border-[var(--line)]">
            {props.projects.map((project) => (
              <a
                key={project.id}
                href={`/projects/${encodeURIComponent(project.id)}`}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-[var(--line)] px-2 py-4 text-left text-[var(--bone)] no-underline transition hover:bg-white/[.025]"
              >
                <span className="font-data truncate text-[12px]">
                  {project.name}
                </span>
                <span className={`cc-status cc-status-${project.status}`}>
                  {shortStatus(project.status)}
                </span>
                <span className="font-data text-[10px] text-[var(--dim)]">
                  {(project.onchainLamports / SOL_LAMPORTS).toFixed(4)} SOL
                </span>
              </a>
            ))}
          </section>
        ) : null}
      </div>
    </div>
  );
}

function Planning({
  project,
  idea,
  starting,
  onStart,
}: {
  project: Project | null;
  idea: string;
  creating: boolean;
  starting: boolean;
  lamportsPerCredit: number;
  onStart: () => void;
}) {
  const preview = parsePlan(project?.streamPreview || "");
  const prompt = (project?.idea || idea).trim();
  const name =
    preview.name ||
    (project && project.name !== "new-project" ? project.name : "");
  const ready = Boolean(
    project &&
    project.milestones.length >= 6 &&
    project.status === "awaiting_start",
  );
  const milestones =
    ready && project
      ? project.milestones
      : preview.milestones.length
        ? preview.milestones
        : project?.milestones || [];
  const error =
    project?.status === "failed"
      ? publicErrorLabel(project.error || project.agentNote)
      : project?.error && !project.currentRunId
        ? publicErrorLabel(project.error)
        : "";
  const runtimeProgress =
    project?.status === "planning"
      ? visibleRuntimeProgress(project.agentNote)
      : "";
  const planningActivity = runtimeProgress;
  const streamedAssistant = preview.assistant;

  return (
    <div className="cc-project-transition cc-plan-shell text-left">
      {prompt ? (
        <div className="max-w-[620px] border-l border-[var(--claw)] pl-4 text-[15px] leading-7 text-[var(--bone)]">
          {prompt}
        </div>
      ) : null}

      {error ? (
        <div className="mt-6 font-data text-[10px] uppercase tracking-[.14em] text-[var(--claw)]">
          {error}
        </div>
      ) : !ready ? (
        <div className="mt-8">
          <div
            className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3"
            aria-label="Planning in progress"
          >
            <span className="cc-plan-signal" aria-hidden="true" />
            <span className="font-data text-[9px] uppercase tracking-[.16em] text-[var(--dim)]">
              PLANNING
            </span>
            <div className="cc-plan-motion min-w-0" aria-hidden="true">
              <i />
            </div>
            <span
              data-plan-clock
              className="font-data text-[9px] text-[var(--dimmer)]"
            />
          </div>
          {planningActivity ? (
            <div className="cc-fade mt-3 flex items-center gap-2 pl-[30px] font-data text-[9px] text-[var(--dimmer)]">
              <span
                className="h-1 w-1 shrink-0 rounded-full bg-[var(--mint)]"
                aria-hidden="true"
              />
              <span className="min-w-0 truncate">{planningActivity}</span>
            </div>
          ) : null}
          {streamedAssistant ? (
            <div className="cc-fade mt-4 max-w-[620px] pl-[30px] text-[12px] leading-5 text-[var(--dim)]">
              {streamedAssistant}
              <span
                className="ml-1 inline-block h-[1em] w-px translate-y-[2px] bg-[var(--mint)] opacity-70"
                aria-hidden="true"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {name ? (
        <div className="cc-project-title font-display cc-fade mt-10 text-[clamp(2.45rem,8vw,3.7rem)] font-extrabold uppercase leading-none">
          {name}
        </div>
      ) : null}

      {milestones.length ? (
        <div className="mt-7 grid gap-[6px]">
          {milestones.slice(0, 6).map((milestone, index) => (
            <div
              key={`${milestone.title}-${index}`}
              className="cc-milestone cc-fade"
            >
              <span className="font-data text-[10px] text-[var(--dimmer)]">
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-sm leading-[1.35]">
                  {milestone.title}
                </span>
                {"goal" in milestone && milestone.goal ? (
                  <span className="mt-1 block text-[11px] leading-5 text-[var(--dimmer)]">
                    {milestone.goal}
                  </span>
                ) : null}
              </span>
              <span aria-hidden="true" />
            </div>
          ))}
        </div>
      ) : null}

      {ready && project ? (
        <div className="cc-fade mt-8 flex justify-end border-t border-[var(--line)] pt-5">
          <button
            className="cc-btn cc-btn-primary min-w-[150px]"
            disabled={starting}
            onClick={onStart}
          >
            {starting ? "…" : "START BUILD →"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function parsePlan(text: string): {
  assistant: string;
  thought: string;
  name: string;
  summary: string;
  milestones: Array<{ title: string; costCredits: number }>;
} {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const assistant = lines
    .filter((line) => line.startsWith("A|"))
    .map((line) => line.slice(2).trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 420);
  const thought =
    lines
      .find((line) => line.startsWith("T|"))
      ?.slice(2)
      .trim() || "";
  const name =
    lines
      .find((line) => line.startsWith("N|"))
      ?.slice(2)
      .trim() || "";
  const summary =
    lines
      .find((line) => line.startsWith("S|"))
      ?.slice(2)
      .trim() || "";
  const milestones = lines
    .filter((line) => line.startsWith("M|"))
    .map((line) => {
      const [title = "", cost = "2"] = line.slice(2).split("|");
      return {
        title: title.trim(),
        costCredits: Math.max(1, Math.min(4, Number.parseInt(cost, 10) || 2)),
      };
    })
    .filter((item) => item.title);
  return { assistant, thought, name, summary, milestones };
}

function visibleRuntimeProgress(value: string): string {
  const message = value.replace(/\s+/g, " ").trim();
  if (!message) return "";
  if (/^(?:THINKING|PLAN|NAME|LOOP|DONE|READY|BUILDING)$/i.test(message))
    return "";
  if (
    /configured service tier .*not advertised as supported|service tier .*will be omitted/i.test(
      message,
    )
  )
    return "";
  if (
    /^(?:Codex (?:turn|command) started|Model step started|Model response received)$/i.test(
      message,
    )
  )
    return "";
  return message.slice(0, 160);
}

function shortStatus(status: Project["status"]): string {
  if (status === "awaiting_start") return "START";
  if (status === "seeding") return "STARTING";
  if (status === "waiting_funds") return "PAUSED";
  if (
    status === "queued" ||
    status === "working" ||
    status === "validating" ||
    status === "publishing"
  )
    return "BUILDING";
  return status.toUpperCase();
}
