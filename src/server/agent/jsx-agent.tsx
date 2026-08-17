/** @jsxImportSource jsx-ai */
import { md, runAgent } from "jsx-ai";
import type {
  AgentContext,
  AgentEvent,
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
  ensureWorkspaceGameSource,
  readWorkspaceGameSource,
  writeWorkspaceFile,
} from "./workspace";
import {
  compileGameHtml,
  extractGameSource,
  validateGameSource,
} from "./game-artifact";

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

The user message contains the complete current game implementation, so do not spend a model turn inspecting files.
In this single model turn, call tools in this order:
1. public_status with a concrete 2-8 word public update.
2. write_file for game.tsx with the complete revised source.
3. complete_milestone.

Source contract:
- game.tsx must import render from "tradjs/client".
- Default-export function mount(). It renders the complete game into #game-root and returns a cleanup function that renders null.
- Keep the game self-contained in this one TSX source file; CrowdClaw bundles tradjs/client into the published standalone HTML.
- No external scripts, fonts, images, imports other than tradjs/client, CDNs, fetches, websockets, or network requests.
- No localStorage, sessionStorage, or IndexedDB.
- Fill the frame and keep the game responsive.
- Support keyboard and pointer input and show controls on screen.
- Include a real game loop, score or win/lose state, and restart without a reload.
- Preserve strong existing gameplay and materially implement the requested milestone.
- Keep game.tsx compact. Prefer simple mechanics and concise implementation over large abstractions; aim to stay under roughly 450 lines.

Tool calls are executed in order. complete_milestone compiles and validates game.tsx written earlier in the same response.
The public_status is intentionally public; it is not private chain-of-thought.`;

export const BUILD_BRIEF_SYS_SOURCE = `You are preparing a tiny public progress log for a browser-game build.

