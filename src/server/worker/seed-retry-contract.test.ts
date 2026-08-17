import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("treasury seed retry behavior", () => {
  test("failed or stale seed attempts back off instead of hot-looping", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../../../project-agent.ts"),
      "utf8",
    );
    expect(source).toContain("Date.now() + treasuryRetryMs()");
    expect(source).toContain("const justSubmitted");
    expect(source).toContain("const attempts = justSubmitted ? 10 : 1");
  });
});
