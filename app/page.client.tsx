import { render } from "tradjs/client";
import { HomeView } from "../src/client/components/HomeView";
import * as api from "../src/client/api";
import type { Project, ProjectBundle } from "../src/shared/types";
import { DEFAULT_LAMPORTS_PER_CREDIT } from "../src/shared/constants";

export default function mount() {
  const root = document.getElementById("crowdclaw-home");
  if (!root) return;

  let planningSource: EventSource | null = null;
  let fallbackPoll: ReturnType<typeof setInterval> | null = null;
  let state = {
    projects: parseProjects(root.dataset.projects),
    creating: false,
    starting: false,
    planningProject: null as Project | null,
    draft: "",
    error: null as string | null,
    lamportsPerCredit: DEFAULT_LAMPORTS_PER_CREDIT,
  };

  const draw = () =>
    render(
      <HomeView
        projects={state.projects}
        creating={state.creating}
        starting={state.starting}
        planningProject={state.planningProject}
        draft={state.draft}
        onDraft={(draft) => {
          state.draft = draft;
          draw();
        }}
        lamportsPerCredit={state.lamportsPerCredit}
        onCreate={() => void create()}
        onStart={() => void startBuild()}
        error={state.error}
      />,
      root,
    );

  const stopFallback = () => {
    if (fallbackPoll) clearInterval(fallbackPoll);
    fallbackPoll = null;
  };

  const updatePlanningClock = () => {
    const project = state.planningProject;
    const text =
      project && project.status === "planning"
        ? `${Math.max(0, Math.floor((Date.now() - project.createdAt) / 1000))}s`
        : "";
    root.querySelectorAll("[data-plan-clock]").forEach((node) => {
      (node as HTMLElement).textContent = text;
    });
  };
  setInterval(updatePlanningClock, 1000);

  const stopPlanningStream = () => {
    planningSource?.close();
    planningSource = null;
    stopFallback();
  };

  const applyPlanningBundle = (bundle: ProjectBundle) => {
    state.lamportsPerCredit = bundle.lamportsPerCredit;
    state.planningProject = bundle.project;
    state.projects = [
      bundle.project,
      ...state.projects.filter((item) => item.id !== bundle.project.id),
    ];
    state.error = null;
    draw();
    updatePlanningClock();

    // The roadmap is the end of planning, not the beginning of building. Leave
    // the finished roadmap on this page until the creator explicitly confirms it.
    if (
      bundle.project.status === "failed" ||
      bundle.project.status === "awaiting_start"
    ) {
      stopPlanningStream();
    }
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
    if (!fallbackPoll)
      fallbackPoll = setInterval(() => void refreshPlanning(), 2500);
  };

  const connectPlanningStream = (projectId: string) => {
    stopPlanningStream();
    if (typeof EventSource === "undefined") return startFallback();
    const source = new EventSource(api.projectEventsUrl(projectId));
    planningSource = source;
    source.addEventListener("snapshot", (event) => {
      if (planningSource !== source) return;
      try {
        applyPlanningBundle(
          JSON.parse((event as MessageEvent<string>).data) as ProjectBundle,
        );
      } catch {}
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
    state.starting = false;
    state.error = null;
    draw();
    try {
      const project = await api.createProject(idea);
      state.planningProject = project;
      state.projects = [
        project,
        ...state.projects.filter((item) => item.id !== project.id),
      ];
      draw();
      updatePlanningClock();
      connectPlanningStream(project.id);
      void refreshPlanning();
    } catch (error) {
      state.creating = false;
      state.error = message(error);
      draw();
    }
  };

  const startBuild = async () => {
    const project = state.planningProject;
    if (!project || project.status !== "awaiting_start" || state.starting)
      return;
    state.starting = true;
    state.error = null;
    draw();
    try {
      await api.startProject(project.id);
      window.location.assign(`/projects/${encodeURIComponent(project.id)}`);
    } catch (error) {
      state.starting = false;
      state.error = message(error);
      draw();
    }
  };

  const reset = async () => {
    stopPlanningStream();
    state.creating = false;
    state.starting = false;
    state.planningProject = null;
    state.error = null;
    try {
      state.projects = await api.listProjects();
    } catch {}
    draw();
  };

  window.addEventListener("pagehide", () => stopPlanningStream());
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) void reset();
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
