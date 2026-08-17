#!/usr/bin/env bun
// @jsxImportSource jsx-ai
/**
 * Streaming levels in jsx-ai.
 *
 * This example demonstrates the event stream exposed by runAgent({ onEvent }).
 * It works with either JSX_AI_RUNTIME=api or JSX_AI_RUNTIME=codex.
 *
 * With Codex, a model step may additionally emit runtime_progress events while
 * the native Codex turn is still running. These are item/status events, NOT
 * token chunks and NOT partial tool-call JSON.
 *
 * For user-visible text-delta streaming under either API or Codex runtime,
 * use streamLLM() instead. See examples/text-stream.ts and README.
 */

import { callLLM, md, runAgent } from "../src/index";
import type {
  AgentEvent,
  AgentRunResult,
  AgentToolResult,
  CanonicalToolCall,
  ExtractedMessage,
  LLMResponse,
} from "../src/index";
import {
  measure,
  summarizeResponse,
  summarizeToolCall,
  truncate,
  type MeasureFn,
} from "./_example-observability";

interface DemoState {
  contextRead: boolean;
  completed?: string;
}

const DemoTools = () => (
  <>
    <tool
      name="get_context"
      description="Read the small application-owned context needed for the task"
    />
    <tool
      name="finish"
      description="Finish after get_context has been used and the answer is ready"
    >
      <param name="summary" type="string" required>
        One concise final recommendation
      </param>
    </tool>
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

function DemoPrompt({ history }: { history: readonly ExtractedMessage[] }) {
  return (
    <prompt strategy="hybrid">
      <system>{md`
        You are demonstrating jsx-ai event streaming.

        First call get_context. After seeing its result, call finish with one
        concise recommendation. Do not skip get_context.
      `}</system>
      <DemoTools />
      <Conversation history={history} />
    </prompt>
  );
}

function executeTool(
  call: CanonicalToolCall,
  state: DemoState,
): AgentToolResult {
  if (call.name === "get_context") {
    state.contextRead = true;
    return {
      content: JSON.stringify({
        product: "jsx-ai",
        goal: "Make runtime progress visible without leaking provider SDK event types",
        constraint:
          "Core stays silent; applications decide how to render events",
      }),
    };
  }

  if (call.name === "finish") {
    if (!state.contextRead) {
      return {
        content: "finish rejected: call get_context first",
        isError: true,
      };
    }
    const summary = String(call.args.summary ?? "").trim();
    if (!summary) return { content: "finish requires summary", isError: true };
    state.completed = summary;
    return { content: `Accepted: ${summary}` };
  }

  return { content: `Unknown tool: ${call.name}`, isError: true };
}

function eventSummary(event: AgentEvent<DemoState>): string {
  switch (event.type) {
    case "model_start":
      return `MODEL START  step=${event.context.step + 1}`;

    case "runtime_progress": {
      const progress = event.progress;
      const item = progress.itemType ? ` item=${progress.itemType}` : "";
      return `  RUNTIME    +${progress.elapsedMs}ms runtime=${progress.runtime} kind=${progress.kind}${item} message=${JSON.stringify(progress.message)}`;
    }

    case "model_end":
      return `MODEL END    step=${event.context.step + 1} tools=${event.response.toolCalls.map((call) => call.name).join(",") || "none"}`;

    case "tool_start":
      return `TOOL START   ${event.call.name}`;

    case "tool_end":
      return `TOOL END     ${event.call.name} error=${event.result.isError ?? false}`;

    case "stop":
      return `AGENT STOP   reason=${event.reason}`;
  }
}

function summarizeToolResult(result: AgentToolResult): Record<string, unknown> {
  return {
    error: result.isError ?? false,
    resultChars: result.content.length,
    preview: truncate(result.content.replace(/\s+/g, " "), 160),
  };
}

function summarizeRun(
  result: AgentRunResult<DemoState>,
): Record<string, unknown> {
  return {
    reason: result.reason,
    modelSteps: result.steps.length,
    toolCalls: result.toolCallsExecuted,
    usage: result.usage,
    elapsedMs: result.elapsedMs,
    completed: result.state.completed ?? "",
  };
}

console.log(`jsx-ai streaming levels\n
1. Agent lifecycle   runAgent onEvent: model_start/model_end/tool_start/tool_end/stop
2. Runtime progress  runtime_progress inside a model step (Codex currently emits these)
3. Text deltas       streamLLM(): user-visible assistant text chunks (API or Codex)

This demo shows levels 1 and 2. It does NOT stream partial tool-call fields or response tokens.\n`);

const state: DemoState = { contextRead: false };

const result = await measure.assert(
  {
    label: "Streaming agent demo",
    result: summarizeRun,
  },
  async (trace: MeasureFn) => {
    let modelStep = 0;
    const measuredCall: typeof callLLM = async (tree, options) => {
      const step = ++modelStep;
      const response = await trace(
        {
          label: `Model step ${step}`,
          result: summarizeResponse,
        },
        () => callLLM(tree, options),
      );
      if (response === null) throw new Error(`Model step ${step} failed`);
      return response;
    };

    return runAgent({
      state,
      history: [
        {
          role: "user",
          content:
            "Read the application context, then recommend how progress streaming should be presented.",
        },
      ],
      buildPrompt: (history) => <DemoPrompt history={history} />,
      executeTool: async (call) => {
        const toolResult = await trace(
          {
            label: `Host tool — ${call.name}`,
            ...summarizeToolCall(call),
            result: summarizeToolResult,
          },
          async () => executeTool(call, state),
        );
        if (toolResult === null) throw new Error(`Tool ${call.name} failed`);
        return toolResult;
      },
      call: measuredCall,
      maxSteps: 4,
      maxToolCalls: 4,
      maxDurationMs: 2 * 60_000,
      isComplete: (_response: LLMResponse, _toolResults, context) =>
        Boolean(context.state.completed),
      onNoToolCalls: () => "Use get_context first, then finish.",
      onEvent: (event) => {
        // This is the public streaming surface demonstrated by this file.
        // Applications can render/store/forward these events however they want.
        console.log(eventSummary(event));
      },
    });
  },
);

if (result === null)
  throw new Error("Streaming demo failed; inspect the trace above.");

console.log("\nFinal recommendation");
console.log(result.state.completed ?? "No recommendation produced");
