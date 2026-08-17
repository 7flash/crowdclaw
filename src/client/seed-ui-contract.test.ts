import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(import.meta.dir, "components/ProjectView.tsx"),
  "utf8",
);

describe("platform supporter truthfulness", () => {
  test("does not synthesize a CrowdClaw supporter from seeding status", () => {
    expect(source).not.toContain('seed || (project.status === "seeding"');
  });

  test("hides failed treasury grants from supporters", () => {
    expect(source).toContain('seed && seed.status !== "failed"');
  });

  test("does not turn treasury failure into public ERROR", () => {
    expect(source).toContain(
      'event.type === "treasury.seed.failed") return ""',
    );
  });

  test("keeps the planner public note in the cinematic activity feed", () => {
    expect(source).toContain('clean.startsWith("T|")');
  });
});
