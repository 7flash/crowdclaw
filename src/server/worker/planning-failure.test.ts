import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("planning failure persistence", () => {
  test("passes terminal flag before error message", () => {
    const source = readFileSync(
      new URL("./tick-project.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      "failPlanning(project.id, run.id, true, message, 0)",
    );
    expect(source).not.toContain(
      "failPlanning(project.id, run.id, publicMessage, true, 0)",
    );
  });
});
