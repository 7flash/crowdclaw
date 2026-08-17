/** @jsxImportSource jsx-ai */
import { md, runAgent } from "jsx-ai";
import type {
  AgentContext,
  AgentRunResult,
  AgentUsage as JsxAgentUsage,
  CanonicalToolCall,
  ExtractedMessage,
  JsonObject,
  JsonValue,
  ToolParametersSchema,
} from "jsx-ai";
import { measure } from "measure-fn";
import {
  agentMaxDurationMs,
  agentMaxTokens,
  agentRequestTimeoutMs,
  buildRequestTimeoutMs,
  contextWindow,
  jsxAiRuntime,
  modelName,
} from "../config";
import type { Milestone, Project, Steering } from "../../shared/types";
import { validateArtifactHtml } from "./output";
import {
  ensureWorkspaceIndex,
  readWorkspaceIndex,
  writeWorkspaceFile,
} from "./workspace";

const STRATEGY = "hybrid" as const;
const MODEL = () => modelName();
const TEMPERATURE = () => (/^gemini-3(?:\.|-|$)/i.test(MODEL()) ? 1.0 : 0.2);
const PLAN_MAX_STEPS = 1;
const PLAN_MAX_TOOL_CALLS = 1;

export const PLAN_SYS_SOURCE = `You are a game designer planning a tiny browser game that will be implemented by an autonomous coding agent.

Produce exactly three milestones:
- Milestone 1 must create an immediately playable self-contained game, not a scaffold.
- Milestone 2 must materially improve gameplay, progression, feedback, or game feel.
- Milestone 3 must deepen the game rather than merely restyle it.
- Costs are whole numbers from 1 to 4.

Submit the complete plan through submit_game_plan. Do not answer in a custom text format.`;

export const BUILD_SYS_SOURCE = `You are an autonomous browser-game engineer producing one complete browser-game revision.

The user message contains the complete current index.html, so do not spend a model turn inspecting files.
In this single model turn, call tools in this order:
1. public_status with a concrete 2-8 word public update.
2. write_file for index.html with the complete revised document.
3. complete_milestone.

Artifact contract:
- index.html must be a complete self-contained HTML document.
- Plain HTML/CSS/JavaScript; no build step.
- No external scripts, fonts, images, imports, CDNs, fetches, websockets, or network requests.
- No localStorage, sessionStorage, or IndexedDB.
- Fill the frame and keep the game responsive.
- Support keyboard and pointer input and show controls on screen.
- Include a real game loop, score or win/lose state, and restart without a reload.
- Preserve strong existing gameplay and materially implement the requested milestone.

Tool calls are executed in order. complete_milestone validates the file written earlier in the same response.
The public_status is intentionally public; it is not private chain-of-thought.`;

export type AgentUsage = {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  lastContextTokens: number;
  contextWindow: number;
  estimated: boolean;
};

export type AgentActivity = {
  text: string;
  note: string;
  usage: AgentUsage;
};

export type PlannedMilestone = {
  title: string;
  goal: string;
  costCredits: number;
};

export type GamePlan = {
  slug: string;
  summary: string;
  note: string;
  milestones: PlannedMilestone[];
};

export type PlanResult = {
  plan: GamePlan;
  usage: AgentUsage;
  result: AgentRunResult<PlanningState>;
};

export type BuildPhaseResult = {
  html: string;
  summary: string;
  nextMilestone: { title: string; goal: string; costCredits: number };
  usage: AgentUsage;
  activityText: string;
  result: AgentRunResult<CompletionState>;
};

type PlanningState = { plan?: GamePlan; validationError?: string };
type CompletionState = {
  validationError?: string;
  completion?: {
    summary: string;
    nextMilestone: string;
    nextGoal: string;
    nextCost: number;
  };
};

const PLAN_SCHEMA: ToolParametersSchema = {
  type: "object",
  properties: {
    slug: {
      type: "string",
      description: "Short kebab-case game name",
    },
    summary: {
      type: "string",
      description: "One plain sentence describing the game",
    },
    note: {
      type: "string",
      description:
        "One short public design note about the core loop, maximum 8 words",
    },
    milestones: {
      type: "array",
      description: "Exactly three concrete implementation milestones",
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Concrete 3-7 word milestone title",
          },
          goal: {
            type: "string",
            description:
              "What the player should experience after this milestone",
          },
          cost: {
            type: "integer",
          },
        },
        required: ["title", "goal", "cost"],
      },
    },
  },
  required: ["slug", "summary", "note", "milestones"],
};

