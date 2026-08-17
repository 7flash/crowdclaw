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
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  let state = {
    projects: parseProjects(root.dataset.projects),
    creating: false,
    planningProject: null as Project | null,
    draft: "",
    error: null as string | null,
    lamportsPerCredit: DEFAULT_LAMPORTS_PER_CREDIT,
  };

  const draw = () =>
    render(
      <>
        <HomeView
          projects={state.projects}
          creating={state.creating}
          planningProject={state.planningProject}
          draft={state.draft}
          onDraft={(draft) => {
            state.draft = draft;
            draw();
          }}
          lamportsPerCredit={state.lamportsPerCredit}
          onCreate={() => void create()}
          error={state.error}
        />
      </>,
      root,
    );

  const stopFallback = () => {
    if (fallbackPoll) clearInterval(fallbackPoll);
    fallbackPoll = null;
  };

  const stopPlanningStream = () => {
    planningSource?.close();
    planningSource = null;
    stopFallback();
  };

  const scheduleOpen = () => {
    if (openTimer) return;
    openTimer = setTimeout(() => {
      openTimer = null;
      (
        document.getElementById(
          "crowdclaw-created-project-link",
        ) as HTMLAnchorElement | null
      )?.click();
    }, 260);
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
    if (bundle.project.status === "failed") {
      stopPlanningStream();
      return;
    }
    if (
      bundle.project.milestones.length === 3 &&
      bundle.project.status !== "planning"
    ) {
      stopPlanningStream();
      scheduleOpen();
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
      connectPlanningStream(project.id);
      void refreshPlanning();
    } catch (error) {
      state.creating = false;
      state.error = message(error);
      draw();
    }
  };

  const reset = async () => {
    stopPlanningStream();
    if (openTimer) clearTimeout(openTimer);
    openTimer = null;
    state.creating = false;
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
