import { render } from "tradjs/client";
import { App, type AppActions } from "../src/client/components/App";
import { initialState, type AppState, type Tab } from "../src/client/state";
import * as api from "../src/client/api";
import type { Project, ProjectBundle } from "../src/shared/types";

export default function mount() {
  const root = document.getElementById("crowdclaw-root");
  if (!root) return;

  let state: AppState = { ...initialState };
  let disposed = false;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  const draw = () => render(<App state={state} actions={actions} />, root);
  const patch = (next: Partial<AppState>) => {
    if (disposed) return;
    state = { ...state, ...next };
    draw();
  };
  const toast = (text: string) => {
    if (toastTimer) clearTimeout(toastTimer);
    patch({ toast: text });
    toastTimer = setTimeout(() => patch({ toast: null }), 1600);
  };

  const setProjectUrl = (id: string | null, replace = false) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("p", id);
    else url.searchParams.delete("p");
    if (replace) history.replaceState({}, "", url);
    else history.pushState({}, "", url);
  };

  const loadProjects = async () => {
    try {
      const projects = await api.listProjects();
      patch({ projects, loading: false, error: null });
    } catch (error) {
      patch({ loading: false, error: message(error) });
    }
  };

  const openId = async (id: string, refresh = false, updateUrl = false) => {
    if (refresh) patch({ refreshing: true });
    try {
      const bundle = await api.getProject(id);
      const sameProject = state.bundle?.project.id === id;
      const priorVersions = sameProject
        ? state.bundle?.artifacts.length || 0
        : -1;
      const changed = !sameProject || priorVersions !== bundle.artifacts.length;
      patch({
        view: "project",
        bundle,
        refreshing: false,
        error: null,
        selectedVersion: changed ? null : state.selectedVersion,
        artifactCode: changed ? null : state.artifactCode,
        artifactCodeVersion: changed ? null : state.artifactCodeVersion,
      });
      if (updateUrl) setProjectUrl(id);
    } catch (error) {
      patch({ refreshing: false, error: message(error) });
    }
  };

  const actions: AppActions = {
    home() {
      patch({
        view: "home",
        bundle: null,
        error: null,
        selectedVersion: null,
        artifactCode: null,
        artifactCodeVersion: null,
        tab: "play",
      });
      setProjectUrl(null);
      window.scrollTo({ top: 0 });
      void loadProjects();
    },
    setDraft(value) {
      state.draft = value;
      draw();
    },
    seed(value) {
      patch({ draft: value });
      queueMicrotask(() =>
        (root.querySelector("textarea") as HTMLTextAreaElement | null)?.focus(),
      );
    },
    async create() {
      const idea = state.draft.trim();
      if (idea.length < 10 || state.creating) return;
      patch({ creating: true, error: null });
      try {
        const project = await api.createProject(idea);
        state = {
          ...state,
          creating: false,
          draft: "",
          projects: [
            project,
            ...state.projects.filter((item) => item.id !== project.id),
          ],
          view: "project",
          bundle: emptyBundle(project),
          selectedVersion: null,
          artifactCode: null,
          artifactCodeVersion: null,
          tab: "play",
          error: null,
        };
        draw();
        setProjectUrl(project.id);
        window.scrollTo({ top: 0 });
        void openId(project.id, false, false);
      } catch (error) {
        patch({ creating: false, error: message(error) });
      }
    },
    open(project) {
      patch({
        view: "project",
        bundle: emptyBundle(project),
        selectedVersion: null,
        artifactCode: null,
        artifactCodeVersion: null,
        tab: "play",
        error: null,
      });
      setProjectUrl(project.id);
      window.scrollTo({ top: 0 });
      void openId(project.id);
    },
    setTab(tab: Tab) {
      patch({ tab });
      if (tab !== "code") return;
      const bundle = state.bundle;
      if (!bundle?.artifacts.length) return;
      const latest = bundle.artifacts[bundle.artifacts.length - 1];
      const version = state.selectedVersion ?? latest.version;
      if (state.artifactCodeVersion === version && state.artifactCode != null)
        return;
      void api
        .getArtifactCode(bundle.project.id, version)
        .then((code) =>
          patch({ artifactCode: code, artifactCodeVersion: version }),
        )
        .catch((error) => patch({ error: message(error) }));
    },
    selectVersion(version: number) {
      patch({
        selectedVersion: version,
        artifactCode: null,
        artifactCodeVersion: null,
        tab: "play",
      });
    },
    async copyWallet() {
      const address = state.bundle?.project.walletAddress;
      if (!address) return;
      try {
        await navigator.clipboard.writeText(address);
        toast("wallet address copied");
      } catch {
        toast(address);
      }
    },
    async syncFunding() {
      const id = state.bundle?.project.id;
      if (!id || state.refreshing) return;
      patch({ refreshing: true });
      try {
        await api.syncFunding(id);
        await openId(id, false, false);
        toast("funding refreshed");
      } catch (error) {
        patch({ refreshing: false, error: message(error) });
      }
    },
    async devFund() {
      const id = state.bundle?.project.id;
      if (!id) return;
      try {
        await api.devFund(id, 2);
        await openId(id, false, false);
        toast("+2 dev credits");
      } catch (error) {
        patch({ error: message(error) });
      }
    },
    async share() {
      const project = state.bundle?.project;
      if (!project) return;
      const url = new URL(window.location.href);
      url.searchParams.set("p", project.id);
      try {
        if (navigator.share) {
          await navigator.share({
            title: `${project.name} · CrowdClaw`,
            text: project.summary,
            url: url.toString(),
          });
        } else {
          await navigator.clipboard.writeText(url.toString());
          toast("project link copied");
        }
      } catch (error) {
        if ((error as Error)?.name !== "AbortError") toast("could not share");
      }
    },
  };

  const onPopState = () => {
    const id = new URL(window.location.href).searchParams.get("p");
    if (id) void openId(id);
    else
      patch({
        view: "home",
        bundle: null,
        selectedVersion: null,
        artifactCode: null,
        artifactCodeVersion: null,
        tab: "play",
      });
  };
  window.addEventListener("popstate", onPopState);

  draw();
  const initialId = new URL(window.location.href).searchParams.get("p");
  if (initialId) {
    patch({ view: "project", loading: false });
    void openId(initialId);
  } else {
    void loadProjects();
  }

  const poll = setInterval(() => {
    const id = state.bundle?.project.id;
    if (!disposed && state.view === "project" && id && !state.refreshing)
      void openId(id, true, false);
  }, 3000);

  return () => {
    disposed = true;
    clearInterval(poll);
    if (toastTimer) clearTimeout(toastTimer);
    window.removeEventListener("popstate", onPopState);
    render(null, root);
  };
}

function emptyBundle(project: Project): ProjectBundle {
  return {
    project,
    artifacts: [],
    runs: [],
    events: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      buildTokens: 0,
      tokensPerSpentCredit: 0,
      estimatedFundedTokenRunway: 0,
      latestContextTokens: 0,
      contextWindow: 200000,
      remainingContextTokens: 200000,
    },
    lamportsPerCredit: 10_000_000,
    devFundingEnabled: false,
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "request failed";
}
