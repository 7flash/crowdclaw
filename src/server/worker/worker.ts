/**
 * Legacy shared-worker compatibility tombstone.
 *
 * Since CrowdClaw 4.8, each project runs in its own bgrun-managed process via
 * project-agent.ts. These exports remain only so stale imports from an older
 * overlaid checkout cannot crash the web server or resurrect the old worker.
 */
export type AgentWorkerHealth = {
  owner: string;
  started: boolean;
  running: boolean;
  startedAt: number;
  lastTickStartedAt: number;
  lastTickFinishedAt: number;
  lastSuccessAt: number;
  lastErrorAt: number;
  lastError: string;
  ticks: number;
};

const retiredHealth: AgentWorkerHealth = {
  owner: "retired:bgrun-per-project",
  started: false,
  running: false,
  startedAt: 0,
  lastTickStartedAt: 0,
  lastTickFinishedAt: 0,
  lastSuccessAt: 0,
  lastErrorAt: 0,
  lastError: "",
  ticks: 0,
};

export function getAgentWorkerHealth(): AgentWorkerHealth {
  return { ...retiredHealth };
}

export function ensureAgentWorker(): false {
  return false;
}

export function wakeAgentWorker(): void {
  // Retired: project agents are spawned through bgrun.
}

export function stopAgentWorker(): void {
  // Retired: project agents are supervised through bgrun.
}

export function startAgentWorker(): () => void {
  return stopAgentWorker;
}
