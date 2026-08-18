import { SOL_LAMPORTS } from "../../shared/constants";
import type { Project } from "../../shared/types";
import { BrandBar } from "./BrandBar";

export type DiscoverSort = "trending" | "new" | "voted" | "funded";

export function DiscoverView(props: {
  projects: Project[];
  query?: string;
  sort?: DiscoverSort;
  onQuery?: (value: string) => void;
  onSort?: (value: DiscoverSort) => void;
}) {
  const query = (props.query || "").trim().toLowerCase();
  const sort = props.sort || "trending";
  const visible = [...props.projects]
    .filter((project) => project.name !== "new-project")
    .filter((project) => {
      if (!query) return true;
      return `${project.name} ${project.summary} ${project.idea}`
        .toLowerCase()
        .includes(query);
    })
    .sort((a, b) => compareProjects(a, b, sort));

  return (
    <div className="cc min-h-screen">
      <BrandBar />
      <main className="mx-auto max-w-[1120px] px-5 pb-20 pt-10">
        <header className="mb-5 flex items-end justify-between gap-4 border-b border-[var(--line)] pb-5">
          <div>
            <h1 className="font-display m-0 text-[clamp(2.7rem,7vw,4.7rem)] font-extrabold uppercase leading-[.88] tracking-[-.025em]">
              Discover
            </h1>
            <p className="mb-0 mt-3 max-w-[560px] text-[12px] leading-5 text-[var(--dim)]">
              Play live projects and push the roadmap toward what you want next.
            </p>
          </div>
          <span className="font-data text-[9px] text-[var(--dimmer)]">
            {visible.length} PROJECTS
          </span>
        </header>

        <div className="mb-5 flex flex-wrap items-center gap-2">
          <input
            className="cc-input min-w-[220px] flex-1"
            value={props.query || ""}
            placeholder="Search projects"
            aria-label="Search projects"
            onInput={(event: Event) =>
              props.onQuery?.((event.currentTarget as HTMLInputElement).value)
            }
          />
          <div className="flex items-center gap-1">
            {(["trending", "new", "voted", "funded"] as DiscoverSort[]).map(
              (option) => (
                <button
                  key={option}
                  className={`cc-mini ${sort === option ? "text-[var(--mint)]" : ""}`}
                  onClick={() => props.onSort?.(option)}
                >
                  {option.toUpperCase()}
                </button>
              ),
            )}
          </div>
        </div>

        {visible.length ? (
          <div className="grid grid-cols-2 gap-3 max-[760px]:grid-cols-1">
            {visible.map((project) => {
              const votes = projectVotes(project);
              const next = project.milestones[project.done];
              const topFuture = [
                ...project.milestones.slice(project.done + 1),
              ].sort((a, b) => Number(b.votes || 0) - Number(a.votes || 0))[0];
              return (
                <a
                  key={project.id}
                  href={`/projects/${encodeURIComponent(project.id)}`}
                  className="group rounded-[8px] border border-[var(--line)] bg-[#071014] p-5 text-[var(--bone)] no-underline transition hover:border-[rgba(79,227,193,.35)] hover:bg-[#091318]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <h2 className="font-display m-0 text-[clamp(1.8rem,4vw,2.7rem)] font-extrabold uppercase leading-[.9] tracking-[-.015em]">
                      {project.name}
                    </h2>
                    <span className="font-data whitespace-nowrap text-[8px] uppercase tracking-[.12em] text-[var(--dimmer)]">
                      {project.done}/{project.milestones.length}
                    </span>
                  </div>
                  <p className="mb-4 mt-3 min-h-[40px] text-[11px] leading-5 text-[var(--dim)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden">
                    {project.summary || project.idea}
                  </p>
                  {next ? (
                    <div className="mb-4 border-l border-[rgba(255,92,43,.38)] pl-3">
                      <div className="font-data text-[8px] uppercase tracking-[.12em] text-[var(--dimmer)]">
                        NEXT
                      </div>
                      <div className="mt-1 truncate text-[11px] text-[var(--bone)]">
                        {next.title}
                      </div>
                      {topFuture && Number(topFuture.votes || 0) > 0 ? (
                        <div className="mt-1 truncate font-data text-[8px] text-[var(--mint)]">
                          ▲ {topFuture.votes} {topFuture.title}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="flex items-center gap-4 border-t border-[var(--line)] pt-3 font-data text-[8px] uppercase tracking-[.1em] text-[var(--dimmer)]">
                    <span>{statusLabel(project.status)}</span>
                    <span>▲ {votes}</span>
                    <span>
                      {(project.creditedLamports / SOL_LAMPORTS).toFixed(4)} SOL
                    </span>
                    <span className="ml-auto text-[var(--mint)] opacity-0 transition group-hover:opacity-100">
                      OPEN →
                    </span>
                  </div>
                </a>
              );
            })}
          </div>
        ) : (
          <div className="border-y border-[var(--line)] py-12 text-center font-data text-[10px] text-[var(--dimmer)]">
            NO MATCHING PROJECTS
          </div>
        )}
      </main>
    </div>
  );
}

function projectVotes(project: Project): number {
  return project.milestones.reduce(
    (sum, milestone) => sum + Math.max(0, Number(milestone.votes || 0)),
    0,
  );
}

function compareProjects(a: Project, b: Project, sort: DiscoverSort): number {
  if (sort === "new") return b.createdAt - a.createdAt;
  if (sort === "voted")
    return projectVotes(b) - projectVotes(a) || b.updatedAt - a.updatedAt;
  if (sort === "funded")
    return b.creditedLamports - a.creditedLamports || b.updatedAt - a.updatedAt;
  return discoveryScore(b) - discoveryScore(a);
}

function discoveryScore(project: Project): number {
  return (
    project.done * 100 +
    projectVotes(project) * 15 +
    project.creditedLamports / 100_000 +
    project.updatedAt / 1e12
  );
}

function statusLabel(status: Project["status"]): string {
  if (status === "awaiting_start") return "READY";
  if (["queued", "working", "validating", "publishing"].includes(status))
    return "BUILDING";
  if (status === "waiting_funds") return "PAUSED";
  if (status === "completed") return "COMPLETE";
  if (status === "failed") return "STOPPED";
  return status.toUpperCase();
}
