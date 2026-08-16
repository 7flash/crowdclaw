import { render } from "tradjs/client";
import {
  ProjectApp,
  type ProjectActions,
} from "../../../src/client/components/ProjectApp";
import * as api from "../../../src/client/api";
import type { ProjectBundle } from "../../../src/shared/types";
import type { Tab } from "../../../src/client/state";

type LiveState = "connecting" | "live" | "fallback";

/**
 * Project is an independent TradJS 4.3 document. Initial state is SSR; an SSE
 * snapshot stream keeps it live. A slow HTTP poll only runs while SSE is down.
 */
export default function mount({ params }: { params: Record<string, string> }) {
  const root = document.getElementById("crowdclaw-project");
  if (!root) return;

  const initial = parseBundle(root.dataset.bundle);
  if (!initial) return;

  const projectId = params.id || initial.project.id;
  let pollBusy = false;
  let source: EventSource | null = null;
  let fallbackTimer: ReturnType<typeof setInterval> | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let state = {
    bundle: initial,
    refreshing: false,
    liveState: "connecting" as LiveState,
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
        liveState={state.liveState}
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

  const applyBundle = (next: ProjectBundle) => {
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
  };

  const refresh = async (showSpinner = false) => {
    if (pollBusy) return;
    pollBusy = true;
    if (showSpinner) {
      state.refreshing = true;
      draw();
    }
    try {
      applyBundle(await api.getProject(projectId));
    } catch (error) {
      state.refreshing = false;
      state.error = message(error);
      draw();
    } finally {
      pollBusy = false;
    }
  };

  const stopFallback = () => {
    if (fallbackTimer) clearInterval(fallbackTimer);
    fallbackTimer = null;
  };

  const startFallback = () => {
    if (fallbackTimer) return;
    state.liveState = "fallback";
    draw();
    fallbackTimer = setInterval(() => void refresh(false), 5000);
  };

  const disconnectLive = () => {
    source?.close();
    source = null;
    stopFallback();
  };

  const connectLive = () => {
    if (source || typeof EventSource === "undefined") {
      if (!source) startFallback();
      return;
    }
    state.liveState = "connecting";
    draw();
    const nextSource = new EventSource(api.projectEventsUrl(projectId));
    source = nextSource;

    nextSource.addEventListener("snapshot", (event) => {
      if (source !== nextSource) return;
      try {
        applyBundle(
          JSON.parse((event as MessageEvent<string>).data) as ProjectBundle,
        );
      } catch {
        // A malformed frame is ignored; the next snapshot is authoritative.
      }
    });
    nextSource.addEventListener("gone", () => {
      if (source !== nextSource) return;
      state.error = "project no longer exists";
      draw();
      disconnectLive();
    });
    nextSource.onopen = () => {
      if (source !== nextSource) return;
      stopFallback();
      state.liveState = "live";
      state.error = null;
      draw();
    };
    nextSource.onerror = () => {
      if (source !== nextSource) return;
      // EventSource keeps reconnecting itself. Poll slowly in parallel until
      // the connection opens again so the page never becomes stale.
      startFallback();
    };
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

  window.addEventListener("pagehide", () => disconnectLive());
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    void refresh(false);
    connectLive();
  });

  draw();
  connectLive();
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
