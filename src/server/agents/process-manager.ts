import { resolve } from "node:path";
import {
  handleRun,
  getAllProcesses,
  getProcess,
  isProcessRunning,
  readFileTail,
  terminateProcess,
} from "bgrun";
import { measure } from "measure-fn";
import { projectsRepository } from "../db/project-repository";
import { errorMessage, log } from "../log";
import { publicErrorLabel } from "../../shared/public-error";

const PREFIX = "crowdclaw-agent-";
const ID = /^p_[a-z0-9]+_[a-z0-9]+$/i;
type ProjectAgentPhase = "plan" | "build";
const PROJECT_ROOT = resolve(import.meta.dir, "../../..");
let reconciling = false;
const adminStopped = new Set<string>();

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

export function projectAgentName(
  projectId: string,
  phase: ProjectAgentPhase = "build",
): string {
  if (!ID.test(projectId)) throw new Error("invalid project id");
  return `${PREFIX}${projectId}-${phase}`;
}

function phaseForStatus(status: string): ProjectAgentPhase {
  return status === "planning" ? "plan" : "build";
}

function legacyProjectAgentName(projectId: string): string {
  if (!ID.test(projectId)) throw new Error("invalid project id");
  return `${PREFIX}${projectId}`;
}

export async function projectAgentStatus(
  projectId: string,
): Promise<ProjectAgentProcess | null> {
  const project = projectsRepository.get(projectId);
  const name = projectAgentName(
    projectId,
    phaseForStatus(project?.status || "build"),
  );
  let proc = getProcess(name);
  let resolvedName = name;
  if (!proc) {
    const legacyName = legacyProjectAgentName(projectId);
    const legacy = getProcess(legacyName);
    if (legacy) {
      proc = legacy;
      resolvedName = legacyName;
    }
  }
  if (!proc) return null;
  return {
    name: resolvedName,
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
  const project = projectsRepository.get(projectId);
  if (!project) throw new Error("project not found");
  const phase = phaseForStatus(project.status);
  const name = projectAgentName(projectId, phase);

  if (adminStopped.has(name)) return { name, pid: 0, running: false };

  // Planning and building use different bgrun process names. The planning worker
  // exits after publishing an awaiting_start roadmap. Reusing that just-stopped
  // bgrun name for the build can race bgrun's stale-PID reconciliation on
  // Windows and trigger unrelated orphan-port cleanup. A fresh build name makes
  // START BUILD a clean process launch instead of a restart of the planner.
  if (["awaiting_start", "completed", "failed"].includes(project.status)) {
    return { name, pid: 0, running: false };
  }

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

  // During a rolling upgrade, an older unsuffixed worker may still be alive.
  // Reuse it rather than starting a second worker for the same project. Dead
  // legacy records are deliberately ignored so START BUILD never restarts them.
  const legacyName = legacyProjectAgentName(projectId);
  const legacy = getProcess(legacyName);
  if (
    legacy &&
    Number(legacy.pid || 0) > 0 &&
    (await isProcessRunning(legacy.pid))
  ) {
    return { name: legacyName, pid: Number(legacy.pid), running: true };
  }

  // Let bgrun resolve Bun exactly as its CLI does. `directory` supplies the
  // project cwd, so the entrypoint can stay relative and the command contains
  // no path quoting. This is important on Windows where bgrun launches command
  // strings through cmd.exe and pre-quoted executable paths are interpreted
  // incorrectly.
  // No registered worker is alive. Clear any lease/run left by the dead worker
  // immediately instead of making the replacement process stare at a stale
  // 60-second lease before it can retry the milestone.
  projectsRepository.recoverProjectWork(projectId, true);

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
          // Project agents never listen on a TCP port. `force` is intentionally
          // disabled: bgrun force-restart performs orphan-port cleanup from the
          // previous process record. A stale worker record can otherwise carry
          // the web server port and kill TradJS while merely restarting an
          // agent. We already return above when the existing PID is alive, so a
          // stopped record can be started safely without destructive cleanup.
          force: false,
          remoteName: "",
        });
        return { ok: true };
      } catch (error) {
        // A create request and the supervisor can race. If another caller won
        // and the named worker is alive now, treat this start as successful
        // rather than turning a harmless name collision into an agent failure.
        const raced = getProcess(name);
        if (
          raced &&
          Number(raced.pid || 0) > 0 &&
          (await isProcessRunning(raced.pid))
        ) {
          return { ok: true };
        }

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

    // 4.16.1 could reject a one-step plan for cosmetic schema details after the
    // model had already called submit_game_plan. Re-run only that old generic
    // host-contract failure; new validation failures retain their specific error.
    for (const project of projectsRepository.list()) {
      if (
        project.status !== "failed" ||
        project.milestones.length ||
        !/Planning stopped with max_steps without a valid plan\.?/i.test(
          project.error,
        )
      )
        continue;
      projectsRepository.setStatus(project.id, "planning", {
        currentRunId: null,
        agentNote: "THINKING",
        streamPreview: "",
        error: "",
        failureCount: 0,
        retryAt: Date.now() + 500,
      });
      projectsRepository.event(project.id, "agent.recovered", "PLAN RETRY");
    }

    const active = projectsRepository
      .list()
      .filter(
        (project) =>
          !["awaiting_start", "completed", "failed"].includes(project.status),
      );
    for (const project of active) {
      const name = projectAgentName(project.id, phaseForStatus(project.status));
      if (adminStopped.has(name)) continue;
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

export type AdminAgentProcess = {
  name: string;
  projectId: string;
  phase: ProjectAgentPhase | "legacy";
  pid: number;
  running: boolean;
  stoppedByAdmin: boolean;
  command: string;
  directory: string;
  startedAt: number;
};

function projectIdFromAgentName(name: string): string {
  const modern = name.match(
    /^crowdclaw-agent-(p_[a-z0-9]+_[a-z0-9]+)-(?:plan|build)$/i,
  );
  if (modern) return modern[1];
  const legacy = name.match(/^crowdclaw-agent-(p_[a-z0-9]+_[a-z0-9]+)$/i);
  return legacy?.[1] || "";
}

function phaseFromAgentName(name: string): ProjectAgentPhase | "legacy" {
  if (/-plan$/i.test(name)) return "plan";
  if (/-build$/i.test(name)) return "build";
  return "legacy";
}

function assertAgentName(name: string): void {
  if (!name.startsWith(PREFIX) || !projectIdFromAgentName(name))
    throw new Error("invalid CrowdClaw agent name");
}

export async function listAdminAgents(): Promise<AdminAgentProcess[]> {
  const rows = getAllProcesses().filter((proc: any) =>
    String(proc?.name || "").startsWith(PREFIX),
  );
  const items = await Promise.all(
    rows.map(async (proc: any) => {
      const name = String(proc.name || "");
      const pid = Number(proc.pid || 0);
      return {
        name,
        projectId: projectIdFromAgentName(name),
        phase: phaseFromAgentName(name),
        pid,
        running: pid > 0 ? await isProcessRunning(pid) : false,
        stoppedByAdmin: adminStopped.has(name),
        command: String(proc.command || ""),
        directory: String(proc.directory || ""),
        startedAt: Number(proc.timestamp || proc.created_at || 0),
      } satisfies AdminAgentProcess;
    }),
  );
  return items.sort(
    (a: AdminAgentProcess, b: AdminAgentProcess) =>
      b.startedAt - a.startedAt || a.name.localeCompare(b.name),
  );
}

export async function readAdminAgentLogs(
  name: string,
  lines = 160,
): Promise<{ stdout: string; stderr: string }> {
  assertAgentName(name);
  const proc = getProcess(name) as any;
  if (!proc) throw new Error("agent not found");
  const safeLines = Math.max(20, Math.min(500, Math.floor(lines || 160)));
  const tail = async (path: unknown) => {
    if (typeof path !== "string" || !path) return "";
    try {
      return String((await readFileTail(path, safeLines)) || "");
    } catch {
      return "";
    }
  };
  const [stdout, stderr] = await Promise.all([
    tail(proc.stdout_path),
    tail(proc.stderr_path),
  ]);
  return { stdout, stderr };
}

export async function stopAdminAgent(name: string): Promise<void> {
  assertAgentName(name);
  adminStopped.add(name);
  const proc = getProcess(name) as any;
  const pid = Number(proc?.pid || 0);
  if (pid > 0 && (await isProcessRunning(pid))) await terminateProcess(pid);
  const projectId = projectIdFromAgentName(name);
  if (projectId) projectsRepository.recoverProjectWork(projectId, true);
  log("info", "agent.admin.stopped", { name, projectId, pid });
}

export async function restartAdminAgent(
  name: string,
): Promise<ProjectAgentProcess> {
  assertAgentName(name);
  const projectId = projectIdFromAgentName(name);
  const proc = getProcess(name) as any;
  const pid = Number(proc?.pid || 0);
  adminStopped.delete(name);
  if (pid > 0 && (await isProcessRunning(pid))) {
    await terminateProcess(pid);
    await Bun.sleep(120);
  }
  if (projectId) {
    projectsRepository.recoverProjectWork(projectId, true);
    const project = projectsRepository.get(projectId);
    if (
      project &&
      !["awaiting_start", "completed", "failed"].includes(project.status)
    )
      return ensureProjectAgent(projectId);
  }

  if (!proc) throw new Error("agent not found");
  await handleRun({
    action: "run",
    name,
    command: String(proc.command || ""),
    directory: String(proc.directory || PROJECT_ROOT),
    force: false,
    remoteName: "",
  });
  const restarted = getProcess(name) as any;
  const nextPid = Number(restarted?.pid || 0);
  return {
    name,
    pid: nextPid,
    running: nextPid > 0 ? await isProcessRunning(nextPid) : false,
  };
}

export function isAdminAgentStopped(name: string): boolean {
  return adminStopped.has(name);
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
      .filter(
        (project) =>
          !["awaiting_start", "completed", "failed"].includes(project.status),
      );
    let running = 0;
    for (const project of active) {
      const proc =
        getProcess(
          projectAgentName(project.id, phaseForStatus(project.status)),
        ) || getProcess(legacyProjectAgentName(project.id));
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
