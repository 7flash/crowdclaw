import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("live funding wake-up", () => {
  test("waiting_funds still reconciles the project wallet during treasury backoff", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../../../project-agent.ts"),
      "utf8",
    );
    const waiting = source.indexOf('snapshot.status === "waiting_funds"');
    const watch = source.indexOf('start: () => "Watch project SOL"', waiting);
    const retryGate = source.indexOf('snapshot.status !== "waiting_funds"', 0);
    expect(waiting).toBeGreaterThan(-1);
    expect(watch).toBeGreaterThan(waiting);
    expect(retryGate).toBeGreaterThan(-1);
    expect(source).toContain("syncProjectFunding(snapshot!, true)");
  });

  test("funding clears retry delay before queuing the next milestone", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../db/project-repository.ts"),
      "utf8",
    );
    const start = source.indexOf("markQueuedIfFunded(projectId");
    const end = source.indexOf("reserveNextMilestone", start);
    const block = source.slice(start, end);
    expect(block).toContain('row.status = "queued"');
    expect(block).toContain("row.retryAt = 0");
  });

  test("open project pages observe autonomous funding without background writes", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../../../app/projects/[id]/page.client.tsx"),
      "utf8",
    );
    expect(source).toContain('addEventListener("snapshot"');
    expect(source).not.toContain("function updateFundingWatch()");
    expect(source).not.toContain("nudgeFunding");
    expect(source).not.toContain("setInterval(() => void api.syncFunding");
  });
});
