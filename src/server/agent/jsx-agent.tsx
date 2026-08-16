/** @jsxImportSource jsx-ai */
import { callLLM, md, render, streamLLM } from "jsx-ai";
import type { ExtractedMessage, ToolCall } from "jsx-ai";
import {
  agentMaxSteps,
  agentMaxTokens,
  agentRequestTimeoutMs,
  contextWindow,
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

export const PLAN_SYS_SOURCE = `You plan tiny browser games that get built one milestone at a time, funded by a crowd.

Given a game idea, respond ONLY in this line format, nothing else:
N|kebab-case-name
S|one plain sentence describing the game
M|first milestone|2
M|second milestone|2
M|third milestone|3

Rules:
- Exactly three M lines.
- Titles are 3-7 words, plain, concrete, no numbering, no colons.
- The first milestone must produce something immediately playable — a real loop, not a scaffold.
- Cost is a whole number from 1 to 4.`;

export const BUILD_SYS_SOURCE = `You are an autonomous browser-game engineer working in a real project directory for CrowdClaw.
Use the file tools to inspect and modify the project. Prefer a small coherent codebase.
CrowdClaw publishes index.html as the playable immutable artifact, so index.html MUST be a complete self-contained HTML document and MUST NOT depend on other local files to run.
You may keep small supporting project files for your own organization, but the playable game must work from index.html alone.

The playable artifact rules:
- Plain HTML/CSS/JavaScript. No build step.
- No external scripts, fonts, images, imports, CDNs, fetches, websockets, or other network requests.
- No localStorage, sessionStorage, or IndexedDB.
- Fill its frame: html,body{margin:0;height:100%;overflow:hidden} and size the canvas or renderer to the window.
- Dark background, high contrast, clean shapes.
- Keyboard AND pointer input, with controls shown on screen.
- A real game loop with score or win/lose and restart without reloading.
- Keep the implementation compact, coherent, and reliable.
- When modifying existing work, read relevant files first unless the full current source is already in context.
- Do not claim the milestone is complete until the requested gameplay is implemented coherently.
- Finish by calling phase_done with a concise summary plus exactly one concrete rolling milestone that should come next.`;

export type AgentUsage = {
  inputTokens: number;
  outputTokens: number;
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

export type BuildPhaseResult = {
  html: string;
  summary: string;
  nextMilestone: { title: string; costCredits: number };
  usage: AgentUsage;
  activityText: string;
};

const WriteFileTool = () => (
  <tool
    name="write_file"
    description="Write or replace a UTF-8 file inside the current game project"
  >
    <param name="path" type="string" required>
      Project-relative path such as index.html
    </param>
    <param name="content" type="string" required>
      Complete file contents
    </param>
  </tool>
);

const ReadFileTool = () => (
  <tool
    name="read_file"
    description="Read a UTF-8 file from the current game project"
  >
    <param name="path" type="string" required>
      Project-relative path
    </param>
  </tool>
);

const ListFilesTool = () => (
  <tool
    name="list_files"
    description="List all files currently present in the game project"
  />
);

const PhaseDoneTool = () => (
  <tool
    name="phase_done"
    description="Finish the current milestone only when its gameplay goal is implemented coherently and index.html is runnable"
  >
    <param name="summary" type="string" required>
      Short first-person description of what was completed
    </param>
    <param name="next_milestone" type="string" required>
      One concrete 3-7 word gameplay milestone the player will feel next
    </param>
    <param name="next_cost" type="number" required>
      Whole-number CrowdClaw cost from 1 to 4
    </param>
  </tool>
);

function blankUsage(): AgentUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    lastContextTokens: 0,
    contextWindow: contextWindow(),
    estimated: false,
  };
}

function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return Math.max(0, Math.ceil(text.length / 4));
}

function numberFrom(raw: any, keys: string[]): number {
  for (const key of keys) {
    const value = raw?.[key];
    if (Number.isFinite(value)) return Math.max(0, Math.floor(Number(value)));
  }
  return 0;
}

