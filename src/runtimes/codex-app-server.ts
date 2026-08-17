import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { JsxAiError, RequestTimeoutError } from "../errors";
import { abortReason } from "../internal/errors";
import type { ExtractedPrompt } from "../types";
import type { CodexRuntimeCallOptions, CodexRuntimeOptions } from "./codex";

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

interface RpcNotification {
  method: string;
  params?: unknown;
}

interface CodexLaunch {
  command: string;
  args: string[];
}

type AppServerLauncher = (
  launch: CodexLaunch,
  env: NodeJS.ProcessEnv,
) => ChildProcessWithoutNullStreams;

const defaultLauncher: AppServerLauncher = (launch, env) =>
  spawn(launch.command, launch.args, {
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

let appServerLauncher: AppServerLauncher = defaultLauncher;

/** Internal test seam; not re-exported from the package root. */
export function __setCodexAppServerLauncherForTests(
  launcher?: AppServerLauncher,
): void {
  appServerLauncher = launcher ?? defaultLauncher;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rpcError(value: unknown): Error {
  if (!isRecord(value)) return new Error("Codex app-server request failed");
  return new Error(
    typeof value.message === "string"
      ? value.message
      : "Codex app-server request failed",
  );
}

class NotificationQueue {
  private readonly values: RpcNotification[] = [];
  private readonly waiters: Array<{
    resolve(value: RpcNotification): void;
    reject(error: unknown): void;
  }> = [];
  private closed = false;
  private terminalError: unknown;

  push(value: RpcNotification): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve(value);
      return;
    }
    this.values.push(value);
  }

  fail(error: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.terminalError = error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  next(): Promise<RpcNotification> {
    const value = this.values.shift();
    if (value) return Promise.resolve(value);
    if (this.closed) {
      return Promise.reject(
        this.terminalError ?? new Error("Codex app-server closed"),
      );
    }
    return new Promise<RpcNotification>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }
}

class CodexAppServerClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly notifications = new NotificationQueue();
  private nextId = 1;
  private stderr = "";
  private closed = false;

  constructor(launch: CodexLaunch, env: NodeJS.ProcessEnv) {
    this.child = appServerLauncher(launch, env);
    const stdout = createInterface({ input: this.child.stdout });
    stdout.on("line", (line) => this.handleLine(line));

    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-12_000);
    });

    this.child.once("error", (error) => this.fail(error));
    this.child.once("exit", (code, signal) => {
      if (this.closed) return;
      const details = this.stderr.trim();
      const suffix = details ? `\n${details}` : "";
      this.fail(
        new Error(
          `Codex app-server exited before the turn completed (code=${code ?? "null"}, signal=${signal ?? "null"}).${suffix}`,
        ),
      );
    });
  }

  private write(value: unknown): void {
    if (this.closed || this.child.stdin.destroyed) {
      throw new Error("Codex app-server stdin is closed");
    }
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(parsed)) return;

    if (typeof parsed.method === "string") {
      if (typeof parsed.id === "number") {
        this.write({
          id: parsed.id,
          error: {
            code: -32601,
            message: `jsx-ai streamLLM does not service Codex client request ${parsed.method}`,
          },
        });
        return;
      }
      this.notifications.push({
        method: parsed.method,
        ...(parsed.params !== undefined ? { params: parsed.params } : {}),
      });
      return;
    }

    if (typeof parsed.id !== "number") return;
    const pending = this.pending.get(parsed.id);
    if (!pending) return;
    this.pending.delete(parsed.id);

    if (parsed.error !== undefined) {
      pending.reject(rpcError(parsed.error));
      return;
    }
    pending.resolve(parsed.result);
  }

  private fail(error: unknown): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.notifications.fail(error);
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    try {
      this.write({ id, method, ...(params !== undefined ? { params } : {}) });
    } catch (error) {
      this.pending.delete(id);
      throw error;
    }
    return promise;
  }

  notify(method: string, params?: unknown): void {
    this.write({ method, ...(params !== undefined ? { params } : {}) });
  }

  nextNotification(): Promise<RpcNotification> {
    return this.notifications.next();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.child.stdin.end();
    const exited = new Promise<void>((resolve) =>
      this.child.once("exit", () => resolve()),
    );
    await Promise.race([
      exited,
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
    ]);
    if (this.child.exitCode === null && this.child.signalCode === null)
      this.child.kill();
    for (const pending of this.pending.values())
      pending.reject(new Error("Codex app-server closed"));
    this.pending.clear();
    this.notifications.fail(new Error("Codex app-server closed"));
  }
}

