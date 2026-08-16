import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("per-project bgrun agents", () => {
  test("project creation starts a named bgrun agent", () => {
    const route = readFileSync("app/api/projects/route.ts", "utf8");
    const manager = readFileSync(
      "src/server/agents/process-manager.ts",
      "utf8",
    );
    expect(route).toContain("ensureProjectAgent(project.id)");
    expect(manager).toContain("handleRun({");
    expect(manager).toContain("bun project-agent.ts ${projectId}");
  });

  test("web no longer embeds the shared worker", () => {
    const server = readFileSync("server.ts", "utf8");
    expect(server).not.toContain("startAgentWorker");
    expect(server).not.toContain("wakeAgentWorker");
    expect(server).toContain("reconcileProjectAgents");
  });
});