function usageFromResult(result: any, promptTree: unknown): AgentUsage {
  // jsx-ai normalizes provider usage to inputTokens/outputTokens. Keep the
  // compatibility aliases below so older adapters do not break persisted usage.
  const raw =
    result?.usage || result?.response?.usage || result?.metadata?.usage || {};
  const inputTokens = numberFrom(raw, [
    "inputTokens",
    "input_tokens",
    "promptTokens",
    "prompt_tokens",
  ]);
  const outputTokens = numberFrom(raw, [
    "outputTokens",
    "output_tokens",
    "completionTokens",
    "completion_tokens",
  ]);
  const cacheCreationInputTokens = numberFrom(raw, [
    "cacheCreationInputTokens",
    "cache_creation_input_tokens",
  ]);
  const cacheReadInputTokens = numberFrom(raw, [
    "cacheReadInputTokens",
    "cache_read_input_tokens",
    "cachedTokens",
    "cached_tokens",
  ]);
  const hasProviderUsage = inputTokens > 0 || outputTokens > 0;

  let estimatedInput = 0;
  try {
    estimatedInput = estimateTokens(render(promptTree as any));
  } catch {
    estimatedInput = estimateTokens(promptTree);
  }
  const estimatedOutput = estimateTokens({
    text: result?.text || "",
    toolCalls: result?.toolCalls || [],
  });
  const input = hasProviderUsage ? inputTokens : estimatedInput;
  const output = hasProviderUsage ? outputTokens : estimatedOutput;

  return {
    inputTokens: input,
    outputTokens: output,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    // Provider input usage already represents the prompt/context sent for this
    // request. Cache counters are supplemental metadata and must not be added
    // again or the context meter can double-count cached input.
    lastContextTokens: input + output,
    contextWindow: contextWindow(),
    estimated: !hasProviderUsage,
  };
}

function addUsage(total: AgentUsage, call: AgentUsage): AgentUsage {
  return {
    inputTokens: total.inputTokens + call.inputTokens,
    outputTokens: total.outputTokens + call.outputTokens,
    cacheCreationInputTokens:
      total.cacheCreationInputTokens + call.cacheCreationInputTokens,
    cacheReadInputTokens:
      total.cacheReadInputTokens + call.cacheReadInputTokens,
    lastContextTokens: call.lastContextTokens,
    contextWindow: call.contextWindow,
    estimated: total.estimated || call.estimated,
  };
}

