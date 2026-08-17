import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const tick = readFileSync(
  resolve(root, "src/server/worker/tick-project.ts"),
  "utf8",
);
const home = readFileSync(
  resolve(root, "src/client/components/HomeView.tsx"),
  "utf8",
);

describe("transient planning failures", () => {
  test("503/high-demand failures schedule a retry instead of terminal failure", () => {
    expect(tick).toContain("isTransientModelError");
    expect(tick).toContain(
      'publicMessage = quota ? "QUOTA" : transient ? "BUSY" : "MODEL ERROR"',
    );
    expect(tick).toContain(
      "failPlanning(project.id, run.id, false, message, retryAt)",
    );
  });

  test("public planning UI never dumps provider transport errors", () => {
    expect(home).toContain('return "BUSY"');
    expect(home).toContain('return "MODEL ERROR"');
    expect(home).not.toContain("message.length > 72");
  });

  test("transient build failures back off without becoming terminal", () => {
    expect(tick).toContain(
      "const terminal = !transient && failures >= MAX_FAILURES",
    );
    expect(tick).toContain('agentNote: "BUSY"');
  });
});
