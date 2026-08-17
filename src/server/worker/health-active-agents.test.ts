import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(import.meta.dir, "../agents/process-manager.ts"),
  "utf8",
);

describe("bgrun health", () => {
  test("checks active CrowdClaw project agents rather than every historical bgrun process", () => {
    expect(source).toContain("projectsRepository.list()");
    expect(source).not.toContain("getAllProcesses()");
  });

  test("recovers transient provider failures and the legacy one-step plan-contract failure", () => {
    expect(source).toContain("isTransientProviderError(project.error)");
    expect(source).toContain('agentNote: "BUSY"');
    expect(source).toContain(
      "Planning stopped with max_steps without a valid plan",
    );
    expect(source).toContain('agentNote: "THINKING"');
  });
});
