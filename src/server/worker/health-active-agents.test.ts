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

  test("recovers only old terminal planning failures caused by transient provider outages", () => {
    expect(source).toContain("isTransientProviderError(project.error)");
    expect(source).toContain('agentNote: "BUSY"');
  });
});
