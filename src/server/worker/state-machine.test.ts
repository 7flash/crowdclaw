import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("per-project agent lifecycle", () => {
  test("project agent plans before funding reconciliation", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../../../project-agent.ts"),
      "utf8",
    );
    const planning = source.indexOf('snapshot.status === "planning"');
    const funding = source.indexOf('measure("funding.sync"');
    expect(planning).toBeGreaterThan(-1);
    expect(funding).toBeGreaterThan(-1);
    expect(planning).toBeLessThan(funding);
  });

  test("funding transition cannot complete an unplanned project", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../db/project-repository.ts"),
      "utf8",
    );
    const start = source.indexOf("markQueuedIfFunded(projectId");
    const end = source.indexOf("reserveNextMilestone", start);
    const block = source.slice(start, end);
    expect(block).toContain('project.status === "waiting_funds"');
    expect(block).not.toContain('row.status = "completed"');
  });
});
