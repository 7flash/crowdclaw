import { CREDIT_SYMBOL, SEEDS } from "../../shared/constants";
import type { Project } from "../../shared/types";
import { BrandBar } from "./BrandBar";

export type HomeViewProps = {
  projects: Project[];
  creating: boolean;
  planningProject: Project | null;
  visibleMilestones: number;
  draft: string;
  onDraft: (value: string) => void;
  onSeed: (value: string) => void;
  onCreate: () => void;
};

export function HomeView(props: HomeViewProps) {
  return (
    <div className="cc min-h-screen">
      <BrandBar />
      <div className="mx-auto max-w-[660px] px-5 pb-16">
        <section className="cc-rise pt-[66px] pb-[26px] text-center">
          <div className="cc-label mb-4 text-[var(--mint)]">
            IDEA → AGENT → PLAYABLE RELEASES
          </div>
          <h1 className="font-display m-0 mb-[20px] text-[clamp(2.4rem,7.4vw,4.4rem)] font-extrabold leading-[.88] tracking-[-.022em]">
            Describe your{" "}
            <em className="not-italic text-[var(--claw)]">game</em>.<br />
            The agent keeps building.
          </h1>
          <p className="mx-auto mb-7 max-w-[540px] text-[14px] leading-6 text-[var(--dim)]">
            Every idea gets a project wallet and an autonomous builder. It plans
            here, then the project becomes its own live agent page.
          </p>

          {!props.planningProject ? (
            <>
              <div className="cc-box text-left">
                <textarea
                  className="min-h-[92px] w-full resize-none border-0 bg-transparent px-[18px] pt-[18px] pb-1 text-[16.5px] leading-6 outline-none placeholder:text-[var(--dimmer)]"
                  value={props.draft}
                  placeholder="snake, but the walls close in each time you eat…"
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
                  <span className="cc-label ml-2">
                    agent + wallet assigned automatically
                  </span>
                  <button
                    className="cc-btn cc-btn-primary ml-auto min-w-[92px]"
                    disabled={props.draft.trim().length < 10 || props.creating}
                    onClick={props.onCreate}
                  >
                    {props.creating ? (
                      <span className="cc-spinner" />
                    ) : (
                      "CREATE →"
                    )}
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                {SEEDS.map((seed) => (
                  <button
                    key={seed}
                    className="rounded-full border border-[var(--line)] bg-transparent px-3 py-1.5 text-[12.5px] text-[var(--dim)] transition hover:border-[var(--edge)] hover:text-[var(--bone)]"
                    onClick={() => props.onSeed(seed)}
                  >
                    {seed}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <Planning
              project={props.planningProject}
              visibleMilestones={props.visibleMilestones}
            />
          )}
        </section>

        {!props.planningProject && props.projects.length ? (
          <section className="mt-11">
            <div className="cc-section">
              <span className="cc-label">live projects</span>
            </div>
            <div className="border-t border-[var(--line)]">
              {props.projects.map((project) => (
                <a
                  key={project.id}
                  href={`/projects/${encodeURIComponent(project.id)}`}
                  className="grid w-full grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-[var(--line)] px-[10px] py-[14px] text-left text-[var(--bone)] no-underline transition hover:bg-white/[.03]"
                >
                  <span className="min-w-0">
                    <span className="font-data block text-[12.5px]">
                      {project.name}
                    </span>
                    <span className="block max-w-[42ch] overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] text-[var(--dimmer)]">
                      {project.summary}
                    </span>
                  </span>
                  <span className={`cc-status cc-status-${project.status}`}>
                    {statusLabel(project.status)}
                  </span>
                  <span className="font-data min-w-[60px] text-right text-[11px] text-[var(--dim)]">
                    {project.availableCredits.toFixed(1)} {CREDIT_SYMBOL}
                  </span>
                </a>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function Planning({
  project,
  visibleMilestones,
}: {
  project: Project;
  visibleMilestones: number;
}) {
  const ready =
    project.milestones.length === 3 && project.status !== "planning";
  return (
    <div className="cc-project-transition mt-7 text-left">
      <div className="border-l-2 border-[var(--claw)] pl-3 text-[14px] text-[var(--dim)]">
        {project.idea}
      </div>
      <div className="mt-6 flex items-center gap-3">
        <div className="font-display text-[30px] font-extrabold uppercase leading-none">
          {project.name !== "new-project" ? (
            project.name
          ) : (
            <span className="cc-spinner" />
          )}
        </div>
        <span className="cc-label text-[var(--mint)]">
          {ready ? "roadmap ready" : "claw is planning"}
        </span>
      </div>
      {project.name !== "new-project" ? (
        <div className="mt-2 text-[14px] text-[var(--dim)]">
          {project.summary}
        </div>
      ) : null}
      <div className="mt-5 grid gap-[5px]">
        {project.milestones
          .slice(0, visibleMilestones)
          .map((milestone, index) => (
            <div
              key={`${milestone.title}-${index}`}
              className={`cc-milestone ${index === 0 ? "cc-next" : "opacity-60"}`}
              style={{ animation: "rise .4s backwards" }}
            >
              <span className="font-data text-[11px] text-[var(--claw)]">
                {index + 1}
              </span>
              <span className="text-sm leading-[1.35]">{milestone.title}</span>
              <span className="font-data whitespace-nowrap text-[11px] text-[var(--dimmer)]">
                {milestone.costCredits} {CREDIT_SYMBOL}
              </span>
            </div>
          ))}
        {!ready && project.milestones.length === 0 ? (
          <div className="cc-skeleton mt-1" />
        ) : null}
      </div>
      {ready && visibleMilestones >= 3 ? (
        <div className="mt-5 flex items-center justify-between gap-3">
          <span className="cc-label">agent page is opening…</span>
          <a
            id="crowdclaw-created-project-link"
            className="cc-btn cc-btn-primary no-underline"
            href={`/projects/${encodeURIComponent(project.id)}`}
          >
            OPEN AGENT →
          </a>
        </div>
      ) : null}
    </div>
  );
}

function statusLabel(status: Project["status"]): string {
  if (status === "waiting_funds") return "fund me";
  if (status === "validating" || status === "publishing") return "shipping";
  return status.replace("_", " ");
}
