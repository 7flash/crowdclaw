import { describe, expect, test } from "bun:test";
import {
  compileGameHtml,
  extractGameSource,
  validateGameSource,
} from "./game-artifact";

const SOURCE = `import { render } from "tradjs/client";
function Game() {
  return <main style="width:100%;height:100%;display:grid;place-items:center;background:#050a0c;color:white"><button onClick={() => console.log("play")}>PLAY</button></main>;
}
export default function mount() {
  const root = document.getElementById("game-root");
  if (!root) return;
  render(<Game />, root);
  return () => render(null, root);
}`;

describe("TradJS game artifacts", () => {
  test("accepts one-file tradjs/client mount source", () => {
    expect(validateGameSource(SOURCE)).toEqual([]);
  });

  test("rejects external dependencies", () => {
    expect(validateGameSource(SOURCE + '\nimport x from "three";')).toContain(
      "only tradjs/client may be imported",
    );
  });

  test("bundles to one HTML file and preserves source", async () => {
    const html = await compileGameHtml(SOURCE);
    expect(html).toContain('<div id="game-root"></div>');
    expect(html).toContain('id="crowdclaw-source"');
    expect(html).not.toContain('src="');
    expect(extractGameSource(html)).toBe(SOURCE);
  });
});