Publish exactly three short implementation notes through publish_build_brief.
Each note must be a concrete 2-7 word action a viewer can understand, such as "Shape the pickup loop" or "Tune delivery feedback".
These are public progress summaries, not private chain-of-thought. Do not write code in this turn.`;

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
  source: string;
  summary: string;
  nextMilestone: { title: string; goal: string; costCredits: number };
  usage: AgentUsage;
  activityText: string;
  result: AgentRunResult<CompletionState>;
};

type PlanningState = { plan?: GamePlan; validationError?: string };
type CompletionState = {
  validationError?: string;
  compiledHtml?: string;
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

const BUILD_BRIEF_SCHEMA: ToolParametersSchema = {
  type: "object",
  properties: {
    notes: {
      type: "array",
      description: "Three short public implementation notes",
      items: { type: "string" },
    },
  },
  required: ["notes"],
};

type BuildBriefState = { notes?: string[] };
type BuildBriefResult = { notes: string[]; usage: AgentUsage };

const BuildBriefTool = () => (
  <tool
    name="publish_build_brief"
    description="Publish three short public implementation notes before coding"
    schema={BUILD_BRIEF_SCHEMA}
  />
);

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
      description="Replace the complete game.tsx TradJS browser game"
    >
      <param name="path" type="string" required>
        Must be game.tsx
      </param>
      <param name="content" type="string" required>
        Complete file contents
      </param>
    </tool>
    <tool
      name="complete_milestone"
      description="Accept the milestone after game.tsx compiles into a standalone HTML artifact and passes host validation"
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

function BuildBriefPrompt({
  history,
}: {
  history: readonly ExtractedMessage[];
}) {
  return (
    <prompt
      model={MODEL()}
      strategy={STRATEGY}
      temperature={TEMPERATURE()}
      maxTokens={420}
    >
      <system>{md`${BUILD_BRIEF_SYS_SOURCE}`}</system>
      <BuildBriefTool />
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
      maxTokens={Math.min(agentMaxTokens(), 8_000)}
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

function mergeUsage(a: AgentUsage, b: AgentUsage): AgentUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    thinkingTokens: a.thinkingTokens + b.thinkingTokens,
    cacheCreationInputTokens:
      a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    lastContextTokens: Math.max(a.lastContextTokens, b.lastContextTokens),
    contextWindow: Math.max(a.contextWindow, b.contextWindow),
    estimated: a.estimated || b.estimated,
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

function normalizePublicNote(value: unknown): string {
  if (typeof value !== "string") return "";
  return compactWords(value, 7, 100);
}

async function buildPublicBrief(
  project: Project,
  milestone: Milestone,
): Promise<BuildBriefResult> {
  const state: BuildBriefState = {};
  const prompt = md`
    GAME: ${project.summary || project.idea}
    MILESTONE ${project.done + 1}: ${milestone.title}
    ${milestone.goal ? `GOAL: ${milestone.goal}` : ""}
  `;

  try {
    const result = await measure(
      {
        start: () => "Public build brief",
        end: summarizeAgentRun,
        projectId: project.id,
        milestone: project.done + 1,
      },
      () =>
        runAgent({
          state,
          history: [{ role: "user", content: prompt }],
          buildPrompt: (history) => <BuildBriefPrompt history={history} />,
          executeTool: async (call, context) => {
            if (call.name !== "publish_build_brief")
              return toolResult(call, `Unknown brief tool: ${call.name}`, true);
            const raw = Array.isArray(call.args.notes) ? call.args.notes : [];
            const notes = raw
              .map(normalizePublicNote)
              .filter(Boolean)
              .slice(0, 3);
            if (!notes.length)
              return toolResult(call, "No usable public notes", true);
            context.state.notes = notes;
            return toolResult(call, `Published ${notes.length} public notes.`);
          },
          callOptions: {
            model: MODEL(),
            strategy: STRATEGY,
            ...(jsxAiRuntime() ? { runtime: jsxAiRuntime() } : {}),
            retries: 0,
            timeoutMs: Math.min(buildRequestTimeoutMs(), 35_000),
          },
          maxSteps: 1,
          maxToolCalls: 1,
          isComplete: (_response, _toolResults, context) =>
            Boolean(context.state.notes?.length),
        }),
    );
    return {
      notes: result.reason === "completed" ? state.notes || [] : [],
      usage: usageFromAgent(result.usage),
    };
  } catch {
    // A progress brief is optional observability. Never fail a funded build because
    // the tiny public-status request was unavailable.
    return { notes: [], usage: blankUsage() };
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

async function executeWorkspaceTool(
  projectId: string,
  call: CanonicalToolCall,
  context: AgentContext<CompletionState>,
): Promise<{ message: ExtractedMessage; note: string }> {
  try {
    switch (call.name) {
      case "public_status": {
        const text = publicStatus(call.args.text);
        return { message: toolResult(call, "Published."), note: text };
      }
      case "write_file": {
        const path = asString(call.args.path, "path");
        if (path.replaceAll("\\", "/") !== "game.tsx")
          throw new Error("write_file only accepts game.tsx");
        const content = asString(call.args.content, "content");
        const issues = validateGameSource(content);
        if (issues.length) throw new Error(issues.join("; "));
        writeWorkspaceFile(projectId, "game.tsx", content);
        return {
          message: toolResult(
            call,
            `Wrote game.tsx (${content.length} chars).`,
          ),
          note: "WRITE game.tsx",
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
        const source = readWorkspaceGameSource(projectId);
        const html = await compileGameHtml(source);
        const issues = validateArtifactHtml(html);
        if (issues.length) {
          context.state.validationError = issues.join("; ");
          return {
            message: toolResult(
              call,
              `Completion rejected: ${issues.join("; ")}`,
              true,
            ),
            note: "FIX game.tsx",
          };
        }
        context.state.validationError = undefined;
        context.state.compiledHtml = html;
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

function publicRuntimeProgress(value: unknown): string {
  if (typeof value !== "string") return "";
  const message = value.replace(/\s+/g, " ").trim();
  if (!message || /^(?:thinking|codex turn started)$/i.test(message)) return "";
  return message.slice(0, 160);
}

function effectiveBuildTimeoutMs(project: Project): number {
  // A full game.tsx arrives as one buffered Codex tool-call payload. 150s was
  // repeatedly expiring just before useful model_end output arrived. Give the
  // first attempt a little more room, then grow the window on actual retries
  // instead of retrying forever with the exact same doomed timeout.
  const base = Math.max(180_000, buildRequestTimeoutMs());
  const retryBoost = Math.min(
    180_000,
    Math.max(0, project.failureCount) * 60_000,
  );
  return Math.min(
    base + retryBoost,
    Math.max(180_000, agentMaxDurationMs() - 15_000),
  );
}

export async function planGame(
  idea: string,
  onNote?: (note: string) => void,
): Promise<PlanResult> {
  const state: PlanningState = {};
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
        onEvent: (event: AgentEvent<PlanningState>) => {
          if (event.type === "model_start") {
            onNote?.("Model running");
            return;
          }
          if (event.type === "runtime_progress") {
            const message = publicRuntimeProgress(event.progress.message);
            if (message) onNote?.(message);
            return;
          }
          if (event.type === "model_end") onNote?.("Finalizing plan");
        },
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
  const previousSource = extractGameSource(previousHtml || "");
  ensureWorkspaceGameSource(project.id, previousSource);
  let currentSource = previousSource;
  try {
    currentSource = readWorkspaceGameSource(project.id);
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

    CURRENT IMPLEMENTATION:
    ${currentSource ? `\`\`\`tsx\n${currentSource}\n\`\`\`` : previousHtml ? `Legacy standalone HTML follows. Preserve its strongest gameplay while rewriting it as the required TradJS game.tsx:\n\`\`\`html\n${previousHtml.slice(0, 180000)}\n\`\`\`` : "No previous implementation; create v1 from scratch."}

    Produce the complete revised game.tsx now. Use one public_status, then write_file, then complete_milestone in this same response.
  `;

  const state: CompletionState = {};
  let activityText = "";
  let liveUsage = blankUsage();
  let lastProgressNote = "";

  const pushActivity = (note: string) => {
    const clean = note.replace(/\s+/g, " ").trim().slice(0, 160);
    if (!clean || clean === lastProgressNote) return;
    lastProgressNote = clean;
    activityText += `${clean}\n`;
    onActivity({
      text: activityText.slice(-1800),
      note: clean,
      usage: liveUsage,
    });
  };

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
              end: (
                value: Awaited<ReturnType<typeof executeWorkspaceTool>>,
              ) => ({
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
        onEvent: (event: AgentEvent<CompletionState>) => {
          if (event.type === "model_start") {
            pushActivity("Codex generating build");
            return;
          }
          if (event.type === "runtime_progress") {
            const message = publicRuntimeProgress(event.progress.message);
            if (message) pushActivity(message);
            return;
          }
          if (event.type === "model_end") {
            pushActivity("Model response ready");
            return;
          }
          if (event.type === "tool_start") {
            if (event.call.name === "write_file")
              pushActivity("Writing game.tsx");
            else if (event.call.name === "complete_milestone")
              pushActivity("Validating build");
            return;
          }
          if (event.type === "tool_end" && event.result.isError)
            pushActivity(`${event.call.name} failed`);
        },
        callOptions: {
          model: MODEL(),
          strategy: STRATEGY,
          ...(jsxAiRuntime() ? { runtime: jsxAiRuntime() } : {}),
          retries: 0,
          timeoutMs: effectiveBuildTimeoutMs(project),
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
    html:
      state.compiledHtml ||
      (await compileGameHtml(readWorkspaceGameSource(project.id))),
    source: readWorkspaceGameSource(project.id),
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
