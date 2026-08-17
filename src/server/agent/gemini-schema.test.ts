import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("Gemini-compatible agent schemas", () => {
  test("planning/build tool schemas do not send additionalProperties", () => {
    const source = readFileSync(
      new URL("./jsx-agent.tsx", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain("additionalProperties:");
  });
});
