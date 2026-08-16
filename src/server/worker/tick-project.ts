import { createHash } from "node:crypto";
import { measure } from "measure-fn";
import { buildMilestone, planGame, type AgentUsage } from "../agent/jsx-agent";
import {
  parseAgentOutput,
  sealHtml,
  toMilestone,
  validateArtifactHtml,
} from "../agent/output";
import { modelName } from "../config";
import { projectsRepository } from "../db/project-repository";
import type { Project } from "../../shared/types";

const MAX_FAILURES = 3;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "agent run failed";
}

function backoff(failureCount: number): number {
  return Math.min(120_000, 5_000 * 2 ** Math.max(0, failureCount));
}

function usagePatch(usage: AgentUsage) {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    lastContextTokens: usage.lastContextTokens,
    usageEstimated: usage.estimated,
  };
}

function progressWriter(projectId: string, runId: string) {
  let lastWrite = 0;
  let lastLength = 0;
  return (text: string, note: string, usage: AgentUsage, force = false) => {
    const t = Date.now();
    if (!force && t - lastWrite < 250 && text.length - lastLength < 80) return;
    lastWrite = t;
    lastLength = text.length;
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
    agentNote: "Planning the first three playable milestones…",
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
      { label: "agent.project.plan", projectId: project.id, runId: run.id },
      async (m) => {
        const result = await m("jsx-ai.plan", () => planGame(project.idea));
        if (!result) throw new Error("planning returned no result");
        text = result.text;
        usage = result.usage;
        projectsRepository.updateRunUsage(run.id, {
          ...usagePatch(result.usage),
          streamChars: text.length,
          preview: text,
          note: "Initial roadmap drafted.",
        });
        projectsRepository.updateLiveRun(
          project.id,
          run.id,
          text,
          "Initial roadmap drafted.",
        );

        const parsed = await m("agent.plan.parse", () =>
          parseAgentOutput(text),
        );
        if (!parsed || parsed.milestones.length !== 3)
          throw new Error("planner must return exactly three milestones");
        const milestones = parsed.milestones.map((item) => toMilestone(item));
        await m("db.plan.publish", () =>
          projectsRepository.setPlanningResult(
            project.id,
            run.id,
            parsed.name || "untitled",
            parsed.summary || project.idea,
            milestones,
          ),
        );
      },
    );

    projectsRepository.finishRun(run.id, "complete", {
      ...(usage ? usagePatch(usage) : {}),
      preview: text,
      note: "Initial roadmap published.",
    });
    projectsRepository.event(
      project.id,
      "roadmap.planned",
      "Initial three-milestone roadmap published.",
    );
  } catch (error) {
    const message = errorMessage(error);
    const latest = projectsRepository.get(project.id) || project;
    const failures = latest.failureCount + 1;
    const terminal = failures >= MAX_FAILURES;
    projectsRepository.finishRun(run.id, "failed", {
      ...(usage ? usagePatch(usage) : {}),
      preview: text,
      error: message,
    });
    const failed = projectsRepository.failPlanning(
      project.id,
      run.id,
      terminal,
      message,
      terminal ? 0 : Date.now() + backoff(latest.failureCount),
    );
    if (failed)
      projectsRepository.event(
        project.id,
        terminal ? "agent.failed" : "agent.retry",
        message,
      );
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
    projectsRepository.setStatus(project.id, "completed", {
      agentNote: "No further milestone was proposed.",
    });
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
        label: "agent.project.build",
        projectId: project.id,
        runId: run.id,
        milestone: milestone.title,
      },
      async (m) => {
        const artifacts = await m("db.artifacts.load", () =>
          projectsRepository.artifacts(project.id),
        );
        const previous = artifacts?.[artifacts.length - 1];

        const result = await m("jsx-ai.tool-loop", () =>
          buildMilestone(reserved, milestone, previous?.html, (activity) => {
            activityText = activity.text;
            usage = activity.usage;
            writeProgress(activity.text, activity.note, activity.usage);
          }),
        );
        if (!result) throw new Error("build returned no result");
        usage = result.usage;
        activityText = result.activityText;
        writeProgress(activityText, result.summary, result.usage, true);

        await m("db.status.validating", () =>
          projectsRepository.setRunStatus(project.id, run.id, "validating", {
            agentNote: "Validating index.html before publishing…",
          }),
        );

        const sealed = await m("artifact.seal", () => sealHtml(result.html));
        const artifactIssues = await m("artifact.validate", () =>
          validateArtifactHtml(sealed),
        );
        if (artifactIssues.length)
          throw new Error(`artifact rejected: ${artifactIssues.join("; ")}`);
        if (!result.nextMilestone.title)
          throw new Error("agent did not propose the next rolling milestone");

        const nextMilestone = toMilestone(result.nextMilestone);
        await m("db.status.publishing", () =>
          projectsRepository.setRunStatus(project.id, run.id, "publishing", {
            agentNote: "Publishing the new playable version…",
          }),
        );
        const version = milestoneIndex + 1;
        const sha256 = createHash("sha256").update(sealed).digest("hex");
        projectsRepository.updateRunUsage(run.id, {
          ...usagePatch(result.usage),
          note: result.summary,
        });
        await m("artifact.publish", () =>
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
    const latest = projectsRepository.get(project.id) || project;
    const failures = latest.failureCount + 1;
    const terminal = failures >= MAX_FAILURES;
    projectsRepository.finishRun(run.id, "failed", {
      ...(usage ? usagePatch(usage) : {}),
      preview: activityText,
      error: message,
    });
    const released = projectsRepository.releaseReservation(
      project.id,
      run.id,
      terminal ? "failed" : "queued",
      message,
      terminal ? 0 : Date.now() + backoff(latest.failureCount),
    );
    if (released)
      projectsRepository.event(
        project.id,
        terminal ? "agent.failed" : "agent.retry",
        message,
      );
  } finally {
    stopHeartbeat();
  }
}
