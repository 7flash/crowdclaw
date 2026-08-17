import { resolve } from "node:path";
import { handleRun, getProcess, isProcessRunning } from "bgrun";
import { measure } from "measure-fn";
import { projectsRepository } from "../db/project-repository";
import { errorMessage, log } from "../log";
import { publicErrorLabel } from "../../shared/public-error";

const PREFIX = "crowdclaw-agent-";
const ID = /^p_[a-z0-9]+_[a-z0-9]+$/i;
const PROJECT_ROOT = resolve(import.meta.dir, "../../..");
let reconciling = false;

export type ProjectAgentProcess = {
  name: string;
  pid: number;
  running: boolean;
};

function isTransientProviderError(message: string): boolean {
  return /(?:\b50[234]\b|\b503\b|UNAVAILABLE|high demand|temporar(?:y|ily)|timeout|timed out|ECONNRESET|ETIMEDOUT|fetch failed|network error)/i.test(
    message,
  );
}

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

async function startupFailure(name: string): Promise<Error> {
  const proc = getProcess(name);
  if (!proc) return new Error("AGENT START");
  const stderr =
    typeof (proc as any).stderr_path === "string"
      ? (proc as any).stderr_path
      : undefined;
  const stdout =
    typeof (proc as any).stdout_path === "string"
      ? (proc as any).stdout_path
      : undefined;
  log("error", "agent.process.exited", {
    name,
    pid: proc.pid,
    ...(stderr ? { stderr } : {}),
    ...(stdout ? { stdout } : {}),
  });
  return new Error("AGENT START");
}

function compactLaunchError(error: unknown): {
  label: string;
  message: string;
  stderr?: string;
  stdout?: string;
} {
  const message = errorMessage(error);
  const stderr = message.match(/(?:^|\n)stderr:\s*([^\r\n]+)/i)?.[1]?.trim();
  const stdout = message.match(/(?:^|\n)stdout:\s*([^\r\n]+)/i)?.[1]?.trim();
  return {
    label: publicErrorLabel(message),
    message:
      message
        .split(/\r?\n/)
        .find((line) =>
          /Codex runtime requires|Cannot find module|failed to stay running|invalid runtime configuration/i.test(
            line,
          ),
        )
        ?.trim()
        .slice(0, 220) || publicErrorLabel(message),
    ...(stderr ? { stderr } : {}),
    ...(stdout ? { stdout } : {}),
  };
}

export async function ensureProjectAgent(
  projectId: string,
): Promise<ProjectAgentProcess> {
  const name = projectAgentName(projectId);

  // Fail with a useful message in the web process instead of letting a detached
  // child disappear instantly when the installed jsx-ai package is older than
  // the agent runtime expected by this project.
  const jsx = await import("jsx-ai");
  if (typeof (jsx as any).runAgent !== "function") {
    throw new Error(
      "jsx-ai runAgent export is missing; install a jsx-ai release that includes runAgent",
    );
  }
  const existing = getProcess(name);
  if (
    existing &&
    Number(existing.pid || 0) > 0 &&
    (await isProcessRunning(existing.pid))
  ) {
    return { name, pid: Number(existing.pid), running: true };
  }

  // Let bgrun resolve Bun exactly as its CLI does. `directory` supplies the
  // project cwd, so the entrypoint can stay relative and the command contains
  // no path quoting. This is important on Windows where bgrun launches command
  // strings through cmd.exe and pre-quoted executable paths are interpreted
  // incorrectly.
  const command = `bun project-agent.ts ${projectId}`;
  const launched = await measure(
    {
      start: () => "Start bgrun agent",
      end: (value: { ok: boolean; label?: string }) =>
        value.ok ? { name, command } : { name, error: value.label },
      catch: (error) => {
        const compact = compactLaunchError(error);
        log("error", "agent.process.launch_failed", {
          projectId,
          name,
          ...compact,
        });
        return { ok: false, label: compact.label };
      },
      projectId,
      processName: name,
    },
    async () => {
      try {
        await handleRun({
          action: "run",
          name,
          command,
          directory: PROJECT_ROOT,
          force: Boolean(existing),
          remoteName: "",
        });
        return { ok: true };
      } catch (error) {
        // bgrun includes stderr tails in the thrown message. Keep that detail in
        // bgrun's own log files and collapse the web-process trace to one label.
        const current = projectsRepository.get(projectId);
        if (current?.status === "failed") {
          const reason = errorMessage(current.error || error)
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 220);
          const label = publicErrorLabel(current.error || error);
          log("error", "agent.process.finished", {
            projectId,
            name,
            status: current.status,
            label,
            reason,
          });
          return { ok: false, label };
        }
        const compact = compactLaunchError(error);
        log("error", "agent.process.launch_failed", {
          projectId,
          name,
          ...compact,
        });
        return { ok: false, label: compact.label };
      }
    },
  );

  if (!launched.ok) {
    const current = projectsRepository.get(projectId);
    // If the child genuinely started, ran, persisted a terminal project result,
    // and exited quickly, that is not a process-launch failure.
    if (current?.status === "failed" || current?.status === "completed") {
      return { name, pid: 0, running: false };
    }
    throw new Error(launched.label || "AGENT START");
  }

  // bgrun registration and OS process visibility are not guaranteed to become
  // observable in the same tick. Give the child a short bounded startup window.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const started = getProcess(name);
    if (
      started &&
      Number(started.pid || 0) > 0 &&
      (await isProcessRunning(started.pid))
    ) {
      log("info", "agent.process.started", {
        projectId,
        name,
        pid: started.pid,
      });
      return { name, pid: Number(started.pid), running: true };
    }
    await Bun.sleep(100);
  }

  throw await startupFailure(name);
}

export function startProjectAgent(projectId: string): void {
  void ensureProjectAgent(projectId).catch((error) => {
    const message = errorMessage(error);
    const label = publicErrorLabel(message);
    log("error", "agent.process.start_failed", { projectId, error: label });
    const current = projectsRepository.get(projectId);
    if (current && current.status === "planning" && !current.currentRunId) {
      projectsRepository.setStatus(projectId, "planning", {
        agentNote: label,
        error: message,
      });
      projectsRepository.event(projectId, "agent.process.failed", label);
    }
  });
}

export async function reconcileProjectAgents(): Promise<void> {
  if (reconciling) return;
  reconciling = true;
  try {
    // Recover projects that an older CrowdClaw build incorrectly made terminal
    // for a temporary provider outage. Permanent/quota failures stay terminal.
    for (const project of projectsRepository.list()) {
      if (
        project.status !== "failed" ||
        project.milestones.length ||
        !isTransientProviderError(project.error)
      )
        continue;
      projectsRepository.setStatus(project.id, "planning", {
        currentRunId: null,
        agentNote: "BUSY",
        streamPreview: "",
        error: "",
        retryAt: Date.now() + 1_000,
      });
      projectsRepository.event(project.id, "agent.recovered", "MODEL BUSY");
    }

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
    // Health is about CrowdClaw's active projects, not every historical bgrun
    // record. Old stopped experiments can contain dead Windows PIDs and make a
    // simple health probe take seconds if we interrogate all of them.
    const active = projectsRepository
      .list()
      .filter((project) => !["completed", "failed"].includes(project.status));
    let running = 0;
    for (const project of active) {
      const proc = getProcess(projectAgentName(project.id));
      if (
        proc &&
        Number(proc.pid || 0) > 0 &&
        (await isProcessRunning(proc.pid))
      )
        running += 1;
    }
    return { ok: true, total: active.length, running };
  } catch (error) {
    return { ok: false, total: 0, running: 0, detail: errorMessage(error) };
  }
}
