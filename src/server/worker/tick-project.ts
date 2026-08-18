import { createHash } from "node:crypto";
import { measure } from "measure-fn";
import {
  buildMilestone,
  planGame,
  type AgentStreamUpdate,
  type AgentUsage,
} from "../agent/jsx-agent";
import { sealHtml, toMilestone, validateArtifactHtml } from "../agent/output";
import { modelName } from "../config";
import { projectsRepository } from "../db/project-repository";
import { log } from "../log";
import type { Project } from "../../shared/types";
import { publicErrorLabel } from "../../shared/public-error";

const MAX_FAILURES = 3;

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error || "agent run failed");
}

function isQuotaError(message: string): boolean {
  return /(?:\b429\b|quota|rate.?limit)/i.test(message);
}

function isTimeoutError(message: string): boolean {
  return /(?:request\s+timed\s*out|timed\s*out|timeout)/i.test(message);
}

function publishBuildNotification(
  type: string,
  projectId: string,
  payload: Record<string, unknown>,
): void {
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

function isDatabaseBusy(error: unknown): boolean {
  return /(?:database is locked|database table is locked|SQLITE_BUSY)/i.test(
    errorMessage(error),
  );
}

function persistLiveProgress(
  projectId: string,
  runId: string,
  input: Parameters<typeof projectsRepository.updateLiveProgress>[2],
): void {
  try {
    projectsRepository.updateLiveProgress(projectId, runId, input);
  } catch (error) {
    // Live counters are telemetry, not build correctness. Let the model turn
    // continue; otherwise JSX-AI wraps this callback exception as a misleading
    // "Codex runtime failed: database is locked".
    if (!isDatabaseBusy(error)) throw error;
    log("warn", "agent.progress.db_busy", {
      projectId,
      runId,
      error: errorMessage(error),
    });
  }
}

function persistActivityEvent(
  projectId: string,
  type: string,
  message: string,
): void {
  try {
    projectsRepository.event(projectId, type, message);
  } catch (error) {
    // Status/event telemetry must never throw through JSX-AI's onEvent callback.
    // Critical lifecycle writes still use the normal retrying repository path.
    if (!isDatabaseBusy(error)) throw error;
    log("warn", "agent.activity.db_busy", {
      projectId,
      type,
      error: errorMessage(error),
    });
  }
}

function isTransientModelError(message: string): boolean {
  return /(?:\b50[234]\b|\b503\b|UNAVAILABLE|high demand|temporar(?:y|ily)|timeout|timed out|ECONNRESET|ETIMEDOUT|fetch failed|network error|database is locked|SQLITE_BUSY|another Codex process is using its local data|failed to initialize sqlite (?:state )?runtime)/i.test(
    message,
  );
}

function backoff(failureCount: number): number {
  return Math.min(120_000, 5_000 * 2 ** Math.max(0, failureCount));
}

function usagePatch(usage: AgentUsage) {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    thinkingTokens: usage.thinkingTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    lastContextTokens: usage.lastContextTokens,
    usageEstimated: usage.estimated,
  };
}

function progressWriter(projectId: string, runId: string) {
  let lastWrite = 0;
  let lastNote = "";
  return (
    text: string,
    note: string,
    usage: AgentUsage,
    force = false,
    streamEventCount?: number,
  ) => {
    const t = Date.now();
    const noteChanged = note !== lastNote;
    // The browser does not need one SQLite transaction per model delta. Persist
    // a fresh snapshot a couple of times per second; the sequence still jumps to
    // the latest model event, so no semantic progress is lost.
    if (!force && !noteChanged && t - lastWrite < 600) return;
    lastWrite = t;
    lastNote = note;
    persistLiveProgress(projectId, runId, {
      ...usagePatch(usage),
      streamChars: text.length,
      streamUpdatedAt: t,
      ...(streamEventCount !== undefined ? { streamEventCount } : {}),
      preview: text.slice(-1800),
      note,
    });
  };
}

function planningPreview(
  note: string,
  name: string,
  summary: string,
  milestones: Array<{ title: string; goal?: string; costCredits: number }>,
): string {
  return [
    note ? `T|${note}` : "",
    name ? `N|${name}` : "",
    summary ? `S|${summary}` : "",
    ...milestones.map((item) => `M|${item.title}|${item.costCredits}`),
  ]
    .filter(Boolean)
    .join("\n");
}

function planningLiveWriter(projectId: string, runId: string) {
  let assistantText = "";
  let status = "";
  let lastWrite = 0;
  let lastStatus = "";
  return (update: AgentStreamUpdate, force = false) => {
    if (update.kind === "text") assistantText = update.text;
    else status = update.text;
    const t = Date.now();
    const preview = assistantText ? `A|${assistantText}` : "";
    const statusChanged = status !== lastStatus;
    if (!force && !statusChanged && t - lastWrite < 500) return;
    lastWrite = t;
    lastStatus = status;
    persistLiveProgress(projectId, runId, {
      streamChars: preview.length,
      streamUpdatedAt: t,
      streamEventCount: update.sequence || 0,
      preview,
      note: status,
    });
  };
}

