import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("planning stream", () => {
  test("initial roadmap streams through jsx-ai before publication", () => {
    const agent = readFileSync("src/server/agent/jsx-agent.tsx", "utf8");
    const tick = readFileSync("src/server/worker/tick-project.ts", "utf8");
    expect(agent).toContain("streamLLM(modelName()");
    expect(tick).toContain("planGame(project.idea, (preview, liveUsage)");
    expect(tick).toContain("updateLiveRun(project.id, run.id, preview");
  });
});
