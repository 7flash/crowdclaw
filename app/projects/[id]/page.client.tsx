import { render } from "tradjs/client";
import {
  ProjectApp,
  type ProjectActions,
} from "../../../src/client/components/ProjectApp";
import * as api from "../../../src/client/api";
import type { ProjectBundle } from "../../../src/shared/types";
import type { Tab } from "../../../src/client/state";

/**
 * The project page is a separate TradJS 4.3.0 document.
 * There is no client router: direct visits, refresh, Back/Forward, and shared
 * links all resolve /projects/:id on the server first, then this enhances it.
 */
export default function mount({ params }: { params: Record<string, string> }) {
  const root = document.getElementById("crowdclaw-project");
  if (!root) return;

  const initial = parseBundle(root.dataset.bundle);
  if (!initial) return;

  const projectId = params.id || initial.project.id;
  let pollBusy = false;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let state = {
    bundle: initial,
    refreshing: false,
    error: null as string | null,
    tab: "play" as Tab,
    selectedVersion: null as number | null,
    artifactCode: null as string | null,
    artifactCodeVersion: null as number | null,
    toast: null as string | null,
  };

  const draw = () => {
    render(
      <ProjectApp
        bundle={state.bundle}
        refreshing={state.refreshing}
        error={state.error}
        tab={state.tab}
        selectedVersion={state.selectedVersion}
        artifactCode={state.artifactCode}
        artifactCodeVersion={state.artifactCodeVersion}
        toast={state.toast}
        actions={actions}
      />,
      root,
    );
  };

  const toast = (text: string) => {
    if (toastTimer) clearTimeout(toastTimer);
    state.toast = text;
    draw();
    toastTimer = setTimeout(() => {
      toastTimer = null;
      state.toast = null;
      draw();
    }, 1600);
  };

  const refresh = async (showSpinner = false) => {
    if (pollBusy) return;
    pollBusy = true;
    if (showSpinner) {
      state.refreshing = true;
      draw();
    }
    try {
      const next = await api.getProject(projectId);
      const previousArtifactCount = state.bundle.artifacts.length;
      state.bundle = next;
      state.refreshing = false;
      state.error = null;
      if (
        state.selectedVersion == null &&
        next.artifacts.length !== previousArtifactCount
      ) {
        state.artifactCode = null;
        state.artifactCodeVersion = null;
        if (state.tab === "code") void loadCurrentCode();
      }
      draw();
    } catch (error) {
      state.refreshing = false;
      state.error = message(error);
      draw();
    } finally {
      pollBusy = false;
    }
  };

  const currentVersion = () => {
    const latest = state.bundle.artifacts[state.bundle.artifacts.length - 1];
    return state.selectedVersion ?? latest?.version ?? null;
  };

  const loadCurrentCode = async () => {
    const version = currentVersion();
    if (!version) return;
    if (state.artifactCodeVersion === version && state.artifactCode != null)
      return;
    try {
      const code = await api.getArtifactCode(projectId, version);
      if (currentVersion() !== version) return;
      state.artifactCode = code;
      state.artifactCodeVersion = version;
      draw();
    } catch (error) {
      state.error = message(error);
      draw();
    }
  };

  const actions: ProjectActions = {
    setTab(tab) {
      state.tab = tab;
      draw();
      if (tab === "code") void loadCurrentCode();
    },
    selectVersion(version) {
      state.selectedVersion = version;
      state.artifactCode = null;
      state.artifactCodeVersion = null;
      state.tab = "play";
      draw();
    },
    async copyWallet() {
      const address = state.bundle.project.walletAddress;
      try {
        await navigator.clipboard.writeText(address);
        toast("wallet address copied");
      } catch {
        toast(address);
      }
    },
    async syncFunding() {
      if (state.refreshing) return;
      state.refreshing = true;
      draw();
      try {
        await api.syncFunding(projectId);
        await refresh(false);
        toast("funding refreshed");
      } catch (error) {
        state.refreshing = false;
        state.error = message(error);
        draw();
      }
    },
    async devFund() {
      try {
        await api.devFund(projectId, 2);
        await refresh(false);
        toast("+2 dev credits");
      } catch (error) {
        state.error = message(error);
        draw();
      }
    },
    async share() {
      const project = state.bundle.project;
      const url = new URL(
        `/projects/${encodeURIComponent(project.id)}`,
        window.location.origin,
      ).toString();
      try {
        if (navigator.share) {
          await navigator.share({
            title: `${project.name} · CrowdClaw`,
            text: project.summary,
            url,
          });
        } else {
          await navigator.clipboard.writeText(url);
          toast("project link copied");
        }
      } catch (error) {
        if ((error as Error)?.name !== "AbortError") toast("could not share");
      }
    },
  };

  // BFCache can restore the project document without rerunning this module.
  // Refresh immediately so agent/funding state catches up before the next poll.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) void refresh(false);
  });

  draw();
  setInterval(() => void refresh(false), 3000);
}

function parseBundle(raw: string | undefined): ProjectBundle | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ProjectBundle;
  } catch {
    return null;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "request failed";
}