function heartbeat(
  projectId: string,
  owner: string,
  leaseMs: number,
): () => void {
  const timer = setInterval(
    () => {
      try {
        projectsRepository.heartbeat(projectId, owner, leaseMs);
      } catch (error) {
        if (!isDatabaseBusy(error)) throw error;
        log("warn", "agent.heartbeat.db_busy", {
          projectId,
          error: errorMessage(error),
        });
      }
    },
    Math.max(1000, Math.floor(leaseMs / 3)),
  );
  return () => clearInterval(timer);
}

export async function planProject(
  project: Project,
  owner: string,
  leaseMs: number,
): Promise<void> {
  const stopHeartbeat = heartbeat(project.id, owner, leaseMs);
  const run = projectsRepository.createRun({
    projectId: project.id,
    kind: "plan",
    milestoneIndex: -1,
    model: modelName(),
  });
  projectsRepository.setStatus(project.id, "planning", {
    currentRunId: run.id,
    agentNote: "THINKING",
    streamPreview: "",
    streamUpdatedAt: Date.now(),
    streamEventCount: 0,
    error: "",
  });
  projectsRepository.event(
    project.id,
    "agent.assigned",
    `${project.agentId} started planning.`,
  );

  let usage: AgentUsage | null = null;
  let text = "";
  let planningAssistantText = "";
  const writePlanningLive = planningLiveWriter(project.id, run.id);

  try {
    await measure(
      {
        start: () => "Plan project",
        end: () => ({
          runId: run.id,
          input: usage?.inputTokens || 0,
          output: usage?.outputTokens || 0,
          thinking: usage?.thinkingTokens || 0,
        }),
        projectId: project.id,
        runId: run.id,
        model: modelName(),
      },
      async () => {
        const result = await measure(
          {
            start: () => "Generate roadmap",
            end: (value: Awaited<ReturnType<typeof planGame>>) => ({
              slug: value.plan.slug,
              milestones: value.plan.milestones.length,
              usage: value.usage,
            }),
            projectId: project.id,
          },
          () =>
            planGame(project.idea, (update) => {
              if (update.kind === "text") planningAssistantText = update.text;
              writePlanningLive(update);
            }),
        );
        usage = result.usage;
        const { plan } = result;
        const milestones = plan.milestones.map((item) => toMilestone(item));

        text = [
          planningAssistantText ? `A|${planningAssistantText}` : "",
          planningPreview(plan.note, plan.slug, plan.summary, plan.milestones),
        ]
          .filter(Boolean)
          .join("\n");
        projectsRepository.updateRunUsage(run.id, {
          ...usagePatch(result.usage),
          streamChars: text.length,
          preview: text,
          note: plan.note,
        });
        projectsRepository.updateLiveRun(project.id, run.id, text, plan.note);

        const saved = await measure(
          {
            start: () => "Publish roadmap",
            end: (value: Project) => ({
              name: value.name,
              milestones: value.milestones.length,
              status: value.status,
            }),
            projectId: project.id,
            runId: run.id,
          },
          () =>
            projectsRepository.setPlanningResult(
              project.id,
              run.id,
              plan.slug,
              plan.summary,
              milestones,
            ),
        );
        projectsRepository.setStatus(project.id, saved.status, {
          agentNote: plan.note,
          streamPreview: text,
        });
      },
    );

    projectsRepository.finishRun(run.id, "complete", {
      ...(usage ? usagePatch(usage) : {}),
      streamChars: text.length,
      preview: text,
      note: "DONE",
    });
    projectsRepository.event(
      project.id,
      "roadmap.planned",
      "Initial six-milestone roadmap published with a Canvas-to-Three.js rendering arc.",
    );
  } catch (error) {
    const message = errorMessage(error);
    const dbBusy = isDatabaseBusy(error);
    const quota = isQuotaError(message);
    const transient = !quota && !dbBusy && isTransientModelError(message);
    const publicMessage = dbBusy
      ? "DB BUSY"
      : quota
        ? "QUOTA"
        : transient
          ? "BUSY"
          : publicErrorLabel(message);
    projectsRepository.finishRun(run.id, "failed", {
      ...(usage ? usagePatch(usage) : {}),
      streamChars: text.length,
      preview: text,
      note: publicMessage,
      error: message,
    });

    if (dbBusy || transient) {
      const latest = projectsRepository.get(project.id) || project;
      // Local SQLite contention is infrastructure backpressure, not a failed
      // model attempt. Retry quickly and do not poison the model failure count.
      const retryAt = dbBusy
        ? Date.now() + 1_500
        : Date.now() + backoff(latest.failureCount);
      await measure(
        {
          start: () => "Schedule plan retry",
          end: (saved: Project | null) => ({
            status: saved?.status || "missing",
            retryAt: saved?.retryAt || 0,
          }),
          projectId: project.id,
          runId: run.id,
          retryAt,
        },
        () =>
          projectsRepository.failPlanning(
            project.id,
            run.id,
            false,
            message,
            retryAt,
            !dbBusy,
          ),
      );
      projectsRepository.event(
        project.id,
        dbBusy ? "agent.db_busy" : "agent.busy",
        dbBusy ? "DATABASE BUSY" : "MODEL BUSY",
      );
    } else {
      // Quota and malformed/permanent provider errors are not retried automatically.
      // Planning remains one model step; transient retries create a fresh run later.
      projectsRepository.failPlanning(project.id, run.id, true, message, 0);
    }
  } finally {
    stopHeartbeat();
  }
}

