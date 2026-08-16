import { afterEach, describe, expect, test } from "bun:test";
import {
  contextWindow,
  modelName,
  modelProvider,
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

  test("detects jsx-ai providers from model names", () => {
    expect(modelProvider("gemini-3-flash-preview")).toBe("gemini");
    expect(modelProvider("gpt-4o")).toBe("openai");
    expect(modelProvider("o4-mini")).toBe("openai");
    expect(modelProvider("claude-3-sonnet-20240229")).toBe("anthropic");
    expect(modelProvider("deepseek-chat")).toBe("deepseek");
    expect(modelProvider("my-private-model")).toBe("custom");
  });

  test("requires the matching known-provider credential for workers", () => {
    process.env.GAME_MODEL = "gemini-3-flash-preview";
    delete process.env.GEMINI_API_KEY;
    expect(runtimeConfigIssues("worker")).toContain(
      "GEMINI_API_KEY is required for Gemini models",
    );

    process.env.GEMINI_API_KEY = "test-key";
    expect(runtimeConfigIssues("worker")).not.toContain(
      "GEMINI_API_KEY is required for Gemini models",
    );
  });
});