function toolResult(
  call: ToolCall,
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

function executeTool(
  projectId: string,
  call: ToolCall,
): {
  message: ExtractedMessage;
  note: string;
  done?: { summary: string; title: string; cost: number };
} {
  try {
    switch (call.name) {
      case "write_file": {
        const path = String(call.args.path || "");
        const content = String(call.args.content || "");
        writeWorkspaceFile(projectId, path, content);
        return {
          message: toolResult(call, `Wrote ${path} (${content.length} chars).`),
          note: `WRITE ${path}`,
        };
      }
      case "read_file": {
        const path = String(call.args.path || "");
        const content = readWorkspaceFile(projectId, path);
        return { message: toolResult(call, content), note: `READ ${path}` };
      }
      case "list_files": {
        const files = listWorkspaceFiles(projectId);
        return {
          message: toolResult(call, JSON.stringify(files, null, 2)),
          note: "FILES",
        };
      }
      case "phase_done": {
        const summary = String(call.args.summary || "")
          .trim()
          .slice(0, 220);
        const title = String(call.args.next_milestone || "")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 100);
        const cost = Number(call.args.next_cost);
        const words = title ? title.split(" ").filter(Boolean).length : 0;
        if (!summary)
          return {
            message: toolResult(call, "phase_done requires a summary", true),
            note: "FIX SUMMARY",
          };
        if (words < 3 || words > 7)
          return {
            message: toolResult(call, "next_milestone must be 3-7 words", true),
            note: "FIX NEXT",
          };
        if (!Number.isInteger(cost) || cost < 1 || cost > 4)
          return {
            message: toolResult(
              call,
              "next_cost must be a whole number from 1 to 4",
              true,
            ),
            note: "FIX COST",
          };
        return {
          message: toolResult(call, `Completion requested: ${summary}`),
          note: "DONE",
          done: { summary, title, cost },
        };
      }
      default:
        return {
          message: toolResult(call, `Unknown tool: ${call.name}`, true),
          note: `TOOL ${call.name}`,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      message: toolResult(call, message, true),
      note: `ERROR ${call.name}`,
    };
  }
}

function planPromptTree(idea: string) {
  return (
    <prompt
      model={modelName()}
      strategy="hybrid"
      temperature={0.2}
      maxTokens={1200}
    >
      <system>{PLAN_SYS_SOURCE}</system>
      <message role="user">{idea}</message>
    </prompt>
  );
}

function buildPromptTree(history: ExtractedMessage[]) {
  return (
    <prompt
      model={modelName()}
      strategy="hybrid"
      temperature={0.2}
      maxTokens={agentMaxTokens()}
    >
      <system>{md`${BUILD_SYS_SOURCE}`}</system>
      <WriteFileTool />
      <ReadFileTool />
      <ListFilesTool />
      <PhaseDoneTool />
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
    </prompt>
  );
}

export async function planGame(
  idea: string,
  onText?: (text: string, usage: AgentUsage) => void,
): Promise<{ text: string; usage: AgentUsage }> {
  const tree = planPromptTree(idea);
  let text = "";
  for await (const chunk of streamLLM(
    modelName(),
    [
      { role: "system", content: PLAN_SYS_SOURCE },
      { role: "user", content: idea },
    ],
    { temperature: 0.2, maxTokens: 1200 },
  )) {
    text += chunk;
    const usage = usageFromResult({ text, toolCalls: [] }, tree);
    onText?.(text, usage);
  }
  return { text, usage: usageFromResult({ text, toolCalls: [] }, tree) };
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
    PROJECT: ${project.idea}
    CURRENT MILESTONE ${project.done + 1}: ${milestone.title}

    Implement this milestone in the existing project directory. ${files.length ? `Current files: ${files.join(", ")}. Inspect relevant files before editing.` : "The workspace is empty; build the first playable version now."}
    Preserve the strongest existing mechanics. Do not merely restyle the game.
    Leave a complete self-contained index.html that passes the CrowdClaw artifact rules.
    ${steering.length ? `SUPPORTER STEERING:\n${steering.map((item) => `- ${item.influence.toFixed(2)} influence: ${item.instruction}`).join("\n")}\nUse influence as weight. Apply compatible requests to this implementation and let stronger requests shape the rolling milestone you propose.` : ""}
    When the milestone is genuinely playable, call phase_done and propose exactly one rolling next milestone with cost 1-4.
  `;

  const history: ExtractedMessage[] = [{ role: "user", content: goal }];
  let total = blankUsage();
  let activityText = "";

  for (let step = 0; step < agentMaxSteps(); step += 1) {
    const tree = buildPromptTree(history);
    const result = await callLLM(tree, {
      model: modelName(),
      strategy: "hybrid",
      retries: 3,
      timeoutMs: agentRequestTimeoutMs(),
    });

    const callUsage = usageFromResult(result, tree);
    total = addUsage(total, callUsage);
    const assistantText = result.text || "";
    const toolCalls = result.toolCalls || [];
    history.push({ role: "assistant", content: assistantText, toolCalls });

    if (!toolCalls.length) {
      const reminder =
        "Continue by using the available file tools. Call phase_done only after index.html is playable and the milestone is implemented.";
      history.push({ role: "user", content: reminder });
      onActivity({
        text: activityText.slice(-1800),
        note: "THINK",
        usage: total,
      });
      continue;
    }

    let completed: { summary: string; title: string; cost: number } | null =
      null;
    for (const call of toolCalls) {
      const executed = executeTool(project.id, call);
      history.push(executed.message);
      activityText += `${executed.note}\n`;
      if (executed.done) completed = executed.done;
      onActivity({
        text: activityText.slice(-1800),
        note: executed.note,
        usage: total,
      });
    }

    if (completed) {
      let html = "";
      try {
        html = readWorkspaceIndex(project.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        history.push({
          role: "user",
          content: `phase_done was rejected because ${message}. Create/fix index.html and call phase_done again.`,
        });
        onActivity({
          text: activityText.slice(-1800),
          note: "FIX index.html",
          usage: total,
        });
        continue;
      }
      const issues = validateArtifactHtml(html);
      if (issues.length) {
        history.push({
          role: "user",
          content: `phase_done was rejected by CrowdClaw validation: ${issues.join("; ")}. Fix index.html with the file tools and call phase_done again.`,
        });
        onActivity({
          text: activityText.slice(-1800),
          note: "FIX index.html",
          usage: total,
        });
        continue;
      }
      return {
        html,
        summary: completed.summary,
        nextMilestone: { title: completed.title, costCredits: completed.cost },
        usage: total,
        activityText,
      };
    }
  }

  throw new Error(
    `Milestone exceeded ${agentMaxSteps()} model/tool iterations`,
  );
}