function findCodexLaunch(options?: CodexRuntimeOptions): CodexLaunch {
  if (options?.codexPathOverride) {
    return {
      command: options.codexPathOverride,
      args: ["app-server", "--stdio"],
    };
  }

  try {
    const localRequire = createRequire(import.meta.url);
    const sdkEntry = localRequire.resolve("@openai/codex-sdk");
    const sdkRequire = createRequire(sdkEntry);
    const cliEntry = sdkRequire.resolve("@openai/codex/bin/codex.js");
    return {
      command: process.execPath,
      args: [cliEntry, "app-server", "--stdio"],
    };
  } catch (cause) {
    throw new JsxAiError(
      "MISSING_RUNTIME_DEPENDENCY",
      "Codex text streaming requires the Codex CLI packaged with @openai/codex-sdk. Install `@openai/codex-sdk`, then authenticate with `bunx @openai/codex login` (or `codex login`).",
      { cause },
    );
  }
}

function codexEnvironment(
  options?: CodexRuntimeOptions,
  explicitApiKey?: string,
): NodeJS.ProcessEnv {
  if (explicitApiKey) {
    throw new JsxAiError(
      "INVALID_ARGUMENT",
      'runtime="codex" does not accept apiKey. Use runtime="api" for explicit OpenAI API-key billing, or remove apiKey and authenticate Codex with `bunx @openai/codex login` (or `codex login`).',
    );
  }
  if ((options?.auth ?? "chatgpt") === "inherit") return { ...process.env };

  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const normalized = key.toUpperCase();
    if (normalized === "OPENAI_API_KEY" || normalized === "CODEX_API_KEY")
      continue;
    env[key] = value;
  }
  return env;
}

interface OperationSignal {
  signal: AbortSignal;
  timeoutSignal: AbortSignal;
  cleanup(): void;
}

function operationSignal(
  timeoutMs: number | undefined,
  external?: AbortSignal,
): OperationSignal {
  const effectiveTimeoutMs = timeoutMs ?? 60_000;
  if (!Number.isFinite(effectiveTimeoutMs) || effectiveTimeoutMs <= 0) {
    throw new JsxAiError(
      "INVALID_ARGUMENT",
      `timeoutMs must be a finite positive number; received ${effectiveTimeoutMs}`,
    );
  }
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(new RequestTimeoutError(effectiveTimeoutMs)),
    effectiveTimeoutMs,
  );
  return {
    signal: external
      ? AbortSignal.any([external, timeout.signal])
      : timeout.signal,
    timeoutSignal: timeout.signal,
    cleanup: () => clearTimeout(timer),
  };
}

function textPrompt(prompt: ExtractedPrompt): string {
  return [
    "You are the text-generation backend for jsx-ai.",
    "Answer only from the conversation supplied below.",
    "Do not inspect the filesystem, run commands, edit files, use MCP tools, browse the web, or take other side effects.",
    "Return only the assistant response text; do not describe this adapter or its JSON envelope.",
    "",
    JSON.stringify(
      {
        system: prompt.system ?? "",
        conversation: prompt.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      },
      null,
      2,
    ),
  ].join("\n");
}

function threadIdFromResponse(value: unknown): string {
  if (
    !isRecord(value) ||
    !isRecord(value.thread) ||
    typeof value.thread.id !== "string"
  ) {
    throw new JsxAiError(
      "INVALID_RESPONSE",
      "Codex app-server thread/start returned no thread id",
    );
  }
  return value.thread.id;
}

function turnIdFromResponse(value: unknown): string {
  if (
    !isRecord(value) ||
    !isRecord(value.turn) ||
    typeof value.turn.id !== "string"
  ) {
    throw new JsxAiError(
      "INVALID_RESPONSE",
      "Codex app-server turn/start returned no turn id",
    );
  }
  return value.turn.id;
}

function matchingIds(
  params: unknown,
  threadId: string,
  turnId: string,
): params is Record<string, unknown> {
  return (
    isRecord(params) && params.threadId === threadId && params.turnId === turnId
  );
}

