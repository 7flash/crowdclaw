import { resolve } from "node:path";
import {
  handleRun,
  getAllProcesses,
  getProcess,
  isProcessRunning,
  readFileTail,
} from "bgrun";
import { measure } from "measure-fn";
import { projectsRepository } from "../db/project-repository";
import { errorMessage, log } from "../log";
import { publicErrorLabel } from "../../shared/public-error";
import { verifyAgentProcessIdentity } from "./process-identity";
import {
  adminPausedProjectIds,
  isProjectAdminPaused,
  setProjectAdminPaused,
} from "./admin-pause-store";

const PREFIX = "crowdclaw-agent-";
const ID = /^p_[a-z0-9]+_[a-z0-9]+$/i;
type ProjectAgentPhase = "plan" | "build";
const PROJECT_ROOT = resolve(import.meta.dir, "../../..");
let reconciling = false;
const startingAgents = new Map<string, Promise<ProjectAgentProcess>>();

async function terminateAgentPid(
  pid: number,
  meta: { projectId: string; name: string; reason: string },
): Promise<void> {
  if (!Number.isFinite(pid) || pid <= 0) return;
  if (!(await isProcessRunning(pid))) return;

  const phase = parsedModernAgentName(meta.name)?.phase || "build";
  const currentGeneration = new RegExp(
    `^${PREFIX}${meta.projectId}-${phase}-[a-z0-9]+-[a-z0-9]+$`,
    "i",
  ).test(meta.name);
  const identity = await verifyAgentProcessIdentity({
    pid,
    name: meta.name,
    projectId: meta.projectId,
    currentGeneration,
  });
  if (!identity.verified) {
    log("error", "agent.process.identity_refused", {
      pid,
      ...meta,
      identityReason: identity.reason,
      commandLine: identity.commandLine.slice(0, 320),
    });
    throw new Error(
      `refusing to signal unverified PID ${pid}: ${identity.reason}`,
    );
  }

  // Do not use bgrun's terminate/restart path here. A stale bgrun record may
  // carry old port metadata, and bgrun is allowed to reconcile/clean those
  // ports while terminating a managed record. CrowdClaw agents own no ports;
  // admin/supervisor stop therefore targets the child OS PID only. bgrun still
  // owns registration, launch, status and logs.
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    const message = errorMessage(error);
    if (!/ESRCH|no such process/i.test(message)) throw error;
    return;
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (!(await isProcessRunning(pid))) {
      log("info", "agent.process.pid_stopped", { pid, ...meta });
      return;
    }
    await Bun.sleep(50);
  }

  // A stuck agent should not make RESTART hang forever. Escalate only that PID;
  // never invoke bgrun group/port cleanup.
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    const message = errorMessage(error);
    if (!/ESRCH|no such process/i.test(message)) throw error;
  }
  log("warn", "agent.process.pid_killed", { pid, ...meta });
}

function publishProcessNotification(
  type: string,
  projectId: string,
  payload: Record<string, unknown>,
): void {
  // Notifications are optional observability. Never make agent lifecycle or the
  // admin page depend on the notification module being present/loadable.
  void import("../notification-feed")
    .then(({ publishNotification }) =>
      publishNotification(type, projectId, payload),
    )
    .catch((error) =>
      log("warn", "notification.module_unavailable", {
        type,
        projectId,
        error: errorMessage(error),
      }),
    );
}

export type ProjectAgentProcess = {
  name: string;
  pid: number;
  running: boolean;
};

