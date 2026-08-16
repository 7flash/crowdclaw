import { render } from "tradjs/client";
import { HomeView } from "../src/client/components/HomeView";
import * as api from "../src/client/api";
import type { Project } from "../src/shared/types";

export default function mount() {
  const root = document.getElementById("crowdclaw-home");
  if (!root) return;

  const abort = new AbortController();
  let disposed = false;
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
      if (!disposed) fn();
    }, ms);
    timers.add(timer);
    return timer;
  };

  const draw = () => {
    if (disposed) return;
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
    if (!id || disposed) return;
    try {
      const bundle = await api.getProject(id, abort.signal);
      if (disposed) return;
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
      if (!abort.signal.aborted) {
        state.error = message(error);
        draw();
      }
    }
  };

  const create = async () => {
    const idea = state.draft.trim();
    if (idea.length < 10 || state.creating) return;
    state.creating = true;
    state.error = null;
    draw();
    try {
      const project = await api.createProject(idea, abort.signal);
      if (disposed) return;
      state.planningProject = project;
      state.projects = [
        project,
        ...state.projects.filter((item) => item.id !== project.id),
      ];
      state.visibleMilestones = 0;
      draw();
      await refreshPlanning();
      if (!disposed && state.planningProject?.status === "planning") {
        planPoll = setInterval(() => void refreshPlanning(), 400);
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        state.creating = false;
        state.error = message(error);
        draw();
      }
    }
  };

  draw();
  void api
    .listProjects(abort.signal)
    .then((projects) => {
      if (!disposed && !state.planningProject) {
        state.projects = projects;
        draw();
      }
    })
    .catch(() => {});

  return () => {
    disposed = true;
    abort.abort();
    stopPlanPoll();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    render(null, root);
  };
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
