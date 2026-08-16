import { describe, expect, test } from "bun:test";
import { parseAgentOutput, sealHtml, validateArtifactHtml } from "./output";

describe("agent output", () => {
  test("parses the three-line milestone planning contract", () => {
    const parsed = parseAgentOutput(
      "N|tiny-game\nS|A tiny playable game.\nM|Playable movement loop|2\nM|Add enemy pressure|2\nM|Add score multipliers|3",
    );
    expect(parsed.name).toBe("tiny-game");
    expect(parsed.summary).toBe("A tiny playable game.");
    expect(parsed.milestones).toHaveLength(3);
    expect(parsed.milestones[0]).toEqual({
      title: "Playable movement loop",
      costCredits: 2,
    });
  });

  test("seals nearly complete html", () => {
    expect(sealHtml("<html><body><script>1")).toContain("</html>");
  });

  test("accepts a self-contained playable document", () => {
    const html = `<!doctype html><html><body><canvas></canvas><script>${"let x=1;".repeat(45)}</script></body></html>`;
    expect(validateArtifactHtml(html)).toEqual([]);
  });

  test("rejects external or persistent browser behavior", () => {
    const html = `<!doctype html><html><body><script>${"let x=1;".repeat(40)}fetch("https://example.com");localStorage.x=1</script></body></html>`;
    expect(validateArtifactHtml(html).length).toBeGreaterThan(0);
  });
});
