import { createHash } from "node:crypto";
import { measure } from "measure-fn";
import {
  callOnce,
  callUntilComplete,
  type AgentUsage,
} from "../agent/anthropic";
import { parseAgentOutput, sealHtml, toMilestone } from "../agent/output";
import { renderBuildPrompt, renderPlanPrompt } from "../agent/prompts";
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
  };
}

function progressWriter(projectId: string, runId: string) {
  let lastWrite = 0;
  let lastLength = 0;
  return (text: string, usage: AgentUsage, force = false) => {
    const t = Date.now();
    if (!force && t - lastWrite < 350 && text.length - lastLength < 240) return;
    lastWrite = t;
    lastLength = text.length;
    const preview = text.slice(-1800);
    projectsRepository.updateRunUsage(runId, {
      ...usagePatch(usage),
      streamChars: text.length,
      preview,
    });
    projectsRepository.updateLiveRun(projectId, runId, preview);
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
  const writeProgress = progressWriter(project.id, run.id);

  try {
    await measure(
      { label: "agent.project.plan", projectId: project.id, runId: run.id },
      async (m) => {
        const prompt = await m("jsxai.prompt.render", () =>
          renderPlanPrompt(project.idea),
        );
        if (!prompt) throw new Error("failed to render planning prompt");
        const result = await m("anthropic.plan", () =>
          callOnce(
            prompt.system,
            [{ role: "user", content: prompt.user }],
            (nextText, nextUsage) => {
              text = nextText;
              usage = nextUsage;
              writeProgress(nextText, nextUsage);
            },
          ),
        );
        if (!result) throw new Error("planning returned no result");
        text = result.text;
        usage = result.usage;
        writeProgress(text, usage, true);

        const parsed = await m("agent.plan.parse", () =>
          parseAgentOutput(text),
        );
        if (!parsed || parsed.milestones.length !== 3)
          throw new Error("planner must return exactly three milestones");
        const milestones = parsed.milestones.map((item) => toMilestone(item));
        await m("db.plan.publish", () =>
          projectsRepository.setPlanningResult(
            project.id,
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
    projectsRepository.setStatus(project.id, terminal ? "failed" : "planning", {
      currentRunId: null,
      streamPreview: "",
      error: message,
      agentNote: terminal
        ? "Planning stopped after repeated failures."
        : "Planning hit a transient failure; I’ll retry automatically.",
      failureCount: failures,
      retryAt: terminal ? 0 : Date.now() + backoff(latest.failureCount),
    });
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
  let text = "";
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
        const prompt = await m("jsxai.prompt.render", () =>
          renderBuildPrompt(reserved, milestone, previous?.html),
        );
        if (!prompt) throw new Error("failed to render build prompt");

        const result = await m("anthropic.build", () =>
          callUntilComplete(
            prompt.system,
            prompt.user,
            (nextText, nextUsage) => {
              text = nextText;
              usage = nextUsage;
              const parsed = parseAgentOutput(nextText);
              const note = parsed.notes[parsed.notes.length - 1] || "";
              if (note)
                projectsRepository.updateLiveRun(
                  project.id,
                  run.id,
                  nextText.slice(-1800),
                  note,
                );
              writeProgress(nextText, nextUsage);
            },
          ),
        );
        if (!result) throw new Error("build returned no result");
        text = result.text;
        usage = result.usage;
        writeProgress(text, usage, true);

        await m("db.status.validating", () =>
          projectsRepository.setStatus(project.id, "validating", {
            currentRunId: run.id,
            agentNote: "Validating the generated artifact before publishing…",
          }),
        );
        const parsed = await m("agent.build.parse", () =>
          parseAgentOutput(text),
        );
        if (!parsed) throw new Error("could not parse build output");
        const sealed = await m("artifact.seal", () => sealHtml(parsed.code));
        if (!sealed || sealed.length < 300 || !/<\/html>/i.test(sealed))
          throw new Error("agent did not finish a playable HTML artifact");
        if (!parsed.milestones[0])
          throw new Error("agent did not propose the next rolling milestone");

        const nextMilestone = toMilestone(parsed.milestones[0]);
        const note =
          parsed.notes[parsed.notes.length - 1] ||
          `Completed ${milestone.title}.`;
        await m("db.status.publishing", () =>
          projectsRepository.setStatus(project.id, "publishing", {
            currentRunId: run.id,
            agentNote: "Publishing the new playable version…",
          }),
        );
        const version = milestoneIndex + 1;
        const sha256 = createHash("sha256").update(sealed).digest("hex");
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
        projectsRepository.updateRunUsage(run.id, { note });
      },
    );

    projectsRepository.finishRun(run.id, "complete", {
      ...(usage ? usagePatch(usage) : {}),
      preview: text,
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
      preview: text,
      error: message,
    });
    projectsRepository.releaseReservation(
      project.id,
      terminal ? "failed" : "queued",
      message,
      terminal ? 0 : Date.now() + backoff(latest.failureCount),
    );
    projectsRepository.event(
      project.id,
      terminal ? "agent.failed" : "agent.retry",
      message,
    );
  } finally {
    stopHeartbeat();
  }
}
