import { render } from "tradjs/client";
import { HomeView } from "../src/client/components/HomeView";
import * as api from "../src/client/api";
import type { Project, ProjectBundle } from "../src/shared/types";

/**
 * Home is its own TradJS 4.3 document. It owns only idea creation + the
 * initial roadmap animation. Planning updates arrive over the project SSE
 * snapshot stream, with slow polling only as a compatibility fallback.
 */
export default function mount() {
  const root = document.getElementById("crowdclaw-home");
  if (!root) return;

  let planningSource: EventSource | null = null;
  let fallbackPoll: ReturnType<typeof setInterval> | null = null;
  let revealStarted = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let state = {
    projects: parseProjects(root.dataset.projects),
    creating: false,
    planningProject: null as Project | null,
    visibleMilestones: 0,
    draft: "",
    error: null as string | null,
  };

  const later = (fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
    return timer;
  };

  const draw = () => {
    render(
      <>
        <HomeView
          projects={state.projects}
          creating={state.creating}
          planningProject={state.planningProject}
          visibleMilestones={state.visibleMilestones}
          draft={state.draft}
          onDraft={(draft) => {
            state.draft = draft;
            draw();
          }}
          onSeed={(draft) => {
            state.draft = draft;
            draw();
            queueMicrotask(() => root.querySelector("textarea")?.focus());
          }}
          onCreate={() => void create()}
        />
        {state.error ? (
          <div className="mx-auto -mt-8 max-w-[660px] px-5 pb-10 text-sm text-[var(--claw)]">
            {state.error}
          </div>
        ) : null}
      </>,
      root,
    );
  };

  const stopFallback = () => {
    if (fallbackPoll) clearInterval(fallbackPoll);
    fallbackPoll = null;
  };

  const stopPlanningStream = () => {
    planningSource?.close();
    planningSource = null;
    stopFallback();
  };

  const clearRevealTimers = () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };

  const revealAndOpen = () => {
    if (revealStarted) return;
    revealStarted = true;
    stopPlanningStream();
    const total = Math.min(3, state.planningProject?.milestones.length || 0);
    state.visibleMilestones = 0;
    draw();
    for (let index = 1; index <= total; index += 1) {
      later(() => {
        state.visibleMilestones = index;
        draw();
      }, index * 260);
    }
    later(
      () => {
        const link = document.getElementById(
          "crowdclaw-created-project-link",
        ) as HTMLAnchorElement | null;
        link?.click();
      },
      total * 260 + 700,
    );
  };

  const applyPlanningBundle = (bundle: ProjectBundle) => {
    state.planningProject = bundle.project;
    state.projects = [
      bundle.project,
      ...state.projects.filter((item) => item.id !== bundle.project.id),
    ];
    state.error =
      bundle.project.status === "failed"
        ? bundle.project.error || "planning failed"
        : null;
    draw();
    if (
      bundle.project.milestones.length === 3 &&
      bundle.project.status !== "planning"
    )
      revealAndOpen();
  };

  const refreshPlanning = async () => {
    const id = state.planningProject?.id;
    if (!id) return;
    try {
      applyPlanningBundle(await api.getProject(id));
    } catch (error) {
      state.error = message(error);
      draw();
    }
  };

  const startFallback = () => {
    if (fallbackPoll) return;
    fallbackPoll = setInterval(() => void refreshPlanning(), 2500);
  };

  const connectPlanningStream = (projectId: string) => {
    stopPlanningStream();
    if (typeof EventSource === "undefined") {
      startFallback();
      return;
    }
    const source = new EventSource(api.projectEventsUrl(projectId));
    planningSource = source;
    source.addEventListener("snapshot", (event) => {
      if (planningSource !== source) return;
      try {
        applyPlanningBundle(
          JSON.parse((event as MessageEvent<string>).data) as ProjectBundle,
        );
      } catch {
        // Next snapshot is authoritative.
      }
    });
    source.addEventListener("gone", () => {
      if (planningSource !== source) return;
      state.error = "project no longer exists";
      draw();
      stopPlanningStream();
    });
    source.onopen = () => {
      if (planningSource === source) stopFallback();
    };
    source.onerror = () => {
      if (planningSource === source) startFallback();
    };
  };

  const create = async () => {
    const idea = state.draft.trim();
    if (idea.length < 10 || state.creating) return;
    state.creating = true;
    state.error = null;
    draw();
    try {
      const project = await api.createProject(idea);
      state.planningProject = project;
      state.projects = [
        project,
        ...state.projects.filter((item) => item.id !== project.id),
      ];
      state.visibleMilestones = 0;
      draw();
      connectPlanningStream(project.id);
      // Prime once immediately in case EventSource establishment is delayed.
      void refreshPlanning();
    } catch (error) {
      state.creating = false;
      state.error = message(error);
      draw();
    }
  };

  const reloadHomeSnapshot = async () => {
    stopPlanningStream();
    clearRevealTimers();
    revealStarted = false;
    state.creating = false;
    state.planningProject = null;
    state.visibleMilestones = 0;
    state.error = null;
    draw();
    try {
      state.projects = await api.listProjects();
      draw();
    } catch {
      // Server-rendered list remains usable if refresh fails.
    }
  };

  window.addEventListener("pagehide", () => stopPlanningStream());
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) void reloadHomeSnapshot();
  });

  draw();
  void api
    .listProjects()
    .then((projects) => {
      if (!state.planningProject) {
        state.projects = projects;
        draw();
      }
    })
    .catch(() => {});
}

function parseProjects(raw: string | undefined): Project[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Project[];
  } catch {
    return [];
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "request failed";
}
