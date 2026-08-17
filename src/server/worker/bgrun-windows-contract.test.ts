import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("bgrun Windows command contract", () => {
  test("does not pre-quote the Bun executable", () => {
    const manager = readFileSync(
      "src/server/agents/process-manager.ts",
      "utf8",
    );
    expect(manager).toContain(
      "const command = `bun project-agent.ts ${projectId}`",
    );
    expect(manager).not.toContain("process.execPath");
    expect(manager).not.toContain('"${bun}"');
    expect(manager).not.toContain("AGENT_ENTRY");
  });
});
