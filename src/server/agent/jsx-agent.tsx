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
  agentMaxSteps,
  agentMaxTokens,
  agentRequestTimeoutMs,
  contextWindow,
  jsxAiRuntime,
  modelName,
} from "../config";
import type { Milestone, Project, Steering } from "../../shared/types";
import { validateArtifactHtml } from "./output";
import {
  ensureWorkspaceIndex,
  listWorkspaceFiles,
  readWorkspaceFile,
  readWorkspaceIndex,
  writeWorkspaceFile,
} from "./workspace";

const STRATEGY = "hybrid" as const;
const MODEL = () => modelName();
const TEMPERATURE = () => (/^gemini-3(?:\.|-|$)/i.test(MODEL()) ? 1.0 : 0.2);
const PLAN_MAX_STEPS = 1;
const PLAN_MAX_TOOL_CALLS = 1;
const BUILD_MAX_TOOL_CALLS = 48;

export const PLAN_SYS_SOURCE = `You are a game designer planning a tiny browser game that will be implemented by an autonomous coding agent.

Produce exactly three milestones:
- Milestone 1 must create an immediately playable self-contained game, not a scaffold.
- Milestone 2 must materially improve gameplay, progression, feedback, or game feel.
- Milestone 3 must deepen the game rather than merely restyle it.
- Costs are whole numbers from 1 to 4.

Submit the complete plan through submit_game_plan. Do not answer in a custom text format.`;

export const BUILD_SYS_SOURCE = `You are an autonomous browser-game engineer working in a real project directory.

Use the workspace tools to inspect and modify the project. The workspace, not old chat history, is the durable source of truth between milestones.

Artifact contract:
- index.html must be a complete self-contained HTML document.
- Plain HTML/CSS/JavaScript; no build step.
- No external scripts, fonts, images, imports, CDNs, fetches, websockets, or network requests.
- No localStorage, sessionStorage, or IndexedDB.
- Fill the frame and keep the game responsive.
- Support keyboard and pointer input and show controls on screen.
- Include a real game loop, score or win/lose state, and restart without a reload.
- Prefer a compact coherent implementation over many files.
- Read relevant existing files before modifying them unless their full current source is already in context.

In every model step, include one public_status before meaningful file changes or completion so someone watching can follow the work. It is not private reasoning. Keep it concrete and under eight words.
complete_milestone is not ceremonial. The host validates index.html and may reject completion with concrete errors. Keep working until validation succeeds.`;

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

