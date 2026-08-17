import { afterEach, describe, expect, test } from "bun:test";
import {
  contextWindow,
  jsxAiRuntime,
  modelName,
  runtimeConfigIssues,
} from "./config";

const original = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in original)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("agent model configuration", () => {
  test("defaults to Gemini 3 Flash Preview and its input context window", () => {
    delete process.env.GAME_MODEL;
    delete process.env.GAME_CONTEXT_WINDOW;
    expect(modelName()).toBe("gemini-3-flash-preview");
    expect(contextWindow()).toBe(1_048_576);
  });

  test("CrowdClaw does not validate jsx-ai provider credentials", () => {
    process.env.JSX_AI_RUNTIME = "codex";
    process.env.GAME_MODEL = "gpt-5.4-mini";
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;

    expect(jsxAiRuntime()).toBe("codex");
    expect(runtimeConfigIssues("worker").join(" ")).not.toMatch(
      /API_KEY|required for .* models/i,
    );
    expect(runtimeConfigIssues("web").join(" ")).not.toMatch(
      /API_KEY|required for .* models/i,
    );
  });
});
