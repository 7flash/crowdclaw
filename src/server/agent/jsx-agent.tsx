/** @jsxImportSource jsx-ai */
import { callLLM, md, runAgent } from "jsx-ai";
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
import type {
  Milestone,
  MilestoneRendering,
  Project,
  Steering,
} from "../../shared/types";
import { log } from "../log";
import { validateArtifactHtml } from "./output";
import { validateGameRuntime } from "./runtime-validation";
import {
  ensureWorkspaceGameSource,
  readWorkspaceGameSource,
  writeWorkspaceFile,
} from "./workspace";
import {
  compileGameHtml,
  extractGameSource,
  normalizeGameSource,
  validateGameSource,
} from "./game-artifact";

const STRATEGY = "hybrid" as const;
const MODEL = () => modelName();
const TEMPERATURE = () => (/^gemini-3(?:\.|-|$)/i.test(MODEL()) ? 1.0 : 0.2);
const CODEX = () => jsxAiRuntime() === "codex";
const PLAN_MAX_STEPS = 1;
const PLAN_MAX_TOOL_CALLS = 1;

export const PLAN_SYS_SOURCE = `You are a game designer planning a tiny browser game that will be implemented by an autonomous coding agent.

Start with one short public sentence (maximum 12 words), then immediately call submit_game_plan. The sentence is streamed live and must describe only the chosen direction, not reasoning.

Produce exactly six concrete milestones with a short title and a useful player-facing description for each:
- Milestone 1 must create an immediately playable self-contained Canvas 2D game, not a scaffold. It must include controls, scoring or an objective, failure/win state, and a reliable restart.
- Milestones 2-3 should deepen the Canvas version with game feel, progression, content, or challenge.
- One milestone from 4-5 must explicitly migrate the established game from Canvas 2D to Three.js/WebGL while preserving the working game loop and controls.
- The remaining milestones should exploit the stronger foundation with meaningful mechanics, variety, progression, bosses, levels, or polish rather than cosmetic restyling.
- Keep milestones independently valuable so community votes can reorder future work.
- Costs are whole numbers from 1 to 4.

Submit the complete plan through submit_game_plan. Do not answer in a custom text format.`;

export const BUILD_SYS_SOURCE = `You generate exactly one complete browser-game source file.

Write the source as normal assistant text so jsx-ai can stream it through text_delta. Do NOT place source code inside tool arguments.

Your response format is strict:
1. Start immediately with the exact line <<<CROWDCLAW_GAME_TSX>>>
2. Emit the complete game.tsx source. No Markdown fences and no prose.
3. End the source with the exact line <<<CROWDCLAW_END_GAME_TSX>>>
4. Then call commit_game exactly once. commit_game has no source-code arguments; it only tells the host the streamed file is complete and ready to validate.

Hard contract:
- Import { render } from "tradjs/client". Import "three" only when the rendering contract requires Three.js.
- Default-export function mount(); mount once into #game-root and return cleanup.
- NEVER call mount() yourself at module scope, from DOMContentLoaded, or anywhere else. CrowdClaw imports and invokes mount().
- IMPORTANT: TradJS render() takes a TradJS JSX/h() vnode, NOT an HTMLElement. Correct: render(<div><canvas /></div>, root) or render(h("div", null, ...), root). NEVER do const shell=document.createElement(...); render(shell, root). If you build a shell with DOM APIs, attach it with root.replaceChildren(shell) instead.
- If mount() uses TradJS render(..., root), cleanup MUST unmount with render(null, root). Never clear a TradJS-managed root with root.replaceChildren().
- After mounting, query canvas/buttons from root (or from a directly attached shell), not from a detached node. mount() must synchronously leave at least one visible element inside #game-root.
- No network requests, external assets, browser storage, or other imports.
- Keyboard + pointer controls, visible controls, real game loop, objective/score, failure or win state, and restart.
- Include a visible Restart/Retry control. A normal local reset handler is fine; CrowdClaw also injects a host-level restart fallback.
- Canvas milestones use one mounted canvas and CanvasRenderingContext2D; never rerender the UI every frame.
- Three.js milestones use THREE.WebGLRenderer and clean up renderer/resources/listeners.
- Preserve working gameplay while implementing the requested milestone.

For the first Canvas version, favor a compact complete game: roughly 120-240 lines and 5,000-10,000 source characters. Avoid abstractions that do not improve play.

Do not spend a long turn planning before emitting the begin marker. Start writing the file immediately.`;

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
  event?: boolean;
  sequence?: number;
};

