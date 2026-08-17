import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("jsx-ai runtime dispatch", () => {
  test("runAgent receives the selected jsx-ai runtime explicitly", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "jsx-agent.tsx"),
      "utf8",
    );

    expect(source).toContain("runAgent({");
    expect(source).toContain("runtime: jsxAiRuntime()");
    expect(source).not.toContain("call: measuredCall");
    expect(source).not.toContain("() => callLLM(tree, options)");
  });
});
