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
    previewRevision: initial.project.updatedAt,
    toast: null as string | null,
    steerText: "",
    steerAmount: "1",
    steering: false,
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
        previewRevision={state.previewRevision}
        toast={state.toast}
        steerText={state.steerText}
        steerAmount={state.steerAmount}
        steering={state.steering}
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
    const previous = state.bundle;
    const previousArtifactCount = previous.artifacts.length;
    const previewChanged =
      next.project.streamPreview !== previous.project.streamPreview;
    const wroteIndex =
      previewChanged &&
      /(?:^|\n)WRITE index\.html(?:\n|$)/.test(next.project.streamPreview);
    const artifactAdded = next.artifacts.length > previousArtifactCount;
    const statusChanged = next.project.status !== previous.project.status;
    const balanceChanged =
      next.project.onchainLamports !== previous.project.onchainLamports;

    state.bundle = next;
    state.refreshing = false;
    state.error = null;
    if (wroteIndex || artifactAdded) state.previewRevision = Date.now();
    if (state.selectedVersion == null && artifactAdded) {
      state.artifactCode = null;
      state.artifactCodeVersion = null;
      if (state.tab === "code") void loadCurrentCode();
    }
    draw();
    animateProjectChange({
      previewChanged,
      wroteIndex,
      artifactAdded,
      statusChanged,
      balanceChanged,
    });
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

  const animateProjectChange = (change: {
    previewChanged: boolean;
    wroteIndex: boolean;
    artifactAdded: boolean;
    statusChanged: boolean;
    balanceChanged: boolean;
  }) => {
    requestAnimationFrame(() => {
      if (change.statusChanged) {
        root.querySelector(".cc-stage")?.animate(
          [
            { transform: "translateY(7px)", opacity: 0.72 },
            { transform: "translateY(0)", opacity: 1 },
          ],
          { duration: 420, easing: "cubic-bezier(.16,.84,.28,1)" },
        );
      }
      if (change.previewChanged) {
        root.querySelector(".cc-cinema-current")?.animate(
          [
            { transform: "translateX(-10px)", opacity: 0 },
            { transform: "translateX(0)", opacity: 1 },
          ],
          { duration: 300, easing: "cubic-bezier(.16,.84,.28,1)" },
        );
      }
      if (change.wroteIndex || change.artifactAdded) {
        root.querySelector(".cc-preview-frame")?.animate(
          [
            { opacity: 0.35, filter: "brightness(.55)" },
            { opacity: 1, filter: "brightness(1)" },
          ],
          { duration: 520, easing: "ease-out" },
        );
      }
      if (change.balanceChanged) {
        root.querySelector(".cc-live-wallet")?.animate(
          [
            { transform: "scale(.96)", opacity: 0.5 },
            { transform: "scale(1)", opacity: 1 },
          ],
          { duration: 380, easing: "cubic-bezier(.2,.9,.2,1)" },
        );
      }
    });
  };

  const startEntryAnimation = () => {
    const key = `crowdclaw:handoff:${projectId}`;
    let handoff = false;
    try {
      handoff = sessionStorage.getItem(key) === "1";
      sessionStorage.removeItem(key);
    } catch {}
    if (!handoff) return;

    const curtain = document.createElement("div");
    curtain.className = "cc-handoff-curtain";
    curtain.innerHTML = '<i class="cc-handoff-line"></i>';
    document.body.appendChild(curtain);
    const line = curtain.querySelector("i") as HTMLElement | null;
    if (line) line.style.transform = "scaleX(1)";

    requestAnimationFrame(() => {
      root.querySelector("main")?.animate(
        [
          {
            opacity: 0,
            transform: "translateY(30px) scale(.98)",
            filter: "blur(6px)",
          },
          {
            opacity: 1,
            transform: "translateY(0) scale(1)",
            filter: "blur(0)",
          },
        ],
        {
          duration: 760,
          delay: 90,
          easing: "cubic-bezier(.16,.84,.28,1)",
          fill: "both",
        },
      );
      line?.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], {
        duration: 620,
        easing: "cubic-bezier(.4,0,.2,1)",
        fill: "forwards",
      });
      const fade = curtain.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 650,
        delay: 100,
        easing: "ease-in",
        fill: "forwards",
      });
      fade.addEventListener("finish", () => curtain.remove(), { once: true });
    });
  };

  const updateRunClock = () => {
    const run = state.bundle.runs.find(
      (item) => item.status === "running" && item.kind === "build",
    );
    const text = run
      ? `${Math.max(0, Math.floor((Date.now() - run.startedAt) / 1000))}s`
      : "";
    root.querySelectorAll("[data-run-clock]").forEach((node) => {
      (node as HTMLElement).textContent = text;
    });
  };
  const runClockTimer = setInterval(updateRunClock, 1000);

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
        toast("COPIED");
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
        toast("SYNCED");
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
        toast("DEV FUNDED");
      } catch (error) {
        state.error = message(error);
        draw();
      }
    },

    setSteerText(value) {
      state.steerText = value;
      draw();
    },
    setSteerAmount(value) {
      state.steerAmount = value;
      draw();
    },
    async steer() {
      if (state.steering) return;
      const instruction = state.steerText.trim();
      const influence = Number(state.steerAmount);
      if (instruction.length < 3 || !(influence > 0)) return;
      const provider = (window as any).solana;
      if (!provider?.connect || !provider?.signMessage) {
        toast("SOL WALLET REQUIRED");
        return;
      }
      state.steering = true;
      draw();
      try {
        const connection = await provider.connect();
        const address = String(
          connection?.publicKey?.toString?.() ||
            provider.publicKey?.toString?.() ||
            "",
        );
        if (!address) throw new Error("wallet address unavailable");
        const challenge = await api.steeringChallenge(projectId, address);
        const bytes = new TextEncoder().encode(challenge.message);
        const signed = await provider.signMessage(bytes, "utf8");
        const raw = signed?.signature || signed;
        const signature = bytesToBase64(
          raw instanceof Uint8Array ? raw : new Uint8Array(raw),
        );
        await api.submitSteering(projectId, {
          challengeId: challenge.id,
          address,
          signature,
          instruction,
          influence,
        });
        state.steerText = "";
        await refresh(false);
        toast("STEERED");
      } catch (error) {
        if ((error as Error)?.name !== "AbortError")
          toast(message(error).toUpperCase());
      } finally {
        state.steering = false;
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
          toast("COPIED");
        }
      } catch (error) {
        if ((error as Error)?.name !== "AbortError") toast("SHARE FAILED");
      }
    },
  };

  window.addEventListener("pagehide", () => {
    disconnectLive();
    clearInterval(runClockTimer);
  });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    void refresh(false);
    connectLive();
  });

  draw();
  connectLive();
  updateRunClock();
  startEntryAnimation();
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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