export type AgentStreamUpdate = {
  kind: "status" | "text";
  text: string;
  sequence?: number;
};

export type PlannedMilestone = {
  title: string;
  goal: string;
  costCredits: number;
  rendering: MilestoneRendering;
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
  usage: AgentUsage;
  activityText: string;
  result: AgentRunResult<CompletionState>;
};

type PlanningState = { plan?: GamePlan; validationError?: string };
type CompletionState = {
  validationError?: string;
  compiledHtml?: string;
  completion?: { summary: string };
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
      description: "Exactly six concrete implementation milestones",
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

const PlanningTools = () => (
  <tool
    name="submit_game_plan"
    description="Submit the complete six-milestone game plan"
    schema={PLAN_SCHEMA}
  />
);

const WorkspaceTools = () => (
  <tool
    name="commit_game"
    description="Commit the complete game.tsx source already emitted in assistant text"
  />
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
  if (CODEX()) {
    // Match jsx-ai's known-good Codex streaming shape: let Codex use its own
    // configured model instead of forcing GAME_MODEL through the prompt.
    return (
      <prompt strategy={STRATEGY}>
        <system>{md`${PLAN_SYS_SOURCE}`}</system>
        <PlanningTools />
        <Conversation history={history} />
      </prompt>
    );
  }
  return (
    <prompt
      model={MODEL()}
      strategy={STRATEGY}
      temperature={TEMPERATURE()}
      maxTokens={2600}
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
  if (CODEX()) {
    return (
      <prompt strategy={STRATEGY}>
        <system>{md`${BUILD_BRIEF_SYS_SOURCE}`}</system>
        <BuildBriefTool />
        <Conversation history={history} />
      </prompt>
    );
  }
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
  if (CODEX()) {
    return (
      <prompt strategy={STRATEGY}>
        <system>{md`${BUILD_SYS_SOURCE}`}</system>
        <WorkspaceTools />
        <Conversation history={history} />
      </prompt>
    );
  }
  return (
    <prompt
      model={MODEL()}
      strategy={STRATEGY}
      temperature={TEMPERATURE()}
      maxTokens={Math.min(agentMaxTokens(), 5_000)}
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
    title: "Canvas Playable Core",
    goal: "Ship a responsive Canvas 2D game with direct drawing, keyboard and pointer controls, scoring or objectives, failure, and a reliable restart.",
    costCredits: 2,
    rendering: "canvas",
  },
  {
    title: "Game Feel And Feedback",
    goal: "Improve the Canvas version with clearer feedback, pacing, juice, and readable moment-to-moment decisions.",
    costCredits: 2,
    rendering: "canvas",
  },
  {
    title: "Progression And Variety",
    goal: "Add meaningful progression, hazards, rewards, or run variety while keeping the Canvas game fast and coherent.",
    costCredits: 2,
    rendering: "canvas",
  },
  {
    title: "Three.js 3D Migration",
    goal: "Migrate the proven Canvas game loop to Three.js/WebGL, preserving controls, restart, scoring, and gameplay while introducing a clear 3D presentation.",
    costCredits: 3,
    rendering: "three_migration",
  },
  {
    title: "3D Mechanics And Depth",
    goal: "Use the Three.js foundation for mechanics or spatial decisions that were not possible or readable in the 2D version.",
    costCredits: 3,
    rendering: "three",
  },
  {
    title: "Challenge And Replayability",
    goal: "Add a strong late-game challenge, boss, level structure, modifiers, or replayable goals with polished feedback.",
    costCredits: 3,
    rendering: "three",
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
    index < rawMilestones.length && milestones.length < 6;
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
      rendering: fallback.rendering,
    });
  }

  if (!milestones.length)
    throw new Error("submit_game_plan returned no usable milestones");
  while (milestones.length < 6)
    milestones.push({ ...PLAN_FALLBACKS[milestones.length] });

  // The rendering arc is product policy, not optional model taste: v1 proves the
  // game in Canvas 2D, then one explicit migration milestone establishes Three.js.
  milestones[0] = {
    ...milestones[0],
    goal: compactWords(
      `Build the first playable version with Canvas 2D and a reliable host-backed restart. ${milestones[0].goal}`,
      60,
      360,
    ),
    rendering: "canvas",
  };
  for (let index = 0; index < 3; index += 1) {
    if (
      /three(?:\.js)?|webgl/i.test(
        `${milestones[index].title} ${milestones[index].goal}`,
      )
    )
      milestones[index] = { ...PLAN_FALLBACKS[index] };
  }
  let migrationIndex = milestones
    .slice(3, 5)
    .findIndex((item) =>
      /three(?:\.js)?|webgl/i.test(`${item.title} ${item.goal}`),
    );
  migrationIndex = migrationIndex < 0 ? 3 : migrationIndex + 3;
  if (
    !/three(?:\.js)?|webgl/i.test(
      `${milestones[migrationIndex].title} ${milestones[migrationIndex].goal}`,
    )
  )
    milestones[migrationIndex] = { ...PLAN_FALLBACKS[3] };
  milestones.forEach((item, index) => {
    item.rendering =
      index < migrationIndex
        ? "canvas"
        : index === migrationIndex
          ? "three_migration"
          : "three";
  });

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
    milestones: milestones.slice(0, 6),
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
          call: callLLM,
          callOptions: {
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

async function executeWorkspaceTool(
  projectId: string,
  call: CanonicalToolCall,
  context: AgentContext<CompletionState>,
  source: string,
  summary: string,
): Promise<{ message: ExtractedMessage; note: string }> {
  if (call.name !== "commit_game") {
    return {
      message: toolResult(call, `Unknown workspace tool: ${call.name}`, true),
      note: "",
    };
  }
  try {
    if (!source.trim())
      throw new Error("No complete streamed game.tsx source was received");
    const normalizedSource = normalizeGameSource(source);
    const sourceIssues = validateGameSource(normalizedSource);
    if (sourceIssues.length) throw new Error(sourceIssues.join("; "));
    const html = await compileGameHtml(normalizedSource);
    const artifactIssues = validateArtifactHtml(html);
    if (artifactIssues.length) throw new Error(artifactIssues.join("; "));
    await validateGameRuntime(html);
    writeWorkspaceFile(projectId, "game.tsx", normalizedSource);
    context.state.validationError = undefined;
    context.state.compiledHtml = html;
    context.state.completion = { summary };
    return {
      message: toolResult(
        call,
        `Published game.tsx (${normalizedSource.length} chars).`,
      ),
      note: "",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.state.validationError = message;
    return { message: toolResult(call, message, true), note: "" };
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
  if (
    !message ||
    /^(?:thinking|codex (?:turn|command) started|model step started|model response received)$/i.test(
      message,
    )
  )
    return "";
  if (
    /configured service tier .*not advertised as supported|service tier .*will be omitted/i.test(
      message,
    )
  )
    return "";
  return message.slice(0, 160);
}

function effectiveBuildTimeoutMs(project: Project): number {
  // A tiny game should begin its actual response quickly. Do not mask a broken
  // Codex turn behind the old 12-minute ceiling. Honor smaller local settings,
  // cap the first attempt at 3 minutes, and give only one extra minute on retries.
  const configured = Math.max(60_000, buildRequestTimeoutMs());
  const firstAttempt = Math.min(3 * 60_000, configured);
  const retryBoost = project.failureCount > 0 ? 60_000 : 0;
  return Math.min(4 * 60_000, firstAttempt + retryBoost);
}

function effectiveBuildMaxDurationMs(project: Project): number {
  return Math.max(
    agentMaxDurationMs(),
    effectiveBuildTimeoutMs(project) + 30_000,
  );
}

export async function planGame(
  idea: string,
  onUpdate?: (update: AgentStreamUpdate) => void,
): Promise<PlanResult> {
  const state: PlanningState = {};
  let assistantText = "";
  let lastTextEmit = 0;
  let streamSequence = 0;
  const emitUpdate = (update: Omit<AgentStreamUpdate, "sequence">) =>
    onUpdate?.({ ...update, sequence: ++streamSequence });
  const emitAssistantText = (force = false) => {
    const clean = assistantText.replace(/\s+/g, " ").trim().slice(0, 420);
    if (!clean) return;
    if (!force && clean.length - lastTextEmit < 24 && !/[.!?]$/.test(clean))
      return;
    lastTextEmit = clean.length;
    emitUpdate({ kind: "text", text: clean });
  };
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
        // Use the same callLLM path as jsx-ai's standalone streaming example.
        call: callLLM,
        callOptions: {
          // JSX_AI_RUNTIME selects Codex. When Codex is active the prompt itself
          // intentionally leaves model selection to the user's Codex config.
          retries: 0,
          timeoutMs: Math.min(agentRequestTimeoutMs(), 45_000),
        },
        maxSteps: PLAN_MAX_STEPS,
        maxToolCalls: PLAN_MAX_TOOL_CALLS,
        isComplete: (_response, _toolResults, context) =>
          Boolean(context.state.plan),
        // jsx-ai now exposes one ordered UI stream. text_delta and tool_progress
        // arrive chronologically with lifecycle/tool execution events, so the app
        // cannot accidentally render tool execution ahead of earlier model text.
        onEvent: (event: any) => {
          if (event.type === "text_delta") {
            assistantText += String(event.delta || "");
            emitAssistantText();
            return;
          }
          if (event.type === "tool_progress") return;
          if (event.type === "model_start") return;
          if (event.type === "runtime_progress") {
            const message = publicRuntimeProgress(event.progress?.message);
            if (message) emitUpdate({ kind: "status", text: message });
            return;
          }
          if (event.type === "model_end") emitAssistantText(true);
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
  emitAssistantText(true);
  emitUpdate({ kind: "status", text: state.plan.note });
  return { plan: state.plan, usage: usageFromAgent(result.usage), result };
}

function validateMilestoneRendering(
  source: string,
  milestoneIndex: number,
  milestone: Milestone,
  previousUsesThree: boolean,
): string[] {
  const issues: string[] = [];
  const rendering =
    milestone.rendering ||
    (/three(?:\.js)?|webgl/i.test(`${milestone.title} ${milestone.goal || ""}`)
      ? "three_migration"
      : "canvas");
  const usesThree = /from\s+["']three["']/.test(source);
  const usesCanvas2d = /getContext\s*\(\s*["']2d["']/.test(source);
  const renderCalls = (source.match(/\brender\s*\(/g) || []).length;

  if (milestoneIndex === 0) {
    if (!usesCanvas2d)
      issues.push("v1 must draw through CanvasRenderingContext2D");
    if (usesThree) issues.push("v1 must not import Three.js");
    if (renderCalls > 2)
      issues.push(
        "v1 must mount the DOM/canvas once; do not call render() from the animation loop",
      );
  } else if (rendering === "three_migration" || rendering === "three") {
    if (!usesThree) issues.push("this roadmap phase requires Three.js");
    if (!/WebGLRenderer/.test(source))
      issues.push("Three.js revisions must use WebGLRenderer");
  } else if (previousUsesThree && !usesThree) {
    issues.push(
      "do not regress a migrated Three.js game back to DOM/Canvas rendering",
    );
  } else if (!previousUsesThree && !usesCanvas2d) {
    issues.push("pre-migration revisions must keep CanvasRenderingContext2D");
  }

  if (!/requestAnimationFrame/.test(source))
    issues.push("game must have a real animation loop");
  return issues;
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

  const previousUsesThree =
    /from\s+["']three["']|THREE\.WebGLRenderer|new\s+WebGLRenderer/i.test(
      currentSource,
    );
  const milestoneRendering =
    milestone.rendering ||
    (/three(?:\.js)?|webgl/i.test(`${milestone.title} ${milestone.goal || ""}`)
      ? "three_migration"
      : "canvas");
  const renderingContract =
    project.done === 0
      ? "RENDERING CONTRACT: This is v1. Use one HTML canvas with CanvasRenderingContext2D. Mount the shell once. If using TradJS render(), pass JSX/h() directly — never an HTMLElement. If using document.createElement(), attach it with root.replaceChildren(shell). Draw imperatively every animation frame, and do not import Three.js yet. Include a visible Restart/Retry control; a normal local reset handler is acceptable because CrowdClaw injects a host-level restart fallback."
      : milestoneRendering === "three_migration" ||
          (milestoneRendering === "three" && !previousUsesThree)
        ? "RENDERING CONTRACT: This roadmap phase requires the deliberate Three.js migration now. Import three, use THREE.WebGLRenderer, preserve the proven controls/game loop, and keep a visible Restart/Retry control working."
        : previousUsesThree
          ? "RENDERING CONTRACT: The game has already migrated to Three.js. Preserve the Three.js/WebGL renderer and build on it. Keep restart working."
          : "RENDERING CONTRACT: Keep this revision on Canvas 2D. Mount the shell once; TradJS render() must receive JSX/h(), never an HTMLElement. Direct DOM shells must use root.replaceChildren(shell). Draw with CanvasRenderingContext2D; do not migrate to Three.js until the roadmap reaches the migration phase. Keep a visible Restart/Retry control working.";

  const previousFeedback =
    project.error && !/^(?:quota|busy)$/i.test(project.error.trim())
      ? `PREVIOUS ATTEMPT FEEDBACK: ${project.error.slice(0, 500)}`
      : "";

  const goal = md`
    GAME: ${project.summary || project.idea}
    MILESTONE ${project.done + 1}: ${milestone.title}
    ${milestone.goal ? `GOAL: ${milestone.goal}` : ""}
    ${renderingContract}
    ${previousFeedback}

    ${
      steering.length
        ? `SUPPORTER STEERING:\n${steering.map((item) => `- ${item.influence.toFixed(2)} influence: ${item.instruction}`).join("\n")}`
        : ""
    }

    CURRENT IMPLEMENTATION:
    ${currentSource ? `\`\`\`tsx\n${currentSource}\n\`\`\`` : previousHtml ? `Legacy standalone HTML follows. Preserve its strongest gameplay while rewriting it as the required TradJS game.tsx:\n\`\`\`html\n${previousHtml.slice(0, 180000)}\n\`\`\`` : "No previous implementation; create v1 from scratch."}

    Emit the complete game.tsx between the required markers, then call commit_game once.
  `;

  const state: CompletionState = {};
  let liveUsage = blankUsage();
  let sourceProgress = "";
  let publicText = "";
  let streamedAssistantText = "";
  let streamSequence = 0;
  let nextLoggedContentChars = 2_000;
  const buildStreamStartedAt = Date.now();
  let firstUsefulEventLogged = false;
  const logFirstUsefulEvent = (type: string) => {
    if (firstUsefulEventLogged) return;
    firstUsefulEventLogged = true;
    log("info", "agent.stream.first_useful_event", {
      projectId: project.id,
      type,
      elapsedMs: Date.now() - buildStreamStartedAt,
    });
  };

  const composeActivity = () =>
    [
      publicText ? `A|${publicText}` : "",
      sourceProgress ? `G|${sourceProgress}` : "",
    ]
      .filter(Boolean)
      .join("\n");

  const publishActivity = (note = "", event = false) => {
    onActivity({
      text: composeActivity(),
      note,
      usage: liveUsage,
      event,
      sequence: streamSequence,
    });
  };

  const BEGIN_SOURCE = "<<<CROWDCLAW_GAME_TSX>>>";
  const END_SOURCE = "<<<CROWDCLAW_END_GAME_TSX>>>";

  const streamedSource = (requireComplete = false): string => {
    const text = streamedAssistantText;

    const begin = text.indexOf(BEGIN_SOURCE);
    if (begin >= 0) {
      let body = text
        .slice(begin + BEGIN_SOURCE.length)
        .replace(/^\s*\r?\n?/, "");
      const end = body.indexOf(END_SOURCE);
      if (end < 0) return requireComplete ? "" : body;
      return body.slice(0, end).replace(/\s+$/, "");
    }

    // Be tolerant if the model uses a normal TSX fence despite the strict format.
    const fence = text.match(/```(?:tsx|typescript|ts)\s*\r?\n?/i);
    if (fence?.index != null) {
      const body = text.slice(fence.index + fence[0].length);
      const close = body.indexOf("```");
      if (close < 0) return requireComplete ? "" : body;
      return body.slice(0, close).replace(/\s+$/, "");
    }

    // Last-resort raw-source mode: assistant text may begin directly with game.tsx.
    // Tool calls are out-of-band, so slicing from the first import is safe.
    const raw = text.search(/(?:^|\n)\s*import\s+[^\n]*["']tradjs\/client["']/);
    if (raw >= 0) {
      const body = text.slice(raw).replace(/^\s+/, "");
      return requireComplete ? body.replace(/\s+$/, "") : body;
    }

    return "";
  };

  const publishSourceProgress = (forceLog = false) => {
    const source = streamedSource(false);
    if (!source) return;
    const chars = source.length;
    const lines = source.split(/\r?\n/).length;
    sourceProgress = `game.tsx · ${lines.toLocaleString("en-US")} lines · ${chars.toLocaleString("en-US")} chars`;
    if (forceLog || chars >= nextLoggedContentChars) {
      log("info", "agent.stream.text_source", {
        projectId: project.id,
        chars,
        lines,
        sequence: streamSequence,
      });
      nextLoggedContentChars = Math.floor(chars / 2_000 + 1) * 2_000;
    }
    publishActivity("", false);
  };

  const appendAssistantDelta = (delta: unknown) => {
    const text = String(delta || "");
    if (!text) return;
    streamedAssistantText += text;
    if (streamedSource(false)) {
      logFirstUsefulEvent("text_delta.game_source");
      publicText = "";
      publishSourceProgress(false);
      return;
    }
    // Keep the pre-source stage silent unless the runtime itself has a useful
    // public status. Normal assistant prose is not needed on the build screen.
  };

  publishActivity("", false);

  const result = await measure(
    {
      start: () => "jsx-ai single-turn build agent",
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
          const completeSource = streamedSource(true);
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
              sourceChars: completeSource.length,
            },
            () =>
              executeWorkspaceTool(
                project.id,
                call,
                context,
                completeSource,
                milestone.title,
              ),
          );
          publishActivity("", false);
          return executed.message;
        },
        onEvent: (event: any) => {
          streamSequence += 1;
          if (event.type === "text_delta") {
            appendAssistantDelta(event.delta);
            return;
          }
          if (event.type === "runtime_progress") {
            const message = publicRuntimeProgress(event.progress?.message);
            if (message && !streamedAssistantText.includes(BEGIN_SOURCE)) {
              publicText = message;
              publishActivity("", false);
            }
            return;
          }
          if (event.type === "tool_progress") {
            const progress = event.progress;
            if (progress?.type === "tool_detected") {
              logFirstUsefulEvent(`tool_progress.${String(progress.type)}`);
              log("info", "agent.stream.tool_detected", {
                projectId: project.id,
                tool: String(progress.name || ""),
                sequence: streamSequence,
              });
            }
            if (progress?.type === "tool_ready") {
              log("info", "agent.stream.tool_ready", {
                projectId: project.id,
                tool: String(progress.call?.name || ""),
                sourceChars: streamedSource(false).length,
                sequence: streamSequence,
              });
            }
            return;
          }
          if (event.type === "model_end") {
            const fullText = String(event.response?.text || "");
            if (fullText && fullText.length > streamedAssistantText.length) {
              streamedAssistantText = fullText;
            }
            publishSourceProgress(true);
          }
        },
        // Match jsx-ai's documented streaming example exactly: runAgent receives
        // callLLM as its model call while onEvent remains the single ordered UI stream.
        call: callLLM,
        callOptions: {
          // JSX_AI_RUNTIME selects Codex exactly like the standalone jsx-ai demo.
          // Do not override Codex's configured model here.
          retries: 0,
          timeoutMs: effectiveBuildTimeoutMs(project),
        },
        // One model request per build attempt. Giving the complete current HTML in
        // the prompt removes the list/read -> second-model-turn stall seen on Codex.
        maxSteps: 1,
        maxToolCalls: 1,
        maxDurationMs: effectiveBuildMaxDurationMs(project),
        isComplete: (_response, _toolResults, context) =>
          Boolean(context.state.completion),
      }),
  );

  liveUsage = usageFromAgent(result.usage);
  publishActivity("", false);

  if (result.reason !== "completed" || !state.completion) {
    const validation = state.validationError
      ? ` Host validation: ${state.validationError}`
      : "";
    throw new Error(
      `Milestone attempt ended before validated completion.${validation}`,
    );
  }

  const completedSource = readWorkspaceGameSource(project.id);
  const renderingIssues = validateMilestoneRendering(
    completedSource,
    project.done,
    milestone,
    previousUsesThree,
  );
  if (renderingIssues.length) {
    // Do not leave a rejected live workspace visible between retries. Restore the
    // last accepted source so the preview remains functional while the agent retries.
    writeWorkspaceFile(project.id, "game.tsx", currentSource);
    throw new Error(
      `Rendering contract rejected: ${renderingIssues.join("; ")}`,
    );
  }

  return {
    html:
      state.compiledHtml ||
      (await compileGameHtml(readWorkspaceGameSource(project.id))),
    source: completedSource,
    summary: state.completion.summary,
    usage: liveUsage,
    activityText: composeActivity(),
    result,
  };
}
