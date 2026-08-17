import { describe, expect, test } from "bun:test";
import { publicErrorLabel } from "./public-error";

describe("publicErrorLabel", () => {
  test("keeps Codex setup failures compact and actionable", () => {
    expect(
      publicErrorLabel(
        "Codex runtime requires @openai/codex-sdk. Install it with bun add @openai/codex-sdk",
      ),
    ).toBe("CODEX SDK");
    expect(publicErrorLabel("Please run codex login to authenticate")).toBe(
      "CODEX LOGIN",
    );
  });

  test("projects provider failures to terse states", () => {
    expect(publicErrorLabel("gemini failed (503): high demand")).toBe("BUSY");
    expect(publicErrorLabel("429 quota exceeded")).toBe("QUOTA");
  });
});
