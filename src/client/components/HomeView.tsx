import { SOL_LAMPORTS } from "../../shared/constants";
import { publicErrorLabel } from "../../shared/public-error";
import type { Project } from "../../shared/types";
import { BrandBar } from "./BrandBar";

export type HomeViewProps = {
  projects: Project[];
  creating: boolean;
  planningProject: Project | null;
  draft: string;
  onDraft: (value: string) => void;
  lamportsPerCredit: number;
  onCreate: () => void;
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
            <h1 className="font-display m-0 mb-5 text-[clamp(2.7rem,8vw,4.8rem)] font-extrabold leading-[.88] tracking-[-.025em]">
              Describe your{" "}
              <em className="not-italic text-[var(--claw)]">Idea</em>.<br />
              Agent keeps building it.
            </h1>
            <p className="mx-auto mb-8 max-w-[520px] text-[14px] leading-6 text-[var(--dim)]">
              Anyone can fund it. Supporters steer what it builds next.
            </p>

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
              lamportsPerCredit={props.lamportsPerCredit}
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
  creating,
  lamportsPerCredit,
}: {
  project: Project | null;
  idea: string;
  creating: boolean;
  lamportsPerCredit: number;
}) {
  const preview = parsePlan(project?.streamPreview || "");
  const name =
    preview.name ||
    (project && project.name !== "new-project" ? project.name : "");
  const summary =
    preview.summary ||
    (project && project.name !== "new-project" ? project.summary : "");
  const thought = preview.thought;
  const milestones = preview.milestones.length
    ? preview.milestones
    : project?.milestones || [];
  const ready = Boolean(
    project && project.milestones.length === 3 && project.status !== "planning",
  );
  const stage = planStage({
    project,
    creating,
    name,
    summary,
    milestones: milestones.length,
  });

  return (
    <div className="cc-project-transition cc-plan-shell text-left">
      <div className="cc-plan-idea">{project?.idea || idea}</div>

      <div className="cc-plan-state">
        <span className="cc-plan-signal" aria-hidden="true" />
        <span key={stage} className="cc-fade">
          {stage}
        </span>
        {project?.agentId ? (
          <span className="ml-auto text-[var(--dimmer)]">
            {project.agentId}
          </span>
        ) : null}
      </div>
      {!ready ? (
        <div className="cc-plan-motion" aria-hidden="true">
          <i />
        </div>
      ) : null}

      <div className="mt-8 min-h-[58px]">
        {name ? (
          <div className="cc-project-title font-display cc-fade text-[clamp(2.35rem,8vw,3.55rem)] font-extrabold uppercase leading-none">
            {name}
          </div>
        ) : null}
      </div>

      {thought ? (
        <div className="cc-plan-thought cc-fade">{thought}</div>
      ) : null}
      {summary ? (
        <div className="cc-fade mt-2 max-w-[600px] text-[13px] leading-5 text-[var(--dim)]">
          {summary}
        </div>
      ) : null}

      <div className="mt-7 grid gap-[6px]">
        {[0, 1, 2].map((index) => {
          const milestone = milestones[index];
          if (!milestone) {
            return (
              <div key={index} className="cc-plan-row-empty">
                <span>{index + 1}</span>
                <i />
              </div>
            );
          }
          return (
            <div
              key={`${milestone.title}-${index}`}
              className={`cc-milestone cc-fade ${index === 0 ? "cc-next" : "opacity-60"}`}
            >
              <span className="font-data text-[10px] text-[var(--dimmer)]">
                {index + 1}
              </span>
              <span className="text-sm leading-[1.35]">{milestone.title}</span>
              <span className="font-data text-[10px] text-[var(--dimmer)]">
                {(
                  (milestone.costCredits * lamportsPerCredit) /
                  SOL_LAMPORTS
                ).toFixed(4)}{" "}
                SOL
              </span>
            </div>
          );
        })}
      </div>

      {ready && project ? (
        <div className="cc-plan-ready cc-fade">
          <span className="font-data text-[10px] tracking-[.16em] text-[var(--mint)]">
            READY
          </span>
          <a
            id="crowdclaw-created-project-link"
            className="cc-btn no-underline"
            href={`/projects/${encodeURIComponent(project.id)}`}
          >
            OPEN →
          </a>
        </div>
      ) : null}
    </div>
  );
}

function planStage(input: {
  project: Project | null;
  creating: boolean;
  name: string;
  summary: string;
  milestones: number;
}): string {
  if (!input.project) return input.creating ? "ASSIGNING" : "READY";
  if (input.project.status === "planning" && input.project.retryAt > Date.now())
    return input.project.agentNote || "BUSY";
  if (input.project.status === "failed")
    return publicErrorLabel(input.project.error || input.project.agentNote);
  if (input.project.error && !input.project.currentRunId)
    return publicErrorLabel(input.project.error);
  if (input.milestones >= 3) return "READY";
  if (input.milestones > 0) return `${input.milestones} / 3`;
  if (input.summary || input.name) return "PLAN";
  return input.project.currentRunId ? "THINKING" : "ASSIGNING";
}

function parsePlan(text: string): {
  thought: string;
  name: string;
  summary: string;
  milestones: Array<{ title: string; costCredits: number }>;
} {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
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
  return { thought, name, summary, milestones };
}

function shortStatus(status: Project["status"]): string {
  if (status === "seeding") return "FUNDING";
  if (status === "waiting_funds") return "WAITING";
  if (
    status === "working" ||
    status === "validating" ||
    status === "publishing"
  )
    return "BUILDING";
  return status.toUpperCase();
}