const COMPLETE_SCHEMA: ToolParametersSchema = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "Concise description of completed gameplay work",
    },
    next_milestone: {
      type: "string",
      description:
        "One concrete 3-7 word gameplay milestone that should come next",
    },
    next_goal: {
      type: "string",
      description:
        "What the player should experience after that next milestone",
    },
    next_cost: {
      type: "integer",
    },
  },
  required: ["summary", "next_milestone", "next_goal", "next_cost"],
};

const PlanningTools = () => (
  <tool
    name="submit_game_plan"
    description="Submit the complete three-milestone game plan"
    schema={PLAN_SCHEMA}
  />
);

const WorkspaceTools = () => (
  <>
    <tool
      name="public_status"
      description="Publish one short public activity update for someone watching the agent"
    >
      <param name="text" type="string" required>
        Concrete action, 2-8 words
      </param>
    </tool>
    <tool
      name="write_file"
      description="Replace the complete index.html browser game"
    >
      <param name="path" type="string" required>
        Must be index.html
      </param>
      <param name="content" type="string" required>
        Complete file contents
      </param>
    </tool>
    <tool
      name="complete_milestone"
      description="Accept the milestone after the index.html written earlier in this response passes host validation"
      schema={COMPLETE_SCHEMA}
    />
  </>
);

function Conversation({ history }: { history: readonly ExtractedMessage[] }) {
  return (
    <>
      {history.map((message) => (
        <message
          role={message.role}
          toolCalls={message.toolCalls}
          toolCallId={message.toolCallId}
          toolName={message.toolName}
          isError={message.isError}
        >
          {message.content}
        </message>
      ))}
    </>
  );
}

function PlanningPrompt({ history }: { history: readonly ExtractedMessage[] }) {
  return (
    <prompt
      model={MODEL()}
      strategy={STRATEGY}
      temperature={TEMPERATURE()}
      maxTokens={1800}
    >
      <system>{md`${PLAN_SYS_SOURCE}`}</system>
      <PlanningTools />
      <Conversation history={history} />
    </prompt>
  );
}

function MilestonePrompt({
  history,
}: {
  history: readonly ExtractedMessage[];
}) {
  return (
    <prompt
      model={MODEL()}
      strategy={STRATEGY}
      temperature={TEMPERATURE()}
      maxTokens={agentMaxTokens()}
    >
      <system>{md`${BUILD_SYS_SOURCE}`}</system>
      <WorkspaceTools />
      <Conversation history={history} />
    </prompt>
  );
}

function asObject(value: JsonValue | undefined, label: string): JsonObject {
  if (value == null || Array.isArray(value) || typeof value !== "object")
    throw new Error(`${label} must be an object`);
  return value;
}

function asArray(value: JsonValue | undefined, label: string): JsonValue[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function asString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function asInteger(value: JsonValue | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new Error(`${label} must be an integer`);
  return value;
}

function optionalString(value: JsonValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function compactWords(value: string, maxWords: number, maxChars = 180): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, maxWords)
    .join(" ")
    .slice(0, maxChars)
    .trim();
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "tiny-game";
}

function normalizedCost(
  value: JsonValue | undefined,
  fallback: number,
): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(4, Math.round(numeric)));
}

const PLAN_FALLBACKS = [
  {
    title: "Playable Core Loop",
    goal: "Ship an immediately playable loop with controls, scoring, failure, and restart.",
    costCredits: 2,
  },
  {
    title: "Feedback And Progression",
    goal: "Improve game feel, feedback, challenge progression, and moment-to-moment rewards.",
    costCredits: 2,
  },
  {
    title: "Variety And Depth",
    goal: "Add meaningful gameplay variety and decisions that deepen repeat runs.",
    costCredits: 3,
  },
] satisfies PlannedMilestone[];

/**
 * The initial planner intentionally gets one model request, so presentation-level
 * imperfections must be repaired here instead of asking the model for another turn.
 * Only reject a plan when it contains no usable milestone semantics at all.
 */
