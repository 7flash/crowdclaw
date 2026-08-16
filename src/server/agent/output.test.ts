import { describe, expect, test } from "bun:test";
import { parseAgentOutput, sealHtml } from "./output";

describe("agent output", () => {
  test("parses rolling milestone and code", () => {
    const parsed = parseAgentOutput(
      "T|Adding juice\nM|Add enemy waves|2\nCODE|\n<!doctype html><html><body>x</body></html>",
    );
    expect(parsed.notes[0]).toBe("Adding juice");
    expect(parsed.milestones[0]).toEqual({
      title: "Add enemy waves",
      costCredits: 2,
    });
    expect(parsed.code).toContain("</html>");
  });

  test("seals nearly complete html", () => {
    expect(sealHtml("<html><body><script>1")).toContain("</html>");
  });
});