function isTransientProviderError(message: string): boolean {
  return /(?:\b50[234]\b|\b503\b|UNAVAILABLE|high demand|temporar(?:y|ily)|timeout|timed out|ECONNRESET|ETIMEDOUT|fetch failed|network error|database is locked|SQLITE_BUSY|another Codex process is using its local data|failed to initialize sqlite (?:state )?runtime)/i.test(
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

function freshProjectAgentName(
  projectId: string,
  phase: ProjectAgentPhase,
): string {
  return `${projectAgentName(projectId, phase)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function parsedModernAgentName(
  name: string,
): { projectId: string; phase: ProjectAgentPhase } | null {
  const match = name.match(
    /^crowdclaw-agent-(p_[a-z0-9]+_[a-z0-9]+)-(plan|build)(?:-[a-z0-9]+-[a-z0-9]+)?$/i,
  );
  if (!match) return null;
  return {
    projectId: match[1],
    phase: match[2].toLowerCase() as ProjectAgentPhase,
  };
}

function projectAgentRecords(
  projectId: string,
  phase?: ProjectAgentPhase,
): any[] {
  return getAllProcesses()
    .filter((proc: any) => {
      const parsed = parsedModernAgentName(String(proc?.name || ""));
      return (
        parsed?.projectId === projectId && (!phase || parsed.phase === phase)
      );
    })
    .sort(
      (a: any, b: any) =>
        Number(b?.timestamp || b?.created_at || 0) -
        Number(a?.timestamp || a?.created_at || 0),
    );
}

function isCurrentGenerationRecord(
  proc: any,
  projectId: string,
  phase: ProjectAgentPhase,
): boolean {
  const name = String(proc?.name || "");
  const parsed = parsedModernAgentName(name);
  if (parsed?.projectId !== projectId || parsed.phase !== phase) return false;
  // Current generations always have the random generation suffix and launch
  // through project-agent-launch.ts. Stable/legacy names are old loaded code and
  // must not survive a rolling CrowdClaw upgrade indefinitely.
  if (
    !new RegExp(
      `^${PREFIX}${projectId}-${phase}-[a-z0-9]+-[a-z0-9]+$`,
      "i",
    ).test(name)
  )
    return false;
  return /(?:^|[\\/\s])project-agent-launch\.ts(?:\s|$)/i.test(
    String(proc?.command || ""),
  );
}

async function runningProjectAgent(
  projectId: string,
  phase: ProjectAgentPhase,
): Promise<any | null> {
  for (const proc of projectAgentRecords(projectId, phase)) {
    if (!isCurrentGenerationRecord(proc, projectId, phase)) continue;
    const pid = Number(proc?.pid || 0);
    if (pid > 0 && (await isProcessRunning(pid))) return proc;
  }
  return null;
}

async function stopStaleProjectAgents(projectId: string): Promise<number> {
  let stopped = 0;
  for (const proc of getAllProcesses() as any[]) {
    const name = String(proc?.name || "");
    const modern = parsedModernAgentName(name);
    const legacy = name.match(/^crowdclaw-agent-(p_[a-z0-9]+_[a-z0-9]+)$/i);
    const procProjectId = modern?.projectId || legacy?.[1] || "";
    if (procProjectId !== projectId) continue;

    if (modern && isCurrentGenerationRecord(proc, projectId, modern.phase))
      continue;

    const pid = Number(proc?.pid || 0);
    if (pid <= 0 || !(await isProcessRunning(pid))) continue;
    await terminateAgentPid(pid, {
      projectId,
      name,
      reason: "stale-generation",
    });
    stopped += 1;
    log("info", "agent.process.stale_stopped", {
      projectId,
      name,
      pid,
      command: String(proc?.command || ""),
    });
  }
  return stopped;
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
  const phase = phaseForStatus(project?.status || "build");
  const live = await runningProjectAgent(projectId, phase);
  if (live) {
    return {
      name: String(live.name || projectAgentName(projectId, phase)),
      pid: Number(live.pid || 0),
      running: true,
    };
  }

  const legacyName = legacyProjectAgentName(projectId);
  const legacy = getProcess(legacyName);
  if (legacy) {
    const pid = Number(legacy.pid || 0);
    return {
      name: legacyName,
      pid,
      running: pid > 0 ? await isProcessRunning(pid) : false,
    };
  }

  const latest = projectAgentRecords(projectId, phase)[0];
  if (!latest) return null;
  const pid = Number(latest.pid || 0);
  return { name: String(latest.name), pid, running: false };
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

async function ensureProjectAgentInner(
  projectId: string,
): Promise<ProjectAgentProcess> {
  const project = projectsRepository.get(projectId);
  if (!project) throw new Error("project not found");
  const phase = phaseForStatus(project.status);
  const stableName = projectAgentName(projectId, phase);

  if (isProjectAdminPaused(projectId))
    return { name: stableName, pid: 0, running: false };

  // Planning and building use different bgrun process names. The planning worker
  // exits after publishing an awaiting_start roadmap. Reusing that just-stopped
  // bgrun name for the build can race bgrun's stale-PID reconciliation on
  // Windows and trigger unrelated orphan-port cleanup. A fresh build name makes
  // START BUILD a clean process launch instead of a restart of the planner.
  if (["awaiting_start", "completed", "failed"].includes(project.status)) {
    return { name: stableName, pid: 0, running: false };
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
  const existing = await runningProjectAgent(projectId, phase);
  if (existing) {
    return {
      name: String(existing.name || stableName),
      pid: Number(existing.pid || 0),
      running: true,
    };
  }

  // Do not keep executing code loaded by an older CrowdClaw release. Before
  // creating the replacement generation, terminate live stable/legacy records
  // for this project. This is direct OS-PID termination: it does not invoke bgrun's
  // terminate/restart/port-cleanup path.
  await stopStaleProjectAgents(projectId);

  // Let bgrun resolve Bun exactly as its CLI does. `directory` supplies the
  // project cwd, so the entrypoint can stay relative and the command contains
  // no path quoting. This is important on Windows where bgrun launches command
  // strings through cmd.exe and pre-quoted executable paths are interpreted
  // incorrectly.
  // No registered worker is alive. Clear any lease/run left by the dead worker
  // immediately instead of making the replacement process stare at a stale
  // 60-second lease before it can retry the milestone.
  projectsRepository.recoverProjectWork(projectId, true);

  // Never start a replacement through a stopped bgrun record. bgrun may reconcile
  // stale PID/port metadata before launch; a fresh generation name makes this a
  // pure new registration while staying entirely on the bgrun SDK.
  const name = freshProjectAgentName(projectId, phase);
  const command = `bun project-agent-launch.ts ${projectId} ${phase} ${name}`;
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
          // Project agents never listen on a TCP port. This is a brand-new
          // generation name and `force` stays false, so bgrun has no previous
          // record whose stale port metadata it could reconcile/clean up.
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
      publishProcessNotification("agent.started", projectId, {
        projectName: project.name,
        name,
        pid: Number(started.pid),
        phase,
      });
      return { name, pid: Number(started.pid), running: true };
    }
    await Bun.sleep(100);
  }

  throw await startupFailure(name);
}

export async function ensureProjectAgent(
  projectId: string,
): Promise<ProjectAgentProcess> {
  const project = projectsRepository.get(projectId);
  if (!project) throw new Error("project not found");
  const key = `${projectId}:${phaseForStatus(project.status)}`;
  const pending = startingAgents.get(key);
  if (pending) return pending;
  const task = ensureProjectAgentInner(projectId);
  startingAgents.set(key, task);
  try {
    return await task;
  } finally {
    if (startingAgents.get(key) === task) startingAgents.delete(key);
  }
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

    const paused = adminPausedProjectIds();
    const active = projectsRepository
      .list()
      .filter(
        (project) =>
          !paused.has(project.id) &&
          !["awaiting_start", "completed", "failed"].includes(project.status),
      );
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

export type AdminAgentProcess = {
  name: string;
  projectId: string;
  projectName: string;
  projectStatus: string;
  phase: ProjectAgentPhase | "legacy";
  pid: number;
  running: boolean;
  verified: boolean;
  stoppedByAdmin: boolean;
  canStop: boolean;
  canRestart: boolean;
  historical: boolean;
  command: string;
  directory: string;
  startedAt: number;
};

function projectIdFromAgentName(name: string): string {
  const modern = parsedModernAgentName(name);
  if (modern) return modern.projectId;
  const legacy = name.match(/^crowdclaw-agent-(p_[a-z0-9]+_[a-z0-9]+)$/i);
  return legacy?.[1] || "";
}

function phaseFromAgentName(name: string): ProjectAgentPhase | "legacy" {
  return parsedModernAgentName(name)?.phase || "legacy";
}

function assertAgentName(name: string): void {
  if (!name.startsWith(PREFIX) || !projectIdFromAgentName(name))
    throw new Error("invalid CrowdClaw agent name");
}

function adminProjectRunnable(status: string): boolean {
  return !["awaiting_start", "completed", "waiting_funds"].includes(status);
}

export function adminAgentRegistryCount(): number {
  return getAllProcesses().filter((proc: any) =>
    String(proc?.name || "").startsWith(PREFIX),
  ).length;
}

/**
 * Admin is project-centric, not bgrun-history-centric.
 *
 * bgrun intentionally keeps historical process records. Showing every old plan
 * and build record made a project look like several live agents and, worse,
 * made an old 4.32 planner log look like the current worker. Keep those records
 * in bgrun for diagnostics, but select exactly one representative process per
 * CrowdClaw project here: prefer a live process, then the current lifecycle
 * phase, then the newest historical record.
 */
export async function listAdminAgents(): Promise<AdminAgentProcess[]> {
  const rows = (getAllProcesses() as any[]).filter((proc: any) =>
    String(proc?.name || "").startsWith(PREFIX),
  );
  const grouped = new Map<string, any[]>();
  for (const proc of rows) {
    const projectId = projectIdFromAgentName(String(proc?.name || ""));
    if (!projectId) continue;
    const bucket = grouped.get(projectId) || [];
    bucket.push(proc);
    grouped.set(projectId, bucket);
  }

  const items: AdminAgentProcess[] = [];
  for (const [projectId, records] of grouped) {
    const project = projectsRepository.get(projectId);
    // An orphaned bgrun record for a deleted/foreign project is history, not a
    // current CrowdClaw agent. Leave it visible in bgrun itself, not this panel.
    if (!project) continue;

    const desiredPhase = phaseForStatus(project.status);
    const sorted = records.sort(
      (a: any, b: any) =>
        Number(b?.timestamp || b?.created_at || 0) -
        Number(a?.timestamp || a?.created_at || 0),
    );

    const inspected = await Promise.all(
      sorted.map(async (proc: any) => {
        const name = String(proc?.name || "");
        const pid = Number(proc?.pid || 0);
        const phase = phaseFromAgentName(name);
        const running = pid > 0 ? await isProcessRunning(pid) : false;
        const currentGeneration =
          phase !== "legacy" &&
          new RegExp(
            `^${PREFIX}${projectId}-${phase}-[a-z0-9]+-[a-z0-9]+$`,
            "i",
          ).test(name);
        const identity = running
          ? await verifyAgentProcessIdentity({
              pid,
              name,
              projectId,
              currentGeneration,
            })
          : { verified: false };
        return {
          proc,
          name,
          pid,
          phase,
          running,
          verified: running ? Boolean(identity.verified) : false,
          currentGeneration,
          startedAt: Number(proc?.timestamp || proc?.created_at || 0),
        };
      }),
    );

    const selected =
      inspected.find(
        (item) =>
          item.running && item.currentGeneration && item.phase === desiredPhase,
      ) ||
      inspected.find((item) => item.running && item.currentGeneration) ||
      inspected.find((item) => item.running) ||
      inspected.find((item) => item.phase === desiredPhase) ||
      inspected[0];
    if (!selected) continue;

    const stoppedByAdmin = isProjectAdminPaused(projectId);
    const runnable = adminProjectRunnable(project.status);
    items.push({
      name: selected.name,
      projectId,
      projectName:
        project.name && project.name !== "new-project"
          ? project.name
          : projectId,
      projectStatus: project.status,
      phase: selected.phase,
      pid: selected.pid,
      running: selected.running,
      verified: selected.verified,
      stoppedByAdmin,
      canStop: selected.running && selected.verified && !stoppedByAdmin,
      canRestart:
        runnable &&
        (!selected.running || selected.verified) &&
        project.status !== "completed",
      historical: !selected.running,
      command: String(selected.proc?.command || ""),
      directory: String(selected.proc?.directory || ""),
      startedAt: selected.startedAt,
    });
  }

  return items.sort(
    (a, b) =>
      Number(b.running) - Number(a.running) ||
      Number(a.stoppedByAdmin) - Number(b.stoppedByAdmin) ||
      Number(b.projectStatus === "failed") -
        Number(a.projectStatus === "failed") ||
      b.startedAt - a.startedAt ||
      a.projectName.localeCompare(b.projectName),
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
  const projectId = projectIdFromAgentName(name);
  if (projectId) setProjectAdminPaused(projectId, true);

  // Stop every live generation for this project. Normally there is one, but
  // this also cleans up a duplicate left by an older supervisor race.
  const records = projectId
    ? getAllProcesses().filter(
        (proc: any) =>
          projectIdFromAgentName(String(proc?.name || "")) === projectId,
      )
    : [getProcess(name)].filter(Boolean);
  for (const proc of records as any[]) {
    const pid = Number(proc?.pid || 0);
    if (pid > 0 && (await isProcessRunning(pid)))
      await terminateAgentPid(pid, {
        projectId,
        name: String(proc?.name || name),
        reason: "admin-stop",
      });
  }
  if (projectId) projectsRepository.recoverProjectWork(projectId, true);
  log("info", "agent.admin.stopped", { name, projectId });
}

export async function restartAdminAgent(
  name: string,
): Promise<ProjectAgentProcess> {
  assertAgentName(name);
  const projectId = projectIdFromAgentName(name);
  if (!projectId) throw new Error("agent project not found");

  setProjectAdminPaused(projectId, false);
  for (const proc of getAllProcesses() as any[]) {
    if (projectIdFromAgentName(String(proc?.name || "")) !== projectId)
      continue;
    const pid = Number(proc?.pid || 0);
    if (pid > 0 && (await isProcessRunning(pid)))
      await terminateAgentPid(pid, {
        projectId,
        name: String(proc?.name || name),
        reason: "admin-restart",
      });
  }
  await Bun.sleep(120);

  projectsRepository.recoverProjectWork(projectId, true);
  let project = projectsRepository.get(projectId);
  if (project?.status === "failed")
    project = projectsRepository.retryFailed(projectId) || project;
  if (!project) throw new Error("project not found");
  if (["awaiting_start", "completed", "waiting_funds"].includes(project.status))
    throw new Error(`project is not runnable (${project.status})`);

  // ensureProjectAgent always creates a fresh generation name when no worker is
  // alive, so admin restart cannot enter bgrun's stale-record port cleanup path.
  return ensureProjectAgent(projectId);
}

export function isAdminAgentStopped(name: string): boolean {
  return isProjectAdminPaused(projectIdFromAgentName(name));
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
    const paused = adminPausedProjectIds();
    const active = projectsRepository
      .list()
      .filter(
        (project) =>
          !paused.has(project.id) &&
          !["awaiting_start", "completed", "failed"].includes(project.status),
      );
    let running = 0;
    for (const project of active) {
      const proc = await runningProjectAgent(
        project.id,
        phaseForStatus(project.status),
      );
      if (proc) {
        running += 1;
        continue;
      }
      const legacy = getProcess(legacyProjectAgentName(project.id));
      if (
        legacy &&
        Number(legacy.pid || 0) > 0 &&
        (await isProcessRunning(legacy.pid))
      )
        running += 1;
    }
    return { ok: true, total: active.length, running };
  } catch (error) {
    return { ok: false, total: 0, running: 0, detail: errorMessage(error) };
  }
}
