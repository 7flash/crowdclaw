import { describe, expect, test } from "bun:test";
import { parseAgentOutput, sealHtml, validateArtifactHtml } from "./output";

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

  test("accepts a self-contained playable document", () => {
    const html = `<!doctype html><html><body><canvas></canvas><script>${"let x=1;".repeat(45)}</script></body></html>`;
    expect(validateArtifactHtml(html)).toEqual([]);
  });

  test("rejects external or persistent browser behavior", () => {
    const html = `<!doctype html><html><body><script>${"let x=1;".repeat(40)}fetch("https://example.com");localStorage.x=1</script></body></html>`;
    expect(validateArtifactHtml(html).length).toBeGreaterThan(0);
  });
});