export function normalizePlan(args: JsonObject, idea: string): GamePlan {
  const rawMilestones = Array.isArray(args.milestones) ? args.milestones : [];
  const milestones: PlannedMilestone[] = [];

  for (
    let index = 0;
    index < rawMilestones.length && milestones.length < 3;
    index += 1
  ) {
    const value = rawMilestones[index];
    if (!value || Array.isArray(value) || typeof value !== "object") continue;
    const item = value as JsonObject;
    const title = compactWords(
      optionalString(item.title) || optionalString(item.name),
      7,
      90,
    );
    const goal = compactWords(
      optionalString(item.goal) || optionalString(item.description),
      60,
      360,
    );
    if (!title && !goal) continue;
    const fallback = PLAN_FALLBACKS[milestones.length];
    milestones.push({
      title: title || fallback.title,
      goal: goal || fallback.goal,
      costCredits: normalizedCost(
        item.cost ?? item.costCredits,
        fallback.costCredits,
      ),
    });
  }

  if (!milestones.length)
    throw new Error("submit_game_plan returned no usable milestones");
  while (milestones.length < 3)
    milestones.push({ ...PLAN_FALLBACKS[milestones.length] });

  const summarySource =
    optionalString(args.summary) || optionalString(args.description) || idea;
  const summary =
    compactWords(summarySource, 40, 180) || "A tiny playable browser game.";
  const noteSource =
    optionalString(args.note) ||
    optionalString(args.status) ||
    "Building the playable core";
  const note = compactWords(noteSource, 8, 100) || "Building the playable core";
  const slugSource =
    optionalString(args.slug) || optionalString(args.name) || summary || idea;

  return {
    slug: slugify(slugSource),
    summary,
    note,
    milestones: milestones.slice(0, 3),
  };
}

function blankUsage(): AgentUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    lastContextTokens: 0,
    contextWindow: contextWindow(),
    estimated: false,
  };
}

function usageFromAgent(usage: JsxAgentUsage | undefined): AgentUsage {
  const inputTokens = Math.max(0, Math.floor(usage?.inputTokens || 0));
  const outputTokens = Math.max(0, Math.floor(usage?.outputTokens || 0));
  const thinkingTokens = Math.max(0, Math.floor(usage?.thinkingTokens || 0));
  return {
    inputTokens,
    outputTokens,
    thinkingTokens,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    lastContextTokens: inputTokens + outputTokens + thinkingTokens,
    contextWindow: contextWindow(),
    estimated: false,
  };
}

function toolResult(
  call: CanonicalToolCall,
  content: string,
  isError = false,
): ExtractedMessage {
  return {
    role: "tool",
    content,
    toolCallId: call.id,
    toolName: call.name,
    ...(isError ? { isError: true } : {}),
  };
}

