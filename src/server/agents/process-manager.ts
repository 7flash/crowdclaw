import {
  handleRun,
  getAllProcesses,
  getProcess,
  isProcessRunning,
} from "bgrun";
import { measure } from "measure-fn";
import { projectsRepository } from "../db/project-repository";
import { errorMessage, log } from "../log";

const PREFIX = "crowdclaw-agent-";
const ID = /^p_[a-z0-9]+_[a-z0-9]+$/i;
let reconciling = false;

export type ProjectAgentProcess = {
  name: string;
  pid: number;
  running: boolean;
};

export function projectAgentName(projectId: string): string {
  if (!ID.test(projectId)) throw new Error("invalid project id");
  return `${PREFIX}${projectId}`;
}

export async function projectAgentStatus(
  projectId: string,
): Promise<ProjectAgentProcess | null> {
  const name = projectAgentName(projectId);
  const proc = getProcess(name);
  if (!proc) return null;
  return {
    name,
    pid: Number(proc.pid || 0),
    running:
      Number(proc.pid || 0) > 0 ? await isProcessRunning(proc.pid) : false,
  };
}

export async function ensureProjectAgent(
  projectId: string,
): Promise<ProjectAgentProcess> {
  const name = projectAgentName(projectId);
  const existing = getProcess(name);
  if (
    existing &&
    Number(existing.pid || 0) > 0 &&
    (await isProcessRunning(existing.pid))
  ) {
    return { name, pid: Number(existing.pid), running: true };
  }

  await measure("bgrun.agent.start", () =>
    handleRun({
      action: "run",
      name,
      command: `bun project-agent.ts ${projectId}`,
      directory: process.cwd(),
      force: Boolean(existing),
      remoteName: "",
    }),
  );

  const started = getProcess(name);
  if (!started) throw new Error(`bgrun did not register ${name}`);
  const running =
    Number(started.pid || 0) > 0 ? await isProcessRunning(started.pid) : false;
  if (!running) throw new Error(`agent process ${name} did not start`);
  log("info", "agent.process.started", { projectId, name, pid: started.pid });
  return { name, pid: Number(started.pid), running };
}

export async function reconcileProjectAgents(): Promise<void> {
  if (reconciling) return;
  reconciling = true;
  try {
    const active = projectsRepository
      .list()
      .filter((project) => !["completed", "failed"].includes(project.status));
    for (const project of active) {
      try {
        await ensureProjectAgent(project.id);
      } catch (error) {
        log("error", "agent.process.ensure_failed", {
          projectId: project.id,
          error: errorMessage(error),
        });
      }
    }
  } finally {
    reconciling = false;
  }
}

export async function bgrunHealth(): Promise<{
  ok: boolean;
  total: number;
  running: number;
  detail?: string;
}> {
  try {
    const processes = getAllProcesses().filter((proc: any) =>
      String(proc.name || "").startsWith(PREFIX),
    );
    let running = 0;
    for (const proc of processes) {
      if (Number(proc.pid || 0) > 0 && (await isProcessRunning(proc.pid)))
        running += 1;
    }
    return { ok: true, total: processes.length, running };
  } catch (error) {
    return { ok: false, total: 0, running: 0, detail: errorMessage(error) };
  }
}
