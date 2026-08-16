import { render } from "tradjs/client";
import { HomeView } from "../src/client/components/HomeView";
import * as api from "../src/client/api";
import type { Project } from "../src/shared/types";

/**
 * Home is its own document in TradJS 4.3.0.
 * It owns only idea creation + the initial roadmap animation.
 * Project navigation is a normal browser navigation to /projects/:id.
 */
export default function mount() {
  const root = document.getElementById("crowdclaw-home");
  if (!root) return;

  let planPoll: ReturnType<typeof setInterval> | null = null;
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

  const stopPlanPoll = () => {
    if (planPoll) clearInterval(planPoll);
    planPoll = null;
  };

  const clearRevealTimers = () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };

  const revealAndOpen = () => {
    if (revealStarted) return;
    revealStarted = true;
    stopPlanPoll();
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
        // TradJS 4.3.0 intentionally leaves links alone. Clicking this anchor
        // performs a real same-origin document navigation, eligible for the
        // browser-native cross-document View Transition configured by TradJS.
        const link = document.getElementById(
          "crowdclaw-created-project-link",
        ) as HTMLAnchorElement | null;
        link?.click();
      },
      total * 260 + 700,
    );
  };

  const refreshPlanning = async () => {
    const id = state.planningProject?.id;
    if (!id) return;
    try {
      const bundle = await api.getProject(id);
      state.planningProject = bundle.project;
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
    } catch (error) {
      state.error = message(error);
      draw();
    }
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
      await refreshPlanning();
      if (state.planningProject?.status === "planning") {
        planPoll = setInterval(() => void refreshPlanning(), 400);
      }
    } catch (error) {
      state.creating = false;
      state.error = message(error);
      draw();
    }
  };

  const reloadHomeSnapshot = async () => {
    stopPlanPoll();
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
      // The server-rendered list is still usable if refresh fails.
    }
  };

  // A Back navigation may restore this exact document from BFCache. In that
  // case the old "opening agent" state would otherwise remain on screen.
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
