import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("minimal public language", () => {
  test("uses the agreed title and SOL units", () => {
    const home = readFileSync("src/client/components/HomeView.tsx", "utf8");
    const project = readFileSync(
      "src/client/components/ProjectView.tsx",
      "utf8",
    );
    const constants = readFileSync("src/shared/constants.ts", "utf8");
    expect(home).toContain("Describe your <em");
    expect(home).toContain("Idea</em>.<br />Agent keeps building it.");
    expect(home).toContain(
      "Anyone can fund it. Supporters steer what it builds next.",
    );
    expect(project).toContain("SUPPORTERS");
    expect(project).toContain("CrowdClaw");
    expect(project).toContain("TREASURY");
    expect(project).toContain("STEER NEXT");
    expect(project).toContain("SOL");
    expect(constants).not.toContain("◎");
    expect(project).not.toContain("build credits");
    expect(project).not.toContain("Roadmap ready");
    expect(project).not.toContain("Send SOL");
    expect(project).not.toContain("Confirmed balance");
  });
});
