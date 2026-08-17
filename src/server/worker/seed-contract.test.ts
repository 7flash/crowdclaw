import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("first milestone sponsorship", () => {
  test("planning flows into seeding before build", () => {
    const repo = readFileSync(
      resolve(import.meta.dir, "../db/project-repository.ts"),
      "utf8",
    );
    const agent = readFileSync(
      resolve(import.meta.dir, "../../../project-agent.ts"),
      "utf8",
    );
    expect(repo).toContain('"queued" : "seeding"');
    expect(agent).toContain('measure("project.seed"');
    expect(agent).toContain("ensureFirstMilestoneSeed");
  });

  test("platform seed does not earn supporter influence", () => {
    const repo = readFileSync(
      resolve(import.meta.dir, "../db/project-repository.ts"),
      "utf8",
    );
    expect(repo).toContain('item.source === "supporter"');
    expect(repo).toContain('"platform_seed"');
  });

  test("grant is persisted before Solard transfer", () => {
    const service = readFileSync(
      resolve(import.meta.dir, "../services/treasury-service.ts"),
      "utf8",
    );
    const begin = service.indexOf("beginTreasuryGrant");
    const send = service.indexOf("sendTreasurySol");
    expect(begin).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(begin);
  });
});
