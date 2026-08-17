import { createHash } from "node:crypto";
import { measure } from "measure-fn";
import { buildMilestone, planGame, type AgentUsage } from "../agent/jsx-agent";
import { sealHtml, toMilestone, validateArtifactHtml } from "../agent/output";
import { modelName } from "../config";
import { projectsRepository } from "../db/project-repository";
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

function isTransientModelError(message: string): boolean {
  return /(?:\b50[234]\b|\b503\b|UNAVAILABLE|high demand|temporar(?:y|ily)|timeout|timed out|ECONNRESET|ETIMEDOUT|fetch failed|network error)/i.test(
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
  let lastLength = 0;
  let lastNote = "";
  return (text: string, note: string, usage: AgentUsage, force = false) => {
    const t = Date.now();
    const noteChanged = note !== lastNote;
    if (
      !force &&
      !noteChanged &&
      t - lastWrite < 250 &&
      text.length - lastLength < 80
    )
      return;
    lastWrite = t;
    lastLength = text.length;
    lastNote = note;
    const preview = text.slice(-1800);
    projectsRepository.updateRunUsage(runId, {
      ...usagePatch(usage),
      streamChars: text.length,
      preview,
      note,
    });
    projectsRepository.updateLiveRun(projectId, runId, preview, note);
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

function heartbeat(
  projectId: string,
  owner: string,
  leaseMs: number,
): () => void {
  const timer = setInterval(
    () => projectsRepository.heartbeat(projectId, owner, leaseMs),
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
    error: "",
  });
  projectsRepository.event(
    project.id,
    "agent.assigned",
    `${project.agentId} started planning.`,
  );

  let usage: AgentUsage | null = null;
  let text = "";

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
            planGame(project.idea, (note) => {
              projectsRepository.updateRunUsage(run.id, { note });
              projectsRepository.updateLiveRun(project.id, run.id, "", note);
            }),
        );
        usage = result.usage;
        const { plan } = result;
        const milestones = plan.milestones.map((item) => toMilestone(item));

        text = planningPreview(
          plan.note,
          plan.slug,
          plan.summary,
          plan.milestones,
        );
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
      "Initial three-milestone roadmap published.",
    );
  } catch (error) {
    const message = errorMessage(error);
    const quota = isQuotaError(message);
    const transient = !quota && isTransientModelError(message);
    const publicMessage = quota
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

    if (transient) {
      const latest = projectsRepository.get(project.id) || project;
      const retryAt = Date.now() + backoff(latest.failureCount);
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
          ),
      );
      projectsRepository.event(project.id, "agent.busy", "MODEL BUSY");
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
              next: value.nextMilestone.title,
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
                writeProgress(activity.text, activity.note, activity.usage);
                if (activity.note && activity.note !== lastActivityEvent) {
                  lastActivityEvent = activity.note;
                  projectsRepository.event(
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
        if (!result.nextMilestone.title)
          throw new Error("agent did not propose the next rolling milestone");

        const nextMilestone = toMilestone(result.nextMilestone);
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
              nextMilestone,
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
    const next = projectsRepository.get(project.id)?.milestones[
      milestoneIndex + 1
    ];
    if (next)
      projectsRepository.event(
        project.id,
        "roadmap.rolled",
        `Added next milestone: ${next.title}.`,
      );
  } catch (error) {
    const message = errorMessage(error);
    const quota = isQuotaError(message);
    const timedOut = isTimeoutError(message);
    const transient = !quota && isTransientModelError(message);
    const latest = projectsRepository.get(project.id) || project;
    const failures = latest.failureCount + 1;
    // A timeout is transient once or twice, but an endless 150s retry loop is not
    // useful. The model timeout itself grows per retry in jsx-agent; after three
    // timed-out attempts, surface a real failure instead of pretending to build.
    const terminal = timedOut
      ? failures >= 3
      : !transient && failures >= MAX_FAILURES;
    const retryAt = terminal ? 0 : Date.now() + backoff(latest.failureCount);
    const note = quota
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
    );
    if (released && !terminal && transient) {
      projectsRepository.setStatus(project.id, "queued", {
        agentNote: timedOut ? "TIMEOUT" : "BUSY",
        retryAt,
      });
      projectsRepository.event(
        project.id,
        timedOut ? "agent.timeout" : "agent.busy",
        timedOut ? "MODEL REQUEST TIMED OUT" : "MODEL BUSY",
      );
    } else if (released) {
      projectsRepository.event(
        project.id,
        terminal ? "agent.failed" : "agent.retry",
        message,
      );
    }
  } finally {
    stopHeartbeat();
  }
}
