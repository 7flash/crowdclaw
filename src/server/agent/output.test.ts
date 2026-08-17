import { describe, expect, test } from "bun:test";
import { sealHtml, validateArtifactHtml } from "./output";

describe("agent artifact output", () => {
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
