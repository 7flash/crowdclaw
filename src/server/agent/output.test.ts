import { describe, expect, test } from "bun:test";
import { parseAgentOutput, sealHtml } from "./output";

describe("agent output", () => {
  test("parses planning output", () => {
    const parsed = parseAgentOutput(
      [
        "N|closing-snake",
        "S|Eat dots while the arena shrinks.",
        "M|Move eat and score|2",
        "M|Shrink walls on food|2",
        "M|Add restart screen|3",
      ].join("\n"),
    );

    expect(parsed.name).toBe("closing-snake");
    expect(parsed.miles).toEqual([
      { t: "Move eat and score", c: 2 },
      { t: "Shrink walls on food", c: 2 },
      { t: "Add restart screen", c: 3 },
    ]);
  });

  test("parses build output and strips fences", () => {
    const parsed = parseAgentOutput(
      "T|I am making the loop playable.\nM|Add harder waves|2\nCODE|\n```html\n<html><body>ok</body></html>\n```",
    );
    expect(parsed.notes[0]).toContain("playable");
    expect(parsed.miles[0]).toEqual({ t: "Add harder waves", c: 2 });
    expect(parsed.code).toBe("<html><body>ok</body></html>");
  });

  test("seals a truncated HTML file", () => {
    expect(sealHtml("<html><body><script>console.log(1)")).toEndWith(
      "</script>\n</body>\n</html>",
    );
  });
});