type PlanningState = { plan?: GamePlan };
type CompletionState = {
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
      description="Write or replace a UTF-8 file inside the game project"
    >
      <param name="path" type="string" required>
        Project-relative path such as index.html
      </param>
      <param name="content" type="string" required>
        Complete file contents
      </param>
    </tool>
    <tool
      name="read_file"
      description="Read a UTF-8 file from the current game project"
    >
      <param name="path" type="string" required>
        Project-relative path
      </param>
    </tool>
    <tool
      name="list_files"
      description="List the current game project files and byte sizes"
    />
    <tool
      name="complete_milestone"
      description="Request completion only after the gameplay goal is implemented; the host validates index.html before accepting it"
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

function parsePlan(args: JsonObject): GamePlan {
  const milestones = asArray(args.milestones, "milestones").map(
    (value, index) => {
      const item = asObject(value, `milestones[${index}]`);
      const title = asString(item.title, `milestones[${index}].title`);
      const words = title.split(/\s+/).filter(Boolean).length;
      if (words < 3 || words > 7)
        throw new Error(`milestones[${index}].title must contain 3-7 words`);
      const cost = asInteger(item.cost, `milestones[${index}].cost`);
      if (cost < 1 || cost > 4)
        throw new Error(`milestones[${index}].cost must be between 1 and 4`);
      return {
        title,
        goal: asString(item.goal, `milestones[${index}].goal`),
        costCredits: cost,
      };
    },
  );
  if (milestones.length !== 3)
    throw new Error("A game plan must contain exactly three milestones");
  const slug = asString(args.slug, "slug");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new Error("slug must be kebab-case");
  const summary = asString(args.summary, "summary");
  if (summary.length < 8 || summary.length > 180)
    throw new Error("summary must be 8-180 characters");
  const note = asString(args.note, "note").split(/\s+/).slice(0, 8).join(" ");
  return { slug, summary, note, milestones };
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

function manifest(projectId: string): Array<{ file: string; bytes: number }> {
  return listWorkspaceFiles(projectId).map((file) => ({
    file,
    bytes: readWorkspaceFile(projectId, file).length,
  }));
}

function executePlanningTool(
  call: CanonicalToolCall,
  context: AgentContext<PlanningState>,
): ExtractedMessage {
  if (call.name !== "submit_game_plan")
    return toolResult(call, `Unknown planning tool: ${call.name}`, true);
  try {
    const plan = parsePlan(call.args);
    context.state.plan = plan;
    return toolResult(call, `Accepted ${plan.slug}.`);
  } catch (error) {
    return toolResult(
      call,
      error instanceof Error ? error.message : String(error),
      true,
    );
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
        const content = asString(call.args.content, "content");
        writeWorkspaceFile(projectId, path, content);
        return {
          message: toolResult(call, `Wrote ${path} (${content.length} chars).`),
          note: `WRITE ${path}`,
        };
      }
      case "read_file": {
        const path = asString(call.args.path, "path");
        return {
          message: toolResult(call, readWorkspaceFile(projectId, path)),
          note: `READ ${path}`,
        };
      }
      case "list_files":
        return {
          message: toolResult(
            call,
            JSON.stringify(manifest(projectId), null, 2),
          ),
          note: "FILES",
        };
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
          return {
            message: toolResult(
              call,
              `Completion rejected. Fix index.html and try again:\n- ${issues.join("\n- ")}`,
              true,
            ),
            note: "FIX index.html",
          };
        }
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
            () => executePlanningTool(call, context),
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
  const files = listWorkspaceFiles(project.id);
  const goal = md`
    GAME: ${project.summary || project.idea}
    MILESTONE ${project.done + 1}: ${milestone.title}
    ${milestone.goal ? `GOAL: ${milestone.goal}` : ""}
    BUDGET SIGNAL: ${milestone.costCredits}/4

    ${
      files.length
        ? `The workspace already contains: ${files.join(", ")}. Inspect relevant files and evolve the existing game.`
        : "The workspace is empty. Build the first immediately playable version now."
    }

    Preserve strong existing mechanics. Do not satisfy this milestone with cosmetic changes alone.
    ${
      steering.length
        ? `SUPPORTER STEERING:\n${steering.map((item) => `- ${item.influence.toFixed(2)} influence: ${item.instruction}`).join("\n")}\nUse influence as weight. Apply compatible requests and let stronger requests shape the rolling milestone.`
        : ""
    }
    Leave a complete self-contained index.html, then call complete_milestone.
  `;

  const state: CompletionState = {};
  let activityText = "OPEN WORKSPACE\n";
  let liveUsage = blankUsage();
  onActivity({ text: activityText, note: "OPEN WORKSPACE", usage: liveUsage });
  if (files.length) {
    activityText += `FILES ${files.length}\n`;
    onActivity({ text: activityText, note: "FILES", usage: liveUsage });
  }

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
        // Fresh model history per milestone. The filesystem is durable state.
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
          return executed.message;
        },
        // Keep runAgent's default runtime-aware model call here too.
        callOptions: {
          model: MODEL(),
          strategy: STRATEGY,
          ...(jsxAiRuntime() ? { runtime: jsxAiRuntime() } : {}),
          retries: 2,
          timeoutMs: agentRequestTimeoutMs(),
        },
        maxSteps: agentMaxSteps(),
        maxToolCalls: BUILD_MAX_TOOL_CALLS,
        maxDurationMs: agentMaxDurationMs(),
        isComplete: (_response, _toolResults, context) =>
          Boolean(context.state.completion),
        onNoToolCalls: (response) =>
          response.text.trim()
            ? "Continue with the workspace tools. complete_milestone is valid only after the artifact passes host validation."
            : "Inspect or modify the workspace with tools and continue the milestone.",
      }),
  );

  liveUsage = usageFromAgent(result.usage);
  onActivity({
    text: activityText.slice(-1800),
    note: state.completion ? "DONE" : "STOPPED",
    usage: liveUsage,
  });

  if (result.reason !== "completed" || !state.completion) {
    throw new Error(
      `Milestone stopped with ${result.reason} before validated completion.`,
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
