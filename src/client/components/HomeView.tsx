import { SOL_LAMPORTS } from "../../shared/constants";
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
};

export function HomeView(props: HomeViewProps) {
  return (
    <div className="cc min-h-screen">
      <BrandBar />
      <div className="mx-auto max-w-[700px] px-5 pb-16">
        <section className="cc-rise pt-[78px] pb-[30px] text-center">
          <h1 className="font-display m-0 mb-5 text-[clamp(2.7rem,8vw,4.8rem)] font-extrabold leading-[.88] tracking-[-.025em]">
            Describe your{" "}
            <em className="not-italic text-[var(--claw)]">Idea</em>.<br />
            Agent keeps building it.
          </h1>
          <p className="mx-auto mb-8 max-w-[520px] text-[14px] leading-6 text-[var(--dim)]">
            Anyone can fund it. Supporters steer what it builds next.
          </p>

          {!props.planningProject ? (
            <div className="cc-box text-left">
              <textarea
                className="min-h-[94px] w-full resize-none border-0 bg-transparent px-[18px] pt-[18px] pb-1 text-[16.5px] leading-6 outline-none placeholder:text-[var(--dimmer)]"
                value={props.draft}
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
                    props.draft.trim().length > 9 &&
                    !props.creating
                  )
                    props.onCreate();
                }}
              />
              <div className="flex items-center px-[10px] pt-2 pb-[10px]">
                <button
                  className="cc-btn cc-btn-primary ml-auto min-w-[54px]"
                  disabled={props.draft.trim().length < 10 || props.creating}
                  onClick={props.onCreate}
                  aria-label="Create"
                >
                  {props.creating ? <span className="cc-spinner" /> : "→"}
                </button>
              </div>
            </div>
          ) : (
            <Planning
              project={props.planningProject}
              lamportsPerCredit={props.lamportsPerCredit}
            />
          )}
        </section>

        {!props.planningProject && props.projects.length ? (
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
                  {(project.onchainLamports / SOL_LAMPORTS).toFixed(3)} SOL
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
  lamportsPerCredit,
}: {
  project: Project;
  lamportsPerCredit: number;
}) {
  const preview = parsePlan(project.streamPreview);
  const name =
    preview.name || (project.name !== "new-project" ? project.name : "");
  const summary =
    preview.summary || (project.name !== "new-project" ? project.summary : "");
  const milestones = preview.milestones.length
    ? preview.milestones
    : project.milestones;
  return (
    <div className="cc-project-transition mt-8 text-left">
      <div className="border-l-2 border-[var(--claw)] pl-4 text-[14px] text-[var(--dim)]">
        {project.idea}
      </div>
      <div className="mt-7 flex min-h-[34px] items-center gap-3">
        {!name ? (
          <span className="cc-spinner" />
        ) : (
          <div className="font-display text-[32px] font-extrabold uppercase leading-none">
            {name}
          </div>
        )}
      </div>
      {summary ? (
        <div className="mt-2 text-[13px] text-[var(--dim)]">{summary}</div>
      ) : null}
      <div className="mt-5 grid gap-[5px]">
        {milestones.slice(0, 3).map((milestone, index) => (
          <div
            key={`${milestone.title}-${index}`}
            className={`cc-milestone ${index === 0 ? "cc-next" : "opacity-60"}`}
            style={{ animation: "rise .32s backwards" }}
          >
            <span className="font-data text-[10px] text-[var(--dimmer)]">
              {index + 1}
            </span>
            <span className="text-sm leading-[1.35]">{milestone.title}</span>
            <span className="font-data text-[10px] text-[var(--dimmer)]">
              {(
                (milestone.costCredits * lamportsPerCredit) /
                SOL_LAMPORTS
              ).toFixed(3)}{" "}
              SOL
            </span>
          </div>
        ))}
        {!milestones.length ? <div className="cc-skeleton mt-1" /> : null}
      </div>
      {project.status === "failed" ? (
        <div className="mt-4 text-[12px] text-[var(--claw)]">
          {project.error}
        </div>
      ) : null}
      {project.milestones.length === 3 && project.status !== "planning" ? (
        <a
          id="crowdclaw-created-project-link"
          className="sr-only"
          href={`/projects/${encodeURIComponent(project.id)}`}
        >
          OPEN
        </a>
      ) : null}
    </div>
  );
}

function parsePlan(text: string): {
  name: string;
  summary: string;
  milestones: Array<{ title: string; costCredits: number }>;
} {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
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
  return { name, summary, milestones };
}

function shortStatus(status: Project["status"]): string {
  if (status === "waiting_funds") return "WAITING";
  if (
    status === "working" ||
    status === "validating" ||
    status === "publishing"
  )
    return "BUILDING";
  return status.toUpperCase();
}
