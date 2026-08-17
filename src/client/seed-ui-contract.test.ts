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
});
