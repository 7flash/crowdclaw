import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("planning agent", () => {
  test("initial roadmap is exactly one runAgent model step with no silent retries", () => {
    const agent = readFileSync("src/server/agent/jsx-agent.tsx", "utf8");
    const tick = readFileSync("src/server/worker/tick-project.ts", "utf8");
    expect(agent).toContain("runAgent({");
    expect(agent).toContain("const PLAN_MAX_STEPS = 1");
    expect(agent).toContain("const PLAN_MAX_TOOL_CALLS = 1");
    expect(agent).toContain("retries: 0");
    expect(agent).toContain('name="submit_game_plan"');
    expect(agent).not.toContain("streamLLM(");
    expect(tick).not.toContain("startPlanningPulse");
    expect(tick).toContain("revealPlanningResult(");
    expect(tick).toContain(
      'publicMessage = /(?:\\b429\\b|quota|rate.?limit)/i.test(message) ? "QUOTA" : "MODEL ERROR"',
    );
  });

  test("build agent delegates history/tool iteration to runAgent", () => {
    const agent = readFileSync("src/server/agent/jsx-agent.tsx", "utf8");
    expect(agent).toContain("Fresh model history per milestone");
    expect(agent).toContain('name="public_status"');
    expect(agent).toContain('name="complete_milestone"');
    expect(agent).toContain(
      "isComplete: (_response, _toolResults, context) => Boolean(context.state.completion)",
    );
  });
});