function executePlanningTool(
  idea: string,
  call: CanonicalToolCall,
  context: AgentContext<PlanningState>,
): ExtractedMessage {
  if (call.name !== "submit_game_plan")
    return toolResult(call, `Unknown planning tool: ${call.name}`, true);
  try {
    const plan = normalizePlan(call.args, idea);
    context.state.plan = plan;
    context.state.validationError = undefined;
    return toolResult(
      call,
      `Accepted ${plan.slug} (${plan.milestones.length} milestones).`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.state.validationError = message;
    return toolResult(call, message, true);
  }
}

function publicStatus(raw: JsonValue | undefined): string {
  const words = asString(raw, "text")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .slice(0, 8);
  if (words.length < 2) throw new Error("public_status requires 2-8 words");
  return words.join(" ").slice(0, 100);
}

function executeWorkspaceTool(
  projectId: string,
  call: CanonicalToolCall,
  context: AgentContext<CompletionState>,
): { message: ExtractedMessage; note: string } {
  try {
    switch (call.name) {
      case "public_status": {
        const text = publicStatus(call.args.text);
        return { message: toolResult(call, "Published."), note: text };
      }
      case "write_file": {
        const path = asString(call.args.path, "path");
        if (path.replaceAll("\\", "/") !== "index.html")
          throw new Error("write_file only accepts index.html");
        const content = asString(call.args.content, "content");
        writeWorkspaceFile(projectId, "index.html", content);
        return {
          message: toolResult(
            call,
            `Wrote index.html (${content.length} chars).`,
          ),
          note: "WRITE index.html",
        };
      }
      case "complete_milestone": {
        const summary = asString(call.args.summary, "summary");
        const nextMilestone = asString(
          call.args.next_milestone,
          "next_milestone",
        );
        const words = nextMilestone.split(/\s+/).filter(Boolean).length;
        if (words < 3 || words > 7)
          throw new Error("next_milestone must contain 3-7 words");
        const nextCost = asInteger(call.args.next_cost, "next_cost");
        if (nextCost < 1 || nextCost > 4)
          throw new Error("next_cost must be between 1 and 4");
        const nextGoal = asString(call.args.next_goal, "next_goal");
        const html = readWorkspaceIndex(projectId);
        const issues = validateArtifactHtml(html);
        if (issues.length) {
          context.state.validationError = issues.join("; ");
          return {
            message: toolResult(
              call,
              `Completion rejected: ${issues.join("; ")}`,
              true,
            ),
            note: "FIX index.html",
          };
        }
        context.state.validationError = undefined;
        context.state.completion = {
          summary,
          nextMilestone,
          nextGoal,
          nextCost,
        };
        return {
          message: toolResult(call, `Milestone accepted: ${summary}`),
          note: "DONE",
        };
      }
      default:
        return {
          message: toolResult(
            call,
            `Unknown workspace tool: ${call.name}`,
            true,
          ),
          note: `TOOL ${call.name}`,
        };
    }
  } catch (error) {
    return {
      message: toolResult(
        call,
        error instanceof Error ? error.message : String(error),
        true,
      ),
      note: `ERROR ${call.name}`,
    };
  }
}

function summarizeAgentRun<State>(result: AgentRunResult<State>) {
  return {
    reason: result.reason,
    steps: result.steps.length,
    toolCalls: result.toolCallsExecuted,
    elapsedMs: result.elapsedMs,
    usage: result.usage,
  };
}

function summarizeToolMessage(message: ExtractedMessage) {
  return {
    tool: message.toolName || "",
    error: Boolean(message.isError),
    chars: message.content.length,
    ...(message.isError
      ? { reason: message.content.replace(/\s+/g, " ").slice(0, 140) }
      : {}),
  };
}

export async function planGame(
  idea: string,
  onNote?: (note: string) => void,
): Promise<PlanResult> {
  const state: PlanningState = {};
  onNote?.("THINKING");
  const result = await measure(
    {
      start: () => "jsx-ai planning agent",
      end: summarizeAgentRun,
      model: MODEL(),
      strategy: STRATEGY,
    },
    () =>
      runAgent({
        state,
        history: [{ role: "user", content: idea }],
        buildPrompt: (history) => <PlanningPrompt history={history} />,
        executeTool: async (call, context) =>
          measure(
            {
              start: () => `Tool ${call.name}`,
              end: summarizeToolMessage,
              tool: call.name,
            },
            () => executePlanningTool(idea, call, context),
          ),
        // Keep runAgent's default runtime-aware model call so JSX_AI_RUNTIME can select Codex.
        callOptions: {
          model: MODEL(),
          strategy: STRATEGY,
          ...(jsxAiRuntime() ? { runtime: jsxAiRuntime() } : {}),
          // Initial planning is deliberately one provider request. A 429 or other
          // provider failure is surfaced to the project instead of retried silently.
          retries: 0,
          timeoutMs: Math.min(agentRequestTimeoutMs(), 45_000),
        },
        maxSteps: PLAN_MAX_STEPS,
        maxToolCalls: PLAN_MAX_TOOL_CALLS,
        isComplete: (_response, _toolResults, context) =>
          Boolean(context.state.plan),
      }),
  );

  if (result.reason !== "completed" || !state.plan) {
    if (state.validationError)
      throw new Error(`Planning rejected: ${state.validationError}`);
    throw new Error(
      `Planning stopped with ${result.reason} without a valid plan.`,
    );
  }
  onNote?.(state.plan.note);
  return { plan: state.plan, usage: usageFromAgent(result.usage), result };
}

export async function buildMilestone(
  project: Project,
  milestone: Milestone,
  previousHtml: string | undefined,
  steering: Steering[],
  onActivity: (activity: AgentActivity) => void,
): Promise<BuildPhaseResult> {
  ensureWorkspaceIndex(project.id, previousHtml);
  let currentHtml = previousHtml || "";
  try {
    currentHtml = readWorkspaceIndex(project.id);
  } catch {}

  const previousFeedback =
    project.error && !/^(?:quota|busy)$/i.test(project.error.trim())
      ? `PREVIOUS ATTEMPT FEEDBACK: ${project.error.slice(0, 500)}`
      : "";

  const goal = md`
    GAME: ${project.summary || project.idea}
    MILESTONE ${project.done + 1}: ${milestone.title}
    ${milestone.goal ? `GOAL: ${milestone.goal}` : ""}
    BUDGET SIGNAL: ${milestone.costCredits}/4
    ${previousFeedback}

    ${
      steering.length
        ? `SUPPORTER STEERING:\n${steering.map((item) => `- ${item.influence.toFixed(2)} influence: ${item.instruction}`).join("\n")}\nUse influence as weight. Apply compatible requests and let stronger requests shape the rolling milestone.`
        : ""
    }

    CURRENT INDEX.HTML:
    \`\`\`html
    ${currentHtml || "<!-- empty first release -->"}
    \`\`\`

    Produce the complete revised index.html now. Use one public_status, then write_file, then complete_milestone in this same response.
  `;

  const state: CompletionState = {};
  let activityText = "CODING\n";
  let liveUsage = blankUsage();
  onActivity({ text: activityText, note: "CODING", usage: liveUsage });

  const result = await measure(
    {
      start: () => "jsx-ai build agent",
      end: summarizeAgentRun,
      projectId: project.id,
      milestone: project.done + 1,
      model: MODEL(),
      strategy: STRATEGY,
    },
    () =>
      runAgent({
        state,
        history: [{ role: "user", content: goal }],
        buildPrompt: (history) => <MilestonePrompt history={history} />,
        executeTool: async (call, context) => {
          const executed = await measure(
            {
              start: () => `Tool ${call.name}`,
              end: (value: ReturnType<typeof executeWorkspaceTool>) => ({
                note: value.note,
                ...summarizeToolMessage(value.message),
              }),
              projectId: project.id,
              tool: call.name,
            },
            () => executeWorkspaceTool(project.id, call, context),
          );
          activityText += `${executed.note}\n`;
          onActivity({
            text: activityText.slice(-1800),
            note: executed.note,
            usage: liveUsage,
          });
          // The operations are real, but they can complete faster than the SSE snapshot
          // cadence. Give the browser one paint window between visible tool steps.
          if (call.name === "public_status") await Bun.sleep(260);
          if (call.name === "write_file") await Bun.sleep(620);
          return executed.message;
        },
        callOptions: {
          model: MODEL(),
          strategy: STRATEGY,
          ...(jsxAiRuntime() ? { runtime: jsxAiRuntime() } : {}),
          retries: 0,
          timeoutMs: buildRequestTimeoutMs(),
        },
        // One model request per build attempt. Giving the complete current HTML in
        // the prompt removes the list/read -> second-model-turn stall seen on Codex.
        maxSteps: 1,
        maxToolCalls: 4,
        maxDurationMs: agentMaxDurationMs(),
        isComplete: (_response, _toolResults, context) =>
          Boolean(context.state.completion),
      }),
  );

  liveUsage = usageFromAgent(result.usage);
  onActivity({
    text: activityText.slice(-1800),
    note: state.completion ? "DONE" : "RETRY",
    usage: liveUsage,
  });

  if (result.reason !== "completed" || !state.completion) {
    const validation = state.validationError
      ? ` Host validation: ${state.validationError}`
      : "";
    throw new Error(
      `Milestone attempt ended before validated completion.${validation}`,
    );
  }

  return {
    html: readWorkspaceIndex(project.id),
    summary: state.completion.summary,
    nextMilestone: {
      title: state.completion.nextMilestone,
      goal: state.completion.nextGoal,
      costCredits: state.completion.nextCost,
    },
    usage: liveUsage,
    activityText,
    result,
  };
}