export async function buildNext(
  project: Project,
  owner: string,
  leaseMs: number,
): Promise<void> {
  const milestoneIndex = project.done;
  const milestone = project.milestones[milestoneIndex];
  if (!milestone) {
    projectsRepository.setStatus(project.id, "completed", { agentNote: "" });
    return;
  }

  const run = projectsRepository.createRun({
    projectId: project.id,
    kind: "build",
    milestoneIndex,
    model: modelName(),
  });
  let usage: AgentUsage | null = null;
  let activityText = "";
  let lastActivityEvent = "";
  const writeProgress = progressWriter(project.id, run.id);
  const stopHeartbeat = heartbeat(project.id, owner, leaseMs);

  try {
    const reserved = projectsRepository.reserveNextMilestone(
      project.id,
      milestoneIndex,
      run.id,
    );
    projectsRepository.event(
      project.id,
      "milestone.started",
      `Started ${milestone.title}.`,
    );

    await measure(
      {
        start: () => `Build milestone ${milestoneIndex + 1}`,
        end: () => ({
          runId: run.id,
          input: usage?.inputTokens || 0,
          output: usage?.outputTokens || 0,
          thinking: usage?.thinkingTokens || 0,
        }),
        projectId: project.id,
        runId: run.id,
        milestone: milestone.title,
      },
      async () => {
        const artifacts = await measure(
          {
            start: () => "Load artifacts",
            end: (items: ReturnType<typeof projectsRepository.artifacts>) => ({
              count: items.length,
            }),
            projectId: project.id,
          },
          () => projectsRepository.artifacts(project.id),
        );
        const previous = artifacts[artifacts.length - 1];
        const steering = await measure(
          {
            start: () => "Load steering",
            end: (
              items: ReturnType<typeof projectsRepository.openSteering>,
            ) => ({ count: items.length }),
            projectId: project.id,
          },
          () => projectsRepository.openSteering(project.id),
        );

        const result = await measure(
          {
            start: () => "Run build agent",
            end: (value: Awaited<ReturnType<typeof buildMilestone>>) => ({
              summary: value.summary,
              usage: value.usage,
            }),
            projectId: project.id,
            milestone: milestoneIndex + 1,
          },
          () =>
            buildMilestone(
              reserved,
              milestone,
              previous?.html,
              steering,
              (activity) => {
                activityText = activity.text;
                usage = activity.usage;
                writeProgress(
                  activity.text,
                  activity.note,
                  activity.usage,
                  false,
                  activity.sequence,
                );
                const durableActivity =
                  activity.event !== false &&
                  activity.note &&
                  !/^game\.tsx\s*[·-]/i.test(activity.note) &&
                  !/^(?:BUILDING|DONE|RETRY|WRITE\s+game\.tsx)$/i.test(
                    activity.note,
                  );
                if (durableActivity && activity.note !== lastActivityEvent) {
                  lastActivityEvent = activity.note;
                  persistActivityEvent(
                    project.id,
                    "agent.activity",
                    activity.note,
                  );
                }
              },
            ),
        );
        usage = result.usage;
        activityText = result.activityText;
        writeProgress(activityText, "DONE", result.usage, true);

        await measure(
          {
            start: () => "Set validating",
            end: () => ({ status: "validating" }),
            projectId: project.id,
            runId: run.id,
          },
          () =>
            projectsRepository.setRunStatus(project.id, run.id, "validating", {
              agentNote: "VALIDATE",
            }),
        );

        const sealed = await measure(
          {
            start: () => "Seal artifact",
            end: (html: string) => ({ bytes: html.length }),
            projectId: project.id,
          },
          () => sealHtml(result.html),
        );
        const artifactIssues = await measure(
          {
            start: () => "Validate artifact",
            end: (issues: string[]) => ({ issues: issues.length }),
            projectId: project.id,
          },
          () => validateArtifactHtml(sealed),
        );
        if (artifactIssues.length)
          throw new Error(`artifact rejected: ${artifactIssues.join("; ")}`);
        await measure(
          {
            start: () => "Set publishing",
            end: () => ({ status: "publishing" }),
            projectId: project.id,
            runId: run.id,
          },
          () =>
            projectsRepository.setRunStatus(project.id, run.id, "publishing", {
              agentNote: "PUBLISH",
            }),
        );
        const version = milestoneIndex + 1;
        const sha256 = createHash("sha256").update(sealed).digest("hex");
        projectsRepository.updateRunUsage(run.id, {
          ...usagePatch(result.usage),
          note: result.summary,
        });
        await measure(
          {
            start: () => `Publish v${version}`,
            end: (saved: Project) => ({
              version,
              status: saved.status,
              sha256: sha256.slice(0, 12),
            }),
            projectId: project.id,
            runId: run.id,
          },
          () =>
            projectsRepository.ship(
              project.id,
              milestoneIndex,
              {
                projectId: project.id,
                version,
                milestoneTitle: milestone.title,
                html: sealed,
                sha256,
                runId: run.id,
                createdAt: Date.now(),
              },
              undefined,
              steering.map((item) => item.id),
            ),
        );
      },
    );

    projectsRepository.finishRun(run.id, "complete", {
      ...(usage ? usagePatch(usage) : {}),
      preview: activityText,
    });
    projectsRepository.event(
      project.id,
      "artifact.published",
      `Published v${milestoneIndex + 1}: ${milestone.title}.`,
    );
    publishBuildNotification("milestone.completed", project.id, {
      projectName: project.name,
      milestoneIndex,
      version: milestoneIndex + 1,
      title: milestone.title,
      runId: run.id,
      inputTokens: usage?.inputTokens || 0,
      outputTokens: usage?.outputTokens || 0,
      thinkingTokens: usage?.thinkingTokens || 0,
      totalTokens:
        (usage?.inputTokens || 0) +
        (usage?.outputTokens || 0) +
        (usage?.thinkingTokens || 0),
    });
  } catch (error) {
    const message = errorMessage(error);
    const quota = isQuotaError(message);
    const dbBusy = isDatabaseBusy(error);
    const timedOut = isTimeoutError(message);
    const transient = !quota && !dbBusy && isTransientModelError(message);
    const latest = projectsRepository.get(project.id) || project;
    const failures = latest.failureCount + 1;
    // A timeout is transient once or twice, but an endless 150s retry loop is not
    // useful. The model timeout itself grows per retry in jsx-agent; after three
    // timed-out attempts, surface a real failure instead of pretending to build.
    const terminal = dbBusy
      ? false
      : timedOut
        ? failures >= 3
        : !transient && failures >= MAX_FAILURES;
    const retryAt = terminal
      ? 0
      : dbBusy
        ? Date.now() + 1_500
        : Date.now() + backoff(latest.failureCount);
    const note = dbBusy
      ? "DB BUSY"
      : quota
        ? "QUOTA"
        : timedOut
          ? "TIMEOUT"
          : transient
            ? "BUSY"
            : "RETRY";
    projectsRepository.finishRun(run.id, "failed", {
      ...(usage ? usagePatch(usage) : {}),
      preview: activityText,
      note,
      error: message,
    });
    const released = projectsRepository.releaseReservation(
      project.id,
      run.id,
      terminal ? "failed" : "queued",
      message,
      retryAt,
      !dbBusy,
    );
    if (released && !terminal && (dbBusy || transient)) {
      projectsRepository.setStatus(project.id, "queued", {
        agentNote: dbBusy ? "DB BUSY" : timedOut ? "TIMEOUT" : "BUSY",
        retryAt,
      });
      projectsRepository.event(
        project.id,
        dbBusy ? "agent.db_busy" : timedOut ? "agent.timeout" : "agent.busy",
        dbBusy
          ? "DATABASE BUSY"
          : timedOut
            ? "MODEL REQUEST TIMED OUT"
            : "MODEL BUSY",
      );
    } else if (released) {
      projectsRepository.event(
        project.id,
        terminal ? "agent.failed" : "agent.retry",
        message,
      );
      if (terminal)
        publishBuildNotification("milestone.failed", project.id, {
          projectName: project.name,
          milestoneIndex,
          version: milestoneIndex + 1,
          title: milestone.title,
          runId: run.id,
          error: message,
        });
    }
  } finally {
    stopHeartbeat();
  }
}