function completedAgentText(
  params: unknown,
  threadId: string,
  turnId: string,
): string | undefined {
  if (!matchingIds(params, threadId, turnId) || !isRecord(params.item))
    return undefined;
  const item = params.item;
  if (item.type !== "agentMessage" || typeof item.text !== "string")
    return undefined;
  return item.text;
}

function turnCompletion(
  params: unknown,
  threadId: string,
  turnId: string,
): { done: boolean; error?: string } {
  if (
    !isRecord(params) ||
    params.threadId !== threadId ||
    !isRecord(params.turn)
  ) {
    return { done: false };
  }
  const turn = params.turn;
  if (turn.id !== turnId) return { done: false };
  const status = typeof turn.status === "string" ? turn.status : "completed";
  if (status === "completed") return { done: true };
  const error =
    isRecord(turn.error) && typeof turn.error.message === "string"
      ? turn.error.message
      : `Codex turn ended with status ${status}`;
  return { done: true, error };
}

/**
 * Stream assistant text deltas through Codex's documented app-server
 * `item/agentMessage/delta` notification. The child process is internal and is
 * closed when iteration completes, throws, or is cancelled.
 */
export async function* streamCodexTextRuntime(
  prompt: ExtractedPrompt,
  model: string | undefined,
  options?: CodexRuntimeCallOptions,
): AsyncGenerator<string> {
  const client = new CodexAppServerClient(
    findCodexLaunch(options?.codex),
    codexEnvironment(options?.codex, options?.apiKey),
  );
  const operation = operationSignal(options?.timeoutMs, options?.signal);
  const closeOnAbort = () => void client.close();
  operation.signal.addEventListener("abort", closeOnAbort, { once: true });

  try {
    await client.request("initialize", {
      clientInfo: { name: "jsx-ai", title: "jsx-ai", version: "0.14.0" },
    });
    client.notify("initialized", {});

    const codex = options?.codex;
    const threadResult = await client.request("thread/start", {
      ...(model ? { model } : {}),
      ...(codex?.workingDirectory ? { cwd: codex.workingDirectory } : {}),
      sandbox: codex?.sandboxMode ?? "read-only",
      approvalPolicy: codex?.approvalPolicy ?? "never",
      ephemeral: true,
    });
    const threadId = threadIdFromResponse(threadResult);
    const turnResult = await client.request("turn/start", {
      threadId,
      input: [{ type: "text", text: textPrompt(prompt) }],
      ...(codex?.modelReasoningEffort
        ? { effort: codex.modelReasoningEffort }
        : {}),
    });
    const turnId = turnIdFromResponse(turnResult);

    let deltaText = "";
    let completedText = "";

    while (true) {
      if (operation.signal.aborted) throw abortReason(operation.signal);
      const event = await client.nextNotification();

      if (
        event.method === "item/agentMessage/delta" &&
        matchingIds(event.params, threadId, turnId)
      ) {
        const delta =
          typeof event.params.delta === "string" ? event.params.delta : "";
        if (delta) {
          deltaText += delta;
          yield delta;
        }
        continue;
      }

      if (event.method === "item/completed") {
        completedText =
          completedAgentText(event.params, threadId, turnId) ?? completedText;
        continue;
      }

      if (
        event.method === "error" &&
        matchingIds(event.params, threadId, turnId)
      ) {
        if (event.params.willRetry === true) continue;
        const message =
          isRecord(event.params.error) &&
          typeof event.params.error.message === "string"
            ? event.params.error.message
            : "Codex app-server turn failed";
        throw new Error(message);
      }

      if (event.method === "turn/completed") {
        const completion = turnCompletion(event.params, threadId, turnId);
        if (!completion.done) continue;
        if (completion.error) throw new Error(completion.error);
        if (!deltaText && completedText) yield completedText;
        return;
      }
    }
  } catch (error) {
    if (options?.signal?.aborted) throw abortReason(options.signal);
    if (operation.timeoutSignal.aborted) {
      const reason = operation.timeoutSignal.reason;
      if (reason instanceof RequestTimeoutError) throw reason;
    }
    if (error instanceof JsxAiError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new JsxAiError(
      "RUNTIME_ERROR",
      `Codex text stream failed: ${message}`,
      {
        cause: error,
      },
    );
  } finally {
    operation.signal.removeEventListener("abort", closeOnAbort);
    operation.cleanup();
    await client.close();
  }
}
